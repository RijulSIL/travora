"""Admin override of stuck approvals — the "override_approvals" permission (IT Admin by default).

Whoever holds it can act on a claim, travel request or relocation request in place of whoever its
current step is waiting on: decide the step (approve, reject, or send back a claim), skip it (pass
it to the next step without a decision, like an SLA pass-on), or approve every remaining step at
once. A claim's normal route and its exception route are both covered, as are a travel request's;
Finance's payment step never is — an override can get a claim to Finance, only Finance pays it.

Every override needs a reason. Decisions go through the same workflow functions an approver's do
(with `override_reason`, which skips only the "is this your step" check), so the item moves on and
everyone is notified exactly as usual; the step's comment and the audit log record the override,
and whoever the step was waiting on is told an admin acted for them. Nobody overrides their own item.
"""

from dataclasses import dataclass, field
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import now_ist
from app.models.auth import Role, User
from app.models.claim_workflow import (
    ClaimApprovalStageStatus,
    ExceptionApproval,
    ExceptionItemDecisionValue,
    ExceptionRequest,
    ExceptionRequestStatus,
    NotificationCategory,
)
from app.models.reimbursement import ClaimDraft, ClaimStatus
from app.models.relocation import RelocationRequest, RelocationRequestStatus
from app.models.travel_request import TravelRequest, TravelRequestStatus
from app.services import relocation_service
from app.services import workflow_service as ws
from app.services.audit_service import log_event
from app.services.notification_service import create_notification

OVERRIDE_PERMISSION = "override_approvals"
KINDS = ("claim", "travel", "relocation")
ACTIONS = ("approve", "reject", "send_back", "skip", "approve_all")
MIN_REASON_CHARS = 10


@dataclass
class Waiting:
    """Where one item is stuck: the step it waits on and what an override can do there."""

    kind: str
    item_id: int
    route: str  # "approval" (the item's normal steps) or "exception" (its exception route)
    reference: str
    employee_user_id: int
    employee_name: str | None
    summary: str
    step_label: str
    step_role: str | None
    waiting_since: datetime | None
    sla_deadline_at: datetime | None
    actions: list[str]
    link: str | None
    steps: list[dict] = field(default_factory=list)
    exception_request_id: int | None = None

    def out(self) -> dict:
        now = now_ist()
        return {
            "kind": self.kind,
            "item_id": self.item_id,
            "route": self.route,
            "reference": self.reference,
            "employee_user_id": self.employee_user_id,
            "employee_name": self.employee_name,
            "summary": self.summary,
            "step_label": self.step_label,
            "step_role": self.step_role,
            "waiting_since": self.waiting_since,
            "sla_deadline_at": self.sla_deadline_at,
            "overdue": bool(self.sla_deadline_at and self.sla_deadline_at < now),
            "actions": self.actions,
            "link": self.link,
            "steps": self.steps,
        }


async def _name(user_id: int | None, db: AsyncSession) -> str | None:
    return (await ws._user_identity(user_id, db))[0]


def _role_label(role: str | None) -> str:
    return ws._humanize_token(role or "")


async def _stage_steps(rows: list, db: AsyncSession) -> list[dict]:
    """A route's steps for display: label, role, status and who decided."""
    out = []
    for row in rows:
        out.append(
            {
                "label": row.stage_label,
                "role": row.required_role,
                "status": row.status,
                "decided_by": await _name(row.decided_by_user_id, db),
                "decided_at": row.decided_at,
                "comment": row.comment,
            }
        )
    return out


async def _exception_steps(approvals: list[ExceptionApproval], db: AsyncSession) -> list[dict]:
    return [
        {
            "label": _role_label(a.required_role),
            "role": a.required_role,
            "status": a.status,
            "decided_by": await _name(a.acted_by_user_id, db),
            "decided_at": a.acted_at,
            "comment": a.comment,
        }
        for a in approvals
    ]


async def _pending_exception(db: AsyncSession, *, claim_id: int | None = None, travel_request_id: int | None = None):
    """An item's exception request still on its route, and that route's steps (oldest first)."""
    query = select(ExceptionRequest).where(ExceptionRequest.status == ExceptionRequestStatus.PENDING.value)
    query = query.where(
        ExceptionRequest.claim_id == claim_id
        if claim_id is not None
        else ExceptionRequest.travel_request_id == travel_request_id
    )
    req = (await db.execute(query.order_by(ExceptionRequest.id.desc()))).scalars().first()
    if req is None:
        return None, []
    approvals = list(
        (
            await db.execute(
                select(ExceptionApproval)
                .where(ExceptionApproval.exception_request_id == req.id)
                .order_by(ExceptionApproval.id)
            )
        )
        .scalars()
        .all()
    )
    return req, approvals


def _exception_waiting_step(approvals: list[ExceptionApproval]) -> ExceptionApproval | None:
    return next((a for a in approvals if a.status == ExceptionRequestStatus.PENDING.value), None)


def _has_later_exception_step(approvals: list[ExceptionApproval], step: ExceptionApproval) -> bool:
    return any(a.id > step.id and a.status == "AWAITING" for a in approvals)


def _since(earlier: list[datetime | None], opened: datetime | None) -> datetime | None:
    """When the current step started waiting: the latest decision before it, or when the item
    (or its resubmission) arrived."""
    times = [t for t in [*earlier, opened] if t is not None]
    return max(times) if times else None


def _actions(*, send_back: bool, has_next: bool) -> list[str]:
    actions = ["approve", "reject"]
    if send_back:
        actions.append("send_back")
    if has_next:
        actions.append("skip")
    actions.append("approve_all")
    return actions


# ---------------------------------------------------------------- where each kind is waiting


async def _claim_waiting(claim: ClaimDraft, db: AsyncSession) -> Waiting | None:
    owner_name = await _name(claim.employee_user_id, db)
    ref = claim.claim_reference or f"CLM-{claim.id}"
    total = (claim.compliance_report or {}).get("total_claimed")
    summary = " · ".join(
        p
        for p in (
            (claim.reimbursement_category.value.title() + " claim") if claim.reimbursement_category else "Claim",
            f"₹{total}" if total else None,
            f"{claim.from_city} → {claim.destination_city}" if claim.destination_city else None,
        )
        if p
    )
    base = dict(
        kind="claim",
        item_id=claim.id,
        reference=ref,
        employee_user_id=claim.employee_user_id,
        employee_name=owner_name,
        summary=summary,
        link=f"/claims/{claim.id}",
    )
    if claim.status == ClaimStatus.PENDING_EXCEPTION:
        req, approvals = await _pending_exception(db, claim_id=claim.id)
        step = _exception_waiting_step(approvals) if req else None
        if step is None:
            return None
        return Waiting(
            **base,
            route="exception",
            step_label=f"{_role_label(step.required_role)} (exception route)",
            step_role=step.required_role,
            waiting_since=_since([a.acted_at for a in approvals if a.id < step.id], claim.submitted_at),
            sla_deadline_at=step.sla_deadline_at,
            actions=_actions(
                send_back=ws.is_itemized_claim_request(req), has_next=_has_later_exception_step(approvals, step)
            ),
            steps=await _exception_steps(approvals, db),
            exception_request_id=req.id,
        )
    if claim.status != ClaimStatus.IN_APPROVAL or claim.current_approval_stage is None:
        return None
    stages = await ws._load_stages(claim.id, db)
    pending = [
        s
        for s in stages
        if s.stage_number == claim.current_approval_stage and s.status == ClaimApprovalStageStatus.PENDING.value
    ]
    if not pending or any(s.required_role == Role.FINANCE.value for s in pending):
        return None  # with Finance for payment: never overridden
    return Waiting(
        **base,
        route="approval",
        step_label=pending[0].stage_label,
        step_role=pending[0].required_role,
        waiting_since=_since(
            [s.decided_at for s in stages if s.stage_number < claim.current_approval_stage], claim.submitted_at
        ),
        sla_deadline_at=pending[0].sla_deadline_at,
        actions=_actions(send_back=True, has_next=any(s.stage_number > claim.current_approval_stage for s in stages)),
        steps=await _stage_steps(stages, db),
    )


async def _travel_waiting(req: TravelRequest, db: AsyncSession) -> Waiting | None:
    ref = f"TR-{req.id:04d}"
    base = dict(
        kind="travel",
        item_id=req.id,
        reference=ref,
        employee_user_id=req.employee_user_id,
        employee_name=await _name(req.employee_user_id, db),
        summary=" · ".join(
            p
            for p in (
                f"{req.from_city} → {req.to_city}" if req.to_city else "Travel request",
                req.travel_date.strftime("%d %b %Y") if req.travel_date else None,
            )
            if p
        ),
        link=None,
    )
    if req.status == TravelRequestStatus.PENDING_EXCEPTION.value:
        exc, approvals = await _pending_exception(db, travel_request_id=req.id)
        step = _exception_waiting_step(approvals) if exc else None
        if step is None:
            return None
        return Waiting(
            **base,
            route="exception",
            step_label=f"{_role_label(step.required_role)} (exception route)",
            step_role=step.required_role,
            waiting_since=_since([a.acted_at for a in approvals if a.id < step.id], req.created_at),
            sla_deadline_at=step.sla_deadline_at,
            actions=_actions(send_back=False, has_next=_has_later_exception_step(approvals, step)),
            steps=await _exception_steps(approvals, db),
            exception_request_id=exc.id,
        )
    if req.status != TravelRequestStatus.PENDING.value or req.current_approval_stage is None:
        return None
    stages = await ws._load_travel_stages(req.id, db)
    pending = next(
        (
            s
            for s in stages
            if s.stage_number == req.current_approval_stage and s.status == ClaimApprovalStageStatus.PENDING.value
        ),
        None,
    )
    if pending is None:
        return None
    return Waiting(
        **base,
        route="approval",
        step_label=pending.stage_label,
        step_role=pending.required_role,
        waiting_since=_since([s.decided_at for s in stages if s.stage_number < pending.stage_number], req.created_at),
        sla_deadline_at=pending.sla_deadline_at,
        actions=_actions(send_back=False, has_next=any(s.stage_number > pending.stage_number for s in stages)),
        steps=await _stage_steps(stages, db),
    )


async def _relocation_waiting(row: RelocationRequest, db: AsyncSession) -> Waiting | None:
    if row.status != RelocationRequestStatus.PENDING.value or row.current_approval_stage is None:
        return None
    stages = await relocation_service._stages(row.id, db)
    pending = next((s for s in stages if s.stage_number == row.current_approval_stage and s.status == "PENDING"), None)
    if pending is None:
        return None
    return Waiting(
        kind="relocation",
        item_id=row.id,
        route="approval",
        reference=relocation_service.relocation_ref(row),
        employee_user_id=row.employee_user_id,
        employee_name=await _name(row.employee_user_id, db),
        summary=" · ".join(
            p
            for p in (
                f"{row.origin_city} → {row.destination_city}",
                f"₹{row.estimated_amount}" if row.estimated_amount is not None else None,
            )
            if p
        ),
        step_label=pending.stage_label,
        step_role=pending.required_role,
        waiting_since=_since([s.decided_at for s in stages if s.stage_number < pending.stage_number], row.created_at),
        sla_deadline_at=pending.sla_deadline_at,
        actions=_actions(send_back=False, has_next=any(s.stage_number > pending.stage_number for s in stages)),
        link=None,
        steps=await _stage_steps(stages, db),
    )


async def waiting_on(kind: str, item_id: int, db: AsyncSession) -> Waiting | None:
    """Where one item is waiting, or None when there's nothing an override can act on (decided,
    a draft, or with Finance for payment)."""
    if kind == "claim":
        claim = await db.get(ClaimDraft, item_id, populate_existing=True)
        return await _claim_waiting(claim, db) if claim else None
    if kind == "travel":
        req = await db.get(TravelRequest, item_id, populate_existing=True)
        return await _travel_waiting(req, db) if req else None
    if kind == "relocation":
        row = await db.get(RelocationRequest, item_id, populate_existing=True)
        return await _relocation_waiting(row, db) if row else None
    raise HTTPException(status_code=404, detail="Unknown kind of item")


async def list_waiting(db: AsyncSession) -> list[dict]:
    """Everything waiting on an approver that an override could act on — past its SLA first,
    then the longest waiting."""
    found: list[Waiting] = []
    claims = (
        (
            await db.execute(
                select(ClaimDraft).where(
                    ClaimDraft.status.in_([ClaimStatus.IN_APPROVAL, ClaimStatus.PENDING_EXCEPTION])
                )
            )
        )
        .scalars()
        .all()
    )
    for claim in claims:
        if (w := await _claim_waiting(claim, db)) is not None:
            found.append(w)
    travel = (
        (
            await db.execute(
                select(TravelRequest).where(
                    TravelRequest.status.in_(
                        [TravelRequestStatus.PENDING.value, TravelRequestStatus.PENDING_EXCEPTION.value]
                    )
                )
            )
        )
        .scalars()
        .all()
    )
    for req in travel:
        if (w := await _travel_waiting(req, db)) is not None:
            found.append(w)
    relocations = (
        (
            await db.execute(
                select(RelocationRequest).where(RelocationRequest.status == RelocationRequestStatus.PENDING.value)
            )
        )
        .scalars()
        .all()
    )
    for row in relocations:
        if (w := await _relocation_waiting(row, db)) is not None:
            found.append(w)
    rows = [w.out() for w in found]
    rows.sort(key=lambda r: (not r["overdue"], r["waiting_since"] or datetime.max))
    return rows


# ---------------------------------------------------------------- acting


async def _people_at_step(w: Waiting, db: AsyncSession) -> list[int]:
    """Whoever the step was waiting on — told when an admin acts in their place."""
    role = w.step_role or ""
    if w.kind == "claim":
        claim = await db.get(ClaimDraft, w.item_id)
        if w.route == "exception":
            return await ws._user_ids_for_exception_role(claim, role, db)
        return await ws._user_ids_for_stage(claim, {"route_role": role}, db)
    if w.kind == "travel":
        req = await db.get(TravelRequest, w.item_id)
        return await ws._user_ids_for_exception_role_for_travel(req, role, db)
    owner = await db.get(User, w.employee_user_id)
    return await ws._user_ids_for_role(role, owner.employee_id if owner else None, db)


async def _decide(w: Waiting, action: str, actor_id: int, reason: str, db: AsyncSession) -> None:
    """Decide the current step (approve / reject / send back) through the usual workflow function."""
    if w.route == "exception":
        if action == "send_back":
            await ws.decide_claim_exception_items(
                w.exception_request_id,
                actor_id,
                None,
                db,
                same_for_all=(ExceptionItemDecisionValue.SENT_BACK.value, None),
                override_reason=reason,
            )
        else:
            await ws.decide_exception_request(
                w.exception_request_id, actor_id, action == "approve", None, db, override_reason=reason
            )
        return
    if w.kind == "claim":
        if action == "approve":
            await ws.approve_claim_stage(w.item_id, actor_id, None, db, override_reason=reason)
        elif action == "reject":
            await ws.reject_claim(w.item_id, actor_id, "", db, override_reason=reason)
        else:
            await ws.send_back_claim(w.item_id, actor_id, "", db, override_reason=reason)
    elif w.kind == "travel":
        if action == "approve":
            await ws.approve_travel_request_stage(w.item_id, actor_id, None, db, override_reason=reason)
        else:
            await ws.reject_travel_request_stage(w.item_id, actor_id, "", db, override_reason=reason)
    elif action == "approve":
        await relocation_service.approve_relocation(w.item_id, actor_id, None, db, override_reason=reason)
    else:
        await relocation_service.reject_relocation(w.item_id, actor_id, "", db, override_reason=reason)


async def _skip(w: Waiting, actor: User, reason: str, db: AsyncSession) -> None:
    """Pass the current step on to the next one without a decision — the same move as an SLA
    pass-on (see workers.sla_monitor), recorded as an override."""
    now = now_ist()
    note = ws.override_note(actor, reason)
    passed_on = f"An admin passed this on from {w.step_label}, so it has moved to you."
    entity = {"claim": "claim_draft", "travel": "travel_request", "relocation": "relocation_request"}[w.kind]
    if w.route == "exception":
        req = await ws._locked_exception_request(w.exception_request_id, db)
        approvals = await ws._locked_exception_steps(req.id, db)
        step = _exception_waiting_step(approvals)
        nxt = next(
            (a for a in sorted(approvals, key=lambda a: a.id) if step and a.id > step.id and a.status == "AWAITING"),
            None,
        )
        if step is None or nxt is None:
            raise HTTPException(status_code=409, detail="This is the last step — approve or reject it instead")
        step.status = ws.STAGE_STATUS_OVERRIDE_SKIPPED
        step.acted_at = now
        step.acted_by_user_id = actor.id
        step.comment = note
        cfg = await ws.get_workflow_config(db)
        await ws.start_exception_step(nxt, req, cfg, db)
        if req.claim_id:
            await ws._notify_exception_approver(
                await db.get(ClaimDraft, req.claim_id), req, nxt.required_role, db, passed_on
            )
        else:
            await ws._notify_travel_exception_approver(
                await db.get(TravelRequest, req.travel_request_id), req, nxt.required_role, db, passed_on
            )
        entity, entity_id, to_label = "exception_request", req.id, _role_label(nxt.required_role)
    elif w.kind == "claim":
        claim = (await db.execute(select(ClaimDraft).where(ClaimDraft.id == w.item_id).with_for_update())).scalar_one()
        stages = await ws._load_stages(claim.id, db)
        current = claim.current_approval_stage
        later = sorted({s.stage_number for s in stages if s.stage_number > current})
        if not later:
            raise HTTPException(status_code=409, detail="This is the last step — approve or reject it instead")
        cfg = await ws.get_workflow_config(db, category=claim.reimbursement_category.value)
        stage_defs = ws._normalize_stage_defs(cfg)
        for row in stages:
            if row.stage_number == current and row.status == ClaimApprovalStageStatus.PENDING.value:
                row.status = ws.STAGE_STATUS_OVERRIDE_SKIPPED
                row.decided_at = now
                row.decided_by_user_id = actor.id
                row.comment = note
        next_number = later[0]
        next_rows = [s for s in stages if s.stage_number == next_number]
        next_defs = [sd for sd in stage_defs if int(sd["number"]) == next_number]
        claim.current_approval_stage = next_number
        is_finance = any(str(sd.get("route_role")) == Role.FINANCE.value for sd in next_defs)
        if not (is_finance and await ws.has_pending_claim_exceptions(claim.id, db)):
            if is_finance:
                claim.status = ClaimStatus.READY_FOR_PAYMENT
            await ws._activate_stage_rows(claim, next_rows, next_defs, stage_defs, next_number, now, db, note=passed_on)
        entity_id, to_label = claim.id, next_rows[0].stage_label if next_rows else "the next step"
    elif w.kind == "travel":
        req = (
            await db.execute(select(TravelRequest).where(TravelRequest.id == w.item_id).with_for_update())
        ).scalar_one()
        stages = await ws._load_travel_stages(req.id, db)
        pending = next(
            (
                s
                for s in stages
                if s.stage_number == req.current_approval_stage and s.status == ClaimApprovalStageStatus.PENDING.value
            ),
            None,
        )
        later = sorted({s.stage_number for s in stages if pending and s.stage_number > pending.stage_number})
        if pending is None or not later:
            raise HTTPException(status_code=409, detail="This is the last step — approve or reject it instead")
        pending.status = ws.STAGE_STATUS_OVERRIDE_SKIPPED
        pending.decided_at = now
        pending.decided_by_user_id = actor.id
        pending.comment = note
        req.current_approval_stage = later[0]
        stage_defs = ws._travel_request_stage_defs(await ws.get_workflow_config(db))
        await ws._activate_travel_stage_rows(req, stages, stage_defs, later[0], now, db, note=passed_on)
        entity_id, to_label = req.id, next(s.stage_label for s in stages if s.stage_number == later[0])
    else:
        row = (
            await db.execute(select(RelocationRequest).where(RelocationRequest.id == w.item_id).with_for_update())
        ).scalar_one()
        stages = await relocation_service._stages(row.id, db)
        pending = next(
            (s for s in stages if s.stage_number == row.current_approval_stage and s.status == "PENDING"), None
        )
        later = sorted({s.stage_number for s in stages if pending and s.stage_number > pending.stage_number})
        if pending is None or not later:
            raise HTTPException(status_code=409, detail="This is the last step — approve or reject it instead")
        pending.status = ws.STAGE_STATUS_OVERRIDE_SKIPPED
        pending.decided_at = now
        pending.decided_by_user_id = actor.id
        pending.comment = note
        stage_defs = ws.relocation_request_stage_defs(await ws.get_workflow_config(db))
        await relocation_service.activate_stage(row, stages, stage_defs, later[0], db, note=passed_on)
        entity_id, to_label = row.id, next(s.stage_label for s in stages if s.stage_number == later[0])
    await log_event(
        entity_type=entity,
        entity_id=str(entity_id),
        action="override_skip_step",
        actor_id=actor.id,
        old={"step": w.step_label},
        new={"passed_on_to": to_label, "override_reason": reason},
        db=db,
    )
    await db.commit()


async def override(kind: str, item_id: int, action: str, reason: str, actor_id: int, db: AsyncSession) -> dict | None:
    """Carry out one override and return where the item is waiting now (None once it's no longer
    waiting on an approver — decided, sent back, or with Finance)."""
    if action not in ACTIONS:
        raise HTTPException(status_code=422, detail="Unknown override action")
    reason = (reason or "").strip()
    if len(reason) < MIN_REASON_CHARS:
        raise HTTPException(status_code=422, detail=f"Give a reason of at least {MIN_REASON_CHARS} characters")
    actor = await db.get(User, actor_id)
    if actor is None:
        raise HTTPException(status_code=404, detail="User not found")
    w = await waiting_on(kind, item_id, db)
    if w is None:
        raise HTTPException(status_code=409, detail="This isn't waiting on an approver — there's nothing to override")
    if w.employee_user_id == actor_id:
        raise HTTPException(status_code=403, detail="You can't override your own item")
    if action not in w.actions:
        raise HTTPException(status_code=409, detail="That isn't possible at this step")

    # Who's being acted for, step by step (approve-all can pass several steps).
    acted_for: list[tuple[Waiting, list[int]]] = [(w, await _people_at_step(w, db))]
    if action == "skip":
        await _skip(w, actor, reason, db)
    elif action == "approve_all":
        await _decide(w, "approve", actor_id, reason, db)
        for _ in range(12):  # a route has at most 6 steps; exception route then the normal one
            nxt = await waiting_on(kind, item_id, db)
            if nxt is None:
                break
            acted_for.append((nxt, await _people_at_step(nxt, db)))
            await _decide(nxt, "approve", actor_id, reason, db)
    else:
        await _decide(w, action, actor_id, reason, db)

    did = {
        "approve": "approved",
        "reject": "rejected",
        "send_back": "sent back",
        "skip": "passed on",
        "approve_all": "approved",
    }[action]
    actor_name = actor.full_name or actor.email
    for step, people in acted_for:
        for user_id in dict.fromkeys(people):
            if user_id == actor_id:
                continue
            await create_notification(
                user_id=user_id,
                title=f"{step.reference} was {did} by an admin",
                body=(
                    f"{actor_name} {did} {step.reference} at {step.step_label}, which was waiting on you, as an "
                    f"admin override. Reason: {reason}"
                ),
                link=step.link or "/claims/pending",
                category=NotificationCategory.CLAIM_UPDATE.value,
                db=db,
            )
    await db.commit()
    now_waiting = await waiting_on(kind, item_id, db)
    return now_waiting.out() if now_waiting else None
