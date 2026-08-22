import logging
from logging.config import fileConfig

from flask import current_app

from alembic import context

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
fileConfig(config.config_file_name)
logger = logging.getLogger('alembic.env')


def get_engine():
    try:
        # this works with Flask-SQLAlchemy<3 and Alchemical
        return current_app.extensions['migrate'].db.get_engine()
    except (TypeError, AttributeError):
        # this works with Flask-SQLAlchemy>=3
        return current_app.extensions['migrate'].db.engine


def get_engine_url():
    try:
        return get_engine().url.render_as_string(hide_password=False).replace(
            '%', '%%')
    except AttributeError:
        return str(get_engine().url).replace('%', '%%')


# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
config.set_main_option('sqlalchemy.url', get_engine_url())
target_db = current_app.extensions['migrate'].db

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def get_metadata():
    if hasattr(target_db, 'metadatas'):
        return target_db.metadatas[None]
    return target_db.metadata


def include_object(object, name, type_, reflected, compare_to):
    """
    Alembic solo gestiona lo que models.py declara.

    La base es compartida entre versiones de la aplicacion: contiene columnas y
    tablas que esta rama no conoce todavia (las de v2) o que pertenecieron a
    experimentos retirados. Sin este filtro, `flask db migrate` no las encuentra
    en los modelos y propone DROP TABLE / DROP COLUMN sobre ellas. Aplicado a
    produccion seria una perdida de datos irreversible.

    La regla es conservadora en los dos sentidos: lo que la base tiene y los
    modelos no declaran, no se toca. Lo que los modelos declaran siempre se
    gestiona, porque no viene de la reflexion.
    """
    if not reflected:
        return True

    metadata = get_metadata()

    if type_ == 'table':
        return name in metadata.tables

    table = getattr(object, 'table', None)
    table_name = getattr(table, 'name', None)
    if table_name is None:
        return True
    if table_name not in metadata.tables:
        return False

    known_columns = set(metadata.tables[table_name].columns.keys())

    if type_ == 'column':
        return name in known_columns

    # Indices, claves foraneas y restricciones unicas: se ignoran en cuanto
    # tocan una columna que los modelos no declaran.
    involved = {c.name for c in getattr(object, 'columns', []) if getattr(c, 'name', None)}
    if involved and not involved.issubset(known_columns):
        return False

    return True


def run_migrations_offline():
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url, target_metadata=get_metadata(), literal_binds=True,
        include_object=include_object
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    # this callback is used to prevent an auto-migration from being generated
    # when there are no changes to the schema
    # reference: http://alembic.zzzcomputing.com/en/latest/cookbook.html
    def process_revision_directives(context, revision, directives):
        if getattr(config.cmd_opts, 'autogenerate', False):
            script = directives[0]
            if script.upgrade_ops.is_empty():
                directives[:] = []
                logger.info('No changes in schema detected.')

    conf_args = current_app.extensions['migrate'].configure_args
    if conf_args.get("process_revision_directives") is None:
        conf_args["process_revision_directives"] = process_revision_directives

    connectable = get_engine()

    with connectable.connect() as connection:
        # SQLite no sabe alterar una columna: Alembic recrea la tabla entera
        # (crear, copiar, borrar la original, renombrar). Con las claves
        # foraneas activas —lo estan desde que la aplicacion fija el PRAGMA—,
        # ese borrado dispara los ON DELETE CASCADE y vacia las tablas hijas.
        # Le costo las filas de unit_leads a la migracion 0005.
        #
        # El PRAGMA es inerte dentro de una transaccion, asi que se fija antes
        # de que Alembic abra la suya. En PostgreSQL no aplica: alli las
        # columnas se alteran en el sitio y no se recrea nada.
        if connection.dialect.name == 'sqlite':
            connection.exec_driver_sql('PRAGMA foreign_keys=OFF')
            # exec_driver_sql abre una transaccion implicita. Si se deja
            # abierta, la que Alembic abre despues queda anidada y el DDL no
            # llega a confirmarse: las migraciones dicen que corrieron y la
            # base se queda igual. El PRAGMA es de conexion, no de
            # transaccion, asi que sobrevive al commit.
            connection.commit()

        context.configure(
            connection=connection,
            target_metadata=get_metadata(),
            include_object=include_object,
            **conf_args
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
