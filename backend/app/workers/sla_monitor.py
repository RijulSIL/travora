"""Approval SLA monitor — runs every few minutes (see app.main._run_monitors).

For every approval step that's currently waiting on someone — claim stages, travel request
stages, relocation request stages, and exception approval steps (claim and travel) — this:

* passes the request on to the next approver once the step's SLA runs out, emailing the
  approver who missed it and telling the next approver why it reached them. The LAST approver
  in a chain is never skipped (for claims that's Finance): they get an "SLA breached" email and
  keep being reminded instead;
* reminds the current approver every 4 working hours until they act.

SLA deadlines and reminder spacing count working time only — Saturdays, Sundays and Holiday
Calendar days don't count (app.services.working_time), and no reminders go out on those days.
"""

import asyncio
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.timezone import now_ist
from app.models.claim_workflow import (
    ClaimApprovalStage,
    ClaimApprovalStageStatus,
    ExceptionApproval,
    ExceptionRequest,
    ExceptionRequestStatus,
    NotificationCategory,
)
from app.models.reimbursement import ClaimDraft, ClaimStatus
from app.models.travel_request import TravelRequest, TravelRequestApprovalStage, TravelRequestStatus
from app.services import workflow_service as ws
from app.services.audit_service import log_event
from app.services.notification_service import create_notification
from app.services.working_time import add_working_hours, is_working_day, load_holidays

REMINDER_EVERY_WORKING_HOURS = 4
SKIP_NOTE = "SLA breached — passed to the next approver."


def _passed_on_note(missed_label: str) -> str:
    return f"The previous approver ({missed_label}) didn't act within the SLA, so this has moved to you."


class _Clock:
    def __init__(self, now: datetime, holidays: set[date]):
        self.now = now
        self.holidays = holidays
        self.working_now = is_working_day(now.date(), holidays)

    def breached(self, deadline: datetime | None, breached_at: datetime | None) -> bool:
        return deadline is not None and breached_at is None and self.now >= deadline

    def reminder_due(self, last_notified_at: datetime | None) -> bool:
        if not self.working_now or last_notified_at is None:
            return False
        return add_working_hours(last_notified_at, REMINDER_EVERY_WORKING_HOURS, self.holidays) <= self.now


async def _send(user_ids: list[int], title: str, body: str, link: str, category: str, db: AsyncSession) -> None:
    for user_id in dict.fromkeys(user_ids):
        await create_notification(user_id=user_id, title=title, body=body, link=link, category=category, db=db)


def _deadline_text(deadline: datetime | None) -> str:
    return deadline.strftime("%d %b, %I:%M %p") if deadline else "—"


# ---------------------------------------------------------------- claim stages


async def _claim_stages(db: AsyncSession, clock: _Clock) -> None:
    rows = (
        await db.execute(
            select(ClaimApprovalStage, ClaimDraft)
            .join(ClaimDraft, ClaimDraft.id == ClaimApprovalStage.claim_id)
            .where(
                ClaimApprovalStage.status == ClaimApprovalStageStatus.PENDING.value,
                ClaimApprovalStage.stage_number == ClaimDraft.current_approval_stage,
                ClaimDraft.status.in_([ClaimStatus.IN_APPROVAL, ClaimStatus.READY_FOR_PAYMENT]),
            )
        )
    ).all()
    by_claim: dict[int, tuple[ClaimDraft, list[ClaimApprovalStage]]] = {}
    for stage, claim in rows:
        by_claim.setdefault(claim.id, (claim, []))[1].append(stage)

    for claim, pending in by_claim.values():
        cfg = await ws.get_workflow_config(db, category=claim.reimbursement_category.value)
        stage_defs = ws._normalize_stage_defs(cfg)
        ref = claim.claim_reference or f"CLM-{claim.id}"
        link = f"/claims/{claim.id}/review"

        async def approvers(row: ClaimApprovalStage, _claim: ClaimDraft = claim) -> list[int]:
            return await ws._user_ids_for_stage(_claim, {"route_role": row.required_role}, db)

        for row in pending:
            if row.sla_deadline_at is None:  # activated before SLAs were tracked
                row.sla_deadline_at = add_working_hours(
                    clock.now, ws._stage_hours(stage_defs, row.stage_number), clock.holidays
                )
            if row.last_notified_at is None:
                row.last_notified_at = clock.now

        if any(clock.breached(r.sla_deadline_at, r.sla_breached_at) for r in pending):
            all_stages = await ws._load_stages(claim.id, db)
            current = pending[0].stage_number
            later = sorted({s.stage_number for s in all_stages if s.stage_number > current})
            label = pending[0].stage_label
            for r in pending:
                r.sla_breached_at = clock.now
            if later:
                await _pass_claim_on(db, claim, pending, all_stages, stage_defs, later[0], clock, ref, link, approvers)
                continue
            for r in pending:
                await _send(
                    await approvers(r),
                    f"SLA breached: {ref}",
                    f"{ref} ({label}) is past its SLA and is still waiting on you. You'll be reminded every "
                    f"{REMINDER_EVERY_WORKING_HOURS} working hours until you act.",
                    link, NotificationCategory.SLA_BREACH.value, db,
                )
                r.last_notified_at = clock.now
            await log_event(
                entity_type="claim_draft", entity_id=str(claim.id), action="sla_breached", actor_id=None,
                old=None, new={"stage_number": current, "comment": f"{label} is past its SLA."}, db=db,
            )
            continue

        for r in pending:
            if clock.reminder_due(r.last_notified_at):
                await _send(
                    await approvers(r),
                    f"Reminder: {ref} is waiting for your approval",
                    f"{ref} ({r.stage_label}) is still waiting on you. SLA deadline: {_deadline_text(r.sla_deadline_at)}.",
                    link, NotificationCategory.APPROVAL_REQUIRED.value, db,
                )
                r.last_notified_at = clock.now


async def _pass_claim_on(db, claim, pending, all_stages, stage_defs, next_number, clock, ref, link, approvers) -> None:
    missed_label = pending[0].stage_label
    next_rows = [s for s in all_stages if s.stage_number == next_number]
    next_defs = [sd for sd in stage_defs if int(sd["number"]) == next_number]
    next_label = next_rows[0].stage_label if next_rows else "the next approver"
    for r in pending:
        r.status = ws.STAGE_STATUS_SLA_SKIPPED
        r.decided_at = clock.now
        r.comment = SKIP_NOTE
        await _send(
            await approvers(r),
            f"SLA breached: {ref}",
            f"You didn't act on {ref} ({missed_label}) within its SLA, so it has been passed on to the next "
            f"approver ({next_label}).",
            link, NotificationCategory.SLA_BREACH.value, db,
        )
    claim.current_approval_stage = next_number
    is_finance = any(str(sd.get("route_role")) == ws.Role.FINANCE.value for sd in next_defs)
    if is_finance and await ws.has_pending_claim_exceptions(claim.id, db):
        pass  # held from Finance until its exceptions are decided (see release_claim_to_finance)
    else:
        if is_finance:
            claim.status = ClaimStatus.READY_FOR_PAYMENT
        await ws._activate_stage_rows(
            claim, next_rows, next_defs, stage_defs, next_number, clock.now, db, note=_passed_on_note(missed_label)
        )
    await log_event(
        entity_type="claim_draft", entity_id=str(claim.id), action="sla_passed_on", actor_id=None,
        old={"current_approval_stage": pending[0].stage_number},
        new={
            "stage_number": pending[0].stage_number,
            "current_approval_stage": next_number,
            "comment": f"{missed_label} didn't act within the SLA — passed on to {next_label}.",
        },
        db=db,
    )


# ---------------------------------------------------------------- travel request stages


async def _travel_stages(db: AsyncSession, clock: _Clock) -> None:
    rows = (
        await db.execute(
            select(TravelRequestApprovalStage, TravelRequest)
            .join(TravelRequest, TravelRequest.id == TravelRequestApprovalStage.travel_request_id)
            .where(
                TravelRequestApprovalStage.status == ClaimApprovalStageStatus.PENDING.value,
                TravelRequestApprovalStage.stage_number == TravelRequest.current_approval_stage,
                TravelRequest.status == TravelRequestStatus.PENDING.value,
            )
        )
    ).all()
    if not rows:
        return
    stage_defs = ws._travel_request_stage_defs(await ws.get_workflow_config(db))
    for row, req in rows:
        ref = f"TR-{req.id:04d}"
        link = "/claims/pending?tab=travel"
        recipients = await ws._user_ids_for_exception_role_for_travel(req, row.required_role or "", db)
        if row.sla_deadline_at is None:
            row.sla_deadline_at = add_working_hours(clock.now, ws._stage_hours(stage_defs, row.stage_number), clock.holidays)
        if row.last_notified_at is None:
            row.last_notified_at = clock.now

        if clock.breached(row.sla_deadline_at, row.sla_breached_at):
            row.sla_breached_at = clock.now
            stages = await ws._load_travel_stages(req.id, db)
            later = sorted({s.stage_number for s in stages if s.stage_number > row.stage_number})
            if later:
                next_number = later[0]
                next_label = next(s.stage_label for s in stages if s.stage_number == next_number)
                row.status = ws.STAGE_STATUS_SLA_SKIPPED
                row.decided_at = clock.now
                row.comment = SKIP_NOTE
                await _send(
                    recipients, f"SLA breached: {ref}",
                    f"You didn't act on travel request {ref} ({row.stage_label}) within its SLA, so it has been "
                    f"passed on to the next approver ({next_label}).",
                    link, NotificationCategory.SLA_BREACH.value, db,
                )
                req.current_approval_stage = next_number
                await ws._activate_travel_stage_rows(
                    req, stages, stage_defs, next_number, clock.now, db, note=_passed_on_note(row.stage_label)
                )
                await log_event(
                    entity_type="travel_request", entity_id=str(req.id), action="sla_passed_on", actor_id=None,
                    old={"current_approval_stage": row.stage_number},
                    new={"stage_number": row.stage_number, "current_approval_stage": next_number}, db=db,
                )
            else:
                await _send(
                    recipients, f"SLA breached: {ref}",
                    f"Travel request {ref} ({row.stage_label}) is past its SLA and is still waiting on you. You'll "
                    f"be reminded every {REMINDER_EVERY_WORKING_HOURS} working hours until you act.",
                    link, NotificationCategory.SLA_BREACH.value, db,
                )
                row.last_notified_at = clock.now
            continue

        if clock.reminder_due(row.last_notified_at):
            await _send(
                recipients, f"Reminder: {ref} is waiting for your approval",
                f"Travel request {ref} ({row.stage_label}) is still waiting on you. SLA deadline: "
                f"{_deadline_text(row.sla_deadline_at)}.",
                link, NotificationCategory.APPROVAL_REQUIRED.value, db,
            )
            row.last_notified_at = clock.now


# ---------------------------------------------------------------- relocation request stages


async def _relocation_stages(db: AsyncSession, clock: _Clock) -> None:
    from app.models.auth import User
    from app.models.relocation import RelocationApprovalStage, RelocationRequest, RelocationRequestStatus
    from app.services import relocation_service

    rows = (
        await db.execute(
            select(RelocationApprovalStage, RelocationRequest)
            .join(RelocationRequest, RelocationRequest.id == RelocationApprovalStage.relocation_request_id)
            .where(
                RelocationApprovalStage.status == ClaimApprovalStageStatus.PENDING.value,
                RelocationApprovalStage.stage_number == RelocationRequest.current_approval_stage,
                RelocationRequest.status == RelocationRequestStatus.PENDING.value,
            )
        )
    ).all()
    if not rows:
        return
    cfg = await ws.get_workflow_config(db)
    for row, req in rows:
        stage_defs = ws.relocation_request_stage_defs(cfg)
        ref = relocation_service.relocation_ref(req)
        link = "/claims/pending?tab=relocation"
        owner = await db.get(User, req.employee_user_id)
        recipients = await ws._user_ids_for_role(row.required_role or "", owner.employee_id if owner else None, db)
        if row.sla_deadline_at is None:
            row.sla_deadline_at = add_working_hours(clock.now, ws._stage_hours(stage_defs, row.stage_number), clock.holidays)
        if row.last_notified_at is None:
            row.last_notified_at = clock.now

        if clock.breached(row.sla_deadline_at, row.sla_breached_at):
            row.sla_breached_at = clock.now
            stages = await relocation_service._stages(req.id, db)
            later = sorted({s.stage_number for s in stages if s.stage_number > row.stage_number})
            if later:
                next_label = next(s.stage_label for s in stages if s.stage_number == later[0])
                row.status = ws.STAGE_STATUS_SLA_SKIPPED
                row.decided_at = clock.now
                row.comment = SKIP_NOTE
                await _send(
                    recipients, f"SLA breached: {ref}",
                    f"You didn't act on relocation request {ref} ({row.stage_label}) within its SLA, so it has been "
                    f"passed on to the next approver ({next_label}).",
                    link, NotificationCategory.SLA_BREACH.value, db,
                )
                await relocation_service.activate_stage(
                    req, stages, stage_defs, later[0], db, note=_passed_on_note(row.stage_label)
                )
                await log_event(
                    entity_type="relocation_request", entity_id=str(req.id), action="sla_passed_on", actor_id=None,
                    old={"current_approval_stage": row.stage_number},
                    new={"stage_number": row.stage_number, "current_approval_stage": later[0]}, db=db,
                )
            else:
                await _send(
                    recipients, f"SLA breached: {ref}",
                    f"Relocation request {ref} ({row.stage_label}) is past its SLA and is still waiting on you. You'll "
                    f"be reminded every {REMINDER_EVERY_WORKING_HOURS} working hours until you act.",
                    link, NotificationCategory.SLA_BREACH.value, db,
                )
                row.last_notified_at = clock.now
            continue

        if clock.reminder_due(row.last_notified_at):
            await _send(
                recipients, f"Reminder: {ref} is waiting for your approval",
                f"Relocation request {ref} ({row.stage_label}) is still waiting on you. SLA deadline: "
                f"{_deadline_text(row.sla_deadline_at)}.",
                link, NotificationCategory.APPROVAL_REQUIRED.value, db,
            )
            row.last_notified_at = clock.now


# ---------------------------------------------------------------- exception approval steps


async def _exception_steps(db: AsyncSession, clock: _Clock) -> None:
    rows = (
        await db.execute(
            select(ExceptionApproval, ExceptionRequest)
            .join(ExceptionRequest, ExceptionRequest.id == ExceptionApproval.exception_request_id)
            .where(
                ExceptionApproval.status == ExceptionRequestStatus.PENDING.value,
                ExceptionRequest.status == ExceptionRequestStatus.PENDING.value,
            )
        )
    ).all()
    if not rows:
        return
    cfg = await ws.get_workflow_config(db)
    for step, req in rows:
        claim = await db.get(ClaimDraft, req.claim_id) if req.claim_id else None
        travel = await db.get(TravelRequest, req.travel_request_id) if req.travel_request_id else None
        if claim is None and travel is None:
            continue
        ref = (claim.claim_reference or f"CLM-{claim.id}") if claim else f"TR-{travel.id:04d}"
        # A claim's one request listing all its exceptions reads as "the exception request on CLM-…".
        what = (
            f"exception request on {ref}"
            if ws.is_itemized_claim_request(req)
            else f"exception '{ws._exception_label(req)}' on {ref}"
        )
        role_label = ws._humanize_token(step.required_role)

        async def recipients_for(role: str, _claim=claim, _travel=travel) -> list[int]:
            if _claim is not None:
                return await ws._user_ids_for_exception_role(_claim, role, db)
            return await ws._user_ids_for_exception_role_for_travel(_travel, role, db)

        if step.sla_deadline_at is None:  # activated before SLAs were tracked
            hours = ws.exception_step_sla_hours(
                cfg, req.exception_types or [req.exception_type], step.required_role, req.route_key
            )
            step.sla_deadline_at = add_working_hours(clock.now, hours, clock.holidays)
        if step.last_notified_at is None:
            step.last_notified_at = clock.now

        if clock.breached(step.sla_deadline_at, step.sla_breached_at):
            step.sla_breached_at = clock.now
            steps = (
                await db.execute(
                    select(ExceptionApproval)
                    .where(ExceptionApproval.exception_request_id == req.id)
                    .order_by(ExceptionApproval.id)
                )
            ).scalars().all()
            later = [s for s in steps if s.id > step.id and s.status == "AWAITING"]
            if later:
                nxt = later[0]
                step.status = ws.STAGE_STATUS_SLA_SKIPPED
                step.acted_at = clock.now
                step.comment = SKIP_NOTE
                await _send(
                    await recipients_for(step.required_role), f"SLA breached: {ref}",
                    f"You didn't act on the {what} within its SLA, so it has been passed on to the next approver "
                    f"({ws._humanize_token(nxt.required_role)}).",
                    "/hr/exceptions", NotificationCategory.SLA_BREACH.value, db,
                )
                await ws.start_exception_step(nxt, req, cfg, db)
                note = _passed_on_note(role_label)
                if claim is not None:
                    await ws._notify_exception_approver(claim, req, nxt.required_role, db, note)
                else:
                    await ws._notify_travel_exception_approver(travel, req, nxt.required_role, db, note)
            else:
                await _send(
                    await recipients_for(step.required_role), f"SLA breached: {ref}",
                    f"The {what} is past its SLA and is still waiting on you. You'll be reminded every "
                    f"{REMINDER_EVERY_WORKING_HOURS} working hours until you act.",
                    "/hr/exceptions", NotificationCategory.SLA_BREACH.value, db,
                )
                step.last_notified_at = clock.now
            continue

        if clock.reminder_due(step.last_notified_at):
            await _send(
                await recipients_for(step.required_role), f"Reminder: {ref} has an exception waiting for you",
                f"The {what} is still waiting on you. SLA deadline: {_deadline_text(step.sla_deadline_at)}.",
                "/hr/exceptions", NotificationCategory.EXCEPTION.value, db,
            )
            step.last_notified_at = clock.now


async def monitor_slas(db: AsyncSession) -> None:
    clock = _Clock(now_ist(), await load_holidays(db))
    await _claim_stages(db, clock)
    await _travel_stages(db, clock)
    await _relocation_stages(db, clock)
    await _exception_steps(db, clock)
    await db.commit()


if __name__ == "__main__":
    async def main():
        async with AsyncSessionLocal() as db:
            await monitor_slas(db)

    asyncio.run(main())
