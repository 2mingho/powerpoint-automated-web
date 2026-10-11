"""
El tour de bienvenida, por el lado del servidor.

El recorrido en si es JavaScript y se comprueba en el navegador. Lo que se
prueba aqui es lo unico que toca datos: la marca de "ya lo vio", quien puede
cambiarla y a quien se le ofrece.
"""
import os

import pytest
from werkzeug.security import generate_password_hash

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_tour.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402
from models import User  # noqa: E402


def _login_as(client, user_id):
    with client.session_transaction() as session:
        session['_user_id'] = str(user_id)
        session['_fresh'] = True


@pytest.fixture
def client():
    app = app_module.app
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    with app.app_context():
        db.drop_all()
        db.create_all()
    with app.test_client() as test_client:
        yield test_client


@pytest.fixture
def usuario(client):
    with app_module.app.app_context():
        user = User(
            username='nuevo',
            email='nuevo@ejemplo.com',
            password=generate_password_hash('clave-de-prueba', method='scrypt'),
            role='analista',
            is_active=True,
        )
        user.set_allowed_tools(['tasks'])
        db.session.add(user)
        db.session.commit()
        return user.id


def test_se_ofrece_a_quien_no_lo_ha_visto(client, usuario):
    """La marca la lee base.html en cada pagina para decidir si arrancarlo."""
    _login_as(client, usuario)
    pagina = client.get('/menu').get_data(as_text=True)

    assert 'data-tour-pendiente="1"' in pagina


def test_no_se_repite_una_vez_visto(client, usuario):
    """Salir a medias tambien cuenta: volver a ofrecerlo en cada carga seria
    una trampa, no una ayuda."""
    _login_as(client, usuario)
    assert client.post('/api/tour/completado').status_code == 200

    pagina = client.get('/menu').get_data(as_text=True)
    assert 'data-tour-pendiente' not in pagina


def test_se_puede_volver_a_ver(client, usuario):
    """Sin esto, quien lo cierre sin querer en su primer minuto se queda sin
    el para siempre."""
    _login_as(client, usuario)
    client.post('/api/tour/completado')
    assert client.post('/api/tour/reiniciar').status_code == 200

    pagina = client.get('/menu').get_data(as_text=True)
    assert 'data-tour-pendiente="1"' in pagina


def test_la_marca_es_de_cada_usuario(client, usuario):
    """Que uno lo termine no puede darlo por visto para los demas."""
    with app_module.app.app_context():
        otro = User(
            username='otro', email='otro@ejemplo.com',
            password=generate_password_hash('clave-de-prueba', method='scrypt'),
            role='analista', is_active=True,
        )
        db.session.add(otro)
        db.session.commit()
        otro_id = otro.id

    _login_as(client, usuario)
    client.post('/api/tour/completado')

    _login_as(client, otro_id)
    assert 'data-tour-pendiente="1"' in client.get('/menu').get_data(as_text=True)


@pytest.mark.parametrize('ruta', ['/api/tour/completado', '/api/tour/reiniciar'])
def test_sin_sesion_no_se_toca_nada(client, ruta):
    """Escriben en la fila de un usuario: sin sesion no hay usuario al que
    escribir."""
    respuesta = client.post(ruta, follow_redirects=False)

    assert respuesta.status_code in (302, 401)
