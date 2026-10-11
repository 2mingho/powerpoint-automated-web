"""roles por cargo, administrador aparte y tres tipos de cliente

Revision ID: 0020_roles_y_tipos_de_cliente
Revises: 0019_gastos_horas_extras
Create Date: 2026-10-10

Hasta ahora users.role mezclaba dos cosas: la disciplina de la persona (DI, COM, MW...) y el hecho de ser
administradora (role = 'admin'). Ahora:

  users.is_admin     la persona administra el sistema. Es una casilla aparte, no un rol.
  users.role         su CARGO, uno de cinco: coordinador, analista, ejecutiva, gerente, director.
  users.legacy_role  el valor anterior de role, por si hay que revisar o volver atras.
  roles              el catalogo queda con esos cinco (ya no se editan desde la app).
  clients.client_type  solo Privado, Publico o Interno (o sin tipo).

El cargo anterior (la disciplina) no dice nada del cargo nuevo, asi que se DEDUCE de la cadena de mando, como el resto
de la app: quien lidera una unidad es gerente; quien tiene a su cargo a algun lider, director; quien tiene gente a su
cargo sin que ninguna sea lider, coordinador; el resto, analista. Ejecutiva no se puede deducir: se asigna a mano.
Conviene revisarlo en Administracion > Personas tras migrar.

Los tipos de cliente que ya existian (Corporativo, Pyme, Aerolinea...) se llevan a uno de los tres: Gobierno y sus
parientes a Publico, Interno a Interno y cualquier otro valor con texto a Privado. Sin texto queda sin tipo.
"""
import unicodedata
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = '0020_roles_y_tipos_de_cliente'
down_revision = '0019_gastos_horas_extras'
branch_labels = None
depends_on = None

ROLES = [
    ('coordinador', 'Coordinador'), ('analista', 'Analista'), ('ejecutiva', 'Ejecutiva'),
    ('gerente', 'Gerente'), ('director', 'Director'),
]
TIPOS = ('Privado', 'Público', 'Interno')


def _clave(texto):
    sin = unicodedata.normalize('NFD', texto or '')
    return ''.join(c for c in sin if unicodedata.category(c) != 'Mn').strip().lower()


def _tipo_nuevo(valor):
    k = _clave(valor)
    if not k:
        return None
    if k in ('gobierno', 'publico', 'estatal', 'estado', 'sector publico', 'gubernamental'):
        return 'Público'
    if k == 'interno':
        return 'Interno'
    return 'Privado'


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_admin', sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column('legacy_role', sa.String(length=20), nullable=True))

    op.execute("UPDATE users SET is_admin = :t WHERE role = 'admin'".replace(':t', 'TRUE' if bind.dialect.name == 'postgresql' else '1'))
    op.execute('UPDATE users SET legacy_role = role')
    # Cargo deducido de la cadena de mando; cada paso pisa al anterior.
    op.execute("UPDATE users SET role = 'analista'")
    op.execute("UPDATE users SET role = 'coordinador' WHERE id IN (SELECT manager_id FROM users WHERE manager_id IS NOT NULL)")
    op.execute("UPDATE users SET role = 'director' WHERE id IN (SELECT manager_id FROM users WHERE manager_id IS NOT NULL AND id IN (SELECT user_id FROM unit_leads))")
    op.execute("UPDATE users SET role = 'gerente' WHERE id IN (SELECT user_id FROM unit_leads)")

    if insp.has_table('roles'):
        op.execute('DELETE FROM roles')
        tabla = sa.table('roles', sa.column('code', sa.String), sa.column('display_name', sa.String), sa.column('description', sa.Text), sa.column('created_at', sa.DateTime))
        op.bulk_insert(tabla, [{'code': c, 'display_name': n, 'description': None, 'created_at': datetime.now(timezone.utc).replace(tzinfo=None)} for c, n in ROLES])

    lista = ', '.join(f"'{c}'" for c, _ in ROLES)
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_check_constraint(op.f('ck_users_role'), f'role IN ({lista})')

    if insp.has_table('clients'):
        for (valor,) in bind.execute(sa.text('SELECT DISTINCT client_type FROM clients WHERE client_type IS NOT NULL')).fetchall():
            nuevo = _tipo_nuevo(valor)
            bind.execute(sa.text('UPDATE clients SET client_type = :n WHERE client_type = :v'), {'n': nuevo, 'v': valor})
        with op.batch_alter_table('clients', schema=None) as batch_op:
            batch_op.create_check_constraint(op.f('ck_clients_type'), "client_type IS NULL OR client_type IN ('Privado', 'Público', 'Interno')")


def downgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('clients'):
        with op.batch_alter_table('clients', schema=None) as batch_op:
            batch_op.drop_constraint(op.f('ck_clients_type'), type_='check')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_constraint(op.f('ck_users_role'), type_='check')
    op.execute("UPDATE users SET role = COALESCE(legacy_role, CASE WHEN is_admin THEN 'admin' ELSE 'DI' END)")
    op.execute("UPDATE users SET role = 'admin' WHERE is_admin")
    if insp.has_table('roles'):
        op.execute('DELETE FROM roles')
        op.execute("INSERT INTO roles (code, display_name, created_at) SELECT DISTINCT role, role, CURRENT_TIMESTAMP FROM users WHERE role <> 'admin'")
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('legacy_role')
        batch_op.drop_column('is_admin')
