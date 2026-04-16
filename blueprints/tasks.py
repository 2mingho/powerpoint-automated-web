import functools
import csv
import io
import re
import unicodedata
from datetime import datetime, timedelta, date
from flask import Blueprint, render_template, request, jsonify, Response
from flask_login import login_required, current_user
from extensions import db
from models import User, Task, Area

tasks_bp = Blueprint('tasks', __name__)


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
    ('recurrence', 'Recurrencia'),
]

TASK_CSV_KEY_TO_LABEL = {key: label for key, label in TASK_CSV_FIELD_DEFS}


def task_access_required(f):
    """Decorator: requires authenticated user access to tasks module."""
    @functools.wraps(f)
    @login_required
    def decorated(*args, **kwargs):
        return f(*args, **kwargs)
    return decorated


def _unit_user_query(active_only=False):
    """Return a base query of users belonging to current user's unit scope."""
    query = User.query
    if active_only:
        query = query.filter_by(is_active=True)

    if current_user.is_admin:
        return query

    if current_user.area_id:
        return query.filter_by(area_id=current_user.area_id)

    # Legacy fallback where unit is still represented by role
    return query.filter_by(role=current_user.role)


def _unit_user_ids():
    """Return user IDs in current user's unit (legacy-safe fallback)."""
    return [u.id for u in _unit_user_query(active_only=False).all()]


def _task_in_current_unit(task):
    """Check if task belongs to current user's unit scope."""
    if current_user.is_admin:
        return True

    user_ids = set(_unit_user_ids())
    if not user_ids:
        user_ids = {current_user.id}

    return task.assignee_id in user_ids


def _apply_unit_scope(query):
    """Apply unit isolation to task queries."""
    if current_user.is_admin:
        return query

    user_ids = _unit_user_ids()
    if not user_ids:
        user_ids = [current_user.id]

    return query.filter(Task.assignee_id.in_(user_ids))


def _assignee_in_current_unit(assignee):
    """Validate assignee belongs to current user's unit scope."""
    if current_user.is_admin:
        return True

    if current_user.area_id:
        return assignee.area_id == current_user.area_id

    # Legacy fallback where users have no area_id and unit is role-based
    return assignee.role == current_user.role


def _task_area_key_for_user(user):
    """Return canonical task.area value for a given user."""
    if user.area and user.area.name:
        return user.area.name
    return user.role


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
            year = date.today().year
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
            f'Se infirió el año actual ({date.today().year}) para esta fecha.',
        )

    end_date, end_date_warning = _parse_csv_flexible_date(clean_fields['end_date'])
    if clean_fields['end_date'] and not end_date:
        add_issue('error', 'end_date', 'invalid_date', 'Fecha inválida. Usa MM/DD/YYYY o D-MMM.')
    elif end_date_warning == 'year_inferred_current':
        add_issue(
            'warning',
            'end_date',
            'year_inferred_current',
            f'Se infirió el año actual ({date.today().year}) para esta fecha.',
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
            f'Se infirió el año actual ({date.today().year}) para esta fecha.',
        )

    recurrence_type = _normalize_recurrence_value(clean_fields['recurrence'])
    if recurrence_type is None:
        add_issue('error', 'recurrence', 'invalid_recurrence', 'Valor inválido. Usa: No, Diaria, Semanal o Mensual.')
        recurrence_type = ''

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

    area = _task_area_key_for_user(assignee)
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
        status='Pendiente',
        is_recurrent=False,
        recurrence_type=None,
        area=area,
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

    return render_template('tasks.html', area_users=area_users, area_options=area_options)


# ─────────────────────────────────────────────────────────────
# API: List tasks (JSON feed for FullCalendar)
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks')
@task_access_required
def api_tasks_list():
    """Return tasks as JSON, isolated by unit."""
    start = request.args.get('start', '')
    end = request.args.get('end', '')
    status = request.args.get('status', '').strip()
    assignee_id = request.args.get('assignee_id', '').strip()
    client = request.args.get('client', '').strip()
    area = request.args.get('area', '').strip()

    query = _apply_unit_scope(Task.query)

    if status and status in Task.VALID_STATUSES:
        query = query.filter_by(status=status)

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

    tasks = query.order_by(Task.due_date.asc()).all()
    return jsonify([t.to_dict() for t in tasks])


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
    if not recurrence_end_str and end_date_raw:
        recurrence_end_str = str(end_date_raw)

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

    area = _task_area_key_for_user(assignee)

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
            due_date=dates[0], status='Pendiente',
            is_recurrent=True, recurrence_type=recurrence_type,
            area=area, creator_id=current_user.id, assignee_id=assignee.id,
        )
        db.session.add(parent)
        db.session.flush()  # get parent.id

        created_tasks.append(parent)

        for d in dates[1:]:
            child = Task(
                title=title, description=description, client=client,
                start_date=start_date_value, end_date=end_date_value,
                directorate=directorate, requested_by=requested_by, budget_type=budget_type,
                due_date=d, status='Pendiente',
                is_recurrent=True, recurrence_type=recurrence_type,
                parent_task_id=parent.id,
                area=area, creator_id=current_user.id, assignee_id=assignee.id,
            )
            db.session.add(child)
            created_tasks.append(child)
    else:
        task = Task(
            title=title, description=description, client=client,
            start_date=start_date_value, end_date=end_date_value,
            directorate=directorate, requested_by=requested_by, budget_type=budget_type,
            due_date=due, status='Pendiente',
            is_recurrent=False,
            area=area, creator_id=current_user.id, assignee_id=assignee.id,
        )
        db.session.add(task)
        created_tasks.append(task)

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity('task_create', f'Tarea creada: {title} ({len(created_tasks)} instancia(s))')

    return jsonify({
        'success': True,
        'tasks': [t.to_dict() for t in created_tasks],
        'count': len(created_tasks),
    })


# ─────────────────────────────────────────────────────────────
# API: Update task
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks/<int:task_id>', methods=['PUT'])
@task_access_required
def api_tasks_update(task_id):
    """Update a single task's fields."""
    task = Task.query.get_or_404(task_id)

    if not _task_in_current_unit(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    data = request.get_json(force=True)

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
    if 'status' in data and data['status'] in Task.VALID_STATUSES:
        task.status = data['status']
    if 'due_date' in data:
        due_date_raw = (str(data.get('due_date') or '')).strip()
        parsed_due_date = _parse_iso_or_mmddyyyy_date(due_date_raw)
        if not parsed_due_date:
            return jsonify({'success': False, 'error': 'Fecha de entrega inválida.'}), 400
        task.due_date = parsed_due_date
    if 'assignee_id' in data:
        try:
            assignee = User.query.get(int(data['assignee_id']))
        except (ValueError, TypeError):
            assignee = None

        if not assignee:
            return jsonify({'success': False, 'error': 'El usuario asignado no existe.'}), 400
        if not _assignee_in_current_unit(assignee):
            return jsonify({'success': False, 'error': 'Solo puedes asignar tareas a usuarios de tu unidad.'}), 400

        task.assignee_id = assignee.id
        task.area = _task_area_key_for_user(assignee)

    if task.start_date and task.end_date and task.end_date < task.start_date:
        return jsonify({'success': False, 'error': 'La fecha de finalización no puede ser menor que la fecha de inicio.'}), 400

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity('task_update', f'Tarea actualizada: {task.title} (id={task.id})')

    return jsonify({'success': True, 'task': task.to_dict()})


# ─────────────────────────────────────────────────────────────
# API: Delete task
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks/<int:task_id>', methods=['DELETE'])
@task_access_required
def api_tasks_delete(task_id):
    """Delete a task (and optionally all its recurrence children)."""
    task = Task.query.get_or_404(task_id)

    if not _task_in_current_unit(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    delete_series = request.args.get('series', 'false') == 'true'
    title = task.title
    count = 1

    if delete_series and task.parent_task_id is None:
        # Delete all children too
        children = Task.query.filter_by(parent_task_id=task.id).all()
        count += len(children)
        for child in children:
            db.session.delete(child)

    db.session.delete(task)
    db.session.commit()

    from blueprints.admin import log_activity
    log_activity('task_delete', f'Tarea eliminada: {title} ({count} instancia(s))')

    return jsonify({'success': True, 'deleted': count})


@tasks_bp.route('/api/tasks/day/<day_str>', methods=['DELETE'])
@task_access_required
def api_tasks_delete_day(day_str):
    """Delete all tasks for a specific day within the user's scope."""
    try:
        target_day = date.fromisoformat(day_str)
    except ValueError:
        return jsonify({'success': False, 'error': 'Fecha inválida.'}), 400

    query = Task.query.filter(Task.due_date == target_day)
    if not current_user.is_admin:
        query = query.filter(Task.area == current_user.role)

    tasks = query.all()
    deleted_count = len(tasks)

    for task in tasks:
        db.session.delete(task)

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity('task_delete_day', f'Tareas eliminadas del día {target_day.isoformat()}: {deleted_count}')

    return jsonify({'success': True, 'deleted': deleted_count, 'date': target_day.isoformat()})


# ─────────────────────────────────────────────────────────────
# API: Client autocomplete
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks/clients')
@task_access_required
def api_tasks_clients():
    """Return distinct client names for autocomplete."""
    rows = _apply_unit_scope(Task.query).with_entities(Task.client).filter(
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

    if status and status in Task.VALID_STATUSES:
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
    return render_template('tasks_dashboard.html')


@tasks_bp.route('/api/admin/tasks')
@login_required
def api_admin_tasks():
    """Admin endpoint: all tasks with optional filters."""
    if not current_user.is_admin:
        return jsonify({'success': False, 'error': 'Acceso denegado.'}), 403

    query = _apply_admin_task_filters(Task.query, request.args)

    tasks = query.order_by(Task.due_date.desc()).all()

    # Summary stats
    all_tasks = Task.query.all()
    stats = {
        'total': len(all_tasks),
        'pendiente': sum(1 for t in all_tasks if t.status == 'Pendiente'),
        'en_progreso': sum(1 for t in all_tasks if t.status == 'En Progreso'),
        'completado': sum(1 for t in all_tasks if t.status == 'Completado'),
    }

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

    tasks = _apply_admin_task_filters(Task.query, request.args).order_by(Task.due_date.desc()).all()

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
    assignee_id = data.get('assignee_id')
    due_date_raw = (data.get('due_date') or '').strip()

    updates = {}

    if status:
        if status not in Task.VALID_STATUSES:
            return jsonify({'success': False, 'error': 'Estado inválido.'}), 400
        updates['status'] = status

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

    tasks = Task.query.filter(Task.id.in_(task_ids)).all()
    if not tasks:
        return jsonify({'success': False, 'error': 'No se encontraron tareas para editar.'}), 404

    for task in tasks:
        if 'status' in updates:
            task.status = updates['status']
        if assignee:
            task.assignee_id = assignee.id
            task.area = _task_area_key_for_user(assignee)
        if new_due_date:
            task.due_date = new_due_date

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity('task_bulk_update', f'Actualización masiva de {len(tasks)} tarea(s)')

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

    selected_tasks = Task.query.filter(Task.id.in_(task_ids)).all()
    if not selected_tasks:
        return jsonify({'success': False, 'error': 'No se encontraron tareas para eliminar.'}), 404

    ids_to_delete = {t.id for t in selected_tasks}
    child_tasks = Task.query.filter(Task.parent_task_id.in_(list(ids_to_delete))).all()
    ids_to_delete.update(t.id for t in child_tasks)

    tasks_to_delete = Task.query.filter(Task.id.in_(list(ids_to_delete))).all()
    for task in tasks_to_delete:
        db.session.delete(task)

    db.session.commit()

    from blueprints.admin import log_activity
    log_activity('task_bulk_delete', f'Eliminación masiva de {len(tasks_to_delete)} tarea(s)')

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
        'statuses': list(Task.VALID_STATUSES),
    })
