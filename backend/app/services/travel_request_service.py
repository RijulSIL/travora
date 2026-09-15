"""Travel Request + Travel Desk ticket upload (Phase 1).

Lead validation uses UTC calendar dates (`date.today()` in UTC) and counts Mon–Fri as working days.
Minimum lead: first travel date >= today + N working days (exclusive of today: we advance until N weekdays counted).
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, asc, case, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.rbac import PERMISSION_MATRIX
from app.models.auth import Delegation, Role, User
from app.models.employee import Employee
from app.models.policy import CityGroup, ImpactLevel
from app.models.reimbursement import ClaimTrip
from app.models.travel_booking import TravelMode, TravelTrip, TripStatus
from app.models.travel_request import (
    TravelRequest,
    TravelRequestLeg,
    TravelRequestMode,
    TravelRequestStatus,
    TravelRequestTicket,
    TripType,
)

# Re-use entitlement lookups from booking service
from app.services.travel_booking_service import (
    FLIGHT_ALLOWED_CLASSES,
    _canonical_train_class,
    _get_configured_train_classes,
    LEVELS_REQUIRING_AIR_UNLOCK,
    TRAIN_ALLOWED_CLASSES,
    _get_user_impact_level_code,
    _has_completed_exception_chain,
    _normalize_level,
)

_TICKET_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".pdf"}
_TICKET_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/heic",
    "application/pdf",
}
MAX_TICKET_BYTES = 10 * 1024 * 1024


def _utc_today() -> date:
    return datetime.now(UTC).date()


def earliest_travel_date_allowed(today: date, min_lead_working_days: int) -> date:
    """Smallest allowed travel_date: advance `today` until `min_lead_working_days` weekdays counted (tomorrow-forward)."""
    if min_lead_working_days <= 0:
        return today
    d = today
    remaining = min_lead_working_days
    while remaining > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            remaining -= 1
    return d


def _validate_lead_time(travel_date: date, min_days: int) -> None:
    earliest = earliest_travel_date_allowed(_utc_today(), min_days)
    if travel_date < earliest:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Travel must be booked at least {min_days} working day(s) in advance. "
                f"Earliest allowed travel date is {earliest.isoformat()}."
            ),
        )


def _validate_ticket_file(filename: str, content_type: str, content: bytes) -> tuple[str, str]:
    suffix = Path(filename).suffix.lower()
    if suffix not in _TICKET_EXTENSIONS or content_type not in _TICKET_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Supported ticket formats are JPEG, PNG, HEIC and PDF",
        )
    if len(content) > MAX_TICKET_BYTES:
        raise HTTPException(status_code=413, detail="Ticket file exceeds 10 MB")
    digest = hashlib.sha256(content).hexdigest()
    return digest, suffix


async def entitlement_note_for_user(user_id: int, db: AsyncSession) -> dict[str, str]:
    """Plain-language policy summary for Travel Request disclaimer (reuse impact-level rules)."""
    level = await _get_user_impact_level_code(user_id, db)
    flight_allowed = FLIGHT_ALLOWED_CLASSES.get(level, {"ECONOMY"})
    train_allowed = TRAIN_ALLOWED_CLASSES.get(level, {"2AC"})
    parts = [
        f"Impact level {level}",
        f"Eligible flight cabins: {', '.join(sorted(flight_allowed))}",
        f"Eligible train classes: {', '.join(sorted(train_allowed))}",
    ]
    return {"impact_level": level, "text": "; ".join(parts) + "."}


async def city_suggestions(prefix: str, limit: int, db: AsyncSession) -> list[str]:
    q = prefix.strip().lower()
    if len(q) < 1:
        return []
    stmt = (
        select(distinct(CityGroup.city_name))
        .where(func.lower(CityGroup.city_name).like(f"%{q}%"))
        .order_by(CityGroup.city_name.asc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [str(r) for r in rows]


async def _validate_common_travel_request_fields(
    *, user_id: int, travel_mode: TravelRequestMode | str, travel_date: date | None, legs: list | None, db: AsyncSession
) -> tuple[object, str]:
    """Shared, non-exception-related validation. Returns (user, normalized mode_val)."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.employee_id:
        raise HTTPException(status_code=422, detail="Travel requests require your profile to link to an employee id")

    mode_val = travel_mode.value if isinstance(travel_mode, TravelRequestMode) else str(travel_mode).upper()
    if mode_val not in {m.value for m in TravelRequestMode}:
        raise HTTPException(status_code=422, detail="Invalid travel_mode")

    if travel_date:
        _validate_lead_time(travel_date, settings.travel_request_min_lead_working_days)
    elif legs and len(legs) > 0:
        _validate_lead_time(legs[0].travel_date, settings.travel_request_min_lead_working_days)

    return user, mode_val


async def _determine_blocking_exception(
    *, user_id: int, mode_val: str, impact_level: str, travel_date: date | None, legs: list | None, db: AsyncSession
) -> tuple[str, str] | None:
    """Returns (exception_type, message) if this request needs a policy exception to proceed, else None.

    Checks the primary trip fields plus every MULTI_CITY leg individually — a flight buried in leg 2
    or 3 of a mixed-mode trip must trigger the same checks as a single-leg flight request.
    """
    flight_dates: list[date] = []
    if mode_val == "FLIGHT" and travel_date:
        flight_dates.append(travel_date)
    for leg in legs or []:
        leg_mode = leg.travel_mode.upper() if leg.travel_mode else mode_val
        if leg_mode == "FLIGHT" and leg.travel_date:
            flight_dates.append(leg.travel_date)

    if not flight_dates:
        return None

    earliest_flight_date = min(flight_dates)
    min_days = settings.flight_advance_booking_min_days
    days_in_advance = (earliest_flight_date - date.today()).days
    min_advance_enforced = days_in_advance < min_days
    has_advance_override = await _has_completed_exception_chain(
        user_id, "FLIGHT_ADVANCE_BOOKING_OVERRIDE", db
    )
    if min_advance_enforced and not has_advance_override:
        return (
            "FLIGHT_ADVANCE_BOOKING_OVERRIDE",
            f"Minimum {min_days}-day advance booking window for flights is enforced.",
        )

    if impact_level in LEVELS_REQUIRING_AIR_UNLOCK:
        # Scoped to this specific request, not a standing unlock for the employee: a prior
        # AIR_TRAVEL_UNLOCK approval covered only the trip it was raised for, so every new
        # flight booking needs its own fresh exception approval.
        return (
            "AIR_TRAVEL_UNLOCK",
            "Air travel is locked for your level until Reporting Manager + Group Head HR + CEO "
            "exception approval is recorded for this request.",
        )

    return None


async def create_travel_request(
    *,
    user_id: int,
    trip_type: str,
    travel_mode: TravelRequestMode | str,
    from_city: str | None,
    to_city: str | None,
    travel_date: date | None,
    return_date: date | None,
    purpose: str | None,
    preferred_class: str | None,
    notes: str | None,
    legs: list | None,
    db: AsyncSession,
) -> TravelRequest:
    user, mode_val = await _validate_common_travel_request_fields(
        user_id=user_id, travel_mode=travel_mode, travel_date=travel_date, legs=legs, db=db
    )

    impact_level = await _get_user_impact_level_code(user_id, db)
    blocking = await _determine_blocking_exception(
        user_id=user_id, mode_val=mode_val, impact_level=impact_level, travel_date=travel_date, legs=legs, db=db
    )
    if blocking:
        _exception_type, message = blocking
        status_code = status.HTTP_403_FORBIDDEN if _exception_type == "AIR_TRAVEL_UNLOCK" else 422
        raise HTTPException(status_code=status_code, detail=message)

    if preferred_class:
        if mode_val == "FLIGHT":
            allowed = FLIGHT_ALLOWED_CLASSES.get(impact_level, {"ECONOMY"})
            if preferred_class.upper() not in allowed:
                raise HTTPException(
                    status_code=422,
                    detail=f"Preferred class {preferred_class} is not allowed for your impact level ({impact_level}).",
                )
        elif mode_val == "TRAIN":
            configured = await _get_configured_train_classes(user_id, db)
            allowed = configured if configured is not None else TRAIN_ALLOWED_CLASSES.get(impact_level)
            if allowed and _canonical_train_class(preferred_class) not in allowed:
                raise HTTPException(
                    status_code=422,
                    detail=f"Preferred class {preferred_class} is not allowed for your impact level ({impact_level}).",
                )

    row = await _insert_travel_request_row(
        user_id=user_id,
        trip_type=trip_type,
        mode_val=mode_val,
        from_city=from_city,
        to_city=to_city,
        travel_date=travel_date,
        return_date=return_date,
        purpose=purpose,
        preferred_class=preferred_class,
        notes=notes,
        legs=legs,
        status_value=TravelRequestStatus.PENDING.value,
        db=db,
    )

    # Create notification for manager
    try:
        stmt = select(Employee).where(Employee.employee_id == user.employee_id)
        emp = (await db.execute(stmt)).scalar_one_or_none()
        if emp and emp.reporting_manager_id:
            stmt = select(User).where(User.employee_id == emp.reporting_manager_id)
            manager_user = (await db.execute(stmt)).scalar_one_or_none()
            if manager_user:
                from app.services.notification_service import create_notification
                dest = to_city if to_city else (legs[0].to_city if legs else "Unknown")
                src = from_city if from_city else (legs[0].from_city if legs else "Unknown")
                await create_notification(
                    user_id=manager_user.id,
                    title="New Travel Request",
                    body=f"New travel request from {user.full_name or user.email} for {src} -> {dest}.",
                    link="/pending-approvals",
                    category="APPROVAL_REQUIRED",
                    db=db
                )
                await db.commit()
    except Exception as e:
        print(f"Failed to create notification: {e}")

    return await _reload_travel_request_with_legs(row.id, db)


async def _insert_travel_request_row(
    *,
    user_id: int,
    trip_type: str,
    mode_val: str,
    from_city: str | None,
    to_city: str | None,
    travel_date: date | None,
    return_date: date | None,
    purpose: str | None,
    preferred_class: str | None,
    notes: str | None,
    legs: list | None,
    status_value: str,
    db: AsyncSession,
) -> TravelRequest:
    row = TravelRequest(
        employee_user_id=user_id,
        trip_type=trip_type,
        travel_mode=mode_val,
        from_city=(from_city.strip() if from_city else None),
        to_city=(to_city.strip() if to_city else None),
        travel_date=travel_date,
        return_date=return_date,
        purpose=purpose,
        preferred_class=preferred_class,
        notes=notes,
        status=status_value,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    if legs and trip_type == TripType.MULTI_CITY.value:
        for i, leg in enumerate(legs):
            db.add(TravelRequestLeg(
                travel_request_id=row.id,
                leg_sequence=i+1,
                travel_mode=leg.travel_mode.upper() if leg.travel_mode else mode_val,
                from_city=leg.from_city,
                to_city=leg.to_city,
                travel_date=leg.travel_date,
                preferred_time=leg.preferred_time
            ))
        await db.commit()
        await db.refresh(row)

    return row


async def _reload_travel_request_with_legs(request_id: int, db: AsyncSession) -> TravelRequest:
    stmt = select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == request_id)
    return (await db.execute(stmt)).scalar_one()


async def create_travel_request_with_exception(
    *,
    user_id: int,
    trip_type: str,
    travel_mode: TravelRequestMode | str,
    from_city: str | None,
    to_city: str | None,
    travel_date: date | None,
    return_date: date | None,
    purpose: str | None,
    preferred_class: str | None,
    notes: str | None,
    legs: list | None,
    justification: str,
    db: AsyncSession,
) -> TravelRequest:
    """Same validation as create_travel_request, but when the request is only blocked by a
    policy exception, creates it anyway in PENDING_EXCEPTION status and raises the exception
    request instead of rejecting the submission outright."""
    await _validate_common_travel_request_fields(
        user_id=user_id, travel_mode=travel_mode, travel_date=travel_date, legs=legs, db=db
    )
    mode_val = travel_mode.value if isinstance(travel_mode, TravelRequestMode) else str(travel_mode).upper()

    impact_level = await _get_user_impact_level_code(user_id, db)
    blocking = await _determine_blocking_exception(
        user_id=user_id, mode_val=mode_val, impact_level=impact_level, travel_date=travel_date, legs=legs, db=db
    )

    if blocking is None:
        # Nothing actually blocks this — no exception needed, submit normally.
        return await create_travel_request(
            user_id=user_id,
            trip_type=trip_type,
            travel_mode=travel_mode,
            from_city=from_city,
            to_city=to_city,
            travel_date=travel_date,
            return_date=return_date,
            purpose=purpose,
            preferred_class=preferred_class,
            notes=notes,
            legs=legs,
            db=db,
        )

    exception_type, _message = blocking

    row = await _insert_travel_request_row(
        user_id=user_id,
        trip_type=trip_type,
        mode_val=mode_val,
        from_city=from_city,
        to_city=to_city,
        travel_date=travel_date,
        return_date=return_date,
        purpose=purpose,
        preferred_class=preferred_class,
        notes=notes,
        legs=legs,
        status_value=TravelRequestStatus.PENDING_EXCEPTION.value,
        db=db,
    )

    from app.services.workflow_service import create_travel_exception_request

    await create_travel_exception_request(row.id, user_id, exception_type, justification, db)

    return await _reload_travel_request_with_legs(row.id, db)


_TICKETED_STATUSES = (TravelRequestStatus.BOOKED.value, TravelRequestStatus.PARTIALLY_BOOKED.value)


def _latest_ticket(req: TravelRequest) -> TravelRequestTicket | None:
    """Most recently uploaded ticket, if this request has any (kept for callers that only
    want a single preview ticket — `build_segments_out` is the source of truth for per-leg
    ticket status)."""
    if req.status not in _TICKETED_STATUSES:
        return None
    tickets = req.tickets or []
    return max(tickets, key=lambda t: t.uploaded_at) if tickets else None


async def list_travel_requests_for_employee(user_id: int, db: AsyncSession) -> list[tuple[TravelRequest, TravelRequestTicket | None]]:
    reqs = (
        await db.execute(
            select(TravelRequest)
            .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
            .where(TravelRequest.employee_user_id == user_id)
            .order_by(TravelRequest.requested_at.desc())
        )
    ).scalars().all()
    return [(r, _latest_ticket(r)) for r in reqs]


async def get_latest_exceptions_for_requests(request_ids: Sequence[int], db: AsyncSession) -> dict[int, dict]:
    """Latest exception chain (if any) per travel_request_id, keyed for TravelExceptionSummaryOut."""
    if not request_ids:
        return {}

    from app.models.claim_workflow import ExceptionApproval, ExceptionRequest

    exc_rows = (
        await db.execute(
            select(ExceptionRequest)
            .where(ExceptionRequest.travel_request_id.in_(list(request_ids)))
            .order_by(ExceptionRequest.created_at.desc())
        )
    ).scalars().all()
    latest_by_request: dict[int, ExceptionRequest] = {}
    for exc in exc_rows:
        latest_by_request.setdefault(exc.travel_request_id, exc)
    if not latest_by_request:
        return {}

    exc_ids = [exc.id for exc in latest_by_request.values()]
    approvals = (
        await db.execute(
            select(ExceptionApproval)
            .where(ExceptionApproval.exception_request_id.in_(exc_ids))
            .order_by(ExceptionApproval.id.asc())
        )
    ).scalars().all()
    approvals_by_exc: dict[int, list[ExceptionApproval]] = {}
    for a in approvals:
        approvals_by_exc.setdefault(a.exception_request_id, []).append(a)

    out: dict[int, dict] = {}
    for req_id, exc in latest_by_request.items():
        out[req_id] = {
            "id": exc.id,
            "exception_type": exc.exception_type,
            "status": exc.status,
            "decision_comment": exc.decision_comment,
            "approvals": [
                {
                    "required_role": a.required_role,
                    "status": a.status,
                    "acted_at": a.acted_at,
                    "comment": a.comment,
                }
                for a in approvals_by_exc.get(exc.id, [])
            ],
        }
    return out


async def _employee_impact_bundle(employee_ids: Sequence[str], db: AsyncSession) -> dict[str, tuple[str, ImpactLevel | None]]:
    """Map employee_id -> (employee full_name, ImpactLevel optional)."""
    if not employee_ids:
        return {}
    emps = (await db.execute(select(Employee).where(Employee.employee_id.in_(set(employee_ids))))).scalars().all()
    impacts: dict[int, ImpactLevel] = {}
    lvl_ids = {e.impact_level_id for e in emps if e.impact_level_id}
    if lvl_ids:
        for il in (
            await db.execute(select(ImpactLevel).where(ImpactLevel.id.in_(lvl_ids)))
        ).scalars().all():
            impacts[il.id] = il

    bundle: dict[str, tuple[str, ImpactLevel | None]] = {}
    for e in emps:
        il = impacts.get(e.impact_level_id) if e.impact_level_id else None
        bundle[e.employee_id] = (e.full_name, il)
    return bundle


async def _ticket_linked_to_viewable_claim(
    ticket: TravelRequestTicket, viewer_user_id: int, db: AsyncSession
) -> bool:
    if not ticket.travel_request_id:
        return False
    trip_ids = (
        await db.execute(
            select(TravelTrip.id).where(TravelTrip.travel_request_id == ticket.travel_request_id)
        )
    ).scalars().all()
    if not trip_ids:
        return False
    from app.services.workflow_service import assert_user_can_view_claim_workflow

    for trip_id in trip_ids:
        claim_ids = (
            await db.execute(select(ClaimTrip.claim_id).where(ClaimTrip.trip_id == int(trip_id)))
        ).scalars().all()
        for cid in claim_ids:
            try:
                await assert_user_can_view_claim_workflow(int(cid), viewer_user_id, db)
                return True
            except HTTPException:
                continue
    return False


async def viewer_can_download_ticket(
    *,
    viewer_user_id: int,
    viewer_role: Role,
    ticket: TravelRequestTicket,
    db: AsyncSession,
) -> bool:
    """Owner, HRBP, reporting manager, or finance/payroll viewer of a linked claim."""
    req = (await db.execute(select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == ticket.travel_request_id))).scalar_one_or_none()
    if req is None:
        return False
    if req.employee_user_id == viewer_user_id or viewer_role == Role.HRBP_HR:
        return True
    allowed = PERMISSION_MATRIX.get(viewer_role, set())
    if {"view_reports", "process_payments"} & allowed:
        return await _ticket_linked_to_viewable_claim(ticket, viewer_user_id, db)
    if viewer_role != Role.REPORTING_MANAGER:
        return False
    return await _actor_is_reporting_manager_for(
        manager_user_id=viewer_user_id, subordinate_user_id=req.employee_user_id, db=db
    )




async def count_pending_travel_requests_for_desk(db: AsyncSession) -> int:
    """Cheap count (no employee/impact-level enrichment) for the Travel Desk nav badge."""
    result = await db.execute(
        select(func.count(TravelRequest.id)).where(
            TravelRequest.status.in_(
                [TravelRequestStatus.APPROVED.value, TravelRequestStatus.PARTIALLY_BOOKED.value]
            )
        )
    )
    return int(result.scalar_one())


async def list_pending_travel_requests_for_desk(db: AsyncSession) -> list[dict]:
    """Queue: APPROVED or PARTIALLY_BOOKED (some but not all legs ticketed) — stays actionable
    until every segment has a ticket. Manager approval happens before Travel Desk ever sees it.

    Default order surfaces PARTIALLY_BOOKED requests first (they're mid-booking and easiest to
    finish), then APPROVED ones — each group oldest-first."""
    status_priority = case(
        (TravelRequest.status == TravelRequestStatus.PARTIALLY_BOOKED.value, 0),
        else_=1,
    )
    rows = (
        await db.execute(
            select(TravelRequest)
            .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
            .where(TravelRequest.status.in_([TravelRequestStatus.APPROVED.value, TravelRequestStatus.PARTIALLY_BOOKED.value]))
            .order_by(status_priority, TravelRequest.requested_at.asc())
        )
    ).scalars().all()

    user_ids = {r.employee_user_id for r in rows}
    users_map = {}
    if user_ids:
        for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all():
            users_map[u.id] = u
    emp_ids = [u.employee_id for u in users_map.values() if u.employee_id]
    bundles = await _employee_impact_bundle([e for e in emp_ids if e], db)

    enriched: list[dict] = []
    for req in rows:
        u = users_map.get(req.employee_user_id)
        nm, impact = "", None
        if u and u.employee_id and u.employee_id in bundles:
            nm, impact = bundles[u.employee_id]
        lvl_code = _normalize_level(impact.level_code) if impact else "L5A"
        enriched.append(
            {
                "request": req,
                "employee_display_name": nm or (u.full_name if u else "") or "",
                "impact_level_code": lvl_code,
            }
        )
    return enriched


async def list_pending_travel_requests_for_manager(manager_user_id: int, db: AsyncSession) -> list[TravelRequest]:
    """List pending travel requests for subordinates of the given manager and any delegators."""
    mgr = await db.get(User, manager_user_id)
    if not mgr or not mgr.employee_id:
        return []
        
    from datetime import datetime
    now = datetime.utcnow()
    delegators_q = select(Delegation.delegator_id).where(
        Delegation.delegatee_id == manager_user_id,
        Delegation.is_active,
        Delegation.start_date <= now,
        Delegation.end_date >= now
    )
    delegator_user_ids = (await db.execute(delegators_q)).scalars().all()
    
    manager_emp_ids = [mgr.employee_id]
    if delegator_user_ids:
        delegator_emp_ids = (await db.execute(select(User.employee_id).where(User.id.in_(delegator_user_ids)))).scalars().all()
        manager_emp_ids.extend([eid for eid in delegator_emp_ids if eid])
        
    sub_stmt = select(Employee.employee_id).where(Employee.reporting_manager_id.in_(manager_emp_ids))
    sub_emp_ids = (await db.execute(sub_stmt)).scalars().all()
    if not sub_emp_ids:
        return []
        
    user_stmt = select(User.id).where(User.employee_id.in_(sub_emp_ids))
    sub_user_ids = (await db.execute(user_stmt)).scalars().all()
    if not sub_user_ids:
        return []
    stmt = (
        select(TravelRequest)
        .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
        .where(
            and_(
                TravelRequest.employee_user_id.in_(sub_user_ids),
                TravelRequest.status == TravelRequestStatus.PENDING.value
            )
        )
        .order_by(TravelRequest.requested_at.desc())
    )
    rows = list((await db.execute(stmt)).scalars().all())
    
    user_ids = {r.employee_user_id for r in rows}
    users_map = {}
    if user_ids:
        for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all():
            users_map[u.id] = u
    emp_ids = [u.employee_id for u in users_map.values() if u.employee_id]
    
    from app.services.travel_request_service import _employee_impact_bundle
    bundles = await _employee_impact_bundle([e for e in emp_ids if e], db)

    enriched: list[dict] = []
    for req in rows:
        u = users_map.get(req.employee_user_id)
        nm, impact = "", None
        if u and u.employee_id and u.employee_id in bundles:
            nm, impact = bundles[u.employee_id]
        lvl_code = _normalize_level(impact.level_code) if impact else "L5A"
        enriched.append(
            {
                "request": req,
                "employee_display_name": nm or (u.full_name if u else "") or "",
                "impact_level_code": lvl_code,
            }
        )
    return enriched


def _primary_travel_date(req: TravelRequest) -> date | None:
    if req.trip_type == "MULTI_CITY" and req.legs:
        leg_dates = [leg.travel_date for leg in req.legs if leg.travel_date]
        return min(leg_dates) if leg_dates else None
    return req.travel_date


def _segments_for_request(req: TravelRequest) -> list[dict]:
    """Independently-ticketable legs of a request: 1 for ONE_WAY, 2 for ROUND_TRIP (onward +
    return — there are no persisted leg rows for round trips, so these are derived from the
    request's own from/to/travel_date/return_date), or one per TravelRequestLeg for MULTI_CITY."""
    if req.trip_type == TripType.MULTI_CITY.value and req.legs:
        return [
            {
                "seq": leg.leg_sequence,
                "label": f"Leg {leg.leg_sequence}: {leg.from_city} → {leg.to_city}",
                "mode": leg.travel_mode or req.travel_mode,
                "from_city": leg.from_city,
                "to_city": leg.to_city,
                "travel_date": leg.travel_date,
            }
            for leg in req.legs
        ]
    if req.trip_type == TripType.ROUND_TRIP.value and req.return_date:
        return [
            {
                "seq": 1,
                "label": f"Onward: {req.from_city} → {req.to_city}",
                "mode": req.travel_mode,
                "from_city": req.from_city,
                "to_city": req.to_city,
                "travel_date": req.travel_date,
            },
            {
                "seq": 2,
                "label": f"Return: {req.to_city} → {req.from_city}",
                "mode": req.travel_mode,
                "from_city": req.to_city,
                "to_city": req.from_city,
                "travel_date": req.return_date,
            },
        ]
    return [
        {
            "seq": 1,
            "label": f"{req.from_city} → {req.to_city}" if req.from_city else "Ticket",
            "mode": req.travel_mode,
            "from_city": req.from_city,
            "to_city": req.to_city,
            "travel_date": req.travel_date,
        }
    ]


def build_segments_out(req: TravelRequest) -> list[dict]:
    """Segment descriptors merged with whichever ticket (if any) covers each one.

    Returns plain dicts (each with a raw `TravelRequestTicket | None` under "ticket") so the
    service layer stays schema-agnostic; callers convert to `TravelRequestSegmentOut` /
    `TravelRequestTicketAttachmentOut` themselves.
    """
    tickets_by_seq: dict[int, TravelRequestTicket] = {}
    for t in req.tickets or []:
        tickets_by_seq[t.leg_sequence] = t
    return [{**seg, "ticket": tickets_by_seq.get(seg["seq"])} for seg in _segments_for_request(req)]


async def list_all_travel_requests_for_desk(
    *,
    db: AsyncSession,
    status_filter: str | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    impact_level: str | None = None,
    limit: int = 500,
) -> list[dict]:
    stmt = select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
    if status_filter:
        stmt = stmt.where(TravelRequest.status == status_filter)
    stmt = stmt.order_by(TravelRequest.requested_at.desc()).limit(limit)
    reqs = list((await db.execute(stmt)).scalars().all())

    user_ids = {r.employee_user_id for r in reqs}
    users_map: dict[int, User] = {}
    if user_ids:
        users_map = {
            u.id: u
            for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        }
    emp_ids = [u.employee_id for u in users_map.values() if u.employee_id]
    bundles = await _employee_impact_bundle([e for e in emp_ids if e], db)

    needle = q.strip().lower() if q and q.strip() else None
    wanted_level = impact_level.strip().upper() if impact_level and impact_level.strip() else None

    def matches_text(req: TravelRequest, u: User | None, employee_name: str) -> bool:
        if not needle:
            return True
        if needle in req.from_city.lower() or needle in req.to_city.lower():
            return True
        if employee_name and needle in employee_name.lower():
            return True
        if u and u.email and needle in u.email.lower():
            return True
        return False

    out: list[dict] = []
    for req in reqs:
        u = users_map.get(req.employee_user_id)
        nm, impact = "", None
        if u and u.employee_id and u.employee_id in bundles:
            nm, impact = bundles[u.employee_id]
        display_name = nm or (u.full_name if u else "") or ""
        lvl_code = _normalize_level(impact.level_code) if impact else "L5A"

        if not matches_text(req, u, display_name):
            continue
        if wanted_level and lvl_code != wanted_level:
            continue

        travel_date = _primary_travel_date(req)
        if date_from and (travel_date is None or travel_date < date_from):
            continue
        if date_to and (travel_date is None or travel_date > date_to):
            continue

        out.append(
            {
                "request": req,
                "employee_display_name": display_name,
                "impact_level_code": lvl_code,
            }
        )
    return out


async def get_travel_request_for_viewer(
    request_id: int, viewer_user_id: int, viewer_role: Role, db: AsyncSession
) -> tuple[TravelRequest, TravelRequestTicket | None]:
    req = (await db.execute(select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == request_id))).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    if req.employee_user_id == viewer_user_id:
        return req, _latest_ticket(req)
    if viewer_role == Role.HRBP_HR:
        return req, _latest_ticket(req)
    if viewer_role == Role.REPORTING_MANAGER and await _actor_is_reporting_manager_for(
        manager_user_id=viewer_user_id, subordinate_user_id=req.employee_user_id, db=db
    ):
        return req, _latest_ticket(req)
    raise HTTPException(status_code=403, detail="Not allowed to view this travel request")


async def _actor_is_reporting_manager_for(
    *, manager_user_id: int, subordinate_user_id: int, db: AsyncSession
) -> bool:
    mgr = await db.get(User, manager_user_id)
    sub_user = await db.get(User, subordinate_user_id)
    if mgr is None or sub_user is None or not mgr.employee_id or not sub_user.employee_id:
        return False
    sub_emp = await db.get(Employee, sub_user.employee_id)
    if sub_emp is None or not sub_emp.reporting_manager_id:
        return False
        
    if sub_emp.reporting_manager_id == mgr.employee_id:
        return True

    from datetime import datetime
    now = datetime.utcnow()
    delegators_q = select(Delegation.delegator_id).where(
        Delegation.delegatee_id == manager_user_id,
        Delegation.is_active,
        Delegation.start_date <= now,
        Delegation.end_date >= now
    )
    delegator_user_ids = (await db.execute(delegators_q)).scalars().all()
    if delegator_user_ids:
        delegator_emp_ids = (await db.execute(select(User.employee_id).where(User.id.in_(delegator_user_ids)))).scalars().all()
        if sub_emp.reporting_manager_id in delegator_emp_ids:
            return True

    return False


async def assert_can_approve_or_reject(actor_user_id: int, request: TravelRequest, role: Role, db: AsyncSession) -> None:
    if await _actor_is_reporting_manager_for(
        manager_user_id=actor_user_id, subordinate_user_id=request.employee_user_id, db=db
    ):
        return
    raise HTTPException(status_code=403, detail="Not allowed to approve or reject this request")


async def approve_travel_request(request_id: int, actor_user_id: int, role: Role, db: AsyncSession) -> TravelRequest:
    stmt = select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == request_id)
    req = (await db.execute(stmt)).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    await assert_can_approve_or_reject(actor_user_id, req, role, db)
    if req.status != TravelRequestStatus.PENDING.value:
        raise HTTPException(status_code=409, detail="Only PENDING requests can be approved")
    req.status = TravelRequestStatus.APPROVED.value

    # Create notification for employee
    try:
        from app.services.notification_service import create_notification
        await create_notification(
            user_id=req.employee_user_id,
            title="Travel Request Approved",
            body=f"Your travel request for {req.from_city} -> {req.to_city} has been approved by your manager.",
            link="/travel-requests",
            category="CLAIM_UPDATE",
            db=db
        )
        
        # Notify HRBP / Travel Desk to book the tickets
        stmt = select(User).where(User.role == Role.HRBP_HR)
        hrbps = (await db.execute(stmt)).scalars().all()
        for hrbp in hrbps:
            await create_notification(
                user_id=hrbp.id,
                title="Pending Travel Booking",
                body=f"A travel request from {req.from_city} -> {req.to_city} was approved and is pending ticketing.",
                link="/travel-desk",
                category="ACTION_REQUIRED",
                db=db
            )
    except Exception as e:
        print(f"Failed to create notification: {e}")

    await db.commit()
    await db.refresh(req)
    return req


async def reject_travel_request(
    request_id: int, actor_user_id: int, role: Role, reason: str, db: AsyncSession
) -> TravelRequest:
    stmt = select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == request_id)
    req = (await db.execute(stmt)).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    await assert_can_approve_or_reject(actor_user_id, req, role, db)
    if req.status != TravelRequestStatus.PENDING.value:
        raise HTTPException(status_code=409, detail="Only PENDING requests can be rejected")
    req.status = TravelRequestStatus.REJECTED.value
    req.rejection_reason = reason.strip()

    # Create notification for employee
    try:
        from app.services.notification_service import create_notification
        await create_notification(
            user_id=req.employee_user_id,
            title="Travel Request Rejected",
            body=f"Your travel request for {req.from_city} -> {req.to_city} has been rejected. Reason: {reason}",
            link="/travel-requests",
            category="CLAIM_UPDATE",
            db=db
        )
    except Exception as e:
        print(f"Failed to create notification: {e}")

    await db.commit()
    await db.refresh(req)
    return req


async def cancel_travel_request(request_id: int, owner_user_id: int, db: AsyncSession) -> TravelRequest:
    req = (
        await db.execute(
            select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == request_id)
        )
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    if req.employee_user_id != owner_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if req.status not in (TravelRequestStatus.PENDING.value, TravelRequestStatus.PENDING_EXCEPTION.value):
        raise HTTPException(status_code=409, detail="Only PENDING requests can be cancelled")

    if req.status == TravelRequestStatus.PENDING_EXCEPTION.value:
        from app.models.claim_workflow import ExceptionApproval, ExceptionRequest, ExceptionRequestStatus

        pending_exceptions = (
            await db.execute(
                select(ExceptionRequest).where(
                    ExceptionRequest.travel_request_id == req.id,
                    ExceptionRequest.status != ExceptionRequestStatus.REJECTED.value,
                )
            )
        ).scalars().all()
        for exc in pending_exceptions:
            exc.status = ExceptionRequestStatus.REJECTED.value
            exc.decision_comment = "Travel request cancelled by employee."
            approvals = (
                await db.execute(
                    select(ExceptionApproval).where(ExceptionApproval.exception_request_id == exc.id)
                )
            ).scalars().all()
            for a in approvals:
                if a.status in (ExceptionRequestStatus.PENDING.value, "AWAITING"):
                    a.status = ExceptionRequestStatus.REJECTED.value

    req.status = TravelRequestStatus.CANCELLED.value
    await db.commit()
    await db.refresh(req)
    return req


async def upload_ticket_for_request(
    *,
    request_id: int,
    uploader_user_id: int,
    file: UploadFile,
    payload: dict,
    leg_sequence: int = 1,
    db: AsyncSession,
) -> tuple[TravelRequest, TravelRequestTicket, TravelTrip]:
    """HRBP uploads a ticket PDF/image for one segment of the request (the whole trip for
    ONE_WAY, or one of the onward/return/multi-city legs). The request becomes PARTIALLY_BOOKED
    once at least one segment is ticketed, and BOOKED once every segment has one."""
    req = (
        await db.execute(
            select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == request_id)
        )
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    if req.status not in (TravelRequestStatus.APPROVED.value, TravelRequestStatus.PARTIALLY_BOOKED.value):
        raise HTTPException(status_code=409, detail="Travel request must be APPROVED before ticket upload")

    segments = _segments_for_request(req)
    segment = next((s for s in segments if s["seq"] == leg_sequence), None)
    if segment is None:
        raise HTTPException(status_code=422, detail=f"leg_sequence {leg_sequence} is not a valid segment for this request")

    owner = await db.get(User, req.employee_user_id)
    if owner is None or not owner.employee_id:
        raise HTTPException(status_code=422, detail="Request owner employee record incomplete")

    content = await file.read()
    digest, suffix = _validate_ticket_file(file.filename or "ticket.pdf", file.content_type or "application/octet-stream", content)

    storage_root = Path(settings.travel_ticket_storage_dir) / str(request_id)
    storage_root.mkdir(parents=True, exist_ok=True)
    path = storage_root / f"{digest}{suffix}"
    path.write_bytes(content)

    pnr = payload.get("pnr_or_booking_ref")
    amt_raw = payload.get("ticket_amount")
    tclass = payload.get("ticket_travel_class")
    ext_src = payload.get("external_booking_source")
    notes_emp = payload.get("notes_for_employee")

    amt: Decimal | None = None
    if amt_raw is not None and str(amt_raw).strip():
        try:
            amt = Decimal(str(amt_raw)).quantize(Decimal("0.01"))
        except Exception as exc:
            raise HTTPException(status_code=422, detail="ticket_amount invalid") from exc

    mode_str = segment["mode"] or req.travel_mode
    try:
        mode_enum = TravelMode[mode_str]
    except KeyError as exc:
        raise HTTPException(status_code=500, detail="Invalid travel_mode on request") from exc

    reference_id = payload.get("reference_id") or f"DESK-{request_id}-{leg_sequence}-{uuid4().hex[:8].upper()}"
    provider = str(payload.get("provider") or "Travel Desk")

    amt_final = amt if amt is not None else Decimal("0.00")

    meta = {"travel_request_id": request_id, "leg_sequence": leg_sequence, "source": "travel_desk_upload", "parsed": payload}

    boarding = str(path).replace("\\", "/") if mode_enum == TravelMode.FLIGHT else None

    trip = TravelTrip(
        employee_user_id=req.employee_user_id,
        travel_request_id=request_id,
        booked_by_travel_desk=True,
        assigned_to_employee_id=owner.employee_id,
        mode=mode_enum,
        from_city=segment["from_city"],
        to_city=segment["to_city"],
        travel_date=segment["travel_date"],
        provider=provider[:64],
        reference_id=str(reference_id)[:64],
        travel_class=tclass,
        amount=amt_final,
        gst_invoice_requested=False,
        booking_metadata=meta,
        status=TripStatus.CONFIRMED,
        boarding_pass_path=boarding,
    )
    db.add(trip)
    await db.flush()

    ticket_row = TravelRequestTicket(
        travel_request_id=request_id,
        travel_trip_id=trip.id,
        leg_sequence=leg_sequence,
        uploaded_by_user_id=uploader_user_id,
        file_sha256=digest,
        original_filename=(file.filename or "ticket.bin")[:255],
        storage_path=str(path),
        content_type=(file.content_type or "application/octet-stream")[:128],
        file_size_bytes=len(content),
        pnr_or_booking_ref=pnr.strip()[:128] if isinstance(pnr, str) and pnr.strip() else None,
        ticket_amount=amt,
        ticket_travel_class=tclass.strip()[:64] if isinstance(tclass, str) and tclass.strip() else None,
        external_booking_source=ext_src.strip()[:128] if isinstance(ext_src, str) and ext_src.strip() else None,
        notes_for_employee=notes_emp if isinstance(notes_emp, str) else None,
    )
    db.add(ticket_row)

    ticketed_seqs = {t.leg_sequence for t in (req.tickets or [])} | {leg_sequence}
    all_ticketed = ticketed_seqs.issuperset({s["seq"] for s in segments})
    req.status = TravelRequestStatus.BOOKED.value if all_ticketed else TravelRequestStatus.PARTIALLY_BOOKED.value

    # Create notification for employee
    try:
        from app.services.notification_service import create_notification
        if all_ticketed:
            body = (
                f"Your ticket for {req.from_city} -> {req.to_city} has been booked and uploaded by the Travel Desk."
                if len(segments) == 1
                else "All legs of your trip have been ticketed and uploaded by the Travel Desk."
            )
        else:
            body = f"{segment['label']} has been ticketed. {len(segments) - len(ticketed_seqs)} leg(s) still pending."
        await create_notification(
            user_id=req.employee_user_id,
            title="Travel Booked" if all_ticketed else "Travel Partially Booked",
            body=body,
            link="/travel-requests",
            category="CLAIM_UPDATE",
            db=db
        )
    except Exception as e:
        print(f"Failed to create notification: {e}")

    await db.commit()
    await db.refresh(req)
    await db.refresh(ticket_row)
    await db.refresh(trip)
    return req, ticket_row, trip


async def assert_can_download_ticket(
    viewer_user_id: int, viewer_role: Role, ticket: TravelRequestTicket, db: AsyncSession
) -> None:
    ok = await viewer_can_download_ticket(
        viewer_user_id=viewer_user_id, viewer_role=viewer_role, ticket=ticket, db=db
    )
    if not ok:
        raise HTTPException(status_code=403, detail="Not allowed to download this ticket")


def read_ticket_bytes(ticket: TravelRequestTicket) -> tuple[bytes, str]:
    path = Path(ticket.storage_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Ticket file missing on server")
    return path.read_bytes(), ticket.content_type


async def list_trips_for_merged_employee_scope(user_id: int, db: AsyncSession) -> list[TravelTrip]:
    """Merged 'my trips': own employee_user_id trips OR desk-booked assigned to user's employee id."""
    user = await db.get(User, user_id)
    pred = TravelTrip.employee_user_id == user_id
    if user and user.employee_id:
        pred = or_(
            pred,
            and_(
                TravelTrip.booked_by_travel_desk.is_(True),
                TravelTrip.assigned_to_employee_id == user.employee_id,
            ),
        )
    stmt = (
        select(TravelTrip).where(pred).order_by(TravelTrip.travel_date.desc(), TravelTrip.created_at.desc())
    )
    rows = list((await db.execute(stmt)).scalars().all())

    return rows


async def desk_ticket_ids_for_trips(rows: Sequence[TravelTrip], db: AsyncSession) -> dict[int, int | None]:
    """trip_id -> travel_request_ticket id for preview URLs."""
    if not rows:
        return {}
    req_ids = {t.travel_request_id for t in rows if t.travel_request_id}
    out_map: dict[int, int | None] = dict.fromkeys([t.id for t in rows], None)
    if not req_ids:
        return out_map

    tic_rows = (
        await db.execute(
            select(TravelRequestTicket).where(
                TravelRequestTicket.travel_request_id.in_(req_ids)
            )
        )
    ).scalars().all()
    # A request can now have several trips (one per ticketed leg — round trip onward/return,
    # or multiple multi-city legs), each with its own ticket, so match by travel_trip_id first.
    # Only fall back to "latest ticket for the request" when a trip has no direct ticket link
    # (legacy rows from before per-trip linkage, or trips booked outside the desk-upload flow).
    by_trip_id: dict[int, TravelRequestTicket] = {}
    by_rid: dict[int, TravelRequestTicket] = {}
    for tr in tic_rows:
        if tr.travel_trip_id is not None:
            by_trip_id[tr.travel_trip_id] = tr
        prev = by_rid.get(tr.travel_request_id)
        if prev is None or tr.uploaded_at > prev.uploaded_at:
            by_rid[tr.travel_request_id] = tr

    for t in rows:
        cand = by_trip_id.get(t.id)
        if cand is None and t.travel_request_id and t.travel_request_id in by_rid:
            cand = by_rid[t.travel_request_id]
        out_map[t.id] = cand.id if cand else None
    return out_map


async def list_team_travel_calendar(manager_user_id: int, db: AsyncSession) -> list[dict]:
    """List upcoming confirmed trips for subordinates of the given manager."""
    mgr = await db.get(User, manager_user_id)
    if not mgr or not mgr.employee_id:
        return []
        
    sub_stmt = select(Employee).where(Employee.reporting_manager_id == mgr.employee_id)
    subs = (await db.execute(sub_stmt)).scalars().all()
    if not subs:
        return []
    
    sub_emp_ids = [s.employee_id for s in subs]
    sub_names_map = {s.employee_id: s.full_name for s in subs}
    
    user_stmt = select(User.id, User.employee_id).where(User.employee_id.in_(sub_emp_ids))
    sub_user_map = {row[0]: row[1] for row in (await db.execute(user_stmt)).all()}
    
    if not sub_user_map:
        return []
        
    # Get trips for these users
    trip_stmt = (
        select(TravelTrip)
        .where(
            and_(
                or_(
                    TravelTrip.employee_user_id.in_(sub_user_map.keys()),
                    TravelTrip.assigned_to_employee_id.in_(sub_emp_ids)
                ),
                TravelTrip.status == TripStatus.CONFIRMED,
                TravelTrip.travel_date >= _utc_today()
            )
        )
        .order_by(asc(TravelTrip.travel_date))
        .limit(100)
    )
    trips = (await db.execute(trip_stmt)).scalars().all()
    
    out = []
    for t in trips:
        emp_id = t.assigned_to_employee_id or sub_user_map.get(t.employee_user_id)
        out.append({
            "id": t.id,
            "employee_name": sub_names_map.get(emp_id, "Unknown"),
            "travel_date": t.travel_date.isoformat() if t.travel_date else None,
            "mode": t.mode.value,
            "route": f"{t.from_city} -> {t.to_city}",
            "reference": t.reference_id,
        })
    return out
