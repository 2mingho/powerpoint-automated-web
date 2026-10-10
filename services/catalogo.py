"""
services/catalogo.py
--------------------
Estados y prioridades de tarea.

Estaban fijos en models.py y ahora salen de la base. El punto de este modulo no
es leer dos tablas: es que el resto del codigo deje de razonar con nombres.

    estados_validos()      para validar lo que llega
    es_estado_final(x)     para saber si una tarea sigue abierta
    filtro_abiertas(q)     para no repetir esa condicion en cada consulta

"Completado" no es una etiqueta, es una condicion: decide si una tarea cuenta
como abierta, si esta vencida y si entra en la carga de alguien. Mientras el
codigo compare contra el texto, renombrarlo rompe todo eso en silencio.
"""
from datetime import datetime

from flask import g, has_request_context

from extensions import db
from models import TaskStatus, TaskPriority


# Si la tabla todavia no existe —una base anterior a la revision 0007— se cae a
# estos valores en vez de reventar. Son los que el codigo tenia escritos.
_ESTADOS_RESPALDO = ('Pendiente', 'En Progreso', 'Bloqueado', 'En Revisión', 'Completado')
_FINALES_RESPALDO = ('Completado',)
_PRIORIDADES_RESPALDO = ('Alta', 'Media', 'Baja')

_CLAVE_CACHE = '_catalogo_tareas'


def _cache():
    if not has_request_context():
        return None
    memoria = getattr(g, _CLAVE_CACHE, None)
    if memoria is None:
        memoria = {}
        setattr(g, _CLAVE_CACHE, memoria)
    return memoria


def invalidar_cache_catalogo():
    """Olvida lo memorizado en esta peticion.

    La pantalla que edita el catalogo lo consulta despues de cambiarlo; sin
    esto mostraria la lista anterior al cambio que acaba de hacer.
    """
    if has_request_context():
        setattr(g, _CLAVE_CACHE, {})


def _leer(clave, consulta, respaldo):
    memoria = _cache()
    if memoria is not None and clave in memoria:
        return memoria[clave]

    try:
        valor = consulta()
    except Exception:
        valor = respaldo

    if memoria is not None:
        memoria[clave] = valor
    return valor


# ─────────────────────────────────────────────────────────────
# Estados
# ─────────────────────────────────────────────────────────────

def estados():
    """Todos los estados, del primero al ultimo del flujo."""
    return _leer(
        'estados',
        lambda: TaskStatus.query.order_by(TaskStatus.orden, TaskStatus.nombre).all(),
        [],
    )


def estados_validos():
    """Nombres aceptables para tasks.status."""
    lista = [e.nombre for e in estados()]
    return tuple(lista) if lista else _ESTADOS_RESPALDO


def estados_finales():
    """Los que significan que la tarea ya no esta abierta."""
    lista = [e.nombre for e in estados() if e.es_final]
    return tuple(lista) if lista else _FINALES_RESPALDO


def es_estado_final(nombre):
    return nombre in estados_finales()


def aplicar_estado(task, nuevo):
    """Cambia el estado de una tarea y mantiene sus marcas de cierre, igual que la app web.

    Cerrar fija done_at (la fecha real de cierre, base de la puntualidad) y borra
    el motivo de bloqueo; reabrir quita done_at. Moverse entre estados abiertos, o
    entre cerrados, no toca nada: no se pierde la fecha de cierre.
    """
    finales = estados_finales()
    previo_final = task.status in finales
    nuevo_final = nuevo in finales
    task.status = nuevo
    if not previo_final and nuevo_final:
        task.done_at = datetime.utcnow()
        task.block_reason = None
    elif previo_final and not nuevo_final:
        task.done_at = None


def estado_inicial():
    """Con que estado nace una tarea."""
    for e in estados():
        if e.es_inicial:
            return e.nombre
    validos = estados_validos()
    return validos[0] if validos else 'Pendiente'


def filtro_abiertas(query, columna):
    """Restringe una consulta a las tareas que siguen abiertas.

    Se pasa la columna porque quien llama a veces filtra sobre Task.status y a
    veces sobre una subconsulta.
    """
    finales = estados_finales()
    if not finales:
        return query
    return query.filter(~columna.in_(finales))


# ─────────────────────────────────────────────────────────────
# Prioridades
# ─────────────────────────────────────────────────────────────

def prioridades():
    """De mas urgente a menos."""
    return _leer(
        'prioridades',
        lambda: TaskPriority.query.order_by(TaskPriority.orden.desc(), TaskPriority.nombre).all(),
        [],
    )


def prioridades_validas():
    lista = [p.nombre for p in prioridades()]
    return tuple(lista) if lista else _PRIORIDADES_RESPALDO


def prioridad_por_defecto():
    for p in prioridades():
        if p.es_defecto:
            return p.nombre
    validas = prioridades_validas()
    return validas[len(validas) // 2] if validas else 'Media'


def color_de_prioridad(nombre):
    """Token de color, no un hex: el tema claro y el oscuro los resuelven aparte."""
    for p in prioridades():
        if p.nombre == nombre:
            return p.color
    return 'neutro'


def color_de_estado(nombre):
    for e in estados():
        if e.nombre == nombre:
            return e.color
    return 'neutro'
