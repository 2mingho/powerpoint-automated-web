import os
import io
import functools
import secrets
from flask import Blueprint, render_template, request, redirect, url_for, flash, abort, session
from flask_login import login_required, current_user, login_user
from werkzeug.security import generate_password_hash
from werkzeug.utils import secure_filename
from extensions import db
from models import User, ActivityLog, Role, Area, UnitLead

# The default admin email — this account is fully protected
DEFAULT_ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@dataintel.com')

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

# Cargos posibles (0020). Administrar es una casilla aparte (User.es_admin), no un cargo.
CARGOS = ('coordinador', 'analista', 'ejecutiva', 'gerente', 'director')


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


def log_activity(action, detail="", user_id=None, entity_type=None, entity_id=None, commit=True):
    """Log an action to the activity_logs table.

    Con commit=False el registro solo se anade a la sesion y viaja en el commit
    de quien llama. Es lo que conviene cuando el registro acompana a un cambio:
    un segundo commit caduca todos los objetos de la sesion, y con NullPool
    cada commit cierra la conexion, asi que lo que se lea despues vuelve a
    consultarse fila a fila por una conexion nueva.
    """
    uid = user_id or (current_user.id if current_user.is_authenticated else None)
    if uid is None:
        return
    log = ActivityLog(
        user_id=uid,
        action=action,
        detail=detail[:500] if detail else "",
        entity_type=entity_type,
        entity_id=entity_id,
        ip_address=request.remote_addr if request else None,
    )
    if not commit:
        db.session.add(log)
        return
    try:
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
    # Administracion es una casilla aparte del cargo.
    roles_count['admin'] = User.query.filter_by(es_admin=True).count()
    total_logs = ActivityLog.query.count()
    total_roles = Role.query.count()
    total_areas = Area.query.count()

    recent_logs = (ActivityLog.query
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
    area_filter = request.args.get('area', '').strip()
    estado_filter = request.args.get('estado', '').strip()

    query = User.query
    if search:
        patron = f'%{search}%'
        query = query.filter(
            (User.username.ilike(patron)) |
            (User.email.ilike(patron))
        )
    # Accept any role code (dynamic from Role table or 'admin')
    if role_filter == 'admin':
        query = query.filter_by(es_admin=True)
    elif role_filter:
        query = query.filter_by(role=role_filter)

    if area_filter == 'sin':
        query = query.filter(User.area_id.is_(None))
    elif area_filter:
        try:
            query = query.filter_by(area_id=int(area_filter))
        except ValueError:
            pass

    if estado_filter == 'activos':
        query = query.filter(User.is_active.is_(True))
    elif estado_filter == 'inactivos':
        query = query.filter(User.is_active.is_(False))

    # Exclude the default admin from the user list
    query = query.filter(User.email != DEFAULT_ADMIN_EMAIL)

    # Paginado. Antes se hacia .all(): con unos cuantos cientos de usuarios eso
    # es traerlos todos a memoria y pintarlos todos en una tabla que nadie
    # recorre entera. El filtro es lo que se usa para llegar a alguien.
    try:
        pagina = max(1, int(request.args.get('p', '1')))
    except ValueError:
        pagina = 1

    POR_PAGINA = 25
    total = query.count()
    paginas = max(1, (total + POR_PAGINA - 1) // POR_PAGINA)
    pagina = min(pagina, paginas)

    users = (query.order_by(User.created_at.desc())
             .limit(POR_PAGINA).offset((pagina - 1) * POR_PAGINA).all())

    all_roles = Role.query.order_by(Role.code).all()
    all_areas = Area.query.order_by(Area.name).all()

    return render_template('admin_users.html', users=users,
                           search=search, role_filter=role_filter,
                           area_filter=area_filter, estado_filter=estado_filter,
                           all_roles=all_roles, all_areas=all_areas,
                           total=total, pagina=pagina, paginas=paginas,
                           por_pagina=POR_PAGINA)


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
        role = request.form.get('role', 'analista')
        es_admin = request.form.get('es_admin') == 'on'
        area_id = request.form.get('area_id', '') or None

        # Validation
        if role not in CARGOS:
            flash(f'El cargo debe ser uno de: {", ".join(CARGOS)}.', 'error')
            return redirect(url_for('admin.user_create'))
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
            es_admin=es_admin,
            area_id=int(area_id) if area_id else None,
        )
        # Set tool permissions
        selected_tools = request.form.getlist('tools')
        new_user.set_allowed_tools(selected_tools)

        db.session.add(new_user)
        db.session.commit()

        log_activity('admin_create_user', f'Creo usuario: {username} ({email}) con cargo {role}{" y administrador" if es_admin else ""}')
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
        es_admin = request.form.get('es_admin') == 'on'
        area_id = request.form.get('area_id', '') or None

        if not username or len(username) < 3:
            flash('El nombre de usuario debe tener al menos 3 caracteres.', 'error')
            return redirect(url_for('admin.user_edit', user_id=user_id))
        if role not in CARGOS:
            flash(f'El cargo debe ser uno de: {", ".join(CARGOS)}.', 'error')
            return redirect(url_for('admin.user_edit', user_id=user_id))

        # Prevent admin from removing their own admin role
        if user.id == current_user.id and not es_admin:
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
            changes.append(f'cargo: {user.role} -> {role}')
            user.role = role
        if bool(user.es_admin) != es_admin:
            changes.append(f'administrador: {"si" if es_admin else "no"}')
            user.es_admin = es_admin
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

    users = User.query.order_by(User.username).all()
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
    flash('Los cargos son fijos (coordinador, analista, ejecutiva, gerente y director); ya no se crean, editan ni eliminan.', 'error')
    return redirect(url_for('admin.roles_list'))


@admin_bp.route('/roles/<int:role_id>/edit', methods=['POST'])
@admin_required
def role_edit(role_id):
    flash('Los cargos son fijos (coordinador, analista, ejecutiva, gerente y director); ya no se crean, editan ni eliminan.', 'error')
    return redirect(url_for('admin.roles_list'))


@admin_bp.route('/roles/<int:role_id>/delete', methods=['POST'])
@admin_required
def role_delete(role_id):
    flash('Los cargos son fijos (coordinador, analista, ejecutiva, gerente y director); ya no se crean, editan ni eliminan.', 'error')
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


# ─────────────────────────────────────────────────────────────
# Organizacion: quien lidera que unidad y quien reporta a quien
# ─────────────────────────────────────────────────────────────
#
# Son las dos unicas relaciones que hacen falta. Todo lo demas —el papel de
# cada uno y las unidades que alcanza— se deduce de ellas, y la pantalla lo
# muestra al lado para que el efecto de un cambio se vea sin adivinarlo.

def _cadena_hacia_arriba(user):
    """Los superiores de alguien, de abajo arriba. Corta ciclos."""
    cadena, visto = [], set()
    actual = user.manager_id
    while actual and actual not in visto:
        visto.add(actual)
        jefe = db.session.get(User, actual)
        if jefe is None:
            break
        cadena.append(jefe)
        actual = jefe.manager_id
    return cadena


@admin_bp.route('/organizacion')
@admin_required
def organizacion():
    from services.alcance import alcance_unidades, papel, personas_a_cargo

    areas = Area.query.order_by(Area.name).all()
    usuarios = User.query.filter_by(is_active=True).order_by(User.username).all()

    lideres_por_area = {a.id: [] for a in areas}
    for fila in UnitLead.query.all():
        if fila.area_id in lideres_por_area:
            usuario = db.session.get(User, fila.user_id)
            if usuario:
                lideres_por_area[fila.area_id].append(usuario)

    nombre_area = {a.id: a.name for a in areas}

    filas = []
    for u in usuarios:
        alcance = alcance_unidades(u, usar_cache=False)
        filas.append({
            'usuario': u,
            'papel': papel(u),
            'unidades_alcance': sorted(nombre_area.get(i, f'#{i}') for i in alcance),
            'a_cargo': len(personas_a_cargo(u)) - 1,
            'superiores': _cadena_hacia_arriba(u),
        })

    return render_template(
        'admin_organizacion.html',
        areas=areas,
        usuarios=usuarios,
        lideres_por_area=lideres_por_area,
        filas=filas,
    )


@admin_bp.route('/organizacion/lider', methods=['POST'])
@admin_required
def organizacion_lider_add():
    from services.alcance import invalidar_cache_alcance

    try:
        area_id = int(request.form.get('area_id', ''))
        user_id = int(request.form.get('user_id', ''))
    except (TypeError, ValueError):
        flash('Selecciona una unidad y una persona.', 'error')
        return redirect(url_for('admin.organizacion'))

    area = db.session.get(Area, area_id)
    usuario = db.session.get(User, user_id)
    if not area or not usuario:
        flash('Unidad o persona no encontrada.', 'error')
        return redirect(url_for('admin.organizacion'))

    if UnitLead.query.filter_by(area_id=area_id, user_id=user_id).first():
        flash(f'{usuario.username} ya lidera {area.name}.', 'warning')
        return redirect(url_for('admin.organizacion'))

    db.session.add(UnitLead(user_id=user_id, area_id=area_id))
    db.session.commit()
    invalidar_cache_alcance()
    log_activity('unit_lead_add', f'{usuario.username} lidera {area.name}')
    flash(f'{usuario.username} ahora lidera {area.name}.', 'success')
    return redirect(url_for('admin.organizacion'))


@admin_bp.route('/organizacion/lider/quitar', methods=['POST'])
@admin_required
def organizacion_lider_remove():
    from services.alcance import invalidar_cache_alcance

    try:
        area_id = int(request.form.get('area_id', ''))
        user_id = int(request.form.get('user_id', ''))
    except (TypeError, ValueError):
        return redirect(url_for('admin.organizacion'))

    fila = UnitLead.query.filter_by(area_id=area_id, user_id=user_id).first()
    if fila is None:
        return redirect(url_for('admin.organizacion'))

    area = db.session.get(Area, area_id)
    usuario = db.session.get(User, user_id)
    db.session.delete(fila)
    db.session.commit()
    invalidar_cache_alcance()

    nombre = usuario.username if usuario else f'#{user_id}'
    unidad = area.name if area else f'#{area_id}'
    log_activity('unit_lead_remove', f'{nombre} deja de liderar {unidad}')
    flash(f'{nombre} ya no lidera {unidad}.', 'success')
    return redirect(url_for('admin.organizacion'))


@admin_bp.route('/organizacion/superior', methods=['POST'])
@admin_required
def organizacion_superior():
    from services.alcance import invalidar_cache_alcance, personas_a_cargo

    try:
        user_id = int(request.form.get('user_id', ''))
    except (TypeError, ValueError):
        return redirect(url_for('admin.organizacion'))

    usuario = db.session.get(User, user_id)
    if usuario is None:
        flash('Persona no encontrada.', 'error')
        return redirect(url_for('admin.organizacion'))

    crudo = (request.form.get('manager_id') or '').strip()
    if not crudo:
        usuario.manager_id = None
        db.session.commit()
        invalidar_cache_alcance()
        log_activity('manager_clear', f'{usuario.username} ya no reporta a nadie')
        flash(f'{usuario.username} ya no reporta a nadie.', 'success')
        return redirect(url_for('admin.organizacion'))

    try:
        manager_id = int(crudo)
    except ValueError:
        return redirect(url_for('admin.organizacion'))

    if manager_id == user_id:
        flash('Nadie puede ser su propio superior.', 'error')
        return redirect(url_for('admin.organizacion'))

    jefe = db.session.get(User, manager_id)
    if jefe is None:
        flash('Superior no encontrado.', 'error')
        return redirect(url_for('admin.organizacion'))

    # Un ciclo no se ve venir desde la interfaz: si el jefe elegido ya cuelga
    # de esta persona, asignarlo cierra el bucle. El resolvedor lo sobrevive,
    # pero la organizacion resultante no significa nada.
    if manager_id in personas_a_cargo(usuario):
        flash(f'{jefe.username} ya esta por debajo de {usuario.username}: '
              'asignarlo crearia un bucle en la cadena de mando.', 'error')
        return redirect(url_for('admin.organizacion'))

    usuario.manager_id = manager_id
    db.session.commit()
    invalidar_cache_alcance()
    log_activity('manager_set', f'{usuario.username} reporta a {jefe.username}')
    flash(f'{usuario.username} ahora reporta a {jefe.username}.', 'success')
    return redirect(url_for('admin.organizacion'))


# ─────────────────────────────────────────────────────────────
# Plantillas PowerPoint
# ─────────────────────────────────────────────────────────────
#
# Se guardan en la base y no en disco: el contenedor tiene almacenamiento
# efimero, asi que una plantilla dejada en powerpoints/ desaparece en el
# siguiente despliegue. Las que vienen en el repositorio se siguen listando y
# usando, pero no se pueden borrar desde aqui — para eso hay que tocar el
# repositorio, que es donde viven.

MAX_TEMPLATE_BYTES = 15 * 1024 * 1024


def _es_pptx_de_verdad(contenido):
    """Comprueba la estructura, no la extension.

    Un .pptx es un zip con un [Content_Types].xml y al menos una parte de
    presentacion. Fiarse del nombre deja subir cualquier cosa renombrada.
    """
    import io as _io
    import zipfile as _zipfile

    try:
        with _zipfile.ZipFile(_io.BytesIO(contenido)) as z:
            nombres = z.namelist()
    except _zipfile.BadZipFile:
        return False

    if '[Content_Types].xml' not in nombres:
        return False
    return any(n.startswith('ppt/') for n in nombres)


@admin_bp.route('/plantillas')
@admin_required
def plantillas_list():
    from models import PptxTemplate
    import app as app_module

    subidas = PptxTemplate.query.order_by(PptxTemplate.name).all()
    nombres_subidos = {t.name for t in subidas}
    del_repositorio = [n for n in app_module._templates_del_repositorio()
                       if n not in nombres_subidos]

    return render_template('admin_plantillas.html',
                           subidas=subidas,
                           del_repositorio=del_repositorio,
                           max_mb=MAX_TEMPLATE_BYTES // (1024 * 1024))


@admin_bp.route('/plantillas/subir', methods=['POST'])
@admin_required
def plantilla_upload():
    from models import PptxTemplate

    archivo = request.files.get('plantilla')
    if not archivo or not archivo.filename:
        flash('Selecciona un archivo .pptx.', 'error')
        return redirect(url_for('admin.plantillas_list'))

    nombre = secure_filename(os.path.basename(archivo.filename))
    if not nombre.lower().endswith('.pptx'):
        flash('El archivo debe ser un .pptx.', 'error')
        return redirect(url_for('admin.plantillas_list'))

    contenido = archivo.read()
    if len(contenido) > MAX_TEMPLATE_BYTES:
        limite = MAX_TEMPLATE_BYTES // (1024 * 1024)
        flash(f'La plantilla pesa {len(contenido) // (1024 * 1024)} MB y el limite es {limite} MB.', 'error')
        return redirect(url_for('admin.plantillas_list'))

    if not _es_pptx_de_verdad(contenido):
        flash('El archivo no es un PowerPoint valido, aunque se llame .pptx.', 'error')
        return redirect(url_for('admin.plantillas_list'))

    existente = PptxTemplate.query.filter_by(name=nombre).first()
    if existente is not None:
        existente.data = contenido
        existente.size_bytes = len(contenido)
        existente.uploaded_by_id = current_user.id
        accion, verbo = 'pptx_template_replace', 'reemplazada'
    else:
        db.session.add(PptxTemplate(name=nombre, data=contenido, size_bytes=len(contenido),
                                    uploaded_by_id=current_user.id))
        accion, verbo = 'pptx_template_upload', 'subida'

    db.session.commit()
    log_activity(accion, f'Plantilla {verbo}: {nombre} ({len(contenido) // 1024} KB)')
    flash(f'Plantilla "{nombre}" {verbo}.', 'success')
    return redirect(url_for('admin.plantillas_list'))


@admin_bp.route('/plantillas/<int:template_id>/eliminar', methods=['POST'])
@admin_required
def plantilla_delete(template_id):
    from models import PptxTemplate

    plantilla = PptxTemplate.query.get_or_404(template_id)
    nombre = plantilla.name
    db.session.delete(plantilla)
    db.session.commit()
    log_activity('pptx_template_delete', f'Plantilla eliminada: {nombre}')
    flash(f'Plantilla "{nombre}" eliminada.', 'success')
    return redirect(url_for('admin.plantillas_list'))


@admin_bp.route('/plantillas/<int:template_id>/descargar')
@admin_required
def plantilla_download(template_id):
    """Descargar la que esta en uso, para revisarla o partir de ella."""
    from flask import send_file
    from models import PptxTemplate

    plantilla = PptxTemplate.query.get_or_404(template_id)
    return send_file(
        io.BytesIO(plantilla.data),
        as_attachment=True,
        download_name=plantilla.name,
        mimetype='application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )


# ─────────────────────────────────────────────────────────────
# Catalogo de estados y prioridades de tarea
# ─────────────────────────────────────────────────────────────
#
# Editarlos era un despliegue. Las guardas de aqui existen porque el catalogo
# tiene condiciones que, si se rompen, dejan el sistema en un estado imposible:
# sin estado inicial no se puede crear una tarea, y sin estado final nada
# cuenta nunca como terminado.

def _tareas_con(columna, valor):
    """Cuantas tareas usan ese valor. La columna se pasa como texto controlado."""
    from sqlalchemy import text as _text
    try:
        fila = db.session.execute(
            _text(f'SELECT COUNT(*) FROM tasks WHERE {columna} = :v'), {'v': valor}
        ).fetchone()
        return fila[0] if fila else 0
    except Exception:
        return 0


@admin_bp.route('/catalogo')
@admin_required
def catalogo_list():
    from models import TaskStatus, TaskPriority

    estados = TaskStatus.query.order_by(TaskStatus.orden, TaskStatus.nombre).all()
    prioridades = TaskPriority.query.order_by(TaskPriority.orden.desc(), TaskPriority.nombre).all()

    return render_template(
        'admin_catalogo.html',
        estados=[(e, _tareas_con('status', e.nombre)) for e in estados],
        prioridades=[(p, _tareas_con('priority', p.nombre)) for p in prioridades],
        colores=['neutro', 'info', 'aviso', 'alerta', 'bien'],
    )


@admin_bp.route('/catalogo/estado', methods=['POST'])
@admin_required
def catalogo_estado_guardar():
    from models import TaskStatus
    from services.catalogo import invalidar_cache_catalogo

    estado_id = (request.form.get('id') or '').strip()
    nombre = (request.form.get('nombre') or '').strip()[:30]
    color = (request.form.get('color') or 'neutro').strip()[:20]
    es_final = request.form.get('es_final') == 'on'
    es_inicial = request.form.get('es_inicial') == 'on'
    try:
        orden = int(request.form.get('orden') or 0)
    except ValueError:
        orden = 0

    if not nombre:
        flash('El nombre es obligatorio.', 'error')
        return redirect(url_for('admin.catalogo_list'))

    duplicado = TaskStatus.query.filter(TaskStatus.nombre == nombre)
    if estado_id:
        duplicado = duplicado.filter(TaskStatus.id != int(estado_id))
    if duplicado.first():
        flash(f'Ya existe un estado llamado "{nombre}".', 'error')
        return redirect(url_for('admin.catalogo_list'))

    if estado_id:
        estado = TaskStatus.query.get_or_404(int(estado_id))
        anterior = estado.nombre

        # Quitar la ultima bandera final dejaria al sistema sin forma de dar una
        # tarea por terminada: vencimientos, carga e indicadores dependen de ella.
        if estado.es_final and not es_final:
            otros_finales = TaskStatus.query.filter(
                TaskStatus.es_final.is_(True), TaskStatus.id != estado.id).count()
            if otros_finales == 0:
                flash('Tiene que quedar al menos un estado que signifique "terminado".', 'error')
                return redirect(url_for('admin.catalogo_list'))

        estado.nombre, estado.color, estado.orden = nombre, color, orden
        estado.es_final, estado.es_inicial = es_final, es_inicial

        # La tarea guarda el nombre, no una clave: renombrar sin reescribir las
        # tareas las dejaria con un estado que ya no existe.
        movidas = 0
        if anterior != nombre:
            from sqlalchemy import text as _text
            resultado = db.session.execute(
                _text('UPDATE tasks SET status = :nuevo WHERE status = :viejo'),
                {'nuevo': nombre, 'viejo': anterior})
            movidas = resultado.rowcount or 0

        mensaje = f'Estado "{nombre}" actualizado.'
        if movidas:
            mensaje += f' Se renombraron {movidas} tarea(s).'
        accion = 'task_status_edit'
    else:
        estado = TaskStatus(nombre=nombre, color=color, orden=orden,
                            es_final=es_final, es_inicial=es_inicial)
        db.session.add(estado)
        mensaje = f'Estado "{nombre}" creado.'
        accion = 'task_status_create'

    # Inicial hay uno solo: marcar otro apaga el anterior.
    if es_inicial:
        db.session.flush()
        TaskStatus.query.filter(TaskStatus.id != estado.id).update({'es_inicial': False})

    db.session.commit()
    invalidar_cache_catalogo()
    log_activity(accion, mensaje)
    flash(mensaje, 'success')
    return redirect(url_for('admin.catalogo_list'))


@admin_bp.route('/catalogo/estado/<int:estado_id>/eliminar', methods=['POST'])
@admin_required
def catalogo_estado_eliminar(estado_id):
    from models import TaskStatus
    from services.catalogo import invalidar_cache_catalogo

    estado = TaskStatus.query.get_or_404(estado_id)

    en_uso = _tareas_con('status', estado.nombre)
    if en_uso:
        flash(f'No se puede eliminar: {en_uso} tarea(s) están en "{estado.nombre}". '
              'Muévelas antes de quitarlo.', 'error')
        return redirect(url_for('admin.catalogo_list'))

    if estado.es_final and TaskStatus.query.filter(
            TaskStatus.es_final.is_(True), TaskStatus.id != estado.id).count() == 0:
        flash('Es el único estado que significa "terminado": no se puede eliminar.', 'error')
        return redirect(url_for('admin.catalogo_list'))

    if TaskStatus.query.count() <= 1:
        flash('Tiene que quedar al menos un estado.', 'error')
        return redirect(url_for('admin.catalogo_list'))

    nombre = estado.nombre
    db.session.delete(estado)
    db.session.commit()
    invalidar_cache_catalogo()
    log_activity('task_status_delete', f'Estado eliminado: {nombre}')
    flash(f'Estado "{nombre}" eliminado.', 'success')
    return redirect(url_for('admin.catalogo_list'))


@admin_bp.route('/catalogo/prioridad', methods=['POST'])
@admin_required
def catalogo_prioridad_guardar():
    from models import TaskPriority
    from services.catalogo import invalidar_cache_catalogo

    prioridad_id = (request.form.get('id') or '').strip()
    nombre = (request.form.get('nombre') or '').strip()[:30]
    color = (request.form.get('color') or 'neutro').strip()[:20]
    es_defecto = request.form.get('es_defecto') == 'on'
    try:
        orden = int(request.form.get('orden') or 0)
    except ValueError:
        orden = 0

    if not nombre:
        flash('El nombre es obligatorio.', 'error')
        return redirect(url_for('admin.catalogo_list'))

    duplicado = TaskPriority.query.filter(TaskPriority.nombre == nombre)
    if prioridad_id:
        duplicado = duplicado.filter(TaskPriority.id != int(prioridad_id))
    if duplicado.first():
        flash(f'Ya existe una prioridad llamada "{nombre}".', 'error')
        return redirect(url_for('admin.catalogo_list'))

    if prioridad_id:
        prioridad = TaskPriority.query.get_or_404(int(prioridad_id))
        anterior = prioridad.nombre
        prioridad.nombre, prioridad.color, prioridad.orden = nombre, color, orden
        prioridad.es_defecto = es_defecto

        movidas = 0
        if anterior != nombre:
            from sqlalchemy import text as _text
            resultado = db.session.execute(
                _text('UPDATE tasks SET priority = :nuevo WHERE priority = :viejo'),
                {'nuevo': nombre, 'viejo': anterior})
            movidas = resultado.rowcount or 0

        mensaje = f'Prioridad "{nombre}" actualizada.'
        if movidas:
            mensaje += f' Se renombraron {movidas} tarea(s).'
        accion = 'task_priority_edit'
    else:
        prioridad = TaskPriority(nombre=nombre, color=color, orden=orden, es_defecto=es_defecto)
        db.session.add(prioridad)
        mensaje = f'Prioridad "{nombre}" creada.'
        accion = 'task_priority_create'

    if es_defecto:
        db.session.flush()
        TaskPriority.query.filter(TaskPriority.id != prioridad.id).update({'es_defecto': False})

    db.session.commit()
    invalidar_cache_catalogo()
    log_activity(accion, mensaje)
    flash(mensaje, 'success')
    return redirect(url_for('admin.catalogo_list'))


@admin_bp.route('/catalogo/prioridad/<int:prioridad_id>/eliminar', methods=['POST'])
@admin_required
def catalogo_prioridad_eliminar(prioridad_id):
    from models import TaskPriority
    from services.catalogo import invalidar_cache_catalogo

    prioridad = TaskPriority.query.get_or_404(prioridad_id)

    en_uso = _tareas_con('priority', prioridad.nombre)
    if en_uso:
        flash(f'No se puede eliminar: {en_uso} tarea(s) tienen prioridad "{prioridad.nombre}".',
              'error')
        return redirect(url_for('admin.catalogo_list'))

    if TaskPriority.query.count() <= 1:
        flash('Tiene que quedar al menos una prioridad.', 'error')
        return redirect(url_for('admin.catalogo_list'))

    nombre = prioridad.nombre
    db.session.delete(prioridad)
    db.session.commit()
    invalidar_cache_catalogo()
    log_activity('task_priority_delete', f'Prioridad eliminada: {nombre}')
    flash(f'Prioridad "{nombre}" eliminada.', 'success')
    return redirect(url_for('admin.catalogo_list'))


# ─────────────────────────────────────────────────────────────
# Conexiones a proveedores de IA
# ─────────────────────────────────────────────────────────────

# Tarifas de referencia de Anthropic (USD por millon de tokens), para
# precargar el formulario. Los precios de Groq y OpenAI no se incluyen: no
# tenerlos verificados es mejor que arriesgar un coste inventado, asi que ahi
# el administrador teclea la tarifa.
PRECIOS_CONOCIDOS = {
    'claude-opus-5': (5.00, 25.00),
    'claude-opus-4-8': (5.00, 25.00),
    'claude-sonnet-5': (3.00, 15.00),
    'claude-sonnet-4-6': (3.00, 15.00),
    'claude-haiku-4-5': (1.00, 5.00),
    'claude-fable-5': (10.00, 50.00),
}


@admin_bp.route('/ia')
@admin_required
def ia_list():
    from sqlalchemy import func
    from models import AIProvider, AIUsage
    from services import ai_provider as ia

    conexiones = AIProvider.query.order_by(AIProvider.name).all()

    # Consumo agregado por modelo. Se agrupa por modelo y no por conexion
    # porque la pregunta es "cuanto me cuesta este modelo", y una conexion
    # borrada no debe llevarse su historico por delante.
    filas = (
        db.session.query(
            AIUsage.provider,
            AIUsage.model,
            func.count(AIUsage.id).label('llamadas'),
            func.sum(AIUsage.tokens_in).label('tokens_in'),
            func.sum(AIUsage.tokens_out).label('tokens_out'),
            func.sum(AIUsage.cost_usd).label('coste'),
            func.max(AIUsage.created_at).label('ultima'),
        )
        .group_by(AIUsage.provider, AIUsage.model)
        .order_by(func.sum(AIUsage.cost_usd).desc())
        .all()
    )

    fallos = dict(
        db.session.query(AIUsage.model, func.count(AIUsage.id))
        .filter(AIUsage.ok.is_(False))
        .group_by(AIUsage.model).all()
    )

    consumo = [{
        'provider': f.provider,
        'model': f.model,
        'llamadas': f.llamadas or 0,
        'tokens_in': f.tokens_in or 0,
        'tokens_out': f.tokens_out or 0,
        'coste': f.coste or 0.0,
        'ultima': f.ultima,
        'fallos': fallos.get(f.model, 0),
    } for f in filas]

    totales = {
        'llamadas': sum(c['llamadas'] for c in consumo),
        'tokens_in': sum(c['tokens_in'] for c in consumo),
        'tokens_out': sum(c['tokens_out'] for c in consumo),
        'coste': sum(c['coste'] for c in consumo),
    }

    por_uso = (
        db.session.query(
            AIUsage.feature,
            func.count(AIUsage.id),
            func.sum(AIUsage.cost_usd),
        ).group_by(AIUsage.feature).all()
    )

    return render_template('admin_ia.html',
                           conexiones=conexiones,
                           proveedores=ia.SUPPORTED_PROVIDERS,
                           hay_fallback_env=bool(os.getenv('GROQ_API_KEY')),
                           consumo=consumo,
                           totales=totales,
                           por_uso=por_uso,
                           precios_conocidos=PRECIOS_CONOCIDOS)


@admin_bp.route('/ia/guardar', methods=['POST'])
@admin_required
def ia_save():
    from models import AIProvider
    from services import ai_provider as ia

    nombre = (request.form.get('name') or '').strip()
    proveedor = (request.form.get('provider') or '').strip().lower()
    modelo = (request.form.get('model') or '').strip()
    clave = (request.form.get('api_key') or '').strip()
    conexion_id = request.form.get('conexion_id')

    def _precio(campo):
        crudo = (request.form.get(campo) or '').strip().replace(',', '.')
        try:
            return max(0.0, float(crudo)) if crudo else 0.0
        except ValueError:
            return 0.0

    precio_in = _precio('price_in_per_1m')
    precio_out = _precio('price_out_per_1m')

    if not nombre or not modelo:
        flash('El nombre y el modelo son obligatorios.', 'error')
        return redirect(url_for('admin.ia_list'))

    if proveedor not in ia.SUPPORTED_PROVIDERS:
        flash(f'Proveedor no soportado: {proveedor}.', 'error')
        return redirect(url_for('admin.ia_list'))

    if conexion_id:
        conexion = AIProvider.query.get_or_404(int(conexion_id))
        # Una clave vacia al editar significa "conserva la que ya estaba":
        # asi se puede corregir el modelo sin volver a teclear el secreto.
        if clave:
            conexion.api_key = clave
        conexion.name = nombre
        conexion.provider = proveedor
        conexion.model = modelo
        conexion.price_in_per_1m = precio_in
        conexion.price_out_per_1m = precio_out
        accion, verbo = 'ai_provider_edit', 'actualizada'
    else:
        if not clave:
            flash('La clave API es obligatoria al crear una conexion.', 'error')
            return redirect(url_for('admin.ia_list'))
        if AIProvider.query.filter_by(name=nombre).first():
            flash(f'Ya existe una conexion llamada "{nombre}".', 'error')
            return redirect(url_for('admin.ia_list'))
        conexion = AIProvider(name=nombre, provider=proveedor, model=modelo,
                              api_key=clave, created_by_id=current_user.id,
                              price_in_per_1m=precio_in, price_out_per_1m=precio_out)
        db.session.add(conexion)
        accion, verbo = 'ai_provider_create', 'creada'

    db.session.commit()
    # La clave nunca entra en el registro de actividad.
    log_activity(accion, f'Conexion IA {verbo}: {nombre} ({proveedor}/{modelo})')
    flash(f'Conexion "{nombre}" {verbo}.', 'success')
    return redirect(url_for('admin.ia_list'))


@admin_bp.route('/ia/<int:conexion_id>/activar', methods=['POST'])
@admin_required
def ia_activate(conexion_id):
    from models import AIProvider

    conexion = AIProvider.query.get_or_404(conexion_id)
    # Solo una conexion activa a la vez: es la que resuelve ai_provider.complete().
    AIProvider.query.update({AIProvider.is_active: False})
    conexion.is_active = True
    db.session.commit()
    log_activity('ai_provider_activate', f'Conexion IA activada: {conexion.name}')
    flash(f'"{conexion.name}" es ahora la conexion activa.', 'success')
    return redirect(url_for('admin.ia_list'))


@admin_bp.route('/ia/<int:conexion_id>/desactivar', methods=['POST'])
@admin_required
def ia_deactivate(conexion_id):
    from models import AIProvider

    conexion = AIProvider.query.get_or_404(conexion_id)
    conexion.is_active = False
    db.session.commit()
    log_activity('ai_provider_deactivate', f'Conexion IA desactivada: {conexion.name}')
    flash(f'"{conexion.name}" desactivada. Las funciones de IA quedan en pausa.', 'success')
    return redirect(url_for('admin.ia_list'))


@admin_bp.route('/ia/<int:conexion_id>/probar', methods=['POST'])
@admin_required
def ia_test(conexion_id):
    from models import AIProvider
    from services import ai_provider as ia

    conexion = AIProvider.query.get_or_404(conexion_id)
    ok, mensaje = ia.test_connection(conexion.provider, conexion.model, conexion.api_key)
    log_activity('ai_provider_test', f'Prueba de conexion IA {conexion.name}: {"ok" if ok else "fallo"}')
    flash(f'{conexion.name}: {mensaje}', 'success' if ok else 'error')
    return redirect(url_for('admin.ia_list'))


@admin_bp.route('/ia/<int:conexion_id>/eliminar', methods=['POST'])
@admin_required
def ia_delete(conexion_id):
    from models import AIProvider

    conexion = AIProvider.query.get_or_404(conexion_id)
    nombre = conexion.name
    db.session.delete(conexion)
    db.session.commit()
    log_activity('ai_provider_delete', f'Conexion IA eliminada: {nombre}')
    flash(f'Conexion "{nombre}" eliminada.', 'success')
    return redirect(url_for('admin.ia_list'))
