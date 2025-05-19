import os
import sys
import sqlite3
from app import app
from extensions import db
from models import User
from werkzeug.security import generate_password_hash

DB_PATH = os.path.join(os.path.dirname(__file__), 'users.db')
ADMIN_EMAIL = "admin@admin.com"

def add_column_if_not_exists(conn, table, column, col_type):
    cursor = conn.execute(f"PRAGMA table_info({table})")
    columns = [row[1] for row in cursor.fetchall()]
    if column not in columns:
        print(f"➕ Agregando columna '{column}' a la tabla '{table}'...")
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
    else:
        print(f"✔️  La columna '{column}' ya existe en la tabla '{table}'.")

def crear_usuario_admin():
    print("🔐 Verificando si existe el usuario admin...")
    existing_admin = User.query.filter_by(email=ADMIN_EMAIL).first()
    if existing_admin:
        print("✔️  El usuario admin ya existe. No se modifica.")
        return

    hashed_pw = generate_password_hash("admin123", method='pbkdf2:sha256')
    admin = User(username="admin", email=ADMIN_EMAIL, password=hashed_pw, rol="admin")
    db.session.add(admin)
    db.session.commit()
    print("✅ Usuario admin creado con éxito.")

def actualizar_roles_usuarios():
    print("🛠️  Asignando rol 'user' a usuarios sin rol...")
    usuarios = User.query.filter((User.rol == None) | (User.rol == "")).all()

    for user in usuarios:
        if user.email == ADMIN_EMAIL:
            continue
        print(f"➡️  Usuario {user.email} actualizado a rol 'user'")
        user.rol = "user"

    db.session.commit()
    print("✅ Roles actualizados correctamente.")

def recreate_database():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print("🗑️  Base de datos anterior eliminada.")

    with app.app_context():
        db.create_all()
        print("✅ Nueva base de datos creada correctamente como 'users.db'")
        crear_usuario_admin()

def update_structure_if_needed():
    print("⚠️  La base de datos ya existe. Verificando estructura...")
    conn = sqlite3.connect(DB_PATH)
    add_column_if_not_exists(conn, "users", "rol", "TEXT")
    add_column_if_not_exists(conn, "reports", "title", "TEXT")
    add_column_if_not_exists(conn, "reports", "description", "TEXT")
    conn.commit()
    conn.close()
    print("✅ Verificación de estructura completada.")

# ─────────────────────────────────────────────────────────────

if __name__ == '__main__':
    with app.app_context():
        if '--reset' in sys.argv:
            recreate_database()
        elif not os.path.exists(DB_PATH):
            recreate_database()
        else:
            update_structure_if_needed()

        if '--add-role-to-existing' in sys.argv:
            actualizar_roles_usuarios()