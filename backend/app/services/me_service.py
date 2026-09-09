"""Aggregate /me payload: profile, queue badges, and policy hints."""

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Delegation, Role, User
from app.models.claim_workflow import ExceptionApproval, ExceptionRequest, ExceptionRequestStatus
from app.models.employee import Employee
from app.models.expense_category import CompanyProfile
from app.models.policy import CityGroupType, ExpenseLimit, ImpactLevel, PolicyStatus, PolicyVersion
from app.models.reimbursement import ClaimDraft, ClaimStatus
from app.schemas.me import MeOut
from app.services.workflow_service import get_workflow_config, list_pending_approvals


def _fmt_inr(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _days_since_oldest(created_dates: list[datetime | None]) -> int:
    valid = [d for d in created_dates if d is not None]
    if not valid:
        return 0
    oldest = min(valid)
    if oldest.tzinfo:
        oldest = oldest.astimezone(UTC).replace(tzinfo=None)
    delta = datetime.utcnow() - oldest
    return max(0, delta.days)


async def build_me_profile(user_id: int, db: AsyncSession) -> MeOut:
    user = await db.get(User, user_id)
    if user is None:
        raise ValueError("User not found")

    emp = await db.get(Employee, user.employee_id) if user.employee_id else None
    impact: ImpactLevel | None = None
    if emp and emp.impact_level_id:
        impact = await db.get(ImpactLevel, emp.impact_level_id)

    active_policy = (
        await db.execute(select(PolicyVersion).where(PolicyVersion.status == PolicyStatus.ACTIVE))
    ).scalar_one_or_none()

    hotel_cap_group_a: str | None = None
    if active_policy and emp and emp.impact_level_id:
        limit_row = (
            await db.execute(
                select(ExpenseLimit)
                .where(
                    ExpenseLimit.policy_version_id == active_policy.id,
                    ExpenseLimit.impact_level_id == emp.impact_level_id,
                    ExpenseLimit.city_group == CityGroupType.A,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if limit_row and limit_row.hotel_cap is not None:
            hotel_cap_group_a = _fmt_inr(limit_row.hotel_cap)

    pending_rows = await list_pending_approvals(user_id, db)
    pending_count = len(pending_rows)

    if user.role == Role.REPORTING_MANAGER:
        from app.services.travel_request_service import list_pending_travel_requests_for_manager
        travel_reqs = await list_pending_travel_requests_for_manager(user_id, db)
        pending_count += len(travel_reqs)

    pq_total_str: str | None = None
    if user.role == Role.FINANCE and pending_rows:
        total = sum(Decimal(str(row.get("amount", "0") or "0")) for row in pending_rows)
        pq_total_str = _fmt_inr(total.quantize(Decimal("0.01")))

    # Outstanding advances: advance_received on user's claims until paid.
    adv_q = (
        await db.execute(
            select(ClaimDraft).where(
                ClaimDraft.employee_user_id == user_id,
                ClaimDraft.advance_received > 0,
                ClaimDraft.status != ClaimStatus.PAID,
            )
        )
    ).scalars().all()
    adv_sum = (
        sum((c.advance_received or Decimal(0)) for c in adv_q)
        if adv_q
        else Decimal("0")
    )
    advance_days = _days_since_oldest([c.created_at for c in adv_q]) if adv_q else 0

    from app.services.workflow_service import _can_user_act_on_exception
    all_pending_exc = (
        await db.execute(
            select(ExceptionRequest)
            .where(ExceptionRequest.status == ExceptionRequestStatus.PENDING.value)
        )
    ).scalars().all()

    exc_pending = 0
    for exc in all_pending_exc:
        approvals = (
            await db.execute(
                select(ExceptionApproval).where(ExceptionApproval.exception_request_id == exc.id)
            )
        ).scalars().all()
        if await _can_user_act_on_exception(user, exc, approvals, db):
            exc_pending += 1

    company_profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    company_office_locations: list[str] = list(company_profile.office_locations or []) if company_profile else []

    workflow_cfg = await get_workflow_config(db)
    submission_cfg = workflow_cfg.get("submission", {})
    deadline_mode = submission_cfg.get("deadline_mode", "hard_block")
    max_days = int(submission_cfg.get("max_working_days_after_return", 5))

    now = datetime.utcnow()
    delegation_q = select(Delegation.id).where(
        Delegation.delegatee_id == user_id,
        Delegation.is_active,
        Delegation.start_date <= now,
        Delegation.end_date >= now
    )
    is_acting_delegate = (await db.execute(delegation_q)).first() is not None

    return MeOut(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role.value,
        employee_id=user.employee_id or None,
        impact_level_code=impact.level_code if impact else None,
        impact_level_name=impact.level_name if impact else None,
        department=emp.department if emp else None,
        office_location=emp.office_location if emp else None,
        reporting_manager_id=emp.reporting_manager_id if emp else None,
        pending_approvals_count=pending_count,
        outstanding_advance_amount=_fmt_inr(adv_sum),
        outstanding_advance_days=advance_days,
        hotel_cap_group_a=hotel_cap_group_a,
        payment_queue_total_inr=pq_total_str,
        exception_requests_pending_count=int(exc_pending),
        advance_deductions_flagged_count=0,
        company_office_locations=company_office_locations,
        workflow_submission_deadline_mode=deadline_mode,
        workflow_submission_max_working_days=max_days,
        is_acting_delegate=is_acting_delegate,
    )
