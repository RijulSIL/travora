"""Public, unauthenticated travel-agent booking link: GET/POST /public/travel-booking/{token}.

The emailed link itself is the only credential — there's no login, no account for the travel
agent. NO route in this router depends on get_current_claims or any permission check. Every route
takes the token as its only identifying input and resolves the travel request SOLELY through
svc.resolve_agent_booking_request / the functions built on it — never through a request id,
employee id, or anything else a client could supply. An unknown token, one superseded by a resend,
or a request that's no longer bookable all answer with the same generic 404 (see that function's
docstring), so this surface never reveals anything about a real token or request to someone
without it.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.travel_request import PublicAgentBookingOut
from app.services import travel_request_service as svc

router = APIRouter(prefix="/public/travel-booking", tags=["public-travel-booking"])


@router.get("/{token}", response_model=PublicAgentBookingOut)
async def agent_booking_detail(token: str, db: AsyncSession = Depends(get_db)) -> PublicAgentBookingOut:
    return PublicAgentBookingOut(**await svc.agent_booking_summary(token, db))


@router.post("/{token}/read-ticket")
async def agent_read_ticket(
    token: str,
    file: Annotated[UploadFile, File(...)],
    leg_sequence: Annotated[int, Form()] = 1,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Same ticket-reading auto-fill the Travel Desk's own upload form uses. Nothing is stored."""
    return await svc.read_ticket_via_agent(token=token, leg_sequence=leg_sequence, file=file, db=db)


@router.post("/{token}/upload-ticket")
async def agent_upload_ticket(
    token: str,
    file: Annotated[UploadFile, File(...)],
    leg_sequence: Annotated[int, Form()] = 1,
    pnr_or_booking_ref: Annotated[str | None, Form()] = None,
    provider: Annotated[str | None, Form()] = None,
    notes_for_employee: Annotated[str | None, Form()] = None,
    # Required (checked in the service, same message as the authenticated upload when missing).
    ticket_amount: Annotated[str | None, Form()] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    payload = {
        "pnr_or_booking_ref": pnr_or_booking_ref,
        "provider": provider,
        "notes_for_employee": notes_for_employee,
        "ticket_amount": ticket_amount,
    }
    req, ticket, _trip = await svc.upload_ticket_via_agent(
        token=token, file=file, payload=payload, leg_sequence=leg_sequence, db=db
    )
    return {
        "ok": True,
        "status": req.status,
        "ticket": {"id": ticket.id, "leg_sequence": ticket.leg_sequence},
    }
