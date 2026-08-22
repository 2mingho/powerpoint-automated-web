"""colaboracion en tareas: notificaciones, comentarios, observadores, plantillas y solicitudes

Revision ID: 0002_tasks_collab
Revises: 0001_baseline
Create Date: 2026-08-21

Delta introducida por la rama feature/modulo-tareas-mejora. Estas son las
columnas y tablas que el antiguo ensure_reports_schema() nunca llego a
anadir, y por las que un despliegue sobre una base existente fallaba.

Las columnas NOT NULL se anaden con server_default para poder rellenar las
filas existentes. El default se CONSERVA en esta revision y se retira en
0003, que debe ejecutarse solo despues de desplegar v2.
"""
from alembic import op
import sqlalchemy as sa


revision = '0002_tasks_collab'
down_revision = '0001_baseline'
branch_labels = None
depends_on = None


def upgrade():
    # ── users ──────────────────────────────────────────────
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_area_lead', sa.Boolean(),
                                      nullable=True, server_default=sa.false()))

    # ── activity_logs ──────────────────────────────────────
    with op.batch_alter_table('activity_logs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('entity_type', sa.String(length=30), nullable=True))
        batch_op.add_column(sa.Column('entity_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_activity_logs_entity_type'), ['entity_type'], unique=False)
        batch_op.create_index(batch_op.f('ix_activity_logs_entity_id'), ['entity_id'], unique=False)

    # ── tasks ──────────────────────────────────────────────
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('priority', sa.String(length=10),
                                      nullable=False, server_default='Media'))
        batch_op.add_column(sa.Column('visibility', sa.String(length=15),
                                      nullable=False, server_default='unit'))
        batch_op.add_column(sa.Column('area_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('deleted_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('deleted_by_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_tasks_priority'), ['priority'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_area_id'), ['area_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_deleted_at'), ['deleted_at'], unique=False)
        batch_op.create_foreign_key('fk_tasks_area_id', 'areas', ['area_id'], ['id'])
        batch_op.create_foreign_key('fk_tasks_deleted_by_id', 'users', ['deleted_by_id'], ['id'])

    # updated_at arranca igual que created_at en las filas existentes
    op.execute('UPDATE tasks SET updated_at = created_at WHERE updated_at IS NULL')

    # Backfill de area_id a partir del nombre de area que la tarea ya llevaba
    # como texto libre. Rescatado del ensure_schema() ad-hoc de init_db.py.
    op.execute(
        'UPDATE tasks SET area_id = (SELECT id FROM areas WHERE areas.name = tasks.area) '
        'WHERE area_id IS NULL'
    )

    # Los server_default se CONSERVAN a proposito. Ver la revision
    # 0003_drop_server_defaults: retirarlos aqui rompe la version anterior de
    # la aplicacion, que sigue corriendo en produccion mientras v2 no se
    # despliegue y que no conoce tasks.priority ni tasks.visibility. Sin
    # default, sus INSERT violarian el NOT NULL y crear tareas dejaria de
    # funcionar.

    # ── tablas nuevas ──────────────────────────────────────
    op.create_table('notifications',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=30), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('link_url', sa.String(length=500), nullable=True),
    sa.Column('entity_type', sa.String(length=30), nullable=True),
    sa.Column('entity_id', sa.Integer(), nullable=True),
    sa.Column('read_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.create_index('ix_notif_user_unread', ['user_id', 'read_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_notifications_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_notifications_read_at'), ['read_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_notifications_user_id'), ['user_id'], unique=False)
    op.create_table('task_templates',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('area_id', sa.Integer(), nullable=False),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('payload_json', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['area_id'], ['areas.id'], ),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('task_templates', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_task_templates_area_id'), ['area_id'], unique=False)
    op.create_table('task_checklist_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('task_id', sa.Integer(), nullable=False),
    sa.Column('body', sa.String(length=500), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('is_completed', sa.Boolean(), nullable=True),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.Column('completed_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['completed_by_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('task_checklist_items', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_task_checklist_items_task_id'), ['task_id'], unique=False)
    op.create_table('task_comments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('task_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('edited_at', sa.DateTime(), nullable=True),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('task_comments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_task_comments_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_task_comments_task_id'), ['task_id'], unique=False)
    op.create_table('task_requests',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('client', sa.String(length=100), nullable=True),
    sa.Column('due_date', sa.Date(), nullable=True),
    sa.Column('priority', sa.String(length=10), nullable=True),
    sa.Column('requester_id', sa.Integer(), nullable=False),
    sa.Column('from_area_id', sa.Integer(), nullable=False),
    sa.Column('to_area_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=15), nullable=False),
    sa.Column('resolved_by_id', sa.Integer(), nullable=True),
    sa.Column('resolved_at', sa.DateTime(), nullable=True),
    sa.Column('rejection_reason', sa.Text(), nullable=True),
    sa.Column('created_task_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['created_task_id'], ['tasks.id'], ),
    sa.ForeignKeyConstraint(['from_area_id'], ['areas.id'], ),
    sa.ForeignKeyConstraint(['requester_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['resolved_by_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['to_area_id'], ['areas.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('task_requests', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_task_requests_from_area_id'), ['from_area_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_task_requests_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_task_requests_to_area_id'), ['to_area_id'], unique=False)
    op.create_table('task_watchers',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('task_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('added_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['added_by_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('task_id', 'user_id', name='uq_task_watcher')
    )
    with op.batch_alter_table('task_watchers', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_task_watchers_task_id'), ['task_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_task_watchers_user_id'), ['user_id'], unique=False)


def downgrade():
    op.drop_table('task_watchers')
    op.drop_table('task_requests')
    op.drop_table('task_comments')
    op.drop_table('task_checklist_items')
    op.drop_table('task_templates')
    op.drop_table('notifications')

    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_constraint('fk_tasks_deleted_by_id', type_='foreignkey')
        batch_op.drop_constraint('fk_tasks_area_id', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_tasks_deleted_at'))
        batch_op.drop_index(batch_op.f('ix_tasks_area_id'))
        batch_op.drop_index(batch_op.f('ix_tasks_priority'))
        batch_op.drop_column('deleted_by_id')
        batch_op.drop_column('deleted_at')
        batch_op.drop_column('area_id')
        batch_op.drop_column('visibility')
        batch_op.drop_column('priority')
        batch_op.drop_column('updated_at')

    with op.batch_alter_table('activity_logs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_activity_logs_entity_id'))
        batch_op.drop_index(batch_op.f('ix_activity_logs_entity_type'))
        batch_op.drop_column('entity_id')
        batch_op.drop_column('entity_type')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('is_area_lead')
