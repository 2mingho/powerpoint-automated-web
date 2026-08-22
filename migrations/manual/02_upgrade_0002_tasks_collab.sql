BEGIN;

-- Running upgrade 0001_baseline -> 0002_tasks_collab

ALTER TABLE users ADD COLUMN is_area_lead BOOLEAN DEFAULT false;

ALTER TABLE activity_logs ADD COLUMN entity_type VARCHAR(30);

ALTER TABLE activity_logs ADD COLUMN entity_id INTEGER;

CREATE INDEX ix_activity_logs_entity_type ON activity_logs (entity_type);

CREATE INDEX ix_activity_logs_entity_id ON activity_logs (entity_id);

ALTER TABLE tasks ADD COLUMN updated_at TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE tasks ADD COLUMN priority VARCHAR(10) DEFAULT 'Media' NOT NULL;

ALTER TABLE tasks ADD COLUMN visibility VARCHAR(15) DEFAULT 'unit' NOT NULL;

ALTER TABLE tasks ADD COLUMN area_id INTEGER;

ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE tasks ADD COLUMN deleted_by_id INTEGER;

CREATE INDEX ix_tasks_priority ON tasks (priority);

CREATE INDEX ix_tasks_area_id ON tasks (area_id);

CREATE INDEX ix_tasks_deleted_at ON tasks (deleted_at);

ALTER TABLE tasks ADD CONSTRAINT fk_tasks_area_id FOREIGN KEY(area_id) REFERENCES areas (id);

ALTER TABLE tasks ADD CONSTRAINT fk_tasks_deleted_by_id FOREIGN KEY(deleted_by_id) REFERENCES users (id);

UPDATE tasks SET updated_at = created_at WHERE updated_at IS NULL;

UPDATE tasks SET area_id = (SELECT id FROM areas WHERE areas.name = tasks.area) WHERE area_id IS NULL;

CREATE TABLE notifications (
    id SERIAL NOT NULL, 
    user_id INTEGER NOT NULL, 
    kind VARCHAR(30) NOT NULL, 
    title VARCHAR(255) NOT NULL, 
    body TEXT, 
    link_url VARCHAR(500), 
    entity_type VARCHAR(30), 
    entity_id INTEGER, 
    read_at TIMESTAMP WITHOUT TIME ZONE, 
    created_at TIMESTAMP WITHOUT TIME ZONE, 
    PRIMARY KEY (id), 
    FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_notif_user_unread ON notifications (user_id, read_at);

CREATE INDEX ix_notifications_created_at ON notifications (created_at);

CREATE INDEX ix_notifications_read_at ON notifications (read_at);

CREATE INDEX ix_notifications_user_id ON notifications (user_id);

CREATE TABLE task_templates (
    id SERIAL NOT NULL, 
    area_id INTEGER NOT NULL, 
    created_by_id INTEGER, 
    name VARCHAR(100) NOT NULL, 
    payload_json TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE, 
    PRIMARY KEY (id), 
    FOREIGN KEY(area_id) REFERENCES areas (id), 
    FOREIGN KEY(created_by_id) REFERENCES users (id)
);

CREATE INDEX ix_task_templates_area_id ON task_templates (area_id);

CREATE TABLE task_checklist_items (
    id SERIAL NOT NULL, 
    task_id INTEGER NOT NULL, 
    body VARCHAR(500) NOT NULL, 
    position INTEGER NOT NULL, 
    is_completed BOOLEAN, 
    completed_at TIMESTAMP WITHOUT TIME ZONE, 
    completed_by_id INTEGER, 
    created_at TIMESTAMP WITHOUT TIME ZONE, 
    PRIMARY KEY (id), 
    FOREIGN KEY(completed_by_id) REFERENCES users (id), 
    FOREIGN KEY(task_id) REFERENCES tasks (id)
);

CREATE INDEX ix_task_checklist_items_task_id ON task_checklist_items (task_id);

CREATE TABLE task_comments (
    id SERIAL NOT NULL, 
    task_id INTEGER NOT NULL, 
    user_id INTEGER NOT NULL, 
    body TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE, 
    edited_at TIMESTAMP WITHOUT TIME ZONE, 
    deleted_at TIMESTAMP WITHOUT TIME ZONE, 
    PRIMARY KEY (id), 
    FOREIGN KEY(task_id) REFERENCES tasks (id), 
    FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_task_comments_created_at ON task_comments (created_at);

CREATE INDEX ix_task_comments_task_id ON task_comments (task_id);

CREATE TABLE task_requests (
    id SERIAL NOT NULL, 
    title VARCHAR(255) NOT NULL, 
    description TEXT, 
    client VARCHAR(100), 
    due_date DATE, 
    priority VARCHAR(10), 
    requester_id INTEGER NOT NULL, 
    from_area_id INTEGER NOT NULL, 
    to_area_id INTEGER NOT NULL, 
    status VARCHAR(15) NOT NULL, 
    resolved_by_id INTEGER, 
    resolved_at TIMESTAMP WITHOUT TIME ZONE, 
    rejection_reason TEXT, 
    created_task_id INTEGER, 
    created_at TIMESTAMP WITHOUT TIME ZONE, 
    PRIMARY KEY (id), 
    FOREIGN KEY(created_task_id) REFERENCES tasks (id), 
    FOREIGN KEY(from_area_id) REFERENCES areas (id), 
    FOREIGN KEY(requester_id) REFERENCES users (id), 
    FOREIGN KEY(resolved_by_id) REFERENCES users (id), 
    FOREIGN KEY(to_area_id) REFERENCES areas (id)
);

CREATE INDEX ix_task_requests_from_area_id ON task_requests (from_area_id);

CREATE INDEX ix_task_requests_status ON task_requests (status);

CREATE INDEX ix_task_requests_to_area_id ON task_requests (to_area_id);

CREATE TABLE task_watchers (
    id SERIAL NOT NULL, 
    task_id INTEGER NOT NULL, 
    user_id INTEGER NOT NULL, 
    added_by_id INTEGER, 
    created_at TIMESTAMP WITHOUT TIME ZONE, 
    PRIMARY KEY (id), 
    FOREIGN KEY(added_by_id) REFERENCES users (id), 
    FOREIGN KEY(task_id) REFERENCES tasks (id), 
    FOREIGN KEY(user_id) REFERENCES users (id), 
    CONSTRAINT uq_task_watcher UNIQUE (task_id, user_id)
);

CREATE INDEX ix_task_watchers_task_id ON task_watchers (task_id);

CREATE INDEX ix_task_watchers_user_id ON task_watchers (user_id);

UPDATE alembic_version SET version_num='0002_tasks_collab' WHERE alembic_version.version_num = '0001_baseline';

COMMIT;

