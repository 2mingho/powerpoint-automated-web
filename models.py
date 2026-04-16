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


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))
