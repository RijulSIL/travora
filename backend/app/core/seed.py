import asyncio
from decimal import Decimal

from sqlalchemy import select

from app.core import policy_defaults as P
from app.core.database import AsyncSessionLocal
from app.models.expense_category import ExpenseCategory
from app.models.policy import (
    AirClass,
    AirEligibility,
    CityGroup,
    CityGroupTier,
    ExpenseLimit,
    ImpactLevel,
    PolicyStatus,
    PolicyVersion,
)


def _money(value: int | str | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


async def seed() -> None:
    """A fresh install's first policy version: the travel policy in app.core.policy_defaults."""
    async with AsyncSessionLocal() as db:
        existing = await db.scalar(select(PolicyVersion.id).limit(1))
        if existing:
            return

        version = PolicyVersion(
            id=1,
            version_number="1.0",
            effective_from=P.POLICY_EFFECTIVE_FROM,
            effective_to=None,
            status=PolicyStatus.ACTIVE,
        )
        db.add(version)
        await db.flush()

        level_ids: dict[str, int] = {}
        for level_id, (code, name, air, air_class, trains, modes, twin) in enumerate(P.IMPACT_LEVELS, start=1):
            level_ids[code] = level_id
            db.add(
                ImpactLevel(
                    id=level_id,
                    level_code=code,
                    level_name=name,
                    air_eligibility=AirEligibility(air),
                    air_class_allowed=AirClass(air_class) if air_class else None,
                    air_eligibility_conditions={"approval_required": air == AirEligibility.CONDITIONAL.value},
                    train_classes_allowed=list(trains),
                    local_conveyance_modes=list(modes),
                    vehicle_rate_4w=Decimal(P.VEHICLE_RATE_4W),
                    vehicle_rate_2w=Decimal(P.VEHICLE_RATE_2W),
                    twin_sharing_mandatory=twin,
                    policy_version_id=1,
                )
            )

        for code, display_name, is_default in P.CITY_GROUP_TIERS:
            db.add(CityGroupTier(code=code, display_name=display_name, is_default=is_default))

        for city, group in P.city_group_rows():
            db.add(CityGroup(city_name=city, group_type=group, effective_from=P.POLICY_EFFECTIVE_FROM))

        for row in P.expense_limit_rows():
            db.add(
                ExpenseLimit(
                    policy_version_id=1,
                    impact_level_id=level_ids[row["level_code"]],
                    city_group=row["city_group"],
                    hotel_cap=_money(row["hotel_cap"]),
                    hotel_is_hard_block=row["hotel_is_hard_block"],
                    food_cap=_money(row["food_cap"]),
                    food_is_hard_block=row["food_is_hard_block"],
                    incidental_cap=_money(row["incidental_cap"]),
                    incidental_is_hard_block=row["incidental_is_hard_block"],
                    day_visit_cap=_money(row["day_visit_cap"]),
                    day_visit_is_hard_block=row["day_visit_is_hard_block"],
                )
            )

        category_ids: dict[str, int] = {}
        for index, (name, parent, bill, gst, blacklist, notes) in enumerate(P.EXPENSE_CATEGORIES, start=1):
            category_ids[name] = index
            db.add(
                ExpenseCategory(
                    id=index,
                    name=name,
                    parent_category_id=category_ids[parent] if parent else None,
                    bill_mandatory=bill,
                    gst_invoice_required=gst,
                    blacklisted_items=list(blacklist),
                    notes=notes,
                    policy_version_id=1,
                )
            )

        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())
