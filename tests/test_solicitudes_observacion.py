"""
Regresiones del modulo de solicitudes y de la observacion de tareas.

Todo lo que hay aqui es un fallo que se dio: cada prueba fija una puerta que
estaba cerrada y que dejaba el modulo inservible para alguien concreto.
"""
import os

import pytest
from werkzeug.security import generate_password_hash

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_solicitudes.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402
from models import User, Area, UnitLead, Task, TaskRequest  # noqa: E402
from datetime import date  # noqa: E402


def _login_as(client, user_id):
    with client.session_transaction() as session:
        session['_user_id'] = str(user_id)
        session['_fresh'] = True


def _usuario(username, area_id, admin=False):
    user = User(
        username=username,
        email=f'{username}@ejemplo.com',
        password=generate_password_hash('clave-de-prueba', method='scrypt'),
        role=('admin' if admin else 'DI'),
        is_active=True,
        area_id=area_id,
    )
    user.set_allowed_tools(['tasks'])
    db.session.add(user)
    db.session.commit()
    return user


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
    """Dos unidades, un empleado en la primera y un lider en la segunda."""
    with app_module.app.app_context():
        origen = Area(name='Alpha')
        destino = Area(name='Beta')
        db.session.add_all([origen, destino])
        db.session.commit()

        empleado = _usuario('empleado', origen.id)
        lider = _usuario('lider', destino.id)
        admin = _usuario('admin', origen.id, admin=True)
        db.session.add(UnitLead(user_id=lider.id, area_id=destino.id))
        db.session.commit()

        return {
            'origen_id': origen.id, 'destino_id': destino.id,
            'empleado_id': empleado.id, 'lider_id': lider.id, 'admin_id': admin.id,
        }


# ─────────────────────────────────────────────────────────────
# Solicitudes
# ─────────────────────────────────────────────────────────────

def test_admin_puede_enviar_solicitud(client, escenario):
    """El alcance de un admin es la empresa entera.

    La regla "no puedes solicitar a una unidad que ya llevas" se resolvia con
    ese alcance, asi que a un admin le cerraba todas las unidades y no podia
    enviar ni una solicitud.
    """
    _login_as(client, escenario['admin_id'])
    respuesta = client.post('/api/task-requests',
                            json={'title': 'Algo', 'to_area_id': escenario['destino_id']})

    assert respuesta.status_code == 201, respuesta.get_data(as_text=True)


def test_unidad_sin_lider_no_bloquea_el_envio(client, escenario):
    """Una unidad sin fila en unit_leads —lo normal en una base recien
    migrada— cortaba el envio con un 400. Ahora la solicitud viaja y la
    resuelve quien administra."""
    with app_module.app.app_context():
        huerfana = Area(name='Sin lider')
        db.session.add(huerfana)
        db.session.commit()
        huerfana_id = huerfana.id

    _login_as(client, escenario['empleado_id'])
    respuesta = client.post('/api/task-requests',
                            json={'title': 'Algo', 'to_area_id': huerfana_id})

    assert respuesta.status_code == 201, respuesta.get_data(as_text=True)


def test_usuario_sin_unidad_puede_solicitar(client, escenario):
    """Quien no tiene unidad asignada quedaba fuera del modulo por un dato de
    administracion que no depende de el."""
    with app_module.app.app_context():
        sin_unidad_id = _usuario('sin_unidad', None).id

    _login_as(client, sin_unidad_id)
    respuesta = client.post('/api/task-requests',
                            json={'title': 'Algo', 'to_area_id': escenario['destino_id']})

    assert respuesta.status_code == 201, respuesta.get_data(as_text=True)


def test_areas_para_solicitud_excluye_las_propias(client, escenario):
    """El desplegable ofrecia todas las unidades, incluida la tuya, y el error
    solo aparecia al pulsar Enviar con el formulario ya relleno."""
    _login_as(client, escenario['empleado_id'])
    respuesta = client.get('/api/areas?destino=solicitud')

    ids = {area['id'] for area in respuesta.get_json()['areas']}
    assert escenario['origen_id'] not in ids
    assert escenario['destino_id'] in ids


def test_enviadas_incluye_las_propias(client, escenario):
    """Filtrar solo por from_area_id dejaba "Enviadas" vacia para quien no
    tiene unidad, justo despues de mandar la solicitud."""
    with app_module.app.app_context():
        sin_unidad_id = _usuario('sin_unidad', None).id

    _login_as(client, sin_unidad_id)
    client.post('/api/task-requests',
                json={'title': 'Mia', 'to_area_id': escenario['destino_id']})

    respuesta = client.get('/api/task-requests?direction=sent')
    titulos = [r['title'] for r in respuesta.get_json()['requests']]
    assert titulos == ['Mia']


def test_asignables_son_los_de_la_unidad_destino(client, escenario):
    """El modal de aceptar llenaba el desplegable con el equipo de quien mira,
    no con el de la unidad destino, y el servidor rechazaba la eleccion."""
    _login_as(client, escenario['empleado_id'])
    creacion = client.post('/api/task-requests',
                           json={'title': 'Algo', 'to_area_id': escenario['destino_id']})
    request_id = creacion.get_json()['request']['id']

    _login_as(client, escenario['lider_id'])
    respuesta = client.get(f'/api/task-requests/{request_id}/assignees')

    nombres = {u['username'] for u in respuesta.get_json()['users']}
    assert nombres == {'lider'}


def test_la_solicitud_notifica_con_su_identificador(client, escenario):
    """Sin flush la solicitud no tenia id todavia y la notificacion guardaba
    entity_id nulo: el aviso no llevaba a ninguna parte."""
    _login_as(client, escenario['empleado_id'])
    creacion = client.post('/api/task-requests',
                           json={'title': 'Algo', 'to_area_id': escenario['destino_id']})
    request_id = creacion.get_json()['request']['id']

    _login_as(client, escenario['lider_id'])
    avisos = client.get('/api/notifications?unread_only=1').get_json()['items']
    recibidas = [n for n in avisos if n['kind'] == 'request_received']

    assert recibidas and recibidas[0]['entity_id'] == request_id


# ─────────────────────────────────────────────────────────────
# Observacion
# ─────────────────────────────────────────────────────────────

@pytest.fixture
def tarea_compartida(client, escenario):
    with app_module.app.app_context():
        tarea = Task(
            title='Tarea de Alpha',
            due_date=date(2026, 9, 1),
            area='Alpha',
            area_id=escenario['origen_id'],
            creator_id=escenario['empleado_id'],
            assignee_id=escenario['empleado_id'],
            visibility='shared',
        )
        db.session.add(tarea)
        db.session.commit()
        return tarea.id


def test_candidatos_a_observador_cruzan_unidades(client, escenario, tarea_compartida):
    """El desplegable se llenaba con la gente de la propia unidad mientras el
    texto de al lado invitaba a anadir a alguien de otra. Observar existe para
    cruzar unidades: limitar la lista lo dejaba sin su unico uso."""
    _login_as(client, escenario['empleado_id'])
    respuesta = client.get(f'/api/tasks/{tarea_compartida}/watcher-candidates')

    nombres = {u['username'] for u in respuesta.get_json()['users']}
    assert 'lider' in nombres


def test_uno_se_apunta_solo_a_observar(client, escenario, tarea_compartida):
    """Apuntarse pedia permiso de edicion, asi que quien recibia una tarea
    compartida no podia seguirla por su cuenta."""
    _login_as(client, escenario['empleado_id'])
    client.post(f'/api/tasks/{tarea_compartida}/watchers',
                json={'user_id': escenario['lider_id']})

    _login_as(client, escenario['lider_id'])
    salida = client.delete(f'/api/tasks/{tarea_compartida}/watchers/{escenario["lider_id"]}')
    assert salida.status_code == 200
    # Solo veia la tarea por observarla, asi que al salir la pierde de vista.
    assert salida.get_json()['can_still_view'] is False


def test_apuntar_a_otro_sigue_pidiendo_edicion(client, escenario, tarea_compartida):
    """Aflojar la puerta para uno mismo no puede aflojarla para terceros."""
    _login_as(client, escenario['empleado_id'])
    client.post(f'/api/tasks/{tarea_compartida}/watchers',
                json={'user_id': escenario['lider_id']})

    _login_as(client, escenario['lider_id'])
    respuesta = client.post(f'/api/tasks/{tarea_compartida}/watchers',
                            json={'user_id': escenario['admin_id']})

    assert respuesta.status_code == 403


def test_el_aviso_de_observacion_no_se_llama_comentario(client, escenario, tarea_compartida):
    """Iba como 'task_comment', asi que el aviso decia comentario cuando lo que
    habia pasado era que te habian puesto a observar."""
    _login_as(client, escenario['empleado_id'])
    client.post(f'/api/tasks/{tarea_compartida}/watchers',
                json={'user_id': escenario['lider_id']})

    _login_as(client, escenario['lider_id'])
    avisos = client.get('/api/notifications?unread_only=1').get_json()['items']

    assert any(n['kind'] == 'task_watching' for n in avisos)
