"""el reporte se guarda entero y tiene URL propia

Revision ID: 0012_reportes_persistentes
Revises: 0011_tour_de_bienvenida
Create Date: 2026-08-26

La tabla describia un fichero .pptx y no se escribia ni una fila: /mis-reportes
estaba vacio para todo el mundo. El reporte vivia solo como una pagina
renderizada, asi que recargar o cerrar la pestana lo perdia todo.

filename deja de ser obligatoria porque ya no hay fichero que nombrar. Las
filas viejas —si alguien las tuviera— se conservan tal cual; lo que se anade es
nulable y no las toca.

El token se rellena fila por fila en lugar de con un valor por defecto: tiene
que ser unico, y un DEFAULT los pondria todos iguales.
"""
from alembic import op
import sqlalchemy as sa
import secrets


revision = '0012_reportes_persistentes'
down_revision = '0011_tour_de_bienvenida'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('reports', schema=None) as batch_op:
        batch_op.add_column(sa.Column('token', sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('context_json', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('edits_json', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('insights_source', sa.String(length=10), nullable=True))
        batch_op.add_column(sa.Column('insights_status', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('insights_error', sa.Text(), nullable=True))
        batch_op.alter_column('filename', existing_type=sa.String(length=255), nullable=True)

    # Un token por fila existente, antes de exigir que no sea nulo.
    conexion = op.get_bind()
    reports = sa.table('reports', sa.column('id', sa.Integer), sa.column('token', sa.String))
    for (fila_id,) in conexion.execute(sa.select(reports.c.id)).fetchall():
        conexion.execute(
            reports.update().where(reports.c.id == fila_id).values(token=secrets.token_urlsafe(18)[:24])
        )

    with op.batch_alter_table('reports', schema=None) as batch_op:
        batch_op.alter_column('token', existing_type=sa.String(length=32), nullable=False)
        batch_op.create_index('ix_reports_token', ['token'], unique=True)


def downgrade():
    with op.batch_alter_table('reports', schema=None) as batch_op:
        batch_op.drop_index('ix_reports_token')
        # Volver atras exige que ninguna fila tenga filename nulo, que es el
        # estado de todo lo creado despues de esta migracion.
        batch_op.alter_column('filename', existing_type=sa.String(length=255), nullable=False)
        batch_op.drop_column('insights_error')
        batch_op.drop_column('insights_status')
        batch_op.drop_column('insights_source')
        batch_op.drop_column('edits_json')
        batch_op.drop_column('context_json')
        batch_op.drop_column('updated_at')
        batch_op.drop_column('token')
