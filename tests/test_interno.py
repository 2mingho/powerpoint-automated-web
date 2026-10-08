"""
La API interna que usa la app Next.js (blueprints/interno.py).

Lo que se prueba es la puerta y lo que la atraviesa: sin token no se entra,
con token se actua como el usuario indicado y con sus permisos, los procesos
largos son trabajos con fases reales, y nadie ve trabajos, descargas ni
reportes que no puede ver en las paginas Flask.
"""
import io
import json
import os
import threading
import time

import pytest
from werkzeug.security import generate_password_hash

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_interno.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from blueprints import interno  # noqa: E402
from extensions import db  # noqa: E402
from models import ActivityLog, Report, TempArtifact, User  # noqa: E402
from services import trabajos as trabajos_svc  # noqa: E402

TOKEN = 'token-de-servicio-de-prueba'
WIDGETS = os.path.join(os.path.dirname(__file__), 'fixtures', 'meltwater_widgets')


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('ANALYTICS_TOKEN', TOKEN)
    app = app_module.app
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False, INTERNO_SINCRONO=True)
    interno._llamadas_ia.clear()
    with app.app_context():
        db.drop_all()
        db.create_all()
    with app.test_client() as test_client:
        yield test_client
    app.config.pop('INTERNO_SINCRONO', None)


def _usuario(nombre, herramientas=('reports',), role='DI', activo=True):
    user = User(username=nombre, email=f'{nombre}@ejemplo.com',
                password=generate_password_hash('clave', method='scrypt'),
                role=role, is_active=activo)
    user.set_allowed_tools(list(herramientas))
    db.session.add(user)
    db.session.commit()
    return user.id


@pytest.fixture
def usuarios(client):
    todas = ('reports', 'classification', 'file_merge', 'csv_analysis')
    with app_module.app.app_context():
        return {
            'ana': _usuario('ana', todas),
            'beto': _usuario('beto', todas),
            'sin_nada': _usuario('sin_nada', ()),
            'solo_tareas': _usuario('solo_tareas', ('tasks',)),
            'inactivo': _usuario('inactivo', todas, activo=False),
            'admin': _usuario('admin', (), role='admin'),
        }


def _h(uid, token=TOKEN):
    return {'Authorization': f'Bearer {token}', 'X-Usuario-Id': str(uid)}


def _widgets(nombres=None):
    archivos = sorted(os.listdir(WIDGETS))
    if nombres is not None:
        archivos = [a for a in archivos if any(a.startswith(n) for n in nombres)]
    return [(open(os.path.join(WIDGETS, a), 'rb').read(), a) for a in archivos]


def _form_widgets(**extra):
    datos = {'titulo': 'Cliente de prueba', 'textos_ia': '0', **extra}
    datos['archivos'] = [(io.BytesIO(b), n) for b, n in _widgets()]
    return datos


def _trabajo(client, uid, respuesta):
    assert respuesta.status_code == 202, respuesta.get_json()
    tid = respuesta.get_json()['trabajo']
    estado = client.get(f'/api/interno/trabajos/{tid}', headers=_h(uid))
    assert estado.status_code == 200
    return tid, estado.get_json()


# ─────────────────────────────────────────────────────────────
# La puerta
# ─────────────────────────────────────────────────────────────

def test_sin_token_es_401(client, usuarios):
    r = client.get('/api/interno/salud', headers={'X-Usuario-Id': str(usuarios['ana'])})
    assert r.status_code == 401
    assert 'error' in r.get_json()


def test_token_equivocado_es_401(client, usuarios):
    assert client.get('/api/interno/salud', headers=_h(usuarios['ana'], 'otro')).status_code == 401


def test_sin_token_configurado_la_puerta_queda_cerrada(client, usuarios, monkeypatch):
    """Un ANALYTICS_TOKEN vacio no puede significar 'cualquiera vale'."""
    monkeypatch.setenv('ANALYTICS_TOKEN', '')
    assert client.get('/api/interno/salud', headers=_h(usuarios['ana'], '')).status_code == 401


def test_sin_usuario_o_con_usuario_desactivado_es_401(client, usuarios):
    assert client.get('/api/interno/salud', headers={'Authorization': f'Bearer {TOKEN}'}).status_code == 401
    assert client.get('/api/interno/salud', headers=_h('abc')).status_code == 401
    assert client.get('/api/interno/salud', headers=_h(99999)).status_code == 401
    assert client.get('/api/interno/salud', headers=_h(usuarios['inactivo'])).status_code == 401


def test_con_token_actua_como_el_usuario(client, usuarios):
    r = client.get('/api/interno/salud', headers=_h(usuarios['ana']))
    assert r.status_code == 200
    assert r.get_json()['usuario'] == usuarios['ana']


def test_no_pide_csrf_ni_cuenta_contra_el_limite_global(client, usuarios):
    """Next sondea cada segundo: 80 consultas seguidas no pueden acabar en 429."""
    app_module.app.config['WTF_CSRF_ENABLED'] = True
    try:
        r = client.post('/api/interno/reportes', headers=_h(usuarios['ana']), data={})
        assert r.status_code == 400  # llega a la vista: no es un fallo de CSRF
    finally:
        app_module.app.config['WTF_CSRF_ENABLED'] = False
    for _ in range(80):
        assert client.get('/api/interno/salud', headers=_h(usuarios['ana'])).status_code == 200


def test_el_sondeo_no_llena_el_registro_de_actividad(client, usuarios):
    for _ in range(5):
        client.get('/api/interno/salud', headers=_h(usuarios['ana']))
    with app_module.app.app_context():
        assert ActivityLog.query.filter_by(action='page_view').count() == 0


@pytest.mark.parametrize('metodo,ruta,herramienta', [
    ('get', '/api/interno/reportes', 'reports'),
    ('post', '/api/interno/reportes', 'reports'),
    ('post', '/api/interno/reportes/previsualizar', 'reports'),
    ('post', '/api/interno/clasificacion', 'classification'),
    ('post', '/api/interno/clasificacion/detectar', 'classification'),
    ('post', '/api/interno/union', 'file_merge'),
    ('post', '/api/interno/union/detectar', 'file_merge'),
    ('post', '/api/interno/analisis', 'csv_analysis'),
    ('post', '/api/interno/analisis/detectar', 'csv_analysis'),
])
def test_sin_la_herramienta_es_403(client, usuarios, metodo, ruta, herramienta):
    r = getattr(client, metodo)(ruta, headers=_h(usuarios['solo_tareas']))
    assert r.status_code == 403
    assert r.get_json()['error']


def test_el_admin_entra_a_todo(client, usuarios):
    assert client.get('/api/interno/reportes', headers=_h(usuarios['admin'])).status_code == 200


def test_la_api_interna_no_fuerza_https(client):
    """Entre servicios va por HTTP interno: una redireccion a https la romperia."""
    for nombre, vista in app_module.app.view_functions.items():
        if nombre.startswith('interno.'):
            assert vista.talisman_view_options['force_https'] is False


# ─────────────────────────────────────────────────────────────
# Reportes
# ─────────────────────────────────────────────────────────────

def test_previsualizar_reconoce_cada_widget(client, usuarios):
    datos = {'archivos': [(io.BytesIO(b), n) for b, n in _widgets(['00', '04'])]
             + [(io.BytesIO(b'no es excel'), 'roto.xlsx'), (io.BytesIO(b'x'), 'notas.txt')]}
    r = client.post('/api/interno/reportes/previsualizar', headers=_h(usuarios['ana']),
                    data=datos, content_type='multipart/form-data')
    assert r.status_code == 200
    filas = {f['nombre']: f for f in r.get_json()['archivos']}
    assert filas['00.Evolucion_y_cantidad_de_menciones.xlsx']['widget'] == 'mentions_trend'
    assert filas['04.Sentimiento.xlsx']['widget'] == 'sentiment'
    assert filas['roto.xlsx']['error']
    assert '.xlsx' in filas['notas.txt']['error']
    faltan = {f['clave'] for f in r.get_json()['faltan']}
    assert 'mentions_trend' not in faltan and 'reach_trend' in faltan


def test_generar_reporte_es_un_trabajo_que_acaba_en_un_reporte_guardado(client, usuarios):
    r = client.post('/api/interno/reportes', headers=_h(usuarios['ana']),
                    data=_form_widgets(), content_type='multipart/form-data')
    tid, estado = _trabajo(client, usuarios['ana'], r)
    assert estado['estado'] == 'hecho', estado
    assert estado['fase'] == 'hecho'
    assert estado['progreso'] == 100
    token = estado['resultado']['token']

    with app_module.app.app_context():
        guardado = Report.query.filter_by(token=token).first()
        assert guardado.user_id == usuarios['ana']
        assert guardado.insights_status == Report.INSIGHTS_OMITIDO
        assert guardado.contexto['meta']['client_name'] == 'Cliente de prueba'
        assert 'meltwater_analysis' not in guardado.contexto
        assert ActivityLog.query.filter_by(action='generate_report').count() == 1

    lista = client.get('/api/interno/reportes', headers=_h(usuarios['ana'])).get_json()['reportes']
    assert [x['token'] for x in lista] == [token]
    assert lista[0]['cliente'] == 'Cliente de prueba'
    assert lista[0]['periodo'] and lista[0]['menciones'] > 0


def test_las_fases_avanzan_en_orden_y_con_progreso_real(client, usuarios, monkeypatch):
    visto = []
    original = trabajos_svc.Trabajo.avisar

    def espia(self, fase, progreso=None, mensaje=None):
        visto.append((fase, progreso))
        return original(self, fase, progreso, mensaje)

    monkeypatch.setattr(trabajos_svc.Trabajo, 'avisar', espia)
    r = client.post('/api/interno/reportes', headers=_h(usuarios['ana']),
                    data=_form_widgets(), content_type='multipart/form-data')
    assert r.status_code == 202

    orden = ['carga', 'limpieza', 'calculo', 'graficos', 'ia', 'guardado']
    fases = []
    for fase, _ in visto:
        if not fases or fases[-1] != fase:
            fases.append(fase)
    assert fases == orden
    # La carga avisa una vez por archivo, no salta de 0 a 100.
    cargas = [p for f, p in visto if f == 'carga' and p is not None]
    assert len(cargas) >= len(_widgets())


def test_archivos_irreconocibles_fallan_explicando_cada_uno(client, usuarios):
    datos = {'titulo': 'x', 'archivos': [(io.BytesIO(b'basura'), 'a.xlsx'), (io.BytesIO(b'mas'), 'b.xlsx')]}
    r = client.post('/api/interno/reportes', headers=_h(usuarios['ana']), data=datos,
                    content_type='multipart/form-data')
    _tid, estado = _trabajo(client, usuarios['ana'], r)
    assert estado['estado'] == 'fallido'
    assert estado['fase'] == 'carga'
    assert len(estado['detalle']) == 2
    assert 'a.xlsx' in estado['detalle'][0]


def test_autores_invalidos_se_rechazan_antes_de_encolar(client, usuarios):
    r = client.post('/api/interno/reportes', headers=_h(usuarios['ana']),
                    data=_form_widgets(autores_unicos='muchos'), content_type='multipart/form-data')
    assert r.status_code == 400
    assert r.get_json()['campo'] == 'autores_unicos'


def test_modo_avanzado_senala_la_casilla_equivocada(client, usuarios):
    sentimiento = dict((n, b) for b, n in _widgets(['04']))['04.Sentimiento.xlsx']
    datos = {'titulo': 'x', 'modo': 'avanzado', 'textos_ia': '0',
             'widget_mentions_trend': (io.BytesIO(sentimiento), 'sentimiento.xlsx')}
    r = client.post('/api/interno/reportes', headers=_h(usuarios['ana']), data=datos,
                    content_type='multipart/form-data')
    _tid, estado = _trabajo(client, usuarios['ana'], r)
    assert estado['estado'] == 'fallido'
    assert 'casilla equivocada' in estado['detalle'][0]


def _reporte(uid):
    with app_module.app.app_context():
        r = Report(token=Report.nuevo_token(), title='Cliente', user_id=uid,
                   context_json=json.dumps({
                       'meta': {'client_name': 'Cliente'},
                       'kpis': {'total_mentions': 10, 'mentions_redes': 6, 'mentions_prensa': 4},
                       'charts': {'evolution': {'labels': ['1 ene', '7 ene']}},
                       'content': {'top_authors': []},
                       'insights': {'volume_title': 'Por reglas'}, 'warnings': []}),
                   insights_source='reglas', insights_status=Report.INSIGHTS_PENDIENTE)
        db.session.add(r)
        db.session.commit()
        return r.token


def test_un_companero_lee_el_reporte_pero_no_lo_edita(client, usuarios):
    """Los mismos permisos que /reporte/<token>: el enlace se comparte para leer."""
    token = _reporte(usuarios['ana'])
    propio = client.get(f'/api/interno/reportes/{token}', headers=_h(usuarios['ana'])).get_json()
    assert propio['puede_editar'] is True
    assert propio['vista']['pct_redes'] == 60

    ajeno = client.get(f'/api/interno/reportes/{token}', headers=_h(usuarios['beto']))
    assert ajeno.status_code == 200
    assert ajeno.get_json()['puede_editar'] is False

    r = client.post(f'/api/interno/reportes/{token}/textos', headers=_h(usuarios['beto']),
                    json={'textos': {'volume_title': 'Intruso'}})
    assert r.status_code == 403
    assert client.post(f'/api/interno/reportes/{token}/insights', headers=_h(usuarios['beto'])).status_code == 403


def test_mis_reportes_solo_lista_los_propios(client, usuarios):
    _reporte(usuarios['ana'])
    assert client.get('/api/interno/reportes', headers=_h(usuarios['beto'])).get_json()['reportes'] == []


def test_la_busqueda_filtra_por_cliente(client, usuarios):
    _reporte(usuarios['ana'])
    assert len(client.get('/api/interno/reportes?q=clien', headers=_h(usuarios['ana'])).get_json()['reportes']) == 1
    assert client.get('/api/interno/reportes?q=zzz', headers=_h(usuarios['ana'])).get_json()['reportes'] == []


def test_sin_la_herramienta_no_se_lee_ni_con_el_enlace(client, usuarios):
    token = _reporte(usuarios['ana'])
    assert client.get(f'/api/interno/reportes/{token}', headers=_h(usuarios['solo_tareas'])).status_code == 403


def test_un_token_inventado_es_404(client, usuarios):
    assert client.get('/api/interno/reportes/no-existe', headers=_h(usuarios['ana'])).status_code == 404


def test_los_retoques_del_dueno_se_guardan(client, usuarios):
    token = _reporte(usuarios['ana'])
    r = client.post(f'/api/interno/reportes/{token}/textos', headers=_h(usuarios['ana']),
                    json={'textos': {'volume_title': 'A mano', 'is_admin': 'true'}})
    assert r.status_code == 200
    datos = client.get(f'/api/interno/reportes/{token}', headers=_h(usuarios['ana'])).get_json()
    assert datos['contexto']['insights']['volume_title'] == 'A mano'
    assert datos['editados'] == ['volume_title']


def test_los_textos_de_ia_son_un_trabajo_y_no_se_pagan_dos_veces(client, usuarios, monkeypatch):
    llamadas = []

    def modelo(ctx):
        llamadas.append(1)
        return {'volume_title': 'Del modelo'}, {'ok': True, 'reason': 'ok'}

    monkeypatch.setattr('services.insight_harness.generate_insights', modelo)
    token = _reporte(usuarios['ana'])
    r = client.post(f'/api/interno/reportes/{token}/insights', headers=_h(usuarios['ana']))
    _tid, estado = _trabajo(client, usuarios['ana'], r)
    assert estado['estado'] == 'hecho'
    assert estado['resultado']['insights']['volume_title'] == 'Del modelo'

    otra = client.post(f'/api/interno/reportes/{token}/insights', headers=_h(usuarios['ana']))
    assert otra.status_code == 200 and otra.get_json()['trabajo'] is None
    assert len(llamadas) == 1


def test_los_textos_de_ia_tienen_limite_por_hora(client, usuarios, monkeypatch):
    monkeypatch.setattr('services.insight_harness.generate_insights',
                        lambda ctx: (None, {'ok': False, 'reason': 'timeout'}))
    token = _reporte(usuarios['ana'])
    codigos = [client.post(f'/api/interno/reportes/{token}/insights', headers=_h(usuarios['ana'])).status_code
               for _ in range(interno.LIMITE_IA_HORA + 1)]
    assert codigos[:-1] == [202] * interno.LIMITE_IA_HORA
    assert codigos[-1] == 429


# ─────────────────────────────────────────────────────────────
# Clasificacion, union y analisis
# ─────────────────────────────────────────────────────────────

MENCIONES = (
    'Hit Sentence\tSource\tKeywords\n'
    '"Suben los precios\nen el mercado"\tTwitter\tinflacion\n'
    'Nuevo hospital en la ciudad\tFacebook\tsalud\n'
    'Partido de futbol\tInstagram\tdeporte\n'
)


def _utf16(texto):
    return texto.encode('utf-16')


REGLAS = json.dumps([
    {'category': 'Economia', 'tematicas': [{'name': 'Precios', 'keywords': ['precios']}]},
    {'category': 'Salud', 'tematicas': [{'name': 'Hospitales', 'keywords': 'hospital, clinica'}]},
])


def test_detectar_devuelve_columnas_codificacion_y_separador(client, usuarios):
    r = client.post('/api/interno/clasificacion/detectar', headers=_h(usuarios['ana']),
                    data={'archivo': (io.BytesIO(_utf16(MENCIONES)), 'menciones.csv')},
                    content_type='multipart/form-data')
    assert r.status_code == 200, r.get_json()
    datos = r.get_json()
    assert datos['columnas'] == ['Hit Sentence', 'Source', 'Keywords']
    assert datos['codificacion'] == 'utf-16' and datos['separador'] == '\t'
    assert len(datos['vista_previa']) == 3


def test_detectar_respeta_la_codificacion_y_el_separador_forzados(client, usuarios):
    """En Flask 'Volver a detectar' mandaba estos campos y la ruta los ignoraba."""
    crudo = 'a;b,c\n1;2,3\n4;5,6\n'.encode('utf-8')
    auto = client.post('/api/interno/analisis/detectar', headers=_h(usuarios['ana']),
                       data={'archivo': (io.BytesIO(crudo), 'x.csv')}, content_type='multipart/form-data')
    forzado = client.post('/api/interno/analisis/detectar', headers=_h(usuarios['ana']),
                          data={'archivo': (io.BytesIO(crudo), 'x.csv'), 'separador': ';'},
                          content_type='multipart/form-data')
    assert auto.get_json()['columnas'] != forzado.get_json()['columnas']
    assert forzado.get_json()['columnas'] == ['a', 'b,c']


def test_clasificar_es_un_trabajo_con_descarga_propia(client, usuarios):
    datos = {'archivo': (io.BytesIO(_utf16(MENCIONES)), 'menciones.csv'), 'reglas': REGLAS,
             'columna_texto': 'Hit Sentence', 'etiqueta_defecto': 'Otro'}
    r = client.post('/api/interno/clasificacion', headers=_h(usuarios['ana']), data=datos,
                    content_type='multipart/form-data')
    tid, estado = _trabajo(client, usuarios['ana'], r)
    assert estado['estado'] == 'hecho', estado
    res = estado['resultado']
    # El texto con salto de linea viaja entero: tres filas, no cuatro.
    assert res['total_filas'] == 3
    assert res['stats']['Economia']['tematicas'] == {'Precios': 1}
    assert res['stats']['Salud']['total'] == 1
    assert res['sin_clasificar'] == 1 and res['clasificadas'] == 2
    assert res['insights']['top_category'] in ('Economia', 'Salud')

    url = f"/api/interno/descargas/classified/{res['descarga']['id']}?nombre=Clasificado.csv"
    descarga = client.get(url, headers=_h(usuarios['ana']))
    assert descarga.status_code == 200
    assert 'Clasificado.csv' in descarga.headers['Content-Disposition']
    assert 'Categoria' in descarga.data.decode('utf-16')
    # Lo de otro no existe para ti.
    assert client.get(url, headers=_h(usuarios['beto'])).status_code == 404
    assert client.get(url, headers=_h(usuarios['admin'])).status_code == 200
    assert client.get(f'/api/interno/trabajos/{tid}', headers=_h(usuarios['beto'])).status_code == 404


def test_clasificar_sin_reglas_o_con_columna_que_no_existe(client, usuarios):
    r = client.post('/api/interno/clasificacion', headers=_h(usuarios['ana']),
                    data={'archivo': (io.BytesIO(_utf16(MENCIONES)), 'm.csv'), 'reglas': '[]'},
                    content_type='multipart/form-data')
    assert r.status_code == 400
    r = client.post('/api/interno/clasificacion', headers=_h(usuarios['ana']),
                    data={'archivo': (io.BytesIO(_utf16(MENCIONES)), 'm.csv'), 'reglas': REGLAS,
                          'columna_texto': 'Texto'},
                    content_type='multipart/form-data')
    _tid, estado = _trabajo(client, usuarios['ana'], r)
    assert estado['estado'] == 'fallido'
    assert 'Texto' in estado['error']


def test_un_tipo_de_archivo_no_admitido_se_rechaza(client, usuarios):
    r = client.post('/api/interno/analisis', headers=_h(usuarios['ana']),
                    data={'archivo': (io.BytesIO(b'x'), 'foto.png')}, content_type='multipart/form-data')
    assert r.status_code == 400
    assert '.csv' in r.get_json()['error']


def test_el_limite_de_tamano_se_aplica_antes_de_leer(client, usuarios, monkeypatch):
    monkeypatch.setitem(interno.LIMITES, 'csv_analysis', 50)
    r = client.post('/api/interno/analisis', headers=_h(usuarios['ana']),
                    data={'archivo': (io.BytesIO(b'a,b\n' * 100), 'x.csv')}, content_type='multipart/form-data')
    assert r.status_code == 413
    assert 'MB' in r.get_json()['error']


def test_unir_por_defecto_y_avanzado(client, usuarios):
    a = 'Nombre,Edad\nAna,30\nBeto,40\n'.encode('utf-8')
    b = 'Nombre;Edad\nCarla;22\n'.encode('latin-1')
    r = client.post('/api/interno/union', headers=_h(usuarios['ana']),
                    data={'archivos': [(io.BytesIO(a), 'a.csv'), (io.BytesIO(b), 'b.csv')]},
                    content_type='multipart/form-data')
    _tid, estado = _trabajo(client, usuarios['ana'], r)
    assert estado['estado'] == 'hecho', estado
    assert estado['resultado']['total_filas'] == 3
    assert estado['resultado']['filas_por_archivo'] == [{'nombre': 'a.csv', 'filas': 2}, {'nombre': 'b.csv', 'filas': 1}]

    c = 'Persona,Años\nDani,50\n'.encode('utf-8')
    r = client.post('/api/interno/union', headers=_h(usuarios['ana']),
                    data={'modo': 'avanzado', 'archivo_a': (io.BytesIO(a), 'a.csv'),
                          'archivo_b': (io.BytesIO(c), 'c.csv'),
                          'mapeo': json.dumps({'Persona': 'Nombre'}),
                          'columnas_extra': json.dumps([{'name': 'Origen', 'value': 'encuesta'}])},
                    content_type='multipart/form-data')
    _tid, estado = _trabajo(client, usuarios['ana'], r)
    assert estado['estado'] == 'hecho', estado
    assert estado['resultado']['columnas'] == ['Nombre', 'Edad', 'Origen']


def test_unir_con_un_solo_archivo_es_400(client, usuarios):
    r = client.post('/api/interno/union', headers=_h(usuarios['ana']),
                    data={'archivos': [(io.BytesIO(b'a,b\n1,2\n'), 'a.csv')]}, content_type='multipart/form-data')
    assert r.status_code == 400


def test_analizar_detecta_el_formato_que_flask_obligaba_a_elegir(client, usuarios):
    """Flask analizaba como UTF-8 con comas salvo que el usuario dijera otra cosa."""
    crudo = _utf16('Fuente\tAlcance\tLikes\nTwitter\t10\t1\nFacebook\t20\t3\nTwitter\t30\t2\n')
    r = client.post('/api/interno/analisis', headers=_h(usuarios['ana']),
                    data={'archivo': (io.BytesIO(crudo), 'datos.csv')}, content_type='multipart/form-data')
    _tid, estado = _trabajo(client, usuarios['ana'], r)
    assert estado['estado'] == 'hecho', estado
    res = estado['resultado']
    assert res['general']['row_count'] == 3
    assert res['general']['numeric_columns'] == ['Alcance', 'Likes']
    assert res['distributions']['categorical'][0]['labels'][0] == 'Twitter'
    descarga = client.get(f"/api/interno/descargas/csv_summary/{res['descarga']['id']}", headers=_h(usuarios['ana']))
    assert descarga.status_code == 200
    # Se puede descargar otra vez: Flask lo borraba en la primera descarga.
    assert client.get(f"/api/interno/descargas/csv_summary/{res['descarga']['id']}", headers=_h(usuarios['ana'])).status_code == 200


def test_las_rutas_flask_de_siempre_siguen_vivas(client, usuarios):
    with client.session_transaction() as s:
        s['_user_id'] = str(usuarios['ana'])
        s['_fresh'] = True
    assert client.get('/analisis-csv').status_code == 200
    assert client.get('/union').status_code == 200
    assert client.get('/mis-reportes').status_code == 200


# ─────────────────────────────────────────────────────────────
# El registro de trabajos: hilos, cancelacion y varios workers
# ─────────────────────────────────────────────────────────────

def _esperar(registro, tid, estados, limite=10):
    fin = time.time() + limite
    while time.time() < fin:
        datos = registro.obtener(tid)
        if datos and datos['estado'] in estados:
            return datos
        time.sleep(0.02)
    raise AssertionError(f'el trabajo no llego a {estados}: {registro.obtener(tid)}')


def test_un_trabajo_en_un_hilo_se_cancela_y_limpia_su_carpeta(client, usuarios, tmp_path):
    registro = trabajos_svc.Registro(str(tmp_path), max_workers=1)
    empezo = threading.Event()

    def lento(t):
        empezo.set()
        for i in range(500):
            t.avisar('calculo', i / 5, f'paso {i}')
            time.sleep(0.01)
        return {'nunca': True}

    t = registro.crear('analisis', usuarios['ana'])
    open(os.path.join(t.entrada, 'subida.csv'), 'w').write('x')
    registro.lanzar(t, lento, app_module.app)
    assert empezo.wait(5)
    _esperar(registro, t.id, {'en_curso'})
    assert registro.cancelar(t.id) is True
    datos = _esperar(registro, t.id, {'cancelado'})
    assert datos['resultado'] is None
    assert not os.path.exists(t.entrada)


def test_un_trabajo_en_cola_cancelado_no_llega_a_empezar(client, usuarios, tmp_path):
    registro = trabajos_svc.Registro(str(tmp_path), max_workers=1)
    soltar = threading.Event()
    corrio = []

    def bloquea(t):
        soltar.wait(5)
        return {}

    primero = registro.crear('analisis', usuarios['ana'])
    segundo = registro.crear('analisis', usuarios['ana'])
    registro.lanzar(primero, bloquea, app_module.app)
    registro.lanzar(segundo, lambda t: corrio.append(1), app_module.app)
    registro.cancelar(segundo.id)
    soltar.set()
    _esperar(registro, primero.id, {'hecho'})
    assert registro.obtener(segundo.id)['estado'] == 'cancelado'
    assert corrio == []


def test_otro_worker_lee_el_estado_y_cancela_por_disco(client, usuarios, tmp_path):
    """Con varios workers de Gunicorn, el sondeo puede caer en otro proceso."""
    lanzador = trabajos_svc.Registro(str(tmp_path), max_workers=1)
    vecino = trabajos_svc.Registro(str(tmp_path), max_workers=1)

    def lento(t):
        for i in range(500):
            t.avisar('calculo', i / 5)
            time.sleep(0.01)

    t = lanzador.crear('union', usuarios['ana'])
    lanzador.lanzar(t, lento, app_module.app)
    _esperar(lanzador, t.id, {'en_curso'})
    visto = vecino.obtener(t.id)
    assert visto['user_id'] == usuarios['ana'] and visto['tipo'] == 'union'
    assert vecino.cancelar(t.id) is True
    assert _esperar(vecino, t.id, {'cancelado'})['estado'] == 'cancelado'


def test_un_error_inesperado_no_filtra_detalles_internos(client, usuarios, tmp_path):
    registro = trabajos_svc.Registro(str(tmp_path))

    def revienta(t):
        raise RuntimeError('/ruta/secreta/del/servidor')

    t = registro.crear('analisis', usuarios['ana'])
    registro.lanzar(t, revienta, app_module.app, sincrono=True)
    datos = registro.obtener(t.id)
    assert datos['estado'] == 'fallido'
    assert 'secreta' not in datos['error']


def test_hay_un_maximo_de_procesos_a_la_vez_por_persona(client, usuarios, monkeypatch):
    reg = interno.registro()
    monkeypatch.setattr(reg, 'max_por_usuario', 1)
    bloqueado = reg.crear('analisis', usuarios['ana'])
    try:
        r = client.post('/api/interno/analisis', headers=_h(usuarios['ana']),
                        data={'archivo': (io.BytesIO(b'a,b\n1,2\n'), 'x.csv')}, content_type='multipart/form-data')
        assert r.status_code == 429
    finally:
        bloqueado.estado = trabajos_svc.CANCELADO
        bloqueado.terminado = time.time()


def test_la_purga_olvida_los_trabajos_viejos(client, usuarios, tmp_path):
    registro = trabajos_svc.Registro(str(tmp_path))
    t = registro.crear('analisis', usuarios['ana'])
    registro.lanzar(t, lambda t: {}, app_module.app, sincrono=True)
    registro.purgar(ahora=time.time() + trabajos_svc.RETENCION_S + 1)
    assert registro.obtener(t.id) is None
    assert not os.path.exists(t.carpeta)


def test_un_id_de_trabajo_raro_no_toca_el_disco(client, usuarios):
    assert client.get('/api/interno/trabajos/..%2F..%2Fetc', headers=_h(usuarios['ana'])).status_code == 404
    assert interno.registro().obtener('../../etc/passwd') is None


def test_el_artefacto_queda_a_nombre_de_quien_lanzo_el_trabajo(client, usuarios):
    r = client.post('/api/interno/analisis', headers=_h(usuarios['beto']),
                    data={'archivo': (io.BytesIO(b'a,b\n1,2\n3,4\n'), 'x.csv')}, content_type='multipart/form-data')
    _tid, estado = _trabajo(client, usuarios['beto'], r)
    with app_module.app.app_context():
        art = TempArtifact.query.filter_by(kind='csv_summary', file_id=estado['resultado']['descarga']['id']).first()
        assert art.user_id == usuarios['beto']
