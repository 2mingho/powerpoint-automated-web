"""FLASK_SOLO_INTERNO: el interruptor del corte. Con el, Flask solo sirve /api/interno y /healthz."""
import os

import pytest

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_solo_interno.db')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402


@pytest.fixture
def client():
    app = app_module.app
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False, RATELIMIT_ENABLED=False)
    with app.app_context():
        db.drop_all()
        db.create_all()
    with app.test_client() as c:
        yield c
    app.config['SOLO_INTERNO'] = False


def _encender(valor=True):
    app_module.app.config['SOLO_INTERNO'] = valor


PANTALLAS_Y_API_VIEJA = ['/', '/login', '/tasks', '/tasks/team-dashboard', '/admin/users', '/api/tasks', '/api/tasks/clients',
                         '/static/js/tasks.js', '/clasificacion', '/api/notifications', '/logout']


@pytest.mark.parametrize('ruta', PANTALLAS_Y_API_VIEJA)
def test_encendido_las_pantallas_y_la_api_vieja_responden_404(client, ruta):
    _encender()
    r = client.get(ruta)
    assert r.status_code == 404
    assert 'ya no sirve la interfaz web' in r.get_json()['error']


@pytest.mark.parametrize('metodo', ['post', 'put', 'delete', 'patch'])
def test_encendido_tampoco_acepta_escrituras(client, metodo):
    _encender()
    assert getattr(client, metodo)('/api/tasks', json={}).status_code == 404
    assert getattr(client, metodo)('/login', json={}).status_code == 404


def test_encendido_healthz_y_la_api_interna_siguen(client):
    _encender()
    assert client.get('/healthz').status_code == 200
    # La API interna llega a su propia puerta (token de servicio): 401, no 404.
    r = client.get('/api/interno/trabajos/inexistente')
    assert r.status_code == 401


def test_apagado_todo_sigue_como_antes(client):
    _encender(False)
    assert client.get('/login').status_code == 200
    assert client.get('/healthz').status_code == 200


def test_el_interruptor_se_lee_en_cada_peticion(client):
    _encender()
    assert client.get('/login').status_code == 404
    _encender(False)
    assert client.get('/login').status_code == 200


def test_por_defecto_viene_apagado():
    assert app_module._env_bool('FLASK_SOLO_INTERNO_QUE_NO_EXISTE', False) is False


def test_con_https_forzado_las_rutas_viejas_dan_404_y_no_una_redireccion(client):
    """En produccion Talisman redirige HTTP a HTTPS; el interruptor debe contestar antes, o por HTTP interno
    cualquier ruta vieja acabaria en una redireccion a un https que no existe en la red del stack."""
    talisman = app_module.talisman
    previo = talisman.force_https
    talisman.force_https = True
    try:
        _encender()
        for ruta in ('/login', '/tasks', '/'):
            r = client.get(ruta)
            assert r.status_code == 404, (ruta, r.status_code, r.headers.get('Location'))
    finally:
        talisman.force_https = previo
