import os
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Base de datos
db = SQLAlchemy()

# Gestión de sesiones
login_manager = LoginManager()
login_manager.login_view = 'auth.login'  # Redirige a esta ruta si no estás logueado
login_manager.login_message = "Debes iniciar sesión para acceder a esta página."
login_manager.login_message_category = "warning"

# CSRF Protection
csrf = CSRFProtect()

# Rate Limiting (global, initialized in app.py via limiter.init_app)
_global_limit = os.getenv("GLOBAL_RATE_LIMIT", "").strip()
_default_limits = [_global_limit] if _global_limit else []

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=_default_limits,
    storage_uri=os.getenv("RATELIMIT_STORAGE_URI") or os.getenv("REDIS_URL") or "memory://",
)
