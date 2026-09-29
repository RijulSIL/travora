from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import DelegationConfig


async def _get_config_row(db: AsyncSession) -> DelegationConfig:
    row = await db.get(DelegationConfig, 1)
    if row is None:
        row = DelegationConfig(id=1, enabled=True)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


async def is_delegation_enabled(db: AsyncSession) -> bool:
    row = await _get_config_row(db)
    return bool(row.enabled)


async def set_delegation_enabled(enabled: bool, user_id: int | None, db: AsyncSession) -> bool:
    row = await _get_config_row(db)
    row.enabled = enabled
    row.updated_by_user_id = user_id
    await db.commit()
    return bool(row.enabled)
