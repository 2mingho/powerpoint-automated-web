"""
Cuantas consultas cuesta cada cosa.

En produccion la app usa NullPool: cada commit cierra la conexion y la
siguiente consulta abre otra (TCP+TLS). Por eso aqui no se prueba solo que la
respuesta sea correcta, sino que el numero de consultas no crezca con el
numero de filas ni aparezca donde no hace falta.
"""
import os
from contextlib import contextmanager
from datetime import timedelta

import pytest
from sqlalchemy import event
from werkzeug.security import generate_password_hash

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_consultas.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402
from models import User, Area, Task, Notification, ActivityLog  # noqa: E402
from services.clock import today_local  # noqa: E402


def _login_as(client, user_id):
    with client.session_transaction() as session:
        session['_user_id'] = str(user_id)
        session['_fresh'] = True


@contextmanager
def _sentencias():
    """Recoge el SQL que se ejecuta dentro del bloque."""
    vistas = []

    def _anotar(conn, cursor, statement, parameters, context, executemany):
        vistas.append(statement)

    with app_module.app.app_context():
        engine = db.engine
    event.listen(engine, 'before_cursor_execute', _anotar)
    try:
        yield vistas
    finally:
        event.remove(engine, 'before_cursor_execute', _anotar)


def _selects(sentencias, tabla=None):
    filas = [s for s in sentencias if s.lstrip().upper().startswith('SELECT')]
    if tabla:
        filas = [s for s in filas if f'FROM {tabla}' in s]
    return filas


@pytest.fixture
def client():
    app = app_module.app
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False, ALLOW_SELF_REGISTRATION=False,
                      RATELIMIT_ENABLED=False)
    with app.app_context():
        db.drop_all()
        db.create_all()
    with app.test_client() as test_client:
        yield test_client


@pytest.fixture
def equipo(client):
    """Una unidad con dos personas: quien crea y a quien se le asigna."""
    with app_module.app.app_context():
        unidad = Area(name='Alpha')
        db.session.add(unidad)
        db.session.commit()

        ids = {}
        for nombre in ('creadora', 'asignada'):
            user = User(
                username=nombre,
                email=f'{nombre}@ejemplo.com',
                password=generate_password_hash('clave-de-prueba', method='scrypt'),
                role='DI',
                is_active=True,
                area_id=unidad.id,
            )
            user.set_allowed_tools(['tasks'])
            db.session.add(user)
            db.session.commit()
            ids[nombre] = user.id
        return ids


def _crear_tarea(client, assignee_id, **extra):
    payload = {
        'title': 'Informe',
        'assignee_id': assignee_id,
        'due_date': (today_local() + timedelta(days=30)).isoformat(),
    }
    payload.update(extra)
    respuesta = client.post('/api/tasks', json=payload)
    assert respuesta.status_code == 200, respuesta.get_json()
    return respuesta.get_json()


# ─────────────────────────────────────────────────────────────
# Punto 1: los estaticos no tocan la base
# ─────────────────────────────────────────────────────────────

def test_estatico_no_consulta_la_base(client, equipo):
    _login_as(client, equipo['creadora'])
    with _sentencias() as vistas:
        respuesta = client.get('/static/js/notifications.js')
    respuesta.close()
    assert respuesta.status_code == 200
    assert vistas == []


# ─────────────────────────────────────────────────────────────
# Punto 2: un commit por cambio y sin releer lo recien creado
# ─────────────────────────────────────────────────────────────

def test_tarea_simple_se_notifica_con_su_id(client, equipo):
    """Antes se notificaba sin flush: link '/tasks?task=None' y sin entity_id."""
    _login_as(client, equipo['creadora'])
    datos = _crear_tarea(client, equipo['asignada'])
    task_id = datos['tasks'][0]['id']
    assert task_id is not None

    with app_module.app.app_context():
        aviso = Notification.query.filter_by(user_id=equipo['asignada'],
                                             kind='task_assigned').one()
        assert aviso.entity_id == task_id
        assert aviso.link_url == f'/tasks?task={task_id}'
        assert ActivityLog.query.filter_by(action='task_create', entity_id=task_id).count() == 1


def _selects_de_recurrencia(client, assignee_id, dias):
    inicio = today_local() + timedelta(days=7)
    with _sentencias() as vistas:
        datos = _crear_tarea(
            client, assignee_id,
            due_date=inicio.isoformat(),
            is_recurrent=True,
            recurrence_type='Diaria',
            recurrence_end=(inicio + timedelta(days=dias)).isoformat(),
        )
    return datos, len(_selects(vistas, 'tasks'))


def test_recurrencia_no_relee_cada_instancia(client, equipo):
    """Serializar despues del commit costaba un SELECT por instancia."""
    _login_as(client, equipo['creadora'])
    corta, selects_corta = _selects_de_recurrencia(client, equipo['asignada'], 7)
    larga, selects_larga = _selects_de_recurrencia(client, equipo['asignada'], 60)

    assert larga['count'] > corta['count']
    assert selects_larga == selects_corta
    assert all(t['creator_name'] == 'creadora' for t in larga['tasks'])
    assert all(t['created_at'] for t in larga['tasks'])


def test_pegado_masivo_no_relee_cada_tarea(client, equipo):
    _login_as(client, equipo['creadora'])
    fecha = (today_local() + timedelta(days=10)).isoformat()

    def _pegar(n):
        filas = [{'title': f'T{i}', 'assignee_id': equipo['asignada'], 'due_date': fecha}
                 for i in range(n)]
        with _sentencias() as vistas:
            respuesta = client.post('/api/tasks/bulk-create', json={'tasks': filas})
        datos = respuesta.get_json()
        assert datos['created'] == n, datos
        assert all(t['id'] for t in datos['tasks'])
        return len(_selects(vistas, 'tasks'))

    assert _pegar(3) == _pegar(25)


def test_actualizar_devuelve_lo_guardado_con_un_solo_commit(client, equipo):
    _login_as(client, equipo['creadora'])
    task_id = _crear_tarea(client, equipo['asignada'])['tasks'][0]['id']

    with _sentencias() as vistas:
        respuesta = client.put(f'/api/tasks/{task_id}', json={'title': 'Informe final'})
    datos = respuesta.get_json()
    assert datos['success'], datos
    assert datos['task']['title'] == 'Informe final'
    assert datos['task']['updated_at']
    assert sum(1 for s in vistas if s.strip().upper() == 'COMMIT') <= 1

    with app_module.app.app_context():
        assert db.session.get(Task, task_id).title == 'Informe final'
        assert ActivityLog.query.filter_by(action='task_update', entity_id=task_id).count() == 1


# ─────────────────────────────────────────────────────────────
# Punto 3: la campanita pide solo el numero
# ─────────────────────────────────────────────────────────────

def test_contador_de_no_leidas(client, equipo):
    _login_as(client, equipo['creadora'])
    _crear_tarea(client, equipo['asignada'])

    _login_as(client, equipo['asignada'])
    datos = client.get('/api/notifications/unread-count').get_json()
    assert datos == {'success': True, 'unread_count': 1}


# ─────────────────────────────────────────────────────────────
# Punto 4: avisos de vencimiento sin N+1
# ─────────────────────────────────────────────────────────────

def test_avisos_de_vencimiento_en_una_consulta(client, equipo):
    hoy = today_local()
    with app_module.app.app_context():
        fechas = ([hoy - timedelta(days=d) for d in range(1, 6)]   # vencidas
                  + [hoy, hoy + timedelta(days=1)]                 # proximas
                  + [hoy + timedelta(days=40)])                    # sin aviso
        for i, fecha in enumerate(fechas):
            db.session.add(Task(title=f'T{i}', due_date=fecha, area='Alpha',
                                creator_id=equipo['creadora'], assignee_id=equipo['asignada']))
        db.session.commit()

    _login_as(client, equipo['asignada'])
    with _sentencias() as vistas:
        assert client.get('/tasks').status_code == 200
    assert len(_selects(vistas, 'notifications')) == 1

    with app_module.app.app_context():
        assert Notification.query.filter_by(kind='task_overdue').count() == 5
        assert Notification.query.filter_by(kind='task_due_soon').count() == 2

    # Volver a entrar el mismo dia no duplica avisos.
    assert client.get('/tasks').status_code == 200
    with app_module.app.app_context():
        assert Notification.query.filter(
            Notification.kind.in_(('task_overdue', 'task_due_soon'))).count() == 7
