"""Migracion 0019: gastos de la unidad, presupuesto por categoria y horas extras."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

RAIZ = Path(__file__).resolve().parent.parent


def _cargar():
    spec = importlib.util.spec_from_file_location('mig_0019', RAIZ / 'migrations/versions/0019_gastos_horas_extras.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MIG = _cargar()


@pytest.fixture
def conn():
    motor = sa.create_engine('sqlite://')
    with motor.begin() as c:
        c.execute(sa.text('PRAGMA foreign_keys=ON'))
        c.execute(sa.text('CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(50))'))
        c.execute(sa.text('CREATE TABLE areas (id INTEGER PRIMARY KEY, name VARCHAR(50))'))
        c.execute(sa.text("INSERT INTO users (id, name) VALUES (1, 'gerente'), (2, 'analista')"))
        c.execute(sa.text("INSERT INTO areas (id, name) VALUES (10, 'Mediawatch'), (20, 'Insights')"))
        with Operations.context(MigrationContext.configure(c)):
            MIG.upgrade()
        yield c


def _gasto(conn, **kw):
    d = {'a': 10, 'f': '2026-09-14', 'c': 'Transporte', 'd': 'Taxi', 'm': 45.5, 'u': 1}
    d.update(kw)
    conn.execute(sa.text(
        'INSERT INTO expenses (area_id, spent_on, category, description, amount, created_by) VALUES (:a, :f, :c, :d, :m, :u)'), d)


def _presupuesto(conn, **kw):
    d = {'a': 10, 'y': 2026, 'c': 'Transporte', 'm': 1000}
    d.update(kw)
    conn.execute(sa.text('INSERT INTO expense_budgets (area_id, year, category, amount) VALUES (:a, :y, :c, :m)'), d)


def _horas(conn, **kw):
    d = {'a': 10, 'u': 2, 'w': '2026-09-14', 'd': 'Cobertura', 'h': 3, 'y': 2026, 'mo': 9, 'mi': 15}
    d.update(kw)
    conn.execute(sa.text(
        'INSERT INTO overtime_entries (area_id, user_id, work_date, detail, hours, period_year, period_month, period_half) '
        'VALUES (:a, :u, :w, :d, :h, :y, :mo, :mi)'), d)


def test_las_unidades_traen_horas_extras_apagadas_y_con_maximo_80(conn):
    assert conn.execute(sa.text('SELECT has_overtime, overtime_limit FROM areas ORDER BY id')).fetchall() == [(0, 80), (0, 80)]


def test_el_maximo_de_horas_extras_es_mayor_que_cero(conn):
    conn.execute(sa.text('UPDATE areas SET overtime_limit = 60.5 WHERE id = 10'))
    with pytest.raises(sa.exc.IntegrityError):
        conn.execute(sa.text('UPDATE areas SET overtime_limit = 0 WHERE id = 10'))


def test_acepta_un_gasto_valido_y_rechaza_monto_cero_o_negativo(conn):
    _gasto(conn)
    for m in (0, -1):
        with pytest.raises(sa.exc.IntegrityError):
            _gasto(conn, m=m)


def test_un_gasto_necesita_unidad_existente_y_la_unidad_con_gastos_no_se_borra(conn):
    with pytest.raises(sa.exc.IntegrityError):
        _gasto(conn, a=99)
    _gasto(conn)
    with pytest.raises(sa.exc.IntegrityError):
        conn.execute(sa.text('DELETE FROM areas WHERE id = 10'))


def test_borrar_a_quien_registro_el_gasto_lo_conserva(conn):
    _gasto(conn)
    conn.execute(sa.text('DELETE FROM users WHERE id = 1'))
    assert conn.execute(sa.text('SELECT created_by FROM expenses')).fetchall() == [(None,)]


def test_presupuesto_uno_por_unidad_ano_y_categoria(conn):
    _presupuesto(conn)
    _presupuesto(conn, y=2027)
    _presupuesto(conn, c='Marketing')
    _presupuesto(conn, a=20)
    with pytest.raises(sa.exc.IntegrityError):
        _presupuesto(conn, m=5)


@pytest.mark.parametrize('anio,monto', [(1999, 1), (2101, 1), (2026, -1)])
def test_rechaza_presupuestos_invalidos(conn, anio, monto):
    with pytest.raises(sa.exc.IntegrityError):
        _presupuesto(conn, y=anio, m=monto)


def test_un_presupuesto_en_cero_vale_y_borrar_la_unidad_borra_sus_presupuestos(conn):
    _presupuesto(conn, m=0)
    conn.execute(sa.text('DELETE FROM areas WHERE id = 10'))
    assert conn.execute(sa.text('SELECT COUNT(*) FROM expense_budgets')).scalar() == 0


def test_horas_extras_validas_en_las_dos_quincenas(conn):
    _horas(conn)
    _horas(conn, mi=30, h=24)
    assert conn.execute(sa.text('SELECT COUNT(*) FROM overtime_entries')).scalar() == 2


@pytest.mark.parametrize('cambio', [
    {'h': 0}, {'h': -1}, {'h': 24.5},      # entre 0 (sin incluir) y 24 horas por registro
    {'mi': 20}, {'mi': 0},                 # la quincena es 15 o 30
    {'mo': 0}, {'mo': 13},                 # el mes del reporte es de 1 a 12
])
def test_rechaza_horas_extras_invalidas(conn, cambio):
    with pytest.raises(sa.exc.IntegrityError):
        _horas(conn, **cambio)


def test_horas_extras_necesitan_persona_y_unidad_y_no_se_pierden_al_borrar_a_la_persona(conn):
    with pytest.raises(sa.exc.IntegrityError):
        _horas(conn, u=99)
    with pytest.raises(sa.exc.IntegrityError):
        _horas(conn, a=99)
    _horas(conn)
    with pytest.raises(sa.exc.IntegrityError):
        conn.execute(sa.text('DELETE FROM users WHERE id = 2'))
    with pytest.raises(sa.exc.IntegrityError):
        conn.execute(sa.text('DELETE FROM areas WHERE id = 10'))


def test_borrar_a_quien_registro_las_horas_las_conserva(conn):
    conn.execute(sa.text('INSERT INTO users (id, name) VALUES (3, "otro")'))
    conn.execute(sa.text(
        "INSERT INTO overtime_entries (area_id, user_id, work_date, detail, hours, period_year, period_month, period_half, created_by) "
        "VALUES (10, 2, '2026-09-14', 'x', 1, 2026, 9, 15, 3)"))
    conn.execute(sa.text('DELETE FROM users WHERE id = 3'))
    assert conn.execute(sa.text('SELECT created_by FROM overtime_entries')).fetchall() == [(None,)]


def test_bajar_la_revision_quita_las_tablas_y_las_columnas(conn):
    with Operations.context(MigrationContext.configure(conn)):
        MIG.downgrade()
    insp = sa.inspect(conn)
    assert not {'expenses', 'expense_budgets', 'overtime_entries'} & set(insp.get_table_names())
    assert 'has_overtime' not in {c['name'] for c in insp.get_columns('areas')}
