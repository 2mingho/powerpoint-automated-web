import functools
import csv
import io
import json
import re
import unicodedata
from datetime import datetime, timedelta, date
from flask import Blueprint, render_template, request, jsonify, Response, abort
from flask_login import login_required, current_user
from sqlalchemy import or_, func
from sqlalchemy.orm import joinedload
from extensions import db
from models import User, Task, Area, Notification, TaskComment, ActivityLog, TaskWatcher, TaskChecklistItem, TaskTemplate
from services.notifications import notify_user, notify_many
from services.clock import today_local, current_year
from services.alcance import alcance_unidades, ambito_unidades, puede_ver_equipo
from services.catalogo import (estados_validos, prioridades_validas,
                               estado_inicial, prioridad_por_defecto,
                               es_estado_final)

tasks_bp = Blueprint('tasks', __name__)


# FUN-04: to_dict() resuelve creator.username y assignee.username de forma
# perezosa, dos consultas extra por tarea. Sin tope ni carga anticipada, el
# calendario de un admin sin filtros dispara cientos de consultas.
TASK_FEED_MAX_ROWS = 500


def _with_task_relations(query):
    """Carga creador y asignado en la misma consulta (evita el N+1)."""
    return query.options(joinedload(Task.creator), joinedload(Task.assignee))


TASK_CSV_COLUMNS = [
    'Fecha De inicio',
    'Fecha De finalizacion',
    'Fecha De entrega',
    'Director o Gerencia',
    'Cliente',
    'Titulo',
    'Solicitado por',
    'Asignar a',
    'Descripcion',
    'Tipo de Presupuesto',
    'Prioridad',
    'Recurrencia',
]

TASK_CSV_FIELD_DEFS = [
    ('start_date', 'Fecha De inicio'),
    ('end_date', 'Fecha De finalizacion'),
    ('due_date', 'Fecha De entrega'),
    ('directorate', 'Director o Gerencia'),
    ('client', 'Cliente'),
    ('title', 'Titulo'),
    ('requested_by', 'Solicitado por'),
    ('assignee', 'Asignar a'),
    ('description', 'Descripcion'),
    ('budget_type', 'Tipo de Presupuesto'),
    ('priority', 'Prioridad'),
    ('recurrence', 'Recurrencia'),
]

TASK_CSV_KEY_TO_LABEL = {key: label for key, label in TASK_CSV_FIELD_DEFS}


def task_access_required(f):
    """Decorator: requires authenticated user access to tasks module."""
    @functools.wraps(f)
    @login_required
    def decorated(*args, **kwargs):
        if not current_user.is_admin and not current_user.has_tool_access('tasks'):
            abort(403)
        return f(*args, **kwargs)
    return decorated


def area_lead_required(f):
    """Decorator: requires admin or area lead within tasks module."""
    @functools.wraps(f)
    @login_required
    def decorated(*args, **kwargs):
        if not current_user.is_admin:
            # No se pregunta si lideras, sino si tienes algo que ver. Un
            # director no lidera ninguna unidad directamente: el booleano le
            # cerraba la puerta antes de ejecutar ninguna consulta.
            if not (puede_ver_equipo(current_user) and current_user.has_tool_access('tasks')):
                abort(403)
        return f(*args, **kwargs)
    return decorated


def _unit_user_query(active_only=False):
    """Usuarios con los que el actual puede trabajar.

    Es su propia unidad mas las que lidera, resuelto en services/alcance.py: un
    manager de dos unidades ve a la gente de las dos, y un director ve la de
    todos sus managers.

    El respaldo por rol que habia aqui desaparece. Con el modelo nuevo no era
    un respaldo sino un desvio: alguien sin unidad veia a todos los de su rol,
    que no es una unidad. Sin unidades queda solo el propio usuario, para que
    pueda seguir asignandose trabajo a si mismo.
    """
    query = User.query
    if active_only:
        query = query.filter_by(is_active=True)

    if current_user.is_admin:
        return query

    unidades = ambito_unidades(current_user)
    if not unidades:
        return query.filter(User.id == current_user.id)

    return query.filter(User.area_id.in_(unidades))


def _unit_user_ids():
    """Return user IDs in current user's unit (legacy-safe fallback)."""
    return [u.id for u in _unit_user_query(active_only=False).all()]


def _unidades_del_panel():
    """Unidades que el panel de equipo debe mostrar, o None si no hay ninguna.

    Sustituye a la guarda por unidad propia mas el filtro por igualdad que se
    repetia en los cinco puntos del panel. Devuelve el alcance de
    supervision, no el ambito: aqui la pregunta es que superviso, y la unidad a
    la que uno pertenece no da derecho a ver a sus companeros en el panel.
    """
    unidades = alcance_unidades(current_user)
    return unidades or None


def _task_in_current_unit(task):
    """Check if task belongs to current user's unit scope."""
    if current_user.is_admin:
        return True

    # La tarea es visible si pertenece a alguna unidad del ambito, o si esta
    # asignada a alguien con quien se trabaja. Lo segundo cubre las tareas que
    # todavia no tienen area_id, que existen desde antes del modelo actual.
    if task.area_id is not None and task.area_id in ambito_unidades(current_user):
        return True

    user_ids = set(_unit_user_ids())
    if not user_ids:
        user_ids = {current_user.id}

    return task.assignee_id in user_ids


def _is_task_watcher(task, user_id=None):
    target_user_id = user_id or current_user.id
    return TaskWatcher.query.filter_by(task_id=task.id, user_id=target_user_id).first() is not None


def _can_view_task(task):
    if current_user.is_admin:
        return True
    if _task_in_current_unit(task):
        return True
    return task.visibility == 'shared' and _is_task_watcher(task)


def _can_edit_task(task):
    return current_user.is_admin or _task_in_current_unit(task)


# FUN-04: to_dict() resuelve creator.username y assignee.username de forma
# perezosa, dos consultas extra por tarea. Con el calendario de un admin sin
# filtros eso son cientos de consultas por peticion.
TASK_FEED_MAX_ROWS = 500


def _with_task_relations(query):
    """Carga creador y asignado en la misma consulta (evita el N+1)."""
    return query.options(joinedload(Task.creator), joinedload(Task.assignee))


def _task_status_stats(base_query):
    """Cuenta tareas por estado en el motor, sin traerlas todas a memoria."""
    rows = base_query.with_entities(Task.status, func.count(Task.id)).group_by(Task.status).all()
    by_status = {status: count for status, count in rows}
    completadas = sum(count for status, count in by_status.items() if es_estado_final(status))
    return {
        'total': sum(by_status.values()),
        'pendiente': by_status.get('Pendiente', 0),
        'en_progreso': by_status.get('En Progreso', 0),
        'completado': completadas,
        'por_estado': by_status,
    }


def _semana_actual_inicio():
    """Lunes de la semana en curso, en la zona de negocio."""
    hoy = today_local()
    return hoy - timedelta(days=hoy.weekday())


def _task_headline_stats(base_query):
    """Los cuatro numeros con los que abre el dashboard (RED-7).

    Todo se cuenta en el motor con COUNT y GROUP BY: traer las tareas a
    memoria para contarlas seria el mismo N+1 que ya corregimos en FUN-04.
    """
    hoy = today_local()
    inicio_semana = _semana_actual_inicio()

    vencidas = base_query.filter(
        Task.due_date < hoy,
        Task.status != 'Completado',
    ).count()

    bloqueadas = base_query.filter(Task.status == 'Bloqueado').count()

    # Aproximacion deliberada: no hay columna completed_at, asi que se usa la
    # ultima modificacion de una tarea ya completada. Se desvia solo cuando
    # alguien edita una tarea completada hace tiempo, e infla el numero, nunca
    # lo reduce. Anadir completed_at es la correccion de fondo.
    completadas_semana = base_query.filter(
        Task.status == 'Completado',
        Task.updated_at >= datetime.combine(inicio_semana, datetime.min.time()),
    ).count()

    # Carga: tareas abiertas por persona. A un director le interesa quien va
    # mas cargado, no el reparto completo, que ya esta en el grafico de barras.
    filas = base_query.filter(
        Task.status != 'Completado',
        Task.assignee_id.isnot(None),
    ).with_entities(
        Task.assignee_id, func.count(Task.id)
    ).group_by(Task.assignee_id).all()

    carga_max, carga_max_id = 0, None
    for assignee_id, total in filas:
        if total > carga_max:
            carga_max, carga_max_id = total, assignee_id

    carga_max_nombre = ''
    if carga_max_id is not None:
        usuario = db.session.get(User, carga_max_id)
        carga_max_nombre = usuario.username if usuario else ''

    return {
        'vencidas': vencidas,
        'bloqueadas': bloqueadas,
        'completadas_semana': completadas_semana,
        'carga_max': carga_max,
        'carga_max_id': carga_max_id,
        'carga_max_nombre': carga_max_nombre,
        'personas_con_carga': len(filas),
    }


def _apply_unit_scope(query):
    """Apply unit isolation to task queries."""
    if current_user.is_admin:
        return query

    user_ids = _unit_user_ids()
    if not user_ids:
        user_ids = [current_user.id]

    unidades = ambito_unidades(current_user)
    if unidades:
        return query.filter(or_(Task.area_id.in_(unidades), Task.assignee_id.in_(user_ids)))

    return query.filter(Task.assignee_id.in_(user_ids))


def _assignee_in_current_unit(assignee):
    """Si el actual puede asignarle trabajo a esa persona.

    Misma regla que _unit_user_query, y por el mismo motivo: cierra en falso.
    Sin unidades en el ambito solo puede asignarse a si mismo.
    """
    if current_user.is_admin:
        return True

    unidades = ambito_unidades(current_user)
    if not unidades:
        return assignee.id == current_user.id

    return assignee.area_id in unidades


def _task_area_for_user(user):
    """Return canonical task area string and area_id for a given user."""
    if user.area and user.area.name:
        return user.area.name, user.area_id
    return user.role, user.area_id


def _task_area_key_for_user(user):
    """Return canonical task.area value for a given user."""
    area_name, _area_id = _task_area_for_user(user)
    return area_name


def _mentioned_unit_users(body):
    usernames = set(re.findall(r'@([A-Za-z0-9_.\-]+)', body or ''))
    if not usernames:
        return []
    unit_users = _unit_user_query(active_only=True).all()
    lookup = {u.username: u for u in unit_users}
    return [lookup[name] for name in usernames if name in lookup]


def ensure_due_notifications(user):
    """Create daily due/overdue notifications for current user's assigned tasks."""
    today = today_local()
    tomorrow = today + timedelta(days=1)
    created = 0

    tasks = Task.active_query().filter(
        Task.assignee_id == user.id,
        Task.status != 'Completado',
        Task.due_date.isnot(None),
    ).all()

    for task in tasks:
        kind = None
        title = None

        if task.due_date and task.due_date < today:
            kind = 'task_overdue'
            title = f'Tarea vencida: {task.title}'
        elif task.due_date in {today, tomorrow}:
            kind = 'task_due_soon'
            title = f'Tarea próxima a vencer: {task.title}'

        if not kind:
            continue

        exists_today = Notification.query.filter_by(
            user_id=user.id,
            kind=kind,
            entity_type='task',
            entity_id=task.id,
        ).filter(func.date(Notification.created_at) == today).first()
        if exists_today:
            continue

        notify_user(
            user.id,
            kind,
            title,
            link_url=f'/tasks?task={task.id}',
            entity_type='task',
            entity_id=task.id,
        )
        created += 1

    if created:
        db.session.commit()
    return created


def _parse_task_ids(raw_ids):
    """Normalize/validate a list of task IDs for bulk operations."""
    if not isinstance(raw_ids, list):
        return []

    parsed = []
    seen = set()
    for raw in raw_ids:
        try:
            task_id = int(raw)
        except (ValueError, TypeError):
            continue
        if task_id <= 0 or task_id in seen:
            continue
        parsed.append(task_id)
        seen.add(task_id)

    return parsed


def _normalize_whitespace(value):
    return ' '.join(str(value or '').replace('\ufeff', '').split())


def _normalize_csv_header(value):
    normalized = _normalize_whitespace(value)
    normalized = ''.join(
        ch for ch in unicodedata.normalize('NFKD', normalized)
        if not unicodedata.combining(ch)
    )
    return normalized.lower()


def _format_mmddyyyy(value):
    if not value:
        return ''
    return value.strftime('%m/%d/%Y')


def _is_weekend(value):
    return bool(value) and value.weekday() >= 5


def _parse_iso_or_mmddyyyy_date(raw_value):
    value = (str(raw_value or '')).strip()
    if not value:
        return None

    if 'T' in value:
        value = value.split('T', 1)[0]

    try:
        return date.fromisoformat(value)
    except ValueError:
        pass

    try:
        return datetime.strptime(value, '%m/%d/%Y').date()
    except ValueError:
        return None


def _normalize_recurrence_value(raw_value):
    value = _normalize_whitespace(raw_value).lower()
    if not value or value in {'no', 'ninguna', 'n/a', 'na'}:
        return ''

    mapping = {
        'diaria': 'Diaria',
        'semanal': 'Semanal',
        'mensual': 'Mensual',
    }
    return mapping.get(value, None)


def _decode_csv_bytes(raw_bytes):
    for encoding in ('utf-8-sig', 'utf-16', 'cp1252', 'latin-1'):
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    return None


def _normalize_lookup(value):
    normalized = _normalize_whitespace(value).lower()
    normalized = ''.join(
        ch for ch in unicodedata.normalize('NFKD', normalized)
        if not unicodedata.combining(ch)
    )
    return normalized


def _parse_csv_flexible_date(raw_value):
    value = (str(raw_value or '')).strip()
    if not value:
        return None, None

    iso_match = re.fullmatch(r'(\d{4})-(\d{1,2})-(\d{1,2})', value)
    if iso_match:
        year, month, day = (int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3)))
        try:
            return date(year, month, day), None
        except ValueError:
            return None, None

    slash_match = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{2,4})', value)
    if slash_match:
        month = int(slash_match.group(1))
        day = int(slash_match.group(2))
        year = int(slash_match.group(3))
        if year < 100:
            year += 2000
        try:
            return date(year, month, day), None
        except ValueError:
            return None, None

    month_name_match = re.fullmatch(r'(\d{1,2})\s*[-/]\s*([A-Za-z]{3,9})(?:\s*[-/]\s*(\d{2,4}))?', value)
    if month_name_match:
        month_map = {
            'jan': 1, 'january': 1,
            'feb': 2, 'february': 2,
            'mar': 3, 'march': 3,
            'apr': 4, 'april': 4,
            'may': 5,
            'jun': 6, 'june': 6,
            'jul': 7, 'july': 7,
            'aug': 8, 'august': 8,
            'sep': 9, 'sept': 9, 'september': 9,
            'oct': 10, 'october': 10,
            'nov': 11, 'november': 11,
            'dec': 12, 'december': 12,
        }

        day = int(month_name_match.group(1))
        month_token = _normalize_lookup(month_name_match.group(2))
        month = month_map.get(month_token)
        if not month:
            return None, None

        year_token = (month_name_match.group(3) or '').strip()
        warning_code = None
        if year_token:
            try:
                year = int(year_token)
            except ValueError:
                return None, None
            if year < 100:
                year += 2000
        else:
            year = current_year()
            warning_code = 'year_inferred_current'

        try:
            return date(year, month, day), warning_code
        except ValueError:
            return None, None

    return None, None


def _resolve_assignee_user(raw_value, users):
    lookup = _normalize_lookup(raw_value)
    if not lookup:
        return None, {'status': 'empty', 'candidates': []}

    for user in users:
        if _normalize_lookup(user.email) == lookup:
            return user, {'status': 'exact_email', 'candidates': []}

    for user in users:
        if _normalize_lookup(user.username) == lookup:
            return user, {'status': 'exact_username', 'candidates': []}

    partial_matches = []
    for user in users:
        user_name = _normalize_lookup(user.username)
        user_email = _normalize_lookup(user.email)
        tokens = user_name.split()
        if (
            lookup in user_name
            or lookup in user_email
            or any(token.startswith(lookup) for token in tokens)
        ):
            partial_matches.append(user)

    unique_matches = {u.id: u for u in partial_matches}
    if len(unique_matches) == 1:
        user = next(iter(unique_matches.values()))
        return user, {'status': 'partial_unique', 'candidates': [user.username]}

    if len(unique_matches) > 1:
        labels = [u.username for u in list(unique_matches.values())[:5]]
        return None, {'status': 'ambiguous', 'candidates': labels}

    return None, {'status': 'not_found', 'candidates': []}


def _extract_task_csv_rows(decoded_text):
    sample = decoded_text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t')
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ','

    reader = csv.DictReader(io.StringIO(decoded_text), delimiter=delimiter)
    fieldnames = reader.fieldnames or []
    if not fieldnames:
        return None, {
            'error': 'No se detectaron cabeceras en el CSV.',
            'details': {
                'missing_headers': TASK_CSV_COLUMNS,
                'unexpected_headers': [],
                'duplicate_headers': [],
                'expected_headers': TASK_CSV_COLUMNS,
            }
        }

    expected_by_norm = {_normalize_csv_header(c): c for c in TASK_CSV_COLUMNS}
    received_by_norm = {}
    duplicate_headers = []

    for header in fieldnames:
        normalized = _normalize_csv_header(header)
        if normalized in received_by_norm:
            duplicate_headers.append(_normalize_whitespace(header))
            continue
        received_by_norm[normalized] = header

    missing_headers = [label for norm, label in expected_by_norm.items() if norm not in received_by_norm]
    unexpected_headers = [
        _normalize_whitespace(header)
        for header in fieldnames
        if _normalize_csv_header(header) not in expected_by_norm
    ]

    if duplicate_headers or missing_headers or unexpected_headers:
        return None, {
            'error': 'La estructura del CSV no coincide con el formato requerido.',
            'details': {
                'missing_headers': missing_headers,
                'unexpected_headers': unexpected_headers,
                'duplicate_headers': duplicate_headers,
                'expected_headers': TASK_CSV_COLUMNS,
            }
        }

    header_map = {
        key: received_by_norm[_normalize_csv_header(label)]
        for key, label in TASK_CSV_FIELD_DEFS
    }

    rows = []
    for row_number, raw_row in enumerate(reader, start=2):
        if raw_row is None:
            continue

        raw_values = [str(v or '') for v in raw_row.values()]
        if not any(v.strip() for v in raw_values):
            continue

        fields = {}
        for key, _label in TASK_CSV_FIELD_DEFS:
            raw_value = raw_row.get(header_map[key], '')
            fields[key] = str(raw_value or '')

        rows.append({
            'row_number': row_number,
            'fields': fields,
        })

    return rows, None


def _validate_task_csv_row(row_fields, users):
    fields = {
        key: str((row_fields or {}).get(key, '') or '')
        for key, _label in TASK_CSV_FIELD_DEFS
    }

    clean_fields = {key: value.strip() for key, value in fields.items()}
    issues = []

    def add_issue(severity, key, code, message, value=None):
        issues.append({
            'severity': severity,
            'column': TASK_CSV_KEY_TO_LABEL.get(key, key),
            'code': code,
            'message': message,
            'value': value if value is not None else fields.get(key, ''),
        })

    if not clean_fields['title']:
        add_issue('error', 'title', 'required', 'El título es obligatorio.')

    if not clean_fields['client']:
        add_issue('warning', 'client', 'recommended', 'Se recomienda indicar el cliente para mayor claridad.')

    if not clean_fields['requested_by']:
        add_issue('warning', 'requested_by', 'recommended', 'Se recomienda indicar quién solicitó la tarea.')

    assignee, assignee_match = _resolve_assignee_user(clean_fields['assignee'], users)
    if assignee_match['status'] == 'empty':
        add_issue('error', 'assignee', 'required', 'Debes indicar a quién asignar la tarea.')
    elif assignee_match['status'] == 'not_found':
        add_issue('error', 'assignee', 'assignee_not_found', 'No se encontró un usuario activo con ese nombre o correo.')
    elif assignee_match['status'] == 'ambiguous':
        candidates = ', '.join(assignee_match.get('candidates') or [])
        message = 'Coincidencia ambigua en "Asignar a".'
        if candidates:
            message = f'{message} Posibles usuarios: {candidates}.'
        add_issue('error', 'assignee', 'assignee_ambiguous', message)
    elif assignee_match['status'] == 'partial_unique':
        add_issue(
            'warning',
            'assignee',
            'assignee_partial_match',
            f'Se resolvió por coincidencia parcial con: {assignee.username}.',
            fields['assignee'],
        )

    start_date, start_date_warning = _parse_csv_flexible_date(clean_fields['start_date'])
    if clean_fields['start_date'] and not start_date:
        add_issue('error', 'start_date', 'invalid_date', 'Fecha inválida. Usa MM/DD/YYYY o D-MMM.')
    elif start_date_warning == 'year_inferred_current':
        add_issue(
            'warning',
            'start_date',
            'year_inferred_current',
            f'Se infirió el año actual ({current_year()}) para esta fecha.',
        )

    end_date, end_date_warning = _parse_csv_flexible_date(clean_fields['end_date'])
    if clean_fields['end_date'] and not end_date:
        add_issue('error', 'end_date', 'invalid_date', 'Fecha inválida. Usa MM/DD/YYYY o D-MMM.')
    elif end_date_warning == 'year_inferred_current':
        add_issue(
            'warning',
            'end_date',
            'year_inferred_current',
            f'Se infirió el año actual ({current_year()}) para esta fecha.',
        )

    due_date, due_date_warning = _parse_csv_flexible_date(clean_fields['due_date'])
    if not clean_fields['due_date']:
        add_issue('error', 'due_date', 'required', 'La fecha de entrega es obligatoria.')
    elif not due_date:
        add_issue('error', 'due_date', 'invalid_date', 'Fecha inválida. Usa MM/DD/YYYY o D-MMM.')
    elif due_date_warning == 'year_inferred_current':
        add_issue(
            'warning',
            'due_date',
            'year_inferred_current',
            f'Se infirió el año actual ({current_year()}) para esta fecha.',
        )

    recurrence_type = _normalize_recurrence_value(clean_fields['recurrence'])
    if recurrence_type is None:
        add_issue('error', 'recurrence', 'invalid_recurrence', 'Valor inválido. Usa: No, Diaria, Semanal o Mensual.')
        recurrence_type = ''

    prioridad_default = prioridad_por_defecto()
    priority = clean_fields['priority'] or prioridad_default
    if priority not in prioridades_validas():
        add_issue(
            'warning',
            'priority',
            'invalid_priority_fallback',
            f'Prioridad inválida. Se usará {prioridad_default}.',
        )
        priority = prioridad_default

    if due_date and _is_weekend(due_date):
        add_issue('error', 'due_date', 'weekend_not_allowed', 'Sábado y domingo solo se permiten para tareas manuales, no por CSV.')

    if start_date and end_date and end_date < start_date:
        add_issue('error', 'end_date', 'invalid_range', 'La fecha de finalización no puede ser menor que la fecha de inicio.')

    has_errors = any(issue['severity'] == 'error' for issue in issues)
    has_warnings = any(issue['severity'] == 'warning' for issue in issues)
    status = 'error' if has_errors else ('warning' if has_warnings else 'ok')

    parsed_preview = {
        'start_date': _format_mmddyyyy(start_date),
        'end_date': _format_mmddyyyy(end_date),
        'due_date': _format_mmddyyyy(due_date),
        'recurrence_type': recurrence_type or 'No',
        'priority': priority,
        'assignee_resolved': assignee.username if assignee else '',
    }

    return {
        'status': status,
        'issues': issues,
        'fields': fields,
        'clean_fields': clean_fields,
        'parsed': {
            'start_date': start_date,
            'end_date': end_date,
            'due_date': due_date,
            'assignee': assignee,
            'priority': priority,
            'recurrence_type': recurrence_type,
        },
        'preview': parsed_preview,
    }


def _build_csv_preview_rows(rows, users):
    preview_rows = []
    ok_rows = 0
    warning_rows = 0
    error_rows = 0
    flat_errors = []

    for row in rows:
        row_number = int(row.get('row_number') or 0)
        fields = row.get('fields') or {}
        validation = _validate_task_csv_row(fields, users)

        preview_row = {
            'row_number': row_number,
            'fields': validation['fields'],
            'status': validation['status'],
            'issues': validation['issues'],
            'parsed': validation['preview'],
        }
        preview_rows.append(preview_row)

        if validation['status'] == 'ok':
            ok_rows += 1
        elif validation['status'] == 'warning':
            warning_rows += 1
        else:
            error_rows += 1

        for issue in validation['issues']:
            if issue['severity'] != 'error':
                continue
            flat_errors.append({
                'row': row_number,
                'column': issue.get('column', 'General'),
                'value': issue.get('value', ''),
                'code': issue.get('code', 'error'),
                'message': issue.get('message', 'Error de validación.'),
            })

    return {
        'rows': preview_rows,
        'total_rows': len(preview_rows),
        'ok_rows': ok_rows,
        'warning_rows': warning_rows,
        'error_rows': error_rows,
        'errors': flat_errors,
    }


def _create_tasks_from_validated_csv(validation):
    parsed = validation['parsed']
    clean = validation['clean_fields']

    assignee = parsed['assignee']
    due_date = parsed['due_date']
    start_date = parsed['start_date']
    end_date = parsed['end_date']
    priority = parsed['priority']

    area, area_id = _task_area_for_user(assignee)
    task = Task(
        title=clean['title'],
        description=clean['description'],
        client=clean['client'],
        start_date=start_date,
        end_date=end_date,
        directorate=clean['directorate'],
        requested_by=clean['requested_by'],
        budget_type=clean['budget_type'],
        due_date=due_date,
        status=estado_inicial(),
        priority=priority,
        is_recurrent=False,
        recurrence_type=None,
        area=area,
        area_id=area_id,
        creator_id=current_user.id,
        assignee_id=assignee.id,
    )
    db.session.add(task)

    return 1


# ─────────────────────────────────────────────────────────────
# Page view
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/tasks')
@task_access_required
def tasks_page():
    """Render the main calendar/task view."""
    try:
        ensure_due_notifications(current_user)
    except Exception:
        db.session.rollback()

    area_users = _unit_user_query(active_only=True).order_by(User.username).all()
    area_options = []

    if current_user.is_admin:
        area_names = {a.name for a in Area.query.order_by(Area.name).all() if a.name}
        task_areas = {
            r[0] for r in db.session.query(Task.area)
            .filter(Task.area.isnot(None), Task.area != '')
            .distinct().all()
        }
        area_options = sorted(area_names.union(task_areas))

    # La vista Hoy agrupa por dia. El dia de referencia lo fija el servidor en
    # la zona de negocio, no el reloj del navegador: alguien conectado desde
    # otro huso veria 'hoy' desplazado y con ello las tareas vencidas.
    return render_template(
        'tasks.html',
        area_users=area_users,
        area_options=area_options,
        task_statuses=estados_validos(),
        task_priorities=prioridades_validas(),
        initial_status=estado_inicial(),
        default_priority=prioridad_por_defecto(),
        hoy=today_local().isoformat(),
    )


# ─────────────────────────────────────────────────────────────
# API: List tasks (JSON feed for FullCalendar)
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks')
@task_access_required
def api_tasks_list():
    """Return tasks as JSON, isolated by unit."""
    start = request.args.get('start', '')
    end = request.args.get('end', '')
    q = request.args.get('q', '').strip()
    overdue = request.args.get('overdue', '').strip()
    status = request.args.get('status', '').strip()
    priority = request.args.get('priority', '').strip()
    assignee_id = request.args.get('assignee_id', '').strip()
    client = request.args.get('client', '').strip()
    area = request.args.get('area', '').strip()

    query = _apply_unit_scope(Task.active_query())

    if q and len(q) >= 2:
        q_param = f'%{q}%'
        query = query.filter(or_(Task.title.ilike(q_param), Task.description.ilike(q_param), Task.client.ilike(q_param)))
    elif q and len(q) < 2:
        return jsonify([])

    if overdue == '1':
        today_ref = today_local()
        query = query.filter(Task.due_date < today_ref, Task.status != 'Completado')

    if status and status in estados_validos():
        query = query.filter_by(status=status)
    if priority and priority in prioridades_validas():
        query = query.filter_by(priority=priority)

    if assignee_id:
        try:
            query = query.filter_by(assignee_id=int(assignee_id))
        except ValueError:
            pass

    if client:
        query = query.filter(Task.client.ilike(f'%{client}%'))
    if area:
        query = query.filter_by(area=area)

    # FullCalendar date range filter
    # Skip calendar date range filter when overdue=1 (we want ALL overdue tasks)
    if overdue != '1':
        if start:
            try:
                query = query.filter(Task.due_date >= date.fromisoformat(start[:10]))
            except ValueError:
                pass
        if end:
            try:
                query = query.filter(Task.due_date <= date.fromisoformat(end[:10]))
            except ValueError:
                pass

    tasks = _with_task_relations(query).order_by(Task.due_date.asc()).limit(TASK_FEED_MAX_ROWS).all()
    return jsonify([t.to_dict() for t in tasks])


@tasks_bp.route('/api/tasks/watching')
@task_access_required
def api_tasks_watching():
    tasks = Task.active_query().join(TaskWatcher, TaskWatcher.task_id == Task.id).filter(
        TaskWatcher.user_id == current_user.id,
        Task.visibility == 'shared',
    )
    tasks = _with_task_relations(tasks).order_by(Task.due_date.asc()).limit(TASK_FEED_MAX_ROWS).all()
    return jsonify({'success': True, 'tasks': [task.to_dict() for task in tasks]})


# ─────────────────────────────────────────────────────────────
# API: Checklist items
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks/<int:task_id>/checklist', methods=['GET'])
@task_access_required
def api_checklist_list(task_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_view_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403
    items = TaskChecklistItem.query.filter_by(task_id=task.id).order_by(TaskChecklistItem.position).all()
    return jsonify({'success': True, 'items': [it.to_dict() for it in items]})


@tasks_bp.route('/api/tasks/<int:task_id>/checklist', methods=['POST'])
@task_access_required
def api_checklist_add(task_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    data = request.get_json(force=True) or {}
    body = (data.get('body') or '').strip()
    if not body:
        return jsonify({'success': False, 'error': 'Texto requerido.'}), 400
    if len(body) > 500:
        return jsonify({'success': False, 'error': 'Máximo 500 caracteres.'}), 400

    max_pos = db.session.query(db.func.coalesce(db.func.max(TaskChecklistItem.position), -1)) \
        .filter(TaskChecklistItem.task_id == task.id).scalar()
    item = TaskChecklistItem(task_id=task.id, body=body, position=max_pos + 1)
    db.session.add(item)
    db.session.commit()
    return jsonify({'success': True, 'item': item.to_dict()}), 201


@tasks_bp.route('/api/tasks/<int:task_id>/checklist/<int:item_id>', methods=['PUT'])
@task_access_required
def api_checklist_update(task_id, item_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    item = TaskChecklistItem.query.filter_by(id=item_id, task_id=task.id).first_or_404()
    data = request.get_json(force=True) or {}

    if 'body' in data:
        body = (data['body'] or '').strip()
        if not body:
            return jsonify({'success': False, 'error': 'Texto requerido.'}), 400
        if len(body) > 500:
            return jsonify({'success': False, 'error': 'Máximo 500 caracteres.'}), 400
        item.body = body

    if 'is_completed' in data:
        completed = bool(data['is_completed'])
        if completed and not item.is_completed:
            item.is_completed = True
            item.completed_at = datetime.utcnow()
            item.completed_by_id = current_user.id
        elif not completed and item.is_completed:
            item.is_completed = False
            item.completed_at = None
            item.completed_by_id = None

    if 'position' in data:
        try:
            item.position = int(data['position'])
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Posición no válida.'}), 400

    db.session.commit()
    return jsonify({'success': True, 'item': item.to_dict()})


@tasks_bp.route('/api/tasks/<int:task_id>/checklist/<int:item_id>', methods=['DELETE'])
@task_access_required
def api_checklist_delete(task_id, item_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    item = TaskChecklistItem.query.filter_by(id=item_id, task_id=task.id).first_or_404()
    db.session.delete(item)
    db.session.commit()
    return jsonify({'success': True})


@tasks_bp.route('/api/tasks/<int:task_id>/watchers', methods=['POST'])
@task_access_required
def api_task_watchers_add(task_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    data = request.get_json(force=True) or {}
    try:
        user_id = int(data.get('user_id'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Usuario no válido.'}), 400

    watcher_user = User.query.get(user_id)
    if not watcher_user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404

    watcher = TaskWatcher.query.filter_by(task_id=task.id, user_id=user_id).first()
    if watcher is None:
        watcher = TaskWatcher(task_id=task.id, user_id=user_id, added_by_id=current_user.id)
        db.session.add(watcher)

    # Marcar compartida si el observador viene de fuera del ambito de quien lo
    # anade. Con un manager de varias unidades, "fuera" ya no es "otra area_id":
    # es fuera del conjunto con el que trabaja.
    ambito = ambito_unidades(current_user)
    if ambito and watcher_user.area_id and watcher_user.area_id not in ambito:
        task.visibility = 'shared'

    notify_user(
        watcher_user.id,
        'task_comment',
        f'Ahora observas la tarea: {task.title}',
        link_url=f'/tasks?task={task.id}',
        entity_type='task',
        entity_id=task.id,
        actor_id=current_user.id,
    )
    db.session.commit()
    return jsonify({'success': True, 'watcher': {
        'user_id': watcher_user.id,
        'username': watcher_user.username,
        'unit': watcher_user.area.name if watcher_user.area and watcher_user.area.name else (watcher_user.role or ''),
        'is_self': watcher_user.id == current_user.id,
    }})


@tasks_bp.route('/api/tasks/<int:task_id>/watchers/<int:user_id>', methods=['DELETE'])
@task_access_required
def api_task_watchers_remove(task_id, user_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    watcher = TaskWatcher.query.filter_by(task_id=task.id, user_id=user_id).first()
    if not watcher:
        return jsonify({'success': False, 'error': 'Observador no encontrado.'}), 404
    if not _can_edit_task(task) and current_user.id != user_id:
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    db.session.delete(watcher)
    db.session.commit()
    return jsonify({'success': True})


# ─────────────────────────────────────────────────────────────
# API: Task Templates CRUD + Instantiate
# ─────────────────────────────────────────────────────────────

def _validate_template_payload(payload):
    """Validate template payload fields, return (cleaned, error)."""
    title = (payload.get('title') or '').strip()
    if not title:
        return None, 'El título es obligatorio.'
    priority = (payload.get('priority') or 'Media').strip()
    if priority not in prioridades_validas():
        return None, 'Prioridad inválida.'
    due_offset = payload.get('due_offset_days')
    try:
        due_offset = int(due_offset) if due_offset is not None else 0
    except (TypeError, ValueError):
        return None, 'due_offset_days debe ser un número entero.'
    if due_offset < 0 or due_offset > 90:
        return None, 'due_offset_days debe estar entre 0 y 90.'
    checklist = payload.get('checklist')
    if not isinstance(checklist, list):
        checklist = []
    if len(checklist) > 30:
        return None, 'Máximo 30 ítems en el checklist.'
    for i, item in enumerate(checklist):
        if not isinstance(item, str) or not item.strip():
            return None, f'Checklist ítem #{i+1} inválido.'
    return {
        'title': title,
        'description': (payload.get('description') or '').strip(),
        'client': (payload.get('client') or '').strip(),
        'priority': priority,
        'budget_type': (payload.get('budget_type') or '').strip(),
        'due_offset_days': due_offset,
        'checklist': [it.strip() for it in checklist],
    }, None


@tasks_bp.route('/api/tasks/templates', methods=['GET'])
@task_access_required
def api_templates_list():
    if current_user.is_admin:
        templates = TaskTemplate.query.order_by(TaskTemplate.name).all()
    else:
        # El ambito, no la unidad: quien lleva dos unidades usa las plantillas
        # de las dos, y un director las de sus managers.
        unidades = ambito_unidades(current_user)
        templates = (TaskTemplate.query.filter(TaskTemplate.area_id.in_(unidades))
                     .order_by(TaskTemplate.name).all()) if unidades else []
    return jsonify({'success': True, 'templates': [t.to_dict() for t in templates]})


@tasks_bp.route('/api/tasks/templates', methods=['POST'])
@task_access_required
def api_templates_create():
    if not current_user.area_id:
        return jsonify({'success': False, 'error': 'Tu usuario no tiene unidad asignada.'}), 400

    # Max 50 per area
    existing_count = TaskTemplate.query.filter_by(area_id=current_user.area_id).count()
    if existing_count >= 50:
        return jsonify({'success': False, 'error': 'Máximo 50 plantillas por unidad.'}), 400

    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'success': False, 'error': 'El nombre de la plantilla es obligatorio.'}), 400

    payload, error = _validate_template_payload(data.get('payload') or {})
    if error:
        return jsonify({'success': False, 'error': error}), 400

    template = TaskTemplate(
        area_id=current_user.area_id,
        created_by_id=current_user.id,
        name=name,
        payload_json=json.dumps(payload),
    )
    db.session.add(template)
    db.session.commit()
    return jsonify({'success': True, 'template': template.to_dict()}), 201


@tasks_bp.route('/api/tasks/templates/<int:template_id>', methods=['PUT'])
@task_access_required
def api_templates_update(template_id):
    template = TaskTemplate.query.get_or_404(template_id)
    if not current_user.is_admin and template.area_id not in ambito_unidades(current_user):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    data = request.get_json(force=True) or {}

    if 'name' in data:
        name = (data['name'] or '').strip()
        if not name:
            return jsonify({'success': False, 'error': 'El nombre es obligatorio.'}), 400
        template.name = name

    if 'payload' in data:
        payload, error = _validate_template_payload(data['payload'])
        if error:
            return jsonify({'success': False, 'error': error}), 400
        template.payload_json = json.dumps(payload)

    db.session.commit()
    return jsonify({'success': True, 'template': template.to_dict()})


@tasks_bp.route('/api/tasks/templates/<int:template_id>', methods=['DELETE'])
@task_access_required
def api_templates_delete(template_id):
    template = TaskTemplate.query.get_or_404(template_id)
    if not current_user.is_admin and template.area_id not in ambito_unidades(current_user):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403
    db.session.delete(template)
    db.session.commit()
    return jsonify({'success': True})


def _business_day_offset(start_date, offset_days):
    """Add offset_days skipping weekends."""
    from datetime import timedelta
    current = start_date
    while offset_days > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:  # Mon-Fri
            offset_days -= 1
    return current


@tasks_bp.route('/api/tasks/templates/<int:template_id>/instantiate', methods=['POST'])
@task_access_required
def api_templates_instantiate(template_id):
    template = TaskTemplate.query.get_or_404(template_id)
    if not current_user.is_admin and template.area_id not in ambito_unidades(current_user):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    data = request.get_json(force=True) or {}
    assignee_id = data.get('assignee_id')
    try:
        assignee_id = int(assignee_id) if assignee_id else None
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Asignado no válido.'}), 400

    if not assignee_id:
        return jsonify({'success': False, 'error': 'Debes seleccionar un asignado.'}), 400
    assignee = User.query.get(assignee_id)
    if not assignee or not assignee.is_active:
        return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
    # Misma regla que en el resto de asignaciones, en vez de una comparacion
    # propia: quien lleva dos unidades puede instanciar hacia cualquiera de las
    # dos, y un director hacia las de sus managers.
    if not _assignee_in_current_unit(assignee):
        return jsonify({'success': False, 'error': 'El asignado debe estar en tu ambito.'}), 400

    payload = template.get_payload()
    if not payload:
        return jsonify({'success': False, 'error': 'Plantilla inválida.'}), 400

    due_date_str = data.get('due_date', '').strip()
    if due_date_str:
        try:
            due_date = date.fromisoformat(due_date_str)
        except (ValueError, TypeError):
            return jsonify({'success': False, 'error': 'Fecha de entrega no válida.'}), 400
    else:
        due_date = _business_day_offset(today_local(), payload.get('due_offset_days', 0))

    try:
        task = Task(
            title=payload['title'],
            description=payload.get('description', ''),
            client=payload.get('client', ''),
            due_date=due_date,
            priority=payload.get('priority', 'Media'),
            status='Pendiente',
            area=current_user.area.name if current_user.area else '',
            area_id=current_user.area_id,
            creator_id=current_user.id,
            assignee_id=assignee_id,
        )
        db.session.add(task)
        db.session.flush()

        # Create checklist items from template
        checklist_items = payload.get('checklist', [])
        for idx, item_body in enumerate(checklist_items):
            item = TaskChecklistItem(
                task_id=task.id,
                body=item_body,
                position=idx,
            )
            db.session.add(item)

        notify_user(
            assignee_id,
            'task_assigned',
            f'Te asignaron: {task.title}',
            link_url=f'/tasks?task={task.id}',
            entity_type='task',
            entity_id=task.id,
            actor_id=current_user.id,
        )

        db.session.commit()
        return jsonify({'success': True, 'task': task.to_dict()}), 201

    except Exception:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'Error al crear la tarea desde plantilla.'}), 500


# ─────────────────────────────────────────────────────────────
# API: Create task (+ recurrence expansion)
# ─────────────────────────────────────────────────────────────

def _generate_recurrence_dates(start_date, recurrence_type, end_date):
    """Generate recurrence dates up to end_date excluding weekends."""
    dates = []
    current = start_date
    delta_map = {
        'Diaria': timedelta(days=1),
        'Semanal': timedelta(weeks=1),
        'Mensual': None,  # handled separately
    }

    if recurrence_type == 'Mensual':
        while current <= end_date:
            if not _is_weekend(current):
                dates.append(current)
            # Move to same day next month
            month = current.month + 1
            year = current.year
            if month > 12:
                month = 1
                year += 1
            try:
                current = current.replace(year=year, month=month)
            except ValueError:
                # e.g. Jan 31 -> Feb 28
                import calendar
                last_day = calendar.monthrange(year, month)[1]
                current = current.replace(year=year, month=month, day=min(current.day, last_day))
    else:
        delta = delta_map.get(recurrence_type, timedelta(weeks=1))
        while current <= end_date:
            if not _is_weekend(current):
                dates.append(current)
            current += delta

    return dates


@tasks_bp.route('/api/tasks', methods=['POST'])
@task_access_required
def api_tasks_create():
    """Create a task. If recurrent, expand all instances up to recurrence_end."""
    data = request.get_json(force=True)

    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'success': False, 'error': 'El título es obligatorio.'}), 400

    description = (data.get('description') or '').strip()
    client = (data.get('client') or '').strip()
    directorate = (data.get('directorate') or '').strip()
    requested_by = (data.get('requested_by') or '').strip()
    budget_type = (data.get('budget_type') or '').strip()
    assignee_id = data.get('assignee_id')
    due_date_str = data.get('due_date', '')
    start_date_raw = data.get('start_date', '')
    end_date_raw = data.get('end_date', '')
    is_recurrent = bool(data.get('is_recurrent'))
    recurrence_type = data.get('recurrence_type', '')
    recurrence_end_str = (data.get('recurrence_end', '') or '').strip()
    initial_status = (data.get('status') or '').strip() or 'Pendiente'
    priority = (data.get('priority') or 'Media').strip()
    if not recurrence_end_str and end_date_raw:
        recurrence_end_str = str(end_date_raw)

    if initial_status not in estados_validos():
        return jsonify({'success': False, 'error': 'Estado inválido.'}), 400
    if priority not in prioridades_validas():
        return jsonify({'success': False, 'error': 'Prioridad inválida.'}), 400

    if not assignee_id:
        return jsonify({'success': False, 'error': 'Debes asignar la tarea a alguien.'}), 400
    if not due_date_str:
        return jsonify({'success': False, 'error': 'La fecha de entrega es obligatoria.'}), 400

    due = _parse_iso_or_mmddyyyy_date(due_date_str)
    if not due:
        return jsonify({'success': False, 'error': 'Fecha de entrega inválida.'}), 400

    start_date_value = _parse_iso_or_mmddyyyy_date(start_date_raw)
    if str(start_date_raw or '').strip() and not start_date_value:
        return jsonify({'success': False, 'error': 'Fecha de inicio inválida.'}), 400

    end_date_value = _parse_iso_or_mmddyyyy_date(end_date_raw)
    if str(end_date_raw or '').strip() and not end_date_value:
        return jsonify({'success': False, 'error': 'Fecha de finalización inválida.'}), 400

    if start_date_value and end_date_value and end_date_value < start_date_value:
        return jsonify({'success': False, 'error': 'La fecha de finalización no puede ser menor que la fecha de inicio.'}), 400

    # Validate assignee belongs to the same unit
    assignee = User.query.get(int(assignee_id))
    if not assignee:
        return jsonify({'success': False, 'error': 'El usuario asignado no existe.'}), 400
    if not _assignee_in_current_unit(assignee):
        return jsonify({'success': False, 'error': 'Solo puedes asignar tareas a usuarios de tu unidad.'}), 400

    area, area_id = _task_area_for_user(assignee)

    created_tasks = []

    if is_recurrent:
        if recurrence_type not in Task.RECURRENCE_TYPES:
            return jsonify({'success': False, 'error': 'Selecciona una frecuencia de recurrencia válida.'}), 400
        if _is_weekend(due):
            return jsonify({'success': False, 'error': 'Las tareas recurrentes no pueden iniciar en sábado o domingo.'}), 400
        if not recurrence_end_str:
            return jsonify({'success': False, 'error': 'Debes indicar la fecha de finalización para la recurrencia.'}), 400

        recurrence_end = _parse_iso_or_mmddyyyy_date(recurrence_end_str)
        if not recurrence_end:
            return jsonify({'success': False, 'error': 'Fecha fin de recurrencia inválida.'}), 400

        if recurrence_end < due:
            return jsonify({'success': False, 'error': 'La fecha final de recurrencia no puede ser menor que la fecha de entrega.'}), 400

        end_date_value = recurrence_end

        dates = _generate_recurrence_dates(due, recurrence_type, recurrence_end)
        if not dates:
            return jsonify({'success': False, 'error': 'No se pudieron generar fechas laborables para la recurrencia.'}), 400
        if len(dates) > 365:
            return jsonify({'success': False, 'error': 'La recurrencia genera demasiadas tareas (máx. 365).'}), 400

        # Create the parent task first
        parent = Task(
            title=title, description=description, client=client,
            start_date=start_date_value, end_date=end_date_value,
            directorate=directorate, requested_by=requested_by, budget_type=budget_type,
            due_date=dates[0], status=initial_status, priority=priority,
            is_recurrent=True, recurrence_type=recurrence_type,
            area=area, area_id=area_id, creator_id=current_user.id, assignee_id=assignee.id,
        )
        db.session.add(parent)
        db.session.flush()  # get parent.id

        created_tasks.append(parent)

        for d in dates[1:]:
            child = Task(
                title=title, description=description, client=client,
                start_date=start_date_value, end_date=end_date_value,
                directorate=directorate, requested_by=requested_by, budget_type=budget_type,
                due_date=d, status=initial_status, priority=priority,
                is_recurrent=True, recurrence_type=recurrence_type,
                parent_task_id=parent.id,
                area=area, area_id=area_id, creator_id=current_user.id, assignee_id=assignee.id,
            )
            db.session.add(child)
            created_tasks.append(child)
    else:
        task = Task(
            title=title, description=description, client=client,
            start_date=start_date_value, end_date=end_date_value,
            directorate=directorate, requested_by=requested_by, budget_type=budget_type,
            due_date=due, status=initial_status, priority=priority,
            is_recurrent=False,
            area=area, area_id=area_id, creator_id=current_user.id, assignee_id=assignee.id,
        )
        db.session.add(task)
        created_tasks.append(task)

    primary_task = created_tasks[0] if created_tasks else None
    if primary_task and assignee.id != current_user.id:
        notify_user(
            assignee.id,
            'task_assigned',
            f'Nueva tarea asignada: {primary_task.title}',
            link_url=f'/tasks?task={primary_task.id}',
            entity_type='task',
            entity_id=primary_task.id,
            actor_id=current_user.id,
        )

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity(
        'task_create',
        f'Tarea creada: {title} ({len(created_tasks)} instancia(s))',
        entity_type='task',
        entity_id=primary_task.id if primary_task else None,
    )

    return jsonify({
        'success': True,
        'tasks': [t.to_dict() for t in created_tasks],
        'count': len(created_tasks),
    })


@tasks_bp.route('/api/tasks/bulk-create', methods=['POST'])
@task_access_required
def api_tasks_bulk_create():
    """Create multiple non-recurrent tasks from a batch payload."""
    data = request.get_json(force=True) or {}
    raw_tasks = data.get('tasks')

    if not isinstance(raw_tasks, list) or not raw_tasks:
        return jsonify({'success': False, 'error': 'Debes enviar una lista de tareas.'}), 400
    if len(raw_tasks) > 500:
        return jsonify({'success': False, 'error': 'Puedes pegar hasta 500 tareas por lote.'}), 400

    created_tasks = []
    failures = []

    for idx, item in enumerate(raw_tasks):
        if not isinstance(item, dict):
            failures.append({'index': idx, 'error': 'Formato inválido.'})
            continue

        title = (item.get('title') or '').strip()
        due_date_raw = (item.get('due_date') or '').strip()
        assignee_id = item.get('assignee_id')

        if not title:
            failures.append({'index': idx, 'error': 'El título es obligatorio.'})
            continue

        due_date_value = _parse_iso_or_mmddyyyy_date(due_date_raw)
        if not due_date_value:
            failures.append({'index': idx, 'error': 'Fecha de entrega inválida.'})
            continue

        start_date_raw = (item.get('start_date') or '').strip()
        end_date_raw = (item.get('end_date') or '').strip()
        start_date_value = _parse_iso_or_mmddyyyy_date(start_date_raw) if start_date_raw else None
        end_date_value = _parse_iso_or_mmddyyyy_date(end_date_raw) if end_date_raw else None

        if start_date_raw and not start_date_value:
            failures.append({'index': idx, 'error': 'Fecha de inicio inválida.'})
            continue
        if end_date_raw and not end_date_value:
            failures.append({'index': idx, 'error': 'Fecha de finalización inválida.'})
            continue
        if start_date_value and end_date_value and end_date_value < start_date_value:
            failures.append({'index': idx, 'error': 'La fecha final no puede ser menor que la fecha de inicio.'})
            continue

        try:
            assignee = User.query.get(int(assignee_id))
        except (ValueError, TypeError):
            assignee = None

        if not assignee:
            failures.append({'index': idx, 'error': 'El usuario asignado no existe.'})
            continue
        if not _assignee_in_current_unit(assignee):
            failures.append({'index': idx, 'error': 'Solo puedes asignar tareas a usuarios de tu unidad.'})
            continue

        area, area_id = _task_area_for_user(assignee)
        task = Task(
            title=title,
            description=(item.get('description') or '').strip(),
            client=(item.get('client') or '').strip(),
            start_date=start_date_value,
            end_date=end_date_value,
            directorate=(item.get('directorate') or '').strip(),
            requested_by=(item.get('requested_by') or '').strip(),
            budget_type=(item.get('budget_type') or '').strip(),
            due_date=due_date_value,
            status='Pendiente',
            is_recurrent=False,
            area=area,
            area_id=area_id,
            creator_id=current_user.id,
            assignee_id=assignee.id,
        )
        db.session.add(task)
        created_tasks.append(task)

    if created_tasks:
        db.session.commit()

        from blueprints.admin import log_activity
        log_activity(
            'task_bulk_create',
            f'Pegado masivo de tareas: {len(created_tasks)} creadas. ids={[task.id for task in created_tasks]}',
            entity_type='task_bulk',
        )
    else:
        db.session.rollback()

    return jsonify({
        'success': True,
        'created': len(created_tasks),
        'failed': len(failures),
        'failures': failures,
        'tasks': [t.to_dict() for t in created_tasks],
    })


@tasks_bp.route('/api/tasks/bulk-update', methods=['POST'])
@task_access_required
def api_tasks_bulk_update():
    """Update status for selected task instances in current unit scope."""
    data = request.get_json(force=True) or {}
    status = (data.get('status') or '').strip()
    priority = (data.get('priority') or '').strip()
    due_date_map_raw = data.get('due_date_map') if isinstance(data.get('due_date_map'), dict) else None

    task_ids = _parse_task_ids(data.get('task_ids'))
    if due_date_map_raw:
        task_ids = _parse_task_ids(list(due_date_map_raw.keys()))

    if not task_ids:
        return jsonify({'success': False, 'error': 'Debes seleccionar al menos una tarea.'}), 400
    if len(task_ids) > 500:
        return jsonify({'success': False, 'error': 'Puedes editar hasta 500 tareas por lote.'}), 400

    updates_status = None
    if status:
        if status not in estados_validos():
            return jsonify({'success': False, 'error': 'Estado inválido.'}), 400
        updates_status = status

    updates_priority = None
    if priority:
        if priority not in prioridades_validas():
            return jsonify({'success': False, 'error': 'Prioridad inválida.'}), 400
        updates_priority = priority

    due_date_map = {}
    if due_date_map_raw:
        for raw_id, raw_date in due_date_map_raw.items():
            try:
                task_id = int(raw_id)
            except (ValueError, TypeError):
                return jsonify({'success': False, 'error': 'ID de tarea inválido en movimiento.'}), 400
            parsed_due = _parse_iso_or_mmddyyyy_date(raw_date)
            if not parsed_due:
                return jsonify({'success': False, 'error': 'Fecha inválida en movimiento masivo.'}), 400
            due_date_map[task_id] = parsed_due

    if not updates_status and not updates_priority and not due_date_map:
        return jsonify({'success': False, 'error': 'No hay cambios para aplicar.'}), 400

    tasks = _apply_unit_scope(Task.active_query()).filter(Task.id.in_(task_ids)).all()
    if not tasks:
        return jsonify({'success': False, 'error': 'No se encontraron tareas para editar.'}), 404

    for task in tasks:
        if updates_status:
            task.status = updates_status
        if updates_priority:
            task.priority = updates_priority
        if due_date_map:
            next_due = due_date_map.get(task.id)
            if next_due:
                task.due_date = next_due

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity(
        'task_bulk_update_user',
        f'Actualización masiva (usuario) de {len(tasks)} tarea(s). ids={[task.id for task in tasks]}',
        entity_type='task_bulk',
    )

    return jsonify({'success': True, 'updated': len(tasks)})


@tasks_bp.route('/api/tasks/bulk-delete', methods=['POST'])
@task_access_required
def api_tasks_bulk_delete():
    """Delete selected task instances only (no series expansion)."""
    data = request.get_json(force=True) or {}
    task_ids = _parse_task_ids(data.get('task_ids'))
    if not task_ids:
        return jsonify({'success': False, 'error': 'Debes seleccionar al menos una tarea.'}), 400
    if len(task_ids) > 500:
        return jsonify({'success': False, 'error': 'Puedes eliminar hasta 500 tareas por lote.'}), 400

    tasks = _apply_unit_scope(Task.active_query()).filter(Task.id.in_(task_ids)).all()
    if not tasks:
        return jsonify({'success': False, 'error': 'No se encontraron tareas para eliminar.'}), 404

    for task in tasks:
        task.soft_delete(current_user.id)

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity(
        'task_bulk_delete_user',
        f'Eliminación masiva (usuario) de {len(tasks)} tarea(s). ids={[task.id for task in tasks]}',
        entity_type='task_bulk',
    )

    return jsonify({'success': True, 'deleted': len(tasks)})


# ─────────────────────────────────────────────────────────────
# API: Update task
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks/<int:task_id>', methods=['PUT'])
@task_access_required
def api_tasks_update(task_id):
    """Update a single task's fields."""
    task = Task.active_query().filter_by(id=task_id).first_or_404()

    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    data = request.get_json(force=True)
    expected_updated_at = (data.get('expected_updated_at') or '').strip()
    current_updated_at = task.updated_at.isoformat() if task.updated_at else ''
    if expected_updated_at and expected_updated_at != current_updated_at:
        return jsonify({
            'success': False,
            'error': 'La tarea fue modificada por otro usuario. Recarga e intenta de nuevo.',
            'task': task.to_dict(),
        }), 409

    if 'title' in data:
        task.title = (data['title'] or '').strip() or task.title
    if 'description' in data:
        task.description = (data['description'] or '').strip()
    if 'client' in data:
        task.client = (data['client'] or '').strip()
    if 'directorate' in data:
        task.directorate = (data['directorate'] or '').strip()
    if 'requested_by' in data:
        task.requested_by = (data['requested_by'] or '').strip()
    if 'budget_type' in data:
        task.budget_type = (data['budget_type'] or '').strip()
    if 'start_date' in data:
        start_date_raw = (str(data.get('start_date') or '')).strip()
        if not start_date_raw:
            task.start_date = None
        else:
            parsed_start_date = _parse_iso_or_mmddyyyy_date(start_date_raw)
            if not parsed_start_date:
                return jsonify({'success': False, 'error': 'Fecha de inicio inválida.'}), 400
            task.start_date = parsed_start_date
    if 'end_date' in data:
        end_date_raw = (str(data.get('end_date') or '')).strip()
        if not end_date_raw:
            task.end_date = None
        else:
            parsed_end_date = _parse_iso_or_mmddyyyy_date(end_date_raw)
            if not parsed_end_date:
                return jsonify({'success': False, 'error': 'Fecha de finalización inválida.'}), 400
            task.end_date = parsed_end_date
    status_changed = False
    if 'status' in data and data['status'] in estados_validos():
        status_changed = task.status != data['status']
        task.status = data['status']
    if 'priority' in data:
        if data['priority'] not in prioridades_validas():
            return jsonify({'success': False, 'error': 'Prioridad inválida.'}), 400
        task.priority = data['priority']
    if 'due_date' in data:
        due_date_raw = (str(data.get('due_date') or '')).strip()
        parsed_due_date = _parse_iso_or_mmddyyyy_date(due_date_raw)
        if not parsed_due_date:
            return jsonify({'success': False, 'error': 'Fecha de entrega inválida.'}), 400
        task.due_date = parsed_due_date
    if 'assignee_id' in data:
        previous_assignee_id = task.assignee_id
        try:
            assignee = User.query.get(int(data['assignee_id']))
        except (ValueError, TypeError):
            assignee = None

        if not assignee:
            return jsonify({'success': False, 'error': 'El usuario asignado no existe.'}), 400
        if not _assignee_in_current_unit(assignee):
            return jsonify({'success': False, 'error': 'Solo puedes asignar tareas a usuarios de tu unidad.'}), 400

        task.assignee_id = assignee.id
        task.area, task.area_id = _task_area_for_user(assignee)

        if assignee.id != previous_assignee_id:
            notify_user(
                assignee.id,
                'task_reassigned',
                f'Tarea reasignada: {task.title}',
                link_url=f'/tasks?task={task.id}',
                entity_type='task',
                entity_id=task.id,
                actor_id=current_user.id,
            )

    if task.start_date and task.end_date and task.end_date < task.start_date:
        return jsonify({'success': False, 'error': 'La fecha de finalización no puede ser menor que la fecha de inicio.'}), 400

    if status_changed:
        watcher_ids = [watcher.user_id for watcher in task.watchers]
        notify_many(
            watcher_ids,
            kind='task_comment',
            title=f'Estado actualizado en: {task.title}',
            body=f'Nuevo estado: {task.status}',
            link_url=f'/tasks?task={task.id}',
            entity_type='task',
            entity_id=task.id,
            actor_id=current_user.id,
        )

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity('task_update', f'Tarea actualizada: {task.title} (id={task.id})', entity_type='task', entity_id=task.id)

    return jsonify({'success': True, 'task': task.to_dict()})


@tasks_bp.route('/api/tasks/<int:task_id>')
@task_access_required
def api_tasks_get(task_id):
    """Return one task inside current unit scope."""
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_view_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403
    payload = task.to_dict(include_counts=True)
    payload['can_edit'] = _can_edit_task(task)
    payload['is_watcher'] = _is_task_watcher(task)
    payload['current_user_id'] = current_user.id
    payload['watchers'] = [
        {
            'user_id': watcher.user_id,
            'username': watcher.user.username if watcher.user else '',
            'unit': watcher.user.area.name if watcher.user and watcher.user.area and watcher.user.area.name else (watcher.user.role if watcher.user else ''),
            'is_self': watcher.user_id == current_user.id,
        }
        for watcher in task.watchers.order_by(TaskWatcher.created_at.asc()).all()
    ]
    return jsonify({'success': True, 'task': payload})


@tasks_bp.route('/api/tasks/<int:task_id>/comments')
@task_access_required
def api_task_comments_list(task_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_view_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    comments = TaskComment.query.filter_by(task_id=task.id, deleted_at=None).order_by(TaskComment.created_at.asc()).all()
    return jsonify({'success': True, 'comments': [comment.to_dict() for comment in comments]})


@tasks_bp.route('/api/tasks/<int:task_id>/comments', methods=['POST'])
@task_access_required
def api_task_comments_create(task_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    data = request.get_json(force=True) or {}
    body = (data.get('body') or '').strip()
    if not body:
        return jsonify({'success': False, 'error': 'Comentario vacío.'}), 400
    if len(body) > 2000:
        return jsonify({'success': False, 'error': 'Comentario demasiado largo.'}), 400

    comment = TaskComment(task_id=task.id, user_id=current_user.id, body=body)
    db.session.add(comment)
    db.session.flush()

    mentioned_users = _mentioned_unit_users(body)
    for user in mentioned_users:
        notify_user(
            user.id,
            'mention',
            f'{current_user.username} te mencionó en: {task.title}',
            body=body[:300],
            link_url=f'/tasks?task={task.id}',
            entity_type='task',
            entity_id=task.id,
            actor_id=current_user.id,
        )

    recipients = {task.assignee_id, task.creator_id}
    recipients.discard(current_user.id)
    for user_id in recipients:
        notify_user(
            user_id,
            'task_comment',
            f'Nuevo comentario en: {task.title}',
            body=body[:300],
            link_url=f'/tasks?task={task.id}',
            entity_type='task',
            entity_id=task.id,
            actor_id=current_user.id,
        )

    notify_many(
        [watcher.user_id for watcher in task.watchers],
        kind='task_comment',
        title=f'Nuevo comentario en: {task.title}',
        body=body[:300],
        link_url=f'/tasks?task={task.id}',
        entity_type='task',
        entity_id=task.id,
        actor_id=current_user.id,
    )

    from blueprints.admin import log_activity
    log_activity('task_comment', f'Comentario agregado en tarea {task.id}', entity_type='task', entity_id=task.id)
    db.session.commit()
    return jsonify({'success': True, 'comment': comment.to_dict()})


@tasks_bp.route('/api/tasks/comments/<int:comment_id>', methods=['DELETE'])
@task_access_required
def api_task_comments_delete(comment_id):
    comment = TaskComment.query.filter_by(id=comment_id).first_or_404()
    task = Task.active_query().filter_by(id=comment.task_id).first_or_404()
    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403
    if not current_user.is_admin and comment.user_id != current_user.id:
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    comment.deleted_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True})


@tasks_bp.route('/api/tasks/<int:task_id>/history')
@task_access_required
def api_task_history(task_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_view_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    rows = ActivityLog.query.filter_by(entity_type='task', entity_id=task.id).order_by(ActivityLog.timestamp.desc()).limit(50).all()
    return jsonify({'success': True, 'items': [
        {
            'action': row.action,
            'detail': row.detail or '',
            'user_name': row.user.username if row.user else '',
            'timestamp': row.timestamp.strftime('%Y-%m-%d %H:%M') if row.timestamp else '',
        }
        for row in rows
    ]})


# ─────────────────────────────────────────────────────────────
# API: Delete task
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks/<int:task_id>', methods=['DELETE'])
@task_access_required
def api_tasks_delete(task_id):
    """Delete a task (and optionally all its recurrence children)."""
    task = Task.active_query().filter_by(id=task_id).first_or_404()

    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    delete_series = request.args.get('series', 'false') == 'true'
    title = task.title
    count = 1

    if delete_series and task.parent_task_id is None:
        # Delete all children too
        children = Task.active_query().filter_by(parent_task_id=task.id).all()
        count += len(children)
        for child in children:
            child.soft_delete(current_user.id)

    task.soft_delete(current_user.id)
    db.session.commit()

    from blueprints.admin import log_activity
    log_activity('task_delete', f'Tarea eliminada: {title} ({count} instancia(s))', entity_type='task', entity_id=task.id)

    return jsonify({'success': True, 'deleted': count})


@tasks_bp.route('/api/tasks/day/<day_str>', methods=['DELETE'])
@task_access_required
def api_tasks_delete_day(day_str):
    """Delete all tasks for a specific day within the user's scope."""
    try:
        target_day = date.fromisoformat(day_str)
    except ValueError:
        return jsonify({'success': False, 'error': 'Fecha inválida.'}), 400

    query = _apply_unit_scope(Task.active_query()).filter(Task.due_date == target_day)

    tasks = query.all()
    deleted_count = len(tasks)

    for task in tasks:
        task.soft_delete(current_user.id)

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity(
        'task_delete_day',
        f'Tareas eliminadas del día {target_day.isoformat()}: {deleted_count}. ids={[task.id for task in tasks]}',
        entity_type='task_bulk',
    )

    return jsonify({'success': True, 'deleted': deleted_count, 'date': target_day.isoformat()})


# ─────────────────────────────────────────────────────────────
# API: Client autocomplete
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks/clients')
@task_access_required
def api_tasks_clients():
    """Return distinct client names for autocomplete."""
    rows = _apply_unit_scope(Task.active_query()).with_entities(Task.client).filter(
        Task.client.isnot(None),
        Task.client != ''
    ).distinct().order_by(Task.client).all()
    return jsonify([r[0] for r in rows])


# ─────────────────────────────────────────────────────────────
# API: Users for assignee dropdown
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks/users')
@task_access_required
def api_tasks_users():
    """Return users in the same unit for assignee picker."""
    users = _unit_user_query(active_only=True).order_by(User.username).all()
    return jsonify([
        {
            'id': u.id,
            'username': u.username,
            'role': u.role,
            'unit': u.area.name if u.area and u.area.name else '',
            'label': f"{u.username} ({u.area.name if u.area and u.area.name else (u.role or 'Sin unidad')})"
        }
        for u in users
    ])


def _apply_admin_task_filters(query, args):
    """Apply shared admin dashboard filters to a Task query."""
    status = args.get('status', '').strip()
    client = args.get('client', '').strip()
    assignee_id = args.get('assignee_id', '').strip()
    creator_id = args.get('creator_id', '').strip()
    area = args.get('area', '').strip()

    if status and status in estados_validos():
        query = query.filter_by(status=status)
    if client:
        query = query.filter(Task.client.ilike(f'%{client}%'))
    if assignee_id:
        try:
            query = query.filter_by(assignee_id=int(assignee_id))
        except ValueError:
            pass
    if creator_id:
        try:
            query = query.filter_by(creator_id=int(creator_id))
        except ValueError:
            pass
    if area:
        query = query.filter_by(area=area)

    # Filtros que alimentan los indicadores de cabecera (RED-7): un numero que
    # no lleva a la tabla ya filtrada obliga a reconstruir el filtro a mano.
    if args.get('overdue', '').strip() == '1':
        query = query.filter(Task.due_date < today_local(), Task.status != 'Completado')

    if args.get('completed_this_week', '').strip() == '1':
        query = query.filter(
            Task.status == 'Completado',
            Task.updated_at >= datetime.combine(_semana_actual_inicio(), datetime.min.time()),
        )

    return query


# ─────────────────────────────────────────────────────────────
# Admin: Tasks Dashboard
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/admin/tasks-dashboard')
@login_required
def tasks_dashboard():
    """Admin-only tasks dashboard with filtering."""
    if not current_user.is_admin:
        from flask import abort
        abort(403)
    return render_template('tasks_dashboard.html', scope='admin')


@tasks_bp.route('/tasks/team-dashboard')
@area_lead_required
def team_dashboard():
    """Area lead dashboard scoped to own unit."""
    return render_template('tasks_dashboard.html', scope='area')


@tasks_bp.route('/api/admin/tasks')
@login_required
def api_admin_tasks():
    """Admin endpoint: all tasks with optional filters."""
    if not current_user.is_admin:
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403

    query = _apply_admin_task_filters(Task.active_query(), request.args)

    tasks = _with_task_relations(query).order_by(Task.due_date.desc()).limit(TASK_FEED_MAX_ROWS).all()

    # Summary stats
    stats = _task_status_stats(Task.active_query())
    stats.update(_task_headline_stats(Task.active_query()))

    return jsonify({
        'success': True,
        'tasks': [t.to_dict() for t in tasks],
        'stats': stats,
    })


@tasks_bp.route('/api/admin/tasks/export-csv')
@login_required
def api_admin_tasks_export_csv():
    """Export filtered admin tasks to CSV using the required schema."""
    if not current_user.is_admin:
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403

    tasks = _apply_admin_task_filters(Task.active_query(), request.args).order_by(Task.due_date.desc()).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(TASK_CSV_COLUMNS)

    for task in tasks:
        writer.writerow([
            _format_mmddyyyy(task.start_date),
            _format_mmddyyyy(task.end_date),
            _format_mmddyyyy(task.due_date),
            task.directorate or '',
            task.client or '',
            task.title or '',
            task.requested_by or '',
            task.assignee.username if task.assignee else '',
            task.description or '',
            task.budget_type or '',
            task.priority or 'Media',
            task.recurrence_type if task.is_recurrent and task.recurrence_type else 'No',
        ])

    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    csv_content = buffer.getvalue()
    buffer.close()

    return Response(
        csv_content,
        mimetype='text/csv; charset=utf-8',
        headers={
            'Content-Disposition': f'attachment; filename=tareas_admin_{timestamp}.csv'
        },
    )


# ─────────────────────────────────────────────────────────────
# Team: Area-lead dashboard endpoints (scoped to own area)
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/team/tasks')
@login_required
def api_team_tasks():
    """Team lead endpoint: tasks scoped to own area."""
    if not puede_ver_equipo(current_user):
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403
    unidades = _unidades_del_panel()
    if unidades is None:
        return jsonify({'success': False, 'error': 'No lideras ninguna unidad.'}), 400

    query = Task.active_query().filter(Task.area_id.in_(unidades))
    query = _apply_admin_task_filters(query, request.args)

    tasks = _with_task_relations(query).order_by(Task.due_date.desc()).limit(TASK_FEED_MAX_ROWS).all()

    stats_query = Task.active_query().filter(Task.area_id.in_(unidades))
    stats = _task_status_stats(stats_query)
    stats.update(_task_headline_stats(stats_query))

    return jsonify({
        'success': True,
        'tasks': [t.to_dict() for t in tasks],
        'stats': stats,
    })


@tasks_bp.route('/api/team/tasks/filters')
@login_required
def api_team_tasks_filters():
    """Filter options scoped to current area."""
    if not puede_ver_equipo(current_user):
        return jsonify({'success': False}), 403
    unidades = _unidades_del_panel()
    if unidades is None:
        return jsonify({'success': False, 'error': 'No lideras ninguna unidad.'}), 400

    base_query = Task.active_query().filter(Task.area_id.in_(unidades))

    clients = [r[0] for r in base_query.with_entities(Task.client).filter(
        Task.client.isnot(None), Task.client != ''
    ).distinct().order_by(Task.client).all()]

    users = User.query.filter(User.is_active.is_(True), User.area_id.in_(unidades)).order_by(User.username).all()

    return jsonify({
        'clients': clients,
        'users': [
            {
                'id': u.id,
                'username': u.username,
                'role': u.role,
                'unit': u.area.name if u.area and u.area.name else '',
                'label': f"{u.username} ({u.area.name if u.area and u.area.name else (u.role or 'Sin unidad')})"
            }
            for u in users
        ],
        'statuses': list(estados_validos()),
        'priorities': list(prioridades_validas()),
    })


@tasks_bp.route('/api/team/tasks/export-csv')
@login_required
def api_team_tasks_export_csv():
    """Export filtered team tasks to CSV."""
    if not puede_ver_equipo(current_user):
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403
    unidades = _unidades_del_panel()
    if unidades is None:
        return jsonify({'success': False, 'error': 'No lideras ninguna unidad.'}), 400

    tasks = _apply_admin_task_filters(
        Task.active_query().filter(Task.area_id.in_(unidades)), request.args
    ).order_by(Task.due_date.desc()).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(TASK_CSV_COLUMNS)

    for task in tasks:
        writer.writerow([
            _format_mmddyyyy(task.start_date),
            _format_mmddyyyy(task.end_date),
            _format_mmddyyyy(task.due_date),
            task.directorate or '',
            task.client or '',
            task.title or '',
            task.requested_by or '',
            task.assignee.username if task.assignee else '',
            task.description or '',
            task.budget_type or '',
            task.priority or 'Media',
            task.recurrence_type if task.is_recurrent and task.recurrence_type else 'No',
        ])

    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    csv_content = buffer.getvalue()
    buffer.close()

    return Response(
        csv_content,
        mimetype='text/csv; charset=utf-8',
        headers={
            'Content-Disposition': f'attachment; filename=tareas_equipo_{timestamp}.csv'
        },
    )


@tasks_bp.route('/api/admin/tasks/import-csv/preview', methods=['POST'])
@login_required
def api_admin_tasks_import_csv_preview():
    """Validate and preview CSV rows before importing."""
    if not current_user.is_admin:
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403

    csv_file = request.files.get('csv_file')
    if not csv_file or not csv_file.filename:
        return jsonify({'success': False, 'error': 'Debes seleccionar un archivo CSV.'}), 400

    raw_bytes = csv_file.read()
    if not raw_bytes:
        return jsonify({'success': False, 'error': 'El archivo CSV está vacío.'}), 400

    decoded_text = _decode_csv_bytes(raw_bytes)
    if decoded_text is None:
        return jsonify({'success': False, 'error': 'No se pudo leer el CSV. Usa UTF-8, UTF-16 o CP1252.'}), 400

    rows, parse_error = _extract_task_csv_rows(decoded_text)
    if parse_error:
        return jsonify({'success': False, **parse_error}), 400

    users = User.query.filter_by(is_active=True).all()
    preview = _build_csv_preview_rows(rows, users)

    return jsonify({'success': True, **preview})


@tasks_bp.route('/api/admin/tasks/import-csv/commit', methods=['POST'])
@login_required
def api_admin_tasks_import_csv_commit():
    """Import validated CSV rows. Valid rows are saved, invalid rows are returned for correction."""
    if not current_user.is_admin:
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403

    data = request.get_json(force=True) or {}
    payload_rows = data.get('rows')
    if not isinstance(payload_rows, list):
        return jsonify({'success': False, 'error': 'Formato inválido: se esperaba una lista de filas.'}), 400
    if len(payload_rows) > 5000:
        return jsonify({'success': False, 'error': 'Puedes importar hasta 5000 filas por lote.'}), 400

    normalized_rows = []
    for idx, payload_row in enumerate(payload_rows):
        if not isinstance(payload_row, dict):
            continue

        row_number_raw = payload_row.get('row_number')
        try:
            row_number = int(row_number_raw)
        except (TypeError, ValueError):
            row_number = idx + 2

        input_fields = payload_row.get('fields')
        if not isinstance(input_fields, dict):
            input_fields = {}

        fields = {
            key: str(input_fields.get(key, '') or '')
            for key, _label in TASK_CSV_FIELD_DEFS
        }

        normalized_rows.append({
            'row_number': row_number,
            'fields': fields,
        })

    users = User.query.filter_by(is_active=True).all()
    total_rows = len(normalized_rows)
    imported_rows = 0
    failed_rows = 0
    created_tasks = 0
    errors = []
    remaining_rows = []

    for row in normalized_rows:
        row_number = row['row_number']
        validation = _validate_task_csv_row(row['fields'], users)
        row_errors = [issue for issue in validation['issues'] if issue['severity'] == 'error']

        if row_errors:
            failed_rows += 1
            remaining_rows.append({
                'row_number': row_number,
                'fields': validation['fields'],
                'status': validation['status'],
                'issues': validation['issues'],
                'parsed': validation['preview'],
            })
            for issue in row_errors:
                errors.append({
                    'row': row_number,
                    'column': issue.get('column', 'General'),
                    'value': issue.get('value', ''),
                    'code': issue.get('code', 'error'),
                    'message': issue.get('message', 'Error de validación.'),
                })
            continue

        try:
            created_in_row = _create_tasks_from_validated_csv(validation)
            db.session.commit()
            imported_rows += 1
            created_tasks += created_in_row
        except Exception:
            db.session.rollback()
            failed_rows += 1
            db_issue = {
                'severity': 'error',
                'column': 'General',
                'code': 'db_error',
                'message': 'No se pudo guardar la fila por un error de base de datos.',
                'value': '',
            }
            remaining_rows.append({
                'row_number': row_number,
                'fields': validation['fields'],
                'status': 'error',
                'issues': validation['issues'] + [db_issue],
                'parsed': validation['preview'],
            })
            errors.append({
                'row': row_number,
                'column': 'General',
                'value': '',
                'code': 'db_error',
                'message': 'No se pudo guardar la fila por un error de base de datos.',
            })

    from blueprints.admin import log_activity
    log_activity(
        'task_csv_import',
        f'Importación CSV tareas: filas={total_rows}, importadas={imported_rows}, fallidas={failed_rows}, tareas_creadas={created_tasks}',
        entity_type='task_bulk',
    )

    return jsonify({
        'success': True,
        'total_rows': total_rows,
        'imported_rows': imported_rows,
        'failed_rows': failed_rows,
        'created_tasks': created_tasks,
        'errors': errors,
        'remaining_rows': remaining_rows,
    })


# ─────────────────────────────────────────────────────────────
# Team: CSV import (area leads, scoped users)
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/team/tasks/import-csv/preview', methods=['POST'])
@login_required
def api_team_tasks_import_csv_preview():
    """Validate CSV preview scoped to team users."""
    if not puede_ver_equipo(current_user):
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403
    if _unidades_del_panel() is None:
        return jsonify({'success': False, 'error': 'No lideras ninguna unidad.'}), 400

    csv_file = request.files.get('csv_file')
    if not csv_file or not csv_file.filename:
        return jsonify({'success': False, 'error': 'Debes seleccionar un archivo CSV.'}), 400

    raw_bytes = csv_file.read()
    if not raw_bytes:
        return jsonify({'success': False, 'error': 'El archivo CSV está vacío.'}), 400

    decoded_text = _decode_csv_bytes(raw_bytes)
    if decoded_text is None:
        return jsonify({'success': False, 'error': 'No se pudo leer el CSV. Usa UTF-8, UTF-16 o CP1252.'}), 400

    rows, parse_error = _extract_task_csv_rows(decoded_text)
    if parse_error:
        return jsonify({'success': False, **parse_error}), 400

    users = _unit_user_query(active_only=True).all()
    preview = _build_csv_preview_rows(rows, users)

    return jsonify({'success': True, **preview})


@tasks_bp.route('/api/team/tasks/import-csv/commit', methods=['POST'])
@login_required
def api_team_tasks_import_csv_commit():
    """Import CSV rows scoped to team users."""
    if not puede_ver_equipo(current_user):
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403
    if _unidades_del_panel() is None:
        return jsonify({'success': False, 'error': 'No lideras ninguna unidad.'}), 400

    data = request.get_json(force=True) or {}
    payload_rows = data.get('rows')
    if not isinstance(payload_rows, list):
        return jsonify({'success': False, 'error': 'Formato inválido: se esperaba una lista de filas.'}), 400
    if len(payload_rows) > 5000:
        return jsonify({'success': False, 'error': 'Puedes importar hasta 5000 filas por lote.'}), 400

    normalized_rows = []
    for idx, payload_row in enumerate(payload_rows):
        if not isinstance(payload_row, dict):
            continue
        row_number_raw = payload_row.get('row_number')
        try:
            row_number = int(row_number_raw)
        except (TypeError, ValueError):
            row_number = idx + 2
        input_fields = payload_row.get('fields')
        if not isinstance(input_fields, dict):
            input_fields = {}
        fields = {
            key: str(input_fields.get(key, '') or '')
            for key, _label in TASK_CSV_FIELD_DEFS
        }
        normalized_rows.append({
            'row_number': row_number,
            'fields': fields,
        })

    users = _unit_user_query(active_only=True).all()
    total_rows = len(normalized_rows)
    imported_rows = 0
    failed_rows = 0
    created_tasks = 0
    errors = []
    remaining_rows = []

    for row in normalized_rows:
        row_number = row['row_number']
        validation = _validate_task_csv_row(row['fields'], users)
        row_errors = [issue for issue in validation['issues'] if issue['severity'] == 'error']

        if row_errors:
            failed_rows += 1
            remaining_rows.append({
                'row_number': row_number,
                'fields': validation['fields'],
                'status': validation['status'],
                'issues': validation['issues'],
                'parsed': validation['preview'],
            })
            for issue in row_errors:
                errors.append({
                    'row': row_number,
                    'column': issue.get('column', 'General'),
                    'value': issue.get('value', ''),
                    'code': issue.get('code', 'error'),
                    'message': issue.get('message', 'Error de validación.'),
                })
            continue

        try:
            created_in_row = _create_tasks_from_validated_csv(validation)
            db.session.commit()
            imported_rows += 1
            created_tasks += created_in_row
        except Exception:
            db.session.rollback()
            failed_rows += 1
            db_issue = {
                'severity': 'error',
                'column': 'General',
                'code': 'db_error',
                'message': 'No se pudo guardar la fila por un error de base de datos.',
                'value': '',
            }
            remaining_rows.append({
                'row_number': row_number,
                'fields': validation['fields'],
                'status': 'error',
                'issues': validation['issues'] + [db_issue],
                'parsed': validation['preview'],
            })
            errors.append({
                'row': row_number,
                'column': 'General',
                'value': '',
                'code': 'db_error',
                'message': 'No se pudo guardar la fila por un error de base de datos.',
            })

    from blueprints.admin import log_activity
    log_activity(
        'task_csv_import',
        f'Importación CSV equipo: filas={total_rows}, importadas={imported_rows}, fallidas={failed_rows}, tareas_creadas={created_tasks}',
        entity_type='task_bulk',
    )

    return jsonify({
        'success': True,
        'total_rows': total_rows,
        'imported_rows': imported_rows,
        'failed_rows': failed_rows,
        'created_tasks': created_tasks,
        'errors': errors,
        'remaining_rows': remaining_rows,
    })


@tasks_bp.route('/api/admin/tasks/bulk-update', methods=['POST'])
@login_required
def api_admin_tasks_bulk_update():
    """Admin endpoint: update multiple tasks in one request."""
    if not current_user.is_admin:
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403

    data = request.get_json(force=True) or {}
    task_ids = _parse_task_ids(data.get('task_ids'))
    if not task_ids:
        return jsonify({'success': False, 'error': 'Debes seleccionar al menos una tarea.'}), 400
    if len(task_ids) > 500:
        return jsonify({'success': False, 'error': 'Puedes editar hasta 500 tareas por lote.'}), 400

    status = (data.get('status') or '').strip()
    priority = (data.get('priority') or '').strip()
    assignee_id = data.get('assignee_id')
    due_date_raw = (data.get('due_date') or '').strip()

    updates = {}

    if status:
        if status not in estados_validos():
            return jsonify({'success': False, 'error': 'Estado inválido.'}), 400
        updates['status'] = status
    if priority:
        if priority not in prioridades_validas():
            return jsonify({'success': False, 'error': 'Prioridad inválida.'}), 400
        updates['priority'] = priority

    assignee = None
    if assignee_id not in (None, '', 0, '0'):
        try:
            assignee = User.query.get(int(assignee_id))
        except (ValueError, TypeError):
            assignee = None
        if not assignee:
            return jsonify({'success': False, 'error': 'El usuario asignado no existe.'}), 400

    new_due_date = None
    if due_date_raw:
        try:
            new_due_date = date.fromisoformat(due_date_raw)
        except ValueError:
            return jsonify({'success': False, 'error': 'Fecha de entrega inválida.'}), 400

    if not updates and not assignee and not new_due_date:
        return jsonify({'success': False, 'error': 'No hay cambios para aplicar.'}), 400

    tasks = Task.active_query().filter(Task.id.in_(task_ids)).all()
    if not tasks:
        return jsonify({'success': False, 'error': 'No se encontraron tareas para editar.'}), 404

    reassigned_count = 0 if not assignee else sum(1 for task in tasks if task.assignee_id != assignee.id)

    for task in tasks:
        if 'status' in updates:
            task.status = updates['status']
        if 'priority' in updates:
            task.priority = updates['priority']
        if assignee:
            task.assignee_id = assignee.id
            task.area, task.area_id = _task_area_for_user(assignee)
        if new_due_date:
            task.due_date = new_due_date

    if assignee and reassigned_count:
        if reassigned_count:
            notify_user(
                assignee.id,
                'task_reassigned',
                f'Se te asignaron {reassigned_count} tareas',
                body='Revisa tus tareas actualizadas en el calendario.',
                link_url='/tasks',
                entity_type='task_bulk',
                actor_id=current_user.id,
            )

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity(
        'task_bulk_update',
        f'Actualización masiva de {len(tasks)} tarea(s). ids={[task.id for task in tasks]}',
        entity_type='task_bulk',
    )

    return jsonify({'success': True, 'updated': len(tasks)})


@tasks_bp.route('/api/admin/tasks/bulk-delete', methods=['POST'])
@login_required
def api_admin_tasks_bulk_delete():
    """Admin endpoint: delete multiple tasks in one request."""
    if not current_user.is_admin:
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403

    data = request.get_json(force=True) or {}
    task_ids = _parse_task_ids(data.get('task_ids'))
    if not task_ids:
        return jsonify({'success': False, 'error': 'Debes seleccionar al menos una tarea.'}), 400
    if len(task_ids) > 500:
        return jsonify({'success': False, 'error': 'Puedes eliminar hasta 500 tareas por lote.'}), 400

    selected_tasks = Task.active_query().filter(Task.id.in_(task_ids)).all()
    if not selected_tasks:
        return jsonify({'success': False, 'error': 'No se encontraron tareas para eliminar.'}), 404

    ids_to_delete = {t.id for t in selected_tasks}
    child_tasks = Task.active_query().filter(Task.parent_task_id.in_(list(ids_to_delete))).all()
    ids_to_delete.update(t.id for t in child_tasks)

    tasks_to_delete = Task.active_query().filter(Task.id.in_(list(ids_to_delete))).all()
    for task in tasks_to_delete:
        task.soft_delete(current_user.id)

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity(
        'task_bulk_delete',
        f'Eliminación masiva de {len(tasks_to_delete)} tarea(s). ids={[task.id for task in tasks_to_delete]}',
        entity_type='task_bulk',
    )

    return jsonify({'success': True, 'deleted': len(tasks_to_delete)})


@tasks_bp.route('/api/admin/tasks/filters')
@login_required
def api_admin_tasks_filters():
    """Return filter option values for the dashboard dropdowns."""
    if not current_user.is_admin:
        return jsonify({'success': False}), 403

    clients = [r[0] for r in db.session.query(Task.client).filter(
        Task.client.isnot(None), Task.client != ''
    ).distinct().order_by(Task.client).all()]

    users = User.query.filter_by(is_active=True).order_by(User.username).all()
    areas = [r[0] for r in db.session.query(Task.area).filter(
        Task.area.isnot(None), Task.area != ''
    ).distinct().order_by(Task.area).all()]

    return jsonify({
        'clients': clients,
        'users': [
            {
                'id': u.id,
                'username': u.username,
                'role': u.role,
                'unit': u.area.name if u.area and u.area.name else '',
                'label': f"{u.username} ({u.area.name if u.area and u.area.name else (u.role or 'Sin unidad')})"
            }
            for u in users
        ],
        'areas': areas,
        'statuses': list(estados_validos()),
        'priorities': list(prioridades_validas()),
    })
