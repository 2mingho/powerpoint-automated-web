import os
import io
import pandas as pd
import uuid
import zipfile
import shutil
import json
import threading
import random
from datetime import datetime, timedelta
import functools
import click
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for, abort, after_this_request, flash, session
from flask_login import current_user, login_required
from services.classifier import classify_mentions
from services.file_loader import detect_format, read_full_as_tsv
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash
from babel.dates import format_datetime
from sqlalchemy import inspect, text, event
from dotenv import load_dotenv
from flask_talisman import Talisman
from werkzeug.exceptions import HTTPException

from blueprints.auth import auth
from blueprints.admin import admin_bp, log_activity
from blueprints.notifications import notifications_bp
from blueprints.tasks import tasks_bp
from blueprints.task_requests import task_requests_bp
from blueprints.tour import tour_bp


from extensions import db, login_manager, csrf, limiter, migrate
from models import User, Report, ActivityLog, ClassificationPreset, Task, TempArtifact
from services import calculation as report
from services import meltwater_ingest
from services.groq_analysis import construir_prompt, llamar_groq, extraer_json, formatear_analisis_social_listening
# El reporte se renderiza en la web y se exporta a PDF desde el navegador.
from services.csv_analysis import analyze_csv, generate_summary_csv

# Load environment variables
load_dotenv()


def _env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {'1', 'true', 'yes', 'on'}


def _env_int(name, default):
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _env_float(name, default):
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def _resolve_database_uri():
    uri = os.environ.get('DATABASE_URL') or os.environ.get('SQLALCHEMY_DATABASE_URI')
    if uri:
        if uri.startswith('postgres://'):
            return 'postgresql://' + uri[len('postgres://'):]
        return uri
    return 'sqlite:///users.db'


def _is_remote_database():
    """True si la base no es un SQLite local (es decir, vive en otro servidor)."""
    return not app.config['SQLALCHEMY_DATABASE_URI'].startswith('sqlite')


def _startup_db_writes_allowed():
    """
    Si el arranque puede escribir en la base.

    Prohibido cuando una maquina de desarrollo apunta a una base remota: ahi
    la base es, casi con seguridad, la de produccion. El arranque no solo crea
    tablas, tambien PODA (borra logs de actividad, metadatos de reportes y
    tareas con borrado logico). Ejecutar eso contra produccion por haber
    exportado una DATABASE_URL seria destructivo y silencioso.
    """
    if _is_production_mode():
        return True
    return not _is_remote_database()


def _is_production_mode():
    return (
        os.environ.get('FLASK_ENV') == 'production'
        or _env_bool('RENDER', False)
        or _env_bool('FORCE_PRODUCTION_MODE', False)
    )


app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'scratch'

# Security configuration
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
if not app.config['SECRET_KEY']:
    raise RuntimeError("SECRET_KEY must be set in .env file. Generate one with: python -c 'import secrets; print(secrets.token_hex(32))'")

app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024  # 200 MB upload limit
app.config['SQLALCHEMY_DATABASE_URI'] = _resolve_database_uri()
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# OPS-02: en produccion el contenedor es efimero. Arrancar con SQLite ahi
# significa perder usuarios, tareas y notificaciones en cada redespliegue,
# y en silencio. Preferimos fallar el arranque.
if _is_production_mode() and app.config['SQLALCHEMY_DATABASE_URI'].startswith('sqlite'):
    raise RuntimeError(
        "Startup blocked: la aplicacion esta en modo produccion pero apunta a SQLite "
        f"({app.config['SQLALCHEMY_DATABASE_URI']}). El almacenamiento del contenedor es "
        "efimero y los datos se perderian en el proximo despliegue. Define DATABASE_URL "
        "con la cadena de conexion de PostgreSQL."
    )
app.config['ALLOW_SELF_REGISTRATION'] = _env_bool('ALLOW_SELF_REGISTRATION', False)

if app.config['SQLALCHEMY_DATABASE_URI'].startswith('postgresql://'):
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
    }

# Session security
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=8)
# Only set Secure cookie when not in debug/local mode
if _is_production_mode():
    app.config['SESSION_COOKIE_SECURE'] = True

# ─────────────────────────────────────────────────────────────
# Initialize extensions
# ─────────────────────────────────────────────────────────────
db.init_app(app)
migrate.init_app(app, db)
login_manager.init_app(app)
csrf.init_app(app)
limiter.init_app(app)

# SEC-05 (continuacion). El contador de flask-limiter con "memory://" vive
# dentro de cada proceso, asi que con N workers de Gunicorn cada limite se
# multiplica por N: los 5 intentos de login por minuto se convierten en 5*N y
# la proteccion se diluye sin que nada lo diga. Antes esto solo estaba
# advertido en un comentario, que es exactamente donde no se lee el dia que
# alguien sube WEB_CONCURRENCY para aguantar carga.
#
# Se falla el arranque, igual que con SQLite en produccion y con la contrasena
# de admin por defecto: la aplicacion no se queda a medio proteger en silencio.
_WORKERS = _env_int('WEB_CONCURRENCY', 1)
if (_is_production_mode() and _WORKERS > 1
        and os.environ.get('RATELIMIT_STORAGE_URI', 'memory://').startswith('memory://')):
    raise RuntimeError(
        f"Startup blocked: WEB_CONCURRENCY={_WORKERS} con RATELIMIT_STORAGE_URI en memoria. "
        "Cada worker llevaria su propio contador y el limite de intentos de login se "
        "multiplicaria por el numero de workers. Define RATELIMIT_STORAGE_URI con un "
        "backend compartido (redis://...) o deja WEB_CONCURRENCY en 1."
    )

# Un CSS y un JS no son trafico que haya que limitar, pero contaban igual: solo
# entre esos dos, cada carga de /tasks gastaba dos peticiones de la cuota.
limiter.exempt(app.view_functions['static'])

# SEC-05: detras de un proxy inverso (Render, nginx) request.remote_addr es la
# IP del proxy, no la del cliente. Sin esto el limite de 5 intentos de login por
# minuto se aplica a todos los usuarios en conjunto: un atacante podria bloquear
# el acceso de toda la organizacion, y el limite deja de distinguir atacantes.
# Solo se confia en las cabeceras cuando hay un proxy delante de verdad.
if _is_production_mode():
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_for=_env_int('PROXY_COUNT', 1),
        x_proto=_env_int('PROXY_COUNT', 1),
        x_host=_env_int('PROXY_COUNT', 1),
    )

# Security headers via Talisman (CSP, HSTS, X-Frame-Options)
# Using 'unsafe-inline' for scripts/styles since templates use inline code extensively
# NOTE: Do NOT use content_security_policy_nonce_in — it causes browsers to ignore 'unsafe-inline'
talisman = Talisman(app,
         force_https=_is_production_mode(),
         permissions_policy={
             'camera': '()',
             'geolocation': '()',
             'microphone': '()',
         },
         content_security_policy={
             'default-src': "'self'",
             'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
             'style-src':  ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
             # FullCalendar inyecta su fuente fcicons como data URI.
             'font-src':   ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
             'img-src':    ["'self'", "data:"],
             'connect-src': "'self'",
         })

# SQLite WAL mode for better concurrent access
from sqlalchemy import Engine as _Engine

@event.listens_for(_Engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    import sqlite3
    if isinstance(dbapi_conn, sqlite3.Connection):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        # SQLite ignora las claves foraneas salvo que se le pida lo contrario, y
        # lo hace en silencio. Sin esto, ninguna restriccion se cumple en local
        # ni en las pruebas mientras que en PostgreSQL si: un ON DELETE CASCADE
        # que aqui no dispara deja creer que el modelo se limpia solo.
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

# Registrar blueprints
app.register_blueprint(auth)
app.register_blueprint(admin_bp)
app.register_blueprint(notifications_bp)
app.register_blueprint(tasks_bp)
app.register_blueprint(task_requests_bp)
app.register_blueprint(tour_bp)

# ─────────────────────────────────────────────────────────────
# Force-logout check (session kick feature)
# ─────────────────────────────────────────────────────────────
from flask_login import logout_user

@app.before_request
def check_force_logout():
    """If admin has flagged this user for forced logout, log them out immediately."""
    session_user_id = session.get('_user_id')
    if session_user_id:
        try:
            session_user = db.session.get(User, int(session_user_id))
        except (TypeError, ValueError):
            session_user = None
        if session_user and not session_user.is_active:
            logout_user()
            session.pop('_user_id', None)
            session.pop('_fresh', None)
            flash('Tu cuenta está inactiva. Contacta al administrador.', 'warning')
            return redirect(url_for('auth.login'))

    if current_user.is_authenticated and not current_user.is_active:
        logout_user()
        flash('Tu cuenta está inactiva. Contacta al administrador.', 'warning')
        return redirect(url_for('auth.login'))

    if current_user.is_authenticated and getattr(current_user, 'force_logout', False):
        current_user.force_logout = False
        db.session.commit()
        logout_user()
        flash('Tu sesion ha sido terminada por un administrador.', 'warning')
        return redirect(url_for('auth.login'))

# ─────────────────────────────────────────────────────────────
# Automatic Request Logging (after_request)
# ─────────────────────────────────────────────────────────────

# Endpoints that already log manually — skip auto-log to avoid duplicates
_MANUALLY_LOGGED = {
    'index', 'clasificacion', 'download_file', 'download_classified',
    'clasificacion_finalize', 'analisis_csv', 'auth.login', 'auth.logout',
    'auth.register', 'union_archivos', 'union_detect', 'union_merge',
    'union_download',
}

DEFAULT_ENABLE_PAGE_VIEW_LOGS = not _is_production_mode()
ENABLE_PAGE_VIEW_LOGS = _env_bool('ENABLE_PAGE_VIEW_LOGS', DEFAULT_ENABLE_PAGE_VIEW_LOGS)
PAGE_VIEW_LOG_SAMPLE_RATE = max(0.0, min(1.0, _env_float(
    'PAGE_VIEW_LOG_SAMPLE_RATE',
    1.0 if ENABLE_PAGE_VIEW_LOGS else 0.0,
)))

@app.after_request
def auto_log_request(response):
    """Automatically log successful authenticated GET page-views."""
    if not ENABLE_PAGE_VIEW_LOGS:
        return response
    if PAGE_VIEW_LOG_SAMPLE_RATE <= 0:
        return response
    if PAGE_VIEW_LOG_SAMPLE_RATE < 1.0 and random.random() > PAGE_VIEW_LOG_SAMPLE_RATE:
        return response

    if (current_user.is_authenticated
            and response.status_code < 400
            and request.endpoint
            and not request.endpoint.startswith('static')
            and not request.endpoint.startswith('admin.')
            and request.endpoint not in _MANUALLY_LOGGED
            and not request.is_json
            and request.method == 'GET'):
        try:
            log_activity('page_view', f'{request.method} {request.endpoint}')
        except Exception:
            pass
    return response


if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])


# ✅ NUEVO: aseguramos esquema en la misma DB que usa la app
def ensure_default_admin():
    """Create default admin if none exists (idempotent)."""
    admin_email = os.environ.get('ADMIN_EMAIL', 'admin@dataintel.com')
    admin_password = os.environ.get('ADMIN_PASSWORD', 'Admin2024!')
    admin_username = os.environ.get('ADMIN_USERNAME', 'admin')

    if _is_production_mode() and admin_password == 'Admin2024!':
        raise RuntimeError(
            "Startup blocked: ADMIN_PASSWORD is using insecure default value in production. "
            "Set a strong ADMIN_PASSWORD environment variable."
        )

    existing_admin = User.query.filter_by(role='admin').first()
    if existing_admin:
        return existing_admin

    existing_by_email = User.query.filter_by(email=admin_email).first()
    if existing_by_email:
        if existing_by_email.role != 'admin':
            existing_by_email.role = 'admin'
            existing_by_email.is_active = True
            db.session.commit()
        return existing_by_email

    admin_user = User(
        username=admin_username,
        email=admin_email,
        password=generate_password_hash(admin_password, method='scrypt'),
        role='admin',
        is_active=True,
    )
    db.session.add(admin_user)
    db.session.commit()
    app.logger.info(f"[startup] Admin created: {admin_username} ({admin_email})")
    return admin_user


def ensure_schema():
    """
    Prepara el esquema al arrancar.

    El esquema lo gobierna Alembic (carpeta migrations/). Tres casos:

    1. Modo produccion: no se crea ni altera nada. Aplicar migraciones es un
       paso explicito del despliegue (`flask db upgrade`).
    2. Local sobre SQLite: create_all por comodidad, para que un clon nuevo
       arranque sin ceremonia.
    3. Local apuntando a una base remota: NO se toca nada.

    El tercer caso es el que importa. Sin el, bastaba con exportar la
    DATABASE_URL de produccion en una maquina de desarrollo (sin FLASK_ENV,
    que es lo normal en local) para que el simple hecho de importar la app
    ejecutase create_all() contra la base real, creando tablas a espaldas de
    Alembic. Que no ocurra no puede depender de que alguien recuerde poner
    SKIP_STARTUP_TASKS.
    """
    with app.app_context():
        if not _startup_db_writes_allowed():
            return

        if not _is_production_mode():
            db.create_all()

        ensure_default_admin()


ACTIVITY_LOG_RETENTION_DAYS = max(1, _env_int('ACTIVITY_LOG_RETENTION_DAYS', 90))
ACTIVITY_LOG_MAX_ROWS = max(1000, _env_int('ACTIVITY_LOG_MAX_ROWS', 100000))
REPORT_METADATA_RETENTION_DAYS = max(1, _env_int('REPORT_METADATA_RETENTION_DAYS', 180))
SOFT_DELETED_TASK_RETENTION_DAYS = max(1, _env_int('SOFT_DELETED_TASK_RETENTION_DAYS', 30))


def prune_activity_logs(retention_days=ACTIVITY_LOG_RETENTION_DAYS, max_rows=ACTIVITY_LOG_MAX_ROWS):
    """Prune old activity logs by retention and hard row cap."""
    deleted_by_age = 0
    deleted_by_cap = 0

    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    deleted_by_age = (
        ActivityLog.query
        .filter(ActivityLog.timestamp < cutoff)
        .delete(synchronize_session=False)
    )
    db.session.commit()

    total_rows = ActivityLog.query.count()
    overflow = max(0, total_rows - max_rows)
    if overflow > 0:
        ids_to_delete = [
            row.id
            for row in (
                ActivityLog.query
                .with_entities(ActivityLog.id)
                .order_by(ActivityLog.timestamp.asc())
                .limit(overflow)
                .all()
            )
        ]
        if ids_to_delete:
            deleted_by_cap = (
                ActivityLog.query
                .filter(ActivityLog.id.in_(ids_to_delete))
                .delete(synchronize_session=False)
            )
            db.session.commit()

    return {
        'deleted_by_age': deleted_by_age,
        'deleted_by_cap': deleted_by_cap,
        'remaining_rows': ActivityLog.query.count(),
    }


def prune_report_metadata(retention_days=REPORT_METADATA_RETENTION_DAYS):
    """Limpia las filas que solo eran metadatos de un fichero que ya no existe.

    Esta poda nacio cuando la fila describia un .pptx en disco: borrarla a los
    180 dias no perdia nada porque el fichero se habia ido mucho antes. Desde
    que el reporte se guarda entero, la fila YA NO es un metadato: es el
    trabajo del analista, con sus textos reescritos a mano.

    Por eso solo se barre lo que no tiene contenido. Borrar reportes de verdad
    puede ser razonable, pero es una decision de retencion de datos del cliente
    que alguien tiene que tomar a proposito, no algo que se herede de una
    funcion que antes borraba nombres de fichero.
    """
    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    deleted = (
        Report.query
        .filter(Report.created_at < cutoff)
        .filter(Report.context_json.is_(None))
        .delete(synchronize_session=False)
    )
    db.session.commit()
    return {'deleted_rows': deleted}


def prune_soft_deleted_tasks(retention_days=SOFT_DELETED_TASK_RETENTION_DAYS):
    """Hard-delete tasks that were soft-deleted before retention cutoff."""
    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    deleted = (
        Task.query
        .filter(Task.deleted_at.isnot(None), Task.deleted_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.session.commit()
    return {'deleted_rows': deleted, 'retention_days': retention_days}


def _scratch_root_abs():
    return os.path.abspath(app.config['UPLOAD_FOLDER'])


def _scratch_path(filename):
    return os.path.join(app.config['UPLOAD_FOLDER'], filename)


def _register_temp_artifact(kind, file_id, storage_name, user_id=None):
    """Create/update ownership metadata for temporary downloadable files."""
    safe_file_id = secure_filename(file_id)
    if not safe_file_id:
        raise ValueError('file_id invalido')

    owner_id = user_id or current_user.id
    artifact = TempArtifact.query.filter_by(kind=kind, file_id=safe_file_id).first()
    if artifact is None:
        artifact = TempArtifact(
            kind=kind,
            file_id=safe_file_id,
            storage_name=storage_name,
            user_id=owner_id,
        )
        db.session.add(artifact)
    else:
        artifact.storage_name = storage_name
        artifact.user_id = owner_id

    db.session.commit()
    return artifact


def _get_owned_artifact_or_403(kind, file_id):
    """Load artifact metadata and enforce owner-or-admin access."""
    safe_file_id = secure_filename(file_id)
    artifact = TempArtifact.query.filter_by(kind=kind, file_id=safe_file_id).first()
    if artifact is None:
        abort(404)
    if not current_user.is_admin and artifact.user_id != current_user.id:
        abort(403)
    return artifact


def prune_database_storage():
    """Run all DB pruning tasks and return stats."""
    logs_stats = prune_activity_logs()
    reports_stats = prune_report_metadata()
    tasks_stats = prune_soft_deleted_tasks()
    return {
        'activity_logs': logs_stats,
        'reports': reports_stats,
        'tasks': tasks_stats,
    }


@app.cli.command('maintenance-prune')
def maintenance_prune_command():
    """Prune DB metadata tables to control storage usage."""
    with app.app_context():
        stats = prune_database_storage()
    click.echo(f"Activity logs pruned: {stats['activity_logs']}")
    click.echo(f"Reports metadata pruned: {stats['reports']}")
    click.echo(f"Soft-deleted tasks pruned: {stats['tasks']}")


@app.cli.command('schema-check')
def schema_check_command():
    """
    Compara la base de datos real contra lo que declara models.py.

    Pensado para decidir con datos, y no a ciegas, que revision de Alembic
    estampar en una base que ya esta en produccion:

      - sin diferencias           -> flask db stamp head
      - solo faltan cosas de 0002 -> flask db stamp 0001_baseline && flask db upgrade
      - falta algo mas            -> revisar antes de tocar nada
    """
    with app.app_context():
        insp = inspect(db.engine)
        live_tables = set(insp.get_table_names())
        expected_tables = set(db.metadata.tables.keys())

        missing_tables = sorted(expected_tables - live_tables)
        extra_tables = sorted(live_tables - expected_tables - {'alembic_version'})

        missing_columns = []
        for table_name in sorted(expected_tables & live_tables):
            live_cols = {c['name'] for c in insp.get_columns(table_name)}
            expected_cols = set(db.metadata.tables[table_name].columns.keys())
            for col in sorted(expected_cols - live_cols):
                missing_columns.append(f'{table_name}.{col}')

        has_alembic = 'alembic_version' in live_tables
        click.echo(f"URL           : {db.engine.url.render_as_string(hide_password=True)}")
        click.echo(f"alembic_version: {'presente' if has_alembic else 'AUSENTE (base sin versionar)'}")
        click.echo(f"Tablas en la base : {len(live_tables)}")
        click.echo(f"Tablas esperadas  : {len(expected_tables)}")

        if missing_tables:
            click.echo(f"\nTablas que faltan ({len(missing_tables)}):")
            for name in missing_tables:
                click.echo(f"  - {name}")
        if missing_columns:
            click.echo(f"\nColumnas que faltan ({len(missing_columns)}):")
            for name in missing_columns:
                click.echo(f"  - {name}")
        if extra_tables:
            click.echo(f"\nTablas presentes que models.py no declara ({len(extra_tables)}):")
            for name in extra_tables:
                click.echo(f"  - {name}")
            click.echo(
                "  Alembic las ignora (include_object en migrations/env.py), asi que\n"
                "  ni el upgrade ni el autogenerate las tocaran. Aparecen aqui porque\n"
                "  significan que hay esquema en uso fuera de este codigo: si alguna\n"
                "  pertenece a la aplicacion, su modelo deberia acabar en models.py."
            )

        # Todo lo que introduce la revision 0002
        delta_tables = {
            'notifications', 'task_comments', 'task_watchers',
            'task_checklist_items', 'task_templates', 'task_requests',
        }
        delta_columns = {
            'users.is_area_lead',
            'activity_logs.entity_type', 'activity_logs.entity_id',
            'tasks.updated_at', 'tasks.priority', 'tasks.visibility',
            'tasks.area_id', 'tasks.deleted_at', 'tasks.deleted_by_id',
        }

        click.echo('')
        if has_alembic:
            click.echo('La base ya esta versionada por Alembic: usa `flask db upgrade`.')
        elif not missing_tables and not missing_columns:
            click.echo('VEREDICTO: el esquema ya esta completo.')
            click.echo('  flask db stamp head')
        elif set(missing_tables) <= delta_tables and set(missing_columns) <= delta_columns:
            click.echo('VEREDICTO: solo falta la revision 0002. Es el caso esperado.')
            click.echo('  flask db stamp 0001_baseline')
            click.echo('  flask db upgrade')
        else:
            click.echo('VEREDICTO: hay deriva fuera de lo que cubre 0002. NO estampes todavia.')
            click.echo('  Revisa la lista de arriba antes de aplicar ninguna migracion.')


def _es_comando_de_migracion():
    """Si este proceso es un `flask db ...` y no un servidor.

    Alembic importa la aplicacion para tener contexto, y al importarla se
    ejecutaban las tareas de arranque: sembrar el admin consulta la tabla
    users. Sobre una base vacia esa consulta falla —todavia no existe ninguna
    tabla— y tumba el propio comando que iba a crearlas, antes de aplicar una
    sola migracion.

    El efecto era que la aplicacion no podia inicializar una base nueva: ni un
    entorno de pruebas, ni un despliegue en limpio, ni restaurar una copia de
    seguridad sobre una base vacia. En la de produccion no se veia porque sus
    tablas ya existian de antes, creadas por create_all en su dia.

    El comentario de mas abajo ya describia esta necesidad, pero dependia de
    que quien lanzara el comando recordase exportar SKIP_STARTUP_TASKS, y el
    entrypoint del contenedor no lo hacia. Deducirlo quita ese requisito.
    """
    import sys
    if len(sys.argv) < 2 or sys.argv[1] != 'db':
        return False

    # Cubre las dos formas de invocarlo: el ejecutable `flask` (lo que usa el
    # contenedor) y `python -m flask` (lo habitual en local y en el CI), donde
    # argv[0] apunta al __main__.py del propio paquete.
    invocacion = sys.argv[0].replace(os.sep, '/')
    return invocacion.endswith('/flask') or invocacion == 'flask' or '/flask/' in invocacion


# Las tareas de arranque (crear esquema, sembrar admin, podar, log de estado)
# se saltan cuando la app se importa solo como contenedor de contexto: los
# comandos `flask db ...` necesitan una app sin efectos secundarios sobre el
# esquema, o el autogenerate compara contra tablas que el propio arranque acaba
# de crear.
SKIP_STARTUP_TASKS = _env_bool('SKIP_STARTUP_TASKS', False) or _es_comando_de_migracion()

if not SKIP_STARTUP_TASKS and not _startup_db_writes_allowed():
    _safe_uri = app.config['SQLALCHEMY_DATABASE_URI']
    app.logger.warning(
        "[startup] Apuntando a una base remota (%s) fuera de modo produccion. "
        "No se crea esquema, no se siembra admin y NO se ejecuta la poda de datos. "
        "Para inspeccionarla usa `flask schema-check`; para migrarla, `flask db upgrade`.",
        _safe_uri.split('@')[-1] if '@' in _safe_uri else _safe_uri,
    )

if not SKIP_STARTUP_TASKS:
    ensure_schema()

if (not SKIP_STARTUP_TASKS and _startup_db_writes_allowed()
        and _env_bool('RUN_STARTUP_MAINTENANCE', True)):
    try:
        with app.app_context():
            stats = prune_database_storage()
        app.logger.info(f"[startup] DB pruning completed: {stats}")
    except Exception as e:
        app.logger.warning(f"[startup] DB pruning warning: {e}")

try:
    if SKIP_STARTUP_TASKS:
        raise RuntimeError('startup tasks skipped')
    with app.app_context():
        app.logger.info(f"[startup] Database URL: {db.engine.url.render_as_string(hide_password=True)}")
        app.logger.info(f"[startup] Admin users: {User.query.filter_by(role='admin').count()}")
except Exception as e:
    app.logger.warning(f"[startup] DB diagnostics warning: {e}")


# ─────────────────────────────────────────────────────────────
# Utilidades para plantillas
DEFAULT_TEMPLATE_FILENAME = "Reporte_plantilla.pptx"
TEMPLATES_DIR = "powerpoints"


# Una plantilla de 15 MB ya es enorme para un .pptx; el limite existe porque
# el binario viaja entero en cada consulta que lo lea.
MAX_TEMPLATE_BYTES = 15 * 1024 * 1024


def _templates_del_repositorio():
    """Nombres .pptx que vienen en powerpoints/, dentro del repositorio."""
    try:
        return sorted(
            f for f in os.listdir(TEMPLATES_DIR)
            if os.path.isfile(os.path.join(TEMPLATES_DIR, f)) and f.lower().endswith(".pptx")
        )
    except FileNotFoundError:
        return []


def _templates_de_la_base():
    """Nombres de las plantillas subidas desde el panel."""
    from models import PptxTemplate
    try:
        return sorted(t.name for t in PptxTemplate.query.with_entities(PptxTemplate.name).all())
    except Exception:
        # Antes de aplicar 0006 la tabla no existe todavia. Que la aplicacion
        # arranque igual es mas importante que listar plantillas subidas.
        return []


def get_available_templates():
    """Todas las plantillas disponibles: las subidas y las del repositorio.

    Si un nombre coincide gana la subida, para que reemplazar una plantilla del
    repositorio no obligue a un despliegue.
    """
    nombres = set(_templates_del_repositorio()) | set(_templates_de_la_base())
    return sorted(nombres)


def template_path_from_name(template_name):
    """Ruta a una plantilla del repositorio. Evita traversal."""
    safe_name = os.path.basename(template_name)
    return os.path.join(TEMPLATES_DIR, safe_name)


def open_template(template_name):
    """Devuelve algo que python-pptx pueda abrir: bytes en memoria o una ruta.

    La base manda sobre el disco. Presentation() acepta tanto una ruta como un
    objeto de fichero, asi que quien llama no necesita distinguirlos.
    """
    from models import PptxTemplate

    safe_name = os.path.basename(template_name or '')
    if not safe_name:
        raise FileNotFoundError('Plantilla no indicada.')

    try:
        subida = PptxTemplate.query.filter_by(name=safe_name).first()
    except Exception:
        subida = None

    if subida is not None:
        return io.BytesIO(subida.data)

    ruta = template_path_from_name(safe_name)
    if not os.path.isfile(ruta):
        raise FileNotFoundError(f'Plantilla no encontrada: {safe_name}')
    return ruta


def clean_scratch_folder():
    """Clean only old files (>1 hour) to prevent race conditions.
    Runs in a background thread — never blocks user requests."""
    folder = app.config['UPLOAD_FOLDER']
    try:
        import time
        current_time = time.time()
        one_hour_ago = current_time - 3600

        for file in os.listdir(folder):
            # El cerrojo que reparte esta misma limpieza entre los workers vive
            # aqui dentro. Borrarlo no libera nada —el flock va con el
            # descriptor, no con el nombre— pero deja que el siguiente proceso
            # cree otro inodo y se lleve un segundo cerrojo: volverian a barrer
            # dos a la vez, que es justo lo que el cerrojo evita.
            if file == '.limpieza.lock':
                continue
            file_path = os.path.join(folder, file)
            try:
                # Only delete files/folders older than 1 hour
                if os.path.getmtime(file_path) < one_hour_ago:
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path)
            except Exception:
                continue
    except Exception as e:
        app.logger.error(f"Error al limpiar la carpeta scratch: {e}")


def _tomar_cerrojo_de_limpieza():
    """Intenta quedarse con la limpieza para este proceso.

    Gunicorn arranca N workers y cada uno importaba este modulo, asi que salian
    N hilos barriendo la misma carpeta compartida: trabajo repetido y, peor,
    dos procesos borrando el mismo fichero a la vez. El error resultante lo
    tragaba el `except Exception: continue` de clean_scratch_folder, de modo
    que la carrera no se veia por ningun lado.

    El cerrojo es un flock sobre un fichero del propio volumen: lo consigue un
    solo proceso, y el sistema lo suelta solo si ese proceso muere, sin dejar
    un fichero rancio que bloquee la limpieza para siempre. Se guarda el
    descriptor en un global para que el recolector no lo cierre y libere el
    cerrojo por su cuenta.
    """
    global _DESCRIPTOR_CERROJO_LIMPIEZA
    try:
        import fcntl
    except ImportError:
        # Sin flock (Windows) no hay nada que coordinar: en local corre un
        # unico proceso.
        return True

    try:
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        ruta = os.path.join(app.config['UPLOAD_FOLDER'], '.limpieza.lock')
        descriptor = os.open(ruta, os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False

    _DESCRIPTOR_CERROJO_LIMPIEZA = descriptor
    return True


_DESCRIPTOR_CERROJO_LIMPIEZA = None


def _schedule_background_cleanup():
    """Start a background thread that cleans scratch/ every 30 minutes."""
    if not _tomar_cerrojo_de_limpieza():
        return

    def _run():
        while True:
            import time
            time.sleep(1800)  # 30 minutes
            with app.app_context():
                clean_scratch_folder()
    t = threading.Thread(target=_run, daemon=True)
    t.start()

if not SKIP_STARTUP_TASKS:
    _schedule_background_cleanup()


# ─────────────────────────────────────────────────────────────
# Tool access decorator
# ─────────────────────────────────────────────────────────────

def _is_ajax():
    """Return True if the request is an AJAX/fetch call expecting JSON."""
    return (
        request.is_json
        or request.headers.get('X-Requested-With') == 'XMLHttpRequest'
        or 'application/json' in request.headers.get('Accept', '')
        or request.headers.get('Content-Type', '').startswith('multipart')  # FormData fetch
    )


def tool_required(tool_key):
    """Decorator: blocks access if user lacks permission for *tool_key*.
    For AJAX/fetch requests returns JSON errors instead of HTML redirects.
    """
    def wrapper(f):
        @functools.wraps(f)
        def decorated(*args, **kwargs):
            if not current_user.is_authenticated:
                if _is_ajax():
                    from flask import jsonify as _jsonify
                    return _jsonify({"success": False, "error": "Sesion expirada. Por favor recarga la pagina e inicia sesion nuevamente."}), 401
                return redirect(url_for('auth.login'))
            if not current_user.has_tool_access(tool_key):
                if _is_ajax():
                    from flask import jsonify as _jsonify
                    return _jsonify({"success": False, "error": "No tienes permiso para acceder a esta herramienta."}), 403
                flash('No tienes permiso para acceder a esta herramienta.', 'error')
                return redirect(url_for('menu'))
            return f(*args, **kwargs)
        return decorated
    return wrapper


# Inject has_tool_access into templates
@app.context_processor
def inject_tool_access():
    def _has_tool_access(tool_key):
        if current_user.is_authenticated:
            return current_user.has_tool_access(tool_key)
        return False
    def _puede_ver_equipo(user=None):
        # Lo usa la barra lateral para decidir si ensena la entrada del panel.
        # Antes era `current_user.is_admin or current_user.is_area_lead`, que a
        # un director le escondia el menu de un equipo que si puede ver.
        from services.alcance import puede_ver_equipo
        objetivo = user if user is not None else current_user
        if not getattr(objetivo, 'is_authenticated', False):
            return False
        return puede_ver_equipo(objetivo)

    return dict(has_tool_access=_has_tool_access, puede_ver_equipo=_puede_ver_equipo)


@app.route('/menu')
@login_required
def menu():
    return render_template('menu.html')


@app.route('/', methods=['GET'])
@tool_required('reports')
def index():
    return render_template('index.html', slots=meltwater_ingest.slot_fields())


def _parse_unique_authors(crudo):
    """El total de autores lo teclea el analista: no viene en ningún widget.

    Devuelve (valor, error). None sin error significa que no lo indicó, que es
    legítimo: el KPI simplemente no se muestra.
    """
    crudo = (crudo or '').strip().replace('.', '').replace(',', '').replace(' ', '')
    if not crudo:
        return None, None
    if not crudo.isdigit():
        return None, 'La cantidad de autores debe ser un número entero.'
    return int(crudo), None


@app.route('/upload_meltwater', methods=['POST'])
@login_required
@tool_required('reports')
def upload_meltwater():
    """
    Recibe los widgets .xlsx de Meltwater en casillas nombradas, una por tipo.

    Cada archivo se valida contra la casilla en la que se cargó, así un export
    equivocado se señala por su nombre en vez de fallar más adelante.
    """
    modo = 'avanzado' if request.form.get('modo') == 'avanzado' else 'simple'
    titulo = request.form.get('report_title', 'Mi Reporte')
    autores, error_autores = _parse_unique_authors(request.form.get('unique_authors'))
    # Solo llega con texto si el analista activó el interruptor.
    analisis = (request.form.get('meltwater_analysis') or '').strip()

    def volver_al_formulario(errores=None, problemas=None):
        return render_template('index.html',
                               slots=meltwater_ingest.slot_fields(),
                               errores=errores or {},
                               problemas=problemas or [],
                               modo=modo,
                               report_title=titulo,
                               unique_authors=request.form.get('unique_authors', ''),
                               meltwater_analysis=analisis)

    if error_autores:
        flash(error_autores, 'error')
        return volver_al_formulario()

    try:
        if modo == 'avanzado':
            # Una casilla por widget: el usuario decide qué es cada archivo.
            slot_files = {}
            for slot in meltwater_ingest.slot_fields():
                subido = request.files.get(slot['field'])
                if subido and subido.filename:
                    slot_files[slot['key']] = (subido.filename, subido.read())

            if not slot_files:
                flash('Carga al menos un archivo para generar el reporte.', 'error')
                return volver_al_formulario()

            widgets, errores, warnings = meltwater_ingest.load_widget_slots(slot_files)

            # Un archivo en la casilla equivocada se corrige, no se ignora: se
            # devuelve el formulario con el fallo señalado en su casilla.
            if errores:
                flash(f'Revisa {len(errores)} archivo(s): la estructura no es la esperada.', 'error')
                return volver_al_formulario(errores=errores)
        else:
            # Modo por defecto: todo junto, y la app reparte por nombre de hoja.
            sueltos = [f for f in request.files.getlist('widget_files') if f and f.filename]
            if not sueltos:
                flash('Carga al menos un archivo para generar el reporte.', 'error')
                return volver_al_formulario()

            widgets, detectados, problemas, warnings = meltwater_ingest.load_widget_bulk(sueltos)

            # Si nada se reconoció, el formulario explica archivo por archivo.
            if problemas and not widgets:
                flash('No se reconoció ninguno de los archivos.', 'error')
                return volver_al_formulario(problemas=problemas)

            # Con parte reconocida se sigue adelante, pero el reporte avisa de
            # lo que quedó fuera para que no pase inadvertido.
            warnings = problemas + warnings

        if not widgets:
            flash('Ningún archivo válido: no se puede generar el reporte.', 'error')
            return volver_al_formulario()

        parsed = meltwater_ingest.parse_widgets(widgets)

        # Sin IA aqui a proposito. La generacion vivia dentro de esta peticion,
        # con la llamada al modelo en medio y Gunicorn cortando a los 180s: un
        # proveedor lento era un 504, y el 504 se llevaba por delante todo el
        # trabajo. Ahora el reporte se arma con el texto por reglas —que es
        # inmediato y no depende de la red—, se guarda, y la pagina pide los
        # textos del modelo por su cuenta cuando ya se esta viendo.
        report_context = report.create_report_context_from_widgets(
            parsed, report_title=titulo, warnings=warnings, unique_authors=autores,
            meltwater_analysis=analisis, use_ai_insights=False
        )

        guardado = Report(
            token=Report.nuevo_token(),
            title=titulo,
            user_id=current_user.id,
            context_json=json.dumps(report_context, ensure_ascii=False),
            insights_source='reglas',
            insights_status=Report.INSIGHTS_PENDIENTE,
        )
        db.session.add(guardado)
        db.session.commit()

        # Redirect y no render: asi el reporte tiene una URL a la que volver, y
        # recargar deja de reenviar el formulario con los ficheros.
        return redirect(url_for('ver_reporte', token=guardado.token))

    except Exception as e:
        app.logger.error(f"ERROR procesando widgets de Meltwater: {e}")
        flash("No se pudo generar el reporte con esos archivos. "
              "Comprueba que son los export .xlsx de Meltwater sin modificar.", 'error')
        return volver_al_formulario()



# ─────────────────────────────────────────────────────────────
# Un reporte guardado: verlo, editarlo y pedirle los textos al modelo
# ─────────────────────────────────────────────────────────────

def _reporte_por_token(token):
    """El reporte, o 404. Ver exige el enlace; editar exige ser su dueno.

    Se identifica por un token aleatorio y no por el id porque el enlace se
    comparte con companeros: con /reporte/7 cualquiera prueba /reporte/8 y
    averigua cuantos reportes hay y de quien son. El token no es un permiso por
    si solo —sigue haciendo falta sesion y acceso al modulo de reportes—, es lo
    que evita que la URL sea adivinable.
    """
    guardado = Report.query.filter_by(token=token).first()
    if guardado is None:
        abort(404)
    return guardado


def _puede_editar_reporte(guardado):
    return guardado.user_id == current_user.id or current_user.is_admin


def _vista_de_reporte(contexto):
    """Los calculos que la plantilla no debe hacer.

    Viven aqui y no en Jinja para que la plantilla no tenga que hacer
    aritmetica ni protegerse de la division por cero.
    """
    total = contexto['kpis']['total_mentions'] or 1
    return {
        'pct_redes': round(contexto['kpis']['mentions_redes'] / total * 100),
        'pct_prensa': round(contexto['kpis']['mentions_prensa'] / total * 100),
        'top_authors': sorted(
            contexto['content'].get('top_authors', []),
            key=lambda a: a['posts'], reverse=True
        )[:8],
    }


@app.route('/reporte/<token>')
@login_required
@tool_required('reports')
def ver_reporte(token):
    guardado = _reporte_por_token(token)
    contexto = guardado.contexto
    if contexto is None:
        # Filas de la epoca en que esto describia un fichero .pptx.
        flash('Ese reporte se generó con una versión anterior y no se guardó su contenido.', 'error')
        return redirect(url_for('mis_reportes'))

    contexto['insights_source'] = guardado.insights_source or 'reglas'

    return render_template('reporte.html',
                           context=contexto,
                           reporte=guardado,
                           puede_editar=_puede_editar_reporte(guardado),
                           **_vista_de_reporte(contexto))


@app.route('/api/reportes/<token>/insights', methods=['POST'])
@login_required
@tool_required('reports')
@limiter.limit('10 per hour')
def api_reporte_insights(token):
    """Pide los textos al modelo y los guarda.

    Es una peticion aparte de la que sirve la pagina porque el modelo puede
    tardar —o no contestar— y eso no puede costar el reporte. Limitada por hora
    porque cada llamada se paga.
    """
    guardado = _reporte_por_token(token)
    if not _puede_editar_reporte(guardado):
        return jsonify({'success': False, 'error': 'Este reporte no es tuyo.'}), 403

    # Ya se pidieron: no se repite el gasto porque alguien recargue la pagina.
    if guardado.insights_status == Report.INSIGHTS_LISTO:
        return jsonify({'success': True, 'estado': guardado.insights_status,
                        'source': guardado.insights_source,
                        'insights': (json.loads(guardado.context_json).get('insights') or {}),
                        'warnings': (json.loads(guardado.context_json).get('warnings') or [])})

    contexto = json.loads(guardado.context_json or '{}')
    if not contexto:
        return jsonify({'success': False, 'error': 'El reporte no tiene contenido guardado.'}), 400

    meta = report.aplicar_insights_de_ia(contexto)

    if meta.get('ok'):
        guardado.insights_status = Report.INSIGHTS_LISTO
        guardado.insights_source = 'ia'
        guardado.insights_error = None
    else:
        # Que el modelo falle no invalida el reporte: se queda con el texto por
        # reglas, que ya estaba escrito, y se recuerda el motivo para poder
        # ensenarlo en vez de dejar la pagina girando para siempre.
        guardado.insights_status = Report.INSIGHTS_FALLIDO
        guardado.insights_error = meta.get('reason')

    guardado.context_json = json.dumps(contexto, ensure_ascii=False)
    db.session.commit()

    # Lo que el analista ya retoco a mano manda sobre lo que traiga el modelo.
    editados = guardado.slots_editados()
    insights = {k: v for k, v in (contexto.get('insights') or {}).items() if k not in editados}

    return jsonify({
        'success': bool(meta.get('ok')),
        'estado': guardado.insights_status,
        'source': guardado.insights_source,
        'insights': insights,
        'warnings': contexto.get('warnings') or [],
        'error': guardado.insights_error,
    })


@app.route('/api/reportes/<token>/textos', methods=['POST'])
@login_required
@tool_required('reports')
def api_reporte_textos(token):
    """Guarda los retoques del analista.

    Se guardan aparte del contexto y no encima: asi volver a pedirle el texto
    al modelo no pisa lo que ya escribio a mano.
    """
    guardado = _reporte_por_token(token)
    if not _puede_editar_reporte(guardado):
        return jsonify({'success': False, 'error': 'Este reporte no es tuyo.'}), 403

    entrantes = (request.get_json(silent=True) or {}).get('textos')
    if not isinstance(entrantes, dict):
        return jsonify({'success': False, 'error': 'Nada que guardar.'}), 400

    permitidos = set(insight_slots()) | {'client_name'}
    retoques = json.loads(guardado.edits_json) if guardado.edits_json else {}
    for slot, texto in entrantes.items():
        if slot in permitidos and isinstance(texto, str):
            # Un limite generoso: corta un pegado accidental de un documento
            # entero sin estorbar a nadie que escriba de verdad.
            retoques[slot] = texto.strip()[:2000]

    guardado.edits_json = json.dumps(retoques, ensure_ascii=False)
    if 'client_name' in retoques and retoques['client_name']:
        guardado.title = retoques['client_name'][:255]
    db.session.commit()

    return jsonify({'success': True, 'guardados': len(retoques)})


def insight_slots():
    from services.insight_harness import SLOTS
    return list(SLOTS)


@app.route('/download/<path:filename>')
@login_required
def download_file(filename):
    # Path sanitization (S7)
    safe_filename = secure_filename(filename)
    full_path = os.path.join(app.config['UPLOAD_FOLDER'], safe_filename)
    
    # Verify path is within UPLOAD_FOLDER
    if not os.path.abspath(full_path).startswith(os.path.abspath(app.config['UPLOAD_FOLDER'])):
        app.logger.warning(f"Path traversal attempt: {filename}")
        abort(403)
    
    report_row = Report.query.filter_by(filename=safe_filename).first()
    if report_row is None:
        abort(404)

    if not current_user.is_admin and report_row.user_id != current_user.id:
        abort(403)

    if not os.path.exists(full_path):
        abort(404)

    @after_this_request
    def cleanup(response):
        clean_scratch_folder()
        return response

    log_activity('download_report', f'Descarga: {safe_filename}')
    return send_file(full_path, as_attachment=True)


@app.route('/mis-reportes')
@login_required
def mis_reportes():
    user_reports = Report.query.filter_by(user_id=current_user.id).order_by(Report.created_at.desc()).all()
    return render_template('mis_reportes.html', reports=user_reports)


@app.template_filter('fecha_es')
def _filtro_fecha_es(valor):
    """26 de agosto de 2026, 14:50.

    strftime('%B') da el mes en el idioma de la locale del contenedor, que es
    la de C: la lista salia como "26 de August, 2026". El mes se traduce a mano
    porque depender de la locale del sistema hace que el idioma de la interfaz
    cambie con el servidor donde se despliegue.
    """
    if valor is None:
        return ''
    return f"{valor.day} de {report.MESES_ES[valor.month - 1]} de {valor.year}, {valor:%H:%M}"


@app.context_processor
def inject_current_year():
    return {'current_year': datetime.now().year}


@app.route('/error/archivo-invalido')
def error_archivo_invalido():
    return render_template('error.html',
                           title="Archivo inválido",
                           message="El archivo que subiste no es válido o tiene un formato incorrecto.")


@app.route('/clasificacion', methods=['GET', 'POST'])
@tool_required('classification')
def clasificacion():
    if request.method == 'POST':
        # 1. Obtener archivo, reglas y valor por defecto
        file = request.files.get('csv_file')
        rules_str = request.form.get('rules')
        default_val = request.form.get('default_val', 'Sin Clasificar')
        use_keywords = request.form.get('use_keywords') == 'true'
        
        if not file or not rules_str:
            flash("Archivo o reglas no proporcionados.", "error")
            return redirect(url_for('clasificacion'))
        
        try:
            rules = json.loads(rules_str)
        except json.JSONDecodeError:
            flash("Error al procesar las reglas de clasificación.", "error")
            return redirect(url_for('clasificacion'))
            
        # 2. Guardar archivo temporal
        unique_id = str(uuid.uuid4())
        filename = f"{unique_id}_{file.filename}"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        # 3. Clasificar
        try:
            print(f"DEBUG: Iniciando clasificación con default_val='{default_val}', use_keywords={use_keywords}")
            df_classified = classify_mentions(file_path, rules, default_val=default_val, use_keywords=use_keywords)
            
            # 4. Calcular Estadísticas (Distribución e Insights) - Optimized (P2)
            stats = {}
            if df_classified is not None and not df_classified.empty:
                # Vectorized approach: much faster than iterrows()
                grouped = df_classified.groupby(['Categoria', 'Tematica']).size().reset_index(name='count')
                
                for _, row in grouped.iterrows():
                    cat = str(row['Categoria'])
                    tem = str(row['Tematica'])
                    count = row['count']
                    
                    if cat not in stats:
                        stats[cat] = {"total": 0, "tematicas": {}}
                    
                    stats[cat]["total"] += count
                    stats[cat]["tematicas"][tem] = count
            
            # Insights adicionales para el visual
            top_category = "N/A"
            max_val = -1
            for cat, data in stats.items():
                if cat != default_val and data['total'] > max_val:
                    max_val = data['total']
                    top_category = cat

            # 5. Guardar resultado (CSV para descarga)
            output_filename = f"Clasificado_{file.filename}"
            output_path = os.path.join(app.config['UPLOAD_FOLDER'], f"classified_{unique_id}.csv")
            df_classified.to_csv(output_path, sep='\t', encoding='utf-16', index=False)
            _register_temp_artifact('classified', unique_id, f"classified_{unique_id}.csv")

            log_activity('classify_data', f'Clasificación: {file.filename} ({len(df_classified)} filas, {len(stats)} categorías)')
            
            return jsonify({
                "success": True,
                "download_url": url_for('download_classified', file_id=unique_id, original_name=output_filename),
                "stats": stats,
                "total_rows": len(df_classified),
                "insights": {
                    "top_category": top_category,
                    "top_count": max_val if max_val != -1 else 0
                }
            })
            
        except Exception as e:
            app.logger.error(f"Error en clasificación: {e}")
            return jsonify({"success": False, "error": "Error procesando la clasificación. Por favor intenta nuevamente."}), 500
            
    return render_template('clasificacion.html')


# ─────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────
# File format detection
# ─────────────────────────────────────────────────────────────

@app.route('/clasificacion/detect', methods=['POST'])
@tool_required('classification')
def clasificacion_detect():
    """Auto-detect format + return column list and preview rows."""
    file = request.files.get('csv_file')
    if not file:
        return jsonify({'success': False, 'error': 'No se recibio ningun archivo.'}), 400
    try:
        raw = file.read()
        result = detect_format(raw, file.filename)
        if result.get('error'):
            return jsonify({'success': False, 'error': result['error']}), 400
        return jsonify({'success': True,
                        'columns': result['columns'],
                        'preview': result['preview'],
                        'encoding': result.get('encoding'),
                        'sep': result.get('sep'),
                        'file_type': result.get('file_type')})
    except Exception as e:
        app.logger.error(f"Error en detect: {e}")
        return jsonify({'success': False, 'error': 'No se pudo analizar el archivo.'}), 500


# ─────────────────────────────────────────────────────────────
# Full-file upload for chunked classification
# ─────────────────────────────────────────────────────────────

@app.route('/clasificacion/upload', methods=['POST'])
@tool_required('classification')
def clasificacion_upload():
    """
    Receive the full file, read it properly (respecting encoding/sep overrides),
    convert to UTF-8 TSV, store in a session temp file, and return chunk metadata.
    This avoids using the browser's file.text() API which always decodes as UTF-8.
    """
    from services.file_loader import detect_format as _detect_fmt, read_full_as_tsv as _read_tsv

    file = request.files.get('csv_file')
    if not file:
        return jsonify({'success': False, 'error': 'No se recibio ningun archivo.'}), 400

    try:
        raw = file.read()

        # Auto-detect format first
        fmt = _detect_fmt(raw, file.filename)
        if fmt.get('error'):
            return jsonify({'success': False, 'error': fmt['error']}), 400

        # Apply manual overrides if provided
        manual_encoding = (request.form.get('encoding') or '').strip() or None
        manual_sep      = (request.form.get('sep') or '').strip() or None

        if manual_encoding:
            fmt['encoding'] = manual_encoding
        if manual_sep:
            fmt['sep'] = manual_sep

        # Read full file as UTF-8 TSV using the correct encoding/format
        header, body = _read_tsv(raw, fmt)
        if not header:
            return jsonify({'success': False, 'error': 'No se pudo leer el archivo con el formato indicado.'}), 400

        # Count data rows
        data_lines = [l for l in body.split('\n') if l.strip()]
        total_rows = len(data_lines)

        # Store TSV in a session temp file for the chunk endpoint to use
        session_id = uuid.uuid4().hex
        session_file = os.path.join(app.config['UPLOAD_FOLDER'], f"upload_{session_id}.tsv")
        with open(session_file, 'w', encoding='utf-8') as f:
            f.write(header)
            f.write(body)

        # SEC-03: la sesion pertenece a quien la crea. upload_body, chunk y
        # finalize verifican esta propiedad antes de tocar el disco.
        _register_temp_artifact('classify_session', session_id, f"upload_{session_id}.tsv")

        CHUNK_SIZE = 2000
        total_chunks = max(1, -(-total_rows // CHUNK_SIZE))  # ceiling division

        return jsonify({
            'success': True,
            'session_id': session_id,
            'header': header,
            'total_rows': total_rows,
            'total_chunks': total_chunks,
            'chunk_size': CHUNK_SIZE,
        })

    except Exception as e:
        app.logger.error(f"Error en clasificacion/upload: {e}")
        return jsonify({'success': False, 'error': 'Error leyendo el archivo. Verifica el formato y la codificacion.'}), 500


# ─────────────────────────────────────────────────────────────
# Serve TSV body for chunked classification
# ─────────────────────────────────────────────────────────────

@app.route('/clasificacion/upload_body/<session_id>', methods=['GET'])
@tool_required('classification')
def clasificacion_upload_body(session_id):
    """
    Return the body (data rows, no header) of the stored UTF-8 TSV session file
    so the frontend can split it into chunks without touching the raw binary file.
    """
    safe_sid = secure_filename(session_id)
    if not safe_sid or safe_sid != session_id:
        abort(400)
    _get_owned_artifact_or_403('classify_session', safe_sid)  # SEC-03
    session_file = os.path.join(app.config['UPLOAD_FOLDER'], f"upload_{safe_sid}.tsv")
    if not os.path.exists(session_file):
        abort(404)
    try:
        with open(session_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        # First line is the header; return only the body rows
        body = ''.join(lines[1:])
        from flask import Response
        return Response(body, mimetype='text/plain; charset=utf-8')
    except Exception as e:
        app.logger.error(f"Error sirviendo upload_body: {e}")
        abort(500)


# ─────────────────────────────────────────────────────────────
# Classification Presets CRUD
# ─────────────────────────────────────────────────────────────

@app.route('/clasificacion/presets', methods=['GET'])
@tool_required('classification')
def presets_list():
    presets = (ClassificationPreset.query
               .filter_by(user_id=current_user.id)
               .order_by(ClassificationPreset.created_at.desc())
               .all())
    return jsonify([{'id': p.id, 'name': p.name,
                     'created_at': p.created_at.strftime('%d/%m/%Y')} for p in presets])


@app.route('/clasificacion/presets', methods=['POST'])
@tool_required('classification')
def presets_create():
    data = request.get_json(force=True)
    name  = (data.get('name') or '').strip()[:100]
    rules = data.get('rules', [])
    if not name:
        return jsonify({'success': False, 'error': 'El nombre del preset es obligatorio.'}), 400
    try:
        preset = ClassificationPreset(
            user_id=current_user.id,
            name=name,
            rules_json=json.dumps(rules, ensure_ascii=False)
        )
        db.session.add(preset)
        db.session.commit()
        log_activity('preset_create', f'Preset guardado: {name}')
        return jsonify({'success': True, 'id': preset.id, 'name': preset.name})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Error guardando preset: {e}")
        return jsonify({'success': False, 'error': 'No se pudo guardar el preset.'}), 500


@app.route('/clasificacion/presets/<int:preset_id>', methods=['GET'])
@tool_required('classification')
def presets_load(preset_id):
    preset = ClassificationPreset.query.filter_by(id=preset_id, user_id=current_user.id).first()
    if not preset:
        return jsonify({'success': False, 'error': 'Preset no encontrado.'}), 404
    return jsonify({'success': True, 'rules': preset.get_rules(), 'name': preset.name})


@app.route('/clasificacion/presets/<int:preset_id>', methods=['DELETE'])
@tool_required('classification')
def presets_delete(preset_id):
    preset = ClassificationPreset.query.filter_by(id=preset_id, user_id=current_user.id).first()
    if not preset:
        return jsonify({'success': False, 'error': 'Preset no encontrado.'}), 404
    try:
        name = preset.name
        db.session.delete(preset)
        db.session.commit()
        log_activity('preset_delete', f'Preset eliminado: {name}')
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'No se pudo eliminar el preset.'}), 500


@app.route('/clasificacion/presets/<int:preset_id>', methods=['PUT'])
@tool_required('classification')
def presets_update(preset_id):
    preset = ClassificationPreset.query.filter_by(id=preset_id, user_id=current_user.id).first()
    if not preset:
        return jsonify({'success': False, 'error': 'Preset no encontrado.'}), 404
    try:
        data = request.get_json(force=True)
        new_name = (data.get('name') or '').strip()[:100]
        new_rules = data.get('rules')
        if new_name:
            preset.name = new_name
        if new_rules is not None:
            preset.rules_json = json.dumps(new_rules, ensure_ascii=False)
        db.session.commit()
        log_activity('preset_update', f'Preset actualizado: {preset.name}')
        return jsonify({'success': True, 'id': preset.id, 'name': preset.name})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Error actualizando preset: {e}")
        return jsonify({'success': False, 'error': 'No se pudo actualizar el preset.'}), 500

# Chunked classification endpoints
# ─────────────────────────────────────────────────────────────

@app.route('/clasificacion/chunk', methods=['POST'])
@tool_required('classification')
def clasificacion_chunk():
    """Receive one batch of CSV rows, classify it, append to a temp session file."""
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"success": False, "error": "No se recibieron datos."}), 400

        session_id   = data.get('session_id', '')
        header_text  = data.get('header', '')
        rows_text    = data.get('rows', '')
        rules        = data.get('rules', [])
        default_val  = data.get('default_val', 'Sin Clasificar')
        use_keywords = bool(data.get('use_keywords', False))
        chunk_index  = int(data.get('chunk_index', 0))
        text_col     = data.get('text_col', 'Hit Sentence') or 'Hit Sentence'
        keywords_col = data.get('keywords_col', '') or ''

        safe_sid = secure_filename(session_id)
        if not safe_sid or safe_sid != session_id:
            return jsonify({"success": False, "error": "session_id invalido."}), 400

        _get_owned_artifact_or_403('classify_session', safe_sid)  # SEC-03

        if not header_text or not rows_text:
            return jsonify({"success": False, "error": "Datos de chunk vacios."}), 400

        from services.classifier import classify_chunk as _classify_chunk
        df_chunk = _classify_chunk(rows_text, header_text, rules,
                                   default_val=default_val, use_keywords=use_keywords,
                                   text_col=text_col, keywords_col=keywords_col)

        if df_chunk is None or df_chunk.empty:
            return jsonify({"success": True, "partial_stats": {}, "rows_in_chunk": 0})

        session_file = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{safe_sid}.csv")
        write_header = (chunk_index == 0) or (not os.path.exists(session_file))
        df_chunk.to_csv(session_file, sep='\t', encoding='utf-16',
                        index=False, mode='w' if write_header else 'a',
                        header=write_header)

        partial_stats = {}
        grouped = df_chunk.groupby(['Categoria', 'Tematica']).size().reset_index(name='count')
        for _, row in grouped.iterrows():
            cat   = str(row['Categoria'])
            tem   = str(row['Tematica'])
            count = int(row['count'])
            if cat not in partial_stats:
                partial_stats[cat] = {"total": 0, "tematicas": {}}
            partial_stats[cat]["total"] += count
            partial_stats[cat]["tematicas"][tem] = partial_stats[cat]["tematicas"].get(tem, 0) + count

        return jsonify({
            "success": True,
            "partial_stats": partial_stats,
            "rows_in_chunk": len(df_chunk)
        })

    except HTTPException:
        # abort(403)/abort(404) deben propagarse con su propio codigo,
        # no convertirse en un 500 generico.
        raise
    except Exception as e:
        app.logger.error(f"Error en chunk de clasificacion: {e}")
        return jsonify({"success": False, "error": "Error procesando el chunk."}), 500


@app.route('/clasificacion/finalize', methods=['POST'])
@tool_required('classification')
def clasificacion_finalize():
    """Read the assembled session file, compute final stats, return download URL."""
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"success": False, "error": "No se recibieron datos."}), 400

        session_id    = data.get('session_id', '')
        original_name = data.get('original_name', 'archivo.csv')
        default_val   = data.get('default_val', 'Sin Clasificar')

        safe_sid = secure_filename(session_id)
        if not safe_sid or safe_sid != session_id:
            return jsonify({"success": False, "error": "session_id invalido."}), 400

        _get_owned_artifact_or_403('classify_session', safe_sid)  # SEC-03

        session_file = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{safe_sid}.csv")
        if not os.path.exists(session_file):
            return jsonify({"success": False, "error": "Sesion no encontrada. Reinicia el proceso."}), 404

        df_full = pd.read_csv(session_file, sep='\t', encoding='utf-16', on_bad_lines='skip')

        stats = {}
        if not df_full.empty and 'Categoria' in df_full.columns and 'Tematica' in df_full.columns:
            grouped = df_full.groupby(['Categoria', 'Tematica']).size().reset_index(name='count')
            for _, row in grouped.iterrows():
                cat   = str(row['Categoria'])
                tem   = str(row['Tematica'])
                count = int(row['count'])
                if cat not in stats:
                    stats[cat] = {"total": 0, "tematicas": {}}
                stats[cat]["total"] += count
                stats[cat]["tematicas"][tem] = stats[cat]["tematicas"].get(tem, 0) + count

        top_category = "N/A"
        max_val = -1
        for cat, d in stats.items():
            if cat != default_val and d['total'] > max_val:
                max_val = d['total']
                top_category = cat

        safe_orig = secure_filename(original_name)
        output_filename = f"Clasificado_{safe_orig}"
        output_path = os.path.join(app.config['UPLOAD_FOLDER'], f"classified_{safe_sid}.csv")
        os.replace(session_file, output_path)
        _register_temp_artifact('classified', safe_sid, f"classified_{safe_sid}.csv")

        # La sesion ya cumplio su proposito: liberar archivo y metadatos.
        try:
            upload_file = _scratch_path(f"upload_{safe_sid}.tsv")
            if os.path.exists(upload_file):
                os.remove(upload_file)
            TempArtifact.query.filter_by(kind='classify_session', file_id=safe_sid).delete()
            db.session.commit()
        except Exception as cleanup_error:
            db.session.rollback()
            app.logger.warning(f"No se pudo limpiar la sesion {safe_sid}: {cleanup_error}")

        log_activity('classify_data',
                     f'Clasificacion (chunked): {safe_orig} ({len(df_full)} filas, {len(stats)} categorias)')

        return jsonify({
            "success": True,
            "download_url": url_for('download_classified', file_id=safe_sid, original_name=output_filename),
            "stats": stats,
            "total_rows": len(df_full),
            "insights": {
                "top_category": top_category,
                "top_count": max_val if max_val != -1 else 0
            }
        })

    except HTTPException:
        raise
    except Exception as e:
        app.logger.error(f"Error en finalizacion de clasificacion: {e}")
        return jsonify({"success": False, "error": "Error finalizando la clasificacion."}), 500

@app.route('/download_classified/<file_id>/<original_name>')
@login_required
def download_classified(file_id, original_name):
    # Path sanitization (S7)
    safe_id = secure_filename(file_id)
    safe_name = secure_filename(original_name)
    artifact = _get_owned_artifact_or_403('classified', safe_id)
    file_path = _scratch_path(artifact.storage_name)
    
    # Verify path is within UPLOAD_FOLDER
    if not os.path.abspath(file_path).startswith(os.path.abspath(app.config['UPLOAD_FOLDER'])):
        app.logger.warning(f"Path traversal attempt: {file_id}")
        abort(403)
    
    @after_this_request
    def cleanup(response):
        try:
            if os.path.exists(file_path):
                # Opcional: borrar archivo después de descarga
                # os.remove(file_path) 
                pass
        except Exception as e:
            app.logger.error(f"Error limpiando archivo clasificado: {e}")
        return response

    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True, download_name=safe_name)
    else:
        abort(404)


@app.route('/union')
@tool_required('file_merge')
def union_archivos():
    return render_template('union.html')


@app.route('/union/detect', methods=['POST'])
@tool_required('file_merge')
def union_detect():
    """Auto-detect format of an uploaded file and return columns + preview."""
    file = request.files.get('file')
    if not file:
        return jsonify({'success': False, 'error': 'No se recibio ningun archivo.'}), 400
    try:
        raw = file.read()
        result = detect_format(raw, file.filename)
        if result.get('error'):
            return jsonify({'success': False, 'error': result['error']}), 400
        return jsonify({
            'success': True,
            'columns': result['columns'],
            'preview': result['preview'],
            'encoding': result.get('encoding'),
            'sep': result.get('sep'),
            'file_type': result.get('file_type'),
        })
    except Exception as e:
        app.logger.error(f"Error en union/detect: {e}")
        return jsonify({'success': False, 'error': 'No se pudo analizar el archivo.'}), 500


@app.route('/union/merge', methods=['POST'])
@tool_required('file_merge')
def union_merge():
    """Merge uploaded files using default or advanced mode."""
    from services.file_merger import read_file, merge_default, merge_advanced, save_merged

    mode = request.form.get('mode', 'default')

    try:
        if mode == 'advanced':
            # Advanced: exactly 2 files + column mapping
            file_a = request.files.get('file_a')
            file_b = request.files.get('file_b')
            if not file_a or not file_b:
                return jsonify({'success': False, 'error': 'Se necesitan ambos archivos para el modo avanzado.'}), 400

            mapping_str = request.form.get('mapping', '{}')
            try:
                mapping = json.loads(mapping_str)
            except json.JSONDecodeError:
                return jsonify({'success': False, 'error': 'Mapeo de columnas invalido.'}), 400

            enc_a = request.form.get('encoding_a') or None
            sep_a = request.form.get('sep_a') or None
            enc_b = request.form.get('encoding_b') or None
            sep_b = request.form.get('sep_b') or None

            raw_a = file_a.read()
            raw_b = file_b.read()
            df_a = read_file(raw_a, file_a.filename, encoding=enc_a, sep=sep_a)
            df_b = read_file(raw_b, file_b.filename, encoding=enc_b, sep=sep_b)

            merged = merge_advanced(df_a, df_b, mapping)

            # Apply extra columns (if any)
            extra_cols_str = request.form.get('extra_columns', '[]')
            try:
                extra_cols = json.loads(extra_cols_str)
            except json.JSONDecodeError:
                extra_cols = []
            for ec in extra_cols:
                col_name = ec.get('name', '').strip()
                if col_name:
                    merged[col_name] = ec.get('value', '')

            files_merged = 2
            detail = f'Union avanzada: {file_a.filename} + {file_b.filename} ({len(merged)} filas)'

        else:
            # Default: 2+ files
            files = request.files.getlist('files')
            if len(files) < 2:
                return jsonify({'success': False, 'error': 'Se necesitan al menos 2 archivos.'}), 400

            # Per-file encoding/separator overrides come as JSON arrays
            encodings_str = request.form.get('encodings', '[]')
            seps_str = request.form.get('separators', '[]')
            try:
                encodings = json.loads(encodings_str)
                seps = json.loads(seps_str)
            except json.JSONDecodeError:
                encodings, seps = [], []

            dataframes = []
            filenames = []
            for i, f in enumerate(files):
                raw = f.read()
                enc = encodings[i] if i < len(encodings) and encodings[i] else None
                sep = seps[i] if i < len(seps) and seps[i] else None
                df = read_file(raw, f.filename, encoding=enc, sep=sep)
                dataframes.append(df)
                filenames.append(f.filename)

            merged = merge_default(dataframes)
            files_merged = len(files)
            detail = f'Union predeterminada: {", ".join(filenames)} ({len(merged)} filas)'

        # Save result
        unique_id = uuid.uuid4().hex[:10]
        output_path = os.path.join(app.config['UPLOAD_FOLDER'], f"merged_{unique_id}.csv")
        save_merged(merged, output_path)
        _register_temp_artifact('union', unique_id, f"merged_{unique_id}.csv")

        log_activity('file_merge', detail)

        return jsonify({
            'success': True,
            'download_url': url_for('union_download', file_id=unique_id),
            'total_rows': len(merged),
            'total_columns': len(merged.columns),
            'files_merged': files_merged,
        })

    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        app.logger.error(f"Error en union/merge: {e}")
        return jsonify({'success': False, 'error': 'Error procesando la union de archivos.'}), 500


@app.route('/union/download/<file_id>')
@login_required
def union_download(file_id):
    """Download a merged file."""
    safe_id = secure_filename(file_id)
    artifact = _get_owned_artifact_or_403('union', safe_id)
    file_path = _scratch_path(artifact.storage_name)

    if not os.path.abspath(file_path).startswith(os.path.abspath(app.config['UPLOAD_FOLDER'])):
        abort(403)

    if not os.path.exists(file_path):
        abort(404)

    return send_file(file_path, as_attachment=True, download_name=f"Union_{safe_id}.csv")


@app.route('/analisis-csv', methods=['GET', 'POST'])
@tool_required('csv_analysis')
def analisis_csv():
    if request.method == 'POST':
        # Get file and parameters
        file = request.files.get('csv_file')
        encoding = request.form.get('encoding', 'utf-8')
        separator = request.form.get('separator', ',')
        
        if not file:
            return jsonify({'success': False, 'error': 'No se proporcionó ningún archivo'}), 400
        
        # Save file temporarily
        unique_id = str(uuid.uuid4())
        filename = f"{unique_id}_{secure_filename(file.filename)}"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        try:
            # Run analysis
            result = analyze_csv(file_path, encoding, separator)

            if result['success']:
                log_activity('csv_analysis', f'Análisis CSV: {file.filename}')
                # Generate summary CSV for download
                summary_filename = f"summary_{unique_id}.csv"
                summary_path = os.path.join(app.config['UPLOAD_FOLDER'], summary_filename)
                generate_summary_csv(result, summary_path)
                _register_temp_artifact('csv_summary', unique_id, summary_filename)
                
                # Add download URL to result
                result['download_url'] = url_for('download_csv_summary', file_id=unique_id)
                result['original_filename'] = file.filename
                
                return jsonify(result)
            else:
                return jsonify(result), 400
                
        except Exception as e:
            app.logger.error(f"Error en análisis CSV: {e}")
            return jsonify({
                'success': False,
                'error': f'Error procesando el archivo: {str(e)}'
            }), 500
        finally:
            # Clean up uploaded file
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as e:
                    app.logger.error(f"Error eliminando archivo temporal: {e}")
    
    return render_template('analisis_csv.html')


@app.route('/analisis-csv/download/<file_id>')
@login_required
def download_csv_summary(file_id):
    # Path sanitization
    safe_id = secure_filename(file_id)
    artifact = _get_owned_artifact_or_403('csv_summary', safe_id)
    file_path = _scratch_path(artifact.storage_name)
    
    # Verify path is within UPLOAD_FOLDER
    if not os.path.abspath(file_path).startswith(os.path.abspath(app.config['UPLOAD_FOLDER'])):
        app.logger.warning(f"Path traversal attempt: {file_id}")
        abort(403)
    
    @after_this_request
    def cleanup(response):
        try:
            if os.path.exists(file_path):
                # Delete file after download
                os.remove(file_path)
        except Exception as e:
            app.logger.error(f"Error limpiando archivo de resumen: {e}")
        return response
    
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True, download_name=f"analisis_resumen_{safe_id}.csv")
    else:
        abort(404)

# ─────────────────────────────────────────────────────────────
# Sonda de salud
# ─────────────────────────────────────────────────────────────

@app.route('/healthz')
@csrf.exempt
@limiter.exempt
@talisman(force_https=False)
def healthz():
    """Si el proceso puede atender y hablar con la base.

    Sin esto el orquestador solo sabe si el puerto acepta conexiones, que es
    verdad desde el primer instante y sigue siendolo con la base caida. Como el
    arranque aplica migraciones antes de levantar los workers, tambien hace
    falta para distinguir "todavia arrancando" de "roto".

    Se consulta la base de verdad —un SELECT 1— en vez de responder que si a
    secas: un proceso vivo con la conexion perdida es justo el caso que hay que
    sacar del balanceador.

    Exenta de tres cosas por necesidad: de CSRF y del limitador porque la sonda
    no trae sesion ni cookies, y de force_https porque quien la llama es el
    propio contenedor por HTTP contra 127.0.0.1; sin la exencion recibiria un
    301 y lo leeria como fallo. No expone version ni detalles del error: es un
    punto sin autenticar.
    """
    try:
        db.session.execute(text('SELECT 1'))
    except Exception as e:
        app.logger.error(f"[healthz] base inaccesible: {e}")
        return jsonify({'status': 'error', 'database': 'unreachable'}), 503

    return jsonify({'status': 'ok'}), 200


# ─────────────────────────────────────────────────────────────
# Centralized Error Handlers (HTML for browser, JSON for AJAX)
# ─────────────────────────────────────────────────────────────

@app.errorhandler(400)
def bad_request(e):
    if _is_ajax():
        return jsonify({"success": False, "error": "Solicitud invalida."}), 400
    return render_template('error.html',
                           title="Error 400 - Solicitud inválida",
                           message="La solicitud no es válida. Verifica los datos e intenta de nuevo."), 400


@app.errorhandler(403)
def forbidden(e):
    if _is_ajax():
        return jsonify({"success": False, "error": "No tienes permiso para realizar esta accion."}), 403
    return render_template('error.html',
                           title="Error 403 - Acceso denegado",
                           message="No tienes permiso para acceder a este recurso."), 403


@app.errorhandler(404)
def page_not_found(e):
    if _is_ajax():
        return jsonify({"success": False, "error": "Recurso no encontrado."}), 404
    return render_template('error.html',
                           title="Error 404 - Página no encontrada",
                           message="La página que estás buscando no existe."), 404


@app.errorhandler(405)
def method_not_allowed(e):
    if _is_ajax():
        return jsonify({"success": False, "error": "Metodo no permitido."}), 405
    return render_template('error.html',
                           title="Error 405 - Método no permitido",
                           message="El método HTTP utilizado no está permitido para este recurso."), 405


@app.errorhandler(413)
def request_entity_too_large(e):
    if _is_ajax():
        return jsonify({"success": False, "error": "El archivo es demasiado grande. El limite maximo es 200 MB."}), 413
    return render_template('error.html',
                           title="Archivo demasiado grande",
                           message="El archivo que subiste supera el limite de 200 MB."), 413


@app.errorhandler(429)
def rate_limit_exceeded(e):
    if _is_ajax():
        return jsonify({"success": False, "error": "Demasiadas solicitudes. Intenta mas tarde."}), 429
    return render_template('error.html',
                           title="Error 429 - Demasiadas solicitudes",
                           message="Has realizado demasiadas solicitudes. Por favor espera unos minutos e intenta de nuevo."), 429


@app.errorhandler(500)
def internal_error(e):
    if _is_ajax():
        return jsonify({"success": False, "error": "Error interno del servidor."}), 500
    return render_template('error.html',
                           title="Error 500 - Problema del servidor",
                           message="Ocurrió un error inesperado. Por favor, intenta más tarde."), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(debug=debug_mode, host='0.0.0.0', port=port)
