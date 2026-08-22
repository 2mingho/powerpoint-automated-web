"""estados y prioridades de tarea editables desde el panel

Revision ID: 0007_catalogo_estados
Revises: 0006_plantillas_pptx
Create Date: 2026-08-22

Estaban fijos en models.py, asi que anadir un sexto estado era un despliegue.

El traspaso es conservador a proposito: siembra los estados y prioridades que
las tareas usan DE VERDAD, leidos de la propia tabla, mas los canonicos si
faltan. Sembrar una lista fija correria el riesgo de dejar fuera un valor en
uso y volver invalidas tareas existentes.

es_final es la parte importante. El codigo dejara de comparar contra el texto
"Completado" y preguntara por la bandera, para que renombrar ese estado no
rompa los vencimientos ni los indicadores.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision = '0007_catalogo_estados'
down_revision = '0006_plantillas_pptx'
branch_labels = None
depends_on = None


# Orden y color de los conocidos. Lo que aparezca en la base y no este aqui se
# siembra igualmente, al final y en neutro: no se pierde nada.
ESTADOS_CONOCIDOS = [
    ('Pendiente',    10, 'aviso',   True,  False),
    ('En Progreso',  20, 'info',    False, False),
    ('Bloqueado',    30, 'alerta',  False, False),
    ('En Revisión',  40, 'info',    False, False),
    ('Completado',   50, 'bien',    False, True),
]

PRIORIDADES_CONOCIDAS = [
    ('Alta',   30, 'alerta',  False),
    ('Media',  20, 'aviso',   True),
    ('Baja',   10, 'neutro',  False),
]


def _valores_en_uso(conexion, columna):
    """Valores distintos que las tareas usan hoy. Vacio si la columna no existe."""
    try:
        filas = conexion.execute(
            text(f'SELECT DISTINCT {columna} FROM tasks WHERE {columna} IS NOT NULL')
        ).fetchall()
    except Exception:
        return []
    return [f[0] for f in filas if f[0] and str(f[0]).strip()]


def upgrade():
    op.create_table(
        'task_statuses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(length=30), nullable=False),
        sa.Column('orden', sa.Integer(), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=False),
        sa.Column('es_inicial', sa.Boolean(), nullable=False),
        sa.Column('es_final', sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_task_statuses')),
        sa.UniqueConstraint('nombre', name=op.f('uq_task_statuses_nombre')),
    )
    op.create_table(
        'task_priorities',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(length=30), nullable=False),
        sa.Column('orden', sa.Integer(), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=False),
        sa.Column('es_defecto', sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_task_priorities')),
        sa.UniqueConstraint('nombre', name=op.f('uq_task_priorities_nombre')),
    )

    conexion = op.get_bind()

    # ── Estados ──
    en_uso = _valores_en_uso(conexion, 'status')
    conocidos = {n for n, _, _, _, _ in ESTADOS_CONOCIDOS}
    filas = list(ESTADOS_CONOCIDOS)
    siguiente = 100
    for nombre in sorted(set(en_uso) - conocidos):
        filas.append((nombre, siguiente, 'neutro', False, False))
        siguiente += 10

    for nombre, orden, color, inicial, final in filas:
        conexion.execute(
            text('INSERT INTO task_statuses (nombre, orden, color, es_inicial, es_final) '
                 'VALUES (:n, :o, :c, :i, :f)'),
            {'n': nombre, 'o': orden, 'c': color, 'i': inicial, 'f': final},
        )

    # ── Prioridades ──
    en_uso = _valores_en_uso(conexion, 'priority')
    conocidas = {n for n, _, _, _ in PRIORIDADES_CONOCIDAS}
    filas = list(PRIORIDADES_CONOCIDAS)
    siguiente = 100
    for nombre in sorted(set(en_uso) - conocidas):
        filas.append((nombre, siguiente, 'neutro', False))
        siguiente += 10

    for nombre, orden, color, defecto in filas:
        conexion.execute(
            text('INSERT INTO task_priorities (nombre, orden, color, es_defecto) '
                 'VALUES (:n, :o, :c, :d)'),
            {'n': nombre, 'o': orden, 'c': color, 'd': defecto},
        )


def downgrade():
    op.drop_table('task_priorities')
    op.drop_table('task_statuses')
