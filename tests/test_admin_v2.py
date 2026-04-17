import os
import json
import csv
import io

import pytest
from werkzeug.security import generate_password_hash


os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_admin_v2.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from blueprints import admin_v2 as admin_v2_module  # noqa: E402
from blueprints.admin import DEFAULT_ADMIN_EMAIL  # noqa: E402
from extensions import db  # noqa: E402
from models import (  # noqa: E402
    AdminFreezeState,
    Area,
    AuditLedgerEvent,
    ConfigItem,
    ConfigVersion,
    IncidentAction,
    IncidentEvent,
    IncidentPlaybook,
    ModuleLock,
    OpsJob,
    OpsJobRun,
    Role,
    Task,
    User,
)


def _login_as(client, user_id):
    with client.session_transaction() as session:
        session['_user_id'] = str(user_id)
        session['_fresh'] = True


def _create_user(*, username, email, role='DI', is_active=True):
    user = User(
        username=username,
        email=email,
        password=generate_password_hash('test-password-123', method='scrypt'),
        role=role,
        is_active=is_active,
    )
    db.session.add(user)
    db.session.commit()
    return user.id


def _create_incident(client, *, summary='Incidente inicial', severity='high'):
    response = client.post('/admin/v2/incidents/new', json={'summary': summary, 'severity': severity})
    assert response.status_code == 201
    return response.get_json()['incident']['id']


def _upsert_playbook(client, *, playbook_key, name, definition, is_enabled=True, description=''):
    response = client.post('/admin/v2/incidents/playbooks/upsert', json={
        'playbook_key': playbook_key,
        'name': name,
        'description': description,
        'definition_json': definition,
        'is_enabled': is_enabled,
    })
    assert response.status_code in (200, 201)
    return response.get_json()['playbook']


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


def test_admin_v2_dashboard_requires_admin(client):
    with app_module.app.app_context():
        user_id = _create_user(username='operador', email='operador@example.com', role='DI')

    _login_as(client, user_id)
    response = client.get('/admin/v2/')

    assert response.status_code == 403


def test_admin_can_create_and_resolve_incident(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-v2', email='admin-v2@example.com', role='admin')

    _login_as(client, admin_id)
    create_response = client.post('/admin/v2/incidents/new', json={
        'summary': 'Caída parcial de servicio',
        'severity': 'critical',
    })
    assert create_response.status_code == 201
    incident_payload = create_response.get_json()['incident']
    incident_id = incident_payload['id']
    assert incident_payload['status'] == 'open'

    resolve_response = client.post(f'/admin/v2/incidents/{incident_id}/resolve')
    assert resolve_response.status_code == 200
    resolved_payload = resolve_response.get_json()['incident']
    assert resolved_payload['status'] == 'resolved'

    with app_module.app.app_context():
        incident = db.session.get(IncidentEvent, incident_id)
        assert incident is not None
        assert incident.status == 'resolved'
        assert incident.resolved_at is not None


def test_incident_playbook_upsert_and_toggle(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-playbook', email='admin-playbook@example.com', role='admin')

    _login_as(client, admin_id)
    definition = {
        'actions': [
            {'type': 'freeze', 'mode': 'freeze', 'reason': 'Contención urgente'},
            {'type': 'revoke_sessions', 'scope': 'global'},
        ]
    }
    upsert_response = client.post('/admin/v2/incidents/playbooks/upsert', json={
        'playbook_key': 'phase5_custom',
        'name': 'Phase 5 Custom',
        'description': 'Playbook de prueba',
        'definition_json': definition,
        'is_enabled': True,
    })

    assert upsert_response.status_code == 201
    upsert_payload = upsert_response.get_json()
    assert upsert_payload['success'] is True
    playbook_id = upsert_payload['playbook']['id']

    toggle_response = client.post(f'/admin/v2/incidents/playbooks/{playbook_id}/toggle', json={'mode': 'disable'})
    assert toggle_response.status_code == 200
    toggle_payload = toggle_response.get_json()
    assert toggle_payload['success'] is True
    assert toggle_payload['playbook']['is_enabled'] is False

    with app_module.app.app_context():
        playbook = db.session.get(IncidentPlaybook, playbook_id)
        assert playbook is not None
        assert playbook.playbook_key == 'phase5_custom'
        assert playbook.is_enabled is False


def test_incident_containment_executes_actions_and_creates_incident_actions(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-contain', email='admin-contain@example.com', role='admin')
        user_1_id = _create_user(username='contain-user-1', email='contain-user-1@example.com', role='DI')
        user_2_id = _create_user(username='contain-user-2', email='contain-user-2@example.com', role='DI')

    _login_as(client, admin_id)
    incident_id = _create_incident(client, summary='Ejecución de contención')
    _upsert_playbook(
        client,
        playbook_key='containment_exec',
        name='Containment Execution',
        definition={
            'actions': [
                {'type': 'freeze', 'mode': 'freeze', 'reason': 'Lockdown'},
                {'type': 'revoke_sessions', 'scope': 'global'},
                {'type': 'module_lock', 'module_key': 'reports', 'mode': 'lock', 'reason': 'Investigación'},
            ]
        },
    )

    response = client.post(f'/admin/v2/incidents/{incident_id}/contain', json={'playbook_key': 'containment_exec'})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['execution']['executed_count'] == 3
    assert payload['execution']['affected_users'] == 2
    assert 'reports' in payload['execution']['impacted_modules']

    with app_module.app.app_context():
        freeze_state = db.session.get(AdminFreezeState, 1)
        assert freeze_state is not None
        assert freeze_state.is_frozen is True

        user_1 = db.session.get(User, user_1_id)
        user_2 = db.session.get(User, user_2_id)
        admin = db.session.get(User, admin_id)
        assert user_1.force_logout is True
        assert user_2.force_logout is True
        assert admin.force_logout is False

        reports_lock = ModuleLock.query.filter_by(module_key='reports').first()
        assert reports_lock is not None
        assert reports_lock.lock_state == 'locked'

        actions = IncidentAction.query.filter_by(incident_id=incident_id).order_by(IncidentAction.id.asc()).all()
        assert len(actions) == 3
        assert [a.action_type for a in actions] == ['playbook_freeze', 'playbook_revoke_sessions', 'playbook_module_lock']


def test_incident_containment_rejects_disabled_or_missing_playbook(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-contain-reject', email='admin-contain-reject@example.com', role='admin')

    _login_as(client, admin_id)
    incident_id = _create_incident(client, summary='Contención inválida')

    missing_response = client.post(f'/admin/v2/incidents/{incident_id}/contain', json={'playbook_key': 'missing_key'})
    assert missing_response.status_code == 404

    _upsert_playbook(
        client,
        playbook_key='disabled_pb',
        name='Disabled PB',
        definition={'actions': [{'type': 'revoke_sessions', 'scope': 'global'}]},
        is_enabled=False,
    )
    disabled_response = client.post(f'/admin/v2/incidents/{incident_id}/contain', json={'playbook_key': 'disabled_pb'})
    assert disabled_response.status_code == 400
    assert 'deshabilitado' in disabled_response.get_json()['error']


def test_incident_postmortem_evidence_json_export(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-evidence-json', email='admin-evidence-json@example.com', role='admin')

    _login_as(client, admin_id)
    incident_id = _create_incident(client, summary='Incidente para evidencia JSON')
    _upsert_playbook(
        client,
        playbook_key='json_evidence_pb',
        name='JSON Evidence PB',
        definition={'actions': [{'type': 'revoke_sessions', 'scope': 'global'}]},
    )
    contain_response = client.post(f'/admin/v2/incidents/{incident_id}/contain', json={'playbook_key': 'json_evidence_pb'})
    assert contain_response.status_code == 200

    export_response = client.get(f'/admin/v2/incidents/{incident_id}/postmortem/evidence?format=json')
    assert export_response.status_code == 200
    assert 'application/json' in (export_response.headers.get('Content-Type') or '')
    assert 'attachment;' in (export_response.headers.get('Content-Disposition') or '')

    payload = json.loads(export_response.data.decode('utf-8'))
    assert payload['incident']['id'] == incident_id
    assert isinstance(payload['incident_actions'], list)
    assert isinstance(payload['audit_events'], list)
    assert 'freeze_state' in payload
    assert 'module_locks' in payload
    assert payload['generated_by']['id'] == admin_id


def test_incident_postmortem_evidence_csv_export(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-evidence-csv', email='admin-evidence-csv@example.com', role='admin')

    _login_as(client, admin_id)
    incident_id = _create_incident(client, summary='=INCIDENT_CSV_FORMULA')

    export_response = client.get(f'/admin/v2/incidents/{incident_id}/postmortem/evidence?format=csv')
    assert export_response.status_code == 200
    assert 'text/csv' in (export_response.headers.get('Content-Type') or '')
    assert 'attachment;' in (export_response.headers.get('Content-Disposition') or '')

    csv_text = export_response.data.decode('utf-8')
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = list(reader)
    assert rows

    summary_row = next((row for row in rows if row['section'] == 'incident' and row['field'] == 'summary'), None)
    assert summary_row is not None
    assert summary_row['value'].startswith("'=")


def test_incident_containment_records_audit_event(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-contain-audit', email='admin-contain-audit@example.com', role='admin')

    _login_as(client, admin_id)
    incident_id = _create_incident(client, summary='Contención con audit')
    _upsert_playbook(
        client,
        playbook_key='audit_pb',
        name='Audit PB',
        definition={'actions': [{'type': 'revoke_sessions', 'scope': 'global'}]},
    )

    response = client.post(f'/admin/v2/incidents/{incident_id}/contain', json={'playbook_key': 'audit_pb'})
    assert response.status_code == 200

    with app_module.app.app_context():
        audit_event = (
            AuditLedgerEvent.query
            .filter_by(action='incident_playbook_execute', incident_id=incident_id, actor_user_id=admin_id)
            .order_by(AuditLedgerEvent.id.desc())
            .first()
        )
        assert audit_event is not None
        metadata = json.loads(audit_event.metadata_json)
        assert metadata['playbook_key'] == 'audit_pb'
        assert metadata['incident_id'] == incident_id
        assert metadata['executed_count'] == 1


def test_revoke_sessions_global_sets_force_logout(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-global', email='admin-global@example.com', role='admin')
        user_1_id = _create_user(username='user-a', email='user-a@example.com', role='DI', is_active=True)
        user_2_id = _create_user(username='user-b', email='user-b@example.com', role='DI', is_active=True)
        _create_user(username='user-inactive', email='inactive@example.com', role='DI', is_active=False)

    _login_as(client, admin_id)
    incident_id = _create_incident(client)
    response = client.post(f'/admin/v2/incidents/{incident_id}/revoke-sessions', json={'scope': 'global'})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['affected'] == 2

    with app_module.app.app_context():
        user_1 = db.session.get(User, user_1_id)
        user_2 = db.session.get(User, user_2_id)
        admin = db.session.get(User, admin_id)
        assert user_1.force_logout is True
        assert user_2.force_logout is True
        assert admin.force_logout is False


def test_module_lock_blocks_tool_access(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-lock', email='admin-lock@example.com', role='admin')

    _login_as(client, admin_id)
    lock_response = client.post('/admin/v2/module-locks/toggle', json={
        'module_key': 'reports',
        'mode': 'lock',
        'reason': 'Investigación en curso',
    })
    assert lock_response.status_code == 200

    response = client.get('/', headers={'Accept': 'application/json'})
    assert response.status_code == 423
    payload = response.get_json()
    assert payload['success'] is False
    assert 'bloqueada' in payload['error']


def test_admin_freeze_blocks_legacy_admin_post(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-freeze', email='admin-freeze@example.com', role='admin')
        target_user_id = _create_user(username='target-user', email='target-user@example.com', role='DI', is_active=True)

    _login_as(client, admin_id)
    incident_id = _create_incident(client, summary='Congelar administración')

    freeze_response = client.post(f'/admin/v2/incidents/{incident_id}/freeze', json={
        'mode': 'freeze',
        'reason': 'Contención de incidente',
    })
    assert freeze_response.status_code == 200

    response = client.post(f'/admin/users/{target_user_id}/toggle', follow_redirects=False)
    assert response.status_code == 302
    assert '/admin/v2/' in response.headers.get('Location', '')

    with app_module.app.app_context():
        target_user = db.session.get(User, target_user_id)
        assert target_user.is_active is True


def test_tasks_module_lock_blocks_tasks_access(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-tasks-lock', email='admin-tasks-lock@example.com', role='admin')
        db.session.add(ModuleLock(module_key='tasks', lock_state='locked', reason='Contención'))
        db.session.commit()

    _login_as(client, admin_id)
    response = client.get('/api/tasks', headers={'Accept': 'application/json'})

    assert response.status_code == 423
    payload = response.get_json()
    assert payload['success'] is False
    assert 'tasks' in payload['error']


def test_tasks_module_lock_blocks_tasks_admin_bulk_update_without_freeze(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-tasks-lock-bulk', email='admin-tasks-lock-bulk@example.com', role='admin')
        assignee_id = _create_user(username='assignee-lock-bulk', email='assignee-lock-bulk@example.com', role='DI')

        task = Task(
            title='Tarea lock bulk',
            due_date=app_module.datetime.utcnow().date(),
            status='Pendiente',
            area='DI',
            creator_id=admin_id,
            assignee_id=assignee_id,
        )
        db.session.add(task)
        db.session.add(ModuleLock(module_key='tasks', lock_state='locked', reason='Contención'))
        db.session.commit()
        task_id = task.id

    _login_as(client, admin_id)
    response = client.post('/api/admin/tasks/bulk-update', json={
        'task_ids': [task_id],
        'status': 'En Progreso',
    })

    assert response.status_code == 423
    payload = response.get_json()
    assert payload['success'] is False
    assert 'tasks' in payload['error']

    with app_module.app.app_context():
        unchanged_task = db.session.get(Task, task_id)
        assert unchanged_task.status == 'Pendiente'


def test_admin_freeze_blocks_tasks_admin_bulk_update(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-freeze-tasks', email='admin-freeze-tasks@example.com', role='admin')
        assignee_id = _create_user(username='assignee-freeze', email='assignee-freeze@example.com', role='DI')

        task = Task(
            title='Tarea freeze',
            due_date=app_module.datetime.utcnow().date(),
            status='Pendiente',
            area='DI',
            creator_id=admin_id,
            assignee_id=assignee_id,
        )
        db.session.add(task)
        db.session.commit()
        task_id = task.id

    _login_as(client, admin_id)
    incident_id = _create_incident(client, summary='Freeze para mutaciones admin tasks')

    freeze_response = client.post(f'/admin/v2/incidents/{incident_id}/freeze', json={
        'mode': 'freeze',
        'reason': 'Contención de incidente',
    })
    assert freeze_response.status_code == 200

    response = client.post('/api/admin/tasks/bulk-update', json={
        'task_ids': [task_id],
        'status': 'En Progreso',
    })

    assert response.status_code == 423
    payload = response.get_json()
    assert payload['success'] is False
    assert 'congelado' in payload['error']

    with app_module.app.app_context():
        unchanged_task = db.session.get(Task, task_id)
        assert unchanged_task.status == 'Pendiente'


def test_identity_page_requires_admin(client):
    with app_module.app.app_context():
        user_id = _create_user(username='non-admin-identity', email='non-admin-identity@example.com', role='DI')

    _login_as(client, user_id)
    response = client.get('/admin/v2/identity')

    assert response.status_code == 403


def test_admin_can_update_user_access_via_json(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-identity', email='admin-identity@example.com', role='admin')
        area = Area(name='Operaciones')
        role = Role(code='OPS', display_name='Operaciones')
        db.session.add(area)
        db.session.add(role)
        db.session.commit()
        area_id = area.id
        target_user_id = _create_user(username='target-identity', email='target-identity@example.com', role='DI')

    _login_as(client, admin_id)
    response = client.post(
        f'/admin/v2/identity/users/{target_user_id}/access',
        json={
            'role': 'OPS',
            'area_id': area_id,
            'is_active': False,
            'tools': ['reports', 'tasks'],
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['user']['role'] == 'OPS'
    assert payload['user']['area_id'] == area_id
    assert payload['user']['is_active'] is False
    assert payload['user']['force_logout'] is True

    with app_module.app.app_context():
        target_user = db.session.get(User, target_user_id)
        assert target_user.role == 'OPS'
        assert target_user.area_id == area_id
        assert target_user.is_active is False
        assert target_user.force_logout is True
        assert set(target_user.get_allowed_tools()) == {'reports', 'tasks'}


def test_identity_allows_updating_legacy_role_user_without_changing_role(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-identity-legacy', email='admin-identity-legacy@example.com', role='admin')
        area = Area(name='Data Intelligence')
        db.session.add(area)
        db.session.commit()
        area_id = area.id
        target_user_id = _create_user(username='target-legacy', email='target-legacy@example.com', role='DI')

    _login_as(client, admin_id)
    response = client.post(
        f'/admin/v2/identity/users/{target_user_id}/access',
        json={
            'area_id': area_id,
            'is_active': False,
            'tools': ['reports'],
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['user']['role'] == 'DI'
    assert payload['user']['area_id'] == area_id
    assert payload['user']['is_active'] is False
    assert payload['user']['force_logout'] is True

    with app_module.app.app_context():
        target_user = db.session.get(User, target_user_id)
        assert target_user.role == 'DI'
        assert target_user.area_id == area_id
        assert target_user.is_active is False
        assert target_user.force_logout is True
        assert set(target_user.get_allowed_tools()) == {'reports'}


def test_identity_prevents_modifying_default_admin(client):
    with app_module.app.app_context():
        admin_user_id = _create_user(username='default-admin', email='admin@dataintel.com', role='admin')
        admin_id = _create_user(username='admin-updater', email='admin-updater@example.com', role='admin')

    _login_as(client, admin_id)
    response = client.post(
        f'/admin/v2/identity/users/{admin_user_id}/access',
        json={'role': 'DI'},
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload['success'] is False
    assert 'predeterminada' in payload['error']


def test_identity_prevents_self_deactivation(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-self', email='admin-self@example.com', role='admin')

    _login_as(client, admin_id)
    response = client.post(
        f'/admin/v2/identity/users/{admin_id}/access',
        json={'is_active': False},
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload['success'] is False
    assert 'desactivarte a ti mismo' in payload['error']


def test_identity_prevents_self_role_demotion(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-self-role', email='admin-self-role@example.com', role='admin')
        db.session.add(Role(code='OPS', display_name='Operaciones'))
        db.session.commit()

    _login_as(client, admin_id)
    response = client.post(
        f'/admin/v2/identity/users/{admin_id}/access',
        json={'role': 'OPS'},
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload['success'] is False
    assert 'rol admin' in payload['error']

    with app_module.app.app_context():
        admin_user = db.session.get(User, admin_id)
        assert admin_user.role == 'admin'


def test_revoke_session_identity_sets_force_logout(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-revoke', email='admin-revoke@example.com', role='admin')
        target_user_id = _create_user(username='user-revoke', email='user-revoke@example.com', role='DI')

    _login_as(client, admin_id)
    response = client.post(f'/admin/v2/identity/users/{target_user_id}/revoke-session', json={})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True

    with app_module.app.app_context():
        target_user = db.session.get(User, target_user_id)
        assert target_user.force_logout is True


def test_identity_prevents_revoking_default_admin_session(client):
    with app_module.app.app_context():
        default_admin_id = _create_user(username='default-admin-revoke', email=DEFAULT_ADMIN_EMAIL, role='admin')
        admin_id = _create_user(username='admin-revoke-default', email='admin-revoke-default@example.com', role='admin')

    _login_as(client, admin_id)
    response = client.post(f'/admin/v2/identity/users/{default_admin_id}/revoke-session', json={})

    assert response.status_code == 400
    payload = response.get_json()
    assert payload['success'] is False
    assert 'predeterminada' in payload['error']

    with app_module.app.app_context():
        default_admin = db.session.get(User, default_admin_id)
        assert default_admin.force_logout is False


def test_operations_page_requires_admin(client):
    with app_module.app.app_context():
        user_id = _create_user(username='non-admin-ops', email='non-admin-ops@example.com', role='DI')

    _login_as(client, user_id)
    response = client.get('/admin/v2/operations')

    assert response.status_code == 403


def test_admin_can_create_job_and_retry(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-ops-create', email='admin-ops-create@example.com', role='admin')

    _login_as(client, admin_id)

    create_response = client.post('/admin/v2/operations/jobs/new', json={
        'job_type': 'sync_users',
        'module_key': 'reports',
        'payload_json': '{"tenant": "acme"}',
    })
    assert create_response.status_code == 201
    create_payload = create_response.get_json()
    assert create_payload['success'] is True
    job_id = create_payload['job']['id']

    fail_response = client.post(f'/admin/v2/operations/jobs/{job_id}/status', json={
        'status': 'running',
    })
    assert fail_response.status_code == 200

    fail_response = client.post(f'/admin/v2/operations/jobs/{job_id}/status', json={
        'status': 'failed',
        'error_message': 'upstream error',
    })
    assert fail_response.status_code == 200

    retry_response = client.post(f'/admin/v2/operations/jobs/{job_id}/retry', json={})
    assert retry_response.status_code == 200
    retry_payload = retry_response.get_json()
    assert retry_payload['success'] is True
    assert retry_payload['job']['retry_count'] == 1
    assert retry_payload['run']['attempt'] == 2

    with app_module.app.app_context():
        job = db.session.get(OpsJob, job_id)
        assert job is not None
        assert job.status == 'queued'
        assert job.retry_count == 1

        runs = OpsJobRun.query.filter_by(job_id=job_id).order_by(OpsJobRun.attempt.asc()).all()
        assert len(runs) == 2
        assert runs[0].attempt == 1
        assert runs[1].attempt == 2


def test_operations_rejects_invalid_job_state_transition(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-ops-invalid-transition', email='admin-ops-invalid-transition@example.com', role='admin')

    _login_as(client, admin_id)

    create_response = client.post('/admin/v2/operations/jobs/new', json={
        'job_type': 'sync_users',
        'module_key': 'reports',
        'payload_json': '{"tenant": "acme"}',
    })
    assert create_response.status_code == 201
    job_id = create_response.get_json()['job']['id']

    invalid_transition_response = client.post(f'/admin/v2/operations/jobs/{job_id}/status', json={
        'status': 'done',
    })

    assert invalid_transition_response.status_code == 400
    payload = invalid_transition_response.get_json()
    assert payload['success'] is False
    assert 'Transición inválida' in payload['error']
    assert 'queued -> done' in payload['error']
    assert 'running' in payload['error']

    with app_module.app.app_context():
        job = db.session.get(OpsJob, job_id)
        assert job.status == 'queued'


def test_operations_retry_rejected_for_non_terminal_status(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-ops-retry-guard', email='admin-ops-retry-guard@example.com', role='admin')

    _login_as(client, admin_id)

    create_response = client.post('/admin/v2/operations/jobs/new', json={
        'job_type': 'sync_users',
        'module_key': 'reports',
        'payload_json': '{"tenant": "acme"}',
    })
    assert create_response.status_code == 201
    job_id = create_response.get_json()['job']['id']

    retry_response = client.post(f'/admin/v2/operations/jobs/{job_id}/retry', json={})
    assert retry_response.status_code == 400
    payload = retry_response.get_json()
    assert payload['success'] is False
    assert 'Retry no permitido' in payload['error']
    assert 'queued' in payload['error']


def test_config_sensitive_values_are_redacted_in_config_center_json(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-config-redacted', email='admin-config-redacted@example.com', role='admin')

    _login_as(client, admin_id)

    sensitive_create = client.post('/admin/v2/config/items/upsert', json={
        'namespace': 'secrets',
        'config_key': 'api_token',
        'value_json': '{"token": "super-secret"}',
        'is_sensitive': True,
    })
    assert sensitive_create.status_code == 201
    sensitive_id = sensitive_create.get_json()['item']['id']

    regular_create = client.post('/admin/v2/config/items/upsert', json={
        'namespace': 'ops',
        'config_key': 'max_workers',
        'value_json': '{"value": 3}',
        'is_sensitive': False,
    })
    assert regular_create.status_code == 201

    response = client.get(f'/admin/v2/config?item_id={sensitive_id}')
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True

    selected_item = payload['selected_item']
    assert selected_item['id'] == sensitive_id
    assert selected_item['is_sensitive'] is True
    assert selected_item['value_json'] == '***redacted***'
    assert selected_item['value_redacted'] is True

    sensitive_item = next(item for item in payload['items'] if item['id'] == sensitive_id)
    assert sensitive_item['value_json'] == '***redacted***'
    assert sensitive_item['value_redacted'] is True

    non_sensitive_item = next(item for item in payload['items'] if item['is_sensitive'] is False)
    assert non_sensitive_item['value_json'] != '***redacted***'
    assert non_sensitive_item['value_redacted'] is False

    assert len(payload['versions']) >= 1
    for version in payload['versions']:
        assert version['value_json'] == '***redacted***'
        assert version['value_redacted'] is True


def test_admin_can_update_job_status(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-ops-status', email='admin-ops-status@example.com', role='admin')

    _login_as(client, admin_id)

    create_response = client.post('/admin/v2/operations/jobs/new', json={
        'job_type': 'rebuild_cache',
        'module_key': 'tasks_dashboard',
        'payload_json': '{"scope": "all"}',
    })
    assert create_response.status_code == 201
    job_id = create_response.get_json()['job']['id']

    running_response = client.post(f'/admin/v2/operations/jobs/{job_id}/status', json={
        'status': 'running',
    })
    assert running_response.status_code == 200

    failed_response = client.post(f'/admin/v2/operations/jobs/{job_id}/status', json={
        'status': 'failed',
        'error_message': 'timeout during execution',
    })
    assert failed_response.status_code == 200
    failed_payload = failed_response.get_json()
    assert failed_payload['job']['status'] == 'failed'
    assert failed_payload['run']['status'] == 'failed'
    assert failed_payload['run']['error_message'] == 'timeout during execution'
    assert failed_payload['run']['finished_at'] is not None

    with app_module.app.app_context():
        job = db.session.get(OpsJob, job_id)
        assert job.status == 'failed'


def test_config_upsert_creates_and_updates_versions(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-config', email='admin-config@example.com', role='admin')

    _login_as(client, admin_id)

    create_response = client.post('/admin/v2/config/items/upsert', json={
        'namespace': 'ops',
        'config_key': 'max_workers',
        'value_json': '{"value": 3}',
        'is_sensitive': False,
        'reason': 'initial value',
    })
    assert create_response.status_code == 201
    create_payload = create_response.get_json()
    item_id = create_payload['item']['id']
    assert create_payload['item']['current_version'] == 1
    assert create_payload['version']['change_type'] == 'create'

    update_response = client.post('/admin/v2/config/items/upsert', json={
        'namespace': 'ops',
        'config_key': 'max_workers',
        'value_json': '{"value": 5}',
        'is_sensitive': True,
        'reason': 'scale up',
    })
    assert update_response.status_code == 200
    update_payload = update_response.get_json()
    assert update_payload['item']['id'] == item_id
    assert update_payload['item']['current_version'] == 2
    assert update_payload['item']['is_sensitive'] is True
    assert update_payload['version']['change_type'] == 'update'
    assert update_payload['version']['version'] == 2

    with app_module.app.app_context():
        item = db.session.get(ConfigItem, item_id)
        assert item is not None
        assert item.current_version == 2
        versions = ConfigVersion.query.filter_by(config_item_id=item_id).order_by(ConfigVersion.version.asc()).all()
        assert [v.version for v in versions] == [1, 2]
        assert [v.change_type for v in versions] == ['create', 'update']


def test_config_rollback_creates_new_version(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-config-rollback', email='admin-config-rollback@example.com', role='admin')

    _login_as(client, admin_id)

    create_response = client.post('/admin/v2/config/items/upsert', json={
        'namespace': 'feature_flags',
        'config_key': 'new_home',
        'value_json': '{"enabled": true}',
        'is_sensitive': False,
    })
    assert create_response.status_code == 201
    item_id = create_response.get_json()['item']['id']

    update_response = client.post('/admin/v2/config/items/upsert', json={
        'namespace': 'feature_flags',
        'config_key': 'new_home',
        'value_json': '{"enabled": false}',
        'is_sensitive': False,
    })
    assert update_response.status_code == 200

    rollback_response = client.post(f'/admin/v2/config/items/{item_id}/rollback', json={
        'target_version': 1,
        'reason': 'degraded experience rollback',
    })
    assert rollback_response.status_code == 200
    rollback_payload = rollback_response.get_json()
    assert rollback_payload['success'] is True
    assert rollback_payload['target_version'] == 1
    assert rollback_payload['version']['change_type'] == 'rollback'
    assert rollback_payload['version']['version'] == 3
    assert rollback_payload['item']['current_version'] == 3

    with app_module.app.app_context():
        item = db.session.get(ConfigItem, item_id)
        assert item.current_version == 3
        versions = ConfigVersion.query.filter_by(config_item_id=item_id).order_by(ConfigVersion.version.asc()).all()
        assert len(versions) == 3
        assert versions[-1].change_type == 'rollback'
        assert versions[-1].value_json == versions[0].value_json


def test_config_rejects_invalid_json_value(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-config-invalid', email='admin-config-invalid@example.com', role='admin')

    _login_as(client, admin_id)
    response = client.post('/admin/v2/config/items/upsert', json={
        'namespace': 'ops',
        'config_key': 'bad_json',
        'value_json': '{not-valid-json}',
        'is_sensitive': False,
    })

    assert response.status_code == 400
    payload = response.get_json()
    assert payload['success'] is False
    assert 'JSON válido' in payload['error']

    with app_module.app.app_context():
        item = ConfigItem.query.filter_by(namespace='ops', config_key='bad_json').first()
        assert item is None


def test_audit_page_requires_admin(client):
    with app_module.app.app_context():
        user_id = _create_user(username='non-admin-audit', email='non-admin-audit@example.com', role='DI')

    _login_as(client, user_id)
    response = client.get('/admin/v2/audit')

    assert response.status_code == 403


def test_audit_records_identity_update_before_after(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-audit-identity', email='admin-audit-identity@example.com', role='admin')
        target_user_id = _create_user(username='target-audit-identity', email='target-audit-identity@example.com', role='DI')
        role = Role(code='OPS', display_name='Operaciones')
        db.session.add(role)
        db.session.commit()

    _login_as(client, admin_id)
    response = client.post(
        f'/admin/v2/identity/users/{target_user_id}/access',
        json={'role': 'OPS', 'is_active': False, 'tools': ['reports']},
    )
    assert response.status_code == 200

    with app_module.app.app_context():
        event = (
            AuditLedgerEvent.query
            .filter_by(action='identity_update_user_access', target_user_id=target_user_id)
            .order_by(AuditLedgerEvent.id.desc())
            .first()
        )
        assert event is not None
        assert event.actor_user_id == admin_id
        assert event.module_key == 'identity'

        before_payload = json.loads(event.before_json)
        after_payload = json.loads(event.after_json)
        assert before_payload['role'] == 'DI'
        assert after_payload['role'] == 'OPS'
        assert before_payload['is_active'] is True
        assert after_payload['is_active'] is False


def test_audit_export_csv_by_actor(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-audit-csv', email='admin-audit-csv@example.com', role='admin')

    _login_as(client, admin_id)
    create_response = client.post('/admin/v2/operations/jobs/new', json={
        'job_type': 'sync_users',
        'module_key': 'reports',
        'payload_json': '{"tenant": "acme"}',
    })
    assert create_response.status_code == 201

    export_response = client.get(f'/admin/v2/audit/export?format=csv&actor_id={admin_id}')
    assert export_response.status_code == 200
    assert 'attachment;' in (export_response.headers.get('Content-Disposition') or '')

    csv_text = export_response.data.decode('utf-8')
    lines = [line for line in csv_text.splitlines() if line.strip()]
    assert len(lines) >= 2
    assert lines[0].startswith('id,timestamp,actor,target,module,action,resource_type,resource_id,incident_id,summary,before_json,after_json,metadata_json')
    assert any('operations_create_job' in line for line in lines[1:])


def test_audit_export_csv_sanitizes_formula_cells(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-audit-csv-sanitize', email='admin-audit-csv-sanitize@example.com', role='admin')
        event = AuditLedgerEvent(
            actor_user_id=admin_id,
            module_key='=malicious_module',
            action='+malicious_action',
            resource_type='@malicious_resource',
            resource_id='-42',
            summary='=HYPERLINK("https://evil.example", "click")',
            before_json='{"formula":"=SUM(1,1)"}',
            after_json='{"command":"+CMD"}',
            metadata_json='{"mention":"@test"}',
        )
        db.session.add(event)
        db.session.commit()
        event_id = event.id

    _login_as(client, admin_id)
    export_response = client.get(f'/admin/v2/audit/export?format=csv&actor_id={admin_id}')
    assert export_response.status_code == 200

    csv_text = export_response.data.decode('utf-8')
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = list(reader)
    target_row = next((row for row in rows if row['id'] == str(event_id)), None)

    assert target_row is not None
    assert target_row['module'].startswith("'=")
    assert target_row['action'].startswith("'+")
    assert target_row['resource_type'].startswith("'@")
    assert target_row['resource_id'].startswith("'-")
    assert target_row['summary'].startswith("'=")


def test_audit_export_json_by_incident(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-audit-json', email='admin-audit-json@example.com', role='admin')

    _login_as(client, admin_id)
    incident_id = _create_incident(client, summary='Incidente para export JSON')
    resolve_response = client.post(f'/admin/v2/incidents/{incident_id}/resolve', json={})
    assert resolve_response.status_code == 200

    export_response = client.get(f'/admin/v2/audit/export?format=json&incident_id={incident_id}')
    assert export_response.status_code == 200
    assert 'application/json' in (export_response.headers.get('Content-Type') or '')

    payload = json.loads(export_response.data.decode('utf-8'))
    assert isinstance(payload, list)
    assert len(payload) >= 1
    assert all(item['incident_id'] == incident_id for item in payload)


def test_audit_timeline_routes_apply_filters(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-audit-timeline', email='admin-audit-timeline@example.com', role='admin')
        target_user_id = _create_user(username='target-audit-timeline', email='target-audit-timeline@example.com', role='DI')

    _login_as(client, admin_id)
    incident_id = _create_incident(client, summary='Timeline incident')
    revoke_response = client.post(f'/admin/v2/incidents/{incident_id}/revoke-sessions', json={'scope': 'user', 'user_id': target_user_id})
    assert revoke_response.status_code == 200

    incident_timeline = client.get(f'/admin/v2/audit/timeline/incident/{incident_id}')
    assert incident_timeline.status_code == 200
    incident_payload = incident_timeline.get_json()
    assert incident_payload['success'] is True
    assert incident_payload['filters']['incident_id'] == incident_id
    assert len(incident_payload['items']) >= 1
    assert all(item['incident_id'] == incident_id for item in incident_payload['items'])

    actor_timeline = client.get(f'/admin/v2/audit/timeline/actor/{admin_id}')
    assert actor_timeline.status_code == 200
    actor_payload = actor_timeline.get_json()
    assert actor_payload['success'] is True
    assert actor_payload['filters']['actor_id'] == admin_id
    assert len(actor_payload['items']) >= 1
    assert all(item['actor_user_id'] == admin_id for item in actor_payload['items'])


def test_audit_access_and_export_routes_are_logged(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-audit-forensics', email='admin-audit-forensics@example.com', role='admin')

    _login_as(client, admin_id)
    incident_id = _create_incident(client, summary='Forensics access')

    ledger_response = client.get('/admin/v2/audit?page=1&per_page=5')
    assert ledger_response.status_code == 200
    ledger_payload = ledger_response.get_json()
    assert ledger_payload['success'] is True
    assert all(item['action'] != 'audit_view' for item in ledger_payload['items'])

    export_response = client.get(f'/admin/v2/audit/export?format=csv&incident_id={incident_id}')
    assert export_response.status_code == 200

    timeline_incident_response = client.get(f'/admin/v2/audit/timeline/incident/{incident_id}')
    assert timeline_incident_response.status_code == 200

    timeline_actor_response = client.get(f'/admin/v2/audit/timeline/actor/{admin_id}')
    assert timeline_actor_response.status_code == 200

    with app_module.app.app_context():
        forensic_events = (
            AuditLedgerEvent.query
            .filter_by(module_key='audit', actor_user_id=admin_id)
            .order_by(AuditLedgerEvent.id.asc())
            .all()
        )
        actions = [event.action for event in forensic_events]
        assert 'audit_view' in actions
        assert 'audit_export_csv' in actions
        assert 'audit_timeline_incident' in actions
        assert 'audit_timeline_actor' in actions

        audit_view_event = next(event for event in forensic_events if event.action == 'audit_view')
        audit_view_metadata = json.loads(audit_view_event.metadata_json)
        assert audit_view_metadata['page'] == 1
        assert audit_view_metadata['per_page'] == 5
        assert 'items_count' in audit_view_metadata

        export_event = next(event for event in forensic_events if event.action == 'audit_export_csv')
        export_metadata = json.loads(export_event.metadata_json)
        assert export_metadata['format'] == 'csv'
        assert export_metadata['filters']['incident_id'] == incident_id
        assert 'rows_count' in export_metadata


def test_audit_config_sensitive_payload_is_redacted_in_events(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-audit-sensitive', email='admin-audit-sensitive@example.com', role='admin')

    _login_as(client, admin_id)
    upsert_response = client.post('/admin/v2/config/items/upsert', json={
        'namespace': 'secrets',
        'config_key': 'token',
        'value_json': '{"token":"super-secret-value"}',
        'is_sensitive': True,
    })
    assert upsert_response.status_code == 201

    with app_module.app.app_context():
        event = (
            AuditLedgerEvent.query
            .filter_by(action='config_upsert_item', module_key='config')
            .order_by(AuditLedgerEvent.id.desc())
            .first()
        )
        assert event is not None
        serialized = ' '.join(filter(None, [event.before_json, event.after_json, event.metadata_json]))
        assert 'super-secret-value' not in serialized
        assert '***redacted***' in (event.after_json or '')


def test_audit_export_requires_restrictive_filters(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-audit-restrictive', email='admin-audit-restrictive@example.com', role='admin')

    _login_as(client, admin_id)
    response = client.get('/admin/v2/audit/export?format=csv')

    assert response.status_code == 400
    payload = response.get_json()
    assert payload['success'] is False
    assert 'filtro restrictivo' in payload['error']


def test_audit_export_rejects_invalid_date_range(client):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-audit-invalid-range', email='admin-audit-invalid-range@example.com', role='admin')

    _login_as(client, admin_id)
    response = client.get('/admin/v2/audit/export?format=json&date_from=2026-04-10&date_to=2026-04-01')

    assert response.status_code == 400
    payload = response.get_json()
    assert payload['success'] is False
    assert 'rango inválido' in payload['error']


def test_audit_event_serialization_redacts_sensitive_keys(client):
    with app_module.app.app_context():
        actor_id = _create_user(username='admin-audit-serialize', email='admin-audit-serialize@example.com', role='admin')
        event = AuditLedgerEvent(
            actor_user_id=actor_id,
            module_key='security',
            action='test_redaction',
            resource_type='test_resource',
            summary='redaction test',
            before_json=json.dumps({'password': 'plaintext', 'profile': {'token': 'abc'}}),
            after_json=json.dumps({'api_key': 'key-123', 'nested': {'authorization': 'Bearer xxx'}}),
            metadata_json=json.dumps({'cookie': 'session-cookie', 'items': [{'session_id': 'sess-1'}]}),
        )
        db.session.add(event)
        db.session.commit()
        event_id = event.id

        persisted = db.session.get(AuditLedgerEvent, event_id)
        serialized = admin_v2_module._serialize_audit_event(persisted)

    assert serialized['before']['password'] == '***redacted***'
    assert serialized['before']['profile']['token'] == '***redacted***'
    assert serialized['after']['api_key'] == '***redacted***'
    assert serialized['after']['nested']['authorization'] == '***redacted***'
    assert serialized['metadata']['cookie'] == '***redacted***'
    assert serialized['metadata']['items'][0]['session_id'] == '***redacted***'
    assert 'plaintext' not in (serialized['before_json'] or '')
    assert 'key-123' not in (serialized['after_json'] or '')
    assert 'session-cookie' not in (serialized['metadata_json'] or '')


def test_audit_export_enforces_max_rows_limit(client, monkeypatch):
    with app_module.app.app_context():
        admin_id = _create_user(username='admin-audit-max-rows', email='admin-audit-max-rows@example.com', role='admin')

    _login_as(client, admin_id)
    monkeypatch.setattr(admin_v2_module, 'AUDIT_EXPORT_MAX_ROWS', 1)

    first_create = client.post('/admin/v2/operations/jobs/new', json={
        'job_type': 'sync_users',
        'module_key': 'reports',
        'payload_json': '{"tenant": "acme-1"}',
    })
    second_create = client.post('/admin/v2/operations/jobs/new', json={
        'job_type': 'sync_users',
        'module_key': 'reports',
        'payload_json': '{"tenant": "acme-2"}',
    })
    assert first_create.status_code == 201
    assert second_create.status_code == 201

    export_response = client.get(f'/admin/v2/audit/export?format=csv&actor_id={admin_id}')
    assert export_response.status_code == 400
    payload = export_response.get_json()
    assert payload['success'] is False
    assert 'máximo permitido' in payload['error']
