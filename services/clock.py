"""
services/clock.py
-----------------
Fecha y hora de negocio.

El contenedor corre en UTC. Usar `date.today()` para decidir si una tarea esta
vencida significa que, para un equipo en Republica Dominicana (UTC-4), toda
tarea que vence hoy pasa a contar como vencida a partir de las 20:00 hora local,
y las notificaciones de vencimiento se disparan cuatro horas antes de tiempo.

Todo lo que dependa de "que dia es hoy" para el usuario debe pasar por aqui.
"""
import os
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python < 3.9
    ZoneInfo = None


DEFAULT_TZ = 'America/Santo_Domingo'


def _resolve_tz():
    name = os.environ.get('APP_TZ', DEFAULT_TZ)
    if ZoneInfo is None:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except Exception:
        # Una zona mal escrita no debe tumbar la aplicacion; UTC es el
        # comportamiento anterior, asi que degradamos a el.
        return timezone.utc


APP_TIMEZONE = _resolve_tz()


def now_local():
    """Instante actual en la zona horaria de negocio."""
    return datetime.now(APP_TIMEZONE)


def today_local():
    """El dia de hoy segun el reloj del equipo, no el del servidor."""
    return now_local().date()


def current_year():
    """Ano en curso segun la zona de negocio."""
    return today_local().year
