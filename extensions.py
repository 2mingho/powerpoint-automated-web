from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager

# Base de datos
db = SQLAlchemy()

# Gestión de sesiones
login_manager = LoginManager()
login_manager.login_view = 'auth.login'  # Redirige a esta ruta si no estás logueado
login_manager.login_message = "Debes iniciar sesión para acceder a esta página."
login_manager.login_message_category = "warning"