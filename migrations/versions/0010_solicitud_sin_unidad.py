"""la unidad de origen de una solicitud deja de ser obligatoria

Revision ID: 0010_solicitud_sin_unidad
Revises: 0009_consumo_ia
Create Date: 2026-08-25

task_requests.from_area_id era NOT NULL, asi que quien todavia no tiene unidad
asignada no podia enviar ninguna solicitud: el modulo le quedaba cerrado por un
dato que no depende de el. Quien la envia ya queda identificado por
requester_id; la unidad de origen es contexto, no clave.
"""
from alembic import op
import sqlalchemy as sa


revision = '0010_solicitud_sin_unidad'
down_revision = '0009_consumo_ia'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('task_requests', schema=None) as batch_op:
        batch_op.alter_column('from_area_id', existing_type=sa.Integer(), nullable=True)


def downgrade():
    # Volver atras exige que no queden filas sin unidad de origen.
    with op.batch_alter_table('task_requests', schema=None) as batch_op:
        batch_op.alter_column('from_area_id', existing_type=sa.Integer(), nullable=False)
