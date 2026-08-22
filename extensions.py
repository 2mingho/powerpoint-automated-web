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

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per day", "60 per hour"],
    storage_uri=_RATELIMIT_STORAGE_URI,
)