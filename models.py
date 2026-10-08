# models.py
from flask_login import UserMixin
from extensions import db
from extensions import login_manager
from datetime import datetime
from sqlalchemy import false
import json
import secrets


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


class TaskStatus(db.Model):
    """Estados de tarea, editables desde el panel.

    La tarea guarda el NOMBRE, no una clave foranea: la columna tasks.status ya
    existe como texto con miles de filas detras, y convertirla en relacion es
    una migracion mucho mayor. A cambio, renombrar un estado tiene que
    reescribir las tareas que lo usan, y eso lo hace la propia pantalla.

    es_final es lo que de verdad importa. "Completado" no es una etiqueta: es
    la condicion que decide si una tarea sigue contando como abierta, si esta
    vencida y si entra en la carga de alguien. Si el codigo comparase contra el
    nombre, renombrarlo romperia todo eso en silencio.
    """
    __tablename__ = 'task_statuses'

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(30), unique=True, nullable=False)
    orden = db.Column(db.Integer, nullable=False, default=0)
    color = db.Column(db.String(20), nullable=False, default='neutro')
    es_inicial = db.Column(db.Boolean, nullable=False, default=False)
    es_final = db.Column(db.Boolean, nullable=False, default=False)

    def __repr__(self):
        return f"<TaskStatus {self.nombre}>"


class TaskPriority(db.Model):
    """Prioridades de tarea, editables desde el panel.

    orden es la urgencia: cuanto mayor, mas urgente. El codigo ordena por el,
    no por el nombre, para que anadir una cuarta prioridad no obligue a tocar
    ninguna comparacion.
    """
    __tablename__ = 'task_priorities'

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(30), unique=True, nullable=False)
    orden = db.Column(db.Integer, nullable=False, default=0)
    color = db.Column(db.String(20), nullable=False, default='neutro')
    es_defecto = db.Column(db.Boolean, nullable=False, default=False)

    def __repr__(self):
        return f"<TaskPriority {self.nombre}>"


class PptxTemplate(db.Model):
    """Plantillas PowerPoint subidas desde el panel.

    Se guarda el binario en la base y no en disco porque el contenedor tiene
    almacenamiento efimero: una plantilla dejada en powerpoints/ desaparece en
    el siguiente despliegue. Las que vienen en el repositorio se siguen
    leyendo del directorio, asi que nada de lo existente cambia.
    """
    __tablename__ = 'pptx_templates'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), unique=True, nullable=False)
    data = db.Column(db.LargeBinary, nullable=False)
    size_bytes = db.Column(db.Integer, nullable=False)
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    uploaded_by = db.relationship('User')

    def __repr__(self):
        return f"<PptxTemplate {self.name}>"


class AIProvider(db.Model):
    """Conexiones a proveedores de IA, configurables desde el panel.

    Antes el unico proveedor era Groq y su clave vivia en el .env, asi que
    cambiar de modelo o de proveedor exigia tocar el servidor. Aqui cada fila
    es una conexion (proveedor + modelo + clave) que un administrador puede
    anadir, editar o desactivar sin despliegue.

    La clave se guarda tal cual porque el resto de secretos de la aplicacion
    (SECRET_KEY, DATABASE_URL) ya viven en el mismo entorno de confianza; solo
    un administrador llega a esta tabla y la clave nunca se manda al navegador.
    """
    __tablename__ = 'ai_providers'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    provider = db.Column(db.String(50), nullable=False)   # groq | anthropic | openai
    model = db.Column(db.String(150), nullable=False)
    api_key = db.Column(db.Text, nullable=False)
    is_active = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Precio por millon de tokens, en dolares. Se guarda por conexion y no en una
    # tabla fija de precios porque las tarifas cambian y varian por proveedor:
    # una lista escrita en el codigo envejece y calcula costes equivocados.
    price_in_per_1m = db.Column(db.Float, default=0.0, nullable=False)
    price_out_per_1m = db.Column(db.Float, default=0.0, nullable=False)

    created_by = db.relationship('User')

    def masked_key(self):
        """Nunca se ensena la clave entera en la interfaz."""
        if not self.api_key or len(self.api_key) < 8:
            return '••••'
        return f"{self.api_key[:4]}…{self.api_key[-4:]}"

    def __repr__(self):
        return f"<AIProvider {self.name} ({self.provider}/{self.model})>"


class AIUsage(db.Model):
    """Una fila por llamada al modelo: tokens y coste.

    Sirve para responder «cuanto llevo gastado y en que modelo». Se guarda el
    coste ya calculado ademas de los tokens porque el precio de la conexion
    puede cambiar despues, y reevaluar el historico con la tarifa nueva daria
    una cifra que nunca se pago.
    """
    __tablename__ = 'ai_usage'

    id = db.Column(db.Integer, primary_key=True)
    provider_id = db.Column(db.Integer, db.ForeignKey('ai_providers.id', ondelete='SET NULL'),
                            nullable=True, index=True)
    provider = db.Column(db.String(50), nullable=False)
    model = db.Column(db.String(150), nullable=False, index=True)
    feature = db.Column(db.String(50), nullable=True)     # traduccion | insights | prueba
    tokens_in = db.Column(db.Integer, default=0, nullable=False)
    tokens_out = db.Column(db.Integer, default=0, nullable=False)
    cost_usd = db.Column(db.Float, default=0.0, nullable=False)
    ok = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    def __repr__(self):
        return f"<AIUsage {self.model} in={self.tokens_in} out={self.tokens_out}>"


class UnitLead(db.Model):
    """Quien lidera cada unidad, de forma directa.

    Es una relacion de muchos a muchos a proposito: un manager puede llevar
    varias unidades. Lo que un director hereda de sus reportes NO se guarda
    aqui — se deriva recorriendo la cadena de mando, para que cambiar de jefe
    no obligue a reescribir filas que podrian quedarse obsoletas.
    """
    __tablename__ = 'unit_leads'

    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'),
                        primary_key=True)
    area_id = db.Column(db.Integer, db.ForeignKey('areas.id', ondelete='CASCADE'),
                        primary_key=True, index=True)

    usuario = db.relationship('User', back_populates='unidades_lideradas')
    unidad = db.relationship('Area')

    def __repr__(self):
        return f"<UnitLead user={self.user_id} area={self.area_id}>"


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
    # Cuando termino el tour de bienvenida. Nulo = todavia no lo ha visto, y
    # entonces se le ofrece al entrar.
    tour_completed_at = db.Column(db.DateTime, nullable=True)
    session_token = db.Column(db.String(64), nullable=True)
    force_logout = db.Column(db.Boolean, default=False)
    is_area_lead = db.Column(db.Boolean, default=False, server_default=false())
    # Indexada: el alcance de unidad filtra usuarios por area_id en cada
    # consulta de tareas.
    area_id = db.Column(db.Integer, db.ForeignKey('areas.id'), nullable=True, index=True)

    # Cadena de mando. Un director no lidera unidades directamente: llega a
    # ellas a traves de los managers que le reportan.
    manager_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True, index=True)

    area = db.relationship('Area', backref='users')
    manager = db.relationship('User', remote_side=[id], backref='reportes')
    unidades_lideradas = db.relationship(
        'UnitLead', back_populates='usuario', cascade='all, delete-orphan', lazy='dynamic'
    )

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
    """Un reporte de escucha social, guardado entero.

    Hasta ahora esta tabla describia un fichero (.pptx) que se generaba y se
    dejaba en disco, y no se escribia ni una fila: el reporte vivia solo como
    una pagina renderizada en la pestana del analista. Recargar, cerrar sin
    querer o que se cayera el navegador lo perdia todo, habia que volver a
    subir los widgets, y la IA se pagaba otra vez.

    Ahora se guarda el contexto completo en JSON. De ahi salen, sin trabajo
    extra: volver al reporte por su URL, retomarlo otro dia, pasarle el enlace
    a un companero, y rehacer el PDF sin regenerar nada.
    """
    __tablename__ = 'reports'
    # /mis-reportes: los de una persona, del mas reciente al mas antiguo.
    __table_args__ = (
        db.Index('ix_reports_user_created', 'user_id', 'created_at'),
    )

    # Estados del texto escrito por el modelo. Se guardan porque la generacion
    # dejo de ocurrir dentro de la peticion: la pagina se sirve con el texto
    # por reglas y pregunta despues, asi que hace falta saber en que punto va.
    INSIGHTS_PENDIENTE = 'pendiente'
    INSIGHTS_LISTO = 'listo'
    INSIGHTS_FALLIDO = 'fallido'
    INSIGHTS_OMITIDO = 'omitido'      # el analista no pidio IA

    id = db.Column(db.Integer, primary_key=True)

    # La URL publica del reporte. Un identificador aleatorio y no el id porque
    # el enlace se comparte: con /reporte/7 cualquiera prueba /reporte/8 y sabe
    # cuantos reportes existen y de quien son.
    token = db.Column(db.String(32), unique=True, nullable=False, index=True)

    title = db.Column(db.String(255), nullable=True)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # El contexto entero tal y como lo arma services/calculation.py.
    context_json = db.Column(db.Text, nullable=True)

    # Los retoques del analista, aparte del contexto y no encima. Mezclarlos
    # haria imposible volver a pedirle el texto al modelo sin pisar lo que el
    # ya escribio a mano, que es justo lo que no se le puede hacer.
    edits_json = db.Column(db.Text, nullable=True)

    insights_source = db.Column(db.String(10), nullable=True)   # 'reglas' | 'ia'
    insights_status = db.Column(db.String(20), nullable=True)
    insights_error = db.Column(db.Text, nullable=True)

    # Restos de la epoca en que esto era un fichero. Se dejan nulables para no
    # perder las filas viejas de nadie que las tuviera.
    filename = db.Column(db.String(255), nullable=True)
    template_name = db.Column(db.String(255), nullable=True)

    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    user = db.relationship('User', backref='reports')

    def __repr__(self):
        return f"<Report {self.title or self.token}>"

    @staticmethod
    def nuevo_token():
        return secrets.token_urlsafe(18)[:24]

    @property
    def contexto(self):
        """El contexto guardado, ya con los retoques del analista encima."""
        if not self.context_json:
            return None
        datos = json.loads(self.context_json)
        retoques = json.loads(self.edits_json) if self.edits_json else {}
        if retoques:
            insights = dict(datos.get('insights') or {})
            for slot, texto in retoques.items():
                if slot == 'client_name':
                    datos.setdefault('meta', {})['client_name'] = texto
                elif slot in insights:
                    insights[slot] = texto
            datos['insights'] = insights
        return datos

    def slots_editados(self):
        return set(json.loads(self.edits_json).keys()) if self.edits_json else set()


class ActivityLog(db.Model):
    __tablename__ = 'activity_logs'
    # El historial de un usuario en admin filtra por user_id y ordena por fecha.
    __table_args__ = (
        db.Index('ix_activity_logs_user_ts', 'user_id', 'timestamp'),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    action = db.Column(db.String(100), nullable=False)
    detail = db.Column(db.Text, nullable=True)
    entity_type = db.Column(db.String(30), nullable=True, index=True)
    entity_id = db.Column(db.Integer, nullable=True, index=True)
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
    # Calendario, carga por persona y avisos de vencimiento: siempre por
    # asignado y con la fecha de entrega como rango u orden.
    __table_args__ = (
        db.Index('ix_tasks_assignee_due', 'assignee_id', 'due_date'),
    )

    # Se conserva como respaldo para bases anteriores a la revision 0007. La
    # lista viva sale de services/catalogo.py, que lee task_statuses.
    VALID_STATUSES = ('Pendiente', 'En Progreso', 'Bloqueado', 'En Revisión', 'Completado')
    VALID_PRIORITIES = ('Alta', 'Media', 'Baja')
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
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    due_date = db.Column(db.Date, nullable=False, index=True)
    status = db.Column(db.String(30), nullable=False, default='Pendiente')
    priority = db.Column(db.String(10), nullable=False, default='Media',
                         server_default='Media', index=True)
    is_recurrent = db.Column(db.Boolean, default=False)
    recurrence_type = db.Column(db.String(20), nullable=True)
    parent_task_id = db.Column(db.Integer, db.ForeignKey('tasks.id'), nullable=True, index=True)
    area = db.Column(db.String(20), nullable=False)
    visibility = db.Column(db.String(15), nullable=False, default='unit',
                           server_default='unit')
    area_id = db.Column(db.Integer, db.ForeignKey('areas.id'), nullable=True, index=True)
    deleted_at = db.Column(db.DateTime, nullable=True, index=True)
    deleted_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    # Orden dentro de su columna del tablero. Es un real para poder soltar una
    # tarjeta entre otras dos sin renumerar la columna entera. Nula = nunca se
    # ha colocado a mano; esas van al final, por fecha de entrega.
    board_position = db.Column(db.Float, nullable=True)

    creator_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    assignee_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)

    creator = db.relationship('User', foreign_keys=[creator_id], backref='created_tasks')
    assignee = db.relationship('User', foreign_keys=[assignee_id], backref='assigned_tasks')
    area_ref = db.relationship('Area', foreign_keys=[area_id])
    children = db.relationship('Task', backref=db.backref('parent', remote_side=[id]), lazy='dynamic')

    @classmethod
    def active_query(cls):
        """Base query excluding soft-deleted tasks."""
        return cls.query.filter(cls.deleted_at.is_(None))

    def soft_delete(self, user_id):
        self.deleted_at = datetime.utcnow()
        self.deleted_by_id = user_id

    def to_dict(self, include_counts=False):
        """Serialize task to a dictionary for JSON responses."""
        from services.clock import today_local
        payload = {
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
            'priority': self.priority or 'Media',
            'is_recurrent': self.is_recurrent,
            'recurrence_type': self.recurrence_type or '',
            'parent_task_id': self.parent_task_id,
            'area': self.area,
            'visibility': self.visibility or 'unit',
            'area_id': self.area_id,
            'creator_id': self.creator_id,
            'creator_name': self.creator.username if self.creator else '',
            'assignee_id': self.assignee_id,
            'assignee_name': self.assignee.username if self.assignee else '',
            'updated_at': self.updated_at.isoformat() if self.updated_at else '',
            'board_position': self.board_position,
            'is_overdue': bool(self.due_date and self.due_date < today_local() and self.status != 'Completado'),
        }
        if include_counts:
            payload['comments_count'] = self.comments.filter_by(deleted_at=None).count()
        return payload

    def __repr__(self):
        return f"<Task {self.title} ({self.status})>"


class Notification(db.Model):
    __tablename__ = 'notifications'
    __table_args__ = (
        db.Index('ix_notif_user_unread', 'user_id', 'read_at'),
    )

    KINDS = (
        'task_assigned', 'task_reassigned', 'task_due_soon',
        'task_overdue', 'task_comment', 'mention',
        'request_received', 'request_accepted', 'request_rejected',
        # Lo que le llega a quien observa una tarea sin ser suya. Iba como
        # 'task_comment', asi que el aviso decia "comentario" cuando lo que
        # habia cambiado era el estado.
        'task_watching',
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    kind = db.Column(db.String(30), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    body = db.Column(db.Text, nullable=True)
    link_url = db.Column(db.String(500), nullable=True)
    entity_type = db.Column(db.String(30), nullable=True)
    entity_id = db.Column(db.Integer, nullable=True)
    read_at = db.Column(db.DateTime, nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    user = db.relationship('User', backref='notifications')

    def to_dict(self):
        return {
            'id': self.id,
            'kind': self.kind,
            'title': self.title,
            'body': self.body or '',
            'link_url': self.link_url or '',
            'entity_type': self.entity_type,
            'entity_id': self.entity_id,
            'is_read': self.read_at is not None,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M'),
        }


class TaskComment(db.Model):
    __tablename__ = 'task_comments'

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('tasks.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    edited_at = db.Column(db.DateTime, nullable=True)
    deleted_at = db.Column(db.DateTime, nullable=True)

    task = db.relationship('Task', backref=db.backref(
        'comments', lazy='dynamic', order_by='TaskComment.created_at'))
    user = db.relationship('User', backref='task_comments')

    def _created_at_local(self):
        """Hora del comentario en la zona de negocio, mismo formato de siempre.

        Se guarda con utcnow, pero la interfaz la compara con today_local()
        para decir 'hoy' o 'ayer': un comentario de las 22:00 en Santo Domingo
        ya es el dia siguiente en UTC y salia fechado manana.
        """
        if not self.created_at:
            return ''
        from datetime import timezone
        from services.clock import APP_TIMEZONE
        valor = self.created_at
        if valor.tzinfo is None:
            valor = valor.replace(tzinfo=timezone.utc)
        return valor.astimezone(APP_TIMEZONE).strftime('%Y-%m-%d %H:%M')

    def to_dict(self):
        return {
            'id': self.id,
            'task_id': self.task_id,
            'user_id': self.user_id,
            'user_name': self.user.username if self.user else '',
            'body': self.body,
            'created_at': self._created_at_local(),
            'edited': self.edited_at is not None,
        }


class TaskWatcher(db.Model):
    __tablename__ = 'task_watchers'
    __table_args__ = (
        db.UniqueConstraint('task_id', 'user_id', name='uq_task_watcher'),
    )

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('tasks.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    added_by_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    task = db.relationship('Task', backref=db.backref('watchers', lazy='dynamic'))
    user = db.relationship('User', foreign_keys=[user_id])


class TaskChecklistItem(db.Model):
    """Checkable sub-items within a task."""
    __tablename__ = 'task_checklist_items'

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('tasks.id'), nullable=False, index=True)
    body = db.Column(db.String(500), nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    is_completed = db.Column(db.Boolean, default=False)
    completed_at = db.Column(db.DateTime, nullable=True)
    completed_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    task = db.relationship('Task', backref=db.backref('checklist', lazy='dynamic',
                                                       order_by='TaskChecklistItem.position'))
    completed_by = db.relationship('User', foreign_keys=[completed_by_id])

    def to_dict(self):
        return {
            'id': self.id,
            'task_id': self.task_id,
            'body': self.body,
            'position': self.position,
            'is_completed': self.is_completed,
            'completed_at': self.completed_at.strftime('%Y-%m-%d %H:%M') if self.completed_at else None,
            'completed_by_id': self.completed_by_id,
            'completed_by_name': self.completed_by.username if self.completed_by else None,
        }


class TaskTemplate(db.Model):
    """Pre-defined task templates scoped per area."""
    __tablename__ = 'task_templates'

    id = db.Column(db.Integer, primary_key=True)
    area_id = db.Column(db.Integer, db.ForeignKey('areas.id'), nullable=False, index=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    name = db.Column(db.String(100), nullable=False)
    payload_json = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    area = db.relationship('Area')
    created_by = db.relationship('User')

    def get_payload(self):
        try:
            return json.loads(self.payload_json)
        except Exception:
            return {}

    def to_dict(self):
        payload = self.get_payload()
        return {
            'id': self.id,
            'area_id': self.area_id,
            'area_name': self.area.name if self.area else '',
            'created_by_id': self.created_by_id,
            'created_by_name': self.created_by.username if self.created_by else '',
            'name': self.name,
            'payload': payload,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M') if self.created_at else '',
        }


task_tag_links = db.Table(
    'task_tag_links',
    db.Column('task_id', db.Integer, db.ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True),
    # Indexada aparte: filtrar el tablero por etiqueta busca por tag_id, y la
    # clave primaria solo sirve empezando por task_id.
    db.Column('tag_id', db.Integer, db.ForeignKey('task_tags.id', ondelete='CASCADE'),
              primary_key=True, index=True),
)


class TaskTag(db.Model):
    """Etiqueta de color para clasificar tareas, varias por tarea.

    Pertenece a una unidad, como las plantillas: cada equipo clasifica su
    trabajo a su manera y no deberia ver las etiquetas de los demas. area_id
    nulo es una etiqueta comun, que solo crea un admin y ven todos.

    El color es un token del sistema (neutro, info, aviso...), no un hex, por
    el mismo motivo que en estados y prioridades: el tema oscuro lo resuelve
    aparte.
    """
    __tablename__ = 'task_tags'
    __table_args__ = (
        db.UniqueConstraint('area_id', 'nombre', name='uq_task_tags_area_nombre'),
    )

    COLORES = ('neutro', 'info', 'aviso', 'alerta', 'bien', 'violeta')

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(40), nullable=False)
    color = db.Column(db.String(20), nullable=False, default='neutro')
    area_id = db.Column(db.Integer, db.ForeignKey('areas.id'), nullable=True, index=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    area = db.relationship('Area')
    tasks = db.relationship('Task', secondary=task_tag_links, lazy='dynamic',
                            backref=db.backref('tags', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'nombre': self.nombre,
            'color': self.color,
            'area_id': self.area_id,
            'area_name': self.area.name if self.area else '',
        }


class TaskDependency(db.Model):
    """Una tarea que no deberia cerrarse hasta que otra lo este.

    blocker_task_id es la que va primero; blocked_task_id, la que espera. La
    relacion es dirigida y no puede formar ciclos: eso lo comprueba quien la
    crea, porque una restriccion de la base no sabe recorrer un grafo.
    """
    __tablename__ = 'task_dependencies'
    __table_args__ = (
        db.UniqueConstraint('blocker_task_id', 'blocked_task_id', name='uq_task_dependency'),
        db.CheckConstraint('blocker_task_id <> blocked_task_id', name='ck_task_dependency_distintas'),
    )

    id = db.Column(db.Integer, primary_key=True)
    blocker_task_id = db.Column(db.Integer, db.ForeignKey('tasks.id', ondelete='CASCADE'),
                                nullable=False, index=True)
    blocked_task_id = db.Column(db.Integer, db.ForeignKey('tasks.id', ondelete='CASCADE'),
                                nullable=False, index=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    blocker = db.relationship('Task', foreign_keys=[blocker_task_id])
    blocked = db.relationship('Task', foreign_keys=[blocked_task_id])


class TaskRequest(db.Model):
    """Cross-area task requests between teams."""
    __tablename__ = 'task_requests'

    VALID_STATUSES = ('Pendiente', 'Aceptada', 'Rechazada', 'Cancelada')

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    client = db.Column(db.String(100), nullable=True)
    due_date = db.Column(db.Date, nullable=True)
    priority = db.Column(db.String(10), default='Media')

    requester_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    # Opcional: quien todavia no tiene unidad asignada debe poder solicitar.
    # El solicitante ya queda en requester_id; la unidad de origen es contexto.
    from_area_id = db.Column(db.Integer, db.ForeignKey('areas.id'), nullable=True, index=True)
    to_area_id = db.Column(db.Integer, db.ForeignKey('areas.id'), nullable=False, index=True)

    status = db.Column(db.String(15), nullable=False, default='Pendiente', index=True)
    resolved_by_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    resolved_at = db.Column(db.DateTime, nullable=True)
    rejection_reason = db.Column(db.Text, nullable=True)
    created_task_id = db.Column(db.Integer, db.ForeignKey('tasks.id'), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    requester = db.relationship('User', foreign_keys=[requester_id])
    resolved_by = db.relationship('User', foreign_keys=[resolved_by_id])
    from_area = db.relationship('Area', foreign_keys=[from_area_id])
    to_area = db.relationship('Area', foreign_keys=[to_area_id])
    created_task = db.relationship('Task', foreign_keys=[created_task_id])

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'description': self.description or '',
            'client': self.client or '',
            'due_date': self.due_date.isoformat() if self.due_date else '',
            'priority': self.priority or 'Media',
            'requester_id': self.requester_id,
            'requester_name': self.requester.username if self.requester else '',
            'from_area_id': self.from_area_id,
            'from_area_name': self.from_area.name if self.from_area else '',
            'to_area_id': self.to_area_id,
            'to_area_name': self.to_area.name if self.to_area else '',
            'status': self.status,
            'resolved_by_id': self.resolved_by_id,
            'resolved_by_name': self.resolved_by.username if self.resolved_by else '',
            'resolved_at': self.resolved_at.strftime('%Y-%m-%d %H:%M') if self.resolved_at else None,
            'rejection_reason': self.rejection_reason or '',
            'created_task_id': self.created_task_id,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M') if self.created_at else '',
        }


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))
