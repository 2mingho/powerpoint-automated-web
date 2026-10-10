"""clientes como entidad

Revision ID: 0016_clientes
Revises: 0015_seguimiento
Create Date: 2026-10-09

Hasta ahora el cliente de una tarea era un texto libre (tasks.client). Esta
migracion crea la tabla clients, enlaza cada tarea con tasks.client_id y rellena
ambos desde los textos que ya existen.

Regla de union (solo la segura): dos textos son el mismo cliente si difieren
unicamente en MAYUSCULAS, acentos o espacios. «Claro», «claro» y «CLARO »
pasan a ser un cliente. «Claro.» o «Claro RD» NO se unen: quedan como clientes
distintos y un administrador los une a mano desde Admin. La enie cuenta como
letra propia (Peña y Pena no se unen).

ATENCION, cambia datos: tasks.client de las tareas enlazadas se reescribe con el
nombre canonico de su cliente (la variante mas usada), para que los filtros y
listados por texto sigan funcionando y las variantes no vuelvan a separarse. El
texto original no se conserva; bajar la revision solo borra el enlace y la tabla.

La regla de la clave esta repetida en web/src/lib/clientes/nombre.ts; los dos
lados se prueban contra web/src/lib/clientes/claves-casos.json.
"""
import unicodedata

from alembic import op
import sqlalchemy as sa


revision = '0016_clientes'
down_revision = '0015_seguimiento'
branch_labels = None
depends_on = None


def _clave(nombre):
    """Minusculas, sin acentos (la enie se conserva) y con espacios colapsados."""
    s = unicodedata.normalize('NFC', nombre or '').lower().replace('ñ', '\x00')
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if not unicodedata.combining(c))
    return ' '.join(s.replace('\x00', 'ñ').split())


def _limpio(nombre):
    return ' '.join((nombre or '').split())


def _agrupar(filas):
    """filas: [(texto, n)] -> {clave: (nombre canonico, [(variante, n)])}.

    Canonico: la variante mas usada; en empate, la de mas acentos y luego la
    primera en orden alfabetico.
    """
    grupos = {}
    for texto, n in filas:
        nombre = _limpio(texto)
        clave = _clave(nombre)
        if not clave:
            continue
        variantes = grupos.setdefault(clave, {})
        variantes[nombre] = variantes.get(nombre, 0) + n

    def acentos(v):
        return sum(1 for c in v if ord(c) > 127)

    resultado = {}
    for clave, variantes in grupos.items():
        orden = sorted(variantes.items(), key=lambda it: (-it[1], -acentos(it[0]), it[0]))
        resultado[clave] = (orden[0][0], orden)
    return resultado


def _rellenar(conn):
    """Crea un cliente por grupo y enlaza las tareas. Devuelve (clientes, tareas reescritas)."""
    filas = conn.execute(sa.text(
        "SELECT client, COUNT(*) FROM tasks WHERE client IS NOT NULL GROUP BY client")).fetchall()
    grupos = _agrupar([(f[0], f[1]) for f in filas])
    reescritas = 0
    for clave, (nombre, _variantes) in sorted(grupos.items()):
        conn.execute(sa.text(
            "INSERT INTO clients (name, name_key, is_active, created_at) VALUES (:n, :k, :a, CURRENT_TIMESTAMP)"),
            {'n': nombre[:100], 'k': clave[:100], 'a': True})
        cid = conn.execute(sa.text("SELECT id FROM clients WHERE name_key = :k"), {'k': clave[:100]}).scalar()
        # Cada texto original (con sus espacios sobrantes) apunta al mismo cliente.
        for f in filas:
            if _clave(f[0]) != clave:
                continue
            r = conn.execute(sa.text(
                "UPDATE tasks SET client_id = :c, client = :n WHERE client = :v"),
                {'c': cid, 'n': nombre[:100], 'v': f[0]})
            if f[0] != nombre[:100]:
                reescritas += r.rowcount or 0
    return len(grupos), reescritas


def upgrade():
    op.create_table(
        'clients',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('name_key', sa.String(length=100), nullable=False),
        sa.Column('client_type', sa.String(length=40), nullable=True),
        sa.Column('account_lead_id', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['account_lead_id'], ['users.id'], name=op.f('fk_clients_account_lead_id_users')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_clients')),
        sa.UniqueConstraint('name_key', name=op.f('uq_clients_name_key')),
    )
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('client_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_tasks_client_id'), ['client_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_tasks_client_id_clients'), 'clients', ['client_id'], ['id'])

    clientes, reescritas = _rellenar(op.get_bind())
    print(f'[0016_clientes] {clientes} clientes creados; {reescritas} tareas con el nombre unificado.')


def downgrade():
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_tasks_client_id_clients'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_tasks_client_id'))
        batch_op.drop_column('client_id')
    op.drop_table('clients')
