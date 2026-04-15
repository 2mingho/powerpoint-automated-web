import functools
from datetime import datetime, timedelta, date
from flask import Blueprint, render_template, request, jsonify
from flask_login import login_required, current_user
from extensions import db
from models import User, Task

tasks_bp = Blueprint('tasks', __name__)


def task_access_required(f):
    """Decorator: requires login + tasks tool access."""
    @functools.wraps(f)
    @login_required
    def decorated(*args, **kwargs):
        if not current_user.has_tool_access('tasks'):
            if request.is_json or 'application/json' in request.headers.get('Accept', ''):
                return jsonify({'success': False, 'error': 'No tienes permiso para esta herramienta.'}), 403
            from flask import redirect, url_for, flash
            flash('No tienes permiso para acceder a esta herramienta.', 'error')
            return redirect(url_for('menu'))
        return f(*args, **kwargs)
    return decorated


# ─────────────────────────────────────────────────────────────
# Page view
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/tasks')
@task_access_required
def tasks_page():
    """Render the main calendar/task view."""
    # Get users in the same area for the assignee dropdown
    if current_user.is_admin:
        area_users = User.query.filter_by(is_active=True).order_by(User.username).all()
    else:
        area_users = User.query.filter_by(role=current_user.role, is_active=True).order_by(User.username).all()
    return render_template('tasks.html', area_users=area_users)


# ─────────────────────────────────────────────────────────────
# API: List tasks (JSON feed for FullCalendar)
# ─────────────────────────────────────────────────────────────

@tasks_bp.route('/api/tasks')
@task_access_required
def api_tasks_list():
    """Return tasks as JSON. Filter by area (role) unless admin."""
    start = request.args.get('start', '')
    end = request.args.get('end', '')

    query = Task.query
    if not current_user.is_admin:
        query = query.filter_by(area=current_user.role)

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

    # Validate assignee belongs to the same area (or admin can assign anyone)
    assignee = User.query.get(int(assignee_id))
    if not assignee:
        return jsonify({'success': False, 'error': 'El usuario asignado no existe.'}), 400
    if not current_user.is_admin and assignee.role != current_user.role:
        return jsonify({'success': False, 'error': 'Solo puedes asignar tareas a usuarios de tu área.'}), 400

    area = current_user.role if not current_user.is_admin else (assignee.role if assignee.role != 'admin' else 'DI')

    created_tasks = []

    if is_recurrent and recurrence_type in Task.RECURRENCE_TYPES and recurrence_end_str:
        try:
            recurrence_end = date.fromisoformat(recurrence_end_str)
        except ValueError:
            return jsonify({'success': False, 'error': 'Fecha fin de recurrencia inválida.'}), 400

        dates = _generate_recurrence_dates(due, recurrence_type, recurrence_end)
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

    # Permission: only same area or admin
    if not current_user.is_admin and task.area != current_user.role:
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
        assignee = User.query.get(int(data['assignee_id']))
        if assignee:
            task.assignee_id = assignee.id

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

    if not current_user.is_admin and task.area != current_user.role:
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
    rows = db.session.query(Task.client).filter(
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
    """Return users in the same area for assignee picker."""
    if current_user.is_admin:
        users = User.query.filter_by(is_active=True).order_by(User.username).all()
    else:
        users = User.query.filter_by(role=current_user.role, is_active=True).order_by(User.username).all()
    return jsonify([{'id': u.id, 'username': u.username, 'role': u.role} for u in users])


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

    return jsonify({
        'clients': clients,
        'users': [{'id': u.id, 'username': u.username, 'role': u.role} for u in users],
        'areas': ['DI', 'MW'],
        'statuses': list(Task.VALID_STATUSES),
    })
