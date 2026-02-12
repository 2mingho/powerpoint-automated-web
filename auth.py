from flask import Blueprint, render_template, request, redirect, url_for, flash
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import login_user, logout_user, login_required
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import re
from models import User
from extensions import db, login_manager

auth = Blueprint('auth', __name__)

# Rate limiter
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

@auth.route('/register', methods=['GET', 'POST'])
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

        hashed_pw = generate_password_hash(password, method='pbkdf2:sha256')
        new_user = User(username=username, email=email, password=hashed_pw)

        db.session.add(new_user)
        db.session.commit()

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

        login_user(user)
        return redirect(url_for('menu'))

    return render_template('login.html')

@auth.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Has cerrado sesión.', category='warning')
    return redirect(url_for('auth.login'))