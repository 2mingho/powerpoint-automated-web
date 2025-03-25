import os
from app import app
from extensions import db

DB_PATH = os.path.join(os.path.dirname(__file__), 'users.db')

if os.path.exists(DB_PATH):
    print("⚠️  La base de datos ya existe. No se realizó ningún cambio.")
else:
    with app.app_context():
        db.create_all()
        print("✅ Base de datos creada correctamente como 'users.db'")