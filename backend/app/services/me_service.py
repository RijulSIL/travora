"""Aggregate /me payload: profile, queue badges, and policy hints."""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Role, User
from app.models.claim_workflow import ExceptionApproval, ExceptionRequest, ExceptionRequestStatus
from app.models.employee import Employee
from app.models.expense_category import CompanyProfile
from app.models.policy import CityGroupType, ExpenseLimit, ImpactLevel, PolicyStatus, PolicyVersion
from app.schemas.me import ApproverScopeOut, MeOut
from app.services.claim_submission_rules import parse_auto_approve_threshold
from app.services.workflow_service import get_approver_scope, get_workflow_config, list_pending_approvals


def _fmt_inr(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


async def build_me_profile(user_id: int, db: AsyncSession) -> MeOut:
    user = await db.get(User, user_id)
    if user is None:
        raise ValueError("User not found")

    emp = await db.get(Employee, user.employee_id) if user.employee_id else None
    reporting_manager_name: str | None = None
    if emp and emp.reporting_manager_id:
        mgr_user = (
            await db.execute(select(User).where(User.employee_id == emp.reporting_manager_id))
        ).scalars().first()
        reporting_manager_name = mgr_user.full_name if mgr_user else None

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

    from app.core.rbac import DELEGATABLE_PERMISSIONS, _active_delegator_roles
    from app.services.delegation_service import is_delegation_enabled

    delegated_roles = await _active_delegator_roles(user_id, db)
    delegation_feature_enabled = await is_delegation_enabled(db)
    can_create_delegation = bool(DELEGATABLE_PERMISSIONS.get(user.role, set()))

    pending_rows = await list_pending_approvals(user_id, db)
    pending_claims_count = len(pending_rows)

    # Stage-aware, not role-gated here — the normal-flow approval chain is admin-configurable
    # and can route a stage to any role (HRBP, Finance, CEO, ...), not just Reporting Manager,
    # so this must be checked for every user the same way pending_claims_count already is above,
    # rather than pre-filtering by role and silently returning 0 for a valid approver.
    from app.services.travel_request_service import list_pending_travel_requests_for_approver
    travel_reqs = await list_pending_travel_requests_for_approver(user_id, db)
    pending_travel_requests_count = len(travel_reqs)

    pending_count = pending_claims_count + pending_travel_requests_count

    travel_desk_queue_count = 0
    if user.role == Role.HRBP_HR or Role.HRBP_HR in delegated_roles:
        from app.services.travel_request_service import count_pending_travel_requests_for_desk
        travel_desk_queue_count = await count_pending_travel_requests_for_desk(db)

    pq_total_str: str | None = None
    if (user.role == Role.FINANCE or Role.FINANCE in delegated_roles) and pending_rows:
        total = sum(Decimal(str(row.get("amount", "0") or "0")) for row in pending_rows)
        pq_total_str = _fmt_inr(total.quantize(Decimal("0.01")))

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

    auto_approve_threshold_str: str | None = None
    org_auto_approve_ceiling_str: str | None = None
    if user.role == Role.REPORTING_MANAGER:
        org_auto_approve_ceiling_str = _fmt_inr(parse_auto_approve_threshold(workflow_cfg))
        if user.auto_approve_threshold is not None:
            auto_approve_threshold_str = _fmt_inr(user.auto_approve_threshold)

    is_acting_delegate = bool(delegated_roles)

    # Union of the user's own role and every role they're currently delegate-covering — a
    # delegate should see nav/page content for whatever the role(s) they're covering are
    # actually wired into, same as the nav injection already does for DELEGATABLE_NAV_BY_ROLE.
    own_scope = await get_approver_scope(user.role, db)
    scope_categories = set(own_scope["claim_categories"])
    scope_travel_request = own_scope["travel_request"]
    scope_exceptions = set(own_scope["exceptions"])
    for delegated_role in delegated_roles:
        d_scope = await get_approver_scope(delegated_role, db)
        scope_categories |= set(d_scope["claim_categories"])
        scope_travel_request = scope_travel_request or d_scope["travel_request"]
        scope_exceptions |= set(d_scope["exceptions"])
    approver_scope = ApproverScopeOut(
        claims=bool(scope_categories),
        claim_categories=sorted(scope_categories),
        travel_request=scope_travel_request,
        exceptions=sorted(scope_exceptions),
    )

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
        reporting_manager_name=reporting_manager_name,
        pending_approvals_count=pending_count,
        pending_claims_count=pending_claims_count,
        pending_travel_requests_count=pending_travel_requests_count,
        hotel_cap_group_a=hotel_cap_group_a,
        payment_queue_total_inr=pq_total_str,
        exception_requests_pending_count=int(exc_pending),
        travel_desk_queue_count=travel_desk_queue_count,
        company_office_locations=company_office_locations,
        workflow_submission_deadline_mode=deadline_mode,
        workflow_submission_max_working_days=max_days,
        is_acting_delegate=is_acting_delegate,
        delegated_roles=[r.value for r in delegated_roles],
        delegation_feature_enabled=delegation_feature_enabled,
        can_create_delegation=can_create_delegation,
        auto_approve_threshold=auto_approve_threshold_str,
        org_auto_approve_ceiling=org_auto_approve_ceiling_str,
        approver_scope=approver_scope,
    )
