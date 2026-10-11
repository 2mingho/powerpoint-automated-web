"""Flask fija done_at al cerrar una tarea, como la app web: la puntualidad no debe tener huecos mientras convivan."""
import os
from datetime import timedelta

import pytest
from werkzeug.security import generate_password_hash

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_done_at.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402
from models import User, Area, Task  # noqa: E402
from services.catalogo import aplicar_estado  # noqa: E402
from services.clock import today_local  # noqa: E402


@pytest.fixture
def client():
    app = app_module.app
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False, ALLOW_SELF_REGISTRATION=False, RATELIMIT_ENABLED=False)
    with app.app_context():
        db.drop_all()
        db.create_all()
    with app.test_client() as c:
        yield c


@pytest.fixture
def usuario(client):
    with app_module.app.app_context():
        unidad = Area(name='Alpha')
        db.session.add(unidad)
        db.session.commit()
        u = User(username='ana', email='ana@ejemplo.com', password=generate_password_hash('clave-de-prueba', method='scrypt'),
                 role='analista', is_active=True, area_id=unidad.id)
        u.set_allowed_tools(['tasks'])
        db.session.add(u)
        db.session.commit()
        uid = u.id
    with client.session_transaction() as s:
        s['_user_id'] = str(uid)
        s['_fresh'] = True
    return uid


def _tarea(client, uid, **extra):
    r = client.post('/api/tasks', json={'title': 'T', 'assignee_id': uid, 'due_date': (today_local() + timedelta(days=9)).isoformat(), **extra})
    assert r.status_code == 200, r.get_json()
    return r.get_json()['tasks'][0]['id']


def _leer(tid):
    with app_module.app.app_context():
        t = db.session.get(Task, tid)
        return t.status, t.done_at, t.block_reason


def test_cerrar_por_put_fija_done_at_y_reabrir_lo_quita(client, usuario):
    tid = _tarea(client, usuario)
    assert _leer(tid)[1] is None
    assert client.put(f'/api/tasks/{tid}', json={'status': 'Completado'}).status_code == 200
    estado, cierre, _ = _leer(tid)
    assert estado == 'Completado' and cierre is not None
    assert client.put(f'/api/tasks/{tid}', json={'status': 'En Progreso'}).status_code == 200
    assert _leer(tid)[1] is None


def test_moverse_entre_estados_abiertos_no_toca_nada(client, usuario):
    tid = _tarea(client, usuario)
    client.put(f'/api/tasks/{tid}', json={'status': 'En Progreso'})
    assert _leer(tid)[1] is None


def test_repetir_el_cierre_no_pierde_la_fecha_real(client, usuario):
    tid = _tarea(client, usuario)
    client.put(f'/api/tasks/{tid}', json={'status': 'Completado'})
    primero = _leer(tid)[1]
    client.put(f'/api/tasks/{tid}', json={'status': 'Completado', 'title': 'otra vez'})
    assert _leer(tid)[1] == primero


def test_cerrar_borra_el_motivo_de_bloqueo(client, usuario):
    tid = _tarea(client, usuario)
    with app_module.app.app_context():
        t = db.session.get(Task, tid)
        t.block_reason = 'esperando datos'
        db.session.commit()
    client.put(f'/api/tasks/{tid}', json={'status': 'Completado'})
    assert _leer(tid)[2] is None


def test_edicion_por_lote_cierra_y_reabre(client, usuario):
    ids = [_tarea(client, usuario) for _ in range(3)]
    assert client.post('/api/tasks/bulk-update', json={'task_ids': ids, 'status': 'Completado'}).status_code == 200
    assert all(_leer(i)[1] is not None for i in ids)
    assert client.post('/api/tasks/bulk-update', json={'task_ids': ids, 'status': 'Pendiente'}).status_code == 200
    assert all(_leer(i)[1] is None for i in ids)


def test_mover_en_el_tablero_cierra_y_reabre(client, usuario):
    tid = _tarea(client, usuario)
    assert client.post(f'/api/tasks/{tid}/move', json={'status': 'Completado'}).status_code == 200
    assert _leer(tid)[1] is not None
    assert client.post(f'/api/tasks/{tid}/move', json={'status': 'Pendiente'}).status_code == 200
    assert _leer(tid)[1] is None


def test_aplicar_estado_directo(client, usuario):
    with app_module.app.app_context():
        t = Task(title='x', assignee_id=usuario, creator_id=usuario, due_date=today_local(), status='Pendiente', priority='Media', area='A')
        aplicar_estado(t, 'Completado')
        assert t.done_at is not None
        antes = t.done_at
        aplicar_estado(t, 'Completado')
        assert t.done_at == antes
        aplicar_estado(t, 'Pendiente')
        assert t.done_at is None
