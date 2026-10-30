"""Relocation approval requests — see app.models.relocation for the overall flow.

Approval runs through the configurable Relocation Approval workflow (Approval Matrix,
category_overrides.RELOCATION_REQUEST; default Recruiter -> CEO -> HRBP -> Payroll) with the same
stage mechanics and SLA rules as travel requests. Every stage is decided by whoever holds that
stage's role (pooled, e.g. any Recruiter), or relative to the employee for REPORTING_MANAGER.
An approval the employee already has (uploaded evidence) needs no approval in the app.
"""

import hashlib
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timezone import now_ist
from app.models.auth import Role, User
from app.models.claim_workflow import NotificationCategory
from app.models.reimbursement import ClaimDraft, ClaimStatus
from app.models.relocation import (
    RelocationApprovalStage,
    RelocationRequest,
    RelocationRequestStatus,
    RelocationSource,
)
from app.services import workflow_service as ws
from app.services.audit_service import log_event
from app.services.notification_service import create_notification
from app.services.working_time import sla_deadline

# The trip purpose every relocation claim carries — seeded by migration f4c1a7e2b905. Relocation
# claims have their own form (New Claim -> Relocation Claim); the purpose is kept out of the Travel
# Claim and Travel Request forms.
RELOCATION_TRIP_PURPOSE = "Relocation"
# Where a relocation claim is started — the link in relocation notifications.
RELOCATION_CLAIM_LINK = "/claims/relocation/new"

_EVIDENCE_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".heic"}
_EVIDENCE_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"}
_MAX_EVIDENCE_BYTES = 10 * 1024 * 1024
# Claims that count toward "total claimed" against a relocation's estimate — everything the
# employee has actually put forward, minus rejected ones.
_COUNTED_CLAIM_STATUSES = (
    ClaimStatus.PENDING_EXCEPTION,
    ClaimStatus.IN_APPROVAL,
    ClaimStatus.READY_FOR_PAYMENT,
    ClaimStatus.PAID,
)

UNDERTAKING_TEMPLATE = (
    "This undertaking is with reference to your request for reimbursement of relocation expenses incurred "
    "for shifting from {origin} to {destination}, amounting to ₹{amount}/-.\n\n"
    "The relocation reimbursement claim is subject to review and approval in accordance with Company policy. "
    "Upon approval, reimbursement will be processed against submission of the original bills and supporting "
    "documents after completion of the shifting process.\n\n"
    "Terms and Conditions:\n"
    "In the event you separate from the Company within a period of two (2) years from your date of joining, "
    "the relocation expenses reimbursed shall be recovered on a pro-rata basis for the unserved period and "
    "adjusted against your Full & Final settlement.\n\n"
    "By accepting this undertaking, you acknowledge that you have read, understood, and agreed to the above "
    "terms and conditions. Your acceptance will enable the claim to proceed to the approval stage.\n\n"
    "Please confirm your acceptance to proceed."
)


def format_inr(amount: Decimal) -> str:
    """Indian digit grouping (1,18,782.50); whole rupees drop the paise."""
    quantized = Decimal(amount).quantize(Decimal("0.01"))
    whole, frac = f"{quantized:.2f}".split(".")
    sign = "-" if whole.startswith("-") else ""
    whole = whole.lstrip("-")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups) + "," + tail
    return f"{sign}{whole}" + ("" if frac == "00" else f".{frac}")


def render_undertaking(origin: str, destination: str, amount: Decimal) -> str:
    return UNDERTAKING_TEMPLATE.format(origin=origin, destination=destination, amount=format_inr(amount))


def relocation_ref(row: RelocationRequest) -> str:
    return f"REL-{row.id:04d}"


def _clean(value: str | None, field: str, *, required: bool = True, max_len: int = 128) -> str | None:
    text = (value or "").strip()
    if required and not text:
        raise HTTPException(status_code=422, detail=f"{field} is required")
    if len(text) > max_len:
        raise HTTPException(status_code=422, detail=f"{field} is too long")
    return text or None


def _assert_different_cities(origin: str, destination: str) -> None:
    if origin.casefold() == destination.casefold():
        raise HTTPException(status_code=422, detail="Moving from and Moving to can't be the same city")


def _amount(value, field: str, *, required: bool) -> Decimal | None:
    if value in (None, ""):
        if required:
            raise HTTPException(status_code=422, detail=f"{field} is required")
        return None
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{field} must be an amount") from exc
    if amount <= 0:
        raise HTTPException(status_code=422, detail=f"{field} must be greater than zero")
    return amount


async def _relocation_details(payload: dict, db: AsyncSession, *, allow_past: bool) -> dict:
    """The relocation form's fields beyond cities and amount, checked and cleaned: travel type and
    project code (same admin-managed options as travel claims), travel date, family members and
    notes. A requested relocation's date can't be in the past; an approval the employee already
    has may be for a move that's already happened."""
    from app.models.travel_request import TravelOptionType, TravelRequestTravelType
    from app.services.travel_request_service import _require_active_option

    travel_type = str(payload.get("travel_type") or "").strip().upper()
    if travel_type not in {t.value for t in TravelRequestTravelType}:
        raise HTTPException(status_code=422, detail="Choose a travel type")
    project_code = None
    if travel_type == TravelRequestTravelType.PROJECT.value:
        code = _clean(payload.get("project_code"), "Project code")
        project_code = await _require_active_option(TravelOptionType.PROJECT_CODE, code, "Project code", db)

    travel_date = payload.get("travel_date")
    if isinstance(travel_date, str) and travel_date.strip():
        try:
            travel_date = date.fromisoformat(travel_date.strip())
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Travel date must be a date") from exc
    if not isinstance(travel_date, date):
        raise HTTPException(status_code=422, detail="Travel date is required")
    if not allow_past and travel_date < now_ist().date():
        raise HTTPException(status_code=422, detail="Travel date can't be in the past")

    family = payload.get("family_members")
    if family in (None, ""):
        raise HTTPException(status_code=422, detail="Number of family members is required")
    try:
        family = int(family)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Family members must be a number") from exc
    if family < 0 or family > 50:
        raise HTTPException(status_code=422, detail="Family members must be between 0 and 50")

    return {
        "travel_type": travel_type,
        "project_code": project_code,
        "travel_date": travel_date.isoformat(),
        "family_members": family,
        "notes": _clean(payload.get("notes"), "Notes", required=False, max_len=2000),
    }


def _details_out(details: dict | None) -> dict:
    """A request's details as the app reads them. Requests made before the relocation form had a
    travel date stored a "planned move date" instead, and had no travel type (Non-Project)."""
    out = dict(details or {})
    if not out.get("travel_date") and out.get("planned_move_date"):
        out["travel_date"] = out["planned_move_date"]
    out.setdefault("travel_type", "NON_PROJECT")
    out.setdefault("project_code", None)
    return out


async def _employee(user_id: int, db: AsyncSession) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def _stages(request_id: int, db: AsyncSession) -> list[RelocationApprovalStage]:
    return list(
        (
            await db.execute(
                select(RelocationApprovalStage)
                .where(RelocationApprovalStage.relocation_request_id == request_id)
                .order_by(RelocationApprovalStage.stage_number)
            )
        ).scalars().all()
    )


async def _notify_stage_approvers(row: RelocationRequest, stage_def: dict, owner: User, db: AsyncSession,
                                  note: str | None = None) -> None:
    recipients = await ws._user_ids_for_role(str(stage_def.get("route_role") or ""), owner.employee_id, db)
    body = (
        f"{owner.full_name or owner.email} has requested relocation approval "
        f"({row.origin_city} → {row.destination_city}). It's waiting on you at {stage_def.get('label')}."
    )
    if note:
        body += f" {note}"
    for user_id in dict.fromkeys(recipients):
        await create_notification(
            user_id=user_id,
            title=f"Relocation approval required: {relocation_ref(row)}",
            body=body,
            link="/claims/pending?tab=relocation",
            category=NotificationCategory.APPROVAL_REQUIRED.value,
            db=db,
        )


async def activate_stage(row: RelocationRequest, stages: list[RelocationApprovalStage], stage_defs: list[dict],
                         stage_number: int, db: AsyncSession, note: str | None = None) -> None:
    """Open `stage_number`: PENDING, SLA clock started (working hours), approvers notified."""
    now = now_ist()
    owner = await _employee(row.employee_user_id, db)
    deadline = await sla_deadline(db, ws._stage_hours(stage_defs, stage_number), now)
    row.current_approval_stage = stage_number
    for stage in stages:
        if stage.stage_number != stage_number:
            continue
        stage.status = "PENDING"
        stage.sla_deadline_at = deadline
        stage.last_notified_at = now
        stage.sla_breached_at = None
        stage_def = next((s for s in stage_defs if int(s["number"]) == stage_number), None) or {
            "route_role": stage.required_role, "label": stage.stage_label
        }
        await _notify_stage_approvers(row, stage_def, owner, db, note)


# ------------------------------------------------------------------ employee side


async def create_relocation_request(user_id: int, payload: dict, db: AsyncSession) -> RelocationRequest:
    """Employee without prior approval: submit the relocation request into the approval workflow."""
    await _employee(user_id, db)
    origin = _clean(payload.get("origin_city"), "Moving from")
    destination = _clean(payload.get("destination_city"), "Moving to")
    _assert_different_cities(origin, destination)
    amount = _amount(payload.get("estimated_amount"), "Amount to be approved", required=True)
    details = await _relocation_details(payload, db, allow_past=False)

    row = RelocationRequest(
        employee_user_id=user_id,
        source=RelocationSource.REQUESTED.value,
        status=RelocationRequestStatus.PENDING.value,
        origin_city=origin,
        destination_city=destination,
        estimated_amount=amount,
        details=details,
    )
    db.add(row)
    await db.flush()

    stage_defs = ws.relocation_request_stage_defs(await ws.get_workflow_config(db))
    stages = [
        RelocationApprovalStage(
            relocation_request_id=row.id,
            stage_number=int(s["number"]),
            stage_label=str(s["label"]),
            required_role=str(s["route_role"]),
            status=ws.STAGE_STATUS_NOT_STARTED,
        )
        for s in stage_defs
    ]
    db.add_all(stages)
    await db.flush()
    await activate_stage(row, stages, stage_defs, min(int(s["number"]) for s in stage_defs), db)

    await create_notification(
        user_id=user_id,
        title=f"Relocation request submitted: {relocation_ref(row)}",
        body="It's been sent for approval. We'll let you know as soon as it's approved so you can raise your claim.",
        link=RELOCATION_CLAIM_LINK,
        category=NotificationCategory.CLAIM_UPDATE.value,
        db=db,
    )
    await log_event(
        entity_type="relocation_request", entity_id=str(row.id), action="create", actor_id=user_id,
        old=None, new={"origin": origin, "destination": destination, "estimated_amount": str(amount)}, db=db,
    )
    await db.commit()
    await db.refresh(row)
    return row


async def create_prior_approval(user_id: int, payload: dict, file: UploadFile, db: AsyncSession) -> RelocationRequest:
    """Employee who already has approval (given outside the app): record it with the uploaded
    evidence and the same details as a request. It's approved straight away — no approval in the
    app — so they can go on to claim against it; the claim's approvers and Finance see the evidence."""
    await _employee(user_id, db)
    origin = _clean(payload.get("origin_city"), "Moving from")
    destination = _clean(payload.get("destination_city"), "Moving to")
    _assert_different_cities(origin, destination)
    amount = _amount(payload.get("approved_amount"), "Approved amount", required=True)
    details = await _relocation_details(payload, db, allow_past=True)
    content = await file.read()
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _EVIDENCE_EXTENSIONS or (file.content_type or "") not in _EVIDENCE_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Upload the approval as a PDF, JPG, PNG or HEIC file")
    if not content:
        raise HTTPException(status_code=422, detail="The uploaded file is empty")
    if len(content) > _MAX_EVIDENCE_BYTES:
        raise HTTPException(status_code=413, detail="The approval file can be up to 10 MB")

    folder = Path(settings.relocation_evidence_storage_dir) / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{hashlib.sha256(content).hexdigest()}{suffix}"
    path.write_bytes(content)

    row = RelocationRequest(
        employee_user_id=user_id,
        source=RelocationSource.PRIOR_APPROVAL.value,
        status=RelocationRequestStatus.APPROVED.value,
        origin_city=origin,
        destination_city=destination,
        estimated_amount=amount,
        details=details,
        evidence_path=str(path),
        evidence_filename=(file.filename or f"approval{suffix}")[:255],
        evidence_content_type=(file.content_type or "application/octet-stream")[:128],
        decided_at=now_ist(),
    )
    db.add(row)
    await db.flush()
    await log_event(
        entity_type="relocation_request", entity_id=str(row.id), action="prior_approval_uploaded", actor_id=user_id,
        old=None,
        new={"origin": origin, "destination": destination, "approved_amount": str(amount),
             "file": row.evidence_filename, "status": row.status},
        db=db,
    )
    await db.commit()
    await db.refresh(row)
    return row


async def list_my_relocations(user_id: int, db: AsyncSession) -> list[dict]:
    rows = (
        await db.execute(
            select(RelocationRequest)
            .where(
                RelocationRequest.employee_user_id == user_id,
                RelocationRequest.status != RelocationRequestStatus.CANCELLED.value,
            )
            .order_by(RelocationRequest.id.desc())
        )
    ).scalars().all()
    return [await relocation_summary(row, db) for row in rows]


async def assert_usable_for_claim(request_id: int | None, user_id: int, db: AsyncSession) -> RelocationRequest:
    """The approved relocation (of this employee) a relocation claim is being raised against."""
    if not request_id:
        raise HTTPException(
            status_code=422,
            detail=(
                "Choose an approved relocation (or upload your existing approval) "
                "before claiming relocation expenses"
            ),
        )
    row = await db.get(RelocationRequest, request_id)
    if row is None or row.employee_user_id != user_id:
        raise HTTPException(status_code=404, detail="Relocation approval not found")
    if row.status != RelocationRequestStatus.APPROVED.value:
        raise HTTPException(status_code=409, detail=f"{relocation_ref(row)} isn't approved yet")
    return row


# ------------------------------------------------------------------ summaries


async def total_claimed(request_id: int, db: AsyncSession, *, exclude_claim_id: int | None = None) -> Decimal:
    """What's been put forward against this relocation so far (submitted claims, not rejected)."""
    claims = (
        await db.execute(
            select(ClaimDraft).where(
                ClaimDraft.relocation_request_id == request_id,
                ClaimDraft.status.in_(_COUNTED_CLAIM_STATUSES),
            )
        )
    ).scalars().all()
    total = Decimal("0")
    for claim in claims:
        if exclude_claim_id is not None and claim.id == exclude_claim_id:
            continue
        total += Decimal(str((claim.compliance_report or {}).get("total_claimed") or "0"))
    return total


async def relocation_summary(row: RelocationRequest, db: AsyncSession) -> dict:
    owner = await db.get(User, row.employee_user_id)
    stages_out = []
    for stage in await _stages(row.id, db):
        decided_by_name, _ = await ws._user_identity(stage.decided_by_user_id, db)
        pending_names: list[str] = []
        if stage.status in ("PENDING", ws.STAGE_STATUS_NOT_STARTED) and stage.required_role:
            pending_names = await ws._pending_approver_names(
                stage.required_role, owner.employee_id if owner else None, db
            )
        stages_out.append(
            {
                "stage_number": stage.stage_number,
                "label": stage.stage_label,
                "required_role": stage.required_role,
                "status": stage.status,
                "decided_at": stage.decided_at,
                "decided_by_name": decided_by_name,
                "pending_approver_names": pending_names,
                "comment": stage.comment,
                "sla_deadline_at": stage.sla_deadline_at,
            }
        )
    claimed = await total_claimed(row.id, db)
    claim_count = (
        await db.execute(
            select(func.count(ClaimDraft.id)).where(
                ClaimDraft.relocation_request_id == row.id, ClaimDraft.status.in_(_COUNTED_CLAIM_STATUSES)
            )
        )
    ).scalar() or 0
    return {
        "id": row.id,
        "reference": relocation_ref(row),
        "source": row.source,
        "status": row.status,
        "employee_user_id": row.employee_user_id,
        "employee_name": (owner.full_name or owner.email) if owner else None,
        "origin_city": row.origin_city,
        "destination_city": row.destination_city,
        "estimated_amount": str(row.estimated_amount) if row.estimated_amount is not None else None,
        "details": _details_out(row.details),
        "has_evidence": bool(row.evidence_path),
        "evidence_filename": row.evidence_filename,
        "current_approval_stage": row.current_approval_stage,
        "rejection_reason": row.rejection_reason,
        "created_at": row.created_at,
        "decided_at": row.decided_at,
        "stages": stages_out,
        "total_claimed": str(claimed),
        "claim_count": int(claim_count),
    }


async def relocation_summary_for_claim(claim: ClaimDraft, db: AsyncSession) -> dict | None:
    """What a relocation claim's reviewers see: the approval it's raised against (or the uploaded
    evidence), this claim against the estimate (all claims on it combined), and the undertaking."""
    if not claim.relocation_request_id:
        return None
    row = await db.get(RelocationRequest, claim.relocation_request_id)
    if row is None:
        return None
    summary = await relocation_summary(row, db)
    this_claim = Decimal(str((claim.compliance_report or {}).get("total_claimed") or "0"))
    other_claims = await total_claimed(row.id, db, exclude_claim_id=claim.id)
    combined = this_claim + other_claims
    estimate = row.estimated_amount
    summary.update(
        {
            "this_claim_amount": str(this_claim),
            "other_claims_amount": str(other_claims),
            "combined_claimed": str(combined),
            "over_estimate_by": (
                str(combined - estimate) if estimate is not None and combined > estimate else None
            ),
            "undertaking_accepted_at": claim.undertaking_accepted_at,
            "undertaking_text": claim.undertaking_text,
        }
    )
    return summary


# ------------------------------------------------------------------ approver side


async def _can_act(user: User, row: RelocationRequest, stage: RelocationApprovalStage, db: AsyncSession) -> bool:
    owner = await db.get(User, row.employee_user_id)
    if owner is None or owner.id == user.id:
        return False  # nobody approves their own relocation
    return await ws._user_matches_required_role(user, stage.required_role or "", owner.employee_id, db)


async def list_pending_for_approver(user_id: int, db: AsyncSession) -> list[dict]:
    user = await _employee(user_id, db)
    rows = (
        await db.execute(
            select(RelocationRequest, RelocationApprovalStage)
            .join(RelocationApprovalStage, RelocationApprovalStage.relocation_request_id == RelocationRequest.id)
            .where(
                RelocationRequest.status == RelocationRequestStatus.PENDING.value,
                RelocationApprovalStage.stage_number == RelocationRequest.current_approval_stage,
                RelocationApprovalStage.status == "PENDING",
            )
            .order_by(RelocationRequest.created_at.desc())
        )
    ).all()
    out = []
    seen: set[int] = set()
    for row, stage in rows:
        if row.id in seen or not await _can_act(user, row, stage, db):
            continue
        seen.add(row.id)
        summary = await relocation_summary(row, db)
        summary["waiting_on_stage"] = stage.stage_label
        summary["sla_passed_over"] = [
            s["label"] for s in summary["stages"]
            if s["status"] == ws.STAGE_STATUS_SLA_SKIPPED and s["stage_number"] < stage.stage_number
        ]
        out.append(summary)
    return out


async def _active_stage_for(request_id: int, user_id: int, db: AsyncSession, *, override: bool = False):
    row = await db.get(RelocationRequest, request_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Relocation request not found")
    if row.status != RelocationRequestStatus.PENDING.value:
        raise HTTPException(status_code=409, detail="This relocation request is no longer awaiting approval")
    stages = await _stages(row.id, db)
    stage = next(
        (s for s in stages if s.stage_number == row.current_approval_stage and s.status == "PENDING"), None
    )
    if stage is None:
        raise HTTPException(status_code=409, detail="No approval stage is waiting on anyone")
    user = await _employee(user_id, db)
    if override:
        # An admin override (override_service) acts in place of whoever the stage waits on.
        if row.employee_user_id == user.id:
            raise HTTPException(status_code=403, detail="You can't override your own item")
    elif not await _can_act(user, row, stage, db):
        raise HTTPException(status_code=403, detail="This relocation request isn't waiting on you")
    return row, stages, stage


async def approve_relocation(
    request_id: int, user_id: int, comment: str | None, db: AsyncSession, *, override_reason: str | None = None
) -> dict:
    row, stages, stage = await _active_stage_for(request_id, user_id, db, override=bool(override_reason))
    if override_reason:
        comment = ws.override_note(await _employee(user_id, db), override_reason)
    now = now_ist()
    stage.status = "APPROVED"
    stage.decided_at = now
    stage.decided_by_user_id = user_id
    stage.comment = (comment or "").strip() or None
    later = sorted({s.stage_number for s in stages if s.stage_number > stage.stage_number})
    if later:
        stage_defs = ws.relocation_request_stage_defs(await ws.get_workflow_config(db))
        await activate_stage(row, stages, stage_defs, later[0], db)
    else:
        row.status = RelocationRequestStatus.APPROVED.value
        row.current_approval_stage = None
        row.decided_at = now
        await create_notification(
            user_id=row.employee_user_id,
            title=f"Relocation approved: {relocation_ref(row)}",
            body=(
                f"Your relocation ({row.origin_city} → {row.destination_city}) has been approved. You can now "
                "raise your claim from New Claim → Relocation Claim."
            ),
            link=RELOCATION_CLAIM_LINK,
            category=NotificationCategory.CLAIM_UPDATE.value,
            db=db,
        )
    await log_event(
        entity_type="relocation_request", entity_id=str(row.id), action="approve_stage", actor_id=user_id,
        old=None,
        new={"stage_number": stage.stage_number, "status": row.status, "comment": stage.comment,
             "override_reason": override_reason},
        db=db,
    )
    await db.commit()
    return await relocation_summary(row, db)


async def reject_relocation(
    request_id: int, user_id: int, reason: str, db: AsyncSession, *, override_reason: str | None = None
) -> dict:
    reason = (override_reason or reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="A reason is required to reject a relocation request")
    row, _stages_list, stage = await _active_stage_for(request_id, user_id, db, override=bool(override_reason))
    if override_reason:
        reason = ws.override_note(await _employee(user_id, db), override_reason)
    now = now_ist()
    stage.status = "REJECTED"
    stage.decided_at = now
    stage.decided_by_user_id = user_id
    stage.comment = reason
    row.status = RelocationRequestStatus.REJECTED.value
    row.rejection_reason = reason
    row.decided_at = now
    row.current_approval_stage = None
    await create_notification(
        user_id=row.employee_user_id,
        title=f"Relocation request rejected: {relocation_ref(row)}",
        body=f"Your relocation request ({row.origin_city} → {row.destination_city}) was rejected at "
             f"{stage.stage_label}. Reason: {reason}",
        link=RELOCATION_CLAIM_LINK,
        category=NotificationCategory.CLAIM_UPDATE.value,
        db=db,
    )
    await log_event(
        entity_type="relocation_request", entity_id=str(row.id), action="reject", actor_id=user_id,
        old=None, new={"stage_number": stage.stage_number, "reason": reason, "override_reason": override_reason}, db=db,
    )
    await db.commit()
    return await relocation_summary(row, db)


# ------------------------------------------------------------------ evidence access

_EVIDENCE_VIEWER_ROLES = {
    Role.HRBP_HR, Role.PAYROLL, Role.FINANCE, Role.CEO, Role.GROUP_HEAD_HR, Role.IT_ADMIN, Role.RECRUITER,
    Role.ADMIN,
}


async def evidence_file_for(request_id: int, user_id: int, db: AsyncSession) -> RelocationRequest:
    """The employee themselves, and the roles that review relocations/claims, can open the evidence.
    (Claim reviewers outside these roles — e.g. the reporting manager — open it through the claim,
    see claim_workflow's relocation-evidence endpoint.)"""
    row = await db.get(RelocationRequest, request_id)
    if row is None or not row.evidence_path:
        raise HTTPException(status_code=404, detail="No approval evidence on this relocation")
    user = await _employee(user_id, db)
    if row.employee_user_id != user_id and user.role not in _EVIDENCE_VIEWER_ROLES:
        # Anyone on this item's approval route (whatever role the Approval Matrix gives it) can
        # see what they're asked to check.
        owner = await db.get(User, row.employee_user_id)
        on_route = False
        for stage in await _stages(row.id, db):
            if owner is not None and await ws._user_matches_required_role(
                user, stage.required_role or "", owner.employee_id, db
            ):
                on_route = True
                break
        if not on_route:
            raise HTTPException(status_code=403, detail="You can't view this relocation's evidence")
    if not Path(row.evidence_path).exists():
        raise HTTPException(status_code=404, detail="The evidence file is missing from storage")
    return row
