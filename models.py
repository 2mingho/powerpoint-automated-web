# models.py
from flask_login import UserMixin
from extensions import db
from extensions import login_manager
from datetime import datetime
import json


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

    VALID_ROLES = ('admin', 'DI', 'MW')

    # All available tools that can be gated
    ALL_TOOLS = {
        'reports':        'Generar Reporte',
        'classification': 'Clasificacion de Data',
        'file_merge':     'Union de Archivos',
        'csv_analysis':   'Analisis Rapido CSV',
        'social_etl':     'Social ETL & Dashboard',
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


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


# ==========================================
#  SOCIAL LISTENING ETL MODELS
# ==========================================

# --- Classification System ---

class ClassificationProfile(db.Model):
    __tablename__ = 'classification_profiles'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    is_active = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    categories = db.relationship('ClassificationCategory', backref='profile', cascade="all, delete-orphan", lazy=True)

class ClassificationCategory(db.Model):
    __tablename__ = 'classification_categories'
    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey('classification_profiles.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)

    themes = db.relationship('ClassificationTheme', backref='category', cascade="all, delete-orphan", lazy=True)

class ClassificationTheme(db.Model):
    __tablename__ = 'classification_themes'
    id = db.Column(db.Integer, primary_key=True)
    category_id = db.Column(db.Integer, db.ForeignKey('classification_categories.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)

    keywords = db.relationship('ClassificationKeyword', backref='theme', cascade="all, delete-orphan", lazy=True)

class ClassificationKeyword(db.Model):
    __tablename__ = 'classification_keywords'
    id = db.Column(db.Integer, primary_key=True)
    theme_id = db.Column(db.Integer, db.ForeignKey('classification_themes.id'), nullable=False)
    keyword = db.Column(db.String(255), nullable=False)


# --- Platform Data Tables ---
# Common columns: categoria, tematica, mes, anio (All NOT NULL as per requirement)

class PlatformMixin:
    """Mixin for common columns injected into every platform table."""
    categoria = db.Column(db.Text, nullable=False)
    tematica = db.Column(db.Text, nullable=False)
    mes = db.Column(db.Text, nullable=False)  # Using 'mes' (lowercase) to follow python conventions, but mapped to DB column
    anio = db.Column(db.Integer, nullable=False)

class TbInstagram(PlatformMixin, db.Model):
    __tablename__ = 'tb_instagram'
    id = db.Column(db.Text, primary_key=True)  # Assuming native ID is unique enough, or use auto-inc primary key? Requirement says 'Id [text, NN]'
    type = db.Column(db.Text, nullable=False)
    image = db.Column(db.Text)
    url = db.Column(db.Text, nullable=False)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.Date)
    
    impressions_organic = db.Column(db.Integer)
    impressions_paid = db.Column(db.Integer)
    reach_organic = db.Column(db.Integer)
    reach_paid = db.Column(db.Integer)
    likes = db.Column(db.Integer)
    saved = db.Column(db.Integer)
    comments = db.Column(db.Integer)
    clicks = db.Column(db.Integer)
    interactions = db.Column(db.Integer)
    engagement = db.Column(db.Float)
    video_v = db.Column(db.Integer)

class TbFacebook(PlatformMixin, db.Model):
    __tablename__ = 'tb_facebook'
    # Facebook might not have a unique ID in the provided schema, so we add an auto-inc PK
    internal_id = db.Column(db.Integer, primary_key=True)
    
    image = db.Column(db.Text, nullable=False)
    post_link = db.Column(db.Text, nullable=False)
    content = db.Column(db.Text, nullable=False)
    type = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.Date)
    
    reactions = db.Column(db.Integer)
    comments = db.Column(db.Integer)
    shared = db.Column(db.Integer)
    clicks = db.Column(db.Integer)
    link_clicks = db.Column(db.Integer)
    impressions = db.Column(db.Integer)
    impressions_organic = db.Column(db.Integer)
    impressions_paid = db.Column(db.Integer)
    reach = db.Column(db.Integer)
    reach_organic = db.Column(db.Integer)
    reach_paid = db.Column(db.Integer)
    video_views_organic = db.Column(db.Integer)
    video_views_paid = db.Column(db.Integer)
    video_time_watched = db.Column(db.Float)
    engagement = db.Column(db.Float)
    spent = db.Column(db.Float)

class TbLinkedin(PlatformMixin, db.Model):
    __tablename__ = 'tb_linkedin'
    internal_id = db.Column(db.Integer, primary_key=True)

    tittle = db.Column(db.Text, nullable=False) # Preserving typo from requirement 'Tittle' -> 'tittle'
    date = db.Column(db.Date)
    url = db.Column(db.Text, nullable=False)
    
    likes = db.Column(db.Integer)
    comments = db.Column(db.Integer)
    clicks = db.Column(db.Integer)
    impressions = db.Column(db.Integer)
    engagement = db.Column(db.Float)
    vid_views = db.Column(db.Integer)
    viewers = db.Column(db.Integer)
    time_watched = db.Column(db.Float)
    type = db.Column(db.Text)

class TbTwitter(PlatformMixin, db.Model):
    __tablename__ = 'tb_twitter'
    id = db.Column(db.Text, primary_key=True) # Native ID
    
    url = db.Column(db.Text, nullable=False)
    text = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.Date)
    
    impressions_organic = db.Column(db.Integer)
    impressions_paid = db.Column(db.Integer)
    favorites_organic = db.Column(db.Integer)
    favorites_paid = db.Column(db.Integer)
    retweets_organic = db.Column(db.Integer)
    retweets_paid = db.Column(db.Integer)
    replies_organic = db.Column(db.Integer)
    replies_paid = db.Column(db.Integer)
    quotes = db.Column(db.Integer)
    link_clicks_organic = db.Column(db.Integer)
    link_clicks_paid = db.Column(db.Integer)
    profile_clicks_organic = db.Column(db.Integer)
    profile_clicks_paid = db.Column(db.Integer)
    engagement = db.Column(db.Float)
    video_views_organic = db.Column(db.Integer)
    video_views_paid = db.Column(db.Integer)

class TbYoutube(PlatformMixin, db.Model):
    __tablename__ = 'tb_youtube'
    video_id = db.Column(db.Text, primary_key=True)
    
    thumbnail_url = db.Column(db.Text, nullable=False)
    watch_url = db.Column(db.Text, nullable=False)
    title = db.Column(db.Text, nullable=False)
    published_at = db.Column(db.Date)
    
    views = db.Column(db.Integer)
    watch_minutes = db.Column(db.Float)
    average_view_duration = db.Column(db.Float)
    likes = db.Column(db.Integer)
    dislikes = db.Column(db.Integer)
    comments = db.Column(db.Integer)
    shares = db.Column(db.Integer)
