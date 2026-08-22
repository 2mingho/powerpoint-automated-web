import os
import io

import pytest
from werkzeug.security import generate_password_hash


os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_backend_security.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402
from models import User, Report, Area, Task, TempArtifact  # noqa: E402
from datetime import date  # noqa: E402


def _login_as(client, user_id):
    with client.session_transaction() as session:
        session['_user_id'] = str(user_id)
        session['_fresh'] = True


def _create_user(*, username, email, role='DI', is_active=True, tools=None):
    user = User(
        username=username,
        email=email,
        password=generate_password_hash('test-password-123', method='scrypt'),
        role=role,
        is_active=is_active,
    )
    if tools is not None:
        user.set_allowed_tools(tools)
    db.session.add(user)
    db.session.commit()
    return user.id


def _create_area(name):
    area = Area(name=name)
    db.session.add(area)
    db.session.commit()
    return area.id


def _create_task(*, title, due_date, area, creator_id, assignee_id):
    task = Task(
        title=title,
        due_date=due_date,
        area=area,
        creator_id=creator_id,
        assignee_id=assignee_id,
    )
    db.session.add(task)
    db.session.commit()
    return task.id


@pytest.fixture
def client():
    app = app_module.app
    app.config.update(
        TESTING=True,
        WTF_CSRF_ENABLED=False,
        ALLOW_SELF_REGISTRATION=False,
    )

    with app.app_context():
        db.drop_all()
        db.create_all()

    with app.test_client() as test_client:
        yield test_client


def test_register_disabled_by_default(client):
    response = client.get('/register', follow_redirects=False)

    assert response.status_code == 403
    assert '/login' in response.headers.get('Location', '')


def test_tasks_access_required_blocks_user_without_tasks_permission(client):
    with app_module.app.app_context():
        user = _create_user(
            username='no-tasks-user',
            email='no-tasks@example.com',
            tools=['reports', 'classification'],
        )

    _login_as(client, user)
    response = client.get('/tasks', follow_redirects=False)

    assert response.status_code == 403


def test_download_requires_report_ownership(client):
    report_path = None
    with app_module.app.app_context():
        owner = _create_user(username='owner-user', email='owner@example.com')
        other = _create_user(username='other-user', email='other@example.com')

        os.makedirs(app_module.app.config['UPLOAD_FOLDER'], exist_ok=True)
        report_name = 'owned_report.zip'
        report_path = os.path.join(app_module.app.config['UPLOAD_FOLDER'], report_name)
        with open(report_path, 'wb') as file_handle:
            file_handle.write(b'test-content')

        report = Report(filename=report_name, user_id=owner, title='Owned report')
        db.session.add(report)
        db.session.commit()

    _login_as(client, other)
    response = client.get(f'/download/{report_name}', follow_redirects=False)

    assert response.status_code == 403

    if report_path and os.path.exists(report_path):
        os.remove(report_path)


def test_inactive_user_is_logged_out_on_request(client):
    with app_module.app.app_context():
        inactive = _create_user(
            username='inactive-user',
            email='inactive@example.com',
            is_active=False,
        )

    _login_as(client, inactive)
    response = client.get('/menu', follow_redirects=False)

    assert response.status_code == 302
    assert '/login' in response.headers.get('Location', '')

    with client.session_transaction() as session:
        assert '_user_id' not in session


def test_upload_csv_requires_reports_tool_permission(client):
    with app_module.app.app_context():
        user = _create_user(
            username='no-reports-upload',
            email='no-reports-upload@example.com',
            tools=['classification'],
        )

    _login_as(client, user)
    response = client.post(
        '/upload_csv',
        data={
            'csv_file': (io.BytesIO(b'columna\nvalor\n'), 'test.csv'),
        },
        content_type='multipart/form-data',
    )

    assert response.status_code == 403


def test_generate_pptx_requires_reports_tool_permission(client):
    with app_module.app.app_context():
        user = _create_user(
            username='no-reports-pptx',
            email='no-reports-pptx@example.com',
            tools=['classification'],
        )

    _login_as(client, user)
    response = client.post(
        '/generate_pptx',
        json={'meta': {'client_name': 'Cliente de prueba'}},
    )

    assert response.status_code == 403


def test_non_admin_cannot_delete_tasks_for_other_unit_by_day(client):
    target_day = date(2026, 1, 15)

    with app_module.app.app_context():
        area_a_id = _create_area('Unidad-A')
        area_b_id = _create_area('Unidad-B')

        unit_a_user_id = _create_user(
            username='unit-a-user',
            email='unit-a-user@example.com',
            role='DI',
            tools=['tasks'],
        )
        unit_b_user_id = _create_user(
            username='unit-b-user',
            email='unit-b-user@example.com',
            role='DI',
            tools=['tasks'],
        )

        unit_a_user = db.session.get(User, unit_a_user_id)
        unit_b_user = db.session.get(User, unit_b_user_id)
        unit_a_user.area_id = area_a_id
        unit_b_user.area_id = area_b_id
        db.session.commit()

        own_task_id = _create_task(
            title='Tarea unidad A',
            due_date=target_day,
            area='DI',
            creator_id=unit_a_user_id,
            assignee_id=unit_a_user_id,
        )
        other_task_id = _create_task(
            title='Tarea unidad B',
            due_date=target_day,
            area='DI',
            creator_id=unit_b_user_id,
            assignee_id=unit_b_user_id,
        )

    _login_as(client, unit_a_user_id)
    response = client.delete(f'/api/tasks/day/{target_day.isoformat()}')

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['deleted'] == 1

    with app_module.app.app_context():
        assert db.session.get(Task, own_task_id) is None
        assert db.session.get(Task, other_task_id) is not None


# ─────────────────────────────────────────────────────────────
# SEC-03: las sesiones de clasificacion pertenecen a quien las crea
# ─────────────────────────────────────────────────────────────

def _start_classification_session(client, user_id):
    """Sube un CSV minimo y devuelve el session_id generado."""
    _login_as(client, user_id)
    csv_bytes = b'Hit Sentence,Autor\nprimera mencion,ana\nsegunda mencion,luis\n'
    data = {'csv_file': (io.BytesIO(csv_bytes), 'fuente.csv')}
    response = client.post('/clasificacion/upload', data=data,
                           content_type='multipart/form-data')
    assert response.status_code == 200, response.data
    payload = response.get_json()
    assert payload['success'], payload
    return payload['session_id']


def test_classification_session_is_registered_to_its_creator(client):
    with app_module.app.app_context():
        owner_id = _create_user(username='clf-owner', email='clf-owner@example.com',
                                tools=['classification'])
    session_id = _start_classification_session(client, owner_id)
    with app_module.app.app_context():
        artifact = TempArtifact.query.filter_by(kind='classify_session',
                                                file_id=session_id).first()
        assert artifact is not None and artifact.user_id == owner_id
    assert client.get(f'/clasificacion/upload_body/{session_id}').status_code == 200


def test_classification_session_body_not_readable_by_other_user(client):
    with app_module.app.app_context():
        owner_id = _create_user(username='clf-owner2', email='clf-owner2@example.com',
                                tools=['classification'])
        intruder_id = _create_user(username='clf-intruder', email='clf-intruder@example.com',
                                   tools=['classification'])
    session_id = _start_classification_session(client, owner_id)
    _login_as(client, intruder_id)
    assert client.get(f'/clasificacion/upload_body/{session_id}').status_code == 403


def test_classification_chunk_rejected_for_other_user(client):
    with app_module.app.app_context():
        owner_id = _create_user(username='clf-owner3', email='clf-owner3@example.com',
                                tools=['classification'])
        intruder_id = _create_user(username='clf-intruder3', email='clf-intruder3@example.com',
                                   tools=['classification'])
    session_id = _start_classification_session(client, owner_id)
    _login_as(client, intruder_id)
    response = client.post('/clasificacion/chunk', json={
        'session_id': session_id, 'header': 'Hit Sentence',
        'rows': 'fila inyectada', 'rules': [], 'chunk_index': 0,
    })
    assert response.status_code == 403


def test_classification_finalize_cannot_hijack_another_session(client):
    with app_module.app.app_context():
        owner_id = _create_user(username='clf-owner4', email='clf-owner4@example.com',
                                tools=['classification'])
        intruder_id = _create_user(username='clf-intruder4', email='clf-intruder4@example.com',
                                   tools=['classification'])
    session_id = _start_classification_session(client, owner_id)
    _login_as(client, intruder_id)
    assert client.post('/clasificacion/finalize', json={
        'session_id': session_id, 'original_name': 'robado.csv'}).status_code == 403
    with app_module.app.app_context():
        artifact = TempArtifact.query.filter_by(kind='classify_session',
                                                file_id=session_id).first()
        assert artifact is not None and artifact.user_id == owner_id


# ─────────────────────────────────────────────────────────────
# SEC-02 / FUN-06: /generate_pptx valida y no escribe fuera de scratch
# ─────────────────────────────────────────────────────────────

def test_generate_pptx_rejects_missing_client_name(client):
    with app_module.app.app_context():
        user_id = _create_user(username='ppt-user', email='ppt-user@example.com',
                               tools=['reports'])
    _login_as(client, user_id)
    response = client.post('/generate_pptx', json={'meta': {}})
    assert response.status_code == 400
    assert response.get_json()['success'] is False


def test_generate_pptx_does_not_write_outside_scratch(client):
    with app_module.app.app_context():
        user_id = _create_user(username='ppt-user2', email='ppt-user2@example.com',
                               tools=['reports'])
    _login_as(client, user_id)
    client.post('/generate_pptx', json={'meta': {'client_name': '../../pwned'}})
    scratch_root = os.path.abspath(app_module.app.config['UPLOAD_FOLDER'])
    escaped = os.path.join(os.path.dirname(os.path.dirname(scratch_root)),
                           'Reporte_pwned.pptx')
    assert not os.path.exists(escaped)


# ─────────────────────────────────────────────────────────────
# Proteccion de la base de produccion en arranques locales
# ─────────────────────────────────────────────────────────────

def _with_uri(uri, production):
    original_uri = app_module.app.config['SQLALCHEMY_DATABASE_URI']
    original_is_prod = app_module._is_production_mode
    app_module.app.config['SQLALCHEMY_DATABASE_URI'] = uri
    app_module._is_production_mode = lambda: production
    try:
        return app_module._startup_db_writes_allowed()
    finally:
        app_module.app.config['SQLALCHEMY_DATABASE_URI'] = original_uri
        app_module._is_production_mode = original_is_prod


def test_startup_never_writes_to_remote_db_from_a_dev_machine():
    """
    Exportar la DATABASE_URL de produccion en local no debe bastar para que el
    arranque cree tablas, siembre el admin o ejecute la poda (que BORRA datos).
    """
    assert _with_uri('postgresql://u:p@ep-x.neon.tech/main', production=False) is False


def test_startup_writes_allowed_on_local_sqlite():
    assert _with_uri('sqlite:///instance/users.db', production=False) is True


def test_startup_writes_allowed_in_production():
    assert _with_uri('postgresql://u:p@ep-x.neon.tech/main', production=True) is True


# ─────────────────────────────────────────────────────────────
# FUN-01: zona horaria de negocio
# ─────────────────────────────────────────────────────────────

def test_business_timezone_is_behind_utc():
    """
    Republica Dominicana es UTC-4 todo el ano. A las 02:00 UTC del dia D en el
    servidor, para el equipo son las 22:00 del dia D-1.
    """
    from datetime import datetime, timezone, timedelta
    from services.clock import APP_TIMEZONE
    utc_moment = datetime(2026, 3, 11, 2, 0, tzinfo=timezone.utc)
    local_moment = utc_moment.astimezone(APP_TIMEZONE)
    assert local_moment.date() == utc_moment.date() - timedelta(days=1)
    assert local_moment.hour == 22


def test_today_local_is_consistent_with_now_local():
    from services.clock import now_local, today_local
    assert today_local() == now_local().date()
