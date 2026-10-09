"""Migracion 0016: agrupa los textos de cliente que solo difieren en mayusculas,
acentos o espacios, y deja el resto como clientes distintos."""
import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa

RAIZ = Path(__file__).resolve().parent.parent
CASOS = json.loads((RAIZ / 'web/src/lib/clientes/claves-casos.json').read_text(encoding='utf-8'))


def _cargar():
    spec = importlib.util.spec_from_file_location('mig_0016', RAIZ / 'migrations/versions/0016_clientes.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MIG = _cargar()


@pytest.mark.parametrize('caso', CASOS, ids=[repr(c['entrada']) for c in CASOS])
def test_la_clave_coincide_con_la_de_la_app_web(caso):
    """La misma tabla de casos la prueba web/src/lib/clientes/nombre.test.ts."""
    assert MIG._clave(caso['entrada']) == caso['clave']


def test_agrupa_variantes_y_elige_la_mas_usada():
    g = MIG._agrupar([('claro', 3), ('Claro', 10), ('CLARO ', 1), ('Nestlé', 2), ('Nestle', 2), ('Claro RD', 4)])
    assert {k: (v[0], sum(n for _, n in v[1])) for k, v in g.items()} == {
        'claro': ('Claro', 14), 'claro rd': ('Claro RD', 4), 'nestle': ('Nestlé', 4)}
    assert [v for v, _ in g['claro'][1]] == ['Claro', 'claro', 'CLARO']


def test_en_empate_gana_la_mayuscula_y_se_ignoran_los_vacios():
    g = MIG._agrupar([('claro', 2), ('Claro', 1), ('Claro  ', 1), ('', 5), ('   ', 1)])
    assert list(g) == ['claro']
    assert g['claro'][0] == 'Claro'


@pytest.fixture
def conn():
    motor = sa.create_engine('sqlite://')
    with motor.begin() as c:
        c.execute(sa.text('CREATE TABLE tasks (id INTEGER PRIMARY KEY, client VARCHAR(100), client_id INTEGER)'))
        c.execute(sa.text('CREATE TABLE clients (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, '
                          'name_key VARCHAR(100) NOT NULL UNIQUE, is_active BOOLEAN NOT NULL, created_at DATETIME)'))
        yield c


def _tareas(conn, textos):
    for t in textos:
        conn.execute(sa.text('INSERT INTO tasks (client) VALUES (:c)'), {'c': t})


def test_rellena_clientes_enlaza_tareas_y_unifica_el_texto(conn):
    _tareas(conn, ['Claro', 'claro', 'CLARO ', 'Claro', 'Claro RD', 'Nestlé', 'Nestle', None, '', '   '])
    clientes, reescritas = MIG._rellenar(conn)

    assert clientes == 3
    nombres = conn.execute(sa.text('SELECT name, name_key FROM clients ORDER BY name_key')).fetchall()
    assert [tuple(n) for n in nombres] == [('Claro', 'claro'), ('Claro RD', 'claro rd'), ('Nestlé', 'nestle')]

    filas = conn.execute(sa.text('SELECT client, client_id FROM tasks ORDER BY id')).fetchall()
    ids = {n: i for i, n in conn.execute(sa.text('SELECT id, name FROM clients')).fetchall()}
    assert [tuple(f) for f in filas] == [
        ('Claro', ids['Claro']), ('Claro', ids['Claro']), ('Claro', ids['Claro']), ('Claro', ids['Claro']),
        ('Claro RD', ids['Claro RD']),
        ('Nestlé', ids['Nestlé']), ('Nestlé', ids['Nestlé']),
        (None, None), ('', None), ('   ', None),
    ]
    # Reescritas: solo las que cambiaron de texto (claro, «CLARO », Nestle).
    assert reescritas == 3


def test_no_une_lo_que_solo_se_parece(conn):
    _tareas(conn, ['Claro', 'Claro.', 'Claro RD', 'Peña', 'Pena'])
    clientes, reescritas = MIG._rellenar(conn)
    assert clientes == 5
    assert reescritas == 0
    assert conn.execute(sa.text('SELECT COUNT(DISTINCT client_id) FROM tasks')).scalar() == 5


def test_sin_tareas_no_crea_nada(conn):
    assert MIG._rellenar(conn) == (0, 0)


def test_es_idempotente_sobre_datos_ya_unificados(conn):
    _tareas(conn, ['Claro', 'claro'])
    MIG._rellenar(conn)
    conn.execute(sa.text('DELETE FROM clients'))
    conn.execute(sa.text('UPDATE tasks SET client_id = NULL'))
    clientes, reescritas = MIG._rellenar(conn)
    assert (clientes, reescritas) == (1, 0)
