BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running stamp_revision  -> 0001_baseline

INSERT INTO alembic_version (version_num) VALUES ('0001_baseline') RETURNING alembic_version.version_num;

COMMIT;

