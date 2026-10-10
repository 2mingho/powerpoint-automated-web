"""Migracion 0018: contratos y metas de ingresos."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

RAIZ = Path(__file__).resolve().parent.parent


def _cargar():
    spec = importlib.util.spec_from_file_location('mig_0018', RAIZ / 'migrations/versions/0018_contratos_metas.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MIG = _cargar()


@pytest.fixture
def conn():
    motor = sa.create_engine('sqlite://')
    with motor.begin() as c:
        c.execute(sa.text('PRAGMA foreign_keys=ON'))
        for tabla in ('users', 'areas', 'clients'):
            c.execute(sa.text(f'CREATE TABLE {tabla} (id INTEGER PRIMARY KEY, name VARCHAR(50))'))
        c.execute(sa.text("INSERT INTO users (id, name) VALUES (1, 'admin')"))
        c.execute(sa.text("INSERT INTO areas (id, name) VALUES (10, 'Insights'), (20, 'Mediawatch')"))
        c.execute(sa.text("INSERT INTO clients (id, name) VALUES (5, 'Claro')"))
        with Operations.context(MigrationContext.configure(c)):
            MIG.upgrade()
        yield c


def _contrato(conn, **kw):
    d = {'c': 5, 'a': 10, 't': 'Fee', 'm': 15000, 'i': '2026-01-01', 'f': '2026-12-31', 'fa': None, 'u': 1}
    d.update(kw)
    conn.execute(sa.text(
        'INSERT INTO contracts (client_id, area_id, contract_type, amount, start_date, end_date, from_area_id, created_by) '
        'VALUES (:c, :a, :t, :m, :i, :f, :fa, :u)'), d)


def _meta(conn, anio=2026, area=10, monto=250000):
    conn.execute(sa.text('INSERT INTO goals (year, area_id, amount) VALUES (:y, :a, :m)'), {'y': anio, 'a': area, 'm': monto})


def test_acepta_un_contrato_valido_de_cada_tipo(conn):
    for tipo in ('Fee', 'Proyecto', 'Asignación'):
        _contrato(conn, t=tipo)
    assert conn.execute(sa.text('SELECT COUNT(*) FROM contracts')).scalar() == 3


@pytest.mark.parametrize('cambio', [
    {'m': 0}, {'m': -5},                       # el monto es mayor que 0
    {'f': '2026-01-01'}, {'f': '2025-12-31'},  # el fin es posterior al inicio
    {'t': 'Mensual'}, {'t': 'fee'}, {'t': ''},  # solo los tres tipos
])
def test_rechaza_contratos_invalidos(conn, cambio):
    with pytest.raises(sa.exc.IntegrityError):
        _contrato(conn, **cambio)


def test_no_admite_cliente_ni_unidad_inexistentes(conn):
    with pytest.raises(sa.exc.IntegrityError):
        _contrato(conn, c=99)
    with pytest.raises(sa.exc.IntegrityError):
        _contrato(conn, a=99)


def test_un_cliente_o_una_unidad_con_contratos_no_se_borra(conn):
    _contrato(conn)
    with pytest.raises(sa.exc.IntegrityError):
        conn.execute(sa.text('DELETE FROM clients WHERE id = 5'))
    with pytest.raises(sa.exc.IntegrityError):
        conn.execute(sa.text('DELETE FROM areas WHERE id = 10'))


def test_borrar_la_unidad_que_asigna_o_a_quien_creo_conserva_el_contrato(conn):
    _contrato(conn, t='Asignación', fa=20)
    conn.execute(sa.text('DELETE FROM areas WHERE id = 20'))
    conn.execute(sa.text('DELETE FROM users WHERE id = 1'))
    assert conn.execute(sa.text('SELECT from_area_id, created_by FROM contracts')).fetchall() == [(None, None)]


def test_metas_una_por_unidad_y_ano(conn):
    _meta(conn)
    _meta(conn, anio=2027)
    _meta(conn, area=20)
    with pytest.raises(sa.exc.IntegrityError):
        _meta(conn, monto=1)


def test_la_meta_de_la_direccion_es_una_por_ano_aunque_area_sea_null(conn):
    """NULL no cuenta como igual en un UNIQUE normal: por eso hay un indice parcial."""
    _meta(conn, area=None)
    _meta(conn, anio=2027, area=None)
    with pytest.raises(sa.exc.IntegrityError):
        _meta(conn, area=None, monto=9)


@pytest.mark.parametrize('anio,monto', [(1999, 1), (2101, 1), (2026, -1)])
def test_rechaza_metas_invalidas(conn, anio, monto):
    with pytest.raises(sa.exc.IntegrityError):
        _meta(conn, anio=anio, monto=monto)


def test_una_meta_en_cero_vale_y_borrar_la_unidad_borra_su_meta(conn):
    _meta(conn, monto=0)
    conn.execute(sa.text('DELETE FROM areas WHERE id = 10'))
    assert conn.execute(sa.text('SELECT COUNT(*) FROM goals')).scalar() == 0


def test_bajar_la_revision_quita_las_dos_tablas(conn):
    with Operations.context(MigrationContext.configure(conn)):
        MIG.downgrade()
    tablas = sa.inspect(conn).get_table_names()
    assert 'contracts' not in tablas and 'goals' not in tablas
