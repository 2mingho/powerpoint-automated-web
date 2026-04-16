import os
import sys
from dotenv import load_dotenv
from sqlalchemy import inspect, text
from werkzeug.security import generate_password_hash

load_dotenv()


def _load_app():
    from app import app
    return app


def _is_sqlite_url(url):
    return str(url).startswith('sqlite')


def seed_admin(app):
    """Create default admin if none exists."""
    from models import User
    from extensions import db

    admin_email = os.environ.get('ADMIN_EMAIL', 'admin@dataintel.com')
    admin_password = os.environ.get('ADMIN_PASSWORD', 'Admin2024!')
    admin_username = os.environ.get('ADMIN_USERNAME', 'admin')

    with app.app_context():
        existing_admin = User.query.filter_by(role='admin').first()
        if existing_admin:
            print(f"[ok] Admin exists: {existing_admin.username} ({existing_admin.email})")
            return

        admin_user = User(
            username=admin_username,
            email=admin_email,
            password=generate_password_hash(admin_password, method='scrypt'),
            role='admin',
            is_active=True,
        )
        db.session.add(admin_user)
        db.session.commit()
        print(f"[ADMIN] Admin created: {admin_username} ({admin_email})")


def ensure_schema(app):
    """Create missing tables and run lightweight column migrations."""
    from extensions import db

    with app.app_context():
        db.create_all()

        insp = inspect(db.engine)
        tables = set(insp.get_table_names())

        if 'reports' in tables:
            report_cols = {c['name'] for c in insp.get_columns('reports')}
            if 'template_name' not in report_cols:
                try:
                    db.session.execute(text("ALTER TABLE reports ADD COLUMN template_name TEXT"))
                    db.session.commit()
                    print("[migration] Added reports.template_name")
                except Exception as e:
                    db.session.rollback()
                    print(f"[migration] Warning adding reports.template_name: {e}")

        if 'users' in tables:
            user_cols = {c['name'] for c in insp.get_columns('users')}
            new_user_cols = {
                'session_token': 'VARCHAR(64)',
                'force_logout': 'BOOLEAN DEFAULT 0',
                'area_id': 'INTEGER REFERENCES areas(id)',
            }
            for col_name, col_type in new_user_cols.items():
                if col_name not in user_cols:
                    try:
                        db.session.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"))
                        db.session.commit()
                        print(f"[migration] Added users.{col_name}")
                    except Exception as e:
                        db.session.rollback()
                        print(f"[migration] Warning adding users.{col_name}: {e}")

        if 'tasks' in tables:
            task_cols = {c['name'] for c in insp.get_columns('tasks')}
            new_task_cols = {
                'start_date': 'DATE',
                'end_date': 'DATE',
                'directorate': 'VARCHAR(255)',
                'requested_by': 'VARCHAR(255)',
                'budget_type': 'VARCHAR(255)',
            }
            for col_name, col_type in new_task_cols.items():
                if col_name not in task_cols:
                    try:
                        db.session.execute(text(f"ALTER TABLE tasks ADD COLUMN {col_name} {col_type}"))
                        db.session.commit()
                        print(f"[migration] Added tasks.{col_name}")
                    except Exception as e:
                        db.session.rollback()
                        print(f"[migration] Warning adding tasks.{col_name}: {e}")

        seed_admin(app)
        print(f"[ok] Schema ensured on: {db.engine.url.render_as_string(hide_password=True)}")


def reset_sqlite_database(app):
    """Drop local SQLite file and recreate schema. Not for Postgres."""
    from extensions import db

    with app.app_context():
        if not _is_sqlite_url(db.engine.url):
            print("[warn] --reset is only supported for SQLite databases.")
            return

        sqlite_path = db.engine.url.database
        if sqlite_path and os.path.exists(sqlite_path):
            os.remove(sqlite_path)
            print(f"[!] Removed SQLite file: {sqlite_path}")

        db.create_all()
        print("[ok] SQLite database recreated.")

    seed_admin(app)


if __name__ == '__main__':
    app = _load_app()

    if '--reset' in sys.argv:
        reset_sqlite_database(app)
    elif '--seed-admin' in sys.argv:
        seed_admin(app)
    else:
        ensure_schema(app)
