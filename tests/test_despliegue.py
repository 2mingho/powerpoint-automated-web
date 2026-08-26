"""
Lo que tiene que cumplirse para que un despliegue sea seguro.

No prueban logica de negocio: prueban que la caja en la que va el negocio esta
bien cerrada. Cada una corresponde a un fallo que se puede colar sin que nadie
lo note hasta que ya esta en produccion.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_despliegue.db')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent


@pytest.fixture
def client():
    app = app_module.app
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    with app.app_context():
        db.drop_all()
        db.create_all()
    with app.test_client() as test_client:
        yield test_client


# ─────────────────────────────────────────────────────────────
# Sonda de salud
# ─────────────────────────────────────────────────────────────

def test_healthz_responde_sin_sesion(client):
    """La sonda la llama el orquestador, que no trae cookies."""
    respuesta = client.get('/healthz')

    assert respuesta.status_code == 200
    assert respuesta.get_json()['status'] == 'ok'


def test_healthz_falla_si_la_base_no_responde(client, monkeypatch):
    """Un proceso vivo con la conexion perdida es justo el que hay que sacar
    del balanceador. Responder 200 mirando solo si el puerto acepta lo dejaria
    recibiendo trafico."""
    def _explota(*args, **kwargs):
        raise RuntimeError('conexion perdida')

    monkeypatch.setattr(db.session, 'execute', _explota)
    respuesta = client.get('/healthz')

    assert respuesta.status_code == 503
    assert respuesta.get_json()['status'] == 'error'


def test_healthz_no_filtra_el_motivo_del_fallo(client, monkeypatch):
    """Es un punto sin autenticar: el detalle del error va al log, no al
    cuerpo de la respuesta."""
    def _explota(*args, **kwargs):
        raise RuntimeError('password authentication failed for user "newlink"')

    monkeypatch.setattr(db.session, 'execute', _explota)
    cuerpo = client.get('/healthz').get_data(as_text=True)

    assert 'password' not in cuerpo
    assert 'newlink' not in cuerpo


# ─────────────────────────────────────────────────────────────
# Imagen
# ─────────────────────────────────────────────────────────────

SECRETOS_Y_LOCALES = ['.env', 'venv/', 'instance/', '.git/', '*.db']


@pytest.mark.parametrize('patron', SECRETOS_Y_LOCALES)
def test_dockerignore_excluye_lo_que_no_debe_viajar(patron):
    """El Dockerfile hace `COPY . .` y Docker no lee .gitignore.

    Sin estas exclusiones la imagen se lleva el SECRET_KEY dentro, y con el se
    firman las cookies de sesion: quien pueda hacer pull se autentica como
    cualquier usuario.
    """
    contenido = (RAIZ / '.dockerignore').read_text()
    lineas = {l.strip() for l in contenido.splitlines() if l.strip() and not l.startswith('#')}

    assert patron in lineas, f'.dockerignore no excluye {patron}'


def test_las_dependencias_estan_fijadas():
    """Sin versiones fijas, dos construcciones de la misma imagen instalan
    cosas distintas y un despliegue puede romperse sin que nadie toque el
    codigo."""
    contenido = (RAIZ / 'requirements.txt').read_text()
    sueltas = [
        linea.strip() for linea in contenido.splitlines()
        if linea.strip() and not linea.startswith('#') and '==' not in linea
    ]

    assert not sueltas, f'dependencias sin fijar: {sueltas}'


def test_el_arranque_aplica_migraciones():
    """Si el entrypoint dejara de migrar, produccion correria codigo nuevo
    contra un esquema viejo. Ya paso una vez."""
    entrypoint = (RAIZ / 'docker-entrypoint.sh').read_text()

    assert 'flask db upgrade' in entrypoint
    assert 'set -e' in entrypoint, 'sin set -e el contenedor sirve aunque la migracion falle'


# ─────────────────────────────────────────────────────────────
# Arranque en limpio
# ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize('argv, salta', [
    (['/usr/local/bin/flask', 'db', 'upgrade'], True),
    (['flask', 'db', 'upgrade'], True),
    (['/x/site-packages/flask/__main__.py', 'db', 'migrate'], True),
    (['/usr/local/bin/gunicorn', 'app:app'], False),
    (['/usr/local/bin/flask', 'run'], False),
    (['/usr/local/bin/flask', 'schema-check'], False),
    (['pytest'], False),
])
def test_las_tareas_de_arranque_se_saltan_al_migrar(argv, salta, monkeypatch):
    """Alembic importa la aplicacion, y al importarla se sembraba el admin.

    Sembrarlo consulta la tabla users; sobre una base vacia esa consulta falla
    y tumba el propio `flask db upgrade` que iba a crearla, antes de aplicar
    una sola migracion. La aplicacion no podia inicializar una base nueva: ni
    un entorno de pruebas, ni un despliegue en limpio, ni restaurar una copia
    de seguridad. En produccion no se veia porque sus tablas ya existian.

    Servir NO debe saltarselas: ahi el sembrado del admin es lo que hace que
    un despliegue nuevo tenga con quien entrar.
    """
    monkeypatch.setattr('sys.argv', argv)

    assert app_module._es_comando_de_migracion() is salta


def test_migrar_no_depende_de_recordar_una_variable():
    """La necesidad estaba documentada, pero dependia de que quien lanzara el
    comando exportara SKIP_STARTUP_TASKS — y el entrypoint del contenedor no
    lo hacia. Si alguien vuelve a atar la deteccion solo a la variable, esto
    lo caza."""
    fuente = (RAIZ / 'app.py').read_text()
    declaracion = next(
        linea for linea in fuente.splitlines()
        if linea.startswith('SKIP_STARTUP_TASKS =')
    )

    assert '_es_comando_de_migracion()' in declaracion, declaracion


# ─────────────────────────────────────────────────────────────
# Migraciones
# ─────────────────────────────────────────────────────────────

def test_la_cadena_de_migraciones_tiene_una_sola_cabeza():
    """Dos cabezas hacen que `flask db upgrade` falle en el despliegue, no
    antes. Se detecta aqui, que es donde todavia es barato."""
    entorno = {
        **os.environ,
        'FLASK_APP': 'app.py',
        'SKIP_STARTUP_TASKS': '1',
        'SQLALCHEMY_DATABASE_URI': 'sqlite:///test_heads.db',
    }
    salida = subprocess.run(
        [sys.executable, '-m', 'flask', 'db', 'heads'],
        cwd=RAIZ, env=entorno, capture_output=True, text=True,
    )

    cabezas = [l for l in salida.stdout.splitlines() if '(head)' in l]
    assert len(cabezas) == 1, f'la cadena tiene {len(cabezas)} cabezas:\n{salida.stdout}'
