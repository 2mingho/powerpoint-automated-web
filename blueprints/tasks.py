import functools
from datetime import datetime, timedelta, date
from flask import Blueprint, render_template, request, jsonify
from flask_login import login_required, current_user
from extensions import db
from models import User, Task, Area

tasks_bp = Blueprint('tasks', __name__)


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
    """Generate a list of dates from start_date to end_date based on recurrence_type."""
    dates = []
    current = start_date
    delta_map = {
        'Diaria': timedelta(days=1),
        'Semanal': timedelta(weeks=1),
        'Mensual': None,  # handled separately
    }

    if recurrence_type == 'Mensual':
        while current <= end_date:
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
    assignee_id = data.get('assignee_id')
    due_date_str = data.get('due_date', '')
    is_recurrent = bool(data.get('is_recurrent'))
    recurrence_type = data.get('recurrence_type', '')
    recurrence_end_str = data.get('recurrence_end', '')

    if not assignee_id:
        return jsonify({'success': False, 'error': 'Debes asignar la tarea a alguien.'}), 400
    if not due_date_str:
        return jsonify({'success': False, 'error': 'La fecha de entrega es obligatoria.'}), 400

    try:
        due = date.fromisoformat(due_date_str)
    except ValueError:
        return jsonify({'success': False, 'error': 'Fecha de entrega inválida.'}), 400

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
        if not recurrence_end_str:
            return jsonify({'success': False, 'error': 'Debes indicar la fecha final de la recurrencia.'}), 400

        try:
            recurrence_end = date.fromisoformat(recurrence_end_str)
        except ValueError:
            return jsonify({'success': False, 'error': 'Fecha fin de recurrencia inválida.'}), 400

        if recurrence_end < due:
            return jsonify({'success': False, 'error': 'La fecha final de recurrencia no puede ser menor que la fecha de entrega.'}), 400

        dates = _generate_recurrence_dates(due, recurrence_type, recurrence_end)
        if not dates:
            return jsonify({'success': False, 'error': 'No se pudieron generar fechas para la recurrencia.'}), 400
        if len(dates) > 365:
            return jsonify({'success': False, 'error': 'La recurrencia genera demasiadas tareas (máx. 365).'}), 400

        # Create the parent task first
        parent = Task(
            title=title, description=description, client=client,
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
    if 'status' in data and data['status'] in Task.VALID_STATUSES:
        task.status = data['status']
    if 'due_date' in data:
        due_date_raw = (str(data.get('due_date') or '')).strip()
        if 'T' in due_date_raw:
            due_date_raw = due_date_raw.split('T', 1)[0]
        try:
            task.due_date = date.fromisoformat(due_date_raw)
        except ValueError:
            return jsonify({'success': False, 'error': 'Fecha de entrega inválida.'}), 400
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

    query = Task.query

    # Filters
    status = request.args.get('status', '').strip()
    client = request.args.get('client', '').strip()
    assignee_id = request.args.get('assignee_id', '').strip()
    creator_id = request.args.get('creator_id', '').strip()
    area = request.args.get('area', '').strip()

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
