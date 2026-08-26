"""marca de que un usuario ya vio el tour de bienvenida

Revision ID: 0011_tour_de_bienvenida
Revises: 0010_solicitud_sin_unidad
Create Date: 2026-08-25

Una fecha y no un booleano: saber *cuando* lo vio permite volver a ofrecerlo
cuando la plataforma cambie de forma, sin tener que adivinar quien es nuevo.

Nulo significa "todavia no lo ha visto", que es el estado de todos los usuarios
que ya existen. Es deliberado: la primera vez que entren despues de desplegar
esto se les ofrece el tour, que es justo lo que hace falta.
"""
from alembic import op
import sqlalchemy as sa


revision = '0011_tour_de_bienvenida'
down_revision = '0010_solicitud_sin_unidad'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('tour_completed_at', sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('tour_completed_at')
