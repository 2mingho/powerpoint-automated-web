"""Blueprint for cross-area task requests."""
from datetime import datetime, date
from flask import Blueprint, render_template, request, jsonify
from sqlalchemy import or_
from flask_login import login_required, current_user
from extensions import db
from models import User, Area, Task, TaskWatcher, TaskRequest, UnitLead
from services.alcance import alcance_unidades, ambito_unidades, unidades_lideradas
from services.notifications import notify_user, notify_many
from services.clock import today_local
from services.catalogo import (prioridades_validas, prioridad_por_defecto,
                               estado_inicial)
from blueprints.admin import log_activity
from blueprints.tasks import task_access_required

task_requests_bp = Blueprint('task_requests', __name__, template_folder='../templates')


# ─────────────────────────────────────────────────────────────
# A quien se puede solicitar, y quien resuelve
# ─────────────────────────────────────────────────────────────

def _unidades_propias(user):
    """Unidades a las que no tiene sentido solicitarse trabajo a uno mismo.

    Antes se usaba ambito_unidades() para todos. Para un admin ese ambito es la
    empresa entera, asi que la regla le cerraba *todas* las unidades: un admin
    no podia enviar ni una solicitud, que es justo lo que se veia desde fuera
    como "el modulo no deja enviar solicitudes". Un admin solo se excluye la
    suya y las que lidera de verdad.
    """
    if getattr(user, 'is_admin', False):
        unidades = set(unidades_lideradas(user))
    else:
        unidades = set(ambito_unidades(user))
    propia = getattr(user, 'area_id', None)
    if propia is not None:
        unidades.add(propia)
    return unidades


def _resolutores(area_id):
    """Quien puede aceptar o rechazar lo que llega a esa unidad.

    Son sus lideres, y si no tiene ninguno, los administradores. Antes la falta
    de lider era un 400 que cortaba el envio: una unidad sin fila en unit_leads
    —lo normal en una base recien migrada— dejaba la solicitud imposible de
    enviar en vez de imposible de aceptar. Ahora la solicitud viaja y la
    resuelve quien administra, que ya tenia permiso para hacerlo.
    """
    lideres = User.query.join(
        UnitLead, UnitLead.user_id == User.id
    ).filter(UnitLead.area_id == area_id, User.is_active.is_(True)).all()
    if lideres:
        return lideres
    return User.query.filter(User.es_admin.is_(True), User.is_active.is_(True)).all()


# ─────────────────────────────────────────────────────────────
# Page
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/task-requests')
@login_required
def task_requests_page():
    """Task requests page."""
    return render_template(
        'task_requests.html', task_priorities=prioridades_validas(),
        default_priority=prioridad_por_defecto(),
    )


# ─────────────────────────────────────────────────────────────
# GET /api/areas — lightweight area list for modals
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/api/areas')
@login_required
def api_areas():
    """Unidades para los desplegables.

    Con ?destino=solicitud devuelve solo aquellas a las que el usuario puede
    solicitar trabajo. El desplegable ofrecia todas, incluidas las suyas, y el
    error solo aparecia despues de rellenar el formulario y pulsar enviar: la
    lista y la regla del servidor decian cosas distintas.
    """
    areas = Area.query.order_by(Area.name).all()
    if request.args.get('destino') == 'solicitud':
        propias = _unidades_propias(current_user)
        areas = [a for a in areas if a.id not in propias]
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
    # Ya no se exige unidad de origen. Antes se cortaba aqui, asi que quien no
    # la tuviera asignada no podia enviar ni una solicitud: la culpa era de un
    # dato de administracion, no de lo que estaba pidiendo.
    data = request.get_json(force=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'success': False, 'error': 'El título es obligatorio.'}), 400

    to_area_id = data.get('to_area_id')
    try:
        to_area_id = int(to_area_id)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Área destino no válida.'}), 400

    # Quien lleva varias unidades no deberia solicitarse trabajo a si mismo en
    # ninguna de ellas, ni un director a las de sus managers. Para un admin la
    # regla se limita a la suya y a las que lidera: ver el resto no es llevarlo.
    if to_area_id in _unidades_propias(current_user):
        return jsonify({'success': False, 'error': 'Esa unidad ya es tuya. Elige otra o crea la tarea directamente.'}), 400

    to_area = Area.query.get(to_area_id)
    if not to_area:
        return jsonify({'success': False, 'error': 'Área destino no encontrada.'}), 404

    priority = (data.get('priority') or prioridad_por_defecto()).strip()
    if priority not in prioridades_validas():
        return jsonify({'success': False, 'error': 'Prioridad inválida.'}), 400

    # Quien va a resolverla: sus lideres, o los administradores si no tiene
    # ninguno. Solo se corta el envio cuando no queda nadie en absoluto.
    destinatarios = _resolutores(to_area_id)
    if not destinatarios:
        return jsonify({
            'success': False,
            'error': 'Esa unidad no tiene a nadie que pueda recibir solicitudes. Avisa a un administrador.',
        }), 400

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
    # Sin flush la solicitud todavia no tiene id, y tanto la notificacion como
    # el registro de actividad guardaban entity_id nulo: el aviso no podia
    # llevar a ninguna parte.
    db.session.flush()

    notify_many(
        [u.id for u in destinatarios],
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
    unidades = ambito_unidades(current_user)
    direction = request.args.get('direction', 'received')
    status_filter = request.args.get('status', '').strip()

    if direction == 'sent':
        # Lo que uno envio es suyo aunque su unidad cambie despues, y aunque no
        # tenga unidad. Filtrar solo por from_area_id dejaba "Enviadas" vacia
        # justo para quien acababa de mandar la solicitud.
        condiciones = [TaskRequest.requester_id == current_user.id]
        if unidades:
            condiciones.append(TaskRequest.from_area_id.in_(unidades))
        query = TaskRequest.query.filter(or_(*condiciones))
    else:
        if not unidades:
            return jsonify({'success': True, 'requests': []})
        query = TaskRequest.query.filter(TaskRequest.to_area_id.in_(unidades))

    if status_filter and status_filter in TaskRequest.VALID_STATUSES:
        query = query.filter_by(status=status_filter)

    requests = query.order_by(TaskRequest.created_at.desc()).all()
    return jsonify({'success': True, 'requests': [r.to_dict() for r in requests]})


# ─────────────────────────────────────────────────────────────
# Quien puede quedarse la tarea
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/api/task-requests/<int:request_id>/assignees')
@task_access_required
def api_task_requests_assignees(request_id):
    """Gente de la unidad destino, que es la unica a la que se puede asignar.

    El modal de aceptar llenaba el desplegable con /api/team/tasks/filters, que
    devuelve el equipo de quien mira, no el de la unidad destino. Quien lidera
    dos unidades veia las dos mezcladas y un admin veia la empresa entera; al
    confirmar, el servidor rechazaba con "el asignado debe pertenecer a la
    unidad destino" sin que hubiera forma de saber cual servia.
    """
    req = TaskRequest.query.get_or_404(request_id)

    if not current_user.is_admin and req.to_area_id not in alcance_unidades(current_user):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    usuarios = User.query.filter(
        User.area_id == req.to_area_id, User.is_active.is_(True)
    ).order_by(User.username).all()

    return jsonify({
        'success': True,
        'area_name': req.to_area.name if req.to_area else '',
        'due_date': req.due_date.isoformat() if req.due_date else '',
        'users': [{'id': u.id, 'username': u.username} for u in usuarios],
    })


# ─────────────────────────────────────────────────────────────
# Accept request
# ─────────────────────────────────────────────────────────────

@task_requests_bp.route('/api/task-requests/<int:request_id>/accept', methods=['POST'])
@task_access_required
def api_task_requests_accept(request_id):
    req = TaskRequest.query.get_or_404(request_id)

    # Only destination lead or admin
    if not current_user.is_admin:
        # El alcance de supervision, no el ambito: pertenecer a la unidad
        # destino no da derecho a aceptar trabajo en su nombre.
        if req.to_area_id not in alcance_unidades(current_user):
            return jsonify({'success': False, 'error': 'Solo quien lidera la unidad destino puede aceptar.'}), 403

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
        parsed_due = req.due_date or today_local()

    try:
        # Create task
        task = Task(
            title=req.title,
            description=req.description,
            client=req.client,
            due_date=parsed_due,
            priority=req.priority,
            status=estado_inicial(),
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
        # El alcance de supervision, no el ambito: pertenecer a la unidad
        # destino no da derecho a rechazar trabajo en su nombre.
        if req.to_area_id not in alcance_unidades(current_user):
            return jsonify({'success': False, 'error': 'Solo quien lidera la unidad destino puede rechazar.'}), 403

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
