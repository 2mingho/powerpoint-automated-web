"""Migracion 0017: tabla de permisos de ingresos por unidad (finance_grants)."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

RAIZ = Path(__file__).resolve().parent.parent


def _cargar():
    spec = importlib.util.spec_from_file_location('mig_0017', RAIZ / 'migrations/versions/0017_finanzas_permisos.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MIG = _cargar()


@pytest.fixture
def conn():
    motor = sa.create_engine('sqlite://')
    with motor.begin() as c:
        c.execute(sa.text('PRAGMA foreign_keys=ON'))
        c.execute(sa.text('CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(50))'))
        c.execute(sa.text('CREATE TABLE areas (id INTEGER PRIMARY KEY, name VARCHAR(50))'))
        c.execute(sa.text("INSERT INTO users (id, username) VALUES (1, 'admin'), (2, 'ana')"))
        c.execute(sa.text("INSERT INTO areas (id, name) VALUES (10, 'Insights'), (20, 'Mediawatch')"))
        yield c


def _subir(conn):
    with Operations.context(MigrationContext.configure(conn)):
        MIG.upgrade()


def _bajar(conn):
    with Operations.context(MigrationContext.configure(conn)):
        MIG.downgrade()


def _conceder(conn, user=2, area=10, kind='goals', por=1):
    conn.execute(sa.text('INSERT INTO finance_grants (user_id, area_id, kind, granted_by) VALUES (:u, :a, :k, :p)'),
                 {'u': user, 'a': area, 'k': kind, 'p': por})


def test_crea_la_tabla_con_su_clave_y_el_indice(conn):
    _subir(conn)
    insp = sa.inspect(conn)
    assert 'finance_grants' in insp.get_table_names()
    assert insp.get_pk_constraint('finance_grants')['constrained_columns'] == ['user_id', 'area_id', 'kind']
    assert [i['column_names'] for i in insp.get_indexes('finance_grants')] == [['area_id']]


def test_cada_tipo_es_un_permiso_distinto_pero_no_se_repite(conn):
    _subir(conn)
    _conceder(conn, kind='goals')
    _conceder(conn, kind='contracts')
    with pytest.raises(sa.exc.IntegrityError):
        _conceder(conn, kind='goals')


@pytest.mark.parametrize('kind', ['', 'metas', 'GOALS', 'income'])
def test_solo_admite_los_dos_tipos(conn, kind):
    _subir(conn)
    with pytest.raises(sa.exc.IntegrityError):
        _conceder(conn, kind=kind)


def test_no_admite_personas_ni_unidades_que_no_existen(conn):
    _subir(conn)
    with pytest.raises(sa.exc.IntegrityError):
        _conceder(conn, user=99)
    with pytest.raises(sa.exc.IntegrityError):
        _conceder(conn, area=99)


def test_borrar_la_persona_o_la_unidad_borra_sus_permisos(conn):
    _subir(conn)
    _conceder(conn, user=2, area=10)
    _conceder(conn, user=2, area=20)
    conn.execute(sa.text('DELETE FROM areas WHERE id = 20'))
    assert conn.execute(sa.text('SELECT area_id FROM finance_grants')).scalars().all() == [10]
    conn.execute(sa.text('DELETE FROM users WHERE id = 2'))
    assert conn.execute(sa.text('SELECT COUNT(*) FROM finance_grants')).scalar() == 0


def test_borrar_a_quien_concedio_conserva_el_permiso(conn):
    _subir(conn)
    _conceder(conn, user=2, por=1)
    conn.execute(sa.text('DELETE FROM users WHERE id = 1'))
    assert conn.execute(sa.text('SELECT user_id, granted_by FROM finance_grants')).fetchall() == [(2, None)]


def test_bajar_la_revision_quita_la_tabla(conn):
    _subir(conn)
    _bajar(conn)
    assert 'finance_grants' not in sa.inspect(conn).get_table_names()
