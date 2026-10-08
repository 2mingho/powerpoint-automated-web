"""
services/tablero.py
-------------------
Lo que el tablero Kanban, las etiquetas y las dependencias necesitan saber de
la base, sin depender de la peticion mas que para el alcance.

    etiquetas_visibles(user)       que etiquetas puede ver y poner
    extras_de_tablero(ids)         etiquetas y bloqueos de varias tareas, en bloque
    crearia_ciclo(antes, despues)  si una dependencia nueva cerraria un circulo
    posicion_entre(a, b)           donde cae una tarjeta soltada entre dos

Las consultas van agrupadas por el mismo motivo que _task_engagement_counts:
el tablero pinta esto en cada tarjeta y resolverlo tarjeta a tarjeta es un N+1.
"""
from sqlalchemy import or_

from extensions import db
from models import Task, TaskTag, TaskDependency, task_tag_links
from services.alcance import ambito_unidades
from services.catalogo import estados_finales


# Hueco entre tarjetas al colocarlas. Con un real de doble precision se puede
# partir el hueco por la mitad unas cincuenta veces antes de perder resolucion,
# mucho mas de lo que una columna aguanta entre dos recolocaciones completas.
PASO_DE_POSICION = 1024.0


# ─────────────────────────────────────────────────────────────
# Etiquetas
# ─────────────────────────────────────────────────────────────

def etiquetas_visibles(user):
    """Consulta de las etiquetas comunes mas las de las unidades del usuario."""
    consulta = TaskTag.query
    if user.is_admin:
        return consulta
    unidades = ambito_unidades(user)
    if not unidades:
        return consulta.filter(TaskTag.area_id.is_(None))
    return consulta.filter(or_(TaskTag.area_id.is_(None), TaskTag.area_id.in_(unidades)))


def puede_gestionar_etiqueta(user, etiqueta):
    """Renombrar o borrar. Las comunes solo un admin; las de unidad, quien trabaja en ella."""
    if user.is_admin:
        return True
    if etiqueta.area_id is None:
        return False
    return etiqueta.area_id in ambito_unidades(user)


# ─────────────────────────────────────────────────────────────
# Extras por tarjeta
# ─────────────────────────────────────────────────────────────

def extras_de_tablero(task_ids):
    """Etiquetas y bloqueos de cada tarea, en tres consultas para todas.

    blocked_by_open cuenta solo bloqueadoras abiertas y no borradas: una
    dependencia cuya tarea previa ya se cerro no bloquea nada. blocks_count
    cuenta las que esperan por esta, abiertas o no, para que se vea que tocarla
    afecta a otras.
    """
    ids = [tid for tid in task_ids if tid is not None]
    if not ids:
        return {}

    filas_etiqueta = db.session.query(task_tag_links.c.task_id, TaskTag).join(
        TaskTag, TaskTag.id == task_tag_links.c.tag_id,
    ).filter(task_tag_links.c.task_id.in_(ids)).order_by(TaskTag.nombre).all()

    finales = estados_finales()
    bloqueadora = db.aliased(Task)
    filas_bloqueo = db.session.query(
        TaskDependency.blocked_task_id, db.func.count(TaskDependency.id),
    ).join(bloqueadora, bloqueadora.id == TaskDependency.blocker_task_id).filter(
        TaskDependency.blocked_task_id.in_(ids),
        bloqueadora.deleted_at.is_(None),
        ~bloqueadora.status.in_(finales),
    ).group_by(TaskDependency.blocked_task_id).all()

    bloqueada = db.aliased(Task)
    filas_bloquea = db.session.query(
        TaskDependency.blocker_task_id, db.func.count(TaskDependency.id),
    ).join(bloqueada, bloqueada.id == TaskDependency.blocked_task_id).filter(
        TaskDependency.blocker_task_id.in_(ids),
        bloqueada.deleted_at.is_(None),
    ).group_by(TaskDependency.blocker_task_id).all()

    etiquetas = {}
    for task_id, etiqueta in filas_etiqueta:
        etiquetas.setdefault(task_id, []).append(etiqueta.to_dict())
    bloqueos = {tid: int(n or 0) for tid, n in filas_bloqueo}
    bloquea = {tid: int(n or 0) for tid, n in filas_bloquea}

    return {
        tid: {
            'tags': etiquetas.get(tid, []),
            'blocked_by_open': bloqueos.get(tid, 0),
            'blocks_count': bloquea.get(tid, 0),
        }
        for tid in ids
    }


# ─────────────────────────────────────────────────────────────
# Dependencias
# ─────────────────────────────────────────────────────────────

def crearia_ciclo(blocker_id, blocked_id):
    """True si 'blocker antes que blocked' cerraria un circulo.

    Lo cierra si blocked ya va, directa o indirectamente, antes que blocker.
    Se recorre hacia delante desde blocked por niveles, una consulta por nivel.
    Las cadenas reales son cortas; el tope evita que un grafo raro cuelgue la
    peticion.
    """
    if blocker_id == blocked_id:
        return True
    vistas = {blocked_id}
    frontera = {blocked_id}
    for _nivel in range(50):
        if not frontera:
            return False
        siguientes = {
            fila[0] for fila in db.session.query(TaskDependency.blocked_task_id).filter(
                TaskDependency.blocker_task_id.in_(frontera),
            ).all()
        }
        if blocker_id in siguientes:
            return True
        frontera = siguientes - vistas
        vistas |= frontera
    # Mas de cincuenta niveles no es una cadena de trabajo: se rechaza por si acaso.
    return True


def bloqueadoras_abiertas(task_id):
    """Tareas abiertas que todavia tienen que cerrarse antes que esta."""
    return Task.active_query().join(
        TaskDependency, TaskDependency.blocker_task_id == Task.id,
    ).filter(
        TaskDependency.blocked_task_id == task_id,
        ~Task.status.in_(estados_finales()),
    ).order_by(Task.due_date.asc()).all()


# ─────────────────────────────────────────────────────────────
# Posiciones
# ─────────────────────────────────────────────────────────────

def posicion_entre(anterior, siguiente):
    """Posicion para una tarjeta soltada entre dos (cualquiera puede faltar).

    None en una de las dos significa principio o final de la columna. Si las dos
    tienen la misma posicion —tarjetas nunca colocadas, o el hueco agotado— el
    resultado no cabe entre ellas, y quien llama debe renumerar la columna.
    """
    if anterior is None and siguiente is None:
        return PASO_DE_POSICION
    if anterior is None:
        return siguiente - PASO_DE_POSICION
    if siguiente is None:
        return anterior + PASO_DE_POSICION
    return (anterior + siguiente) / 2.0


def hay_hueco(anterior, siguiente, posicion):
    """Si la posicion calculada queda estrictamente entre sus vecinas."""
    if anterior is not None and not posicion > anterior:
        return False
    if siguiente is not None and not posicion < siguiente:
        return False
    return True


def posiciones_renumeradas(cuantas):
    """Posiciones con hueco completo para una columna de ese tamano, en orden."""
    return [indice * PASO_DE_POSICION for indice in range(1, cuantas + 1)]
