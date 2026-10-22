"""Aggregate /me payload: profile, queue badges, and policy hints."""

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import today_ist
from app.models.auth import Role, User
from app.models.claim_workflow import ExceptionApproval, ExceptionRequest, ExceptionRequestStatus
from app.models.employee import Employee
from app.models.expense_category import CompanyProfile
from app.models.policy import CityGroupTier, ExpenseLimit, ImpactLevel, PolicyVersion
from app.schemas.me import ApproverScopeOut, CityTierLimitsOut, MeOut, MyPolicyLimitsOut, PolicyCapOut
from app.services.advance_service import get_outstanding_advance
from app.services.claim_submission_rules import parse_auto_approve_threshold
from app.services.policy_engine import get_active_policy_version, get_expense_limits
from app.services.workflow_service import (
    department_head_scope,
    get_approver_scope,
    get_workflow_config,
    list_pending_approvals,
)


def _fmt_inr(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _fmt_optional_inr(value: Decimal | None) -> str | None:
    return _fmt_inr(value) if value is not None else None


async def _current_policy_and_level(
    own_level: ImpactLevel | None, db: AsyncSession
) -> tuple[PolicyVersion | None, ImpactLevel | None]:
    """The policy version governing today (by effective-date window, same as claims use — not
    by status) and the employee's impact level *within that version*. ImpactLevel rows are
    cloned per version with new ids, so the employee's own impact_level_id can point at an
    older version's row; matching on level_code keeps this correct across versions."""
    if own_level is None:
        return None, None
    try:
        policy = await get_active_policy_version(today_ist(), db)
    except HTTPException:
        return None, None
    level = (
        await db.execute(
            select(ImpactLevel).where(
                ImpactLevel.policy_version_id == policy.id,
                func.upper(ImpactLevel.level_code) == own_level.level_code.upper(),
            )
        )
    ).scalars().first()
    return policy, level


async def build_my_policy_limits(user_id: int, db: AsyncSession) -> MyPolicyLimitsOut:
    user = await db.get(User, user_id)
    emp = await db.get(Employee, user.employee_id) if user and user.employee_id else None
    own_level = await db.get(ImpactLevel, emp.impact_level_id) if emp and emp.impact_level_id else None
    policy, level = await _current_policy_and_level(own_level, db)
    if policy is None or level is None:
        return MyPolicyLimitsOut(
            impact_level_code=own_level.level_code if own_level else None,
            impact_level_name=own_level.level_name if own_level else None,
        )

    tiers = {t.code: t for t in (await db.execute(select(CityGroupTier).order_by(CityGroupTier.id))).scalars()}
    tier_order = list(tiers)
    rows = (
        await db.execute(
            select(ExpenseLimit).where(
                ExpenseLimit.policy_version_id == policy.id, ExpenseLimit.impact_level_id == level.id
            )
        )
    ).scalars().all()
    # Deprecated tiers no longer apply to any city, so their caps would only mislead.
    rows = [r for r in rows if not (tiers.get(r.city_group) and tiers[r.city_group].is_deprecated)]
    rows.sort(key=lambda r: tier_order.index(r.city_group) if r.city_group in tiers else len(tier_order))

    def cap(row: ExpenseLimit, field: str) -> PolicyCapOut:
        return PolicyCapOut(
            amount=_fmt_optional_inr(getattr(row, f"{field}_cap")),
            is_hard_block=bool(getattr(row, f"{field}_is_hard_block")),
        )

    return MyPolicyLimitsOut(
        has_policy=True,
        policy_version=policy.version_number,
        effective_from=policy.effective_from,
        effective_to=policy.effective_to,
        impact_level_code=level.level_code,
        impact_level_name=level.level_name,
        air_eligibility=level.air_eligibility.value if level.air_eligibility else None,
        air_class_allowed=level.air_class_allowed.value if level.air_class_allowed else None,
        air_eligibility_conditions=level.air_eligibility_conditions,
        train_classes_allowed=list(level.train_classes_allowed or []),
        local_conveyance_modes=list(level.local_conveyance_modes or []),
        vehicle_rate_4w=_fmt_optional_inr(level.vehicle_rate_4w),
        vehicle_rate_2w=_fmt_optional_inr(level.vehicle_rate_2w),
        twin_sharing_mandatory=bool(level.twin_sharing_mandatory),
        city_limits=[
            CityTierLimitsOut(
                city_group=r.city_group,
                city_group_name=tiers[r.city_group].display_name if r.city_group in tiers else r.city_group,
                is_default=bool(tiers[r.city_group].is_default) if r.city_group in tiers else False,
                hotel=cap(r, "hotel"),
                food=cap(r, "food"),
                incidental=cap(r, "incidental"),
                day_visit=cap(r, "day_visit"),
            )
            for r in rows
        ],
    )


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

    hotel_cap_group_a: str | None = None
    policy, current_level = await _current_policy_and_level(impact, db)
    if policy and current_level:
        limit_row = await get_expense_limits(policy.id, current_level.id, "A", db)
        if limit_row and limit_row.hotel_cap is not None:
            hotel_cap_group_a = _fmt_inr(limit_row.hotel_cap)

    from app.core.rbac import _active_delegator_roles, acts_as_manager, get_extra_permissions, is_manager
    from app.services.delegation_service import is_delegation_enabled
    from app.services.permission_config_service import (
        get_effective_delegatable_permissions,
        get_effective_permission_matrix,
    )

    delegated_roles = await _active_delegator_roles(user_id, db)
    delegation_feature_enabled = await is_delegation_enabled(db)
    delegatable_matrix = await get_effective_delegatable_permissions(db)
    can_create_delegation = bool(delegatable_matrix.get(user.role, set()))

    pending_rows = await list_pending_approvals(user_id, db)
    pending_claims_count = len(pending_rows)

    # Stage-aware, not role-gated here — the normal-flow approval chain is admin-configurable
    # and can route a stage to any role (HRBP, Finance, CEO, ...), not just Reporting Manager,
    # so this must be checked for every user the same way pending_claims_count already is above,
    # rather than pre-filtering by role and silently returning 0 for a valid approver.
    from app.services.travel_request_service import list_pending_travel_requests_for_approver
    travel_reqs = await list_pending_travel_requests_for_approver(user_id, db)
    pending_travel_requests_count = len(travel_reqs)

    # Relocation requests waiting on this user (Relocation Approval workflow — stage roles decide,
    # e.g. any Recruiter), same stage-aware check as above.
    from app.services.relocation_service import list_pending_for_approver as list_pending_relocations
    pending_relocation_count = len(await list_pending_relocations(user_id, db))

    pending_count = pending_claims_count + pending_travel_requests_count + pending_relocation_count

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

    # The Manager setting, on top of whatever role they have (always on for the CEO).
    user_is_a_manager = is_manager(user)

    auto_approve_threshold_str: str | None = None
    org_auto_approve_ceiling_str: str | None = None
    if user_is_a_manager:
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
    scope_relocation = own_scope["relocation"]
    for delegated_role in delegated_roles:
        d_scope = await get_approver_scope(delegated_role, db)
        scope_categories |= set(d_scope["claim_categories"])
        scope_travel_request = scope_travel_request or d_scope["travel_request"]
        scope_exceptions |= set(d_scope["exceptions"])
        scope_relocation = scope_relocation or d_scope["relocation"]
    # Being a manager (or covering for one) adds the manager step's routes.
    if user.role != Role.REPORTING_MANAGER and await acts_as_manager(user_id, db):
        m_scope = await get_approver_scope(Role.REPORTING_MANAGER, db)
        scope_categories |= set(m_scope["claim_categories"])
        scope_travel_request = scope_travel_request or m_scope["travel_request"]
        scope_exceptions |= set(m_scope["exceptions"])
    # A department head approves their department's items whatever their own role's routes are.
    head_scope = await department_head_scope(user, db)
    scope_categories |= set(head_scope["claim_categories"])
    scope_travel_request = scope_travel_request or head_scope["travel_request"]
    scope_exceptions |= set(head_scope["exceptions"])
    approver_scope = ApproverScopeOut(
        claims=bool(scope_categories),
        claim_categories=sorted(scope_categories),
        travel_request=scope_travel_request,
        exceptions=sorted(scope_exceptions),
        relocation=scope_relocation,
    )

    # The single source the frontend trusts for "can I see/use this page" — replaces its own
    # previously-hardcoded copy of PERMISSION_MATRIX/DELEGATABLE_PERMISSIONS (see
    # permission_config_service.py). Already delegation-merged, same as approver_scope above.
    effective_matrix = await get_effective_permission_matrix(db)
    own_permissions = set(effective_matrix.get(user.role, set()))
    permissions = sorted(own_permissions | await get_extra_permissions(user_id, db))

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
        pending_relocation_count=pending_relocation_count,
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
        can_create_delegation=can_create_delegation
        or (user_is_a_manager and bool(delegatable_matrix.get(Role.REPORTING_MANAGER, set()))),
        is_manager=user_is_a_manager,
        must_change_password=bool(user.must_change_password),
        auto_approve_threshold=auto_approve_threshold_str,
        org_auto_approve_ceiling=org_auto_approve_ceiling_str,
        approver_scope=approver_scope,
        permissions=permissions,
        outstanding_advance=_fmt_inr(await get_outstanding_advance(user.id, db)),
    )
