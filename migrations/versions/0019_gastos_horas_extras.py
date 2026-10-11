"""gastos de la unidad y horas extras

Revision ID: 0019_gastos_horas_extras
Revises: 0018_contratos_metas
Create Date: 2026-10-10

Dos modulos que gestiona quien lidera una unidad:

  expenses         gasto de una unidad, en dolares (como los contratos). Una unidad con
                   gastos no se puede borrar (RESTRICT).
  expense_budgets  presupuesto anual de una unidad por categoria. La categoria es texto
                   (la comparten gastos y presupuestos); la app la normaliza para que
                   "Viajes" y "viajes" sean la misma. Una por (unidad, año, categoria).
  overtime_entries horas extras de una persona de la unidad. period_* es el reporte
                   (año, mes y quincena 15 o 30) al que pertenece: por defecto el de su
                   fecha, pero se puede registrar tarde en otro (el Excel de Media Watch
                   mete en la 2da quincena de septiembre dias de finales de agosto).
                   Las horas de L-V y de SAB-DOM se calculan por la fecha, no se guardan.
  areas.has_overtime, areas.overtime_limit
                   la unidad gestiona horas extras, con un maximo por persona y trimestre
                   (80 en el Excel actual).

Quien ve o edita cada fila lo decide el servidor (unit_leads y alcanceUnidades), no la
base. Migracion aditiva.
"""
from alembic import op
import sqlalchemy as sa


revision = '0019_gastos_horas_extras'
down_revision = '0018_contratos_metas'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('areas', schema=None) as batch_op:
        batch_op.add_column(sa.Column('has_overtime', sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column('overtime_limit', sa.Numeric(precision=6, scale=2), server_default='80', nullable=False))
        batch_op.create_check_constraint(op.f('ck_areas_overtime_limit'), 'overtime_limit > 0')

    op.create_table(
        'expenses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=False),
        sa.Column('spent_on', sa.Date(), nullable=False),
        sa.Column('category', sa.String(length=60), nullable=False),
        sa.Column('description', sa.String(length=300), nullable=False),
        sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column('vendor', sa.String(length=120), nullable=True),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint('amount > 0', name=op.f('ck_expenses_amount')),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id'], name=op.f('fk_expenses_area_id_areas')),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_expenses_created_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_expenses')),
    )
    with op.batch_alter_table('expenses', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_expenses_area_id_spent_on'), ['area_id', 'spent_on'], unique=False)

    op.create_table(
        'expense_budgets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('category', sa.String(length=60), nullable=False),
        sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint('amount >= 0', name=op.f('ck_expense_budgets_amount')),
        sa.CheckConstraint('year BETWEEN 2000 AND 2100', name=op.f('ck_expense_budgets_year')),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id'], name=op.f('fk_expense_budgets_area_id_areas'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], name=op.f('fk_expense_budgets_updated_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_expense_budgets')),
        sa.UniqueConstraint('area_id', 'year', 'category', name='uq_expense_budgets_area_year_category'),
    )

    op.create_table(
        'overtime_entries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('work_date', sa.Date(), nullable=False),
        sa.Column('detail', sa.String(length=300), nullable=False),
        sa.Column('schedule', sa.String(length=120), nullable=True),
        sa.Column('hours', sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column('period_year', sa.Integer(), nullable=False),
        sa.Column('period_month', sa.SmallInteger(), nullable=False),
        sa.Column('period_half', sa.SmallInteger(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint('hours > 0 AND hours <= 24', name=op.f('ck_overtime_entries_hours')),
        sa.CheckConstraint('period_month BETWEEN 1 AND 12', name=op.f('ck_overtime_entries_month')),
        sa.CheckConstraint('period_half IN (15, 30)', name=op.f('ck_overtime_entries_half')),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id'], name=op.f('fk_overtime_entries_area_id_areas')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_overtime_entries_user_id_users')),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_overtime_entries_created_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_overtime_entries')),
    )
    with op.batch_alter_table('overtime_entries', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_overtime_entries_area_period'), ['area_id', 'period_year', 'period_month'], unique=False)
        batch_op.create_index(batch_op.f('ix_overtime_entries_user_id'), ['user_id'], unique=False)


def downgrade():
    with op.batch_alter_table('overtime_entries', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_overtime_entries_user_id'))
        batch_op.drop_index(batch_op.f('ix_overtime_entries_area_period'))
    op.drop_table('overtime_entries')
    op.drop_table('expense_budgets')
    with op.batch_alter_table('expenses', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_expenses_area_id_spent_on'))
    op.drop_table('expenses')
    with op.batch_alter_table('areas', schema=None) as batch_op:
        batch_op.drop_constraint(op.f('ck_areas_overtime_limit'), type_='check')
        batch_op.drop_column('overtime_limit')
        batch_op.drop_column('has_overtime')
