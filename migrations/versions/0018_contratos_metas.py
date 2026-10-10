"""contratos y metas de ingresos

Revision ID: 0018_contratos_metas
Revises: 0017_finanzas_permisos
Create Date: 2026-10-10

El ingreso sale de los contratos, no de las tareas: cada contrato (de un cliente,
de una unidad) tiene un monto TOTAL en dolares que se reparte en partes iguales
entre los meses naturales que toca, de inicio a fin (ver web/src/lib/seguimiento/
finanzas.ts). Solo USD: no hay columna de moneda.

  contracts  un contrato por (cliente, unidad). tipo Fee, Proyecto o Asignacion;
             from_area_id es la unidad que asigna (solo Asignacion). Un cliente o
             una unidad con contratos no se pueden borrar (RESTRICT), como en el MVP.
  goals      meta anual de ingresos. area_id NULL es la meta de la direccion; el
             resto, la de cada unidad. Una por (ano, unidad), y una de la direccion
             por ano (indice parcial, porque NULL no cuenta como igual en UNIQUE).

Quien ve o edita cada fila lo decide el servidor (finance_grants y alcanceUnidades),
no la base. Migracion aditiva.
"""
from alembic import op
import sqlalchemy as sa


revision = '0018_contratos_metas'
down_revision = '0017_finanzas_permisos'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'contracts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('client_id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=False),
        sa.Column('contract_type', sa.String(length=20), nullable=False),
        sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('from_area_id', sa.Integer(), nullable=True),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint('amount > 0', name=op.f('ck_contracts_amount')),
        sa.CheckConstraint('end_date > start_date', name=op.f('ck_contracts_dates')),
        sa.CheckConstraint("contract_type IN ('Fee', 'Proyecto', 'Asignación')", name=op.f('ck_contracts_type')),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], name=op.f('fk_contracts_client_id_clients')),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id'], name=op.f('fk_contracts_area_id_areas')),
        sa.ForeignKeyConstraint(['from_area_id'], ['areas.id'], name=op.f('fk_contracts_from_area_id_areas'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_contracts_created_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_contracts')),
    )
    with op.batch_alter_table('contracts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_contracts_client_id'), ['client_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_contracts_area_id'), ['area_id'], unique=False)

    op.create_table(
        'goals',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=True),
        sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint('amount >= 0', name=op.f('ck_goals_amount')),
        sa.CheckConstraint('year BETWEEN 2000 AND 2100', name=op.f('ck_goals_year')),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id'], name=op.f('fk_goals_area_id_areas'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], name=op.f('fk_goals_updated_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_goals')),
    )
    op.create_index('uq_goals_year_area', 'goals', ['year', 'area_id'], unique=True,
                    postgresql_where=sa.text('area_id IS NOT NULL'), sqlite_where=sa.text('area_id IS NOT NULL'))
    op.create_index('uq_goals_year_direction', 'goals', ['year'], unique=True,
                    postgresql_where=sa.text('area_id IS NULL'), sqlite_where=sa.text('area_id IS NULL'))


def downgrade():
    op.drop_index('uq_goals_year_direction', table_name='goals')
    op.drop_index('uq_goals_year_area', table_name='goals')
    op.drop_table('goals')
    with op.batch_alter_table('contracts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_contracts_area_id'))
        batch_op.drop_index(batch_op.f('ix_contracts_client_id'))
    op.drop_table('contracts')
