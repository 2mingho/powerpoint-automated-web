"""Migracion 0020: cargos fijos, administrador aparte y tres tipos de cliente."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

RAIZ = Path(__file__).resolve().parent.parent


def _cargar():
    spec = importlib.util.spec_from_file_location('mig_0020', RAIZ / 'migrations/versions/0020_roles_y_tipos_de_cliente.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MIG = _cargar()


def _preparar(c):
    c.execute(sa.text('PRAGMA foreign_keys=ON'))
    c.execute(sa.text('CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(50), role VARCHAR(20) NOT NULL, manager_id INTEGER)'))
    c.execute(sa.text('CREATE TABLE unit_leads (user_id INTEGER, area_id INTEGER)'))
    c.execute(sa.text('CREATE TABLE roles (id INTEGER PRIMARY KEY, code VARCHAR(30) UNIQUE NOT NULL, display_name VARCHAR(100) NOT NULL, description TEXT, created_at DATETIME)'))
    c.execute(sa.text('CREATE TABLE clients (id INTEGER PRIMARY KEY, name VARCHAR(50), client_type VARCHAR(40))'))
    c.execute(sa.text("INSERT INTO roles (code, display_name) VALUES ('DI', 'Data Intelligence'), ('MW', 'Media Watch')"))
    # 1 admin, 2 directora (su gerente es el 3), 3 gerente (lidera), 4 analista del gerente, 5 coordinadora (con gente a cargo, ninguna lider), 6 su analista
    c.execute(sa.text(
        "INSERT INTO users (id, username, role, manager_id) VALUES (1, 'admin', 'admin', NULL), (2, 'laura', 'DIR', NULL), (3, 'carlos', 'DI', 2), "
        "(4, 'ana', 'DI', 3), (5, 'coord', 'MW', NULL), (6, 'luis', 'MW', 5), (7, 'sola', 'COM', NULL)"))
    c.execute(sa.text('INSERT INTO unit_leads (user_id, area_id) VALUES (3, 10)'))
    c.execute(sa.text(
        "INSERT INTO clients (id, name, client_type) VALUES (1, 'a', 'Corporativo'), (2, 'b', 'Pyme'), (3, 'c', 'Gobierno'), (4, 'd', 'gobierno '), "
        "(5, 'e', 'Aerolinea'), (6, 'f', 'Interno'), (7, 'g', NULL), (8, 'h', ''), (9, 'i', '  '), (10, 'j', 'Público'), (11, 'k', 'Privado')"))


@pytest.fixture
def conn():
    motor = sa.create_engine('sqlite://')
    with motor.begin() as c:
        _preparar(c)
        with Operations.context(MigrationContext.configure(c)):
            MIG.upgrade()
        yield c


def _roles(conn):
    return dict(conn.execute(sa.text('SELECT username, role FROM users')).fetchall())


def test_administrar_pasa_a_su_casilla_y_el_valor_anterior_se_guarda(conn):
    filas = conn.execute(sa.text('SELECT username, is_admin, legacy_role FROM users ORDER BY id')).fetchall()
    assert filas == [('admin', 1, 'admin'), ('laura', 0, 'DIR'), ('carlos', 0, 'DI'), ('ana', 0, 'DI'), ('coord', 0, 'MW'), ('luis', 0, 'MW'), ('sola', 0, 'COM')]


def test_el_cargo_se_deduce_de_la_cadena_de_mando(conn):
    r = _roles(conn)
    assert r['carlos'] == 'gerente'        # lidera una unidad
    assert r['laura'] == 'director'        # tiene a un lider a su cargo
    assert r['coord'] == 'coordinador'     # tiene gente a su cargo, y ninguna lidera
    assert r['ana'] == 'analista' and r['luis'] == 'analista' and r['sola'] == 'analista'
    assert r['admin'] == 'analista'        # sin estructura: se revisa a mano


def test_el_catalogo_de_roles_queda_con_los_cinco(conn):
    assert conn.execute(sa.text('SELECT code FROM roles ORDER BY id')).scalars().all() == ['coordinador', 'analista', 'ejecutiva', 'gerente', 'director']
    assert conn.execute(sa.text("SELECT display_name FROM roles WHERE code = 'ejecutiva'")).scalar() == 'Ejecutiva'


@pytest.mark.parametrize('rol', ['admin', 'DI', 'Gerente', '', 'jefe'])
def test_la_base_rechaza_cualquier_otro_cargo(conn, rol):
    with pytest.raises(sa.exc.IntegrityError):
        conn.execute(sa.text('INSERT INTO users (username, role) VALUES (:u, :r)'), {'u': 'x', 'r': rol})


def test_los_tipos_de_cliente_se_llevan_a_los_tres(conn):
    tipos = dict(conn.execute(sa.text('SELECT name, client_type FROM clients')).fetchall())
    assert tipos == {'a': 'Privado', 'b': 'Privado', 'c': 'Público', 'd': 'Público', 'e': 'Privado', 'f': 'Interno', 'g': None, 'h': None, 'i': None, 'j': 'Público', 'k': 'Privado'}


@pytest.mark.parametrize('tipo', ['Corporativo', 'privado', 'Publico', '', 'Otro'])
def test_la_base_rechaza_otro_tipo_de_cliente(conn, tipo):
    with pytest.raises(sa.exc.IntegrityError):
        conn.execute(sa.text("INSERT INTO clients (name, client_type) VALUES ('z', :t)"), {'t': tipo})


def test_un_cliente_sin_tipo_vale(conn):
    conn.execute(sa.text("INSERT INTO clients (name, client_type) VALUES ('z', NULL)"))


def test_bajar_la_revision_devuelve_los_valores_anteriores():
    motor = sa.create_engine('sqlite://')
    with motor.begin() as c:
        _preparar(c)
        with Operations.context(MigrationContext.configure(c)):
            MIG.upgrade()
            MIG.downgrade()
        roles = dict(c.execute(sa.text('SELECT username, role FROM users')).fetchall())
        assert roles['admin'] == 'admin' and roles['carlos'] == 'DI' and roles['coord'] == 'MW'
        cols = {col['name'] for col in sa.inspect(c).get_columns('users')}
        assert 'is_admin' not in cols and 'legacy_role' not in cols
        assert set(c.execute(sa.text('SELECT code FROM roles')).scalars().all()) == {'DIR', 'DI', 'MW', 'COM'}
        c.execute(sa.text("INSERT INTO clients (name, client_type) VALUES ('z', 'Corporativo')"))  # ya no hay restriccion
