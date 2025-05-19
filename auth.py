from flask import Blueprint, render_template, request, redirect, url_for, flash, abort
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import login_user, logout_user, login_required, current_user
from models import User
from extensions import db, login_manager
from functools import wraps

auth = Blueprint('auth', __name__)

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or current_user.rol != 'admin':
            flash('Acceso denegado. Solo para administradores.', 'error')
            return redirect(url_for('menu'))
        return f(*args, **kwargs)
    return decorated_function

@auth.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        email = request.form['email']
        password = request.form['password']

        # Verificar si el correo ya existe
        if User.query.filter_by(email=email).first():
            flash('El correo ya está registrado. Inicia sesión.', category='error')
            return redirect(url_for('auth.login'))

        hashed_pw = generate_password_hash(password, method='pbkdf2:sha256')

        # Puedes cambiar el rol a 'admin' manualmente si deseas
        new_user = User(username=username, email=email, password=hashed_pw, rol='user')

        db.session.add(new_user)
        db.session.commit()

        flash('Registro exitoso. Ahora puedes iniciar sesión.', category='success')
        return redirect(url_for('auth.login'))

    return render_template('register.html')

@auth.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']

        user = User.query.filter_by(email=email).first()

        if not user or not check_password_hash(user.password, password):
            flash('Credenciales incorrectas', category='error')
            return redirect(url_for('auth.login'))

        login_user(user)

        # Mensaje opcional según el rol
        if user.is_admin():
            flash('Bienvenido, administrador.', category='info')
        else:
            flash('Inicio de sesión exitoso.', category='success')

        return redirect(url_for('menu'))

    return render_template('login.html')

@auth.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Has cerrado sesión.', category='warning')
    return redirect(url_for('auth.login'))