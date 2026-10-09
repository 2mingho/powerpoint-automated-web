"""seguimiento: horas, revisor, bloqueo, tipo de tarea y capacidad

Revision ID: 0015_seguimiento
Revises: 0014_tablero_etiquetas
Create Date: 2026-10-09

Columnas que piden las mejoras del MVP de seguimiento (carga ponderada, mapa de
calor, revision y estudios). Todo es nulo o lleva valor por defecto: las tareas,
personas y unidades existentes no cambian y la app anterior sigue funcionando.

    tasks.estimated_hours   horas estimadas (nulo = la app usa un valor estandar)
    tasks.reviewer_id       quien aprueba el trabajo
    tasks.block_reason      por que esta bloqueada
    tasks.done_at           cuando paso a un estado final (no se reconstruye)
    tasks.task_type         'normal' | 'estudio'
    tasks.phase             fase del estudio
    tasks.study_method      metodologia del estudio
    users.weekly_capacity   horas por semana (nulo = estandar, 0 = sin carga)
    areas.color             color de la unidad
    areas.has_studies       la unidad puede crear tareas de tipo estudio
"""
from alembic import op
import sqlalchemy as sa


revision = '0015_seguimiento'
down_revision = '0014_tablero_etiquetas'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('estimated_hours', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('reviewer_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('block_reason', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('done_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('task_type', sa.String(length=10), server_default='normal', nullable=False))
        batch_op.add_column(sa.Column('phase', sa.String(length=40), nullable=True))
        batch_op.add_column(sa.Column('study_method', sa.String(length=40), nullable=True))
        batch_op.create_index(batch_op.f('ix_tasks_reviewer_id'), ['reviewer_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_tasks_reviewer_id_users'), 'users', ['reviewer_id'], ['id'])

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('weekly_capacity', sa.Integer(), nullable=True))

    with op.batch_alter_table('areas', schema=None) as batch_op:
        batch_op.add_column(sa.Column('color', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('has_studies', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade():
    with op.batch_alter_table('areas', schema=None) as batch_op:
        batch_op.drop_column('has_studies')
        batch_op.drop_column('color')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('weekly_capacity')

    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_tasks_reviewer_id_users'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_tasks_reviewer_id'))
        batch_op.drop_column('study_method')
        batch_op.drop_column('phase')
        batch_op.drop_column('task_type')
        batch_op.drop_column('done_at')
        batch_op.drop_column('block_reason')
        batch_op.drop_column('reviewer_id')
        batch_op.drop_column('estimated_hours')
