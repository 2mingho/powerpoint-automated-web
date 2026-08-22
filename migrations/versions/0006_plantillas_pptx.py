"""plantillas PowerPoint guardadas en la base y no en disco

Revision ID: 0006_plantillas_pptx
Revises: 0005_drop_server_defaults
Create Date: 2026-08-22

El contenedor tiene almacenamiento efimero: una plantilla dejada en
powerpoints/ desaparece en el siguiente despliegue, asi que hoy anadir una es
un commit. Guardarlas en la base las hace sobrevivir y las pone al alcance del
panel de administracion.

No hay traspaso. Las plantillas que vienen en el repositorio se siguen leyendo
del directorio; esta tabla solo recoge las que se suban a partir de ahora.
"""
from alembic import op
import sqlalchemy as sa


revision = '0006_plantillas_pptx'
down_revision = '0005_drop_server_defaults'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'pptx_templates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('uploaded_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['uploaded_by_id'], ['users.id'],
                                name=op.f('fk_pptx_templates_uploaded_by_id')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_pptx_templates')),
        sa.UniqueConstraint('name', name=op.f('uq_pptx_templates_name')),
    )


def downgrade():
    op.drop_table('pptx_templates')
