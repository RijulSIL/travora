"""Travel requests the employee books themselves (booked_by = SELF).

They book first and raise the request without tickets. It follows the Approval Matrix's
"Self-booked travel" route (HRBP, then CEO by default). Once it's fully approved the employee is
told to upload their tickets: one for every leg of the journey (there and back on a round trip,
or each multi-city leg). Each ticket is read with Gemini as it's attached, so its booking
reference, airline/railway/operator and fare fill in; the employee checks every field and then
submits them all together. That books the trip: each ticket becomes a booked trip (claimable
after travel, on the normal travel claim) and HRBPs are told the tickets are in. Nothing goes to
the travel agent, and the Travel Desk doesn't upload or replace these tickets (it can still add
additional documents).

Requests raised before 23/11/2026 attached their tickets with the request; those are still booked
straight away on approval.

A ticket is saved before it's submitted (kept per user under its content hash, in a "pending"
folder) and the submission then refers to it by `ref`, the same way as the traveller's ID.
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


def _save_pending(user_id: int, filename: str | None, content_type: str | None, content: bytes) -> dict:
    from app.services.travel_request_service import _validate_ticket_file

    digest, suffix = _validate_ticket_file(
        filename or "ticket.pdf", content_type or "application/octet-stream", content
    )
    folder = _pending_folder(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    ref = f"{digest}{suffix}"
    (folder / ref).write_bytes(content)
    return {"ref": ref, "filename": (filename or f"ticket{suffix}")[:255], "content_type": _CONTENT_TYPES[suffix]}


async def store_pending_ticket(user_id: int, file: UploadFile) -> dict:
    """Saves a ticket the employee is about to submit, without reading it."""
    return _save_pending(user_id, file.filename, file.content_type, await file.read())


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
    """Puts the checked tickets on the request, one per leg. book_self_booked_trip then makes
    each one a booked trip."""
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
            # A claim refuses a flight trip without a boarding pass; the ticket is it (as on the
            # Travel Desk's upload).
            boarding_pass_path=str(ticket.storage_path).replace("\\", "/") if mode == TravelMode.FLIGHT else None,
        )
        db.add(trip)
        await db.flush()
        ticket.travel_trip_id = trip.id
        made += 1
    fresh.status = TravelRequestStatus.BOOKED.value
    req.status = TravelRequestStatus.BOOKED.value
    await db.flush()
    return made


async def has_tickets(request_id: int, db: AsyncSession) -> bool:
    """Whether the request already has its tickets (a request raised before 23/11/2026 attached
    them when it was raised)."""
    from sqlalchemy import func, select

    from app.models.travel_request import TravelRequestTicket

    count = await db.scalar(
        select(func.count(TravelRequestTicket.id)).where(TravelRequestTicket.travel_request_id == request_id)
    )
    return bool(count)


async def _request_awaiting_tickets(request_id: int, user_id: int, db: AsyncSession):
    """The employee's own self-booked request, approved and waiting on their tickets."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.travel_request import TravelRequest, TravelRequestStatus

    req = (
        await db.execute(
            select(TravelRequest)
            .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
            .where(TravelRequest.id == request_id)
        )
    ).scalar_one_or_none()
    if req is None or req.employee_user_id != user_id:
        raise HTTPException(status_code=404, detail="Travel request not found")
    if req.booked_by != BOOKED_BY_SELF:
        raise HTTPException(status_code=409, detail="The travel desk books this trip, so it uploads the tickets")
    if req.tickets or req.status == TravelRequestStatus.BOOKED.value:
        raise HTTPException(status_code=409, detail="This trip's tickets are already uploaded")
    if req.status in (TravelRequestStatus.PENDING.value, TravelRequestStatus.PENDING_EXCEPTION.value):
        raise HTTPException(status_code=409, detail="You can upload your tickets once the request is fully approved")
    if req.status != TravelRequestStatus.APPROVED.value:
        raise HTTPException(status_code=409, detail="This request isn't waiting for tickets")
    return req


_UNREADABLE = "Couldn't read this ticket. Type the details in."


async def _read_ticket(content: bytes, content_type: str, segment: dict) -> tuple[dict | None, str | None]:
    """What Gemini reads on the ticket (booking reference, who it's with, fare, and a warning if
    it looks like another leg's ticket), or None and why not. Never raises: the employee can
    always type the details in."""
    import asyncio

    from app.services.ticket_reader import read_ticket_sync
    from app.services.travel_request_service import ticket_leg_mismatch

    if not settings.gemini_api_key:
        return None, "Ticket reading isn't set up. Type the details in."
    try:
        read = await asyncio.to_thread(
            read_ticket_sync,
            content,
            content_type,
            api_key=settings.gemini_api_key,
            models=[settings.gemini_invoice_model_primary, settings.gemini_invoice_model_fallback],
        )
    except RuntimeError:
        return None, _UNREADABLE
    mismatch = ticket_leg_mismatch(read, segment)
    if not (read.get("pnr") or read.get("provider") or read.get("amount") or mismatch):
        return None, _UNREADABLE
    found = {key: read.get(key) or "" for key in ("pnr", "provider", "amount")}
    return {**found, "mismatch": mismatch}, None


async def upload_and_read_ticket(
    *, request_id: int, user_id: int, leg_sequence: int, file: UploadFile, db: AsyncSession
) -> dict:
    """Saves one leg's ticket for the employee to submit with the others, and reads it so its
    details fill in for them to check. A ticket that can't be read is still saved."""
    from app.services.travel_request_service import _segments_for_request

    req = await _request_awaiting_tickets(request_id, user_id, db)
    segment = next((s for s in _segments_for_request(req) if s["seq"] == leg_sequence), None)
    if segment is None:
        raise HTTPException(status_code=422, detail="That leg isn't part of this request")
    content = await file.read()
    stored = _save_pending(user_id, file.filename, file.content_type, content)
    read, problem = await _read_ticket(content, stored["content_type"], segment)
    return {**stored, "leg_sequence": leg_sequence, "read": read, "read_error": problem}


async def submit_self_tickets(
    *, request_id: int, user_id: int, tickets: list, db: AsyncSession, claim_fares: bool = False
):
    """The employee's checked tickets, one for every leg: they go on the request, the trip is
    booked (each ticket becomes a booked trip), and HRBPs are told the tickets are in. With
    `claim_fares` the fares are then claimed straight away (claim_ticket_fares) — after the
    booking is saved, so a claim that can't be made never undoes it.
    Returns (request, what happened to the claim or None)."""
    import logging

    from app.core.timezone import now_ist
    from app.services.travel_request_service import (
        _notify_stakeholders_once_booked,
        _reload_travel_request_with_legs,
    )

    req = await _request_awaiting_tickets(request_id, user_id, db)
    cleaned = clean_self_tickets(
        user_id, req.trip_type, list(req.legs or []), tickets,
        from_city=req.from_city, to_city=req.to_city, travel_date=req.travel_date, return_date=req.return_date,
    )
    await attach_self_tickets(req, user_id, cleaned, db)
    await book_self_booked_trip(req, db, now_ist())
    await _tell_hrbps_tickets_uploaded(req, db)
    await db.commit()
    await _notify_stakeholders_once_booked(req, db)
    claim = None
    if claim_fares:
        try:
            claim = await claim_ticket_fares(req.id, user_id, db)
        except Exception:  # noqa: BLE001 — the trip is booked either way; say the claim wasn't made
            logging.getLogger(__name__).exception("Claiming the fares of travel request %s failed", req.id)
            await db.rollback()
            claim = {"status": "not_created", "claim_id": None, "claim_reference": None,
                     "message": "The claim couldn't be created. Raise it from New claim → Travel Claim."}
    return await _reload_travel_request_with_legs(req.id, db), claim


_FARE_CATEGORIES = {"FLIGHT": "Air Travel", "TRAIN": "Train Travel", "BUS": "Bus Travel"}


def _claim_outcome(status: str, message: str, claim=None, claim_id=None) -> dict:
    return {
        "status": status,
        "claim_id": claim.id if claim is not None else claim_id,
        "claim_reference": getattr(claim, "claim_reference", None),
        "message": message,
    }


async def claim_ticket_fares(request_id: int, user_id: int, db: AsyncSession) -> dict:
    """The fares of a just-booked self-booked trip, claimed straight away (the employee ticked
    "claim the fares"): each ticket becomes a reviewed Travel invoice at the fare they confirmed,
    and a travel claim with those invoices and the trip's legs is created and submitted like any
    other, so it follows the normal claim route (and its policy checks). A claim that can't be
    submitted as it is (it needs an exception reason, say) is kept as a draft and the employee
    is told why. Returns {status: submitted | draft | not_created, claim_id, claim_reference,
    message}."""
    import hashlib

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.core.timezone import now_ist
    from app.models.auth import User
    from app.models.employee import Employee
    from app.models.reimbursement import (
        Invoice,
        InvoiceField,
        InvoiceLineItem,
        InvoiceStatus,
        ReimbursementCategory,
    )
    from app.models.travel_request import TravelRequest
    from app.schemas.reimbursement import ClaimDraftIn
    from app.services import reimbursement_service as rs
    from app.services.notification_service import create_notification
    from app.services.travel_request_service import _segments_for_request, _ticket_for_leg, _trip_route_and_dates

    req = (
        await db.execute(
            select(TravelRequest)
            .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
            .where(TravelRequest.id == request_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    legs = [(seg, _ticket_for_leg(req, seg["seq"])) for seg in _segments_for_request(req)]
    if any(t is None or t.travel_trip_id is None for _, t in legs):
        return _claim_outcome("not_created", "The trip isn't fully booked yet, so no claim was created.")

    # A ticket already uploaded as an invoice may already be on a claim: never claim it twice.
    files = []
    for seg, ticket in legs:
        content = Path(ticket.storage_path).read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        already = select(Invoice.id).where(Invoice.uploader_user_id == user_id, Invoice.file_sha256 == digest)
        if await db.scalar(already):
            return _claim_outcome(
                "not_created",
                f"The ticket for {seg['label']} is already in your invoices, so no claim was created. Add your "
                "tickets to a travel claim from Upload Invoice.",
            )
        files.append((seg, ticket, content, digest))

    now = now_ist()
    folder = Path(settings.invoice_storage_dir) / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    invoice_ids = []
    total = Decimal("0.00")
    for seg, ticket, content, digest in files:
        path = folder / f"{digest}{Path(ticket.storage_path).suffix.lower()}"
        path.write_bytes(content)
        invoice = Invoice(
            uploader_user_id=user_id,
            file_sha256=digest,
            original_filename=ticket.original_filename[:255],
            content_type=ticket.content_type,
            file_size_bytes=len(content),
            storage_path=str(path),
            status=InvoiceStatus.REVIEWED,  # the employee checked every value before submitting
            reimbursement_category=ReimbursementCategory.TRAVEL,
        )
        db.add(invoice)
        await db.flush()
        fare = Decimal(str(ticket.ticket_amount or 0)).quantize(Decimal("0.01"))
        total += fare
        mode = (seg["mode"] or req.travel_mode or "FLIGHT").upper()
        category_name = _FARE_CATEGORIES.get(mode, "Air Travel")
        category = await rs._find_category(category_name, db, travel_date=seg["travel_date"])
        values = {
            "vendor_name": ticket.external_booking_source or "",
            "invoice_number": ticket.pnr_or_booking_ref or "",
            "invoice_date": (seg["travel_date"] or now.date()).isoformat(),
            "currency": "INR",
            "grand_total": str(fare),
            "total_taxable_value": str(fare),
            "cgst": "0.00",
            "sgst": "0.00",
            "igst": "0.00",
            "other_tax": "0.00",
            "payment_mode": "Online",
            "is_tatkal": "false",
            "expense_category": category_name,
        }
        for key, value in values.items():
            db.add(InvoiceField(invoice_id=invoice.id, field_key=key, original_value=value, final_value=value,
                                confidence=Decimal("100.00"), confirmed_at=now, confirmed_by=user_id))
        db.add(InvoiceLineItem(
            invoice_id=invoice.id,
            description=f"{category_name} ticket {seg['from_city']} → {seg['to_city']}"
            + (f" · PNR {ticket.pnr_or_booking_ref}" if ticket.pnr_or_booking_ref else ""),
            quantity=Decimal("1.00"), unit="EA", unit_price=fare, taxable_value=fare, tax_rate=Decimal("0.00"),
            cgst=Decimal("0.00"), sgst=Decimal("0.00"), igst=Decimal("0.00"), total_amount=fare,
            category_id=category.id if category else None,
            category_name=category.name if category else category_name,
            is_blacklisted=False,
        ))
        invoice_ids.append(invoice.id)
    await db.commit()  # the bills stay in Upload Invoice whatever happens to the claim

    user = await db.get(User, user_id)
    emp = await db.get(Employee, user.employee_id) if user and user.employee_id else None
    from_city, to_city, start, end = _trip_route_and_dates(req)
    payload = ClaimDraftIn(
        reimbursement_category=ReimbursementCategory.TRAVEL,
        invoice_ids=invoice_ids,
        trip_ids=[ticket.travel_trip_id for _, ticket, _, _ in files],
        trip_purpose=req.purpose,
        travel_type=req.travel_type or "NON_PROJECT",
        project_code=req.project_code,
        departure_date=start,
        return_date=end or start,
        office_location=(emp.office_location if emp else None) or from_city,
        from_city=from_city,
        destination_city=to_city,
    )
    try:
        claim, _expenses, _invoices, _trips = await rs.create_or_update_claim_draft(payload, user_id, db)
    except HTTPException as exc:
        await db.rollback()
        return _claim_outcome(
            "not_created",
            f"Your tickets are in Upload Invoice, ready to claim, but the claim couldn't be created: {exc.detail}",
        )
    claim_id = claim.id
    try:
        claim = await rs.submit_claim(claim_id, user_id, db)
    except HTTPException as exc:
        await db.rollback()
        detail = str(exc.detail)
        await create_notification(
            user_id=user_id,
            title="Claim saved as a draft",
            body=f"The claim for your ticket fares couldn't be submitted as it is: {detail} "
            "Open the draft to finish it.",
            link=f"/claims/travel/{claim_id}/edit",
            category="ACTION_REQUIRED",
            db=db,
        )
        await db.commit()
        return _claim_outcome("draft", detail, claim_id=claim_id)
    await rs.budget_check_after_submit(user_id, claim.id)
    inr = f"₹{total:,.2f}"
    return _claim_outcome("submitted", f"Claim {claim.claim_reference or ''} for {inr} sent for approval.", claim)


async def _tell_hrbps_tickets_uploaded(req, db: AsyncSession) -> None:
    from sqlalchemy import select

    from app.core.timezone import format_date
    from app.models.auth import Role, User
    from app.services.notification_service import create_notification
    from app.services.travel_request_service import _trip_route_and_dates

    owner = await db.get(User, req.employee_user_id)
    name = (owner.full_name if owner else "") or "An employee"
    from_city, to_city, start, _end = _trip_route_and_dates(req)
    trip = f"{from_city} → {to_city}" + (f" on {format_date(start)}" if start else "")
    hrbps = (
        await db.execute(select(User).where(User.role == Role.HRBP_HR, User.is_active.is_(True)))
    ).scalars().all()
    for hrbp in hrbps:
        await create_notification(
            user_id=hrbp.id,
            title="Tickets uploaded",
            body=f"{name} uploaded the tickets for their self-booked trip {trip}. "
            "The trip is booked; you can see the tickets on the Travel Desk.",
            link=f"/travel-desk?view=all&open={req.id}",
            category="CLAIM_UPDATE",
            db=db,
        )


# Reminders while an approved self-booked trip waits for its tickets: one a working day, from
# 10 am, until they're uploaded or the trip is archived (too late to claim). The approval
# notification and every reminder link to the upload, which is how "already told today" is found.
TICKET_REMINDER_FROM_HOUR = 10


def upload_link(request_id: int) -> str:
    return f"/travel-requests?upload={request_id}"


def ticket_reminder_text(from_city: str, to_city: str, start, today) -> str:
    from app.core.timezone import format_weekday_date

    trip = f"{from_city} → {to_city}"
    if start is None or start > today:
        when = f" on {format_weekday_date(start)}" if start else ""
        return (
            f"Your self-booked trip {trip}{when} is approved, but its tickets aren't uploaded yet. "
            "Upload them so the trip is booked."
        )
    return (
        f"Your self-booked trip {trip} ({format_weekday_date(start)}) is approved, but its tickets still "
        "aren't uploaded. Upload them so the trip is booked and you can claim it."
    )


async def remind_pending_ticket_uploads(db: AsyncSession, now: datetime | None = None) -> int:
    """Reminds each employee whose approved self-booked trip is still waiting for their tickets:
    once a working day, from 10 am. Stops once the trip is archived. Returns how many were sent."""
    from sqlalchemy import func, select
    from sqlalchemy.orm import selectinload

    from app.core.timezone import now_ist
    from app.models.claim_workflow import Notification
    from app.models.travel_request import TravelRequest, TravelRequestStatus
    from app.services.claim_submission_rules import claim_windows
    from app.services.notification_service import create_notification
    from app.services.travel_request_service import _trip_route_and_dates
    from app.services.workflow_service import get_workflow_config
    from app.services.working_time import is_working_day, load_holidays

    now = now or now_ist()
    if now.hour < TICKET_REMINDER_FROM_HOUR or not is_working_day(now.date(), await load_holidays(db)):
        return 0
    waiting = (
        await db.execute(
            select(TravelRequest)
            .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
            .where(
                TravelRequest.booked_by == BOOKED_BY_SELF,
                TravelRequest.status == TravelRequestStatus.APPROVED.value,
            )
        )
    ).scalars().all()
    if not waiting:
        return 0
    _late, archive_after = claim_windows(await get_workflow_config(db))
    sent = 0
    for req in waiting:
        if req.tickets:
            continue
        from_city, to_city, start, end = _trip_route_and_dates(req)
        if end is not None and (now.date() - end).days > archive_after:
            continue  # archived: it can't be claimed any more
        link = upload_link(req.id)
        last = await db.scalar(
            select(func.max(Notification.created_at)).where(
                Notification.user_id == req.employee_user_id, Notification.link == link
            )
        )
        if last is not None and last.date() >= now.date():
            continue  # approved, or already reminded, today
        await create_notification(
            user_id=req.employee_user_id,
            title="Reminder: upload your tickets",
            body=ticket_reminder_text(from_city, to_city, start, now.date()),
            link=link,
            category="ACTION_REQUIRED",
            db=db,
        )
        sent += 1
    await db.commit()
    return sent
