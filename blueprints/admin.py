import os
import functools
from flask import Blueprint, render_template, request, redirect, url_for, flash, abort
from flask_login import login_required, current_user
from werkzeug.security import generate_password_hash
from extensions import db
from models import User, ActivityLog

# The default admin email — this account is fully protected
DEFAULT_ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@dataintel.com')

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')


# ─────────────────────────────────────────────────────────────
# Decorators & Helpers
# ─────────────────────────────────────────────────────────────

def admin_required(f):
    """Decorator: requires login + admin role."""
    @functools.wraps(f)
    @login_required
    def decorated(*args, **kwargs):
        if not current_user.is_admin:
            abort(403)
        return f(*args, **kwargs)
    return decorated


def is_default_admin(user):
    """Check if this user is the protected default admin account."""
    return user.email == DEFAULT_ADMIN_EMAIL


def log_activity(action, detail="", user_id=None):
    """Log an action to the activity_logs table."""
    uid = user_id or (current_user.id if current_user.is_authenticated else None)
    if uid is None:
        return
    try:
        log = ActivityLog(
            user_id=uid,
            action=action,
            detail=detail[:500] if detail else "",
            ip_address=request.remote_addr if request else None,
        )
        db.session.add(log)
        db.session.commit()
    except Exception:
        db.session.rollback()


# ─────────────────────────────────────────────────────────────
# Dashboard
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/')
@admin_required
def dashboard():
    total_users = User.query.count()
    active_users = User.query.filter_by(is_active=True).count()
    roles_count = {
        'admin': User.query.filter_by(role='admin').count(),
        'DI': User.query.filter_by(role='DI').count(),
        'MW': User.query.filter_by(role='MW').count(),
    }
    # Exclude default admin's activity from dashboard
    default_admin = User.query.filter_by(email=DEFAULT_ADMIN_EMAIL).first()
    log_query = ActivityLog.query
    if default_admin:
        log_query = log_query.filter(ActivityLog.user_id != default_admin.id)
    recent_logs = (log_query
                   .order_by(ActivityLog.timestamp.desc())
                   .limit(10)
                   .all())
    return render_template('admin_dashboard.html',
                           total_users=total_users,
                           active_users=active_users,
                           roles_count=roles_count,
                           recent_logs=recent_logs)


# ─────────────────────────────────────────────────────────────
# User List
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users')
@admin_required
def users_list():
    search = request.args.get('q', '').strip()
    role_filter = request.args.get('role', '').strip()

    query = User.query
    if search:
        query = query.filter(
            (User.username.ilike(f'%{search}%')) |
            (User.email.ilike(f'%{search}%'))
        )
    if role_filter and role_filter in User.VALID_ROLES:
        query = query.filter_by(role=role_filter)

    # Exclude the default admin from the user list
    query = query.filter(User.email != DEFAULT_ADMIN_EMAIL)

    users = query.order_by(User.created_at.desc()).all()
    return render_template('admin_users.html', users=users,
                           search=search, role_filter=role_filter)


# ─────────────────────────────────────────────────────────────
# Create User
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/new', methods=['GET', 'POST'])
@admin_required
def user_create():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')
        role = request.form.get('role', 'DI')

        # Validation
        if not username or len(username) < 3:
            flash('El nombre de usuario debe tener al menos 3 caracteres.', 'error')
            return redirect(url_for('admin.user_create'))
        if not email:
            flash('El correo electrónico es obligatorio.', 'error')
            return redirect(url_for('admin.user_create'))
        if not password or len(password) < 8:
            flash('La contraseña debe tener al menos 8 caracteres.', 'error')
            return redirect(url_for('admin.user_create'))
        if role not in User.VALID_ROLES:
            flash('Rol inválido.', 'error')
            return redirect(url_for('admin.user_create'))
        if User.query.filter_by(email=email).first():
            flash('Ya existe un usuario con ese correo.', 'error')
            return redirect(url_for('admin.user_create'))

        new_user = User(
            username=username,
            email=email,
            password=generate_password_hash(password, method='pbkdf2:sha256'),
            role=role,
        )
        # Set tool permissions
        selected_tools = request.form.getlist('tools')
        new_user.set_allowed_tools(selected_tools)

        db.session.add(new_user)
        db.session.commit()

        log_activity('admin_create_user', f'Creo usuario: {username} ({email}) con rol {role}')
        flash(f'Usuario "{username}" creado exitosamente.', 'success')
        return redirect(url_for('admin.users_list'))

    return render_template('admin_user_form.html', user=None, mode='create',
                           all_tools=User.ALL_TOOLS,
                           user_tools=list(User.ALL_TOOLS.keys()))


# ─────────────────────────────────────────────────────────────
# Edit User
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/<int:user_id>/edit', methods=['GET', 'POST'])
@admin_required
def user_edit(user_id):
    user = User.query.get_or_404(user_id)

    # Block editing the default admin
    if is_default_admin(user):
        flash('La cuenta de administrador predeterminada no puede ser modificada.', 'error')
        return redirect(url_for('admin.users_list'))

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')
        role = request.form.get('role', user.role)

        if not username or len(username) < 3:
            flash('El nombre de usuario debe tener al menos 3 caracteres.', 'error')
            return redirect(url_for('admin.user_edit', user_id=user_id))
        if role not in User.VALID_ROLES:
            flash('Rol inválido.', 'error')
            return redirect(url_for('admin.user_edit', user_id=user_id))

        # Prevent admin from removing their own admin role
        if user.id == current_user.id and role != 'admin':
            flash('No puedes quitarte tu propio rol de administrador.', 'error')
            return redirect(url_for('admin.user_edit', user_id=user_id))

        changes = []
        if user.username != username:
            changes.append(f'nombre: {user.username} → {username}')
            user.username = username
        if user.email != email and email:
            existing = User.query.filter_by(email=email).first()
            if existing and existing.id != user.id:
                flash('Ya existe un usuario con ese correo.', 'error')
                return redirect(url_for('admin.user_edit', user_id=user_id))
            changes.append(f'email: {user.email} → {email}')
            user.email = email
        if user.role != role:
            changes.append(f'rol: {user.role} → {role}')
            user.role = role
        if password:
            user.password = generate_password_hash(password, method='pbkdf2:sha256')
            changes.append('contrasena actualizada')

        # Update tool permissions
        selected_tools = request.form.getlist('tools')
        old_tools = set(user.get_allowed_tools())
        user.set_allowed_tools(selected_tools)
        new_tools = set(user.get_allowed_tools())
        if old_tools != new_tools:
            changes.append(f'permisos actualizados')

        db.session.commit()
        log_activity('admin_edit_user', f'Edito usuario #{user_id}: {", ".join(changes) if changes else "sin cambios"}')
        flash(f'Usuario "{user.username}" actualizado.', 'success')
        return redirect(url_for('admin.users_list'))

    return render_template('admin_user_form.html', user=user, mode='edit',
                           all_tools=User.ALL_TOOLS,
                           user_tools=user.get_allowed_tools())


# ─────────────────────────────────────────────────────────────
# Toggle Active / Deactivate
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/<int:user_id>/toggle', methods=['POST'])
@admin_required
def user_toggle(user_id):
    user = User.query.get_or_404(user_id)

    if is_default_admin(user):
        flash('La cuenta de administrador predeterminada no puede ser modificada.', 'error')
        return redirect(url_for('admin.users_list'))

    if user.id == current_user.id:
        flash('No puedes desactivarte a ti mismo.', 'error')
        return redirect(url_for('admin.users_list'))

    user.is_active = not user.is_active
    db.session.commit()

    status = 'activado' if user.is_active else 'desactivado'
    log_activity('admin_toggle_user', f'Usuario #{user_id} ({user.username}) {status}')
    flash(f'Usuario "{user.username}" {status}.', 'success')
    return redirect(url_for('admin.users_list'))


# ─────────────────────────────────────────────────────────────
# Soft Delete
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/<int:user_id>/delete', methods=['POST'])
@admin_required
def user_delete(user_id):
    user = User.query.get_or_404(user_id)

    if is_default_admin(user):
        flash('La cuenta de administrador predeterminada no puede ser eliminada.', 'error')
        return redirect(url_for('admin.users_list'))

    if user.id == current_user.id:
        flash('No puedes eliminar tu propia cuenta.', 'error')
        return redirect(url_for('admin.users_list'))

    user.is_active = False
    db.session.commit()

    log_activity('admin_delete_user', f'Desactivó usuario #{user_id} ({user.username})')
    flash(f'Usuario "{user.username}" desactivado.', 'warning')
    return redirect(url_for('admin.users_list'))


# ─────────────────────────────────────────────────────────────
# Activity Log
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/activity')
@admin_required
def activity_log():
    user_filter = request.args.get('user_id', '', type=str)
    action_filter = request.args.get('action', '').strip()
    page = request.args.get('page', 1, type=int)
    per_page = 50

    query = ActivityLog.query

    # Always exclude default admin's activity
    default_admin = User.query.filter_by(email=DEFAULT_ADMIN_EMAIL).first()
    if default_admin:
        query = query.filter(ActivityLog.user_id != default_admin.id)

    if user_filter:
        try:
            query = query.filter_by(user_id=int(user_filter))
        except ValueError:
            pass
    if action_filter:
        query = query.filter(ActivityLog.action.ilike(f'%{action_filter}%'))

    logs = (query
            .order_by(ActivityLog.timestamp.desc())
            .paginate(page=page, per_page=per_page, error_out=False))

    # Exclude default admin from the user filter dropdown
    users = User.query.filter(User.email != DEFAULT_ADMIN_EMAIL).order_by(User.username).all()
    return render_template('admin_activity.html',
                           logs=logs,
                           users=users,
                           user_filter=user_filter,
                           action_filter=action_filter)


@admin_bp.route('/activity/<int:user_id>')
@admin_required
def user_activity(user_id):
    user = User.query.get_or_404(user_id)

    # Block viewing default admin's activity
    if is_default_admin(user):
        flash('No se puede ver la actividad del administrador predeterminado.', 'error')
        return redirect(url_for('admin.activity_log'))
    page = request.args.get('page', 1, type=int)
    per_page = 50

    logs = (ActivityLog.query
            .filter_by(user_id=user_id)
            .order_by(ActivityLog.timestamp.desc())
            .paginate(page=page, per_page=per_page, error_out=False))

    return render_template('admin_activity.html',
                           logs=logs,
                           users=[user],
                           user_filter=str(user_id),
                           action_filter='',
                           single_user=user)
