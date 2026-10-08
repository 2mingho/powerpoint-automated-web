"""tablero kanban, etiquetas y dependencias entre tareas

Revision ID: 0014_tablero_etiquetas
Revises: 0013_indices_de_consulta
Create Date: 2026-10-08

Tres piezas que se piden juntas porque el tablero las pinta en cada tarjeta:

    tasks.board_position   orden de la tarjeta dentro de su columna
    task_tags              etiquetas de color, por unidad
    task_tag_links         que tarea lleva que etiqueta
    task_dependencies      "esta no se cierra hasta que aquella lo este"

Todo es nuevo o nulable: las tareas existentes no cambian y siguen saliendo en
el tablero, al final de su columna y por fecha de entrega, hasta que alguien
las mueva.
"""
from alembic import op
import sqlalchemy as sa


revision = '0014_tablero_etiquetas'
down_revision = '0013_indices_de_consulta'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('board_position', sa.Float(), nullable=True))

    op.create_table(
        'task_tags',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(length=40), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id'], name=op.f('fk_task_tags_area_id_areas')),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_task_tags_created_by_id_users')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_task_tags')),
        sa.UniqueConstraint('area_id', 'nombre', name='uq_task_tags_area_nombre'),
    )
    op.create_index(op.f('ix_task_tags_area_id'), 'task_tags', ['area_id'], unique=False)

    op.create_table(
        'task_tag_links',
        sa.Column('task_id', sa.Integer(), nullable=False),
        sa.Column('tag_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], name=op.f('fk_task_tag_links_task_id_tasks'),
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tag_id'], ['task_tags.id'], name=op.f('fk_task_tag_links_tag_id_task_tags'),
                                ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('task_id', 'tag_id', name=op.f('pk_task_tag_links')),
    )
    op.create_index(op.f('ix_task_tag_links_tag_id'), 'task_tag_links', ['tag_id'], unique=False)

    op.create_table(
        'task_dependencies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('blocker_task_id', sa.Integer(), nullable=False),
        sa.Column('blocked_task_id', sa.Integer(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint('blocker_task_id <> blocked_task_id', name='ck_task_dependency_distintas'),
        sa.ForeignKeyConstraint(['blocker_task_id'], ['tasks.id'],
                                name=op.f('fk_task_dependencies_blocker_task_id_tasks'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['blocked_task_id'], ['tasks.id'],
                                name=op.f('fk_task_dependencies_blocked_task_id_tasks'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'],
                                name=op.f('fk_task_dependencies_created_by_id_users')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_task_dependencies')),
        sa.UniqueConstraint('blocker_task_id', 'blocked_task_id', name='uq_task_dependency'),
    )
    op.create_index(op.f('ix_task_dependencies_blocker_task_id'), 'task_dependencies',
                    ['blocker_task_id'], unique=False)
    op.create_index(op.f('ix_task_dependencies_blocked_task_id'), 'task_dependencies',
                    ['blocked_task_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_task_dependencies_blocked_task_id'), table_name='task_dependencies')
    op.drop_index(op.f('ix_task_dependencies_blocker_task_id'), table_name='task_dependencies')
    op.drop_table('task_dependencies')
    op.drop_index(op.f('ix_task_tag_links_tag_id'), table_name='task_tag_links')
    op.drop_table('task_tag_links')
    op.drop_index(op.f('ix_task_tags_area_id'), table_name='task_tags')
    op.drop_table('task_tags')
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_column('board_position')
