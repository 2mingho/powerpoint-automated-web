# init_db.py
import os
import sys
import sqlite3
from app import app
from extensions import db

DB_PATH = os.path.join(os.path.dirname(__file__), 'users.db')

def add_column_if_not_exists(conn, table, column, col_type):
    cursor = conn.execute(f"PRAGMA table_info({table})")
    columns = [row[1] for row in cursor.fetchall()]
    if column not in columns:
        print(f"➕ Agregando columna '{column}' a la tabla '{table}'...")
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
    else:
        print(f"✔️  La columna '{column}' ya existe en la tabla '{table}'.")

def recreate_database():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print("🗑️  Base de datos anterior eliminada.")

    with app.app_context():
        db.create_all()
        print("✅ Nueva base de datos creada correctamente como 'users.db'")

def update_structure_if_needed():
    print("⚠️  La base de datos ya existe. Verificando estructura...")
    conn = sqlite3.connect(DB_PATH)
    add_column_if_not_exists(conn, "reports", "title", "TEXT")
    add_column_if_not_exists(conn, "reports", "description", "TEXT")
    add_column_if_not_exists(conn, "reports", "template_name", "TEXT")  # ← NUEVO
    conn.commit()
    conn.close()
    print("✅ Verificación de estructura completada.")

# ─────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if '--reset' in sys.argv:
        recreate_database()
    elif not os.path.exists(DB_PATH):
        recreate_database()
    else:
        update_structure_if_needed()