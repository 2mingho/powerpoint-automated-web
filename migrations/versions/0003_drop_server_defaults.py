"""retirar los server_default de tasks.priority, tasks.visibility y users.is_area_lead

Revision ID: 0003_drop_server_defaults
Revises: 0002_tasks_collab
Create Date: 2026-08-21

EJECUTAR SOLO DESPUES DE DESPLEGAR v2.

0002 deja puestos los valores por defecto del motor a proposito. Mientras la
version anterior de la aplicacion siga corriendo, es lo unico que permite que
sus INSERT sobre tasks funcionen: v1 no conoce priority ni visibility, y ambas
son NOT NULL.

Una vez desplegada v2, el valor por defecto lo pone la aplicacion y el motor no
debe imponerlo tambien: dos fuentes para el mismo default acaban divergiendo.
"""
from alembic import op
import sqlalchemy as sa


revision = '0003_drop_server_defaults'
down_revision = '0002_tasks_collab'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('is_area_lead', server_default=None)
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.alter_column('priority', server_default=None)
        batch_op.alter_column('visibility', server_default=None)


def downgrade():
    # Restaurar los defaults es lo que permite volver a servir la version
    # anterior de la aplicacion sin romper la creacion de tareas.
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.alter_column('visibility', server_default='unit')
        batch_op.alter_column('priority', server_default='Media')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('is_area_lead', server_default=sa.false())
