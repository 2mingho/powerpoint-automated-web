from extensions import db
from models import Notification


def notify_user(user_id, kind, title, body=None, link_url=None,
                entity_type=None, entity_id=None, actor_id=None):
    """Create an in-app notification. Skips self-notifications."""
    if actor_id is not None and actor_id == user_id:
        return None
    if kind not in Notification.KINDS:
        return None

    notif = Notification(
        user_id=user_id,
        kind=kind,
        title=title,
        body=body,
        link_url=link_url,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    db.session.add(notif)
    return notif


def notify_many(user_ids, **kwargs):
    seen = set()
    for uid in user_ids:
        if uid in seen:
            continue
        seen.add(uid)
        notify_user(uid, **kwargs)
