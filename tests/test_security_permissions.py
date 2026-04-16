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
from models import User, Report, Area, Task  # noqa: E402
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
