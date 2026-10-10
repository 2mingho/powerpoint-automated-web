"""
Regresiones del tablero Kanban, las etiquetas y las dependencias.

El tablero reutiliza el alcance de /api/tasks: lo primero que se fija es que
no ensena nada que la lista no ensenaria. Despues, que mover una tarjeta deja
el orden que el usuario ve, que reordenar no cuenta como edicion, y que las
etiquetas y dependencias de otra unidad ni se ven ni se pisan.
"""
import os
from datetime import datetime, timedelta

import pytest
from werkzeug.security import generate_password_hash

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_tablero.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402
from models import (User, Area, Task, TaskStatus, TaskTag, TaskDependency,  # noqa: E402
                    TaskWatcher, Notification, task_tag_links)
from services.clock import today_local  # noqa: E402


ESTADOS = [
    ('Pendiente', 10, 'aviso', True, False),
    ('En Progreso', 20, 'info', False, False),
    ('Completado', 50, 'bien', False, True),
]


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


def _tarea(title, area, creator_id, assignee_id, **extra):
    extra.setdefault('due_date', today_local() + timedelta(days=5))
    tarea = Task(title=title, area=area.name, area_id=area.id,
                 creator_id=creator_id, assignee_id=assignee_id, **extra)
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
    with app_module.app.app_context():
        for nombre, orden, color, inicial, final in ESTADOS:
            db.session.add(TaskStatus(nombre=nombre, orden=orden, color=color,
                                      es_inicial=inicial, es_final=final))
        alpha = Area(name='Alpha')
        beta = Area(name='Beta')
        db.session.add_all([alpha, beta])
        db.session.commit()

        empleado = _usuario('empleado', alpha.id)
        companero = _usuario('companero', alpha.id)
        ajeno = _usuario('ajeno', beta.id)

        p1 = _tarea('P1', alpha, empleado.id, empleado.id, status='Pendiente')
        p2 = _tarea('P2', alpha, empleado.id, companero.id, status='Pendiente')
        p3 = _tarea('P3', alpha, empleado.id, empleado.id, status='Pendiente')
        curso = _tarea('Curso', alpha, empleado.id, empleado.id, status='En Progreso')
        hecha = _tarea('Hecha hoy', alpha, empleado.id, empleado.id, status='Completado')
        vieja = _tarea('Hecha hace mucho', alpha, empleado.id, empleado.id, status='Completado')
        beta_t = _tarea('De Beta', beta, ajeno.id, ajeno.id, status='Pendiente')

        # updated_at tiene onupdate: hay que fijarlo con un UPDATE directo.
        db.session.execute(Task.__table__.update().where(Task.id == vieja.id).values(
            updated_at=datetime.utcnow() - timedelta(days=60)))

        etiqueta_alpha = TaskTag(nombre='Cliente', color='info', area_id=alpha.id)
        etiqueta_beta = TaskTag(nombre='Interna', color='alerta', area_id=beta.id)
        db.session.add_all([etiqueta_alpha, etiqueta_beta])
        db.session.commit()

        return {
            'alpha_id': alpha.id, 'empleado_id': empleado.id, 'companero_id': companero.id,
            'ajeno_id': ajeno.id, 'p1': p1.id, 'p2': p2.id, 'p3': p3.id,
            'curso': curso.id, 'hecha': hecha.id, 'vieja': vieja.id, 'beta': beta_t.id,
            'tag_alpha': etiqueta_alpha.id, 'tag_beta': etiqueta_beta.id,
        }


def _tablero(client, **params):
    respuesta = client.get('/api/tasks/board', query_string=params)
    assert respuesta.status_code == 200, respuesta.get_data(as_text=True)
    return respuesta.get_json()


def _columna(datos, estado):
    return [t['id'] for t in datos['tasks'] if t['status'] == estado]


def _mover(client, task_id, **cuerpo):
    return client.post(f'/api/tasks/{task_id}/move', json=cuerpo)


# ─────────────────────────────────────────────────────────────
# Tablero
# ─────────────────────────────────────────────────────────────

def test_tablero_respeta_unidad_y_oculta_cerradas_viejas(client, escenario):
    _login_as(client, escenario['empleado_id'])
    datos = _tablero(client)
    ids = {t['id'] for t in datos['tasks']}

    assert [c['nombre'] for c in datos['columns']] == ['Pendiente', 'En Progreso', 'Completado']
    assert escenario['beta'] not in ids
    assert escenario['hecha'] in ids
    assert escenario['vieja'] not in ids
    assert escenario['vieja'] in {t['id'] for t in _tablero(client, cerradas_dias=90)['tasks']}
    # Solo las etiquetas de su unidad.
    assert {t['id'] for t in datos['tags']} == {escenario['tag_alpha']}


def test_tablero_chip_mias(client, escenario):
    _login_as(client, escenario['empleado_id'])
    ids = {t['id'] for t in _tablero(client, scope='mine')['tasks']}
    assert escenario['p2'] not in ids
    assert escenario['p1'] in ids


def test_mover_dentro_de_columna_deja_el_orden_pedido(client, escenario):
    _login_as(client, escenario['empleado_id'])
    p1, p2, p3 = escenario['p1'], escenario['p2'], escenario['p3']
    assert _columna(_tablero(client), 'Pendiente') == [p1, p2, p3]

    # P3 arriba del todo: renumera porque nadie tenia posicion.
    r = _mover(client, p3, status='Pendiente', siguiente_id=p1)
    assert r.status_code == 200, r.get_data(as_text=True)
    assert _columna(_tablero(client), 'Pendiente') == [p3, p1, p2]

    # P2 entre P3 y P1: ahora cabe en el hueco sin renumerar.
    r = _mover(client, p2, status='Pendiente', anterior_id=p3, siguiente_id=p1)
    assert r.status_code == 200
    assert _columna(_tablero(client), 'Pendiente') == [p3, p2, p1]


def test_reordenar_no_cuenta_como_edicion(client, escenario):
    """Si reordenar tocara updated_at, quien tuviera otra tarea abierta
    recibiria un conflicto falso al guardar."""
    _login_as(client, escenario['empleado_id'])
    with app_module.app.app_context():
        antes = {t.id: t.updated_at for t in Task.query.all()}
    _mover(client, escenario['p3'], status='Pendiente', siguiente_id=escenario['p1'])
    with app_module.app.app_context():
        despues = {t.id: t.updated_at for t in Task.query.all()}
    assert antes == despues


def test_cambiar_de_columna_avisa_observadores_y_registra(client, escenario):
    _login_as(client, escenario['empleado_id'])
    with app_module.app.app_context():
        db.session.add(TaskWatcher(task_id=escenario['p1'], user_id=escenario['companero_id']))
        db.session.commit()

    r = _mover(client, escenario['p1'], status='En Progreso', anterior_id=escenario['curso'])
    assert r.status_code == 200
    assert r.get_json()['task']['status'] == 'En Progreso'
    assert _columna(_tablero(client), 'En Progreso') == [escenario['curso'], escenario['p1']]
    with app_module.app.app_context():
        assert Notification.query.filter_by(user_id=escenario['companero_id'],
                                            kind='task_watching').count() == 1


def test_cambiar_de_columna_con_version_vieja_da_conflicto(client, escenario):
    _login_as(client, escenario['empleado_id'])
    r = _mover(client, escenario['p1'], status='En Progreso', expected_updated_at='2000-01-01T00:00:00')
    assert r.status_code == 409


def test_no_se_mueve_tarea_de_otra_unidad(client, escenario):
    _login_as(client, escenario['empleado_id'])
    assert _mover(client, escenario['beta'], status='En Progreso').status_code == 403


def test_estado_invalido(client, escenario):
    _login_as(client, escenario['empleado_id'])
    assert _mover(client, escenario['p1'], status='Inventado').status_code == 400


# ─────────────────────────────────────────────────────────────
# Etiquetas
# ─────────────────────────────────────────────────────────────

def test_crear_etiqueta_en_su_unidad_y_sin_duplicados(client, escenario):
    _login_as(client, escenario['empleado_id'])
    r = client.post('/api/tasks/tags', json={'nombre': 'Urgente  cliente', 'color': 'alerta'})
    assert r.status_code == 201
    tag = r.get_json()['tag']
    assert tag['nombre'] == 'Urgente cliente'
    assert tag['area_id'] == escenario['alpha_id']

    assert client.post('/api/tasks/tags', json={'nombre': 'urgente CLIENTE'}).status_code == 409
    assert client.post('/api/tasks/tags', json={'nombre': 'x', 'color': '#ff0000'}).status_code == 400


def test_no_se_ve_ni_se_edita_etiqueta_ajena(client, escenario):
    _login_as(client, escenario['empleado_id'])
    assert client.put(f"/api/tasks/tags/{escenario['tag_beta']}", json={'nombre': 'x'}).status_code == 404
    assert client.delete(f"/api/tasks/tags/{escenario['tag_beta']}").status_code == 404
    r = client.put(f"/api/tasks/{escenario['p1']}/tags", json={'tag_ids': [escenario['tag_beta']]})
    assert r.status_code == 400


def test_fijar_etiquetas_conserva_las_de_otra_unidad(client, escenario):
    """Una tarea compartida puede llevar etiquetas de otro equipo. Quien no
    las ve no debe borrarlas al guardar las suyas."""
    with app_module.app.app_context():
        db.session.execute(task_tag_links.insert().values(task_id=escenario['p1'],
                                                          tag_id=escenario['tag_beta']))
        db.session.commit()

    _login_as(client, escenario['empleado_id'])
    r = client.put(f"/api/tasks/{escenario['p1']}/tags", json={'tag_ids': [escenario['tag_alpha']]})
    assert r.status_code == 200
    with app_module.app.app_context():
        ids = {fila.tag_id for fila in db.session.execute(
            task_tag_links.select().where(task_tag_links.c.task_id == escenario['p1']))}
    assert ids == {escenario['tag_alpha'], escenario['tag_beta']}

    tarjeta = next(t for t in _tablero(client)['tasks'] if t['id'] == escenario['p1'])
    assert {t['nombre'] for t in tarjeta['tags']} == {'Cliente', 'Interna'}


def test_filtrar_tablero_por_etiqueta_y_borrarla(client, escenario):
    _login_as(client, escenario['empleado_id'])
    client.put(f"/api/tasks/{escenario['p2']}/tags", json={'tag_ids': [escenario['tag_alpha']]})
    assert {t['id'] for t in _tablero(client, tag_id=escenario['tag_alpha'])['tasks']} == {escenario['p2']}

    assert client.delete(f"/api/tasks/tags/{escenario['tag_alpha']}").status_code == 200
    with app_module.app.app_context():
        assert db.session.execute(task_tag_links.select()).first() is None


# ─────────────────────────────────────────────────────────────
# Dependencias
# ─────────────────────────────────────────────────────────────

def test_dependencia_marca_bloqueo_y_avisa_al_cerrar(client, escenario):
    _login_as(client, escenario['empleado_id'])
    r = client.post(f"/api/tasks/{escenario['p2']}/dependencies",
                    json={'tipo': 'blocked_by', 'task_id': escenario['p1']})
    assert r.status_code == 201

    tarjetas = {t['id']: t for t in _tablero(client)['tasks']}
    assert tarjetas[escenario['p2']]['blocked_by_open'] == 1
    assert tarjetas[escenario['p1']]['blocks_count'] == 1

    deps = client.get(f"/api/tasks/{escenario['p2']}/dependencies").get_json()
    assert [d['id'] for d in deps['blocked_by']] == [escenario['p1']]

    # Cerrar la bloqueada se permite, pero con aviso.
    r = _mover(client, escenario['p2'], status='Completado')
    assert r.status_code == 200
    assert 'P1' in r.get_json()['aviso']

    # Cerrada la previa, deja de contar como bloqueo.
    _mover(client, escenario['p1'], status='Completado')
    tarjetas = {t['id']: t for t in _tablero(client)['tasks']}
    assert tarjetas[escenario['p2']]['blocked_by_open'] == 0


def test_dependencia_rechaza_ciclos_y_duplicados(client, escenario):
    _login_as(client, escenario['empleado_id'])
    p1, p2, p3 = escenario['p1'], escenario['p2'], escenario['p3']
    assert client.post(f'/api/tasks/{p2}/dependencies', json={'tipo': 'blocked_by', 'task_id': p1}).status_code == 201
    assert client.post(f'/api/tasks/{p3}/dependencies', json={'tipo': 'blocked_by', 'task_id': p2}).status_code == 201
    # p1 -> p2 -> p3; p3 antes que p1 cerraria el circulo.
    assert client.post(f'/api/tasks/{p1}/dependencies', json={'tipo': 'blocked_by', 'task_id': p3}).status_code == 400
    assert client.post(f'/api/tasks/{p2}/dependencies', json={'tipo': 'blocked_by', 'task_id': p1}).status_code == 409
    assert client.post(f'/api/tasks/{p1}/dependencies', json={'tipo': 'blocks', 'task_id': p1}).status_code == 400


def test_dependencia_con_tarea_invisible_no_se_crea_y_no_se_filtra(client, escenario):
    _login_as(client, escenario['empleado_id'])
    r = client.post(f"/api/tasks/{escenario['p1']}/dependencies",
                    json={'tipo': 'blocked_by', 'task_id': escenario['beta']})
    assert r.status_code == 404

    # Creada por otro lado, se cuenta pero no se describe.
    with app_module.app.app_context():
        db.session.add(TaskDependency(blocker_task_id=escenario['beta'], blocked_task_id=escenario['p1']))
        db.session.commit()
    deps = client.get(f"/api/tasks/{escenario['p1']}/dependencies").get_json()
    assert deps['blocked_by'] == []
    assert deps['hidden_blocked_by'] == 1


def test_quitar_dependencia(client, escenario):
    _login_as(client, escenario['empleado_id'])
    dep_id = client.post(f"/api/tasks/{escenario['p2']}/dependencies",
                         json={'tipo': 'blocked_by', 'task_id': escenario['p1']}).get_json()['dependency_id']
    assert client.delete(f"/api/tasks/{escenario['p3']}/dependencies/{dep_id}").status_code == 404
    assert client.delete(f"/api/tasks/{escenario['p1']}/dependencies/{dep_id}").status_code == 200
    with app_module.app.app_context():
        assert TaskDependency.query.count() == 0


def test_lista_con_contadores_y_detalle_llevan_etiquetas(client, escenario):
    _login_as(client, escenario['empleado_id'])
    client.put(f"/api/tasks/{escenario['p1']}/tags", json={'tag_ids': [escenario['tag_alpha']]})
    lista = client.get('/api/tasks', query_string={'counts': '1', 'scope': 'mine'}).get_json()
    fila = next(t for t in lista if t['id'] == escenario['p1'])
    assert [t['nombre'] for t in fila['tags']] == ['Cliente']
    detalle = client.get(f"/api/tasks/{escenario['p1']}").get_json()['task']
    assert detalle['blocked_by_open'] == 0
    assert [t['nombre'] for t in detalle['tags']] == ['Cliente']
