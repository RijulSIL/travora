from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import today_ist
from app.models.expense_category import ExpenseCategory
from app.models.policy import (
    CityGroup,
    CityGroupTier,
    ExpenseLimit,
    ImpactLevel,
    PolicyStatus,
    PolicyVersion,
)


async def resolve_city_group(city_name: str, travel_date: date, db: AsyncSession) -> str:
    """Returns a CityGroupTier `code` (never the tier's numeric id) — ExpenseLimit.city_group and
    ClaimDraft.destination_city_group both store this same code as a plain string, so whatever
    this returns matches them directly with no further lookup needed."""
    # City names are stored tidied (clean_city_name), so the typed name is tidied the same way.
    normalized_city = normalize_city_name(city_name)
    result = await db.execute(
        select(CityGroup).where(
            and_(
                func.lower(func.trim(CityGroup.city_name)) == normalized_city,
                CityGroup.effective_from <= travel_date,
                (CityGroup.effective_to.is_(None)) | (CityGroup.effective_to > travel_date),
            )
        ).order_by(CityGroup.effective_from.desc(), CityGroup.id.desc())
    )
    city_group = result.scalars().first()
    if city_group:
        return city_group.group_type
    # No classification matches this city — fall back to whichever tier is marked default
    # (replaces the old hardcoded "default to group C"; see CityGroupTier's docstring).
    default_tier = (await db.execute(select(CityGroupTier).where(CityGroupTier.is_default.is_(True)))).scalars().first()
    if default_tier is None:
        raise HTTPException(status_code=500, detail="No default city-group tier is configured")
    return default_tier.code


def clean_city_name(city_name: str) -> str:
    """A city name as stored: trimmed, with runs of spaces inside it collapsed to one."""
    return " ".join((city_name or "").split())


def normalize_city_name(city_name: str) -> str:
    """The key two city names are compared by — 'Qa  Town', ' qa town ' and 'QA TOWN' are one city."""
    return clean_city_name(city_name).lower()


def date_ranges_overlap(
    start_a: date, end_a: date | None, start_b: date, end_b: date | None
) -> bool:
    effective_end_a = end_a or date.max
    effective_end_b = end_b or date.max
    return start_a <= effective_end_b and start_b <= effective_end_a


async def validate_city_group_overlap(
    city_name: str,
    effective_from: date,
    effective_to: date | None,
    db: AsyncSession,
    excluding_id: int | None = None,
) -> None:
    normalized_city = normalize_city_name(city_name)
    rows = (await db.execute(select(CityGroup))).scalars().all()
    for row in rows:
        if excluding_id is not None and row.id == excluding_id:
            continue
        if normalize_city_name(row.city_name) != normalized_city:
            continue
        if date_ranges_overlap(
            effective_from,
            effective_to,
            row.effective_from,
            row.effective_to,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Overlapping city group effective window for the same city",
            )


async def get_active_policy_version(travel_date: date, db: AsyncSession) -> PolicyVersion:
    """Deliberately NOT filtered by status == ACTIVE. A fully-approved version can have an
    effective_from in the future (HRBP schedules it, see reschedule_policy_version) — while
    it's "ACTIVE" in the admin-UI/workflow sense but its date hasn't arrived yet, the row that
    should actually govern a given travel_date is whichever ARCHIVED-or-ACTIVE version's
    [effective_from, effective_to) window contains it. This also means a scheduled version
    takes over automatically the moment its date arrives — no cron/background job needed,
    exactly like resolve_city_group's date-range resolution above, which this mirrors.

    A version stays in effect until a newer one starts: if no window covers travel_date (e.g.
    the latest version carries an end date but nothing has been scheduled after it), the most
    recent version that had started by then still governs it."""
    result = await db.execute(
        select(PolicyVersion)
        .where(
            and_(
                PolicyVersion.effective_from.is_not(None),
                PolicyVersion.effective_from <= travel_date,
                (PolicyVersion.effective_to.is_(None)) | (PolicyVersion.effective_to >= travel_date),
            )
        )
        .order_by(PolicyVersion.effective_from.desc(), PolicyVersion.id.desc())
    )
    policy = result.scalars().first()
    if policy is None:
        policy = (
            await db.execute(
                select(PolicyVersion)
                .where(
                    PolicyVersion.effective_from.is_not(None),
                    PolicyVersion.effective_from <= travel_date,
                    PolicyVersion.status.in_((PolicyStatus.ACTIVE, PolicyStatus.ARCHIVED)),
                )
                .order_by(PolicyVersion.effective_from.desc(), PolicyVersion.id.desc())
            )
        ).scalars().first()
    if policy is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active policy version for travel date")
    return policy


async def archive_superseded_policy_versions(db: AsyncSession, today: date | None = None) -> list[PolicyVersion]:
    """A version is archived only once a newer version has actually taken effect — not when the
    newer one is approved or scheduled. Run from the hourly monitor (and before scheduling), so
    the stored status catches up on the day the handover happens. Doesn't commit."""
    today = today or today_ist()
    started = (
        await db.execute(
            select(PolicyVersion).where(
                PolicyVersion.status.in_((PolicyStatus.ACTIVE, PolicyStatus.ARCHIVED)),
                PolicyVersion.effective_from.is_not(None),
                PolicyVersion.effective_from <= today,
            )
        )
    ).scalars().all()
    archived = []
    for version in started:
        replaced = any(other.effective_from > version.effective_from for other in started if other.id != version.id)
        if version.status == PolicyStatus.ACTIVE and replaced:
            version.status = PolicyStatus.ARCHIVED
            archived.append(version)
    return archived


async def archive_replaced_policy_versions_job(db: AsyncSession) -> None:
    """Hourly monitor entry point: archives replaced versions, logs each one and commits."""
    from app.services.audit_service import log_event

    for version in await archive_superseded_policy_versions(db):
        await log_event(
            entity_type="policy_version",
            entity_id=str(version.id),
            action="policy_version_archived",
            actor_id=None,
            old={"status": PolicyStatus.ACTIVE.value},
            new={"status": PolicyStatus.ARCHIVED.value, "reason": "a newer version took effect"},
            db=db,
        )
    await db.commit()


async def get_expense_limits(
    policy_version_id: int, impact_level_id: int, city_group: str, db: AsyncSession
) -> ExpenseLimit | None:
    result = await db.execute(
        select(ExpenseLimit).where(
            ExpenseLimit.policy_version_id == policy_version_id,
            ExpenseLimit.impact_level_id == impact_level_id,
            ExpenseLimit.city_group == city_group,
        )
    )
    return result.scalar_one_or_none()


def check_cap(limit_row: ExpenseLimit, field: str, amount: Decimal, override_cap: Decimal | None = None) -> tuple[str, bool]:
    cap = override_cap if override_cap is not None else getattr(limit_row, f"{field}_cap")
    is_hard_block = getattr(limit_row, f"{field}_is_hard_block")
    if cap is None or amount <= cap:
        return ("OK", False)
    if is_hard_block:
        return ("HARD_BLOCK", True)
    return ("SOFT_FLAG", True)


def _model_dict(model: Any, fields: list[str]) -> dict[str, Any]:
    return {field: getattr(model, field) for field in fields}


async def diff_policy_versions(v1_id: int, v2_id: int, db: AsyncSession) -> dict:
    v1 = await db.get(PolicyVersion, v1_id)
    v2 = await db.get(PolicyVersion, v2_id)
    if v1 is None or v2 is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or both policy versions not found")

    impact_fields = [
        "level_code",
        "level_name",
        "air_eligibility",
        "air_class_allowed",
        "air_eligibility_conditions",
        "train_classes_allowed",
        "local_conveyance_modes",
        "vehicle_rate_4w",
        "vehicle_rate_2w",
        "twin_sharing_mandatory",
        "is_deprecated",
    ]
    # Matched by level code + city group, not impact_level_id: every version has its own copy of
    # each level (new ids), so comparing ids would report every cap as removed and re-added.
    limit_fields = [
        "hotel_cap",
        "hotel_is_hard_block",
        "food_cap",
        "food_is_hard_block",
        "incidental_cap",
        "incidental_is_hard_block",
        "day_visit_cap",
        "day_visit_is_hard_block",
    ]

    v1_levels = (await db.execute(select(ImpactLevel).where(ImpactLevel.policy_version_id == v1_id))).scalars().all()
    v2_levels = (await db.execute(select(ImpactLevel).where(ImpactLevel.policy_version_id == v2_id))).scalars().all()
    v1_limits = (await db.execute(select(ExpenseLimit).where(ExpenseLimit.policy_version_id == v1_id))).scalars().all()
    v2_limits = (await db.execute(select(ExpenseLimit).where(ExpenseLimit.policy_version_id == v2_id))).scalars().all()
    v1_categories = (
        await db.execute(select(ExpenseCategory).where(ExpenseCategory.policy_version_id == v1_id))
    ).scalars().all()
    v2_categories = (
        await db.execute(select(ExpenseCategory).where(ExpenseCategory.policy_version_id == v2_id))
    ).scalars().all()

    def compare(rows_v1: dict, rows_v2: dict, fields, out: list[dict], key_out=lambda key: key) -> None:
        for key in sorted(set(rows_v1) | set(rows_v2)):
            previous, current = rows_v1.get(key), rows_v2.get(key)
            before = fields(previous) if previous is not None else None
            after = fields(current) if current is not None else None
            if before == after:
                continue
            change_type = "added" if before is None else "removed" if after is None else "modified"
            out.append({"key": key_out(key), "change_type": change_type, "before": before, "after": after})

    diffs: dict[str, list[dict]] = {"impact_levels": [], "expense_limits": [], "expense_categories": []}
    compare(
        {level.level_code: level for level in v1_levels},
        {level.level_code: level for level in v2_levels},
        lambda level: _model_dict(level, impact_fields),
        diffs["impact_levels"],
    )

    def limits_by_key(limits, levels) -> dict:
        code_by_id = {getattr(level, "id", None): level.level_code for level in levels}
        return {
            (code_by_id.get(limit.impact_level_id, f"#{limit.impact_level_id}"), limit.city_group): limit
            for limit in limits
        }

    compare(
        limits_by_key(v1_limits, v1_levels),
        limits_by_key(v2_limits, v2_levels),
        lambda limit: _model_dict(limit, limit_fields),
        diffs["expense_limits"],
        key_out=list,
    )

    def categories_by_name(categories) -> dict:
        name_by_id = {category.id: category.name for category in categories}
        return {
            category.name: {
                "parent": name_by_id.get(category.parent_category_id),
                "bill_mandatory": category.bill_mandatory,
                "gst_invoice_required": category.gst_invoice_required,
                "blacklisted_items": sorted(category.blacklisted_items or []),
                "notes": category.notes,
                "is_active": category.is_active,
            }
            for category in categories
        }

    compare(
        categories_by_name(v1_categories),
        categories_by_name(v2_categories),
        lambda row: row,
        diffs["expense_categories"],
    )
    return diffs


async def enforce_immutability(version_id: int, db: AsyncSession) -> None:
    version = await db.get(PolicyVersion, version_id)
    # effective_from is null for the entire DRAFT/PENDING_HRBP lifetime (assigned only at
    # approval, see PolicyVersion's docstring) — nothing to lock yet.
    if version and version.effective_from is not None and version.effective_from <= date.today():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Policy versions are immutable once their effective_from date is reached",
        )


async def can_act_on_policy_step(user, required_role: str, db: AsyncSession) -> bool:
    """Is it `user`'s turn at a Policy Approval step with this role? A policy version has no
    employee behind it, so a Reporting Manager step means anyone with the Manager setting (the
    generic role check treats "no employee" as anyone at all)."""
    from app.core.rbac import is_manager
    from app.models.auth import Role
    from app.services.workflow_service import _user_matches_required_role

    if required_role == Role.REPORTING_MANAGER.value:
        return is_manager(user)
    return await _user_matches_required_role(user, required_role, None, db)


async def policy_step_user_ids(required_role: str, db: AsyncSession) -> list[int]:
    """Who gets told a policy version is waiting on a step with this role."""
    from app.models.auth import Role, User

    query = select(User.id).where(User.is_active.is_(True))
    if required_role == Role.REPORTING_MANAGER.value:
        query = query.where(User.is_manager.is_(True))
    else:
        try:
            query = query.where(User.role == Role(required_role))
        except ValueError:
            return []
    return list((await db.execute(query)).scalars().all())


async def notify_policy_step(version, required_role: str, db: AsyncSession) -> None:
    """Tell the people at this Policy Approval step that a version is waiting for them (not
    whoever created it — they can't approve their own version)."""
    from app.models.claim_workflow import NotificationCategory
    from app.services.notification_service import create_notification

    for user_id in await policy_step_user_ids(required_role, db):
        if user_id == version.created_by:
            continue
        await create_notification(
            user_id=user_id,
            title=f"Policy {version.version_number} is waiting for your approval",
            body=f"Policy version {version.version_number} has been submitted. Review it and approve or send it back.",
            link="/admin/policy-versions",
            category=NotificationCategory.APPROVAL_REQUIRED.value,
            db=db,
        )


# A Policy Approval step only the version's creator could act on — they hold the step's role,
# nobody else active does, and they haven't delegated it — is skipped (same rule as a claimant
# who is the only approver at a claim stage, see workflow_service._claimant_is_only_approver).
# The last step is never skipped: it waits for someone else to get the role or a delegation.
POLICY_STEP_SKIPPED_OWN = "SKIPPED_OWN"
POLICY_SELF_SKIP_NOTE = (
    "Skipped — whoever created this version can't approve it and is the only approver for this step."
)


def is_policy_version_creator(user, version) -> bool:
    """Nobody approves or sends back a policy version they created themselves."""
    return user is not None and version.created_by is not None and user.id == version.created_by


async def creator_is_only_policy_approver(version, required_role: str, db: AsyncSession) -> bool:
    from app.core.timezone import now_ist
    from app.models.auth import Delegation, Role
    from app.services.delegation_service import is_delegation_enabled

    if version.created_by is None:
        return False
    user_ids = await policy_step_user_ids(required_role, db)
    if user_ids != [version.created_by]:
        return False
    # A delegate covering the creator's role can approve in their place (a manager step has no
    # delegation — anyone with the Manager setting is the pool).
    if required_role != Role.REPORTING_MANAGER.value and await is_delegation_enabled(db):
        now = now_ist()
        delegated = (
            await db.execute(
                select(func.count(Delegation.id)).where(
                    Delegation.delegator_id == version.created_by,
                    Delegation.delegatee_id != version.created_by,
                    Delegation.is_active,
                    Delegation.start_date <= now,
                    Delegation.end_date >= now,
                )
            )
        ).scalar_one()
        if delegated:
            return False
    return True


async def open_policy_step(version, approvals: list, index: int, db: AsyncSession):
    """Make approvals[index] the PENDING step and tell its approvers — or, when only the creator
    could act on it, mark it skipped and open the next one instead. Returns the step opened."""
    from app.core.timezone import now_ist
    from app.services.audit_service import log_event

    while index < len(approvals) - 1 and await creator_is_only_policy_approver(
        version, approvals[index].required_role, db
    ):
        step = approvals[index]
        step.status = POLICY_STEP_SKIPPED_OWN
        step.acted_at = now_ist()
        step.comment = POLICY_SELF_SKIP_NOTE
        await log_event(
            entity_type="policy_version",
            entity_id=str(version.id),
            action="policy_version_stage_skipped_own",
            actor_id=None,
            old={"stage_role": step.required_role},
            new={"next_stage_role": approvals[index + 1].required_role, "comment": POLICY_SELF_SKIP_NOTE},
            db=db,
        )
        index += 1
    step = approvals[index]
    step.status = "PENDING"
    await notify_policy_step(version, step.required_role, db)
    return step


async def policy_versions_awaiting(user, db: AsyncSession) -> list[int]:
    """Ids of policy versions whose current approval step is this user's (directly, or via a
    delegation) — the Policy Approval chain decides who approves, not policy-edit rights."""
    from app.models.policy import PolicyApproval

    pending = (
        await db.execute(select(PolicyVersion).where(PolicyVersion.status == PolicyStatus.PENDING_HRBP))
    ).scalars().all()
    awaiting = []
    for version in pending:
        if is_policy_version_creator(user, version):
            continue
        step = (
            await db.execute(
                select(PolicyApproval)
                .where(PolicyApproval.policy_version_id == version.id, PolicyApproval.status == "PENDING")
                .order_by(PolicyApproval.id)
            )
        ).scalars().first()
        if step is not None and await can_act_on_policy_step(user, step.required_role, db):
            awaiting.append(version.id)
    return awaiting


async def enforce_draft_contents(version_ids: list[int | None], db: AsyncSession) -> None:
    """A version's impact levels and expense limits can only change while it's a DRAFT — once
    submitted, the approvers are approving exactly what they saw (and an approved or scheduled
    version must stay as approved). Every version touched (a row's own, and any it's being moved
    to) must be a draft."""
    for version_id in {v for v in version_ids if v is not None}:
        version = await db.get(PolicyVersion, version_id)
        if version is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy version not found")
        if version.status != PolicyStatus.DRAFT:
            state = {
                PolicyStatus.PENDING_HRBP: "waiting for approval",
                PolicyStatus.ACTIVE: "approved",
                PolicyStatus.ARCHIVED: "archived",
            }.get(version.status, version.status.value.lower())
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Policy {version.version_number} is {state}: its levels and limits can only be changed "
                "while it's a draft",
            )


def enforce_city_group_immutability(city_group: CityGroup) -> None:
    """City groups have no policy_version_id of their own; a row becomes immutable
    once its own effective_from date is reached, mirroring PolicyVersion's rule."""
    if city_group.effective_from <= date.today():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="City group classifications are immutable once their effective_from date is reached",
        )
