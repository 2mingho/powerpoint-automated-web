BEGIN;

-- Running upgrade 0002_tasks_collab -> 0003_drop_server_defaults

ALTER TABLE users ALTER COLUMN is_area_lead DROP DEFAULT;

ALTER TABLE tasks ALTER COLUMN priority DROP DEFAULT;

ALTER TABLE tasks ALTER COLUMN visibility DROP DEFAULT;

UPDATE alembic_version SET version_num='0003_drop_server_defaults' WHERE alembic_version.version_num = '0002_tasks_collab';

COMMIT;

