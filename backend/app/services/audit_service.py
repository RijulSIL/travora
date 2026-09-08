import hashlib
import json
from datetime import UTC, datetime

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import AuditLog


async def log_event(
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    actor_id: int | None,
    old: dict | None,
    new: dict | None,
    db: AsyncSession,
) -> AuditLog:
    result = await db.execute(select(AuditLog).order_by(desc(AuditLog.id)).limit(1))
    previous = result.scalar_one_or_none()
    previous_hash = previous.event_hash if previous else None
    event_time = datetime.now(UTC).replace(tzinfo=None)
    payload = {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "actor_id": actor_id,
        "old": old,
        "new": new,
        "timestamp": event_time.isoformat(),
        "previous_event_hash": previous_hash,
    }
    event_hash = hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()

    entry = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_id=actor_id,
        old_value=old,
        new_value=new,
        previous_event_hash=previous_hash,
        event_hash=event_hash,
        timestamp=event_time,
    )
    db.add(entry)
    return entry
