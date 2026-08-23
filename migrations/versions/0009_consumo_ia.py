"""consumo de IA por modelo: tokens y coste

Revision ID: 0009_consumo_ia
Revises: 0008_proveedores_ia
Create Date: 2026-08-22

Anade el precio por millon de tokens a cada conexion y una tabla con una fila
por llamada. El precio vive en la conexion y no en una lista fija del codigo
porque las tarifas cambian y difieren por proveedor.

El coste se guarda ya calculado en cada fila: si manana cambia la tarifa, el
historico debe seguir mostrando lo que realmente se pago.
"""
from alembic import op
import sqlalchemy as sa


revision = '0009_consumo_ia'
down_revision = '0008_proveedores_ia'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('ai_providers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('price_in_per_1m', sa.Float(), nullable=False,
                                      server_default='0'))
        batch_op.add_column(sa.Column('price_out_per_1m', sa.Float(), nullable=False,
                                      server_default='0'))

    op.create_table(
        'ai_usage',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('provider_id', sa.Integer(), nullable=True),
        sa.Column('provider', sa.String(length=50), nullable=False),
        sa.Column('model', sa.String(length=150), nullable=False),
        sa.Column('feature', sa.String(length=50), nullable=True),
        sa.Column('tokens_in', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('tokens_out', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cost_usd', sa.Float(), nullable=False, server_default='0'),
        sa.Column('ok', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['provider_id'], ['ai_providers.id'], ondelete='SET NULL',
                                name=op.f('fk_ai_usage_provider_id')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_ai_usage_user_id')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_usage')),
    )
    with op.batch_alter_table('ai_usage', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_ai_usage_provider_id'), ['provider_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_ai_usage_model'), ['model'], unique=False)
        batch_op.create_index(batch_op.f('ix_ai_usage_created_at'), ['created_at'], unique=False)


def downgrade():
    op.drop_table('ai_usage')
    with op.batch_alter_table('ai_providers', schema=None) as batch_op:
        batch_op.drop_column('price_out_per_1m')
        batch_op.drop_column('price_in_per_1m')
