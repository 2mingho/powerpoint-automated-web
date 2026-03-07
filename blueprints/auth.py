from flask import Blueprint, render_template, request, redirect, url_for, flash
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import login_user, logout_user, login_required, current_user
import re
from models import User
from extensions import db, login_manager, limiter

auth = Blueprint('auth', __name__)


@auth.route('/register', methods=['GET', 'POST'])
@limiter.limit("10 per hour")
def register():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')

        # Input validation (S6)
        if not username or len(username) < 3 or len(username) > 50:
            flash('El nombre de usuario debe tener entre 3 y 50 caracteres.', category='error')
            return redirect(url_for('auth.register'))
        
        if not email or not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
            flash('Por favor ingresa un correo electrónico válido.', category='error')
            return redirect(url_for('auth.register'))
        
        if not password or len(password) < 8:
            flash('La contraseña debe tener al menos 8 caracteres.', category='error')
            return redirect(url_for('auth.register'))

        if User.query.filter_by(email=email).first():
            flash('El correo ya está registrado. Inicia sesión.', category='error')
            return redirect(url_for('auth.login'))

        hashed_pw = generate_password_hash(password, method='scrypt')
        new_user = User(username=username, email=email, password=hashed_pw)

        db.session.add(new_user)
        db.session.commit()

        # Log registration
        from blueprints.admin import log_activity
        log_activity('register', f'Nuevo usuario registrado: {username}', user_id=new_user.id)

        flash('Registro exitoso. Ahora puedes iniciar sesión.', category='success')
        return redirect(url_for('auth.login'))

    return render_template('register.html')

@auth.route('/login', methods=['GET', 'POST'])
@limiter.limit("5 per minute")  # Rate limiting (S5)
def login():
    if request.method == 'POST':
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')

        user = User.query.filter_by(email=email).first()
        if not user or not check_password_hash(user.password, password):
            flash('Credenciales incorrectas', category='error')
            return redirect(url_for('auth.login'))

        # Check if user is active
        if not user.is_active:
            flash('Tu cuenta ha sido desactivada. Contacta al administrador.', category='error')
            return redirect(url_for('auth.login'))

        login_user(user)

        # Log login
        from blueprints.admin import log_activity
        log_activity('login', f'Inicio de sesión: {user.username}', user_id=user.id)

        return redirect(url_for('menu'))

    return render_template('login.html')

@auth.route('/logout')
@login_required
def logout():
    # Log logout before clearing session
    from blueprints.admin import log_activity
    log_activity('logout', f'Cierre de sesión: {current_user.username}')

    logout_user()
    flash('Has cerrado sesión.', category='warning')
    return redirect(url_for('auth.login'))