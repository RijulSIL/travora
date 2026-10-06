"""Authenticated travel-request + Travel Desk endpoints (Phase 1)."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import (
    get_current_claims,
    require_any_permission,
    require_permission,
    require_role,
)
from app.models.auth import Role
from app.schemas.travel_request import (
    DeskQueueItemOut,
    EntitlementNoteOut,
    TravelExceptionSummaryOut,
    TravelRejectIn,
    TravelRequestCreate,
    TravelRequestExceptionCreate,
    TravelRequestListItemOut,
    TravelRequestOut,
    TravelRequestSegmentOut,
    TravelRequestTicketAttachmentOut,
)
from app.services import travel_request_service as svc

router = APIRouter(prefix="/travel-requests", tags=["travel-requests"])




def _role(claims: dict) -> Role:
    try:
        return Role(claims.get("role"))
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Forbidden") from exc


def _build_request_out(req) -> TravelRequestOut:
    """TravelRequestOut plus per-segment ticket status (one entry per independently-ticketable
    leg — see `svc.build_segments_out`)."""
    tout = TravelRequestOut.model_validate(req)
    tout.segments = [
        TravelRequestSegmentOut(
            seq=s["seq"],
            label=s["label"],
            mode=s["mode"],
            from_city=s["from_city"],
            to_city=s["to_city"],
            travel_date=s["travel_date"],
            ticket=TravelRequestTicketAttachmentOut.model_validate(s["ticket"]) if s["ticket"] else None,
        )
        for s in svc.build_segments_out(req)
    ]
    return tout


@router.post(
    "",
    response_model=TravelRequestOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def create_request(
    body: TravelRequestCreate,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> TravelRequestOut:
    row = await svc.create_travel_request(
        user_id=int(claims["sub"]),
        trip_type=body.trip_type,
        travel_mode=body.travel_mode,
        from_city=body.from_city,
        to_city=body.to_city,
        travel_date=body.travel_date,
        return_date=body.return_date,
        purpose=body.purpose,
        preferred_class=body.preferred_class,
        notes=body.notes,
        legs=body.legs,
        db=db,
    )
    return _build_request_out(row)


@router.post(
    "/request-with-exception",
    response_model=TravelRequestOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def create_request_with_exception(
    body: TravelRequestExceptionCreate,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> TravelRequestOut:
    row = await svc.create_travel_request_with_exception(
        user_id=int(claims["sub"]),
        trip_type=body.trip_type,
        travel_mode=body.travel_mode,
        from_city=body.from_city,
        to_city=body.to_city,
        travel_date=body.travel_date,
        return_date=body.return_date,
        purpose=body.purpose,
        preferred_class=body.preferred_class,
        notes=body.notes,
        legs=body.legs,
        justification=body.justification,
        db=db,
    )
    return _build_request_out(row)


@router.get(
    "/my",
    response_model=list[TravelRequestListItemOut],
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def my_requests(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> list[TravelRequestListItemOut]:
    rows = await svc.list_travel_requests_for_employee(int(claims["sub"]), db)
    exceptions_by_request = await svc.get_latest_exceptions_for_requests([req.id for req, _ in rows], db)
    out: list[TravelRequestListItemOut] = []
    for req, tix in rows:
        tout = _build_request_out(req)
        exc_data = exceptions_by_request.get(req.id)
        if exc_data:
            tout.exception = TravelExceptionSummaryOut(**exc_data)
        t_out = TravelRequestTicketAttachmentOut.model_validate(tix) if tix else None
        out.append(TravelRequestListItemOut(request=tout, ticket=t_out))
    return out


@router.get(
    "/manager/pending",
    response_model=list[DeskQueueItemOut],
    # The normal-flow approval chain is admin-configurable and can route a stage to any of
    # these roles, not just Reporting Manager (see list_pending_travel_requests_for_approver) —
    # matches the same broadened gate used on /approve and /reject.
    dependencies=[
        Depends(
            require_role(
                Role.REPORTING_MANAGER,
                Role.HRBP_HR,
                Role.PAYROLL,
                Role.FINANCE,
                Role.CEO,
                Role.GROUP_HEAD_HR,
            )
        )
    ],
)
async def manager_pending_requests(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> list[DeskQueueItemOut]:
    enriched = await svc.list_pending_travel_requests_for_approver(int(claims["sub"]), db)
    exceptions_by_request = await svc.get_latest_exceptions_for_requests(
        [e["request"].id for e in enriched], db
    )
    out: list[DeskQueueItemOut] = []
    for e in enriched:
        tout = _build_request_out(e["request"])
        exc_data = exceptions_by_request.get(e["request"].id)
        if exc_data:
            tout.exception = TravelExceptionSummaryOut(**exc_data)
        out.append(
            DeskQueueItemOut(
                request=tout,
                employee_display_name=e["employee_display_name"],
                impact_level_code=e["impact_level_code"],
            )
        )
    return out


@router.get(
    "/manager/team-calendar",
    response_model=list[dict],
    dependencies=[Depends(require_role(Role.REPORTING_MANAGER))],
)
async def manager_team_calendar(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    return await svc.list_team_travel_calendar(int(claims["sub"]), db)


@router.get(
    "/desk",
    response_model=list[DeskQueueItemOut],
    dependencies=[Depends(require_role(Role.HRBP_HR))],
)
async def desk_queue(
    db: AsyncSession = Depends(get_db),
) -> list[DeskQueueItemOut]:
    enriched = await svc.list_pending_travel_requests_for_desk(db)
    return [
        DeskQueueItemOut(
            request=_build_request_out(e["request"]),
            employee_display_name=e["employee_display_name"],
            impact_level_code=e["impact_level_code"],
        )
        for e in enriched
    ]


@router.get(
    "/desk/all",
    response_model=list[DeskQueueItemOut],
    dependencies=[Depends(require_role(Role.HRBP_HR))],
)
async def desk_all_requests(
    status: str | None = Query(None, description="Filter by travel_requests.status"),
    q: str | None = Query(None, description="Search cities, name, or email"),
    date_from: date | None = Query(None, description="Earliest travel date (inclusive)"),
    date_to: date | None = Query(None, description="Latest travel date (inclusive)"),
    impact_level: str | None = Query(None, description="Filter by impact level code, e.g. L3A"),
    db: AsyncSession = Depends(get_db),
) -> list[DeskQueueItemOut]:
    rows = await svc.list_all_travel_requests_for_desk(
        db=db,
        status_filter=status,
        q=q,
        date_from=date_from,
        date_to=date_to,
        impact_level=impact_level,
    )
    return [
        DeskQueueItemOut(
            request=_build_request_out(row["request"]),
            employee_display_name=row["employee_display_name"],
            impact_level_code=row["impact_level_code"],
        )
        for row in rows
    ]


@router.get(
    "/entitlement-note",
    response_model=EntitlementNoteOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def entitlement_note(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> EntitlementNoteOut:
    data = await svc.entitlement_note_for_user(int(claims["sub"]), db)
    return EntitlementNoteOut(impact_level=data["impact_level"], text=data["text"])


@router.get(
    "/city-suggestions",
    response_model=list[str],
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def city_suggestions(
    q: str = Query("", min_length=0, max_length=128),
    limit: int = Query(30, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    return await svc.city_suggestions(q, limit, db)


@router.get(
    "/tickets/{ticket_id}/file",
    dependencies=[
        Depends(require_any_permission("submit_claim", "view_reports", "process_payments"))
    ],
)
async def download_ticket_file(
    ticket_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> Response:
    from app.models.travel_request import TravelRequestTicket

    ticket = await db.get(TravelRequestTicket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await svc.assert_can_download_ticket(int(claims["sub"]), _role(claims), ticket, db)
    content, ctype = svc.read_ticket_bytes(ticket)
    return Response(
        content=content,
        media_type=ctype,
        headers={"Content-Disposition": f'inline; filename="{ticket.original_filename}"'},
    )


@router.get(
    "/{request_id}",
    response_model=TravelRequestListItemOut,
)
async def get_request(
    request_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> TravelRequestListItemOut:
    role = _role(claims)
    req, tix = await svc.get_travel_request_for_viewer(request_id, int(claims["sub"]), role, db)
    return TravelRequestListItemOut(
        request=_build_request_out(req),
        ticket=TravelRequestTicketAttachmentOut.model_validate(tix) if tix else None,
    )


@router.delete(
    "/{request_id}",
    response_model=TravelRequestOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def cancel_request(
    request_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> TravelRequestOut:
    row = await svc.cancel_travel_request(request_id, int(claims["sub"]), db)
    return _build_request_out(row)


@router.get("/{request_id}/approval-chain")
async def approval_chain(
    request_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from app.services.workflow_service import get_travel_request_approval_chain

    req, _tix = await svc.get_travel_request_for_viewer(request_id, int(claims["sub"]), _role(claims), db)
    return await get_travel_request_approval_chain(req, db)


@router.post(
    "/{request_id}/approve",
    response_model=TravelRequestOut,
    # The normal-flow approval chain is admin-configurable (see workflow_service
    # TRAVEL_REQUEST_DEFAULT_STAGES / category_overrides.TRAVEL_REQUEST) and can route a stage
    # to any of these roles, not just Reporting Manager — the exact role actually required for
    # whichever stage is currently active is enforced inside approve_travel_request_stage.
    dependencies=[
        Depends(
            require_role(
                Role.REPORTING_MANAGER,
                Role.HRBP_HR,
                Role.PAYROLL,
                Role.FINANCE,
                Role.CEO,
                Role.GROUP_HEAD_HR,
            )
        )
    ],
)
async def approve_request(
    request_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> TravelRequestOut:
    role = _role(claims)
    row = await svc.approve_travel_request(request_id, int(claims["sub"]), role, db)
    return _build_request_out(row)


@router.post(
    "/{request_id}/reject",
    response_model=TravelRequestOut,
    dependencies=[
        Depends(
            require_role(
                Role.REPORTING_MANAGER,
                Role.HRBP_HR,
                Role.PAYROLL,
                Role.FINANCE,
                Role.CEO,
                Role.GROUP_HEAD_HR,
            )
        )
    ],
)
async def reject_request(
    request_id: int,
    body: TravelRejectIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> TravelRequestOut:
    role = _role(claims)
    row = await svc.reject_travel_request(request_id, int(claims["sub"]), role, body.reason, db)
    return _build_request_out(row)


@router.post(
    "/{request_id}/upload-ticket",
    dependencies=[Depends(require_role(Role.HRBP_HR))],
)
async def upload_ticket(
    request_id: int,
    file: Annotated[UploadFile, File(...)],
    leg_sequence: Annotated[int, Form()] = 1,
    pnr_or_booking_ref: Annotated[str | None, Form()] = None,
    ticket_amount: Annotated[str | None, Form()] = None,
    ticket_travel_class: Annotated[str | None, Form()] = None,
    provider: Annotated[str | None, Form()] = None,
    reference_id: Annotated[str | None, Form()] = None,
    external_booking_source: Annotated[str | None, Form()] = None,
    notes_for_employee: Annotated[str | None, Form()] = None,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    payload = {
        "pnr_or_booking_ref": pnr_or_booking_ref,
        "ticket_amount": ticket_amount,
        "ticket_travel_class": ticket_travel_class,
        "provider": provider,
        "reference_id": reference_id,
        "external_booking_source": external_booking_source,
        "notes_for_employee": notes_for_employee,
    }
    req, ticket, trip = await svc.upload_ticket_for_request(
        request_id=request_id,
        uploader_user_id=int(claims["sub"]),
        file=file,
        payload=payload,
        leg_sequence=leg_sequence,
        db=db,
    )
    return {
        "request": _build_request_out(req).model_dump(),
        "ticket": TravelRequestTicketAttachmentOut.model_validate(ticket).model_dump(),
        "trip_id": trip.id,
    }
