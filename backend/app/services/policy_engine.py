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
    normalized_city = city_name.strip().lower()
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


def normalize_city_name(city_name: str) -> str:
    return city_name.strip().lower()


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


def enforce_city_group_immutability(city_group: CityGroup) -> None:
    """City groups have no policy_version_id of their own; a row becomes immutable
    once its own effective_from date is reached, mirroring PolicyVersion's rule."""
    if city_group.effective_from <= date.today():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="City group classifications are immutable once their effective_from date is reached",
        )
