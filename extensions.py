import os

from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Base de datos
db = SQLAlchemy()

# Migraciones de esquema (Alembic)
migrate = Migrate()

# Gestión de sesiones
login_manager = LoginManager()
login_manager.login_view = 'auth.login'  # Redirige a esta ruta si no estás logueado
login_manager.login_message = "Debes iniciar sesión para acceder a esta página."
login_manager.login_message_category = "warning"

# CSRF Protection
csrf = CSRFProtect()

# Rate Limiting (global, initialized in app.py via limiter.init_app)
#
# SEC-05: "memory://" mantiene el contador dentro de cada proceso, asi que con
# varios workers de Gunicorn el limite efectivo se multiplica por el numero de
# workers. En produccion hay que apuntar RATELIMIT_STORAGE_URI a un backend
# compartido (por ejemplo redis://...); en local memoria es suficiente.
_RATELIMIT_STORAGE_URI = os.environ.get('RATELIMIT_STORAGE_URI', 'memory://')


def _rate_limit_key():
    """Contar por usuario cuando lo hay, y por IP solo si no lo hay.

    Con get_remote_address a secas, una oficina entera detras de una sola IP
    publica comparte un unico contador: veinte personas repartiendose el
    limite de una. Un compañero abriendo tareas dejaba a los demas fuera, y
    el error no dice nada de eso.
    """
    try:
        from flask_login import current_user
        if current_user.is_authenticated:
            return f'user:{current_user.id}'
    except Exception:
        pass
    return get_remote_address()


# Una carga de /tasks son once peticiones contadas (la pagina, sus estaticos y
# cuatro llamadas de API), y las notificaciones sondean cada 90s. Con el limite
# anterior —200/dia y 60/hora— un usuario agotaba la cuota en unas cinco cargas
# y recibia un 429 en mitad de su trabajo.
#
# Esto es proteccion contra abuso anonimo, no el control que protege el login:
# ese lo llevan los limites explicitos de blueprints/auth.py (10/hora para
# registro, 5/minuto para login), que no cambian.
_LIMITE_HORA = os.environ.get('RATELIMIT_PER_HOUR', '600 per hour')
_LIMITE_DIA = os.environ.get('RATELIMIT_PER_DAY', '5000 per day')

limiter = Limiter(
    key_func=_rate_limit_key,
    default_limits=[_LIMITE_DIA, _LIMITE_HORA],
    storage_uri=_RATELIMIT_STORAGE_URI,
)