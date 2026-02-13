# init_db.py
import os
import sys
import sqlite3
from werkzeug.security import generate_password_hash
from dotenv import load_dotenv

load_dotenv()

# Import app context lazily to avoid circular imports at module level
DB_PATH = os.path.join(os.path.dirname(__file__), 'instance', 'users.db')
# Fallback: some setups place the DB at root level
if not os.path.exists(os.path.dirname(DB_PATH)):
    DB_PATH = os.path.join(os.path.dirname(__file__), 'users.db')


def add_column_if_not_exists(conn, table, column, col_type):
    cursor = conn.execute(f"PRAGMA table_info({table})")
    columns = [row[1] for row in cursor.fetchall()]
    if column not in columns:
        print(f"[+] Agregando columna '{column}' a la tabla '{table}'...")
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
    else:
        print(f"[ok] La columna '{column}' ya existe en la tabla '{table}'.")


def create_table_if_not_exists(conn, table_name, create_sql):
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,)
    )
    if cursor.fetchone() is None:
        print(f"[+] Creando tabla '{table_name}'...")
        conn.execute(create_sql)
    else:
        print(f"[ok] La tabla '{table_name}' ya existe.")


def recreate_database():
    from app import app
    from extensions import db

    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print("[!] Base de datos anterior eliminada.")

    with app.app_context():
        db.create_all()
        print("[ok] Nueva base de datos creada correctamente como 'users.db'")
        seed_admin(app)


def update_structure_if_needed():
    print("[!] La base de datos ya existe. Verificando estructura...")

    # Determine actual DB path
    db_path = DB_PATH
    if not os.path.exists(db_path):
        db_path = os.path.join(os.path.dirname(__file__), 'users.db')
    if not os.path.exists(db_path):
        db_path = os.path.join(os.path.dirname(__file__), 'instance', 'users.db')

    conn = sqlite3.connect(db_path)

    # Existing columns
    add_column_if_not_exists(conn, "reports", "title", "TEXT")
    add_column_if_not_exists(conn, "reports", "description", "TEXT")
    add_column_if_not_exists(conn, "reports", "template_name", "TEXT")

    # New admin columns
    add_column_if_not_exists(conn, "users", "role", "TEXT DEFAULT 'DI'")
    add_column_if_not_exists(conn, "users", "is_active", "BOOLEAN DEFAULT 1")
    add_column_if_not_exists(conn, "users", "created_at", "DATETIME")
    add_column_if_not_exists(conn, "users", "allowed_tools", "TEXT")

    # Activity logs table
    create_table_if_not_exists(conn, "activity_logs", """
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            action VARCHAR(100) NOT NULL,
            detail TEXT,
            ip_address VARCHAR(45),
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # Create index on timestamp for faster queries
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS ix_activity_logs_timestamp ON activity_logs(timestamp)")
    except Exception:
        pass

    conn.commit()
    conn.close()
    print("[ok] Verificacion de estructura completada.")


def seed_admin(app=None):
    """Create a default admin user if none exists."""
    if app is None:
        from app import app

    admin_email = os.environ.get('ADMIN_EMAIL', 'admin@dataintel.com')
    admin_password = os.environ.get('ADMIN_PASSWORD', 'Admin2024!')
    admin_username = os.environ.get('ADMIN_USERNAME', 'admin')

    with app.app_context():
        from models import User
        from extensions import db

        existing_admin = User.query.filter_by(role='admin').first()
        if existing_admin:
            print(f"[ok] Ya existe un administrador: {existing_admin.username} ({existing_admin.email})")
            return

        admin_user = User(
            username=admin_username,
            email=admin_email,
            password=generate_password_hash(admin_password, method='pbkdf2:sha256'),
            role='admin',
            is_active=True,
        )
        db.session.add(admin_user)
        db.session.commit()
        print(f"[ADMIN] Admin creado: {admin_username} ({admin_email})")


# ---------------------------------------------------------------

if __name__ == '__main__':
    if '--reset' in sys.argv:
        recreate_database()
    elif '--seed-admin' in sys.argv:
        from app import app
        seed_admin(app)
    else:
        # Determine if DB exists at either location
        root_db = os.path.join(os.path.dirname(__file__), 'users.db')
        instance_db = os.path.join(os.path.dirname(__file__), 'instance', 'users.db')
        if not os.path.exists(root_db) and not os.path.exists(instance_db):
            recreate_database()
        else:
            update_structure_if_needed()
            # Also seed admin if no admin exists
            from app import app
            seed_admin(app)