"""
Regresiones de la bandeja de tareas.

La bandeja lee /api/tasks con chips de alcance (mias, creadas por mi) y pide
contadores por fila (checklist, comentarios, observacion). Cada prueba fija un
contrato que la interfaz da por hecho: si se rompe, la bandeja muestra tareas
que no tocan, numeros falsos o un "Deshacer" que choca consigo mismo.
"""
import os
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import event
from werkzeug.security import generate_password_hash

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_bandeja.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402
from models import (User, Area, Task, TaskComment, TaskWatcher,  # noqa: E402
                    TaskChecklistItem)
from services.clock import today_local  # noqa: E402


CAMPOS_DE_CONTEO = ('checklist_total', 'checklist_done', 'comments_count',
                    'is_watching', 'can_watch')


def _login_as(client, user_id):
    with client.session_transaction() as session:
        session['_user_id'] = str(user_id)
        session['_fresh'] = True


def _usuario(username, area_id, admin=False):
    user = User(
        username=username,
        email=f'{username}@ejemplo.com',
        password=generate_password_hash('clave-de-prueba', method='scrypt'),
        role='director' if admin else 'analista', es_admin=admin,
        is_active=True,
        area_id=area_id,
    )
    user.set_allowed_tools(['tasks'])
    db.session.add(user)
    db.session.commit()
    return user


def _tarea(title, area, creator_id, assignee_id, due_date=None, **extra):
    tarea = Task(
        title=title,
        due_date=due_date or (today_local() + timedelta(days=10)),
        area=area.name,
        area_id=area.id,
        creator_id=creator_id,
        assignee_id=assignee_id,
        **extra,
    )
    db.session.add(tarea)
    db.session.commit()
    return tarea


@pytest.fixture
def client():
    app = app_module.app
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False, ALLOW_SELF_REGISTRATION=False)
    with app.app_context():
        db.drop_all()
        db.create_all()
    with app.test_client() as test_client:
        yield test_client


@pytest.fixture
def escenario(client):
    """Dos unidades. En Alpha trabajan empleado y companero; en Beta, ajeno.

    Las tareas de Beta tocan al empleado de dos formas (la creo el, o la
    observa) para comprobar que ninguna de las dos le abre la bandeja.
    """
    with app_module.app.app_context():
        alpha = Area(name='Alpha')
        beta = Area(name='Beta')
        db.session.add_all([alpha, beta])
        db.session.commit()

        empleado = _usuario('empleado', alpha.id)
        companero = _usuario('companero', alpha.id)
        ajeno = _usuario('ajeno', beta.id)

        ayer = today_local() - timedelta(days=1)
        mia = _tarea('Informe mensual', alpha, companero.id, empleado.id,
                     due_date=ayer, description='Detalle original',
                     client='Cliente X', priority='Alta')
        creada = _tarea('Revision de prensa', alpha, empleado.id, companero.id,
                        due_date=ayer)
        otra = _tarea('Tarea del companero', alpha, companero.id, companero.id)
        ajena_creada = _tarea('Encargo a Beta', beta, empleado.id, ajeno.id)
        ajena_observada = _tarea('Tarea compartida de Beta', beta, ajeno.id, ajeno.id,
                                 visibility='shared')
        db.session.add(TaskWatcher(task_id=ajena_observada.id, user_id=empleado.id,
                                   added_by_id=ajeno.id))

        # Contadores de 'mia': 3 items (2 hechos), 2 comentarios (1 borrado),
        # y el empleado la observa.
        db.session.add_all([
            TaskChecklistItem(task_id=mia.id, body='a', position=0, is_completed=True),
            TaskChecklistItem(task_id=mia.id, body='b', position=1, is_completed=True),
            TaskChecklistItem(task_id=mia.id, body='c', position=2, is_completed=False),
            TaskComment(task_id=mia.id, user_id=companero.id, body='vivo'),
            TaskComment(task_id=mia.id, user_id=companero.id, body='borrado',
                        deleted_at=datetime.utcnow()),
            TaskWatcher(task_id=mia.id, user_id=empleado.id, added_by_id=empleado.id),
        ])
        # Ruido en Beta: si se colara en los conteos, se notaria.
        db.session.add_all([
            TaskComment(task_id=ajena_observada.id, user_id=ajeno.id, body='x'),
            TaskChecklistItem(task_id=ajena_observada.id, body='x', position=0,
                              is_completed=True),
        ])
        db.session.commit()

        return {
            'alpha_id': alpha.id, 'beta_id': beta.id,
            'empleado_id': empleado.id, 'companero_id': companero.id,
            'ajeno_id': ajeno.id,
            'mia': mia.id, 'creada': creada.id, 'otra': otra.id,
            'ajena_creada': ajena_creada.id, 'ajena_observada': ajena_observada.id,
        }


def _ids(respuesta):
    assert respuesta.status_code == 200, respuesta.get_data(as_text=True)
    return {t['id'] for t in respuesta.get_json()}


# ─────────────────────────────────────────────────────────────
# Alcance de la bandeja (scope)
# ─────────────────────────────────────────────────────────────

def test_scope_mine_solo_trae_lo_asignado(client, escenario):
    """El chip "Mias" es lo que uno tiene que hacer: lo asignado, no lo que
    ve de la unidad."""
    _login_as(client, escenario['empleado_id'])
    assert _ids(client.get('/api/tasks?scope=mine')) == {escenario['mia']}


def test_scope_created_solo_trae_lo_creado(client, escenario):
    """El chip "Creadas por mi" sirve para seguir lo que uno encargo; mezclar
    lo asignado lo deja sin sentido."""
    _login_as(client, escenario['empleado_id'])
    assert _ids(client.get('/api/tasks?scope=created')) == {escenario['creada']}


@pytest.mark.parametrize('sufijo', ['', '?scope=unit', '?scope=todo', '?scope='])
def test_scope_unit_ausente_o_desconocido_es_la_unidad(client, escenario, sufijo):
    """Un valor que el servidor no conoce no puede vaciar la bandeja ni
    ampliarla: cae en el comportamiento sin chip."""
    _login_as(client, escenario['empleado_id'])
    esperadas = {escenario['mia'], escenario['creada'], escenario['otra']}
    assert _ids(client.get(f'/api/tasks{sufijo}')) == esperadas


@pytest.mark.parametrize('scope', ['', 'mine', 'created', 'unit', 'todo'])
def test_scope_nunca_amplia_visibilidad(client, escenario, scope):
    """Los chips se aplican despues del filtro de unidad. Haber creado una
    tarea de otra unidad no da derecho a verla en la lista (_apply_unit_scope
    solo mira area_id y asignado), y observarla tampoco: la lista de
    observadas tiene su propia ruta."""
    _login_as(client, escenario['empleado_id'])
    ids = _ids(client.get(f'/api/tasks?scope={scope}'))
    assert escenario['ajena_creada'] not in ids
    assert escenario['ajena_observada'] not in ids


def test_scope_se_combina_con_q(client, escenario):
    """La busqueda dentro de un chip debe estrechar el chip, no reemplazarlo."""
    _login_as(client, escenario['empleado_id'])
    assert _ids(client.get('/api/tasks?scope=mine&q=Informe')) == {escenario['mia']}
    assert _ids(client.get('/api/tasks?scope=mine&q=Revision')) == set()
    assert _ids(client.get('/api/tasks?scope=created&q=Revision')) == {escenario['creada']}


def test_scope_se_combina_con_vencidas(client, escenario):
    """'mia' y 'creada' vencen ayer; con el chip solo debe quedar la del chip."""
    _login_as(client, escenario['empleado_id'])
    assert _ids(client.get('/api/tasks?scope=mine&overdue=1')) == {escenario['mia']}
    assert _ids(client.get('/api/tasks?scope=created&overdue=1')) == {escenario['creada']}
    assert _ids(client.get('/api/tasks?overdue=1')) == {escenario['mia'], escenario['creada']}


def test_scope_se_combina_con_rango_de_fechas(client, escenario):
    """El calendario y la bandeja comparten feed: el rango sigue mandando."""
    _login_as(client, escenario['empleado_id'])
    ayer = (today_local() - timedelta(days=1)).isoformat()
    futuro = (today_local() + timedelta(days=5)).isoformat()
    lejos = (today_local() + timedelta(days=30)).isoformat()

    assert _ids(client.get(f'/api/tasks?scope=mine&start={ayer}&end={ayer}')) == {escenario['mia']}
    assert _ids(client.get(f'/api/tasks?scope=mine&start={futuro}&end={lejos}')) == set()
    assert _ids(client.get(f'/api/tasks?start={futuro}&end={lejos}')) == {escenario['otra']}


# ─────────────────────────────────────────────────────────────
# Contadores por fila (counts=1)
# ─────────────────────────────────────────────────────────────

def test_sin_counts_la_respuesta_no_cambia(client, escenario):
    """El calendario consume la lista plana; anadir claves o envolverla en un
    objeto lo romperia y le costaria consultas que no usa."""
    _login_as(client, escenario['empleado_id'])
    datos = client.get('/api/tasks').get_json()
    assert isinstance(datos, list) and datos
    for tarea in datos:
        for campo in CAMPOS_DE_CONTEO:
            assert campo not in tarea


def test_counts_trae_los_valores_correctos(client, escenario):
    """Los numeros de cada fila: el comentario borrado no cuenta, y una tarea
    sin nada debe dar ceros, no faltar las claves."""
    _login_as(client, escenario['empleado_id'])
    datos = client.get('/api/tasks?counts=1').get_json()
    assert isinstance(datos, list)
    por_id = {t['id']: t for t in datos}

    mia = por_id[escenario['mia']]
    assert mia['checklist_total'] == 3
    assert mia['checklist_done'] == 2
    assert mia['comments_count'] == 1
    assert mia['is_watching'] is True
    assert mia['can_watch'] is True

    otra = por_id[escenario['otra']]
    assert otra['checklist_total'] == 0
    assert otra['checklist_done'] == 0
    assert otra['comments_count'] == 0
    assert otra['is_watching'] is False
    assert otra['can_watch'] is True


def test_counts_no_filtra_tareas_ajenas(client, escenario):
    """Pedir contadores no puede colar filas: solo se cuentan los ids que ya
    pasaron por el alcance, y son exactamente los mismos que sin counts."""
    _login_as(client, escenario['empleado_id'])
    con = _ids(client.get('/api/tasks?counts=1'))
    sin = _ids(client.get('/api/tasks'))
    assert con == sin == {escenario['mia'], escenario['creada'], escenario['otra']}


def test_counts_no_hace_n_mas_uno(client, escenario):
    """Resolver los contadores tarea a tarea multiplicaria las consultas por
    fila (FUN-04). El numero de sentencias no puede crecer con las tareas."""
    def contar_consultas():
        sentencias = []

        def anotar(conn, cursor, statement, parameters, context, executemany):
            sentencias.append(statement)

        with app_module.app.app_context():
            engine = db.engine
        event.listen(engine, 'before_cursor_execute', anotar)
        try:
            respuesta = client.get('/api/tasks?counts=1')
        finally:
            event.remove(engine, 'before_cursor_execute', anotar)
        assert respuesta.status_code == 200
        return len(respuesta.get_json()), len(sentencias)

    def sembrar(cuantas):
        with app_module.app.app_context():
            alpha = db.session.get(Area, escenario['alpha_id'])
            for i in range(cuantas):
                t = _tarea(f'Relleno {i}', alpha, escenario['companero_id'],
                           escenario['empleado_id'])
                db.session.add_all([
                    TaskChecklistItem(task_id=t.id, body='x', position=0, is_completed=True),
                    TaskComment(task_id=t.id, user_id=escenario['companero_id'], body='x'),
                ])
            db.session.commit()

    _login_as(client, escenario['empleado_id'])
    filas_pocas, consultas_pocas = contar_consultas()
    sembrar(12)
    filas_muchas, consultas_muchas = contar_consultas()

    assert filas_pocas == 3 and filas_muchas == 15
    assert consultas_muchas <= consultas_pocas + 1, (consultas_pocas, consultas_muchas)


# ─────────────────────────────────────────────────────────────
# Detalle (GET /api/tasks/<id>)
# ─────────────────────────────────────────────────────────────

def test_detalle_trae_los_mismos_contadores(client, escenario):
    """El panel lateral pinta la fila y el detalle con una sola forma de
    datos; si el detalle no trae los contadores la fila se queda en blanco."""
    _login_as(client, escenario['empleado_id'])
    respuesta = client.get(f'/api/tasks/{escenario["mia"]}')
    assert respuesta.status_code == 200
    tarea = respuesta.get_json()['task']
    assert tarea['checklist_total'] == 3
    assert tarea['checklist_done'] == 2
    assert tarea['comments_count'] == 1
    assert tarea['is_watching'] is True
    assert tarea['can_watch'] is True


def test_detalle_de_otra_unidad_es_403(client, escenario):
    """Conocer el id no basta para leer una tarea de otra unidad."""
    _login_as(client, escenario['empleado_id'])
    assert client.get(f'/api/tasks/{escenario["ajena_creada"]}').status_code == 403


def test_detalle_inexistente_o_borrado_es_404(client, escenario):
    """Una tarea borrada no debe reaparecer por el detalle aunque siga en la
    tabla."""
    with app_module.app.app_context():
        tarea = db.session.get(Task, escenario['otra'])
        tarea.soft_delete(escenario['companero_id'])
        db.session.commit()

    _login_as(client, escenario['empleado_id'])
    assert client.get('/api/tasks/999999').status_code == 404
    assert client.get(f'/api/tasks/{escenario["otra"]}').status_code == 404


# ─────────────────────────────────────────────────────────────
# Edicion parcial (PUT /api/tasks/<id>)
# ─────────────────────────────────────────────────────────────

def _estado_completo(client, task_id):
    tarea = client.get(f'/api/tasks/{task_id}').get_json()['task']
    return {k: tarea[k] for k in ('title', 'description', 'client', 'due_date',
                                  'assignee_id', 'priority', 'status')}


def test_put_solo_status_no_toca_lo_demas(client, escenario):
    """Los botones rapidos de la bandeja mandan solo el campo que cambian.
    Si el servidor rellenara el resto con vacios, borraria la tarea."""
    _login_as(client, escenario['empleado_id'])
    antes = _estado_completo(client, escenario['mia'])

    respuesta = client.put(f'/api/tasks/{escenario["mia"]}', json={'status': 'En Progreso'})
    assert respuesta.status_code == 200, respuesta.get_data(as_text=True)

    despues = _estado_completo(client, escenario['mia'])
    assert despues.pop('status') == 'En Progreso'
    antes.pop('status')
    assert despues == antes


def test_put_solo_prioridad_no_toca_lo_demas(client, escenario):
    """Mismo contrato para el selector de prioridad de la fila."""
    _login_as(client, escenario['empleado_id'])
    antes = _estado_completo(client, escenario['mia'])

    respuesta = client.put(f'/api/tasks/{escenario["mia"]}', json={'priority': 'Baja'})
    assert respuesta.status_code == 200, respuesta.get_data(as_text=True)

    despues = _estado_completo(client, escenario['mia'])
    assert despues.pop('priority') == 'Baja'
    antes.pop('priority')
    assert despues == antes


def test_put_con_version_vieja_es_409(client, escenario):
    """Si otro cambio la tarea, la bandeja recibe la version actual para
    repintar la fila en lugar de pisar el cambio ajeno."""
    _login_as(client, escenario['empleado_id'])
    respuesta = client.put(f'/api/tasks/{escenario["mia"]}', json={
        'status': 'Completado', 'expected_updated_at': '2000-01-01T00:00:00',
    })
    assert respuesta.status_code == 409
    datos = respuesta.get_json()
    assert datos['task']['id'] == escenario['mia']
    assert datos['task']['status'] == 'Pendiente'


def test_deshacer_encadenado_con_updated_at(client, escenario):
    """"Deshacer" reenvia el valor anterior con el updated_at que devolvio el
    cambio. Si ese updated_at no coincidiera con el guardado, el propio
    deshacer chocaria con un 409 contra si mismo."""
    _login_as(client, escenario['empleado_id'])
    inicial = client.get(f'/api/tasks/{escenario["mia"]}').get_json()['task']

    cambio = client.put(f'/api/tasks/{escenario["mia"]}', json={
        'status': 'Completado', 'expected_updated_at': inicial['updated_at'],
    })
    assert cambio.status_code == 200, cambio.get_data(as_text=True)
    version = cambio.get_json()['task']['updated_at']

    deshacer = client.put(f'/api/tasks/{escenario["mia"]}', json={
        'status': inicial['status'], 'expected_updated_at': version,
    })
    assert deshacer.status_code == 200, deshacer.get_data(as_text=True)
    assert deshacer.get_json()['task']['status'] == inicial['status']

    # Y rehacer sobre el deshacer tambien encadena.
    rehacer = client.put(f'/api/tasks/{escenario["mia"]}', json={
        'status': 'Completado',
        'expected_updated_at': deshacer.get_json()['task']['updated_at'],
    })
    assert rehacer.status_code == 200, rehacer.get_data(as_text=True)


def test_put_con_cuerpo_null_no_cambia_nada(client, escenario):
    """Un cuerpo 'null' respondia 500; es una edicion sin cambios."""
    _login_as(client, escenario['empleado_id'])
    antes = _estado_completo(client, escenario['mia'])

    respuesta = client.put(f'/api/tasks/{escenario["mia"]}', data='null',
                           content_type='application/json')
    assert respuesta.status_code == 200, respuesta.get_data(as_text=True)
    assert _estado_completo(client, escenario['mia']) == antes


def test_put_prioridad_invalida_es_400(client, escenario):
    """Una prioridad fuera del catalogo no puede guardarse en silencio."""
    _login_as(client, escenario['empleado_id'])
    respuesta = client.put(f'/api/tasks/{escenario["mia"]}', json={'priority': 'Urgentisima'})
    assert respuesta.status_code == 400
    assert _estado_completo(client, escenario['mia'])['priority'] == 'Alta'


def test_put_sin_permiso_de_edicion_es_403(client, escenario):
    """Quien no es de la unidad no edita, aunque la tarea sea visible para
    el por observarla."""
    _login_as(client, escenario['ajeno_id'])
    respuesta = client.put(f'/api/tasks/{escenario["mia"]}', json={'status': 'Completado'})
    assert respuesta.status_code == 403

    _login_as(client, escenario['empleado_id'])
    respuesta = client.put(f'/api/tasks/{escenario["ajena_observada"]}',
                           json={'status': 'Completado'})
    assert respuesta.status_code == 403


# ─────────────────────────────────────────────────────────────
# Observarse uno mismo desde la bandeja
# ─────────────────────────────────────────────────────────────

def test_observar_y_dejar_de_observar_uno_mismo(client, escenario):
    """El boton de la fila alterna la observacion propia; la lista con
    counts debe reflejarlo y salir dos veces debe dar 404, no 200."""
    _login_as(client, escenario['empleado_id'])
    tid, uid = escenario['otra'], escenario['empleado_id']

    entrar = client.post(f'/api/tasks/{tid}/watchers', json={'user_id': uid})
    assert entrar.status_code == 200, entrar.get_data(as_text=True)

    por_id = {t['id']: t for t in client.get('/api/tasks?counts=1').get_json()}
    assert por_id[tid]['is_watching'] is True

    assert client.delete(f'/api/tasks/{tid}/watchers/{uid}').status_code == 200
    por_id = {t['id']: t for t in client.get('/api/tasks?counts=1').get_json()}
    assert por_id[tid]['is_watching'] is False

    assert client.delete(f'/api/tasks/{tid}/watchers/{uid}').status_code == 404


def test_observar_dos_veces_deja_una_fila(client, escenario):
    """Un doble clic no puede duplicar la observacion ni romper la
    restriccion unica."""
    _login_as(client, escenario['empleado_id'])
    tid, uid = escenario['otra'], escenario['empleado_id']

    assert client.post(f'/api/tasks/{tid}/watchers', json={'user_id': uid}).status_code == 200
    assert client.post(f'/api/tasks/{tid}/watchers', json={'user_id': uid}).status_code == 200

    with app_module.app.app_context():
        assert TaskWatcher.query.filter_by(task_id=tid, user_id=uid).count() == 1


# ─────────────────────────────────────────────────────────────
# Revision de seguridad: fechas de comentarios, cuerpos raros y fugas
# ─────────────────────────────────────────────────────────────

def test_comentario_se_fecha_en_hora_de_negocio(client, escenario):
    """created_at se guarda en UTC y la bandeja lo compara con el 'hoy' local.
    Un comentario de las 22:30 en Santo Domingo ya es el dia siguiente en UTC
    y salia fechado manana."""
    from datetime import timezone
    from services.clock import APP_TIMEZONE

    # 02:30 UTC: en la zona por defecto (UTC-4) aun es la noche anterior.
    instante_utc = datetime(2026, 10, 6, 2, 30)
    esperado = instante_utc.replace(tzinfo=timezone.utc).astimezone(APP_TIMEZONE)
    with app_module.app.app_context():
        comentario = TaskComment(task_id=escenario['mia'], user_id=escenario['companero_id'],
                                 body='tarde', created_at=instante_utc)
        db.session.add(comentario)
        db.session.commit()
        comentario_id = comentario.id

    _login_as(client, escenario['empleado_id'])
    respuesta = client.get(f'/api/tasks/{escenario["mia"]}/comments')
    assert respuesta.status_code == 200
    por_id = {c['id']: c for c in respuesta.get_json()['comments']}
    assert por_id[comentario_id]['created_at'] == esperado.strftime('%Y-%m-%d %H:%M')
    if APP_TIMEZONE.utcoffset(instante_utc) < timedelta(0):
        assert por_id[comentario_id]['created_at'].startswith('2026-10-05')


def test_put_con_cuerpo_lista_no_cambia_nada(client, escenario):
    """Un cuerpo que no es objeto (lista, texto, numero) llegaba a data.get y
    respondia 500; se trata como una edicion sin cambios, igual que 'null'."""
    _login_as(client, escenario['empleado_id'])
    antes = _estado_completo(client, escenario['mia'])

    for cuerpo in ('["status", "Completado"]', '"Completado"', '7'):
        respuesta = client.put(f'/api/tasks/{escenario["mia"]}', data=cuerpo,
                               content_type='application/json')
        assert respuesta.status_code == 200, respuesta.get_data(as_text=True)
    assert _estado_completo(client, escenario['mia']) == antes


def test_quitar_observador_ajeno_no_revela_si_existe(client, escenario):
    """Quien no puede editar la tarea recibe el mismo codigo exista o no la
    fila: con el orden anterior, 404 frente a 403 decia si alguien observa."""
    _login_as(client, escenario['ajeno_id'])
    tid = escenario['mia']
    observa = client.delete(f'/api/tasks/{tid}/watchers/{escenario["empleado_id"]}')
    no_observa = client.delete(f'/api/tasks/{tid}/watchers/{escenario["companero_id"]}')

    assert observa.status_code == no_observa.status_code == 403
    with app_module.app.app_context():
        assert TaskWatcher.query.filter_by(task_id=tid, user_id=escenario['empleado_id']).count() == 1


def test_salir_uno_mismo_de_tarea_solo_observada(client, escenario):
    """Salir uno mismo sigue sin pedir edicion, y avisa de que la tarea deja
    de verse para que el panel se cierre."""
    _login_as(client, escenario['empleado_id'])
    respuesta = client.delete(
        f'/api/tasks/{escenario["ajena_observada"]}/watchers/{escenario["empleado_id"]}')
    assert respuesta.status_code == 200, respuesta.get_data(as_text=True)
    assert respuesta.get_json()['can_still_view'] is False
