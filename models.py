# models.py
from flask_login import UserMixin
from extensions import db
from extensions import login_manager
from datetime import datetime
import json


class Role(db.Model):
    """Dynamic roles that can be managed by admins."""
    __tablename__ = 'roles'

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(30), unique=True, nullable=False)
    display_name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<Role {self.code} ({self.display_name})>"


class Area(db.Model):
    """Organizational areas for grouping users."""
    __tablename__ = 'areas'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<Area {self.name}>"


class User(UserMixin, db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), nullable=False)
    email = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='DI')
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    allowed_tools = db.Column(db.Text, nullable=True)  # JSON list, None = all
    session_token = db.Column(db.String(64), nullable=True)
    force_logout = db.Column(db.Boolean, default=False)
    area_id = db.Column(db.Integer, db.ForeignKey('areas.id'), nullable=True)

    area = db.relationship('Area', backref='users')

    # All available tools that can be gated
    ALL_TOOLS = {
        'reports': 'Generar Reporte',
        'classification': 'Clasificacion de Data',
        'file_merge': 'Union de Archivos',
        'csv_analysis': 'Analisis Rapido CSV',
        'tasks': 'Gestion de Tareas',
    }

    @property
    def is_admin(self):
        return self.role == 'admin'

    def get_allowed_tools(self):
        """Return list of allowed tool keys. None/empty means all tools."""
        if self.is_admin:
            return list(self.ALL_TOOLS.keys())
        if not self.allowed_tools:
            return list(self.ALL_TOOLS.keys())
        try:
            return json.loads(self.allowed_tools)
        except (json.JSONDecodeError, TypeError):
            return list(self.ALL_TOOLS.keys())

    def set_allowed_tools(self, tool_keys):
        """Set allowed tools from a list of keys."""
        valid = [k for k in tool_keys if k in self.ALL_TOOLS]
        self.allowed_tools = json.dumps(valid)

    def has_tool_access(self, tool_key):
        """Check if the user can access a specific tool."""
        if self.is_admin:
            return True
        return tool_key in self.get_allowed_tools()

    def __repr__(self):
        return f'<User {self.username} ({self.role})>'


class Report(db.Model):
    __tablename__ = 'reports'

    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    title = db.Column(db.String(255), nullable=True)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    template_name = db.Column(db.String(255), nullable=True)

    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    user = db.relationship('User', backref='reports')

    def __repr__(self):
        return f"<Report {self.title or self.filename}>"


class ActivityLog(db.Model):
    __tablename__ = 'activity_logs'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    action = db.Column(db.String(100), nullable=False)
    detail = db.Column(db.Text, nullable=True)
    ip_address = db.Column(db.String(45), nullable=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    user = db.relationship('User', backref='activity_logs')

    def __repr__(self):
        return f"<ActivityLog {self.action} by user_id={self.user_id}>"


class AdminFreezeState(db.Model):
    """Single-row operational freeze state for legacy admin mutations."""
    __tablename__ = 'admin_freeze_state'

    id = db.Column(db.Integer, primary_key=True, default=1)
    is_frozen = db.Column(db.Boolean, nullable=False, default=False)
    reason = db.Column(db.Text, nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    updated_by_user = db.relationship('User', backref='admin_freeze_updates', foreign_keys=[updated_by])

    def __repr__(self):
        return f"<AdminFreezeState frozen={self.is_frozen}>"


class ModuleLock(db.Model):
    """Per-module lock state used during incident operations."""
    __tablename__ = 'module_locks'

    id = db.Column(db.Integer, primary_key=True)
    module_key = db.Column(db.String(60), unique=True, nullable=False, index=True)
    lock_state = db.Column(db.String(20), nullable=False, default='unlocked')
    reason = db.Column(db.Text, nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    updated_by_user = db.relationship('User', backref='module_lock_updates', foreign_keys=[updated_by])

    __table_args__ = (
        db.CheckConstraint("lock_state IN ('unlocked', 'locked')", name='ck_module_locks_state'),
    )

    def __repr__(self):
        return f"<ModuleLock {self.module_key}={self.lock_state}>"


class IncidentEvent(db.Model):
    """Incident declaration and lifecycle."""
    __tablename__ = 'incident_events'

    id = db.Column(db.Integer, primary_key=True)
    incident_code = db.Column(db.String(40), unique=True, nullable=False, index=True)
    severity = db.Column(db.String(20), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='open')
    summary = db.Column(db.Text, nullable=False)
    declared_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    declared_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    resolved_at = db.Column(db.DateTime, nullable=True)

    declared_by_user = db.relationship('User', backref='declared_incidents', foreign_keys=[declared_by])

    __table_args__ = (
        db.CheckConstraint("status IN ('open', 'resolved')", name='ck_incident_events_status'),
    )

    def __repr__(self):
        return f"<IncidentEvent {self.incident_code} ({self.status})>"


class IncidentAction(db.Model):
    """Actions executed under an incident (session revocation, freeze, etc.)."""
    __tablename__ = 'incident_actions'

    id = db.Column(db.Integer, primary_key=True)
    incident_id = db.Column(db.Integer, db.ForeignKey('incident_events.id'), nullable=False, index=True)
    action_type = db.Column(db.String(60), nullable=False)
    target = db.Column(db.String(120), nullable=False)
    parameters_json = db.Column(db.Text, nullable=True)
    executed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    executed_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    result = db.Column(db.Text, nullable=True)

    incident = db.relationship('IncidentEvent', backref='actions')
    executed_by_user = db.relationship('User', backref='incident_actions', foreign_keys=[executed_by])

    def __repr__(self):
        return f"<IncidentAction incident={self.incident_id} type={self.action_type}>"


class IncidentPlaybook(db.Model):
    """Reusable incident containment playbooks for one-click response."""
    __tablename__ = 'incident_playbooks'

    id = db.Column(db.Integer, primary_key=True)
    playbook_key = db.Column(db.String(60), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=True)
    definition_json = db.Column(db.Text, nullable=False)
    is_enabled = db.Column(db.Boolean, nullable=False, default=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    created_by_user = db.relationship('User', backref='incident_playbooks_created', foreign_keys=[created_by])
    updated_by_user = db.relationship('User', backref='incident_playbooks_updated', foreign_keys=[updated_by])

    def __repr__(self):
        return f"<IncidentPlaybook {self.playbook_key} enabled={self.is_enabled}>"


class ClassificationPreset(db.Model):
    """Saved classification rule sets, scoped per user."""
    __tablename__ = 'classification_presets'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    rules_json = db.Column(db.Text, nullable=False)  # JSON array of categories+tematicas
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref='classification_presets')

    def get_rules(self):
        try:
            return json.loads(self.rules_json)
        except Exception:
            return []

    def __repr__(self):
        return f"<ClassificationPreset {self.name} (user={self.user_id})>"


class TempArtifact(db.Model):
    """Ownership metadata for temporary downloadable artifacts."""
    __tablename__ = 'temp_artifacts'

    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(50), nullable=False, index=True)
    file_id = db.Column(db.String(120), nullable=False, index=True)
    storage_name = db.Column(db.String(255), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    user = db.relationship('User', backref='temp_artifacts')

    __table_args__ = (
        db.UniqueConstraint('kind', 'file_id', name='uq_temp_artifacts_kind_file_id'),
    )

    def __repr__(self):
        return f"<TempArtifact {self.kind}:{self.file_id} user={self.user_id}>"


class Task(db.Model):
    """Task management model for area-based task assignment."""
    __tablename__ = 'tasks'

    VALID_STATUSES = ('Pendiente', 'En Progreso', 'Completado')
    RECURRENCE_TYPES = ('Diaria', 'Semanal', 'Mensual')

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    client = db.Column(db.String(100), nullable=True)
    start_date = db.Column(db.Date, nullable=True)
    end_date = db.Column(db.Date, nullable=True)
    directorate = db.Column(db.String(255), nullable=True)
    requested_by = db.Column(db.String(255), nullable=True)
    budget_type = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    due_date = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(30), nullable=False, default='Pendiente')
    is_recurrent = db.Column(db.Boolean, default=False)
    recurrence_type = db.Column(db.String(20), nullable=True)
    parent_task_id = db.Column(db.Integer, db.ForeignKey('tasks.id'), nullable=True)
    area = db.Column(db.String(20), nullable=False)

    creator_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    assignee_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)

    creator = db.relationship('User', foreign_keys=[creator_id], backref='created_tasks')
    assignee = db.relationship('User', foreign_keys=[assignee_id], backref='assigned_tasks')
    children = db.relationship('Task', backref=db.backref('parent', remote_side=[id]), lazy='dynamic')

    def to_dict(self):
        """Serialize task to a dictionary for JSON responses."""
        return {
            'id': self.id,
            'title': self.title,
            'description': self.description or '',
            'client': self.client or '',
            'start_date': self.start_date.isoformat() if self.start_date else '',
            'end_date': self.end_date.isoformat() if self.end_date else '',
            'directorate': self.directorate or '',
            'requested_by': self.requested_by or '',
            'budget_type': self.budget_type or '',
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M') if self.created_at else '',
            'due_date': self.due_date.isoformat() if self.due_date else '',
            'status': self.status,
            'is_recurrent': self.is_recurrent,
            'recurrence_type': self.recurrence_type or '',
            'parent_task_id': self.parent_task_id,
            'area': self.area,
            'creator_id': self.creator_id,
            'creator_name': self.creator.username if self.creator else '',
            'assignee_id': self.assignee_id,
            'assignee_name': self.assignee.username if self.assignee else '',
        }

    def __repr__(self):
        return f"<Task {self.title} ({self.status})>"


class OpsJob(db.Model):
    __tablename__ = 'ops_jobs'

    id = db.Column(db.Integer, primary_key=True)
    job_type = db.Column(db.String(80), nullable=False)
    module_key = db.Column(db.String(60), nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False, default='queued', index=True)
    payload_json = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    retry_count = db.Column(db.Integer, nullable=False, default=0)

    created_by_user = db.relationship('User', backref='ops_jobs', foreign_keys=[created_by])

    __table_args__ = (
        db.CheckConstraint("status IN ('queued', 'running', 'failed', 'done', 'cancelled')", name='ck_ops_jobs_status'),
    )

    def __repr__(self):
        return f"<OpsJob id={self.id} type={self.job_type} status={self.status}>"


class OpsJobRun(db.Model):
    __tablename__ = 'ops_job_runs'

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('ops_jobs.id'), nullable=False, index=True)
    attempt = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(20), nullable=False, default='queued', index=True)
    error_message = db.Column(db.Text, nullable=True)
    started_at = db.Column(db.DateTime, nullable=True)
    finished_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    job = db.relationship('OpsJob', backref='runs')

    __table_args__ = (
        db.UniqueConstraint('job_id', 'attempt', name='uq_ops_job_runs_job_attempt'),
    )

    def __repr__(self):
        return f"<OpsJobRun job_id={self.job_id} attempt={self.attempt} status={self.status}>"


class ConfigItem(db.Model):
    __tablename__ = 'config_items'

    id = db.Column(db.Integer, primary_key=True)
    namespace = db.Column(db.String(60), nullable=False, index=True)
    config_key = db.Column(db.String(120), nullable=False, index=True)
    value_json = db.Column(db.Text, nullable=False)
    current_version = db.Column(db.Integer, nullable=False, default=1)
    is_sensitive = db.Column(db.Boolean, nullable=False, default=False)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    updated_by_user = db.relationship('User', backref='config_item_updates', foreign_keys=[updated_by])

    __table_args__ = (
        db.UniqueConstraint('namespace', 'config_key', name='uq_config_items_namespace_key'),
    )

    def __repr__(self):
        return f"<ConfigItem {self.namespace}.{self.config_key} v{self.current_version}>"


class ConfigVersion(db.Model):
    __tablename__ = 'config_versions'

    id = db.Column(db.Integer, primary_key=True)
    config_item_id = db.Column(db.Integer, db.ForeignKey('config_items.id'), nullable=False, index=True)
    version = db.Column(db.Integer, nullable=False)
    value_json = db.Column(db.Text, nullable=False)
    change_type = db.Column(db.String(20), nullable=False)
    reason = db.Column(db.Text, nullable=True)
    changed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    config_item = db.relationship('ConfigItem', backref='versions')
    changed_by_user = db.relationship('User', backref='config_version_changes', foreign_keys=[changed_by])

    __table_args__ = (
        db.UniqueConstraint('config_item_id', 'version', name='uq_config_versions_item_version'),
        db.CheckConstraint("change_type IN ('create', 'update', 'rollback')", name='ck_config_versions_change_type'),
    )

    def __repr__(self):
        return f"<ConfigVersion item_id={self.config_item_id} version={self.version} type={self.change_type}>"


class AuditLedgerEvent(db.Model):
    """Forensic-grade audit ledger for admin v2 critical operations."""
    __tablename__ = 'audit_ledger_events'

    id = db.Column(db.Integer, primary_key=True)
    actor_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    target_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True, index=True)
    incident_id = db.Column(db.Integer, db.ForeignKey('incident_events.id'), nullable=True, index=True)
    module_key = db.Column(db.String(60), nullable=False, index=True)
    action = db.Column(db.String(120), nullable=False, index=True)
    resource_type = db.Column(db.String(80), nullable=False, index=True)
    resource_id = db.Column(db.String(80), nullable=True, index=True)
    summary = db.Column(db.Text, nullable=True)
    before_json = db.Column(db.Text, nullable=True)
    after_json = db.Column(db.Text, nullable=True)
    metadata_json = db.Column(db.Text, nullable=True)
    ip_address = db.Column(db.String(45), nullable=True)
    user_agent = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    actor_user = db.relationship('User', backref='audit_events_as_actor', foreign_keys=[actor_user_id])
    target_user = db.relationship('User', backref='audit_events_as_target', foreign_keys=[target_user_id])
    incident = db.relationship('IncidentEvent', backref='audit_ledger_events')

    def __repr__(self):
        return f"<AuditLedgerEvent id={self.id} action={self.action} module={self.module_key}>"


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))
