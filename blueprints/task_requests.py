"""Blueprint for cross-area task requests."""
from datetime import datetime, date
from flask import Blueprint, render_template, request, jsonify
from flask_login import login_required, current_user
from extensions import db
from models import User, Area, Task, TaskWatcher, TaskRequest
from services.notifications import notify_user, notify_many
from blueprints.admin import log_activity
from blueprints.tasks import task_access_required, _assignee_in_current_unit

task_requests_bp = Blueprint('task_requests', __name__, template_folder='../templates')


# ─────────────────────────────────────────────────────────────
# Page
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/task-requests')
@login_required
def task_requests_page():
    """Task requests page."""
    return render_template('task_requests.html')


# ─────────────────────────────────────────────────────────────
# GET /api/areas — lightweight area list for modals
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/api/areas')
@login_required
def api_areas():
    areas = Area.query.order_by(Area.name).all()
    return jsonify({
        'success': True,
        'areas': [{'id': a.id, 'name': a.name} for a in areas],
    })


# ─────────────────────────────────────────────────────────────
# Create request
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/api/task-requests', methods=['POST'])
@task_access_required
def api_task_requests_create():
    if not current_user.area_id:
        return jsonify({'success': False, 'error': 'Tu usuario no tiene unidad asignada.'}), 400

    data = request.get_json(force=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'success': False, 'error': 'El título es obligatorio.'}), 400

    to_area_id = data.get('to_area_id')
    try:
        to_area_id = int(to_area_id)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Área destino no válida.'}), 400

    if to_area_id == current_user.area_id:
        return jsonify({'success': False, 'error': 'No puedes solicitar a tu propia unidad.'}), 400

    to_area = Area.query.get(to_area_id)
    if not to_area:
        return jsonify({'success': False, 'error': 'Área destino no encontrada.'}), 404

    priority = (data.get('priority') or 'Media').strip()
    if priority not in Task.VALID_PRIORITIES:
        return jsonify({'success': False, 'error': 'Prioridad inválida.'}), 400

    # Check destination area has at least one lead
    dest_leads = User.query.filter_by(area_id=to_area_id, is_area_lead=True, is_active=True).count()
    if dest_leads == 0:
        return jsonify({'success': False, 'error': 'La unidad destino no tiene líder asignado.'}), 400

    due_date_str = data.get('due_date', '').strip()
    parsed_due = None
    if due_date_str:
        try:
            parsed_due = date.fromisoformat(due_date_str)
        except (ValueError, TypeError):
            return jsonify({'success': False, 'error': 'Fecha de entrega no válida.'}), 400

    req = TaskRequest(
        title=title,
        description=(data.get('description') or '').strip(),
        client=(data.get('client') or '').strip(),
        due_date=parsed_due,
        priority=priority,
        requester_id=current_user.id,
        from_area_id=current_user.area_id,
        to_area_id=to_area_id,
    )
    db.session.add(req)

    # Notify destination leads
    dest_leads_list = User.query.filter_by(area_id=to_area_id, is_area_lead=True, is_active=True).all()
    notify_many(
        [u.id for u in dest_leads_list],
        kind='request_received',
        title=f'Solicitud de tarea: {title}',
        body=f'{current_user.username} ha solicitado una tarea a tu unidad.',
        link_url='/task-requests',
        entity_type='task_request',
        entity_id=req.id,
        actor_id=current_user.id,
    )

    log_activity('task_request_created', f'Solicitud #{req.id}: {title} -> {to_area.name}',
                 entity_type='task_request', entity_id=req.id)
    db.session.commit()

    return jsonify({'success': True, 'request': req.to_dict()}), 201


# ─────────────────────────────────────────────────────────────
# List requests
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/api/task-requests')
@login_required
def api_task_requests_list():
    if not current_user.area_id:
        return jsonify({'success': True, 'requests': []})

    direction = request.args.get('direction', 'received')
    status_filter = request.args.get('status', '').strip()

    if direction == 'sent':
        query = TaskRequest.query.filter_by(from_area_id=current_user.area_id)
    else:
        query = TaskRequest.query.filter_by(to_area_id=current_user.area_id)

    if status_filter and status_filter in TaskRequest.VALID_STATUSES:
        query = query.filter_by(status=status_filter)

    requests = query.order_by(TaskRequest.created_at.desc()).all()
    return jsonify({'success': True, 'requests': [r.to_dict() for r in requests]})


# ─────────────────────────────────────────────────────────────
# Accept request
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/api/task-requests/<int:request_id>/accept', methods=['POST'])
@task_access_required
def api_task_requests_accept(request_id):
    req = TaskRequest.query.get_or_404(request_id)

    # Only destination lead or admin
    if not current_user.is_admin:
        if not (current_user.is_area_lead and current_user.area_id == req.to_area_id):
            return jsonify({'success': False, 'error': 'Solo el líder de la unidad destino puede aceptar.'}), 403

    if req.status != 'Pendiente':
        return jsonify({'success': False, 'error': 'La solicitud ya fue resuelta.'}), 409

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
        return jsonify({'success': False, 'error': 'Usuario no encontrado o inactivo.'}), 404

    if assignee.area_id != req.to_area_id:
        return jsonify({'success': False, 'error': 'El asignado debe pertenecer a la unidad destino.'}), 400

    due_date_str = data.get('due_date', '').strip()
    parsed_due = None
    if due_date_str:
        try:
            parsed_due = date.fromisoformat(due_date_str)
        except (ValueError, TypeError):
            return jsonify({'success': False, 'error': 'Fecha de entrega no válida.'}), 400
    if not parsed_due:
        parsed_due = req.due_date or date.today()

    try:
        # Create task
        task = Task(
            title=req.title,
            description=req.description,
            client=req.client,
            due_date=parsed_due,
            priority=req.priority,
            status='Pendiente',
            visibility='shared',
            area=req.to_area.name if req.to_area else '',
            area_id=req.to_area_id,
            creator_id=current_user.id,
            assignee_id=assignee_id,
        )
        db.session.add(task)
        db.session.flush()  # get task.id

        # Add requester as watcher
        watcher = TaskWatcher(task_id=task.id, user_id=req.requester_id, added_by_id=current_user.id)
        db.session.add(watcher)

        # Update request
        req.status = 'Aceptada'
        req.resolved_by_id = current_user.id
        req.resolved_at = datetime.utcnow()
        req.created_task_id = task.id

        log_activity('task_request_accepted', f'Solicitud #{req.id} aceptada, tarea #{task.id} creada',
                     entity_type='task_request', entity_id=req.id)

        # Notifications
        notify_user(
            req.requester_id,
            'request_accepted',
            f'Solicitud aceptada: {req.title}',
            link_url=f'/tasks?task={task.id}',
            entity_type='task',
            entity_id=task.id,
            actor_id=current_user.id,
        )
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
        return jsonify({'success': True, 'task': task.to_dict(), 'request': req.to_dict()})

    except Exception:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'Error al aceptar la solicitud.'}), 500


# ─────────────────────────────────────────────────────────────
# Reject request
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/api/task-requests/<int:request_id>/reject', methods=['POST'])
@task_access_required
def api_task_requests_reject(request_id):
    req = TaskRequest.query.get_or_404(request_id)

    if not current_user.is_admin:
        if not (current_user.is_area_lead and current_user.area_id == req.to_area_id):
            return jsonify({'success': False, 'error': 'Solo el líder de la unidad destino puede rechazar.'}), 403

    if req.status != 'Pendiente':
        return jsonify({'success': False, 'error': 'La solicitud ya fue resuelta.'}), 409

    data = request.get_json(force=True) or {}
    reason = (data.get('reason') or '').strip()
    if len(reason) < 5:
        return jsonify({'success': False, 'error': 'Debes proporcionar una razón (mín. 5 caracteres).'}), 400

    req.status = 'Rechazada'
    req.resolved_by_id = current_user.id
    req.resolved_at = datetime.utcnow()
    req.rejection_reason = reason

    notify_user(
        req.requester_id,
        'request_rejected',
        f'Solicitud rechazada: {req.title}',
        body=f'Razón: {reason}',
        link_url='/task-requests',
        entity_type='task_request',
        entity_id=req.id,
        actor_id=current_user.id,
    )

    log_activity('task_request_rejected', f'Solicitud #{req.id} rechazada: {reason}',
                 entity_type='task_request', entity_id=req.id)
    db.session.commit()

    return jsonify({'success': True, 'request': req.to_dict()})


# ─────────────────────────────────────────────────────────────
# Cancel request
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/api/task-requests/<int:request_id>/cancel', methods=['POST'])
@task_access_required
def api_task_requests_cancel(request_id):
    req = TaskRequest.query.get_or_404(request_id)

    if req.requester_id != current_user.id and not current_user.is_admin:
        return jsonify({'success': False, 'error': 'Solo el solicitante puede cancelar.'}), 403

    if req.status != 'Pendiente':
        return jsonify({'success': False, 'error': 'La solicitud ya fue resuelta.'}), 409

    req.status = 'Cancelada'
    req.resolved_by_id = current_user.id
    req.resolved_at = datetime.utcnow()

    log_activity('task_request_cancelled', f'Solicitud #{req.id} cancelada por {current_user.username}',
                 entity_type='task_request', entity_id=req.id)
    db.session.commit()

    return jsonify({'success': True, 'request': req.to_dict()})
