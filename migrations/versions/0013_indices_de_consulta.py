"""indices para las consultas que mas se repiten

Revision ID: 0013_indices_de_consulta
Revises: 0012_reportes_persistentes
Create Date: 2026-10-05

PostgreSQL no indexa las claves foraneas por su cuenta, y las columnas por las
que mas se filtra no tenian indice: cada carga del calendario, cada visita a
/tasks y cada /mis-reportes recorrian la tabla entera.

    tasks (assignee_id, due_date)    calendario, carga por persona, avisos
    tasks (due_date)                 paneles de admin y equipo, sin asignado
    tasks (parent_task_id)           borrar una recurrencia con sus hijas
    reports (user_id, created_at)    /mis-reportes
    users (area_id)                  alcance de unidad en cada consulta de tareas
    activity_logs (user_id, timestamp)  historial de un usuario en admin

Solo anade indices: no toca datos ni columnas. Con el volumen actual el
CREATE INDEX bloquea las escrituras en cada tabla una fraccion de segundo, asi
que no hace falta CONCURRENTLY (que ademas no puede ir dentro de la
transaccion de Alembic).

if_not_exists porque la base es compartida entre versiones de la aplicacion:
si alguien creo alguno a mano mientras tanto, la migracion no debe fallar.
"""
from alembic import op


revision = '0013_indices_de_consulta'
down_revision = '0012_reportes_persistentes'
branch_labels = None
depends_on = None


INDICES = (
    ('ix_tasks_assignee_due', 'tasks', ['assignee_id', 'due_date']),
    ('ix_tasks_due_date', 'tasks', ['due_date']),
    ('ix_tasks_parent_task_id', 'tasks', ['parent_task_id']),
    ('ix_reports_user_created', 'reports', ['user_id', 'created_at']),
    ('ix_users_area_id', 'users', ['area_id']),
    ('ix_activity_logs_user_ts', 'activity_logs', ['user_id', 'timestamp']),
)


def upgrade():
    for nombre, tabla, columnas in INDICES:
        op.create_index(nombre, tabla, columnas, unique=False, if_not_exists=True)


def downgrade():
    for nombre, tabla, _columnas in reversed(INDICES):
        op.drop_index(nombre, table_name=tabla, if_exists=True)
