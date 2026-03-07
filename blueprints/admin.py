import os
import functools
import secrets
from flask import Blueprint, render_template, request, redirect, url_for, flash, abort, session
from flask_login import login_required, current_user, login_user
from werkzeug.security import generate_password_hash
from extensions import db
from models import User, ActivityLog, Role, Area

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
    # Dynamic role counts
    all_roles = Role.query.order_by(Role.code).all()
    roles_count = {}
    for r in all_roles:
        roles_count[r.code] = User.query.filter_by(role=r.code).count()
    # Always include 'admin' even if not in Role table
    if 'admin' not in roles_count:
        roles_count['admin'] = User.query.filter_by(role='admin').count()
    total_logs = ActivityLog.query.count()
    total_roles = Role.query.count()
    total_areas = Area.query.count()

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
                           total_logs=total_logs,
                           total_roles=total_roles,
                           total_areas=total_areas,
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
    # Accept any role code (dynamic from Role table or 'admin')
    if role_filter:
        query = query.filter_by(role=role_filter)

    # Exclude the default admin from the user list
    query = query.filter(User.email != DEFAULT_ADMIN_EMAIL)

    users = query.order_by(User.created_at.desc()).all()
    all_roles = Role.query.order_by(Role.code).all()
    return render_template('admin_users.html', users=users,
                           search=search, role_filter=role_filter,
                           all_roles=all_roles)


# ─────────────────────────────────────────────────────────────
# Create User
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/new', methods=['GET', 'POST'])
@admin_required
def user_create():
    all_roles = Role.query.order_by(Role.code).all()
    all_areas = Area.query.order_by(Area.name).all()

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')
        role = request.form.get('role', 'DI')
        area_id = request.form.get('area_id', '') or None

        # Validation
        if not username or len(username) < 3:
            flash('El nombre de usuario debe tener al menos 3 caracteres.', 'error')
            return redirect(url_for('admin.user_create'))
        if not email:
            flash('El correo electronico es obligatorio.', 'error')
            return redirect(url_for('admin.user_create'))
        if not password or len(password) < 8:
            flash('La contrasena debe tener al menos 8 caracteres.', 'error')
            return redirect(url_for('admin.user_create'))
        if User.query.filter_by(email=email).first():
            flash('Ya existe un usuario con ese correo.', 'error')
            return redirect(url_for('admin.user_create'))

        new_user = User(
            username=username,
            email=email,
            password=generate_password_hash(password, method='scrypt'),
            role=role,
            area_id=int(area_id) if area_id else None,
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
                           user_tools=list(User.ALL_TOOLS.keys()),
                           roles=all_roles, areas=all_areas)


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
        area_id = request.form.get('area_id', '') or None

        if not username or len(username) < 3:
            flash('El nombre de usuario debe tener al menos 3 caracteres.', 'error')
            return redirect(url_for('admin.user_edit', user_id=user_id))

        # Prevent admin from removing their own admin role
        if user.id == current_user.id and role != 'admin':
            flash('No puedes quitarte tu propio rol de administrador.', 'error')
            return redirect(url_for('admin.user_edit', user_id=user_id))

        changes = []
        if user.username != username:
            changes.append(f'nombre: {user.username} -> {username}')
            user.username = username
        if user.email != email and email:
            existing = User.query.filter_by(email=email).first()
            if existing and existing.id != user.id:
                flash('Ya existe un usuario con ese correo.', 'error')
                return redirect(url_for('admin.user_edit', user_id=user_id))
            changes.append(f'email: {user.email} -> {email}')
            user.email = email
        if user.role != role:
            changes.append(f'rol: {user.role} -> {role}')
            user.role = role
        new_area_id = int(area_id) if area_id else None
        if user.area_id != new_area_id:
            changes.append('area actualizada')
            user.area_id = new_area_id
        if password:
            user.password = generate_password_hash(password, method='scrypt')
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

    all_roles = Role.query.order_by(Role.code).all()
    all_areas = Area.query.order_by(Area.name).all()
    return render_template('admin_user_form.html', user=user, mode='edit',
                           all_tools=User.ALL_TOOLS,
                           user_tools=user.get_allowed_tools(),
                           roles=all_roles, areas=all_areas)


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
    date_from = request.args.get('date_from', '').strip()
    date_to = request.args.get('date_to', '').strip()
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
    
    if date_from:
        try:
            from datetime import datetime as dt
            df = dt.strptime(date_from, '%Y-%m-%d')
            query = query.filter(ActivityLog.timestamp >= df)
        except ValueError:
            pass
    if date_to:
        try:
            from datetime import datetime as dt, timedelta
            dt_to = dt.strptime(date_to, '%Y-%m-%d') + timedelta(days=1)
            query = query.filter(ActivityLog.timestamp < dt_to)
        except ValueError:
            pass

    logs = (query
            .order_by(ActivityLog.timestamp.desc())
            .paginate(page=page, per_page=per_page, error_out=False))

    # Exclude default admin from the user filter dropdown
    users = User.query.filter(User.email != DEFAULT_ADMIN_EMAIL).order_by(User.username).all()
    return render_template('admin_activity.html',
                           logs=logs,
                           users=users,
                           user_filter=user_filter,
                           action_filter=action_filter,
                           date_from=date_from,
                           date_to=date_to)


@admin_bp.route('/activity/<int:user_id>')
@admin_required
def user_activity(user_id):
    user = User.query.get_or_404(user_id)

    # Block viewing default admin's activity
    if is_default_admin(user):
        flash('No se puede ver la actividad del administrador predeterminado.', 'error')
        return redirect(url_for('admin.activity_log'))
    
    date_from = request.args.get('date_from', '').strip()
    date_to = request.args.get('date_to', '').strip()
    page = request.args.get('page', 1, type=int)
    per_page = 50

    query = ActivityLog.query.filter_by(user_id=user_id)
    
    if date_from:
        try:
            from datetime import datetime as dt
            df = dt.strptime(date_from, '%Y-%m-%d')
            query = query.filter(ActivityLog.timestamp >= df)
        except ValueError:
            pass
    if date_to:
        try:
            from datetime import datetime as dt, timedelta
            dt_to = dt.strptime(date_to, '%Y-%m-%d') + timedelta(days=1)
            query = query.filter(ActivityLog.timestamp < dt_to)
        except ValueError:
            pass

    logs = (query
            .order_by(ActivityLog.timestamp.desc())
            .paginate(page=page, per_page=per_page, error_out=False))

    return render_template('admin_activity.html',
                           logs=logs,
                           users=[user],
                           user_filter=str(user_id),
                           action_filter='',
                           date_from=date_from,
                           date_to=date_to,
                           single_user=user)


# ─────────────────────────────────────────────────────────────
# Session Control (Kick / Impersonate)
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/<int:user_id>/kick', methods=['POST'])
@admin_required
def user_kick(user_id):
    """Force-logout a user by setting force_logout flag."""
    user = User.query.get_or_404(user_id)
    if is_default_admin(user):
        flash('No puedes expulsar al administrador principal.', 'error')
        return redirect(url_for('admin.users_list'))
    user.force_logout = True
    db.session.commit()
    log_activity('user_kick', f'Sesion terminada para {user.username}')
    flash(f'Sesion de {user.username} terminada.', 'success')
    return redirect(url_for('admin.users_list'))


@admin_bp.route('/users/<int:user_id>/impersonate', methods=['POST'])
@admin_required
def user_impersonate(user_id):
    """Login as another user (main admin only)."""
    if current_user.email != DEFAULT_ADMIN_EMAIL:
        flash('Solo el administrador principal puede usar esta funcion.', 'error')
        return redirect(url_for('admin.users_list'))
    target = User.query.get_or_404(user_id)
    session['impersonating_from'] = current_user.id
    log_activity('impersonate_start', f'Impersonando a {target.username}')
    login_user(target)
    flash(f'Ahora estas viendo como {target.username}.', 'info')
    return redirect(url_for('menu'))


@admin_bp.route('/stop-impersonation')
@login_required
def stop_impersonation():
    """Return to the original admin account."""
    admin_id = session.pop('impersonating_from', None)
    if admin_id:
        admin_user = User.query.get(admin_id)
        if admin_user:
            login_user(admin_user)
            log_activity('impersonate_stop', 'Regreso a cuenta admin')
            flash('Has vuelto a tu cuenta de administrador.', 'success')
    return redirect(url_for('admin.users_list'))


# ─────────────────────────────────────────────────────────────
# Role Management CRUD
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/roles')
@admin_required
def roles_list():
    roles = Role.query.order_by(Role.code).all()
    return render_template('admin_roles.html', roles=roles)


@admin_bp.route('/roles/create', methods=['POST'])
@admin_required
def role_create():
    code = (request.form.get('code') or '').strip().upper()[:30]
    display_name = (request.form.get('display_name') or '').strip()[:100]
    description = (request.form.get('description') or '').strip()
    if not code or not display_name:
        flash('Codigo y nombre son requeridos.', 'error')
        return redirect(url_for('admin.roles_list'))
    if Role.query.filter_by(code=code).first():
        flash(f'El codigo "{code}" ya existe.', 'error')
        return redirect(url_for('admin.roles_list'))
    role = Role(code=code, display_name=display_name, description=description)
    db.session.add(role)
    db.session.commit()
    log_activity('role_create', f'Rol creado: {code}')
    flash(f'Rol "{display_name}" creado.', 'success')
    return redirect(url_for('admin.roles_list'))


@admin_bp.route('/roles/<int:role_id>/edit', methods=['POST'])
@admin_required
def role_edit(role_id):
    role = Role.query.get_or_404(role_id)
    role.display_name = (request.form.get('display_name') or role.display_name).strip()[:100]
    role.description = (request.form.get('description') or '').strip()
    db.session.commit()
    log_activity('role_edit', f'Rol editado: {role.code}')
    flash(f'Rol "{role.display_name}" actualizado.', 'success')
    return redirect(url_for('admin.roles_list'))


@admin_bp.route('/roles/<int:role_id>/delete', methods=['POST'])
@admin_required
def role_delete(role_id):
    role = Role.query.get_or_404(role_id)
    # Prevent deleting if users are assigned this role
    users_with_role = User.query.filter_by(role=role.code).count()
    if users_with_role > 0:
        flash(f'No se puede eliminar: {users_with_role} usuario(s) tienen este rol.', 'error')
        return redirect(url_for('admin.roles_list'))
    db.session.delete(role)
    db.session.commit()
    log_activity('role_delete', f'Rol eliminado: {role.code}')
    flash('Rol eliminado.', 'success')
    return redirect(url_for('admin.roles_list'))


# ─────────────────────────────────────────────────────────────
# Area Management CRUD
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/areas')
@admin_required
def areas_list():
    areas = Area.query.order_by(Area.name).all()
    return render_template('admin_areas.html', areas=areas)


@admin_bp.route('/areas/create', methods=['POST'])
@admin_required
def area_create():
    name = (request.form.get('name') or '').strip()[:100]
    description = (request.form.get('description') or '').strip()
    if not name:
        flash('El nombre del area es requerido.', 'error')
        return redirect(url_for('admin.areas_list'))
    if Area.query.filter_by(name=name).first():
        flash(f'El area "{name}" ya existe.', 'error')
        return redirect(url_for('admin.areas_list'))
    area = Area(name=name, description=description)
    db.session.add(area)
    db.session.commit()
    log_activity('area_create', f'Area creada: {name}')
    flash(f'Area "{name}" creada.', 'success')
    return redirect(url_for('admin.areas_list'))


@admin_bp.route('/areas/<int:area_id>/edit', methods=['POST'])
@admin_required
def area_edit(area_id):
    area = Area.query.get_or_404(area_id)
    area.name = (request.form.get('name') or area.name).strip()[:100]
    area.description = (request.form.get('description') or '').strip()
    db.session.commit()
    log_activity('area_edit', f'Area editada: {area.name}')
    flash(f'Area "{area.name}" actualizada.', 'success')
    return redirect(url_for('admin.areas_list'))


@admin_bp.route('/areas/<int:area_id>/delete', methods=['POST'])
@admin_required
def area_delete(area_id):
    area = Area.query.get_or_404(area_id)
    users_in_area = User.query.filter_by(area_id=area.id).count()
    if users_in_area > 0:
        flash(f'No se puede eliminar: {users_in_area} usuario(s) pertenecen a esta area.', 'error')
        return redirect(url_for('admin.areas_list'))
    db.session.delete(area)
    db.session.commit()
    log_activity('area_delete', f'Area eliminada: {area.name}')
    flash('Area eliminada.', 'success')
    return redirect(url_for('admin.areas_list'))
