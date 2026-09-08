from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expense_category import ExpenseCategory
from app.models.policy import ImpactLevel

AIR_TRAVEL_CLASS_BLACKLIST = ("Business Class", "First Class")
AIR_TRAVEL_CLASS_BLACKLIST_NORMALIZED = {
    item.lower() for item in AIR_TRAVEL_CLASS_BLACKLIST
}


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
        if category.name == "Air Travel" and resolved_level_code != "L1":
            for item in AIR_TRAVEL_CLASS_BLACKLIST:
                if item.lower() in normalized:
                    matched.append(item)
        for item in category.blacklisted_items or []:
            normalized_item = item.lower()
            if (
                category.name == "Air Travel"
                and resolved_level_code == "L1"
                and normalized_item in AIR_TRAVEL_CLASS_BLACKLIST_NORMALIZED
            ):
                continue
            if normalized_item in normalized:
                matched.append(item)
    return bool(matched), list(dict.fromkeys(matched))
