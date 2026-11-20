"""Travel requests the employee books themselves (booked_by = SELF).

They book first, then raise the request with a ticket for every leg of the journey (there and
back on a round trip, or each multi-city leg) — booking reference, airline/railway/operator and
fare with each.
The request follows the Approval Matrix's "Self-booked travel" route (HRBP, then CEO by default),
and approvers see the tickets before deciding. Once it's approved it's booked straight away: each
ticket becomes a booked trip (claimable after travel, on the normal travel claim). Nothing goes to
the travel agent.

A ticket is uploaded before the request exists (store_pending_ticket, kept per user under its
content hash) and the request then refers to it by `ref`, the same way as the traveller's ID.
"""

import re
import shutil
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

BOOKED_BY_COMPANY = "COMPANY"
BOOKED_BY_SELF = "SELF"
_REF = re.compile(r"^[0-9a-f]{64}\.(pdf|jpg|jpeg|png|heic)$")
_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".heic": "image/heic",
}


def _pending_folder(user_id: int) -> Path:
    return Path(settings.travel_ticket_storage_dir) / "pending" / str(user_id)


def pending_ticket_path(user_id: int, ref: str | None) -> Path | None:
    """Where a user's uploaded-but-not-yet-attached ticket is, or None if `ref` isn't one of theirs."""
    if not ref or not _REF.match(ref):
        return None
    path = _pending_folder(user_id) / ref
    return path if path.is_file() else None


async def store_pending_ticket(user_id: int, file: UploadFile) -> dict:
    """Saves a ticket the employee is attaching to a self-booked request they're about to raise."""
    from app.services.travel_request_service import _validate_ticket_file

    content = await file.read()
    digest, suffix = _validate_ticket_file(
        file.filename or "ticket.pdf", file.content_type or "application/octet-stream", content
    )
    folder = _pending_folder(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    ref = f"{digest}{suffix}"
    (folder / ref).write_bytes(content)
    return {"ref": ref, "filename": (file.filename or f"ticket{suffix}")[:255], "content_type": _CONTENT_TYPES[suffix]}


def expected_ticket_seqs(trip_type: str, legs: list | None) -> list[int]:
    """The legs that each need a ticket — the same as travel_request_service._segments_for_request:
    one for a one-way trip, onward + return for a round trip, one per leg for multi-city."""
    if trip_type == "MULTI_CITY" and legs:
        return list(range(1, len(legs) + 1))
    if trip_type == "ROUND_TRIP":
        return [1, 2]
    return [1]


def clean_booked_by(value: str | None) -> str:
    booked_by = (value or BOOKED_BY_COMPANY).strip().upper()
    if booked_by not in (BOOKED_BY_COMPANY, BOOKED_BY_SELF):
        raise HTTPException(status_code=422, detail="Choose who is booking the tickets: the company or you")
    return booked_by


def clean_self_tickets(
    user_id: int,
    trip_type: str,
    legs: list | None,
    tickets: list | None,
    *,
    from_city: str | None = None,
    to_city: str | None = None,
    travel_date=None,
    return_date=None,
) -> list[dict]:
    """Every leg's ticket, checked: the file, its booking reference, who it's with and its fare.
    Problems name the leg by its route and date ("Delhi → Goa · 04/12/2026")."""
    from app.services.travel_request_service import leg_label, parse_ticket_amount

    by_seq: dict[int, object] = {}
    for t in tickets or []:
        by_seq[int(_field(t, "seq"))] = t
    cleaned = []
    seqs = expected_ticket_seqs(trip_type, legs)
    if trip_type == "MULTI_CITY" and legs:
        names = [leg_label(_field(lg, "from_city"), _field(lg, "to_city"), _field(lg, "travel_date")) for lg in legs]
    elif trip_type == "ROUND_TRIP":
        names = [leg_label(from_city, to_city, travel_date), leg_label(to_city, from_city, return_date)]
    else:
        names = [leg_label(from_city, to_city, travel_date)]
    for seq in seqs:
        t = by_seq.get(seq)
        leg = names[seq - 1] if seq - 1 < len(names) else f"leg {seq}"
        if t is None or pending_ticket_path(user_id, _field(t, "ref")) is None:
            raise HTTPException(status_code=422, detail=f"Attach the ticket for {leg}")
        pnr = " ".join(str(_field(t, "pnr_or_booking_ref") or "").split())
        provider = " ".join(str(_field(t, "provider") or "").split())
        if not pnr or not provider:
            raise HTTPException(
                status_code=422,
                detail=f"Fill in the booking reference and the airline, railway or operator for {leg}",
            )
        try:
            amount = parse_ticket_amount(_field(t, "ticket_amount"))
        except HTTPException as exc:
            raise HTTPException(status_code=422, detail=f"Enter the fare for {leg} in rupees (more than ₹0)") from exc
        ref = str(_field(t, "ref"))
        cleaned.append(
            {
                "seq": seq,
                "ref": ref,
                "filename": (str(_field(t, "filename") or "").strip()[:255]) or f"ticket{Path(ref).suffix}",
                "pnr": pnr[:128],
                "provider": provider[:64],
                "amount": amount,
            }
        )
    return cleaned


def _field(item, name: str):
    return item.get(name) if isinstance(item, dict) else getattr(item, name, None)


async def attach_self_tickets(req, user_id: int, tickets: list[dict], db: AsyncSession) -> None:
    """Moves the checked tickets onto the new request, one per leg. They become booked trips only
    once the request is approved (book_self_booked_trip)."""
    from app.models.travel_request import TravelRequestTicket

    folder = Path(settings.travel_ticket_storage_dir) / str(req.id)
    folder.mkdir(parents=True, exist_ok=True)
    for t in tickets:
        source = pending_ticket_path(user_id, t["ref"])
        if source is None:  # checked a moment ago; only defensive
            raise HTTPException(status_code=422, detail="A ticket file went missing — attach it again")
        target = folder / t["ref"]
        shutil.copyfile(source, target)
        db.add(
            TravelRequestTicket(
                travel_request_id=req.id,
                travel_trip_id=None,
                leg_sequence=t["seq"],
                uploaded_by_user_id=user_id,
                file_sha256=t["ref"].split(".")[0],
                original_filename=t["filename"],
                storage_path=str(target),
                content_type=_CONTENT_TYPES[Path(t["ref"]).suffix],
                file_size_bytes=target.stat().st_size,
                pnr_or_booking_ref=t["pnr"],
                ticket_amount=t["amount"],
                external_booking_source=t["provider"],
            )
        )
    await db.flush()


async def book_self_booked_trip(req, db: AsyncSession, now: datetime) -> int:
    """The approved self-booked request is booked: each leg's ticket becomes a booked trip (so it
    can be claimed after travel) and the request is BOOKED. Returns how many trips were made."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.auth import User
    from app.models.travel_booking import TravelMode, TravelTrip, TripStatus
    from app.models.travel_request import TravelRequest, TravelRequestStatus
    from app.services.travel_request_service import _segments_for_request, _ticket_for_leg

    fresh = (
        await db.execute(
            select(TravelRequest)
            .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
            .where(TravelRequest.id == req.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    owner = await db.get(User, fresh.employee_user_id)
    made = 0
    for segment in _segments_for_request(fresh):
        ticket = _ticket_for_leg(fresh, segment["seq"])
        if ticket is None or ticket.travel_trip_id is not None:
            continue
        try:
            mode = TravelMode[(segment["mode"] or fresh.travel_mode or "FLIGHT").upper()]
        except KeyError:
            mode = TravelMode.FLIGHT
        trip = TravelTrip(
            employee_user_id=fresh.employee_user_id,
            travel_request_id=fresh.id,
            booked_by_travel_desk=False,
            assigned_to_employee_id=owner.employee_id if owner else None,
            mode=mode,
            from_city=segment["from_city"] or "",
            to_city=segment["to_city"] or "",
            travel_date=segment["travel_date"] or now.date(),
            provider=(ticket.external_booking_source or "Booked by the employee")[:64],
            reference_id=(ticket.pnr_or_booking_ref or f"SELF-{fresh.id}-{segment['seq']}-{uuid4().hex[:6].upper()}")[:64],
            amount=ticket.ticket_amount or Decimal("0.00"),
            gst_invoice_requested=False,
            booking_metadata={"travel_request_id": fresh.id, "leg_sequence": segment["seq"], "source": "self_booked"},
            status=TripStatus.CONFIRMED,
        )
        db.add(trip)
        await db.flush()
        ticket.travel_trip_id = trip.id
        made += 1
    fresh.status = TravelRequestStatus.BOOKED.value
    req.status = TravelRequestStatus.BOOKED.value
    await db.flush()
    return made
