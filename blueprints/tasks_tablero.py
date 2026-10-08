"""
Tablero Kanban, etiquetas y dependencias entre tareas.

Va aparte de blueprints/tasks.py, que ya pasa de 2900 lineas, pero usa sus
mismas reglas de alcance y permisos: nada de lo que hay aqui decide por su
cuenta quien ve o edita una tarea.

    GET    /api/tasks/board                      columnas y tarjetas
    POST   /api/tasks/<id>/move                  cambiar de columna y/o de sitio
    GET    /api/tasks/tags                       etiquetas visibles
    POST   /api/tasks/tags                       crear
    PUT    /api/tasks/tags/<id>                  renombrar o cambiar color
    DELETE /api/tasks/tags/<id>                  borrar (y quitarla de las tareas)
    PUT    /api/tasks/<id>/tags                  fijar las etiquetas de una tarea
    GET    /api/tasks/<id>/dependencies          que la bloquea y a que bloquea
    POST   /api/tasks/<id>/dependencies          anadir una relacion
    DELETE /api/tasks/<id>/dependencies/<dep>    quitarla
"""
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify
from flask_login import current_user
from sqlalchemy import or_, case, func, update

from extensions import db
from models import Task, TaskTag, TaskDependency, task_tag_links
from services.alcance import ambito_unidades
from services.clock import today_local
from services.catalogo import (estados, estados_validos, estados_finales,
                               prioridades_validas, es_estado_final)
from services.tablero import (etiquetas_visibles, puede_gestionar_etiqueta,
                              extras_de_tablero, crearia_ciclo, bloqueadoras_abiertas,
                              posicion_entre, hay_hueco, posiciones_renumeradas)
from blueprints.tasks import (task_access_required, _apply_unit_scope, _can_view_task,
                              _can_edit_task, _task_engagement_counts, _with_task_relations,
                              _avisar_cambio_de_estado, TASK_FEED_MAX_ROWS)

tablero_bp = Blueprint('tablero', __name__)


# Lo cerrado hace tiempo no aporta nada en un tablero de trabajo en curso y
# solo alarga la ultima columna. Se puede pedir mas con ?cerradas_dias=.
DIAS_DE_CERRADAS = 14
NOMBRE_MAX_ETIQUETA = 40


def _log(accion, detalle, task_id):
    from blueprints.admin import log_activity
    log_activity(accion, detalle, entity_type='task', entity_id=task_id, commit=False)


def _orden_de_columna():
    """Colocadas a mano primero, por su posicion; el resto por fecha de entrega."""
    return (
        case((Task.board_position.is_(None), 1), else_=0),
        Task.board_position.asc(),
        Task.due_date.asc(),
        Task.id.asc(),
    )


def _tarea_breve(task):
    return {
        'id': task.id,
        'title': task.title,
        'status': task.status,
        'due_date': task.due_date.isoformat() if task.due_date else '',
        'assignee_name': task.assignee.username if task.assignee else '',
        'is_final': es_estado_final(task.status),
    }


# ─────────────────────────────────────────────────────────────
# Tablero
# ─────────────────────────────────────────────────────────────

def _columnas():
    lista = estados()
    if lista:
        return [{
            'nombre': e.nombre,
            'color': e.color,
            'es_inicial': bool(e.es_inicial),
            'es_final': bool(e.es_final),
        } for e in lista]
    # Base anterior al catalogo: las columnas salen de la lista de respaldo.
    finales = estados_finales()
    validos = estados_validos()
    return [{
        'nombre': nombre,
        'color': 'neutro',
        'es_inicial': indice == 0,
        'es_final': nombre in finales,
    } for indice, nombre in enumerate(validos)]


@tablero_bp.route('/api/tasks/board')
@task_access_required
def api_tablero():
    args = request.args
    query = _apply_unit_scope(Task.active_query())

    # Mismos chips que la bandeja, y por la misma razon se aplican despues del
    # alcance: estrechan, nunca amplian.
    scope = args.get('scope', '').strip()
    if scope == 'mine':
        query = query.filter(Task.assignee_id == current_user.id)
    elif scope == 'created':
        query = query.filter(Task.creator_id == current_user.id)

    q = args.get('q', '').strip()
    if len(q) >= 2:
        patron = f'%{q}%'
        query = query.filter(or_(Task.title.ilike(patron), Task.description.ilike(patron),
                                 Task.client.ilike(patron)))

    priority = args.get('priority', '').strip()
    if priority and priority in prioridades_validas():
        query = query.filter(Task.priority == priority)
    assignee_id = args.get('assignee_id', '').strip()
    if assignee_id.isdigit():
        query = query.filter(Task.assignee_id == int(assignee_id))
    client = args.get('client', '').strip()
    if client:
        query = query.filter(Task.client.ilike(f'%{client}%'))
    area = args.get('area', '').strip()
    if area:
        query = query.filter(Task.area == area)
    tag_id = args.get('tag_id', '').strip()
    if tag_id.isdigit():
        query = query.filter(Task.id.in_(
            db.session.query(task_tag_links.c.task_id).filter(task_tag_links.c.tag_id == int(tag_id))
        ))

    # El aviso de "N vencidas" filtra todas las vistas, tambien esta.
    if args.get('overdue', '').strip() == '1':
        query = query.filter(Task.due_date < today_local(), ~Task.status.in_(estados_finales()))

    try:
        dias = max(0, min(int(args.get('cerradas_dias', DIAS_DE_CERRADAS)), 365))
    except (TypeError, ValueError):
        dias = DIAS_DE_CERRADAS
    finales = estados_finales()
    desde = datetime.utcnow() - timedelta(days=dias)
    query = query.filter(or_(~Task.status.in_(finales), Task.updated_at >= desde))

    tareas = _with_task_relations(query).order_by(*_orden_de_columna()) \
        .limit(TASK_FEED_MAX_ROWS + 1).all()
    truncado = len(tareas) > TASK_FEED_MAX_ROWS
    tareas = tareas[:TASK_FEED_MAX_ROWS]

    ids = [t.id for t in tareas]
    conteos = _task_engagement_counts(ids)
    extras = extras_de_tablero(ids)
    tarjetas = []
    for t in tareas:
        item = t.to_dict()
        item.update(conteos.get(t.id, {}))
        item.update(extras.get(t.id, {}))
        tarjetas.append(item)

    return jsonify({
        'success': True,
        'columns': _columnas(),
        'tasks': tarjetas,
        'tags': [e.to_dict() for e in etiquetas_visibles(current_user).order_by(TaskTag.nombre).all()],
        'truncated': truncado,
        'closed_days': dias,
    })


def _colocar(task, estado, anterior_id, siguiente_id):
    """Da a la tarea una posicion entre sus vecinas en la columna de destino.

    Las vecinas se buscan en el servidor, en el mismo orden que pinta el
    tablero, en vez de fiarse de las posiciones que mande el navegador: otra
    persona puede haber movido algo desde que se cargo la pagina.

    Si no cabe —tarjetas sin colocar o hueco agotado— se renumera la columna
    visible entera. Eso se hace con UPDATE directo y conservando updated_at:
    reordenar no es editar, y si contara como edicion, cada arrastre haria
    saltar el aviso de conflicto a quien tuviera abierta otra tarea.
    """
    columna = _apply_unit_scope(Task.active_query()).filter(
        Task.status == estado, Task.id != task.id,
    ).order_by(*_orden_de_columna()).all()

    ids = [t.id for t in columna]
    if anterior_id in ids:
        indice = ids.index(anterior_id) + 1
    elif siguiente_id in ids:
        indice = ids.index(siguiente_id)
    else:
        indice = len(columna)

    antes = columna[indice - 1] if indice > 0 else None
    despues = columna[indice] if indice < len(columna) else None
    pos_antes = antes.board_position if antes else None
    pos_despues = despues.board_position if despues else None

    sin_colocar = (antes is not None and pos_antes is None) or (despues is not None and pos_despues is None)
    if not sin_colocar:
        nueva = posicion_entre(pos_antes, pos_despues)
        if hay_hueco(pos_antes, pos_despues, nueva):
            return nueva, []

    orden = [t.id for t in columna[:indice]] + [task.id] + [t.id for t in columna[indice:]]
    posiciones = posiciones_renumeradas(len(orden))
    nueva = posiciones[indice]
    otras = [(tid, pos) for tid, pos in zip(orden, posiciones) if tid != task.id]
    return nueva, otras


@tablero_bp.route('/api/tasks/<int:task_id>/move', methods=['POST'])
@task_access_required
def api_mover(task_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    data = request.get_json(force=True, silent=True)
    if not isinstance(data, dict):
        data = {}

    estado = (data.get('status') or task.status).strip()
    if estado not in estados_validos():
        return jsonify({'success': False, 'error': 'Estado inválido.'}), 400
    cambia_estado = estado != task.status

    # El conflicto solo importa si cambia el estado: reordenar dentro de la
    # columna no pisa nada de lo que otra persona pueda estar editando.
    esperado = (data.get('expected_updated_at') or '').strip()
    actual = task.updated_at.isoformat() if task.updated_at else ''
    if cambia_estado and esperado and esperado != actual:
        return jsonify({
            'success': False,
            'error': 'La tarea fue modificada por otro usuario. Recarga e intenta de nuevo.',
            'task': task.to_dict(),
        }), 409

    def _id(clave):
        try:
            return int(data.get(clave))
        except (TypeError, ValueError):
            return None

    posicion, otras = _colocar(task, estado, _id('anterior_id'), _id('siguiente_id'))

    aviso = ''
    if cambia_estado:
        previo = task.status
        task.status = estado
        task.board_position = posicion
        if es_estado_final(estado):
            pendientes = bloqueadoras_abiertas(task.id)
            if pendientes:
                # No se impide: quien cierra sabe si la dependencia sigue en
                # pie. Pero se dice, porque el tablero es donde mas facil es
                # cerrar algo de un arrastre sin mirar.
                nombres = ', '.join(t.title for t in pendientes[:3])
                resto = len(pendientes) - 3
                aviso = f'Sigue bloqueada por: {nombres}' + (f' y {resto} más' if resto > 0 else '') + '.'
        _avisar_cambio_de_estado(task)
        _log('task_update', f'Tarea movida en el tablero: {task.title} ({previo} → {estado}) (id={task.id})',
             task.id)
    else:
        db.session.execute(update(Task).where(Task.id == task.id).values(
            board_position=posicion, updated_at=Task.updated_at))

    for otra_id, otra_pos in otras:
        db.session.execute(update(Task).where(Task.id == otra_id).values(
            board_position=otra_pos, updated_at=Task.updated_at))

    db.session.flush()
    if not cambia_estado:
        db.session.refresh(task)
    payload = task.to_dict()
    db.session.commit()
    return jsonify({'success': True, 'task': payload, 'aviso': aviso})


# ─────────────────────────────────────────────────────────────
# Etiquetas
# ─────────────────────────────────────────────────────────────

def _validar_etiqueta(data, etiqueta_actual=None):
    nombre = ' '.join(str(data.get('nombre') or '').split())
    if not nombre:
        return None, None, 'El nombre es obligatorio.'
    if len(nombre) > NOMBRE_MAX_ETIQUETA:
        return None, None, f'Máximo {NOMBRE_MAX_ETIQUETA} caracteres.'
    color = str(data.get('color') or (etiqueta_actual.color if etiqueta_actual else 'neutro'))
    if color not in TaskTag.COLORES:
        return None, None, 'Color inválido.'
    return nombre, color, None


def _nombre_ocupado(nombre, area_id, excluir_id=None):
    consulta = TaskTag.query.filter(func.lower(TaskTag.nombre) == nombre.lower())
    consulta = consulta.filter(TaskTag.area_id.is_(None) if area_id is None else TaskTag.area_id == area_id)
    if excluir_id:
        consulta = consulta.filter(TaskTag.id != excluir_id)
    return db.session.query(consulta.exists()).scalar()


@tablero_bp.route('/api/tasks/tags')
@task_access_required
def api_etiquetas():
    lista = etiquetas_visibles(current_user).order_by(TaskTag.nombre).all()
    return jsonify({'success': True, 'tags': [
        dict(e.to_dict(), can_manage=puede_gestionar_etiqueta(current_user, e)) for e in lista
    ]})


@tablero_bp.route('/api/tasks/tags', methods=['POST'])
@task_access_required
def api_etiqueta_crear():
    data = request.get_json(force=True, silent=True)
    if not isinstance(data, dict):
        data = {}
    nombre, color, error = _validar_etiqueta(data)
    if error:
        return jsonify({'success': False, 'error': error}), 400

    # Por defecto, de la unidad de quien la crea. Un admin puede crearla comun.
    if current_user.is_admin and data.get('comun'):
        area_id = None
    else:
        area_id = data.get('area_id') or current_user.area_id
        try:
            area_id = int(area_id) if area_id is not None else None
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Unidad inválida.'}), 400
        if area_id is None:
            return jsonify({'success': False, 'error': 'Necesitas una unidad para crear etiquetas.'}), 400
        if not current_user.is_admin and area_id not in ambito_unidades(current_user):
            return jsonify({'success': False, 'error': 'Solo puedes crear etiquetas en tus unidades.'}), 403

    if _nombre_ocupado(nombre, area_id):
        return jsonify({'success': False, 'error': 'Ya existe una etiqueta con ese nombre.'}), 409

    etiqueta = TaskTag(nombre=nombre, color=color, area_id=area_id, created_by_id=current_user.id)
    db.session.add(etiqueta)
    db.session.commit()
    return jsonify({'success': True, 'tag': dict(etiqueta.to_dict(), can_manage=True)}), 201


@tablero_bp.route('/api/tasks/tags/<int:tag_id>', methods=['PUT'])
@task_access_required
def api_etiqueta_editar(tag_id):
    etiqueta = etiquetas_visibles(current_user).filter(TaskTag.id == tag_id).first_or_404()
    if not puede_gestionar_etiqueta(current_user, etiqueta):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403
    data = request.get_json(force=True, silent=True)
    if not isinstance(data, dict):
        data = {}
    data.setdefault('nombre', etiqueta.nombre)
    nombre, color, error = _validar_etiqueta(data, etiqueta)
    if error:
        return jsonify({'success': False, 'error': error}), 400
    if _nombre_ocupado(nombre, etiqueta.area_id, excluir_id=etiqueta.id):
        return jsonify({'success': False, 'error': 'Ya existe una etiqueta con ese nombre.'}), 409
    etiqueta.nombre = nombre
    etiqueta.color = color
    db.session.commit()
    return jsonify({'success': True, 'tag': dict(etiqueta.to_dict(), can_manage=True)})


@tablero_bp.route('/api/tasks/tags/<int:tag_id>', methods=['DELETE'])
@task_access_required
def api_etiqueta_borrar(tag_id):
    etiqueta = etiquetas_visibles(current_user).filter(TaskTag.id == tag_id).first_or_404()
    if not puede_gestionar_etiqueta(current_user, etiqueta):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403
    # Los enlaces se borran a mano: el ON DELETE CASCADE no existe en SQLite
    # sin activar las claves foraneas, y no se quiere depender de eso.
    db.session.execute(task_tag_links.delete().where(task_tag_links.c.tag_id == etiqueta.id))
    db.session.delete(etiqueta)
    db.session.commit()
    return jsonify({'success': True})


@tablero_bp.route('/api/tasks/<int:task_id>/tags', methods=['PUT'])
@task_access_required
def api_tarea_etiquetas(task_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403
    data = request.get_json(force=True, silent=True)
    crudos = data.get('tag_ids') if isinstance(data, dict) else None
    if not isinstance(crudos, list):
        return jsonify({'success': False, 'error': 'Falta la lista de etiquetas.'}), 400
    try:
        pedidas = {int(x) for x in crudos}
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Etiquetas inválidas.'}), 400

    nuevas = etiquetas_visibles(current_user).filter(TaskTag.id.in_(pedidas)).all() if pedidas else []
    if len(nuevas) != len(pedidas):
        return jsonify({'success': False, 'error': 'Alguna etiqueta no existe o no es de tu unidad.'}), 400

    # Las que la tarea ya tenia y este usuario no ve (de otra unidad) se
    # conservan: quitarlas seria borrar el trabajo de otro equipo sin saberlo.
    visibles = {e.id for e in etiquetas_visibles(current_user).all()}
    actuales = task.tags.all()
    conservar = [e for e in actuales if e.id not in visibles]

    db.session.execute(task_tag_links.delete().where(task_tag_links.c.task_id == task.id))
    finales = {e.id: e for e in conservar + nuevas}
    if finales:
        db.session.execute(task_tag_links.insert(), [
            {'task_id': task.id, 'tag_id': tid} for tid in finales
        ])

    antes = sorted(e.nombre for e in actuales)
    despues = sorted(e.nombre for e in finales.values())
    if antes != despues:
        _log('task_update', f'Etiquetas de "{task.title}": {", ".join(despues) or "ninguna"} (id={task.id})',
             task.id)
    db.session.commit()
    return jsonify({'success': True, 'tags': [e.to_dict() for e in sorted(finales.values(), key=lambda e: e.nombre)]})


# ─────────────────────────────────────────────────────────────
# Dependencias
# ─────────────────────────────────────────────────────────────

def _lado(relaciones, campo):
    """Tareas relacionadas que este usuario puede ver, y cuantas no."""
    visibles, ocultas = [], 0
    for rel in relaciones:
        otra = getattr(rel, campo)
        if otra is None or otra.deleted_at is not None:
            continue
        if _can_view_task(otra):
            visibles.append(dict(_tarea_breve(otra), dependency_id=rel.id))
        else:
            ocultas += 1
    return visibles, ocultas


@tablero_bp.route('/api/tasks/<int:task_id>/dependencies')
@task_access_required
def api_dependencias(task_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_view_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403

    previas = TaskDependency.query.filter_by(blocked_task_id=task.id).all()
    siguientes = TaskDependency.query.filter_by(blocker_task_id=task.id).all()
    bloqueada_por, ocultas_previas = _lado(previas, 'blocker')
    bloquea_a, ocultas_siguientes = _lado(siguientes, 'blocked')
    return jsonify({
        'success': True,
        'blocked_by': bloqueada_por,
        'blocks': bloquea_a,
        # Se dice cuantas no se ven: si no, alguien de otra unidad podria
        # tener la tarea parada y aqui pareceria libre.
        'hidden_blocked_by': ocultas_previas,
        'hidden_blocks': ocultas_siguientes,
        'can_edit': _can_edit_task(task),
    })


@tablero_bp.route('/api/tasks/<int:task_id>/dependencies', methods=['POST'])
@task_access_required
def api_dependencia_crear(task_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403
    data = request.get_json(force=True, silent=True)
    if not isinstance(data, dict):
        data = {}
    tipo = data.get('tipo')
    if tipo not in ('blocked_by', 'blocks'):
        return jsonify({'success': False, 'error': 'Tipo de relación inválido.'}), 400
    try:
        otra_id = int(data.get('task_id'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Falta la otra tarea.'}), 400

    otra = Task.active_query().filter_by(id=otra_id).first()
    if not otra or not _can_view_task(otra):
        return jsonify({'success': False, 'error': 'La otra tarea no existe o no la puedes ver.'}), 404
    if otra.id == task.id:
        return jsonify({'success': False, 'error': 'Una tarea no puede depender de sí misma.'}), 400

    if tipo == 'blocked_by':
        blocker_id, blocked_id = otra.id, task.id
    else:
        blocker_id, blocked_id = task.id, otra.id

    if TaskDependency.query.filter_by(blocker_task_id=blocker_id, blocked_task_id=blocked_id).first():
        return jsonify({'success': False, 'error': 'Esa relación ya existe.'}), 409
    if crearia_ciclo(blocker_id, blocked_id):
        return jsonify({'success': False,
                        'error': 'Eso crearía un círculo: una de las dos ya depende de la otra.'}), 400

    rel = TaskDependency(blocker_task_id=blocker_id, blocked_task_id=blocked_id,
                         created_by_id=current_user.id)
    db.session.add(rel)
    texto = (f'"{otra.title}" debe cerrarse antes que "{task.title}"' if tipo == 'blocked_by'
             else f'"{task.title}" debe cerrarse antes que "{otra.title}"')
    _log('task_dependency_add', f'Dependencia: {texto}', task.id)
    db.session.commit()
    return jsonify({'success': True, 'dependency_id': rel.id}), 201


@tablero_bp.route('/api/tasks/<int:task_id>/dependencies/<int:dep_id>', methods=['DELETE'])
@task_access_required
def api_dependencia_borrar(task_id, dep_id):
    task = Task.active_query().filter_by(id=task_id).first_or_404()
    if not _can_edit_task(task):
        return jsonify({'success': False, 'error': 'Sin permisos.'}), 403
    rel = TaskDependency.query.filter(
        TaskDependency.id == dep_id,
        or_(TaskDependency.blocker_task_id == task.id, TaskDependency.blocked_task_id == task.id),
    ).first_or_404()
    _log('task_dependency_remove',
         f'Dependencia quitada: "{rel.blocker.title}" ya no va antes que "{rel.blocked.title}"', task.id)
    db.session.delete(rel)
    db.session.commit()
    return jsonify({'success': True})
