"""
El reporte guardado: su URL, sus permisos, sus retoques y sus textos de IA.

Lo que se prueba aqui es lo que hace que el trabajo del analista deje de vivir
en una sola pestana. El renderizado y el PDF son del navegador; esto es lo
unico que toca datos.
"""
import json
import os

import pytest
from werkzeug.security import generate_password_hash

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_reportes.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402
from models import Report, User  # noqa: E402


def _login_as(client, user_id):
    with client.session_transaction() as session:
        session['_user_id'] = str(user_id)
        session['_fresh'] = True


@pytest.fixture
def client():
    app = app_module.app
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    # El limite por hora de /insights estorba a las pruebas, no las protege.
    app_module.limiter.enabled = False
    with app.app_context():
        db.drop_all()
        db.create_all()
    with app.test_client() as test_client:
        yield test_client
    app_module.limiter.enabled = True


def _usuario(nombre, herramientas=('reports',)):
    user = User(
        username=nombre,
        email=f'{nombre}@ejemplo.com',
        password=generate_password_hash('clave-de-prueba', method='scrypt'),
        role='analista',
        is_active=True,
    )
    user.set_allowed_tools(list(herramientas))
    db.session.add(user)
    db.session.commit()
    return user.id


CONTEXTO = {
    'meta': {'client_name': 'Cliente', 'date_generated': '26 de agosto de 2026'},
    'kpis': {'total_mentions': 1000, 'mentions_redes': 600, 'mentions_prensa': 400,
             'estimated_reach': 5000, 'estimated_reach_fmt': '5.0 k',
             'mentions_change_pct': -13.6, 'reach_change_pct': 2.0},
    'charts': {'evolution': {'labels': ['1 ene', '7 ene'], 'mentions': [500, 500]},
               'reach_evolution': {'labels': ['1 ene', '7 ene'], 'reach': [2500, 2500]},
               'sentiment': [], 'emotions': [], 'sentiment_by_source': []},
    'content': {'clusters': [], 'hashtags': [], 'keywords': [], 'top_authors': []},
    'narrative': {'overview': '', 'sentiment_summary': '', 'topics_summary': '', 'closing': ''},
    'insights': {'volume_title': 'Titular por reglas', 'volume_take': 'Texto por reglas'},
    'warnings': [],
}


@pytest.fixture
def usuarios(client):
    with app_module.app.app_context():
        return {'duenyo': _usuario('duenyo'), 'companero': _usuario('companero'),
                'ajeno': _usuario('ajeno', herramientas=())}


@pytest.fixture
def reporte(client, usuarios):
    with app_module.app.app_context():
        guardado = Report(
            token=Report.nuevo_token(),
            title='Cliente',
            user_id=usuarios['duenyo'],
            context_json=json.dumps(CONTEXTO),
            insights_source='reglas',
            insights_status=Report.INSIGHTS_PENDIENTE,
        )
        db.session.add(guardado)
        db.session.commit()
        return guardado.token


# ─────────────────────────────────────────────────────────────
# La URL
# ─────────────────────────────────────────────────────────────

def test_el_reporte_sobrevive_a_la_peticion_que_lo_creo(client, usuarios, reporte):
    """El punto entero del cambio: volver al reporte sin regenerarlo."""
    _login_as(client, usuarios['duenyo'])
    pagina = client.get(f'/reporte/{reporte}')
    assert pagina.status_code == 200
    assert 'Titular por reglas' in pagina.get_data(as_text=True)


def test_aparece_en_mis_reportes(client, usuarios, reporte):
    """Antes esta pantalla estaba vacia para todo el mundo: no se escribia ni una fila."""
    _login_as(client, usuarios['duenyo'])
    pagina = client.get('/mis-reportes').get_data(as_text=True)
    assert f'/reporte/{reporte}' in pagina


def test_un_companero_con_el_enlace_puede_leerlo(client, usuarios, reporte):
    """Pasarle el enlace a alguien es media razon de ser de la URL."""
    _login_as(client, usuarios['companero'])
    assert client.get(f'/reporte/{reporte}').status_code == 200


def test_para_un_companero_los_campos_no_son_editables(client, usuarios, reporte):
    """Dejarlos editables invitaria a escribir algo que el servidor va a rechazar."""
    _login_as(client, usuarios['companero'])
    pagina = client.get(f'/reporte/{reporte}').get_data(as_text=True)
    assert 'PUEDE_EDITAR = false' in pagina

    _login_as(client, usuarios['duenyo'])
    assert 'PUEDE_EDITAR = true' in client.get(f'/reporte/{reporte}').get_data(as_text=True)


def test_sin_acceso_al_modulo_no_se_abre(client, usuarios, reporte):
    """El enlace no es un permiso: sigue haciendo falta el modulo de reportes."""
    _login_as(client, usuarios['ajeno'])
    assert client.get(f'/reporte/{reporte}').status_code in (302, 403)


def test_sin_sesion_no_se_abre(client, reporte):
    respuesta = client.get(f'/reporte/{reporte}', follow_redirects=False)
    assert respuesta.status_code == 302
    assert '/login' in respuesta.headers['Location']


def test_un_token_inventado_es_404(client, usuarios):
    _login_as(client, usuarios['duenyo'])
    assert client.get('/reporte/no-existe-este-token').status_code == 404


# ─────────────────────────────────────────────────────────────
# Los retoques del analista
# ─────────────────────────────────────────────────────────────

def test_los_retoques_se_guardan_y_vuelven(client, usuarios, reporte):
    _login_as(client, usuarios['duenyo'])
    respuesta = client.post(f'/api/reportes/{reporte}/textos',
                            json={'textos': {'volume_title': 'Titular reescrito a mano'}})
    assert respuesta.status_code == 200

    pagina = client.get(f'/reporte/{reporte}').get_data(as_text=True)
    assert 'Titular reescrito a mano' in pagina
    assert 'Titular por reglas' not in pagina


def test_los_retoques_no_pisan_el_contexto_original(client, usuarios, reporte):
    """Se guardan aparte: por eso volver a pedirle texto al modelo no los borra."""
    _login_as(client, usuarios['duenyo'])
    client.post(f'/api/reportes/{reporte}/textos',
                json={'textos': {'volume_title': 'A mano'}})

    with app_module.app.app_context():
        guardado = Report.query.filter_by(token=reporte).first()
        original = json.loads(guardado.context_json)['insights']['volume_title']
        assert original == 'Titular por reglas'
        assert guardado.contexto['insights']['volume_title'] == 'A mano'


def test_un_companero_no_puede_editarlo(client, usuarios, reporte):
    """Leer con el enlace, si; escribir en el reporte de otro, no."""
    _login_as(client, usuarios['companero'])
    respuesta = client.post(f'/api/reportes/{reporte}/textos',
                            json={'textos': {'volume_title': 'Intruso'}})
    assert respuesta.status_code == 403


def test_solo_se_guardan_los_campos_conocidos(client, usuarios, reporte):
    """El cuerpo lo escribe el navegador: no puede sembrar claves arbitrarias."""
    _login_as(client, usuarios['duenyo'])
    client.post(f'/api/reportes/{reporte}/textos',
                json={'textos': {'volume_title': 'Vale', 'is_admin': 'true', 'otro': 'x'}})

    with app_module.app.app_context():
        retoques = json.loads(Report.query.filter_by(token=reporte).first().edits_json)
        assert set(retoques) == {'volume_title'}


# ─────────────────────────────────────────────────────────────
# Los textos del modelo, fuera de la peticion que sirve la pagina
# ─────────────────────────────────────────────────────────────

def test_la_pagina_se_sirve_sin_esperar_al_modelo(client, usuarios, reporte, monkeypatch):
    """Un proveedor colgado no puede costar el reporte.

    Se comprueba que servir la pagina no llama al modelo: antes la generacion
    vivia dentro de la peticion y Gunicorn cortaba a los 180s.
    """
    llamadas = []

    def _no_deberia(*args, **kwargs):
        llamadas.append(1)
        raise AssertionError('servir la página no debe llamar al modelo')

    monkeypatch.setattr('services.insight_harness.generate_insights', _no_deberia)
    _login_as(client, usuarios['duenyo'])
    assert client.get(f'/reporte/{reporte}').status_code == 200
    assert llamadas == []


def test_los_insights_llegan_por_su_propia_peticion(client, usuarios, reporte, monkeypatch):
    generados = {'volume_title': 'Titular del modelo', 'volume_take': 'Texto del modelo'}
    monkeypatch.setattr('services.insight_harness.generate_insights',
                        lambda ctx: (generados, {'ok': True, 'reason': 'ok'}))

    _login_as(client, usuarios['duenyo'])
    datos = client.post(f'/api/reportes/{reporte}/insights').get_json()

    assert datos['success'] is True
    assert datos['insights']['volume_title'] == 'Titular del modelo'

    # Y quedan guardados: recargar no vuelve a pagar la llamada.
    with app_module.app.app_context():
        guardado = Report.query.filter_by(token=reporte).first()
        assert guardado.insights_status == Report.INSIGHTS_LISTO
        assert guardado.insights_source == 'ia'


def test_no_se_paga_dos_veces_por_recargar(client, usuarios, reporte, monkeypatch):
    llamadas = []

    def _contando(ctx):
        llamadas.append(1)
        return {'volume_title': 'Del modelo'}, {'ok': True, 'reason': 'ok'}

    monkeypatch.setattr('services.insight_harness.generate_insights', _contando)
    _login_as(client, usuarios['duenyo'])
    client.post(f'/api/reportes/{reporte}/insights')
    client.post(f'/api/reportes/{reporte}/insights')

    assert len(llamadas) == 1


def test_si_el_modelo_falla_el_reporte_sigue_en_pie(client, usuarios, reporte, monkeypatch):
    """El texto por reglas ya estaba escrito: un fallo de IA no es un fallo del reporte."""
    monkeypatch.setattr('services.insight_harness.generate_insights',
                        lambda ctx: (None, {'ok': False, 'reason': 'error del proveedor: timeout'}))

    _login_as(client, usuarios['duenyo'])
    datos = client.post(f'/api/reportes/{reporte}/insights').get_json()
    assert datos['success'] is False
    assert 'timeout' in datos['error']

    pagina = client.get(f'/reporte/{reporte}').get_data(as_text=True)
    assert 'Titular por reglas' in pagina


def test_el_modelo_no_pisa_lo_que_el_analista_escribio(client, usuarios, reporte, monkeypatch):
    """Si ya lo reescribio a mano, es suyo: el modelo no se lo puede quitar."""
    _login_as(client, usuarios['duenyo'])
    client.post(f'/api/reportes/{reporte}/textos',
                json={'textos': {'volume_title': 'Lo escribí yo'}})

    monkeypatch.setattr(
        'services.insight_harness.generate_insights',
        lambda ctx: ({'volume_title': 'Del modelo', 'volume_take': 'Del modelo'},
                     {'ok': True, 'reason': 'ok'}))

    datos = client.post(f'/api/reportes/{reporte}/insights').get_json()
    assert 'volume_title' not in datos['insights']
    assert datos['insights']['volume_take'] == 'Del modelo'
    assert 'Lo escribí yo' in client.get(f'/reporte/{reporte}').get_data(as_text=True)


def test_un_companero_no_dispara_el_gasto(client, usuarios, reporte):
    """Cada llamada se paga: solo el dueño la provoca."""
    _login_as(client, usuarios['companero'])
    assert client.post(f'/api/reportes/{reporte}/insights').status_code == 403


# ─────────────────────────────────────────────────────────────
# Retencion
# ─────────────────────────────────────────────────────────────

def test_la_poda_no_se_lleva_un_reporte_guardado(client, usuarios):
    """La fila dejo de ser un metadato el dia que paso a ser el reporte.

    La poda existia para limpiar filas que describian un .pptx que ya no
    estaba. Barrer con el mismo criterio ahora borraria el trabajo del
    analista —textos reescritos a mano incluidos— a los 180 dias y sin avisar.
    """
    from datetime import datetime, timedelta

    with app_module.app.app_context():
        viejo = datetime.utcnow() - timedelta(days=400)

        con_contenido = Report(token=Report.nuevo_token(), title='Reporte real',
                               user_id=usuarios['duenyo'], created_at=viejo,
                               context_json=json.dumps(CONTEXTO))
        solo_metadatos = Report(token=Report.nuevo_token(), filename='viejo.zip',
                                user_id=usuarios['duenyo'], created_at=viejo)
        db.session.add_all([con_contenido, solo_metadatos])
        db.session.commit()

        resultado = app_module.prune_report_metadata()

        assert resultado['deleted_rows'] == 1
        quedan = [r.title for r in Report.query.all()]
        assert quedan == ['Reporte real']
