"""conexiones a proveedores de IA configurables desde el panel

Revision ID: 0008_proveedores_ia
Revises: 0007_catalogo_estados
Create Date: 2026-08-22

Hasta ahora el unico proveedor era Groq, con la clave en el .env y el modelo
escrito en el codigo: cambiar de modelo era un despliegue. Esta tabla recoge
cada conexion (proveedor + modelo + clave) para que un administrador la
gestione desde el panel.

No hay traspaso: si existe GROQ_API_KEY en el entorno se sigue usando como
respaldo mientras nadie configure una conexion activa aqui.
"""
from alembic import op
import sqlalchemy as sa


revision = '0008_proveedores_ia'
down_revision = '0007_catalogo_estados'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'ai_providers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('provider', sa.String(length=50), nullable=False),
        sa.Column('model', sa.String(length=150), nullable=False),
        sa.Column('api_key', sa.Text(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'],
                                name=op.f('fk_ai_providers_created_by_id')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_providers')),
        sa.UniqueConstraint('name', name=op.f('uq_ai_providers_name')),
    )


def downgrade():
    op.drop_table('ai_providers')
