from flask import Blueprint, render_template, request, redirect, url_for, flash
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import login_user, logout_user, login_required
from models import User
from extensions import db, login_manager

auth = Blueprint('auth', __name__)

@auth.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        email = request.form['email']
        password = request.form['password']

        if User.query.filter_by(email=email).first():
            flash('El correo ya está registrado. Inicia sesión.', category='error')
            return redirect(url_for('auth.login'))

        hashed_pw = generate_password_hash(password, method='sha256')
        new_user = User(username=username, email=email, password=hashed_pw)

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
        return redirect(url_for('index'))

    return render_template('login.html')

@auth.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Has cerrado sesión.', category='success')
    return redirect(url_for('auth.login'))