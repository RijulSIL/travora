import hashlib
import json
from datetime import datetime

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import now_ist
from app.models.employee import AuditChainHead, AuditLog


def _json_safe(value: dict | None) -> dict | None:
    # Store exactly what gets fingerprinted, so the fingerprint can be recalculated later.
    return None if value is None else json.loads(json.dumps(value, default=str))


def row_snapshot(row) -> dict:
    """Every column of a model row, for an audit entry's old/new values."""
    return {column.key: getattr(row, column.key) for column in row.__table__.columns}


def event_fingerprint(
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    actor_id: int | None,
    old: dict | None,
    new: dict | None,
    timestamp: datetime,
    previous_event_hash: str | None,
) -> str:
    payload = {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "actor_id": actor_id,
        "old": old,
        "new": new,
        "timestamp": timestamp.isoformat(),
        "previous_event_hash": previous_event_hash,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()


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
    # Lock the chain head until this transaction ends, so two entries saved at the same moment
    # link one after the other instead of both linking to the same earlier entry.
    # populate_existing: the session keeps objects across commits, so re-read the locked row.
    head = (
        await db.execute(
            select(AuditChainHead)
            .where(AuditChainHead.id == 1)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if head is not None:
        previous_hash = head.last_event_hash
    else:
        result = await db.execute(select(AuditLog).order_by(desc(AuditLog.id)).limit(1))
        previous = result.scalar_one_or_none()
        previous_hash = previous.event_hash if previous else None

    # Whole seconds: the database drops fractions of a second, which would stop the
    # fingerprint from matching when it's recalculated.
    event_time = now_ist().replace(microsecond=0)
    old, new = _json_safe(old), _json_safe(new)
    event_hash = event_fingerprint(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_id=actor_id,
        old=old,
        new=new,
        timestamp=event_time,
        previous_event_hash=previous_hash,
    )

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
    if head is not None:
        await db.flush()  # gives the entry its id
        # Written straight away (not left pending on the object), so the head always matches.
        await db.execute(
            update(AuditChainHead)
            .where(AuditChainHead.id == 1)
            .values(last_entry_id=entry.id, last_event_hash=event_hash)
        )
    return entry


async def check_audit_chain(db: AsyncSession) -> dict:
    """Walk every entry oldest first. A gap is an entry that doesn't link to the one before it
    (kind "missing_previous" when it links to an entry no longer in the log, "wrong_previous"
    when it links to a different entry), an entry whose stored details no longer match its
    fingerprint ("altered", only checkable from recheck_from_id on), or newest entries that were
    removed ("missing_latest"). Gaps before recheck_from_id were there before this check existed."""
    head = (
        await db.execute(
            select(AuditChainHead).where(AuditChainHead.id == 1).execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    recheck_from = head.recheck_from_id if head is not None else None
    links = (
        await db.execute(
            select(
                AuditLog.id,
                AuditLog.previous_event_hash,
                AuditLog.event_hash,
                AuditLog.timestamp,
                AuditLog.action,
                AuditLog.entity_type,
                AuditLog.entity_id,
            ).order_by(AuditLog.id)
        )
    ).all()
    id_by_hash = {row.event_hash: row.id for row in links}

    def gap(row, kind: str) -> dict:
        return {
            "id": row.id,
            "kind": kind,
            "timestamp": row.timestamp,
            "action": row.action,
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "linked_to_id": id_by_hash.get(row.previous_event_hash) if kind == "wrong_previous" else None,
            "is_old": recheck_from is None or row.id < recheck_from,
        }

    gaps = []
    for index, row in enumerate(links):
        expected = links[index - 1].event_hash if index else None
        if row.previous_event_hash == expected:
            continue
        if row.previous_event_hash in id_by_hash:
            gaps.append(gap(row, "wrong_previous"))
        else:
            gaps.append(gap(row, "missing_previous"))

    rechecked = 0
    if recheck_from is not None:
        entries = (
            await db.execute(select(AuditLog).where(AuditLog.id >= recheck_from).order_by(AuditLog.id))
        ).scalars().all()
        for entry in entries:
            rechecked += 1
            fingerprint = event_fingerprint(
                entity_type=entry.entity_type,
                entity_id=entry.entity_id,
                action=entry.action,
                actor_id=entry.actor_id,
                old=entry.old_value,
                new=entry.new_value,
                timestamp=entry.timestamp,
                previous_event_hash=entry.previous_event_hash,
            )
            if fingerprint != entry.event_hash:
                gaps.append(gap(entry, "altered"))

    latest = links[-1] if links else None
    if head is not None and head.last_event_hash and (latest is None or latest.event_hash != head.last_event_hash):
        gaps.append(
            {
                "id": head.last_entry_id,
                "kind": "missing_latest",
                "timestamp": None,
                "action": None,
                "entity_type": None,
                "entity_id": None,
                "linked_to_id": latest.id if latest else None,
                "is_old": False,
            }
        )

    gaps.sort(key=lambda g: g["id"] or 0)
    if not gaps:
        status = "ok"
    elif all(g["is_old"] for g in gaps):
        status = "old_gaps"
    else:
        status = "new_gaps"
    return {
        "status": status,
        "total": len(links),
        "recheck_from_id": recheck_from,
        "rechecked": rechecked,
        "gaps": gaps,
    }
