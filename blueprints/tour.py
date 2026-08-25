"""
blueprints/tour.py
------------------
El tour de bienvenida.

Solo guarda si alguien ya lo vio. Los pasos viven en static/js/tour.js y se
filtran contra lo que hay en la pagina, de modo que a nadie se le ensena una
herramienta a la que no tiene acceso: el sidebar ya se dibuja segun
has_tool_access, asi que preguntarle a el es preguntar por los permisos sin
duplicar la regla aqui.
"""
from datetime import datetime

from flask import Blueprint, jsonify
from flask_login import login_required, current_user

from extensions import db

tour_bp = Blueprint('tour', __name__)


@tour_bp.route('/api/tour/completado', methods=['POST'])
@login_required
def api_tour_completado():
    """Lo dio por visto, sea porque lo termino o porque lo salto."""
    current_user.tour_completed_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True})


@tour_bp.route('/api/tour/reiniciar', methods=['POST'])
@login_required
def api_tour_reiniciar():
    """Volver a verlo. Sin esto el tour seria irrepetible y quien lo saltara
    por accidente en su primer minuto no tendria forma de recuperarlo."""
    current_user.tour_completed_at = None
    db.session.commit()
    return jsonify({'success': True})
