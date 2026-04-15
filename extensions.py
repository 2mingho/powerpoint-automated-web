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
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per day", "60 per hour"],
    storage_uri="memory://",
)