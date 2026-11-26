from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expense_category import ExpenseCategory
from app.models.policy import ImpactLevel

# Travel policy Table 1: nobody flies Business or First; Premium Economy is for Level 1 only.
AIR_TRAVEL_CLASS_BLACKLIST = ("Business Class", "First Class")
PREMIUM_ECONOMY = "Premium Economy"
PREMIUM_ECONOMY_LEVELS = {"L1"}


async def _resolve_impact_level_code(
    db: AsyncSession, impact_level_id: int | None, impact_level_code: str | None
) -> str | None:
    if impact_level_code:
        return impact_level_code.strip().upper()
    if impact_level_id is None:
        return None
    impact_level = await db.get(ImpactLevel, impact_level_id)
    return impact_level.level_code.upper() if impact_level else None


async def check_blacklist(
    description: str,
    category_ids: list[int],
    db: AsyncSession,
    impact_level_id: int | None = None,
    impact_level_code: str | None = None,
) -> tuple[bool, list[str]]:
    normalized = description.lower()
    resolved_level_code = await _resolve_impact_level_code(db, impact_level_id, impact_level_code)
    result = await db.execute(select(ExpenseCategory).where(ExpenseCategory.id.in_(category_ids)))
    categories = result.scalars().all()
    matched: list[str] = []
    for category in categories:
        if category.name == "Air Travel":
            for item in AIR_TRAVEL_CLASS_BLACKLIST:
                if item.lower() in normalized:
                    matched.append(item)
            if resolved_level_code not in PREMIUM_ECONOMY_LEVELS and PREMIUM_ECONOMY.lower() in normalized:
                matched.append(PREMIUM_ECONOMY)
        for item in category.blacklisted_items or []:
            if item.lower() in normalized:
                matched.append(item)
    return bool(matched), list(dict.fromkeys(matched))
