from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holiday import CompanyHoliday


async def list_holidays(db: AsyncSession) -> list[CompanyHoliday]:
    result = await db.execute(select(CompanyHoliday).order_by(CompanyHoliday.holiday_date))
    return list(result.scalars().all())


async def create_holiday(holiday_date, name: str, db: AsyncSession) -> CompanyHoliday:
    row = CompanyHoliday(holiday_date=holiday_date, name=name.strip())
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise
    await db.refresh(row)
    return row


async def update_holiday(
    holiday_id: int, holiday_date, name: str | None, db: AsyncSession
) -> CompanyHoliday | None:
    row = await db.get(CompanyHoliday, holiday_id)
    if row is None:
        return None
    if holiday_date is not None:
        row.holiday_date = holiday_date
    if name is not None:
        row.name = name.strip()
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise
    await db.refresh(row)
    return row


async def delete_holiday(holiday_id: int, db: AsyncSession) -> bool:
    row = await db.get(CompanyHoliday, holiday_id)
    if row is None:
        return False
    await db.delete(row)
    await db.commit()
    return True
