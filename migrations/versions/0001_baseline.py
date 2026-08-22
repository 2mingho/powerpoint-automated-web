"""baseline: esquema previo al modulo de colaboracion

Revision ID: 0001_baseline
Revises: 
Create Date: 2026-08-21

Refleja el esquema que producia el codigo anterior (create_all mas los
ALTER TABLE ad-hoc de init_db.py). En una base de datos que ya esta en
produccion NO se ejecuta: se marca como aplicada con
    flask db stamp 0001_baseline
despues de comprobar con `flask schema-check` que no hay deriva.
"""
from alembic import op
import sqlalchemy as sa


revision = '0001_baseline'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('areas',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=30), nullable=False),
    sa.Column('display_name', sa.String(length=100), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('username', sa.String(length=150), nullable=False),
    sa.Column('email', sa.String(length=150), nullable=False),
    sa.Column('password', sa.String(length=200), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('allowed_tools', sa.Text(), nullable=True),
    sa.Column('session_token', sa.String(length=64), nullable=True),
    sa.Column('force_logout', sa.Boolean(), nullable=True),
    sa.Column('area_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['area_id'], ['areas.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('activity_logs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('action', sa.String(length=100), nullable=False),
    sa.Column('detail', sa.Text(), nullable=True),
    sa.Column('ip_address', sa.String(length=45), nullable=True),
    sa.Column('timestamp', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('activity_logs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_activity_logs_timestamp'), ['timestamp'], unique=False)
    op.create_table('classification_presets',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('rules_json', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('reports',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('template_name', sa.String(length=255), nullable=True),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('tasks',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('client', sa.String(length=100), nullable=True),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('directorate', sa.String(length=255), nullable=True),
    sa.Column('requested_by', sa.String(length=255), nullable=True),
    sa.Column('budget_type', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('due_date', sa.Date(), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('is_recurrent', sa.Boolean(), nullable=True),
    sa.Column('recurrence_type', sa.String(length=20), nullable=True),
    sa.Column('parent_task_id', sa.Integer(), nullable=True),
    sa.Column('area', sa.String(length=20), nullable=False),
    sa.Column('creator_id', sa.Integer(), nullable=False),
    sa.Column('assignee_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['creator_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['parent_task_id'], ['tasks.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('temp_artifacts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=50), nullable=False),
    sa.Column('file_id', sa.String(length=120), nullable=False),
    sa.Column('storage_name', sa.String(length=255), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('kind', 'file_id', name='uq_temp_artifacts_kind_file_id')
    )
    with op.batch_alter_table('temp_artifacts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_temp_artifacts_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_temp_artifacts_file_id'), ['file_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_temp_artifacts_kind'), ['kind'], unique=False)
        batch_op.create_index(batch_op.f('ix_temp_artifacts_user_id'), ['user_id'], unique=False)


def downgrade():
    op.drop_table('temp_artifacts')
    op.drop_table('tasks')
    op.drop_table('reports')
    op.drop_table('classification_presets')
    op.drop_table('activity_logs')
    op.drop_table('users')
    op.drop_table('roles')
    op.drop_table('areas')

