from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.policy import (
    CityGroup,
    CityGroupType,
    ExpenseLimit,
    ImpactLevel,
    PolicyStatus,
    PolicyVersion,
)


async def resolve_city_group(city_name: str, travel_date: date, db: AsyncSession) -> CityGroupType:
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
    return city_group.group_type if city_group else CityGroupType.C


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
    result = await db.execute(
        select(PolicyVersion).where(
            and_(
                PolicyVersion.status == PolicyStatus.ACTIVE,
                PolicyVersion.effective_from <= travel_date,
                (PolicyVersion.effective_to.is_(None)) | (PolicyVersion.effective_to >= travel_date),
            )
        )
    )
    policy = result.scalar_one_or_none()
    if policy is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active policy version for travel date")
    return policy


async def get_expense_limits(
    policy_version_id: int, impact_level_id: int, city_group: CityGroupType, db: AsyncSession
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
    limit_fields = [
        "impact_level_id",
        "city_group",
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

    diffs: dict[str, list[dict]] = {"impact_levels": [], "expense_limits": []}
    levels_v1_by_code = {level.level_code: level for level in v1_levels}
    levels_v2_by_code = {level.level_code: level for level in v2_levels}
    for key in sorted(set(levels_v1_by_code) | set(levels_v2_by_code)):
        previous = levels_v1_by_code.get(key)
        current = levels_v2_by_code.get(key)
        before = _model_dict(previous, impact_fields) if previous else None
        after = _model_dict(current, impact_fields) if current else None
        if before == after:
            continue
        if before is None:
            change_type = "added"
        elif after is None:
            change_type = "removed"
        else:
            change_type = "modified"
        diffs["impact_levels"].append(
            {"key": key, "change_type": change_type, "before": before, "after": after}
        )

    limits_v1_by_key = {(limit.impact_level_id, limit.city_group): limit for limit in v1_limits}
    limits_v2_by_key = {(limit.impact_level_id, limit.city_group): limit for limit in v2_limits}
    for key in sorted(
        set(limits_v1_by_key) | set(limits_v2_by_key), key=lambda item: (item[0], item[1].value)
    ):
        previous = limits_v1_by_key.get(key)
        current = limits_v2_by_key.get(key)
        before = _model_dict(previous, limit_fields) if previous else None
        after = _model_dict(current, limit_fields) if current else None
        if before == after:
            continue
        if before is None:
            change_type = "added"
        elif after is None:
            change_type = "removed"
        else:
            change_type = "modified"
        diffs["expense_limits"].append(
            {"key": list(key), "change_type": change_type, "before": before, "after": after}
        )
    return diffs


async def enforce_immutability(version_id: int, db: AsyncSession) -> None:
    version = await db.get(PolicyVersion, version_id)
    if version and version.effective_from <= date.today():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Policy versions are immutable once their effective_from date is reached",
        )
