"""permisos de ingresos por unidad (finance_grants)

Revision ID: 0017_finanzas_permisos
Revises: 0016_clientes
Create Date: 2026-10-10

Quien puede editar los contratos y las metas de ingresos de una unidad lo decide
un administrador, persona por persona y unidad por unidad. Una fila dice «esta
persona puede editar <kind> de esta unidad»: kind es 'contracts' (contratos) o
'goals' (metas de ingresos), dos permisos independientes.

Esta tabla solo concede EDICION. Quien puede VER los ingresos de una unidad sale
de la estructura (unidades que lidera o a cargo de sus gerentes) mas lo que se
le haya concedido editar. Un administrador edita todo sin necesitar filas.

Migracion aditiva: no toca datos existentes. Las filas se borran con la persona
o con la unidad (ON DELETE CASCADE); granted_by queda en NULL si quien concedio
se elimina.
"""
from alembic import op
import sqlalchemy as sa


revision = '0017_finanzas_permisos'
down_revision = '0016_clientes'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'finance_grants',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('granted_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint("kind IN ('contracts', 'goals')", name=op.f('ck_finance_grants_kind')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_finance_grants_user_id_users'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id'], name=op.f('fk_finance_grants_area_id_areas'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['granted_by'], ['users.id'], name=op.f('fk_finance_grants_granted_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('user_id', 'area_id', 'kind', name=op.f('pk_finance_grants')),
    )
    with op.batch_alter_table('finance_grants', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_finance_grants_area_id'), ['area_id'], unique=False)


def downgrade():
    with op.batch_alter_table('finance_grants', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_finance_grants_area_id'))
    op.drop_table('finance_grants')
