"""jerarquia de mando: un manager puede llevar varias unidades y un director las hereda

Revision ID: 0004_jerarquia_de_mando
Revises: 0002_tasks_collab
Create Date: 2026-08-22

Va deliberadamente ANTES de retirar los server_default (0005). El modelo de
alcance no depende de ellos, y encadenarla despues obligaria a esperar a que la
version 2 se despliegue: 0005 rompe la creacion de tareas mientras el codigo en
produccion siga siendo v1.

Al terminar, manager_id queda nulo en todos los usuarios y unit_leads reproduce
exactamente los liderazgos de hoy. Sin directores no hay herencia y nadie lidera
nada nuevo: el comportamiento observable es identico. Por eso se puede desplegar
sola y dejar reposar antes de tocar una linea de logica.
"""
from alembic import op
import sqlalchemy as sa


revision = '0004_jerarquia_de_mando'
down_revision = '0002_tasks_collab'
branch_labels = None
depends_on = None


def upgrade():
    # ── Cadena de mando entre personas ──
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('manager_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_users_manager_id'), ['manager_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_users_manager_id'), 'users',
                                    ['manager_id'], ['id'])

    # ── Liderazgo directo, uno a muchos ──
    op.create_table(
        'unit_leads',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE',
                                name=op.f('fk_unit_leads_user_id')),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id'], ondelete='CASCADE',
                                name=op.f('fk_unit_leads_area_id')),
        sa.PrimaryKeyConstraint('user_id', 'area_id', name=op.f('pk_unit_leads')),
    )
    with op.batch_alter_table('unit_leads', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_unit_leads_area_id'), ['area_id'], unique=False)

    # ── Traspaso ──
    # Cada lider actual pasa a liderar la unidad a la que pertenece. Reproduce
    # el alcance de hoy, ni uno mas. is_area_lead no se retira: el codigo
    # desplegado todavia la lee, y esa columna se borra en su propia migracion
    # cuando ya no la lea nadie.
    op.execute("""
        INSERT INTO unit_leads (user_id, area_id)
        SELECT id, area_id
          FROM users
         WHERE is_area_lead = true
           AND area_id IS NOT NULL
    """)


def downgrade():
    op.drop_table('unit_leads')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_users_manager_id'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_users_manager_id'))
        batch_op.drop_column('manager_id')
