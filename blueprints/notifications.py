from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from sqlalchemy import case

from extensions import db
from models import Notification


notifications_bp = Blueprint('notifications', __name__)


@notifications_bp.route('/api/notifications')
@login_required
def api_notifications_list():
    unread_only = request.args.get('unread_only', '').strip() == '1'
    try:
        limit = int(request.args.get('limit', 20))
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 50))

    query = Notification.query.filter_by(user_id=current_user.id)
    if unread_only:
        query = query.filter(Notification.read_at.is_(None))

    items = query.order_by(
        case((Notification.read_at.is_(None), 0), else_=1),
        Notification.created_at.desc(),
    ).limit(limit).all()
    unread_count = Notification.query.filter_by(user_id=current_user.id).filter(Notification.read_at.is_(None)).count()

    return jsonify({
        'success': True,
        'items': [item.to_dict() for item in items],
        'unread_count': unread_count,
    })


@notifications_bp.route('/api/notifications/<int:notif_id>/read', methods=['POST'])
@login_required
def api_notifications_mark_read(notif_id):
    notif = Notification.query.filter_by(id=notif_id, user_id=current_user.id).first()
    if not notif:
        return jsonify({'success': False, 'error': 'Notificación no encontrada.'}), 404

    if notif.read_at is None:
        from datetime import datetime
        notif.read_at = datetime.utcnow()
        db.session.commit()

    return jsonify({'success': True})


@notifications_bp.route('/api/notifications/read-all', methods=['POST'])
@login_required
def api_notifications_mark_all_read():
    from datetime import datetime

    Notification.query.filter_by(user_id=current_user.id).filter(Notification.read_at.is_(None)).update(
        {'read_at': datetime.utcnow()},
        synchronize_session=False,
    )
    db.session.commit()
    return jsonify({'success': True})
