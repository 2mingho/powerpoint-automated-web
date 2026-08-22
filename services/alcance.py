"""
services/alcance.py
-------------------
Quien ve que unidades.

Un solo sitio donde se decide el alcance de alguien. Es la pieza que evita que
la regla quede repartida por los cuarenta puntos que hoy la calculan a mano:
mientras se resuelva en cuarenta sitios, basta que uno se quede atras para que
alguien vea una unidad que no lidera.

El modelo de la empresa tiene tres papeles, y ninguno se guarda en una columna:

    empleado   sin filas en unit_leads y sin nadie a cargo
    manager    con al menos una fila en unit_leads
    director   con managers por debajo en la cadena de mando

Deducirlos evita que la etiqueta y los datos se contradigan: alguien marcado
director sin nadie a cargo, o un manager al que se le retira la unidad y
conserva el cargo.
"""
from collections import defaultdict

from flask import g, has_request_context

from extensions import db
from models import Area, User, UnitLead


_CLAVE_CACHE = '_alcance_por_usuario'


def personas_a_cargo(user):
    """El usuario y todo lo que cuelga de el en la cadena de mando.

    Devuelve identificadores, no objetos: lo unico que se necesita despues es
    cruzarlos con unit_leads.
    """
    if user is None:
        return set()

    reportes = defaultdict(list)
    for uid, jefe in db.session.query(User.id, User.manager_id).all():
        if jefe is not None:
            reportes[jefe].append(uid)

    dentro = set()
    pila = [user.id]
    while pila:
        actual = pila.pop()
        # Corta ciclos. No deberian existir, pero un ciclo aqui no es un dato
        # raro: es un bucle infinito en cada peticion.
        if actual in dentro:
            continue
        dentro.add(actual)
        pila.extend(reportes[actual])

    return dentro


def alcance_unidades(user, usar_cache=True):
    """Unidades que lidera el usuario o cualquiera a su cargo.

    Cierra en falso a proposito: sin liderazgo devuelve el conjunto vacio, y un
    conjunto vacio tiene que producir cero filas, nunca todas. Quien consuma
    esto debe filtrar con `Task.area_id.in_(alcance)` y no saltarse el filtro
    cuando venga vacio.
    """
    if user is None or not getattr(user, 'is_authenticated', True):
        return set()

    cache = _cache_de_peticion() if usar_cache else None
    if cache is not None and user.id in cache:
        return cache[user.id]

    if getattr(user, 'is_admin', False):
        alcance = {fila.id for fila in db.session.query(Area.id).all()}
    else:
        filas = db.session.query(UnitLead.area_id).filter(
            UnitLead.user_id.in_(personas_a_cargo(user))
        ).all()
        alcance = {fila.area_id for fila in filas}

    if cache is not None:
        cache[user.id] = alcance
    return alcance


def unidades_lideradas(user):
    """Solo las asignadas directamente, sin herencia.

    Sirve para distinguir a un manager de un director, y para las pantallas de
    administracion. Para decidir que ve alguien se usa alcance_unidades().
    """
    if user is None:
        return set()
    filas = db.session.query(UnitLead.area_id).filter(UnitLead.user_id == user.id).all()
    return {fila.area_id for fila in filas}


def ambito_unidades(user):
    """Unidades con las que el usuario trabaja: la suya mas las que lidera.

    No es lo mismo que alcance_unidades(). El alcance responde "que puedo
    supervisar" y para un empleado es vacio; esto responde "con quien trabajo"
    y para un empleado es su propia unidad. Confundirlos deja a quien no lidera
    nada sin poder asignar una tarea a un companero.

    Un admin alcanza todas, asi que la union no anade nada.
    """
    if user is None:
        return set()

    unidades = set(alcance_unidades(user))
    propia = getattr(user, 'area_id', None)
    if propia is not None:
        unidades.add(propia)
    return unidades


def puede_ver_equipo(user):
    """Si tiene algo de equipo que mirar.

    Sustituye a is_area_lead en las puertas de acceso. La diferencia importa:
    un director no lidera ninguna unidad directamente, asi que el booleano le
    cerraba la puerta antes de que ninguna consulta se ejecutara.
    """
    if user is None:
        return False
    return bool(getattr(user, 'is_admin', False)) or bool(alcance_unidades(user))


def papel(user):
    """El papel deducido: 'admin', 'director', 'manager' o 'empleado'.

    Para mostrar, no para decidir permisos. Los permisos salen de
    alcance_unidades() y puede_ver_equipo().
    """
    if user is None:
        return 'empleado'
    if getattr(user, 'is_admin', False):
        return 'admin'
    if unidades_lideradas(user):
        return 'manager'
    if alcance_unidades(user):
        return 'director'
    return 'empleado'


# ─────────────────────────────────────────────────────────────
# Cache por peticion
# ─────────────────────────────────────────────────────────────
# El alcance se consulta muchas veces en una misma peticion —una por cada punto
# que filtra— y cada llamada recorre la cadena de mando entera. Se memoriza
# mientras dura la peticion y se olvida al terminarla, de modo que un cambio de
# liderazgo se ve en la siguiente.

def _cache_de_peticion():
    if not has_request_context():
        return None
    cache = getattr(g, _CLAVE_CACHE, None)
    if cache is None:
        cache = {}
        setattr(g, _CLAVE_CACHE, cache)
    return cache


def invalidar_cache_alcance():
    """Olvida lo memorizado en esta peticion.

    Hay que llamarla despues de tocar unit_leads o manager_id dentro de la
    misma peticion que luego consulta el alcance: sin esto, la pantalla de
    administracion mostraria el reparto anterior al cambio que acaba de hacer.
    """
    if has_request_context():
        setattr(g, _CLAVE_CACHE, {})
