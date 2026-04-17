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
# Legacy redirect - all admin routes now point to the new CLI
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/')
@login_required
def admin_redirect():
    flash('El panel de administracion antiguo ha sido migrado a la nueva terminal CLI.', 'info')
    return redirect(url_for('admin_v2.cli_terminal'))


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

@admin_bp.route('/dashboard')
@admin_required
def dashboard():
    return redirect(url_for('admin_v2.cli_terminal'))


# ─────────────────────────────────────────────────────────────
# User List
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users')
@admin_required
def users_list():
    return redirect(url_for('admin_v2.cli_terminal'))


# ─────────────────────────────────────────────────────────────
# Create User
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/new')
@admin_required
def user_create():
    return redirect(url_for('admin_v2.cli_terminal'))


# ─────────────────────────────────────────────────────────────
# Edit User
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/<int:user_id>/edit')
@admin_required
def user_edit(user_id):
    return redirect(url_for('admin_v2.cli_terminal'))


# ─────────────────────────────────────────────────────────────
# Toggle Active / Deactivate
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/<int:user_id>/toggle')
@admin_required
def user_toggle(user_id):
    return redirect(url_for('admin_v2.cli_terminal'))


# ─────────────────────────────────────────────────────────────
# Soft Delete
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/<int:user_id>/delete')
@admin_required
def user_delete(user_id):
    return redirect(url_for('admin_v2.cli_terminal'))


# ─────────────────────────────────────────────────────────────
# Activity Log
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/activity')
@admin_required
def activity_log():
    return redirect(url_for('admin_v2.cli_terminal'))


@admin_bp.route('/activity/<int:user_id>')
@admin_required
def user_activity(user_id):
    return redirect(url_for('admin_v2.cli_terminal'))


# ─────────────────────────────────────────────────────────────
# Session Control (Kick / Impersonate)
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/users/<int:user_id>/kick')
@admin_required
def user_kick(user_id):
    return redirect(url_for('admin_v2.cli_terminal'))


@admin_bp.route('/users/<int:user_id>/impersonate')
@admin_required
def user_impersonate(user_id):
    return redirect(url_for('admin_v2.cli_terminal'))


@admin_bp.route('/stop-impersonation')
@login_required
def stop_impersonation():
    return redirect(url_for('admin_v2.cli_terminal'))


# ─────────────────────────────────────────────────────────────
# Role Management CRUD
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/roles')
@admin_required
def roles_list():
    return redirect(url_for('admin_v2.cli_terminal'))


@admin_bp.route('/roles/create')
@admin_required
def role_create():
    return redirect(url_for('admin_v2.cli_terminal'))


@admin_bp.route('/roles/<int:role_id>/edit')
@admin_required
def role_edit(role_id):
    return redirect(url_for('admin_v2.cli_terminal'))


@admin_bp.route('/roles/<int:role_id>/delete')
@admin_required
def role_delete(role_id):
    return redirect(url_for('admin_v2.cli_terminal'))


# ─────────────────────────────────────────────────────────────
# Area Management CRUD
# ─────────────────────────────────────────────────────────────

@admin_bp.route('/areas')
@admin_required
def areas_list():
    return redirect(url_for('admin_v2.cli_terminal'))


@admin_bp.route('/areas/create')
@admin_required
def area_create():
    return redirect(url_for('admin_v2.cli_terminal'))


@admin_bp.route('/areas/<int:area_id>/edit')
@admin_required
def area_edit(area_id):
    return redirect(url_for('admin_v2.cli_terminal'))


@admin_bp.route('/areas/<int:area_id>/delete')
@admin_required
def area_delete(area_id):
    return redirect(url_for('admin_v2.cli_terminal'))