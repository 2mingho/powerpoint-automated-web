import json
import os
import random
import csv
import io
from datetime import datetime, timedelta

from flask import Blueprint, Response, flash, jsonify, redirect, render_template, request, url_for
from flask_login import current_user
from jinja2 import TemplateNotFound

from blueprints.admin import DEFAULT_ADMIN_EMAIL, admin_required, is_default_admin, log_activity
from extensions import db
from models import (
    AdminFreezeState,
    AuditLedgerEvent,
    Area,
    ConfigItem,
    ConfigVersion,
    IncidentAction,
    IncidentEvent,
    IncidentPlaybook,
    ModuleLock,
    OpsJob,
    OpsJobRun,
    Role,
    User,
)


admin_v2_bp = Blueprint('admin_v2', __name__, url_prefix='/admin')


@admin_v2_bp.route('/')
@admin_required
def admin_root():
    return redirect(url_for('admin_v2.cli_terminal'))


@admin_v2_bp.route('/cli')
@admin_required
def cli_terminal():
    return render_template('admin_v2_cli.html')


VALID_INCIDENT_SEVERITIES = {'low', 'medium', 'high', 'critical'}
VALID_MODULE_KEYS = set(User.ALL_TOOLS.keys()) | {'tasks_dashboard'}
VALID_PLAYBOOK_ACTION_TYPES = {'freeze', 'revoke_sessions', 'module_lock'}
MAX_PLAYBOOK_ACTIONS = 25
VALID_JOB_STATUSES = {'queued', 'running', 'failed', 'done', 'cancelled'}
ALLOWED_JOB_STATUS_TRANSITIONS = {
    'queued': {'running', 'cancelled'},
    'running': {'done', 'failed', 'cancelled'},
    'failed': {'queued', 'cancelled'},
    'done': {'queued'},
    'cancelled': {'queued'},
}
RETRYABLE_JOB_STATUSES = {'failed', 'cancelled', 'done'}
REDACTED_CONFIG_VALUE = '***redacted***'
REDACTED_AUDIT_VALUE = '***redacted***'
SENSITIVE_AUDIT_KEY_PATTERNS = (
    'password',
    'secret',
    'token',
    'api_key',
    'authorization',
    'cookie',
    'credential',
    'session',
)


def _default_incident_playbook_seeds():
    return [
        {
            'playbook_key': 'strict_containment',
            'name': 'Strict Containment',
            'description': 'Freeze total, revocación global de sesiones y bloqueo de módulos críticos.',
            'definition': {
                'actions': [
                    {'type': 'freeze', 'mode': 'freeze', 'reason': 'Contención estricta por incidente activo'},
                    {'type': 'revoke_sessions', 'scope': 'global'},
                    {'type': 'module_lock', 'module_key': 'reports', 'mode': 'lock', 'reason': 'Contención estricta'},
                    {'type': 'module_lock', 'module_key': 'classification', 'mode': 'lock', 'reason': 'Contención estricta'},
                    {'type': 'module_lock', 'module_key': 'file_merge', 'mode': 'lock', 'reason': 'Contención estricta'},
                    {'type': 'module_lock', 'module_key': 'csv_analysis', 'mode': 'lock', 'reason': 'Contención estricta'},
                    {'type': 'module_lock', 'module_key': 'tasks', 'mode': 'lock', 'reason': 'Contención estricta'},
                ]
            },
            'is_enabled': True,
        },
        {
            'playbook_key': 'business_containment',
            'name': 'Business Containment',
            'description': 'Revoca sesiones y bloquea módulos de reportes/archivos sin freeze total.',
            'definition': {
                'actions': [
                    {'type': 'revoke_sessions', 'scope': 'global'},
                    {'type': 'module_lock', 'module_key': 'reports', 'mode': 'lock', 'reason': 'Contención de negocio'},
                    {'type': 'module_lock', 'module_key': 'file_merge', 'mode': 'lock', 'reason': 'Contención de negocio'},
                    {'type': 'module_lock', 'module_key': 'csv_analysis', 'mode': 'lock', 'reason': 'Contención de negocio'},
                ]
            },
            'is_enabled': True,
        },
    ]


def _env_int(name, default):
    raw = os.getenv(name)
    if raw in (None, ''):
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


AUDIT_EXPORT_MAX_ROWS = max(1, _env_int('AUDIT_EXPORT_MAX_ROWS', 10000))
AUDIT_EXPORT_MAX_DATE_RANGE_DAYS = max(1, _env_int('AUDIT_EXPORT_MAX_DATE_RANGE_DAYS', 31))


def _is_ajax_request():
    return (request.headers.get('X-Requested-With', '') or '').lower() == 'xmlhttprequest'


def _wants_html_response():
    if request.is_json or _is_ajax_request():
        return False

    accept_header = (request.headers.get('Accept', '') or '').lower()
    if 'text/html' not in accept_header:
        return False

    return request.accept_mimetypes['text/html'] >= request.accept_mimetypes['application/json']


def _is_html_form_submit():
    if not _wants_html_response():
        return False

    content_type = ((request.content_type or '').split(';', 1)[0] or '').strip().lower()
    return content_type in {'application/x-www-form-urlencoded', 'multipart/form-data'}


def _payload_value(key, default=None):
    if request.is_json:
        payload = request.get_json(silent=True) or {}
        return payload.get(key, default)
    # Check URL query parameters first
    url_param = request.args.get(key)
    if url_param is not None:
        return url_param
    # Then check form data
    return request.form.get(key, default)


def _serialize_incident(incident):
    return {
        'id': incident.id,
        'incident_code': incident.incident_code,
        'severity': incident.severity,
        'status': incident.status,
        'summary': incident.summary,
        'declared_by': incident.declared_by,
        'declared_at': incident.declared_at.isoformat() if incident.declared_at else None,
        'resolved_at': incident.resolved_at.isoformat() if incident.resolved_at else None,
    }


def _serialize_freeze_state(state):
    if not state:
        return {
            'is_frozen': False,
            'reason': None,
            'updated_by': None,
            'updated_at': None,
        }
    return {
        'is_frozen': state.is_frozen,
        'reason': state.reason,
        'updated_by': state.updated_by,
        'updated_at': state.updated_at.isoformat() if state.updated_at else None,
    }


def _serialize_module_lock(lock):
    return {
        'module_key': lock.module_key,
        'lock_state': lock.lock_state,
        'reason': lock.reason,
        'updated_by': lock.updated_by,
        'updated_at': lock.updated_at.isoformat() if lock.updated_at else None,
    }


def _serialize_incident_playbook(playbook):
    return {
        'id': playbook.id,
        'playbook_key': playbook.playbook_key,
        'name': playbook.name,
        'description': playbook.description,
        'definition_json': playbook.definition_json,
        'definition': _safe_json_loads(playbook.definition_json),
        'is_enabled': playbook.is_enabled,
        'created_by': playbook.created_by,
        'updated_by': playbook.updated_by,
        'created_at': playbook.created_at.isoformat() if playbook.created_at else None,
        'updated_at': playbook.updated_at.isoformat() if playbook.updated_at else None,
    }


def _serialize_ops_job(job):
    return {
        'id': job.id,
        'job_type': job.job_type,
        'module_key': job.module_key,
        'status': job.status,
        'payload_json': job.payload_json,
        'created_by': job.created_by,
        'created_at': job.created_at.isoformat() if job.created_at else None,
        'updated_at': job.updated_at.isoformat() if job.updated_at else None,
        'retry_count': job.retry_count,
    }


def _serialize_ops_job_run(run):
    return {
        'id': run.id,
        'job_id': run.job_id,
        'attempt': run.attempt,
        'status': run.status,
        'error_message': run.error_message,
        'started_at': run.started_at.isoformat() if run.started_at else None,
        'finished_at': run.finished_at.isoformat() if run.finished_at else None,
        'created_at': run.created_at.isoformat() if run.created_at else None,
    }


def _serialize_config_item(item):
    value_is_redacted = bool(item.is_sensitive)
    serialized_value = REDACTED_CONFIG_VALUE if value_is_redacted else item.value_json
    return {
        'id': item.id,
        'namespace': item.namespace,
        'config_key': item.config_key,
        'value_json': serialized_value,
        'value_redacted': value_is_redacted,
        'current_version': item.current_version,
        'is_sensitive': item.is_sensitive,
        'updated_by': item.updated_by,
        'updated_at': item.updated_at.isoformat() if item.updated_at else None,
    }


def _serialize_config_version(version):
    is_sensitive = bool(version.config_item.is_sensitive) if version.config_item else False
    serialized_value = REDACTED_CONFIG_VALUE if is_sensitive else version.value_json
    return {
        'id': version.id,
        'config_item_id': version.config_item_id,
        'version': version.version,
        'value_json': serialized_value,
        'value_redacted': is_sensitive,
        'change_type': version.change_type,
        'reason': version.reason,
        'changed_by': version.changed_by,
        'created_at': version.created_at.isoformat() if version.created_at else None,
    }


def _safe_json_loads(value):
    if value in (None, ''):
        return None
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _serialize_audit_event(event):
    before = _redact_sensitive_payload(_safe_json_loads(event.before_json))
    after = _redact_sensitive_payload(_safe_json_loads(event.after_json))
    metadata = _redact_sensitive_payload(_safe_json_loads(event.metadata_json))

    return {
        'id': event.id,
        'actor_user_id': event.actor_user_id,
        'actor': {
            'id': event.actor_user.id,
            'email': event.actor_user.email,
            'username': event.actor_user.username,
        } if event.actor_user else None,
        'target_user_id': event.target_user_id,
        'target': {
            'id': event.target_user.id,
            'email': event.target_user.email,
            'username': event.target_user.username,
        } if event.target_user else None,
        'incident_id': event.incident_id,
        'module_key': event.module_key,
        'action': event.action,
        'resource_type': event.resource_type,
        'resource_id': event.resource_id,
        'summary': event.summary,
        'before': before,
        'after': after,
        'metadata': metadata,
        'before_json': _json_dump_or_none(before),
        'after_json': _json_dump_or_none(after),
        'metadata_json': _json_dump_or_none(metadata),
        'ip_address': event.ip_address,
        'user_agent': event.user_agent,
        'created_at': event.created_at.isoformat() if event.created_at else None,
    }


def _json_dump_or_none(payload):
    if payload is None:
        return None
    return json.dumps(payload, ensure_ascii=False)


def _sanitize_csv_cell(value):
    text = '' if value is None else str(value)
    if text.startswith(('=', '+', '-', '@')):
        return f"'{text}"
    return text


def _is_sensitive_audit_key(key):
    lowered = str(key).strip().lower()
    if not lowered:
        return False
    return any(pattern in lowered for pattern in SENSITIVE_AUDIT_KEY_PATTERNS)


def _redact_sensitive_payload(payload):
    if isinstance(payload, dict):
        redacted = {}
        for key, value in payload.items():
            if _is_sensitive_audit_key(key):
                redacted[key] = REDACTED_AUDIT_VALUE
            else:
                redacted[key] = _redact_sensitive_payload(value)
        return redacted

    if isinstance(payload, list):
        return [_redact_sensitive_payload(item) for item in payload]

    return payload


def _record_audit_event(
    *,
    module_key,
    action,
    resource_type,
    resource_id=None,
    summary=None,
    target_user_id=None,
    incident_id=None,
    before=None,
    after=None,
    metadata=None,
):
    event = AuditLedgerEvent(
        actor_user_id=current_user.id,
        target_user_id=target_user_id,
        incident_id=incident_id,
        module_key=module_key,
        action=action,
        resource_type=resource_type,
        resource_id=(str(resource_id) if resource_id is not None else None),
        summary=summary,
        before_json=_json_dump_or_none(before),
        after_json=_json_dump_or_none(after),
        metadata_json=_json_dump_or_none(metadata),
        ip_address=request.remote_addr,
        user_agent=(request.headers.get('User-Agent') or None),
    )
    db.session.add(event)
    return event


def _snapshot_user_access(user):
    return _serialize_identity_user(user)


def _snapshot_ops_job(job):
    return _serialize_ops_job(job)


def _snapshot_config_item(item):
    if not item:
        return None
    return _serialize_config_item(item)


def _parse_audit_datetime(raw_value, *, end_of_day=False):
    if not raw_value:
        return None

    value = str(raw_value).strip()
    if not value:
        return None

    parsed = None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        try:
            parsed = datetime.strptime(value, '%Y-%m-%d')
        except ValueError:
            return None

    if len(value) <= 10 and end_of_day:
        parsed = parsed.replace(hour=23, minute=59, second=59, microsecond=999999)

    return parsed


def _build_audit_filters(overrides=None):
    overrides = overrides or {}
    actor_id = overrides.get('actor_id', request.args.get('actor_id', type=int))
    incident_id = overrides.get('incident_id', request.args.get('incident_id', type=int))
    module_key = (overrides.get('module_key', request.args.get('module_key', '')) or '').strip()
    action = (overrides.get('action', request.args.get('action', '')) or '').strip()
    date_from = (overrides.get('date_from', request.args.get('date_from', '')) or '').strip()
    date_to = (overrides.get('date_to', request.args.get('date_to', '')) or '').strip()

    return {
        'actor_id': actor_id,
        'incident_id': incident_id,
        'module_key': module_key,
        'action': action,
        'date_from': date_from,
        'date_to': date_to,
    }


def _apply_audit_filters(query, filters):
    if filters.get('actor_id'):
        query = query.filter(AuditLedgerEvent.actor_user_id == filters['actor_id'])
    if filters.get('incident_id'):
        query = query.filter(AuditLedgerEvent.incident_id == filters['incident_id'])
    if filters.get('module_key'):
        query = query.filter(AuditLedgerEvent.module_key == filters['module_key'])
    if filters.get('action'):
        query = query.filter(AuditLedgerEvent.action.ilike(f"%{filters['action']}%"))

    from_dt = _parse_audit_datetime(filters.get('date_from'))
    to_dt = _parse_audit_datetime(filters.get('date_to'), end_of_day=True)
    if from_dt:
        query = query.filter(AuditLedgerEvent.created_at >= from_dt)
    if to_dt:
        query = query.filter(AuditLedgerEvent.created_at <= to_dt)

    return query


def _audit_base_query(filters):
    base_query = AuditLedgerEvent.query.order_by(AuditLedgerEvent.created_at.desc(), AuditLedgerEvent.id.desc())
    return _apply_audit_filters(base_query, filters)


def _validate_audit_export_filters(filters):
    actor_id = filters.get('actor_id')
    incident_id = filters.get('incident_id')
    date_from_raw = (filters.get('date_from') or '').strip()
    date_to_raw = (filters.get('date_to') or '').strip()

    from_dt = None
    to_dt = None

    if date_from_raw:
        from_dt = _parse_audit_datetime(date_from_raw)
        if not from_dt:
            return False, 'date_from inválido: use formato ISO o YYYY-MM-DD'

    if date_to_raw:
        to_dt = _parse_audit_datetime(date_to_raw, end_of_day=True)
        if not to_dt:
            return False, 'date_to inválido: use formato ISO o YYYY-MM-DD'

    if bool(date_from_raw) ^ bool(date_to_raw):
        return False, 'date_from y date_to son obligatorios juntos para rango de export'

    has_date_range = bool(date_from_raw and date_to_raw)
    if has_date_range:
        if to_dt < from_dt:
            return False, 'rango inválido: date_to debe ser mayor o igual que date_from'

        max_range = timedelta(days=AUDIT_EXPORT_MAX_DATE_RANGE_DAYS)
        if (to_dt - from_dt) > max_range:
            return False, f'rango inválido: máximo {AUDIT_EXPORT_MAX_DATE_RANGE_DAYS} días'

    if not (actor_id or incident_id or has_date_range):
        return False, 'export requiere filtro restrictivo: actor_id, incident_id o date_from+date_to'

    return True, None


def _audit_pagination_payload(page_obj):
    return {
        'page': page_obj.page,
        'per_page': page_obj.per_page,
        'total': page_obj.total,
        'pages': page_obj.pages,
        'has_prev': page_obj.has_prev,
        'has_next': page_obj.has_next,
    }


def _ops_error_response(message, status_code=400):
    if _is_html_form_submit():
        flash(message, 'error')
        return redirect(url_for('admin_v2.operations_console'))
    return jsonify({'success': False, 'error': message}), status_code


def _ops_success_response(message, *, status_code=200, extra_payload=None):
    if _is_html_form_submit():
        flash(message, 'success')
        return redirect(url_for('admin_v2.operations_console'))

    payload = {'success': True, 'message': message}
    if extra_payload:
        payload.update(extra_payload)
    return jsonify(payload), status_code


def _config_error_response(message, status_code=400, item_id=None):
    if _is_html_form_submit():
        flash(message, 'error')
        endpoint_kwargs = {'item_id': item_id} if item_id else {}
        return redirect(url_for('admin_v2.config_center', **endpoint_kwargs))
    return jsonify({'success': False, 'error': message}), status_code


def _config_success_response(message, *, item=None, status_code=200, extra_payload=None):
    if _is_html_form_submit():
        flash(message, 'success')
        endpoint_kwargs = {'item_id': item.id} if item else {}
        return redirect(url_for('admin_v2.config_center', **endpoint_kwargs))

    payload = {'success': True, 'message': message}
    if item is not None:
        payload['item'] = _serialize_config_item(item)
    if extra_payload:
        payload.update(extra_payload)
    return jsonify(payload), status_code


def _serialize_identity_user(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'role': user.role,
        'is_admin': user.is_admin,
        'is_active': user.is_active,
        'force_logout': user.force_logout,
        'area_id': user.area_id,
        'area_name': user.area.name if user.area else None,
        'tools': user.get_allowed_tools(),
        'is_default_admin': is_default_admin(user),
    }


def _serialize_effective_permissions(user):
    allowed = set(user.get_allowed_tools())
    all_tool_keys = set(User.ALL_TOOLS.keys())
    denied = sorted(all_tool_keys - allowed)
    allowed_sorted = sorted(allowed)

    return {
        'user_id': user.id,
        'is_admin': user.is_admin,
        'role': user.role,
        'area': {
            'id': user.area_id,
            'name': user.area.name if user.area else None,
        },
        'tools_allowed': [
            {'key': key, 'label': User.ALL_TOOLS[key]}
            for key in allowed_sorted
        ],
        'tools_denied': [
            {'key': key, 'label': User.ALL_TOOLS[key]}
            for key in denied
        ],
    }


def _parse_bool_field(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    value = str(value).strip().lower()
    if value in {'1', 'true', 'yes', 'on'}:
        return True
    if value in {'0', 'false', 'no', 'off'}:
        return False
    return None


def _identity_error_response(message, status_code=400, user_id=None):
    if _is_html_form_submit():
        flash(message, 'error')
        return redirect(url_for('admin_v2.identity_center', user_id=user_id))
    return jsonify({'success': False, 'error': message}), status_code


def _identity_success_response(message, user=None, status_code=200):
    if _is_html_form_submit():
        flash(message, 'success')
        return redirect(url_for('admin_v2.identity_center', user_id=(user.id if user else None)))

    payload = {'success': True, 'message': message}
    if user is not None:
        payload['user'] = _serialize_identity_user(user)
        payload['effective_permissions'] = _serialize_effective_permissions(user)
    return jsonify(payload), status_code


def _generate_incident_code():
    for _ in range(10):
        suffix = random.randint(1000, 9999)
        candidate = f"INC-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}-{suffix}"
        exists = IncidentEvent.query.filter_by(incident_code=candidate).first()
        if not exists:
            return candidate
    return f"INC-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}-{random.randint(10000, 99999)}"


def _get_or_create_freeze_state():
    state = db.session.get(AdminFreezeState, 1)
    if not state:
        state = AdminFreezeState(id=1, is_frozen=False, updated_by=current_user.id)
        db.session.add(state)
        db.session.flush()
    return state


def _validate_playbook_definition(definition_json):
    raw = definition_json
    parsed = None
    if isinstance(raw, dict):
        parsed = raw
    elif isinstance(raw, str):
        text = raw.strip()
        if not text:
            return False, 'definition_json es obligatorio', None, None
        try:
            parsed = json.loads(text)
        except (TypeError, ValueError, json.JSONDecodeError):
            return False, 'definition_json debe ser JSON válido', None, None
    else:
        return False, 'definition_json inválido', None, None

    if not isinstance(parsed, dict):
        return False, 'definition_json debe ser un objeto', None, None

    actions = parsed.get('actions')
    if not isinstance(actions, list) or len(actions) == 0:
        return False, 'definition_json.actions debe ser una lista no vacía', None, None

    if len(actions) > MAX_PLAYBOOK_ACTIONS:
        return False, f'definition_json.actions excede el máximo permitido ({MAX_PLAYBOOK_ACTIONS})', None, None

    normalized_actions = []
    for index, action in enumerate(actions):
        if not isinstance(action, dict):
            return False, f'actions[{index}] debe ser un objeto', None, None

        action_type = str(action.get('type') or '').strip().lower()
        if action_type not in VALID_PLAYBOOK_ACTION_TYPES:
            return False, f'actions[{index}].type inválido', None, None

        normalized_action = dict(action)
        normalized_action['type'] = action_type

        if action_type == 'freeze':
            mode = str(action.get('mode') or '').strip().lower()
            if mode not in {'freeze', 'unfreeze'}:
                return False, f'actions[{index}].mode debe ser freeze o unfreeze', None, None
            normalized_action['mode'] = mode
            reason = action.get('reason')
            if reason is not None:
                normalized_action['reason'] = str(reason).strip() or None

        elif action_type == 'revoke_sessions':
            scope = str(action.get('scope') or 'global').strip().lower()
            if scope != 'global':
                return False, f'actions[{index}].scope debe ser global', None, None
            normalized_action['scope'] = scope

        elif action_type == 'module_lock':
            module_key = str(action.get('module_key') or '').strip()
            if module_key not in VALID_MODULE_KEYS:
                return False, f'actions[{index}].module_key inválido', None, None
            mode = str(action.get('mode') or '').strip().lower()
            if mode not in {'lock', 'unlock'}:
                return False, f'actions[{index}].mode debe ser lock o unlock', None, None
            normalized_action['module_key'] = module_key
            normalized_action['mode'] = mode
            reason = action.get('reason')
            if reason is not None:
                normalized_action['reason'] = str(reason).strip() or None

        normalized_actions.append(normalized_action)

    normalized_definition = {'actions': normalized_actions}
    return True, None, normalized_definition, json.dumps(normalized_definition, ensure_ascii=False)


def _ensure_default_playbooks():
    changed = False
    for seed in _default_incident_playbook_seeds():
        playbook = IncidentPlaybook.query.filter_by(playbook_key=seed['playbook_key']).first()
        _, _, normalized_definition, normalized_json = _validate_playbook_definition(seed['definition'])
        if playbook:
            continue

        playbook = IncidentPlaybook(
            playbook_key=seed['playbook_key'],
            name=seed['name'],
            description=seed.get('description'),
            definition_json=normalized_json,
            is_enabled=bool(seed.get('is_enabled', True)),
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        db.session.add(playbook)
        changed = True

    if changed:
        db.session.flush()
    return changed


@admin_v2_bp.route('/identity')
@admin_required
def identity_center():
    users = User.query.order_by(User.created_at.desc()).all()
    roles = Role.query.order_by(Role.code).all()
    areas = Area.query.order_by(Area.name).all()

    selected_user = None
    selected_user_id = request.args.get('user_id', type=int)
    if selected_user_id:
        selected_user = db.session.get(User, selected_user_id)

    if not selected_user and users:
        selected_user = users[0]

    if _wants_html_response():
        return render_template(
            'admin_v2_identity.html',
            users=users,
            roles=roles,
            areas=areas,
            selected_user=selected_user,
            all_tools=User.ALL_TOOLS,
            selected_user_effective=(_serialize_effective_permissions(selected_user) if selected_user else None),
            default_admin_email=DEFAULT_ADMIN_EMAIL,
        )

    return jsonify({
        'success': True,
        'users': [_serialize_identity_user(user) for user in users],
        'meta': {
            'roles': ['admin'] + [role.code for role in roles],
            'areas': [{'id': area.id, 'name': area.name} for area in areas],
            'tools': User.ALL_TOOLS,
            'default_admin_email': DEFAULT_ADMIN_EMAIL,
        },
        'selected_user': _serialize_identity_user(selected_user) if selected_user else None,
        'selected_user_effective': _serialize_effective_permissions(selected_user) if selected_user else None,
    })


@admin_v2_bp.route('/identity/effective-permissions/<int:user_id>')
@admin_required
def identity_effective_permissions(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado'}), 404

    return jsonify({'success': True, 'effective_permissions': _serialize_effective_permissions(user)})


@admin_v2_bp.route('/identity/users/<int:user_id>/access', methods=['POST'])
@admin_required
def identity_update_user_access(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return _identity_error_response('Usuario no encontrado', 404, user_id=user_id)

    if is_default_admin(user):
        return _identity_error_response('La cuenta de administrador predeterminada no puede ser modificada.', 400, user_id=user_id)

    before_snapshot = _snapshot_user_access(user)

    payload = request.get_json(silent=True) if request.is_json else {}

    role = payload.get('role') if request.is_json else request.form.get('role')
    area_id_raw = payload.get('area_id') if request.is_json else request.form.get('area_id')
    is_active_raw = payload.get('is_active') if request.is_json else request.form.get('is_active')

    if request.is_json:
        tools_raw = payload.get('tools', None)
    else:
        tools_raw = request.form.getlist('tools')

    new_role = user.role if role is None else str(role).strip()
    role_codes = {r.code for r in Role.query.all()}
    existing_user_roles = {
        str(row_role).strip()
        for (row_role,) in db.session.query(User.role).distinct().all()
        if row_role and str(row_role).strip()
    }
    valid_roles = {'admin'} | role_codes | existing_user_roles | ({user.role} if user.role else set())
    if new_role not in valid_roles:
        return _identity_error_response('role inválido', 400, user_id=user_id)

    if user.id == current_user.id and current_user.is_admin and new_role != 'admin':
        return _identity_error_response('No puedes quitarte el rol admin a ti mismo.', 400, user_id=user_id)

    if area_id_raw in (None, ''):
        new_area_id = None
    else:
        try:
            new_area_id = int(area_id_raw)
        except (TypeError, ValueError):
            return _identity_error_response('area_id inválido', 400, user_id=user_id)
        if not db.session.get(Area, new_area_id):
            return _identity_error_response('area_id inexistente', 400, user_id=user_id)

    if is_active_raw is None:
        new_is_active = user.is_active
    else:
        parsed_active = _parse_bool_field(is_active_raw)
        if parsed_active is None:
            return _identity_error_response('is_active inválido', 400, user_id=user_id)
        new_is_active = parsed_active

    if user.id == current_user.id and not new_is_active:
        return _identity_error_response('No puedes desactivarte a ti mismo.', 400, user_id=user_id)

    if tools_raw is None:
        new_tools = user.get_allowed_tools()
    else:
        if not isinstance(tools_raw, list):
            return _identity_error_response('tools debe ser una lista', 400, user_id=user_id)
        invalid_tools = [tool for tool in tools_raw if tool not in User.ALL_TOOLS]
        if invalid_tools:
            return _identity_error_response('tools contiene claves inválidas', 400, user_id=user_id)
        new_tools = tools_raw

    changes = []
    if user.role != new_role:
        changes.append(f'role: {user.role}->{new_role}')
        user.role = new_role
    if user.area_id != new_area_id:
        changes.append(f'area_id: {user.area_id}->{new_area_id}')
        user.area_id = new_area_id
    if user.is_active != new_is_active:
        changes.append(f'is_active: {user.is_active}->{new_is_active}')
        user.is_active = new_is_active
        if not new_is_active:
            user.force_logout = True
            changes.append('force_logout: False->True (auto por desactivación)')

    old_tools = set(user.get_allowed_tools())
    user.set_allowed_tools(new_tools)
    updated_tools = set(user.get_allowed_tools())
    if old_tools != updated_tools:
        changes.append('tools actualizadas')

    _record_audit_event(
        module_key='identity',
        action='identity_update_user_access',
        resource_type='user',
        resource_id=user.id,
        target_user_id=user.id,
        summary=f'Actualización de accesos para usuario #{user.id}',
        before=before_snapshot,
        after=_snapshot_user_access(user),
        metadata={'changes': changes},
    )

    db.session.commit()
    log_activity(
        'admin_v2_identity_access_update',
        f'Usuario #{user.id} ({user.email}) actualizado. Cambios: {", ".join(changes) if changes else "sin cambios"}',
    )

    return _identity_success_response('Accesos actualizados correctamente.', user=user)


@admin_v2_bp.route('/identity/users/<int:user_id>/revoke-session', methods=['POST'])
@admin_required
def identity_revoke_session(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return _identity_error_response('Usuario no encontrado', 404, user_id=user_id)

    if is_default_admin(user):
        return _identity_error_response('La cuenta de administrador predeterminada no puede ser modificada.', 400, user_id=user_id)

    if user.id == current_user.id:
        return _identity_error_response('No puedes revocar tu propia sesión', 400, user_id=user_id)

    before_snapshot = _snapshot_user_access(user)
    user.force_logout = True

    _record_audit_event(
        module_key='identity',
        action='identity_revoke_session',
        resource_type='user',
        resource_id=user.id,
        target_user_id=user.id,
        summary=f'Revocación de sesión para usuario #{user.id}',
        before=before_snapshot,
        after=_snapshot_user_access(user),
    )

    db.session.commit()

    log_activity('admin_v2_identity_revoke_session', f'Revocada sesión de usuario #{user.id} ({user.email})')
    return _identity_success_response('Sesión revocada correctamente.', user=user)


@admin_v2_bp.route('/')
@admin_required
def dashboard():
    active_users = User.query.filter_by(is_active=True).count()
    open_incidents = IncidentEvent.query.filter_by(status='open').count()
    locked_modules = ModuleLock.query.filter_by(lock_state='locked').count()
    freeze_state = db.session.get(AdminFreezeState, 1)
    recent_incidents = (
        IncidentEvent.query
        .order_by(IncidentEvent.declared_at.desc())
        .limit(10)
        .all()
    )
    module_locks = ModuleLock.query.order_by(ModuleLock.updated_at.desc()).all()

    if _wants_html_response():
        return render_template(
            'admin_v2_dashboard.html',
            kpi_active_users=active_users,
            kpi_open_incidents=open_incidents,
            kpi_locked_modules=locked_modules,
            is_freeze_enabled=(freeze_state.is_frozen if freeze_state else False),
            recent_incidents=[_serialize_incident(incident) for incident in recent_incidents],
            module_locks=[
                {
                    'module_key': lock.module_key,
                    'module_name': lock.module_key,
                    'lock_state': lock.lock_state,
                    'status': lock.lock_state,
                    'reason': lock.reason,
                    'updated_by': lock.updated_by,
                    'updated_at': lock.updated_at.isoformat() if lock.updated_at else None,
                }
                for lock in module_locks
            ],
        )

    return jsonify({
        'success': True,
        'kpis': {
            'active_users': active_users,
            'open_incidents': open_incidents,
            'locked_modules': locked_modules,
        },
        'freeze_state': _serialize_freeze_state(freeze_state),
        'recent_incidents': [_serialize_incident(incident) for incident in recent_incidents],
    })


@admin_v2_bp.route('/operations')
@admin_required
def operations_console():
    jobs = OpsJob.query.order_by(OpsJob.created_at.desc()).limit(50).all()
    recent_runs = OpsJobRun.query.order_by(OpsJobRun.created_at.desc()).limit(50).all()
    module_locks = ModuleLock.query.order_by(ModuleLock.updated_at.desc()).all()

    if _wants_html_response():
        return render_template(
            'admin_v2_operations.html',
            jobs=jobs,
            recent_runs=recent_runs,
            module_locks=module_locks,
        )

    return jsonify({
        'success': True,
        'jobs': [_serialize_ops_job(job) for job in jobs],
        'recent_runs': [_serialize_ops_job_run(run) for run in recent_runs],
        'module_locks': {
            'total': len(module_locks),
            'locked': len([lock for lock in module_locks if lock.lock_state == 'locked']),
            'items': [_serialize_module_lock(lock) for lock in module_locks],
        },
    })


@admin_v2_bp.route('/operations/jobs/new', methods=['POST'])
@admin_required
def operations_create_job():
    job_type = (_payload_value('job_type', '') or '').strip()
    module_key = (_payload_value('module_key', '') or '').strip()
    payload_raw = _payload_value('payload_json')

    if not job_type:
        return _ops_error_response('job_type es obligatorio', 400)

    if not module_key:
        return _ops_error_response('module_key es obligatorio', 400)
    if module_key not in VALID_MODULE_KEYS:
        return _ops_error_response('module_key inválido', 400)

    payload_json = None
    if payload_raw not in (None, ''):
        try:
            parsed_payload = json.loads(payload_raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            return _ops_error_response('payload_json debe ser JSON válido', 400)
        payload_json = json.dumps(parsed_payload, ensure_ascii=False)

    now = datetime.utcnow()
    job = OpsJob(
        job_type=job_type,
        module_key=module_key,
        status='queued',
        payload_json=payload_json,
        created_by=current_user.id,
        created_at=now,
        updated_at=now,
        retry_count=0,
    )
    db.session.add(job)
    db.session.flush()

    run = OpsJobRun(
        job_id=job.id,
        attempt=1,
        status='queued',
    )
    db.session.add(run)
    db.session.flush()

    _record_audit_event(
        module_key='operations',
        action='operations_create_job',
        resource_type='ops_job',
        resource_id=job.id,
        summary=f'Creación de job #{job.id}',
        before=None,
        after=_snapshot_ops_job(job),
        metadata={'run_id': run.id, 'attempt': run.attempt},
    )

    db.session.commit()

    log_activity('admin_v2_ops_job_created', f'Job #{job.id} creado ({job.job_type}/{job.module_key})')
    return _ops_success_response(
        f'Job #{job.id} creado correctamente.',
        status_code=201,
        extra_payload={'job': _serialize_ops_job(job), 'run': _serialize_ops_job_run(run)},
    )


@admin_v2_bp.route('/operations/jobs/<int:job_id>/status', methods=['POST'])
@admin_required
def operations_update_job_status(job_id):
    job = db.session.get(OpsJob, job_id)
    if not job:
        return _ops_error_response('Job no encontrado', 404)

    before_snapshot = _snapshot_ops_job(job)

    status = (_payload_value('status', '') or '').strip().lower()
    error_message = (_payload_value('error_message', '') or '').strip() or None

    if status not in VALID_JOB_STATUSES:
        return _ops_error_response('status inválido', 400)

    current_status = (job.status or '').strip().lower()
    allowed_transitions = ALLOWED_JOB_STATUS_TRANSITIONS.get(current_status, set())
    if status not in allowed_transitions:
        allowed_list = ', '.join(sorted(allowed_transitions)) if allowed_transitions else '(ninguno)'
        return _ops_error_response(
            f'Transición inválida: {current_status} -> {status}. Permitidas desde {current_status}: {allowed_list}.',
            400,
        )

    latest_run = (
        OpsJobRun.query
        .filter_by(job_id=job.id)
        .order_by(OpsJobRun.attempt.desc(), OpsJobRun.id.desc())
        .first()
    )

    now = datetime.utcnow()
    job.status = status
    job.updated_at = now

    if latest_run:
        if status == 'running':
            latest_run.status = 'running'
            if not latest_run.started_at:
                latest_run.started_at = now

        if status in {'failed', 'done', 'cancelled'}:
            latest_run.status = status
            if not latest_run.started_at and status != 'queued':
                latest_run.started_at = now
            latest_run.finished_at = now
            latest_run.error_message = error_message if status == 'failed' else None
        elif error_message and status == 'running':
            latest_run.error_message = error_message

    _record_audit_event(
        module_key='operations',
        action='operations_update_job_status',
        resource_type='ops_job',
        resource_id=job.id,
        summary=f'Actualización de estado de job #{job.id} a {status}',
        before=before_snapshot,
        after=_snapshot_ops_job(job),
        metadata={
            'error_message': error_message,
            'latest_run_id': (latest_run.id if latest_run else None),
        },
    )

    db.session.commit()

    log_activity('admin_v2_ops_job_status_update', f'Job #{job.id} => {status}')
    return _ops_success_response(
        f'Estado del job #{job.id} actualizado a {status}.',
        extra_payload={
            'job': _serialize_ops_job(job),
            'run': (_serialize_ops_job_run(latest_run) if latest_run else None),
        },
    )


@admin_v2_bp.route('/operations/jobs/<int:job_id>/retry', methods=['POST'])
@admin_required
def operations_retry_job(job_id):
    job = db.session.get(OpsJob, job_id)
    if not job:
        return _ops_error_response('Job no encontrado', 404)

    before_snapshot = _snapshot_ops_job(job)

    current_status = (job.status or '').strip().lower()
    if current_status not in RETRYABLE_JOB_STATUSES:
        allowed_list = ', '.join(sorted(RETRYABLE_JOB_STATUSES))
        return _ops_error_response(
            f'Retry no permitido para estado actual "{current_status}". Estados permitidos: {allowed_list}.',
            400,
        )

    now = datetime.utcnow()
    job.retry_count = (job.retry_count or 0) + 1
    job.status = 'queued'
    job.updated_at = now

    run = OpsJobRun(
        job_id=job.id,
        attempt=job.retry_count + 1,
        status='queued',
    )
    db.session.add(run)
    db.session.flush()

    _record_audit_event(
        module_key='operations',
        action='operations_retry_job',
        resource_type='ops_job',
        resource_id=job.id,
        summary=f'Retry de job #{job.id}',
        before=before_snapshot,
        after=_snapshot_ops_job(job),
        metadata={'run_id': run.id, 'attempt': run.attempt},
    )

    db.session.commit()

    log_activity('admin_v2_ops_job_retry', f'Job #{job.id} reintentado. attempt={run.attempt}')
    return _ops_success_response(
        f'Job #{job.id} reencolado correctamente.',
        extra_payload={
            'job': _serialize_ops_job(job),
            'run': _serialize_ops_job_run(run),
        },
    )


@admin_v2_bp.route('/config')
@admin_required
def config_center():
    items = ConfigItem.query.order_by(ConfigItem.namespace.asc(), ConfigItem.config_key.asc()).all()

    selected_item = None
    item_id = request.args.get('item_id', type=int)
    if item_id:
        selected_item = db.session.get(ConfigItem, item_id)

    if not selected_item and items:
        selected_item = items[0]

    versions = []
    if selected_item:
        versions = (
            ConfigVersion.query
            .filter_by(config_item_id=selected_item.id)
            .order_by(ConfigVersion.version.desc())
            .all()
        )

    if _wants_html_response():
        return render_template(
            'admin_v2_config.html',
            items=items,
            selected_item=selected_item,
            versions=versions,
        )

    return jsonify({
        'success': True,
        'items': [_serialize_config_item(item) for item in items],
        'selected_item': (_serialize_config_item(selected_item) if selected_item else None),
        'versions': [_serialize_config_version(version) for version in versions],
    })


@admin_v2_bp.route('/config/items/upsert', methods=['POST'])
@admin_required
def config_upsert_item():
    namespace = (_payload_value('namespace', '') or '').strip()
    config_key = (_payload_value('config_key', '') or '').strip()
    value_json_raw = (_payload_value('value_json', '') or '').strip()
    reason = (_payload_value('reason', '') or '').strip() or None
    is_sensitive_raw = _payload_value('is_sensitive', False)
    is_sensitive = _parse_bool_field(is_sensitive_raw)

    if not namespace:
        return _config_error_response('namespace es obligatorio', 400)
    if not config_key:
        return _config_error_response('config_key es obligatorio', 400)
    if not value_json_raw:
        return _config_error_response('value_json es obligatorio', 400)
    if is_sensitive is None:
        return _config_error_response('is_sensitive inválido', 400)

    try:
        parsed_value = json.loads(value_json_raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return _config_error_response('value_json debe ser JSON válido', 400)

    value_json = json.dumps(parsed_value, ensure_ascii=False)
    now = datetime.utcnow()
    item = ConfigItem.query.filter_by(namespace=namespace, config_key=config_key).first()
    before_snapshot = _snapshot_config_item(item)

    if not item:
        item = ConfigItem(
            namespace=namespace,
            config_key=config_key,
            value_json=value_json,
            current_version=1,
            is_sensitive=is_sensitive,
            updated_by=current_user.id,
            updated_at=now,
        )
        db.session.add(item)
        db.session.flush()

        version = ConfigVersion(
            config_item_id=item.id,
            version=1,
            value_json=value_json,
            change_type='create',
            reason=reason,
            changed_by=current_user.id,
            created_at=now,
        )
        db.session.add(version)

        _record_audit_event(
            module_key='config',
            action='config_upsert_item',
            resource_type='config_item',
            resource_id=item.id,
            summary=f'Creación de config {namespace}.{config_key}',
            before=before_snapshot,
            after=_snapshot_config_item(item),
            metadata={'change_type': 'create', 'reason': reason, 'is_sensitive': is_sensitive},
        )

        db.session.commit()

        log_activity(
            'admin_v2_config_upsert',
            f'Config creada #{item.id} {namespace}.{config_key} v1; sensitive={is_sensitive}; reason={reason or "-"}',
        )
        return _config_success_response(
            f'Config {namespace}.{config_key} creada.',
            item=item,
            status_code=201,
            extra_payload={'version': _serialize_config_version(version)},
        )

    next_version = (item.current_version or 0) + 1
    item.value_json = value_json
    item.current_version = next_version
    item.is_sensitive = is_sensitive
    item.updated_by = current_user.id
    item.updated_at = now

    version = ConfigVersion(
        config_item_id=item.id,
        version=next_version,
        value_json=value_json,
        change_type='update',
        reason=reason,
        changed_by=current_user.id,
        created_at=now,
    )
    db.session.add(version)

    _record_audit_event(
        module_key='config',
        action='config_upsert_item',
        resource_type='config_item',
        resource_id=item.id,
        summary=f'Actualización de config {namespace}.{config_key} a v{next_version}',
        before=before_snapshot,
        after=_snapshot_config_item(item),
        metadata={'change_type': 'update', 'reason': reason, 'is_sensitive': is_sensitive},
    )

    db.session.commit()

    log_activity(
        'admin_v2_config_upsert',
        f'Config actualizada #{item.id} {namespace}.{config_key} v{next_version}; sensitive={is_sensitive}; reason={reason or "-"}',
    )
    return _config_success_response(
        f'Config {namespace}.{config_key} actualizada a v{next_version}.',
        item=item,
        extra_payload={'version': _serialize_config_version(version)},
    )


@admin_v2_bp.route('/config/items/<int:item_id>/rollback', methods=['POST'])
@admin_required
def config_rollback_item(item_id):
    item = db.session.get(ConfigItem, item_id)
    if not item:
        return _config_error_response('Config no encontrada', 404, item_id=item_id)

    before_snapshot = _snapshot_config_item(item)

    target_version_raw = _payload_value('target_version')
    reason = (_payload_value('reason', '') or '').strip() or None

    try:
        target_version = int(target_version_raw)
    except (TypeError, ValueError):
        return _config_error_response('target_version inválido', 400, item_id=item_id)

    target = ConfigVersion.query.filter_by(config_item_id=item.id, version=target_version).first()
    if not target:
        return _config_error_response('Versión objetivo no encontrada', 404, item_id=item.id)

    now = datetime.utcnow()
    next_version = (item.current_version or 0) + 1
    item.value_json = target.value_json
    item.current_version = next_version
    item.updated_by = current_user.id
    item.updated_at = now

    rollback_version = ConfigVersion(
        config_item_id=item.id,
        version=next_version,
        value_json=target.value_json,
        change_type='rollback',
        reason=reason,
        changed_by=current_user.id,
        created_at=now,
    )
    db.session.add(rollback_version)

    _record_audit_event(
        module_key='config',
        action='config_rollback_item',
        resource_type='config_item',
        resource_id=item.id,
        summary=f'Rollback de config {item.namespace}.{item.config_key} a v{target_version}',
        before=before_snapshot,
        after=_snapshot_config_item(item),
        metadata={'target_version': target_version, 'new_version': next_version, 'reason': reason},
    )

    db.session.commit()

    log_activity(
        'admin_v2_config_rollback',
        f'Rollback config #{item.id} a v{target_version}; nueva v{next_version}; reason={reason or "-"}',
    )
    return _config_success_response(
        f'Rollback aplicado a {item.namespace}.{item.config_key} -> v{target_version} (nueva v{next_version}).',
        item=item,
        extra_payload={
            'target_version': target_version,
            'version': _serialize_config_version(rollback_version),
        },
    )


@admin_v2_bp.route('/audit')
@admin_required
def audit_ledger():
    filters = _build_audit_filters()
    page = max(1, request.args.get('page', 1, type=int) or 1)
    per_page = request.args.get('per_page', 25, type=int) or 25
    per_page = min(max(per_page, 1), 200)

    query = _audit_base_query(filters)
    page_obj = query.paginate(page=page, per_page=per_page, error_out=False)

    items = [_serialize_audit_event(event) for event in page_obj.items]
    pagination = _audit_pagination_payload(page_obj)

    actors = User.query.order_by(User.email.asc()).all()
    incidents = IncidentEvent.query.order_by(IncidentEvent.declared_at.desc()).limit(200).all()

    if _wants_html_response():
        try:
            response = render_template(
                'admin_v2_audit.html',
                events=items,
                filters=filters,
                pagination=pagination,
                actors=actors,
                incidents=incidents,
            )
        except TemplateNotFound:
            fallback = '<html><body><h1>Admin V2 Audit Ledger</h1><p>Template admin_v2_audit.html no disponible.</p></body></html>'
            response = Response(fallback, mimetype='text/html')
    else:
        response = jsonify({
            'success': True,
            'items': items,
            'pagination': pagination,
            'filters': filters,
        })

    _record_audit_event(
        module_key='audit',
        action='audit_view',
        resource_type='audit_ledger',
        summary='Consulta de audit ledger',
        metadata={
            'filters': filters,
            'page': page,
            'per_page': per_page,
            'items_count': len(items),
            'total': page_obj.total,
        },
    )
    db.session.commit()
    return response


@admin_v2_bp.route('/audit/export')
@admin_required
def audit_export():
    export_format = (request.args.get('format', 'csv') or 'csv').strip().lower()
    if export_format not in {'csv', 'json'}:
        return jsonify({'success': False, 'error': 'format debe ser csv o json'}), 400

    filters = _build_audit_filters()
    is_valid, validation_error = _validate_audit_export_filters(filters)
    if not is_valid:
        return jsonify({'success': False, 'error': validation_error}), 400

    query = _audit_base_query(filters)
    events = query.limit(AUDIT_EXPORT_MAX_ROWS + 1).all()
    if len(events) > AUDIT_EXPORT_MAX_ROWS:
        return jsonify({
            'success': False,
            'error': f'export excede el máximo permitido ({AUDIT_EXPORT_MAX_ROWS} filas). Ajuste los filtros.',
        }), 400

    rows = []
    for event in events:
        serialized = _serialize_audit_event(event)
        rows.append({
            'id': serialized['id'],
            'timestamp': serialized['created_at'],
            'actor': (serialized['actor']['email'] if serialized['actor'] else str(serialized['actor_user_id'])),
            'target': (
                serialized['target']['email']
                if serialized['target']
                else (str(serialized['target_user_id']) if serialized['target_user_id'] else None)
            ),
            'module': serialized['module_key'],
            'action': serialized['action'],
            'resource_type': serialized['resource_type'],
            'resource_id': serialized['resource_id'],
            'incident_id': serialized['incident_id'],
            'summary': serialized['summary'],
            'before_json': serialized['before_json'],
            'after_json': serialized['after_json'],
            'metadata_json': serialized['metadata_json'],
        })

    stamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    if export_format == 'json':
        payload = json.dumps(rows, ensure_ascii=False)
        response = Response(
            payload,
            mimetype='application/json',
            headers={'Content-Disposition': f'attachment; filename="audit-evidence-{stamp}.json"'},
        )
        _record_audit_event(
            module_key='audit',
            action='audit_export_json',
            resource_type='audit_export',
            summary='Export de audit ledger en JSON',
            metadata={
                'filters': filters,
                'format': export_format,
                'rows_count': len(rows),
            },
        )
        db.session.commit()
        return response

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        'id', 'timestamp', 'actor', 'target', 'module', 'action',
        'resource_type', 'resource_id', 'incident_id', 'summary',
        'before_json', 'after_json', 'metadata_json',
    ])
    for row in rows:
        writer.writerow([
            row['id'], _sanitize_csv_cell(row['timestamp']), _sanitize_csv_cell(row['actor']), _sanitize_csv_cell(row['target']),
            _sanitize_csv_cell(row['module']), _sanitize_csv_cell(row['action']),
            _sanitize_csv_cell(row['resource_type']), _sanitize_csv_cell(row['resource_id']), row['incident_id'],
            _sanitize_csv_cell(row['summary']), _sanitize_csv_cell(row['before_json']),
            _sanitize_csv_cell(row['after_json']), _sanitize_csv_cell(row['metadata_json']),
        ])

    response = Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="audit-evidence-{stamp}.csv"'},
    )
    _record_audit_event(
        module_key='audit',
        action='audit_export_csv',
        resource_type='audit_export',
        summary='Export de audit ledger en CSV',
        metadata={
            'filters': filters,
            'format': export_format,
            'rows_count': len(rows),
        },
    )
    db.session.commit()
    return response


@admin_v2_bp.route('/audit/timeline/incident/<int:incident_id>')
@admin_required
def audit_timeline_by_incident(incident_id):
    if _wants_html_response():
        response = redirect(url_for('admin_v2.audit_ledger', incident_id=incident_id))
        _record_audit_event(
            module_key='audit',
            action='audit_timeline_incident',
            resource_type='audit_timeline',
            resource_id=incident_id,
            incident_id=incident_id,
            summary=f'Timeline de audit por incidente #{incident_id} (redirect)',
            metadata={
                'filters': {'incident_id': incident_id},
                'items_count': 0,
                'redirected_to': 'audit_ledger',
            },
        )
        db.session.commit()
        return response

    filters = _build_audit_filters({'incident_id': incident_id})
    query = _audit_base_query(filters)
    items = [_serialize_audit_event(event) for event in query.limit(200).all()]
    response = jsonify({'success': True, 'items': items, 'filters': filters})
    _record_audit_event(
        module_key='audit',
        action='audit_timeline_incident',
        resource_type='audit_timeline',
        resource_id=incident_id,
        incident_id=incident_id,
        summary=f'Timeline de audit por incidente #{incident_id}',
        metadata={
            'filters': filters,
            'items_count': len(items),
            'limit': 200,
        },
    )
    db.session.commit()
    return response


@admin_v2_bp.route('/audit/timeline/actor/<int:user_id>')
@admin_required
def audit_timeline_by_actor(user_id):
    if _wants_html_response():
        response = redirect(url_for('admin_v2.audit_ledger', actor_id=user_id))
        _record_audit_event(
            module_key='audit',
            action='audit_timeline_actor',
            resource_type='audit_timeline',
            resource_id=user_id,
            target_user_id=user_id,
            summary=f'Timeline de audit por actor #{user_id} (redirect)',
            metadata={
                'filters': {'actor_id': user_id},
                'items_count': 0,
                'redirected_to': 'audit_ledger',
            },
        )
        db.session.commit()
        return response

    filters = _build_audit_filters({'actor_id': user_id})
    query = _audit_base_query(filters)
    items = [_serialize_audit_event(event) for event in query.limit(200).all()]
    response = jsonify({'success': True, 'items': items, 'filters': filters})
    _record_audit_event(
        module_key='audit',
        action='audit_timeline_actor',
        resource_type='audit_timeline',
        resource_id=user_id,
        target_user_id=user_id,
        summary=f'Timeline de audit por actor #{user_id}',
        metadata={
            'filters': filters,
            'items_count': len(items),
            'limit': 200,
        },
    )
    db.session.commit()
    return response


@admin_v2_bp.route('/incidents')
@admin_required
def incidents_list():
    seeded = _ensure_default_playbooks()
    if seeded:
        db.session.commit()
    incidents = IncidentEvent.query.order_by(IncidentEvent.declared_at.desc()).all()
    playbooks = IncidentPlaybook.query.order_by(IncidentPlaybook.playbook_key.asc()).all()
    if _wants_html_response():
        return render_template(
            'admin_v2_incidents.html',
            incidents=[_serialize_incident(i) for i in incidents],
            playbooks=[_serialize_incident_playbook(p) for p in playbooks],
        )
    return jsonify({
        'success': True,
        'items': [_serialize_incident(i) for i in incidents],
        'playbooks': [_serialize_incident_playbook(p) for p in playbooks],
    })


@admin_v2_bp.route('/incidents/new', methods=['POST'])
@admin_required
def incident_create():
    is_form_submit = _is_html_form_submit()
    summary = (_payload_value('summary', '') or '').strip()
    severity = (_payload_value('severity', 'medium') or 'medium').strip().lower()

    if not summary:
        if is_form_submit:
            flash('summary es obligatorio', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'summary es obligatorio'}), 400

    if severity not in VALID_INCIDENT_SEVERITIES:
        if is_form_submit:
            flash('severity inválido', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'severity inválido'}), 400

    incident = IncidentEvent(
        incident_code=_generate_incident_code(),
        severity=severity,
        status='open',
        summary=summary,
        declared_by=current_user.id,
    )
    db.session.add(incident)
    db.session.flush()

    _record_audit_event(
        module_key='incidents',
        action='incident_create',
        resource_type='incident',
        resource_id=incident.incident_code,
        incident_id=incident.id,
        summary=f'Incidente {incident.incident_code} declarado',
        before=None,
        after=_serialize_incident(incident),
    )

    db.session.commit()

    log_activity('admin_v2_incident_declared', f'Incidente {incident.incident_code}: {summary}')
    if is_form_submit:
        flash(f'Incidente {incident.incident_code} creado.', 'success')
        return redirect(url_for('admin_v2.incidents_list'))
    return jsonify({'success': True, 'incident': _serialize_incident(incident)}), 201


@admin_v2_bp.route('/incidents/playbooks/upsert', methods=['POST'])
@admin_required
def incident_playbook_upsert():
    is_form_submit = _is_html_form_submit()

    playbook_key = (_payload_value('playbook_key', '') or '').strip()
    name = (_payload_value('name', '') or '').strip()
    description_raw = _payload_value('description')
    definition_raw = _payload_value('definition_json')

    if not playbook_key:
        if is_form_submit:
            flash('playbook_key es obligatorio', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'playbook_key es obligatorio'}), 400
    if len(playbook_key) > 60:
        if is_form_submit:
            flash('playbook_key excede 60 caracteres', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'playbook_key excede 60 caracteres'}), 400
    if not name:
        if is_form_submit:
            flash('name es obligatorio', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'name es obligatorio'}), 400

    is_valid, validation_error, normalized_definition, normalized_json = _validate_playbook_definition(definition_raw)
    if not is_valid:
        if is_form_submit:
            flash(validation_error, 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': validation_error}), 400

    enabled_raw = _payload_value('is_enabled', None)
    parsed_enabled = _parse_bool_field(enabled_raw)

    playbook = IncidentPlaybook.query.filter_by(playbook_key=playbook_key).first()
    created = playbook is None
    before_snapshot = _serialize_incident_playbook(playbook) if playbook else None

    if created:
        playbook = IncidentPlaybook(playbook_key=playbook_key, created_by=current_user.id)
        db.session.add(playbook)

    playbook.name = name
    playbook.description = (str(description_raw).strip() if description_raw is not None else None) or None
    playbook.definition_json = normalized_json
    if parsed_enabled is not None:
        playbook.is_enabled = parsed_enabled
    elif created:
        playbook.is_enabled = True
    playbook.updated_by = current_user.id
    playbook.updated_at = datetime.utcnow()

    db.session.flush()

    serialized = _serialize_incident_playbook(playbook)
    _record_audit_event(
        module_key='incidents',
        action='incident_playbook_upsert',
        resource_type='incident_playbook',
        resource_id=playbook.id,
        summary=f'Playbook {playbook.playbook_key} {"creado" if created else "actualizado"}',
        before=before_snapshot,
        after=serialized,
        metadata={
            'playbook_key': playbook.playbook_key,
            'name': playbook.name,
            'is_enabled': playbook.is_enabled,
            'actions_count': len(normalized_definition.get('actions', [])),
            'mode': ('create' if created else 'update'),
        },
    )

    db.session.commit()
    log_activity(
        'admin_v2_incident_playbook_upsert',
        f'Playbook {playbook.playbook_key} {"creado" if created else "actualizado"} ({len(normalized_definition.get("actions", []))} acciones)',
    )

    if is_form_submit:
        flash(f'Playbook {playbook.playbook_key} guardado.', 'success')
        return redirect(url_for('admin_v2.incidents_list'))

    status_code = 201 if created else 200
    return jsonify({'success': True, 'playbook': serialized}), status_code


@admin_v2_bp.route('/incidents/playbooks/<int:playbook_id>/toggle', methods=['POST'])
@admin_required
def incident_playbook_toggle(playbook_id):
    is_form_submit = _is_html_form_submit()
    playbook = db.session.get(IncidentPlaybook, playbook_id)
    if not playbook:
        if is_form_submit:
            flash('Playbook no encontrado', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'Playbook no encontrado'}), 404

    mode = (_payload_value('mode', '') or '').strip().lower()
    enabled_raw = _payload_value('is_enabled', None)
    target_enabled = None

    if mode:
        if mode not in {'enable', 'disable'}:
            if is_form_submit:
                flash('mode debe ser enable o disable', 'error')
                return redirect(url_for('admin_v2.incidents_list'))
            return jsonify({'success': False, 'error': 'mode debe ser enable o disable'}), 400
        target_enabled = mode == 'enable'
    else:
        parsed_enabled = _parse_bool_field(enabled_raw)
        if parsed_enabled is None:
            if is_form_submit:
                flash('Debe enviar mode=enable|disable o is_enabled boolean', 'error')
                return redirect(url_for('admin_v2.incidents_list'))
            return jsonify({'success': False, 'error': 'Debe enviar mode=enable|disable o is_enabled boolean'}), 400
        target_enabled = parsed_enabled

    before_snapshot = _serialize_incident_playbook(playbook)
    playbook.is_enabled = target_enabled
    playbook.updated_by = current_user.id
    playbook.updated_at = datetime.utcnow()

    serialized = _serialize_incident_playbook(playbook)
    _record_audit_event(
        module_key='incidents',
        action='incident_playbook_toggle',
        resource_type='incident_playbook',
        resource_id=playbook.id,
        summary=f'Playbook {playbook.playbook_key} => {"enabled" if target_enabled else "disabled"}',
        before=before_snapshot,
        after=serialized,
        metadata={
            'playbook_key': playbook.playbook_key,
            'is_enabled': playbook.is_enabled,
            'mode': ('enable' if target_enabled else 'disable'),
        },
    )

    db.session.commit()
    log_activity('admin_v2_incident_playbook_toggle', f'Playbook {playbook.playbook_key} => {"enabled" if target_enabled else "disabled"}')

    if is_form_submit:
        flash(f'Playbook {playbook.playbook_key} actualizado.', 'success')
        return redirect(url_for('admin_v2.incidents_list'))

    return jsonify({'success': True, 'playbook': serialized})


@admin_v2_bp.route('/incidents/<int:incident_id>/resolve', methods=['POST'])
@admin_required
def incident_resolve(incident_id):
    is_form_submit = _is_html_form_submit()
    incident = db.session.get(IncidentEvent, incident_id)
    if not incident:
        if is_form_submit:
            flash('Incidente no encontrado', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'Incidente no encontrado'}), 404
    if incident.status == 'resolved':
        if is_form_submit:
            flash('Incidente ya resuelto', 'warning')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'Incidente ya resuelto'}), 400

    before_snapshot = _serialize_incident(incident)
    incident.status = 'resolved'
    incident.resolved_at = datetime.utcnow()

    _record_audit_event(
        module_key='incidents',
        action='incident_resolve',
        resource_type='incident',
        resource_id=incident.incident_code,
        incident_id=incident.id,
        summary=f'Incidente {incident.incident_code} resuelto',
        before=before_snapshot,
        after=_serialize_incident(incident),
    )

    db.session.commit()

    log_activity('admin_v2_incident_resolved', f'Incidente {incident.incident_code} resuelto')
    if is_form_submit:
        flash(f'Incidente {incident.incident_code} resuelto.', 'success')
        return redirect(url_for('admin_v2.incidents_list'))
    return jsonify({'success': True, 'incident': _serialize_incident(incident)})


@admin_v2_bp.route('/incidents/<int:incident_id>/revoke-sessions', methods=['POST'])
@admin_required
def incident_revoke_sessions(incident_id):
    is_form_submit = _is_html_form_submit()
    incident = db.session.get(IncidentEvent, incident_id)
    if not incident:
        if is_form_submit:
            flash('Incidente no encontrado', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'Incidente no encontrado'}), 404

    scope = (_payload_value('scope', 'global') or 'global').strip().lower()
    affected = 0
    target = scope
    target_user_id = None
    params = {'scope': scope}

    if scope == 'global':
        users = User.query.filter(User.is_active.is_(True), User.id != current_user.id).all()
        for user in users:
            if not user.force_logout:
                affected += 1
            user.force_logout = True
    elif scope == 'user':
        user_id = _payload_value('user_id')
        try:
            user_id = int(user_id)
        except (TypeError, ValueError):
            if is_form_submit:
                flash('user_id inválido', 'error')
                return redirect(url_for('admin_v2.incidents_list'))
            return jsonify({'success': False, 'error': 'user_id inválido'}), 400

        user = db.session.get(User, user_id)
        if not user:
            if is_form_submit:
                flash('Usuario no encontrado', 'error')
                return redirect(url_for('admin_v2.incidents_list'))
            return jsonify({'success': False, 'error': 'Usuario no encontrado'}), 404
        if user.id == current_user.id:
            if is_form_submit:
                flash('No puedes revocar tu propia sesión', 'error')
                return redirect(url_for('admin_v2.incidents_list'))
            return jsonify({'success': False, 'error': 'No puedes revocar tu propia sesión'}), 400

        user.force_logout = True
        target = f'user:{user.id}'
        target_user_id = user.id
        params['user_id'] = user.id
        affected = 1
    else:
        if is_form_submit:
            flash('scope debe ser global o user', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'scope debe ser global o user'}), 400

    action = IncidentAction(
        incident_id=incident.id,
        action_type='revoke_sessions',
        target=target,
        parameters_json=json.dumps(params),
        executed_by=current_user.id,
        result=f'force_logout aplicado a {affected} usuario(s)',
    )
    db.session.add(action)
    db.session.flush()

    _record_audit_event(
        module_key='incidents',
        action='incident_revoke_sessions',
        resource_type='incident_action',
        resource_id=action.id,
        target_user_id=target_user_id,
        incident_id=incident.id,
        summary=f'Revocación de sesiones ({scope}) en incidente {incident.incident_code}',
        before=None,
        after={'affected': affected, 'scope': scope},
        metadata={'parameters': params, 'result': action.result},
    )

    db.session.commit()

    log_activity('admin_v2_revoke_sessions', f'Incidente {incident.incident_code}: {action.result}')
    if is_form_submit:
        flash(action.result, 'success')
        return redirect(url_for('admin_v2.incidents_list'))
    return jsonify({'success': True, 'affected': affected, 'action_id': action.id})


@admin_v2_bp.route('/incidents/<int:incident_id>/freeze', methods=['POST'])
@admin_required
def incident_freeze_toggle(incident_id):
    is_form_submit = _is_html_form_submit()
    incident = db.session.get(IncidentEvent, incident_id)
    if not incident:
        if is_form_submit:
            flash('Incidente no encontrado', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'Incidente no encontrado'}), 404

    mode = (_payload_value('mode', '') or '').strip().lower()
    reason = (_payload_value('reason', '') or '').strip()
    if mode not in {'freeze', 'unfreeze'}:
        if is_form_submit:
            flash('mode debe ser freeze o unfreeze', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'mode debe ser freeze o unfreeze'}), 400

    state = _get_or_create_freeze_state()
    before_snapshot = _serialize_freeze_state(state)
    state.is_frozen = (mode == 'freeze')
    state.reason = reason or None
    state.updated_by = current_user.id
    state.updated_at = datetime.utcnow()

    action = IncidentAction(
        incident_id=incident.id,
        action_type='admin_freeze',
        target=mode,
        parameters_json=json.dumps({'mode': mode, 'reason': reason or None}),
        executed_by=current_user.id,
        result='admin congelado' if mode == 'freeze' else 'admin descongelado',
    )
    db.session.add(action)
    db.session.flush()

    _record_audit_event(
        module_key='incidents',
        action='incident_freeze_toggle',
        resource_type='incident_action',
        resource_id=action.id,
        incident_id=incident.id,
        summary=f'Freeze admin {mode} en incidente {incident.incident_code}',
        before=before_snapshot,
        after=_serialize_freeze_state(state),
        metadata={'mode': mode, 'reason': reason or None, 'result': action.result},
    )

    db.session.commit()

    log_activity('admin_v2_freeze_toggle', f'Incidente {incident.incident_code}: {action.result}')
    if is_form_submit:
        flash(f'Estado freeze actualizado: {action.result}.', 'success')
        return redirect(url_for('admin_v2.incidents_list'))
    return jsonify({'success': True, 'freeze_state': _serialize_freeze_state(state), 'action_id': action.id})


@admin_v2_bp.route('/incidents/<int:incident_id>/contain', methods=['POST'])
@admin_required
def incident_contain_with_playbook(incident_id):
    is_form_submit = _is_html_form_submit()
    incident = db.session.get(IncidentEvent, incident_id)
    if not incident:
        if is_form_submit:
            flash('Incidente no encontrado', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'Incidente no encontrado'}), 404
    if incident.status != 'open':
        if is_form_submit:
            flash('Solo se puede ejecutar contención en incidentes abiertos', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'Solo se puede ejecutar contención en incidentes abiertos'}), 400

    playbook_key = (_payload_value('playbook_key', '') or '').strip()
    if not playbook_key:
        if is_form_submit:
            flash('playbook_key es obligatorio', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'playbook_key es obligatorio'}), 400

    _ensure_default_playbooks()
    playbook = IncidentPlaybook.query.filter_by(playbook_key=playbook_key).first()
    if not playbook:
        if is_form_submit:
            flash('Playbook no encontrado', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'Playbook no encontrado'}), 404
    if not playbook.is_enabled:
        if is_form_submit:
            flash('Playbook deshabilitado', 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': 'Playbook deshabilitado'}), 400

    is_valid, validation_error, normalized_definition, _ = _validate_playbook_definition(playbook.definition_json)
    if not is_valid:
        if is_form_submit:
            flash(validation_error, 'error')
            return redirect(url_for('admin_v2.incidents_list'))
        return jsonify({'success': False, 'error': validation_error}), 400

    executed_actions = []
    affected_users = 0
    impacted_modules = []

    for index, action_def in enumerate(normalized_definition.get('actions', []), start=1):
        action_type = action_def.get('type')
        if action_type == 'freeze':
            mode = action_def.get('mode')
            reason = action_def.get('reason')
            state = _get_or_create_freeze_state()
            state.is_frozen = (mode == 'freeze')
            state.reason = reason or None
            state.updated_by = current_user.id
            state.updated_at = datetime.utcnow()

            incident_action = IncidentAction(
                incident_id=incident.id,
                action_type='playbook_freeze',
                target=mode,
                parameters_json=json.dumps({'mode': mode, 'reason': reason}, ensure_ascii=False),
                executed_by=current_user.id,
                result=f'freeze_state => {"frozen" if state.is_frozen else "unfrozen"}',
            )
            db.session.add(incident_action)
            db.session.flush()

            executed_actions.append({
                'index': index,
                'type': action_type,
                'mode': mode,
                'reason': reason,
                'incident_action_id': incident_action.id,
                'result': incident_action.result,
            })

        elif action_type == 'revoke_sessions':
            users = User.query.filter(User.is_active.is_(True), User.id != current_user.id).all()
            changed = 0
            for user in users:
                if not user.force_logout:
                    changed += 1
                user.force_logout = True

            affected_users += changed
            incident_action = IncidentAction(
                incident_id=incident.id,
                action_type='playbook_revoke_sessions',
                target='global',
                parameters_json=json.dumps({'scope': 'global'}, ensure_ascii=False),
                executed_by=current_user.id,
                result=f'force_logout aplicado a {changed} usuario(s)',
            )
            db.session.add(incident_action)
            db.session.flush()

            executed_actions.append({
                'index': index,
                'type': action_type,
                'scope': 'global',
                'affected_users': changed,
                'incident_action_id': incident_action.id,
                'result': incident_action.result,
            })

        elif action_type == 'module_lock':
            module_key = action_def.get('module_key')
            mode = action_def.get('mode')
            reason = action_def.get('reason')

            lock = ModuleLock.query.filter_by(module_key=module_key).first()
            if not lock:
                lock = ModuleLock(module_key=module_key)
                db.session.add(lock)

            lock.lock_state = 'locked' if mode == 'lock' else 'unlocked'
            lock.reason = reason or None
            lock.updated_by = current_user.id
            lock.updated_at = datetime.utcnow()
            impacted_modules.append(module_key)

            incident_action = IncidentAction(
                incident_id=incident.id,
                action_type='playbook_module_lock',
                target=module_key,
                parameters_json=json.dumps({'module_key': module_key, 'mode': mode, 'reason': reason}, ensure_ascii=False),
                executed_by=current_user.id,
                result=f'module {module_key} => {lock.lock_state}',
            )
            db.session.add(incident_action)
            db.session.flush()

            executed_actions.append({
                'index': index,
                'type': action_type,
                'module_key': module_key,
                'mode': mode,
                'reason': reason,
                'incident_action_id': incident_action.id,
                'result': incident_action.result,
            })

    summary = {
        'playbook_key': playbook.playbook_key,
        'incident_id': incident.id,
        'executed_count': len(executed_actions),
        'affected_users': affected_users,
        'impacted_modules': sorted(set(impacted_modules)),
        'executed_actions': executed_actions,
    }

    _record_audit_event(
        module_key='incidents',
        action='incident_playbook_execute',
        resource_type='incident_playbook_run',
        resource_id=playbook.playbook_key,
        incident_id=incident.id,
        summary=f'Playbook {playbook.playbook_key} ejecutado en incidente {incident.incident_code}',
        metadata=summary,
    )

    db.session.commit()
    log_activity(
        'admin_v2_incident_playbook_execute',
        f'Incidente {incident.incident_code}: playbook={playbook.playbook_key} acciones={len(executed_actions)} usuarios={affected_users}',
    )

    if is_form_submit:
        flash(f'Playbook {playbook.playbook_key} ejecutado ({len(executed_actions)} acciones).', 'success')
        return redirect(url_for('admin_v2.incidents_list'))

    return jsonify({'success': True, 'execution': summary})


@admin_v2_bp.route('/incidents/<int:incident_id>/postmortem/evidence')
@admin_required
def incident_postmortem_evidence_export(incident_id):
    incident = db.session.get(IncidentEvent, incident_id)
    if not incident:
        return jsonify({'success': False, 'error': 'Incidente no encontrado'}), 404

    export_format = (request.args.get('format', 'json') or 'json').strip().lower()
    if export_format not in {'json', 'csv'}:
        return jsonify({'success': False, 'error': 'format debe ser json o csv'}), 400

    incident_actions = (
        IncidentAction.query
        .filter_by(incident_id=incident.id)
        .order_by(IncidentAction.executed_at.asc(), IncidentAction.id.asc())
        .all()
    )
    audit_events = (
        AuditLedgerEvent.query
        .filter_by(incident_id=incident.id)
        .order_by(AuditLedgerEvent.created_at.asc(), AuditLedgerEvent.id.asc())
        .all()
    )
    freeze_state = _get_or_create_freeze_state()
    module_locks = ModuleLock.query.order_by(ModuleLock.module_key.asc()).all()

    generated_at = datetime.utcnow()
    evidence_payload = {
        'incident': _serialize_incident(incident),
        'incident_actions': [
            {
                'id': action.id,
                'incident_id': action.incident_id,
                'action_type': action.action_type,
                'target': action.target,
                'parameters': _safe_json_loads(action.parameters_json),
                'result': action.result,
                'executed_by': action.executed_by,
                'executed_at': action.executed_at.isoformat() if action.executed_at else None,
            }
            for action in incident_actions
        ],
        'audit_events': [_serialize_audit_event(event) for event in audit_events],
        'freeze_state': _serialize_freeze_state(freeze_state),
        'module_locks': [_serialize_module_lock(lock) for lock in module_locks],
        'generated_at': generated_at.isoformat(),
        'generated_by': {
            'id': current_user.id,
            'email': current_user.email,
            'username': current_user.username,
        },
    }

    stamp = generated_at.strftime('%Y%m%d-%H%M%S')
    filename = f'incident-{incident.id}-postmortem-evidence-{stamp}.{export_format}'

    if export_format == 'json':
        response = Response(
            json.dumps(evidence_payload, ensure_ascii=False),
            mimetype='application/json',
            headers={'Content-Disposition': f'attachment; filename="{filename}"'},
        )
        audit_action = 'incident_postmortem_export_json'
    else:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['section', 'index', 'field', 'value'])

        def append_rows(section, index, payload):
            if payload is None:
                writer.writerow([
                    _sanitize_csv_cell(section),
                    index,
                    _sanitize_csv_cell('value'),
                    _sanitize_csv_cell(''),
                ])
                return

            for field, value in payload.items():
                serialized_value = value
                if isinstance(value, (dict, list)):
                    serialized_value = json.dumps(value, ensure_ascii=False)
                writer.writerow([
                    _sanitize_csv_cell(section),
                    index,
                    _sanitize_csv_cell(field),
                    _sanitize_csv_cell(serialized_value),
                ])

        append_rows('incident', 0, evidence_payload['incident'])
        for idx, action in enumerate(evidence_payload['incident_actions']):
            append_rows('incident_actions', idx, action)
        for idx, event in enumerate(evidence_payload['audit_events']):
            append_rows('audit_events', idx, event)
        append_rows('freeze_state', 0, evidence_payload['freeze_state'])
        for idx, lock in enumerate(evidence_payload['module_locks']):
            append_rows('module_locks', idx, lock)
        append_rows('generated_by', 0, evidence_payload['generated_by'])
        append_rows('export', 0, {'generated_at': evidence_payload['generated_at']})

        response = Response(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': f'attachment; filename="{filename}"'},
        )
        audit_action = 'incident_postmortem_export_csv'

    _record_audit_event(
        module_key='incidents',
        action=audit_action,
        resource_type='incident_postmortem_evidence',
        resource_id=incident.id,
        incident_id=incident.id,
        summary=f'Export de evidencia postmortem ({export_format}) para incidente {incident.incident_code}',
        metadata={
            'format': export_format,
            'incident_actions_count': len(evidence_payload['incident_actions']),
            'audit_events_count': len(evidence_payload['audit_events']),
            'module_locks_count': len(evidence_payload['module_locks']),
        },
    )

    db.session.commit()
    log_activity('admin_v2_incident_postmortem_export', f'Incidente {incident.incident_code}: export evidencia {export_format}')
    return response


@admin_v2_bp.route('/module-locks/toggle', methods=['POST'])
@admin_required
def module_lock_toggle():
    is_form_submit = _is_html_form_submit()
    module_key = (_payload_value('module_key', '') or '').strip()
    mode = (_payload_value('mode', '') or '').strip().lower()
    reason = (_payload_value('reason', '') or '').strip()

    if not module_key:
        if is_form_submit:
            flash('module_key es obligatorio', 'error')
            return redirect(url_for('admin_v2.dashboard'))
        return jsonify({'success': False, 'error': 'module_key es obligatorio'}), 400
    if module_key not in VALID_MODULE_KEYS:
        if is_form_submit:
            flash('module_key inválido', 'error')
            return redirect(url_for('admin_v2.dashboard'))
        return jsonify({'success': False, 'error': 'module_key inválido'}), 400
    if mode not in {'lock', 'unlock'}:
        if is_form_submit:
            flash('mode debe ser lock o unlock', 'error')
            return redirect(url_for('admin_v2.dashboard'))
        return jsonify({'success': False, 'error': 'mode debe ser lock o unlock'}), 400

    lock = ModuleLock.query.filter_by(module_key=module_key).first()
    before_snapshot = _serialize_module_lock(lock) if lock else None
    if not lock:
        lock = ModuleLock(module_key=module_key)
        db.session.add(lock)

    lock.lock_state = 'locked' if mode == 'lock' else 'unlocked'
    lock.reason = reason or None
    lock.updated_by = current_user.id
    lock.updated_at = datetime.utcnow()

    _record_audit_event(
        module_key='operations',
        action='module_lock_toggle',
        resource_type='module_lock',
        resource_id=module_key,
        summary=f'Módulo {module_key} => {lock.lock_state}',
        before=before_snapshot,
        after=_serialize_module_lock(lock),
        metadata={'mode': mode, 'reason': reason or None},
    )

    db.session.commit()

    log_activity('admin_v2_module_lock_toggle', f'Modulo {module_key} => {lock.lock_state}')
    if is_form_submit:
        flash(f'Módulo {module_key} actualizado: {lock.lock_state}.', 'success')
        return redirect(url_for('admin_v2.dashboard'))
    return jsonify({
        'success': True,
        'module_lock': {
            'module_key': lock.module_key,
            'lock_state': lock.lock_state,
            'reason': lock.reason,
            'updated_by': lock.updated_by,
            'updated_at': lock.updated_at.isoformat() if lock.updated_at else None,
        }
    })


# ============================================================================
# ADMIN ORIGINAL - ENDPOINTS JSON PARA CLI
# ============================================================================

# --- DASHBOARD STATS ---
@admin_v2_bp.route('/dashboard/stats')
@admin_required
def dashboard_stats():
    """Stats para dashboard - equivalente a admin_dashboard.html"""
    from models import ActivityLog

    total_users = User.query.count()
    active_users = User.query.filter_by(is_active=True).count()

    # Roles count
    roles_count = {}
    for role_code in ['admin', 'manager', 'DI', 'DII', 'DIII', 'DIVA', 'DVB']:
        count = User.query.filter_by(role=role_code).count()
        if count > 0:
            roles_count[role_code] = count

    total_logs = ActivityLog.query.count()

    return jsonify({
        'success': True,
        'total_users': total_users,
        'active_users': active_users,
        'roles_count': roles_count,
        'total_logs': total_logs
    })


# --- USERS ---
@admin_v2_bp.route('/users')
@admin_required
def users_list():
    """Lista de usuarios con filtros"""
    from blueprints.admin import DEFAULT_ADMIN_EMAIL

    search = (_payload_value('q') or '').strip() if request.is_json else request.args.get('q', '').strip()
    role_filter = (_payload_value('role') or '').strip() if request.is_json else request.args.get('role', '').strip()

    query = User.query.filter(User.email != DEFAULT_ADMIN_EMAIL)

    if search:
        query = query.filter(
            (User.username.ilike(f'%{search}%')) |
            (User.email.ilike(f'%{search}%'))
        )
    if role_filter:
        query = query.filter_by(role=role_filter)

    users = query.order_by(User.created_at.desc()).all()
    all_roles = Role.query.order_by(Role.code).all()

    return jsonify({
        'success': True,
        'users': [{
            'id': u.id,
            'username': u.username,
            'email': u.email,
            'role': u.role,
            'is_active': u.is_active,
            'area_id': u.area_id,
            'allowed_tools': u.get_allowed_tools(),
            'created_at': u.created_at.isoformat() if u.created_at else None,
        } for u in users],
        'roles': [{'code': r.code, 'name': r.name} for r in all_roles]
    })


@admin_v2_bp.route('/users/new', methods=['POST'])
@admin_required
def users_create():
    """Crear nuevo usuario"""
    from werkzeug.security import generate_password_hash

    username = (_payload_value('username') or '').strip()
    email = (_payload_value('email') or '').strip()
    password = _payload_value('password', '')
    role = _payload_value('role', 'DI')
    area_id = _payload_value('area_id')
    tools = _payload_value('tools', [])

    if not username or len(username) < 3:
        return jsonify({'success': False, 'error': 'Username debe tener al menos 3 caracteres'}), 400
    if not email:
        return jsonify({'success': False, 'error': 'Email es obligatorio'}), 400
    if not password or len(password) < 8:
        return jsonify({'success': False, 'error': 'Password debe tener al menos 8 caracteres'}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({'success': False, 'error': 'Ya existe usuario con ese email'}), 400

    new_user = User(
        username=username,
        email=email,
        password=generate_password_hash(password, method='scrypt'),
        role=role,
        area_id=int(area_id) if area_id else None,
    )
    new_user.set_allowed_tools(tools or [])

    db.session.add(new_user)
    db.session.commit()

    log_activity('admin_create_user', f'Creo usuario: {username} ({email}) con rol {role}')

    return jsonify({
        'success': True,
        'user': {
            'id': new_user.id,
            'username': new_user.username,
            'email': new_user.email,
            'role': new_user.role,
        }
    })


@admin_v2_bp.route('/users/<int:user_id>/edit', methods=['POST'])
@admin_required
def users_edit(user_id):
    """Editar usuario"""
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado'}), 404

    username = (_payload_value('username') or '').strip()
    email = (_payload_value('email') or '').strip()
    role = _payload_value('role')
    area_id = _payload_value('area_id')
    tools = _payload_value('tools', [])
    is_active = _payload_value('is_active')

    if username:
        user.username = username
    if email:
        user.email = email
    if role:
        user.role = role
    if area_id:
        user.area_id = int(area_id)
    if is_active is not None:
        user.is_active = bool(is_active)
    if tools:
        user.set_allowed_tools(tools)

    db.session.commit()
    log_activity('admin_edit_user', f'Edito usuario: {user.username}')

    return jsonify({
        'success': True,
        'user': {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'role': user.role,
            'is_active': user.is_active,
        }
    })


@admin_v2_bp.route('/users/<int:user_id>/toggle', methods=['POST'])
@admin_required
def users_toggle(user_id):
    """Activar/desactivar usuario"""
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado'}), 404

    from blueprints.admin import DEFAULT_ADMIN_EMAIL
    if user.email == DEFAULT_ADMIN_EMAIL:
        return jsonify({'success': False, 'error': 'No se puede modificar el admin default'}), 400

    user.is_active = not user.is_active
    db.session.commit()

    action = 'activate' if user.is_active else 'deactivate'
    log_activity(f'admin_user_{action}', f'Usuario {user.username} {action}')

    return jsonify({
        'success': True,
        'user': {
            'id': user.id,
            'is_active': user.is_active
        }
    })


@admin_v2_bp.route('/users/<int:user_id>/kick', methods=['POST'])
@admin_required
def users_kick(user_id):
    """Kickear sesión de usuario"""
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado'}), 404

    user.force_logout = True
    db.session.commit()

    log_activity('admin_user_kick', f'Sesión revocada: {user.username}')

    return jsonify({
        'success': True,
        'message': f'Sesión de {user.username} revocada'
    })


@admin_v2_bp.route('/users/<int:user_id>', methods=['DELETE'])
@admin_required
def users_delete(user_id):
    """Eliminar usuario"""
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado'}), 404

    from blueprints.admin import DEFAULT_ADMIN_EMAIL
    if user.email == DEFAULT_ADMIN_EMAIL:
        return jsonify({'success': False, 'error': 'No se puede eliminar el admin default'}), 400

    username = user.username
    db.session.delete(user)
    db.session.commit()

    log_activity('admin_delete_user', f'Elimino usuario: {username}')

    return jsonify({
        'success': True,
        'message': f'Usuario {username} eliminado'
    })


# --- ACTIVITY ---
@admin_v2_bp.route('/activity')
@admin_required
def activity_list():
    """Lista de logs de actividad"""
    from models import ActivityLog

    user_filter = request.args.get('user_id', '', type=str)
    action_filter = request.args.get('action', '').strip()
    date_from = request.args.get('date_from', '').strip()
    date_to = request.args.get('date_to', '').strip()
    page = request.args.get('page', 1, type=int)
    per_page = 50

    query = ActivityLog.query

    if user_filter:
        try:
            query = query.filter_by(user_id=int(user_filter))
        except ValueError:
            pass
    if action_filter:
        query = query.filter(ActivityLog.action.ilike(f'%{action_filter}%'))

    if date_from:
        try:
            from datetime import datetime as dt
            df = dt.strptime(date_from, '%Y-%m-%d')
            query = query.filter(ActivityLog.timestamp >= df)
        except ValueError:
            pass
    if date_to:
        try:
            from datetime import datetime as dt, timedelta
            dt_to = dt.strptime(date_to, '%Y-%m-%d') + timedelta(days=1)
            query = query.filter(ActivityLog.timestamp < dt_to)
        except ValueError:
            pass

    logs = query.order_by(ActivityLog.timestamp.desc()).paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        'success': True,
        'logs': [{
            'id': l.id,
            'action': l.action,
            'details': l.details,
            'timestamp': l.timestamp.isoformat() if l.timestamp else None,
            'user_id': l.user_id,
            'username': l.user.username if l.user else None,
        } for l in logs.items],
        'total': logs.total,
        'pages': logs.pages,
        'page': logs.page,
        'total_pages': logs.pages
    })


# --- ROLES ---
@admin_v2_bp.route('/roles')
@admin_required
def roles_list():
    """Lista de roles"""
    roles = Role.query.order_by(Role.code).all()

    return jsonify({
        'success': True,
        'roles': [{
            'id': r.id,
            'code': r.code,
            'name': r.name,
            'description': r.description,
            'users_count': User.query.filter_by(role=r.code).count(),
        } for r in roles]
    })


@admin_v2_bp.route('/roles', methods=['POST'])
@admin_required
def roles_create():
    """Crear rol"""
    code = (_payload_value('code') or '').strip().upper()
    name = (_payload_value('name') or '').strip()
    description = (_payload_value('description') or '').strip()

    if not code or not name:
        return jsonify({'success': False, 'error': 'Code y name son obligatorios'}), 400

    if Role.query.filter_by(code=code).first():
        return jsonify({'success': False, 'error': 'Ya existe un rol con ese código'}), 400

    role = Role(code=code, name=name, description=description)
    db.session.add(role)
    db.session.commit()

    log_activity('admin_create_role', f'Creo rol: {code}')

    return jsonify({
        'success': True,
        'role': {'id': role.id, 'code': role.code, 'name': role.name}
    })


@admin_v2_bp.route('/roles/<int:role_id>', methods=['PUT'])
@admin_required
def roles_edit(role_id):
    """Editar rol"""
    role = db.session.get(Role, role_id)
    if not role:
        return jsonify({'success': False, 'error': 'Rol no encontrado'}), 404

    name = (_payload_value('name') or '').strip()
    description = (_payload_value('description') or '').strip()

    if name:
        role.name = name
    if description is not None:
        role.description = description

    db.session.commit()
    log_activity('admin_edit_role', f'Edito rol: {role.code}')

    return jsonify({
        'success': True,
        'role': {'id': role.id, 'code': role.code, 'name': role.name}
    })


@admin_v2_bp.route('/roles/<int:role_id>', methods=['DELETE'])
@admin_required
def roles_delete(role_id):
    """Eliminar rol"""
    role = db.session.get(Role, role_id)
    if not role:
        return jsonify({'success': False, 'error': 'Rol no encontrado'}), 404

    if User.query.filter_by(role=role.code).count() > 0:
        return jsonify({'success': False, 'error': 'No se puede eliminar: hay usuarios con este rol'}), 400

    code = role.code
    db.session.delete(role)
    db.session.commit()

    log_activity('admin_delete_role', f'Elimino rol: {code}')

    return jsonify({
        'success': True,
        'message': f'Rol {code} eliminado'
    })


# --- AREAS ---
@admin_v2_bp.route('/areas')
@admin_required
def areas_list():
    """Lista de áreas"""
    areas = Area.query.order_by(Area.name).all()

    return jsonify({
        'success': True,
        'areas': [{
            'id': a.id,
            'name': a.name,
            'description': a.description,
            'users_count': User.query.filter_by(area_id=a.id).count(),
        } for a in areas]
    })


@admin_v2_bp.route('/areas', methods=['POST'])
@admin_required
def areas_create():
    """Crear área"""
    name = (_payload_value('name') or '').strip()
    description = (_payload_value('description') or '').strip()

    if not name:
        return jsonify({'success': False, 'error': 'Name es obligatorio'}), 400

    area = Area(name=name, description=description)
    db.session.add(area)
    db.session.commit()

    log_activity('admin_create_area', f'Creo área: {name}')

    return jsonify({
        'success': True,
        'area': {'id': area.id, 'name': area.name}
    })


@admin_v2_bp.route('/areas/<int:area_id>', methods=['PUT'])
@admin_required
def areas_edit(area_id):
    """Editar área"""
    area = db.session.get(Area, area_id)
    if not area:
        return jsonify({'success': False, 'error': 'Área no encontrada'}), 404

    name = (_payload_value('name') or '').strip()
    description = (_payload_value('description') or '').strip()

    if name:
        area.name = name
    if description is not None:
        area.description = description

    db.session.commit()
    log_activity('admin_edit_area', f'Edito área: {area.name}')

    return jsonify({
        'success': True,
        'area': {'id': area.id, 'name': area.name}
    })


@admin_v2_bp.route('/areas/<int:area_id>', methods=['DELETE'])
@admin_required
def areas_delete(area_id):
    """Eliminar área"""
    area = db.session.get(Area, area_id)
    if not area:
        return jsonify({'success': False, 'error': 'Área no encontrada'}), 404

    if User.query.filter_by(area_id=area_id).count() > 0:
        return jsonify({'success': False, 'error': 'No se puede eliminar: hay usuarios en esta área'}), 400

    name = area.name
    db.session.delete(area)
    db.session.commit()

    log_activity('admin_delete_area', f'Elimino área: {name}')

    return jsonify({
        'success': True,
        'message': f'Área {name} eliminada'
    })


# ============================================================================
# SYSTEM & MONITOR - Terminal Hacker Panel
# ============================================================================

@admin_v2_bp.route('/system')
@admin_required
def system_stats():
    """System stats for terminal monitor"""
    from models import ActivityLog, Report
    import os
    
    # Database stats
    total_users = User.query.count()
    active_users = User.query.filter_by(is_active=True).count()
    inactive_users = total_users - active_users
    
    total_reports = Report.query.count()
    
    # Reports today
    today = datetime.utcnow().date()
    reports_today = Report.query.filter(db.func.date(Report.created_at) == today).count()
    
    # Activity logs stats
    logs_today = ActivityLog.query.filter(db.func.date(ActivityLog.timestamp) == today).count()
    logs_7days = ActivityLog.query.filter(ActivityLog.timestamp >= datetime.utcnow() - timedelta(days=7)).count()
    
    # Freeze state
    freeze_state = db.session.get(AdminFreezeState, 1)
    is_frozen = freeze_state.is_frozen if freeze_state else False
    
    # Module locks
    module_locks = ModuleLock.query.all()
    locked_modules = [lock.module_key for lock in module_locks if lock.lock_state == 'locked']
    
    # Storage stats (approximate)
    db_path = os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:///users.db')
    storage_size = 0
    if db_path.startswith('sqlite'):
        try:
            db_file = db_path.replace('sqlite:///', '')
            if os.path.exists(db_file):
                storage_size = os.path.getsize(db_file)
        except:
            pass
    
    return jsonify({
        'success': True,
        'system': {
            'users': {
                'total': total_users,
                'active': active_users,
                'inactive': inactive_users,
            },
            'reports': {
                'total': total_reports,
                'today': reports_today,
            },
            'activity': {
                'today': logs_today,
                'last_7_days': logs_7days,
            },
            'state': {
                'is_frozen': is_frozen,
                'freeze_reason': freeze_state.reason if freeze_state else None,
                'locked_modules': locked_modules,
            },
            'storage': {
                'bytes': storage_size,
                'mb': round(storage_size / (1024 * 1024), 2) if storage_size else 0,
            }
        }
    })


@admin_v2_bp.route('/monitor')
@admin_required
def monitor_timeline():
    """Real-time activity timeline for monitor panel"""
    from models import ActivityLog
    
    # Get activity for last 24 hours
    since = datetime.utcnow() - timedelta(hours=24)
    recent_activity = ActivityLog.query.filter(
        ActivityLog.timestamp >= since
    ).order_by(ActivityLog.timestamp.desc()).limit(100).all()
    
    # Group by hour
    hourly_data = {}
    for log in recent_activity:
        hour_key = log.timestamp.strftime('%Y-%m-%d %H:00')
        if hour_key not in hourly_data:
            hourly_data[hour_key] = 0
        hourly_data[hour_key] += 1
    
    # Convert to sorted list
    hourly_timeline = [
        {'hour': h, 'count': c}
        for h, c in sorted(hourly_data.items())
    ]
    
    # Recent actions summary
    action_types = {}
    for log in recent_activity:
        action = log.action.split('_')[0] if log.action else 'unknown'
        action_types[action] = action_types.get(action, 0) + 1
    
    return jsonify({
        'success': True,
        'timeline': {
            'hourly': hourly_timeline,
            'top_actions': sorted(action_types.items(), key=lambda x: x[1], reverse=True)[:10],
            'total_events_24h': len(recent_activity),
        }
    })


@admin_v2_bp.route('/preferences', methods=['GET', 'POST'])
@admin_required
def user_preferences():
    """Get or set user preferences (accent color, etc)"""
    if request.method == 'POST':
        data = request.get_json(silent=True) if request.is_json else {}
        accent_color = data.get('accent_color', 'green') if data else 'green'
        valid_colors = {'green', 'blue', 'cyan', 'magenta', 'orange', 'red', 'yellow', 'white'}
        if accent_color not in valid_colors:
            accent_color = 'green'
        
        return jsonify({
            'success': True,
            'preferences': {
                'accent_color': accent_color
            }
        })
    
    # GET - return default
    return jsonify({
        'success': True,
        'preferences': {
            'accent_color': 'green'
        }
    })
