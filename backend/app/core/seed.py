import asyncio
from datetime import date

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.expense_category import ExpenseCategory
from app.models.policy import (
    AirClass,
    AirEligibility,
    CityGroup,
    CityGroupType,
    ExpenseLimit,
    ImpactLevel,
    PolicyStatus,
    PolicyVersion,
)


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        existing = await db.scalar(select(PolicyVersion.id).limit(1))
        if existing:
            return

        version = PolicyVersion(
            id=1,
            version_number="1.0",
            effective_from=date(2026, 4, 27),
            effective_to=None,
            status=PolicyStatus.ACTIVE,
        )
        db.add(version)
        await db.flush()

        levels = [
            (1, "L1", "CXO / Director", AirEligibility.YES, AirClass.BUSINESS, False, 28, 10),
            (2, "L2", "VP / Senior Director", AirEligibility.YES, AirClass.PREMIUM_ECONOMY, False, 26, 9),
            (3, "L3A", "Senior Manager", AirEligibility.CONDITIONAL, AirClass.ECONOMY, False, 24, 8),
            (4, "L3B", "Manager", AirEligibility.CONDITIONAL, AirClass.ECONOMY, False, 23, 8),
            (5, "L4A", "Deputy Manager", AirEligibility.CONDITIONAL, AirClass.ECONOMY, False, 22, 7),
            (6, "L4B", "Assistant Manager", AirEligibility.CONDITIONAL, AirClass.ECONOMY, False, 21, 7),
            (7, "L4C", "Senior Executive", AirEligibility.NO, None, False, 20, 6),
            (8, "L5A", "Executive", AirEligibility.NO, None, False, 19, 6),
            (9, "L5B", "Senior Associate", AirEligibility.NO, None, True, 18, 5),
            (10, "L6A", "Associate I", AirEligibility.NO, None, True, 18, 5),
            (11, "L6B", "Associate II", AirEligibility.NO, None, True, 17, 5),
            (12, "L6C", "Associate III", AirEligibility.NO, None, True, 17, 5),
            (13, "L6D", "Trainee", AirEligibility.NO, None, True, 16, 4),
        ]
        for level_id, code, name, air, air_class, twin, rate_4w, rate_2w in levels:
            db.add(
                ImpactLevel(
                    id=level_id,
                    level_code=code,
                    level_name=name,
                    air_eligibility=air,
                    air_class_allowed=air_class,
                    air_eligibility_conditions={"approval_required": air == AirEligibility.CONDITIONAL},
                    train_classes_allowed=["1A", "2A", "3A", "CC"]
                    if level_id <= 4
                    else ["3A", "CC", "SL"],
                    local_conveyance_modes=[
                        "Own Vehicle 4W",
                        "Own Vehicle 2W",
                        "Hired Taxi",
                        "Auto/Cab",
                    ],
                    vehicle_rate_4w=rate_4w,
                    vehicle_rate_2w=rate_2w,
                    twin_sharing_mandatory=twin,
                    policy_version_id=1,
                )
            )

        for city, group in [
            ("Bengaluru", CityGroupType.A),
            ("Chennai", CityGroupType.A),
            ("Delhi NCR", CityGroupType.A),
            ("Hyderabad", CityGroupType.A),
            ("Kolkata", CityGroupType.A),
            ("Mumbai", CityGroupType.A),
            ("Pune", CityGroupType.A),
            ("Ahmedabad", CityGroupType.A),
            ("Chandigarh", CityGroupType.B),
            ("Coimbatore", CityGroupType.B),
            ("Indore", CityGroupType.B),
            ("Jaipur", CityGroupType.B),
            ("Kochi", CityGroupType.B),
            ("Lucknow", CityGroupType.B),
        ]:
            db.add(
                CityGroup(
                    city_name=city,
                    group_type=group,
                    effective_from=date(2026, 4, 27),
                )
            )

        group_multiplier = {CityGroupType.A: 1.0, CityGroupType.B: 0.8, CityGroupType.C: 0.65}
        base_by_level = {
            1: 12000,
            2: 10000,
            3: 8500,
            4: 7500,
            5: 6500,
            6: 5500,
            7: 4500,
            8: 3500,
            9: 3200,
            10: 2800,
            11: 2500,
            12: 2300,
            13: 2200,
        }
        for level_id, base in base_by_level.items():
            for group, multiplier in group_multiplier.items():
                db.add(
                    ExpenseLimit(
                        policy_version_id=1,
                        impact_level_id=level_id,
                        city_group=group,
                        hotel_cap=int(base * multiplier),
                        hotel_is_hard_block=level_id >= 5,
                        food_cap=int(base * multiplier * 0.35),
                        food_is_hard_block=False,
                        incidental_cap=int(base * multiplier * 0.15),
                        incidental_is_hard_block=False,
                        day_visit_cap=int(base * multiplier * 0.25),
                        day_visit_is_hard_block=level_id >= 10,
                    )
                )

        categories = [
            ("Air Travel", None, True, True, ["Business Class", "First Class"]),
            ("Train Travel", None, True, False, []),
            ("Bus Travel", None, True, False, []),
            ("Local Conveyance", None, False, False, []),
            ("Cab/Taxi", 4, True, True, []),
            ("Uber", 4, True, True, []),
            ("Auto", 4, True, False, []),
            ("Metro", 4, True, False, []),
            ("Personal Vehicle", 4, False, False, []),
            ("Hotel/Accommodation", None, True, True, []),
            ("Food & Meals", None, True, False, ["Alcohol", "Cigarettes"]),
            ("Breakfast", 11, True, False, ["Alcohol", "Cigarettes"]),
            ("Lunch", 11, True, False, ["Alcohol", "Cigarettes"]),
            ("Dinner", 11, True, False, ["Alcohol", "Cigarettes"]),
            ("Incidental Expenses", None, False, False, []),
            ("Communication", None, True, True, []),
            ("Day Visit Expenses", None, False, False, []),
        ]
        for index, row in enumerate(categories, start=1):
            db.add(
                ExpenseCategory(
                    id=index,
                    name=row[0],
                    parent_category_id=row[1],
                    bill_mandatory=row[2],
                    gst_invoice_required=row[3],
                    blacklisted_items=row[4],
                    policy_version_id=1,
                )
            )

        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())
