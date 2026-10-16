"""Working-time arithmetic for approval SLAs.

An SLA clock runs all 24 hours of a working day and stops completely on Saturdays, Sundays and
company holidays (Admin -> Holiday Calendar, the CompanyHoliday table). So a 48-hour SLA that
starts Friday 15:00 ends Tuesday 15:00, and one started on a Saturday starts counting at
Monday 00:00. All datetimes are naive IST, same as app.core.timezone.now_ist().
"""

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import now_ist
from app.models.holiday import CompanyHoliday


async def load_holidays(db: AsyncSession) -> set[date]:
    return set((await db.execute(select(CompanyHoliday.holiday_date))).scalars().all())


def is_working_day(day: date, holidays: set[date]) -> bool:
    return day.weekday() < 5 and day not in holidays


def _next_working_midnight(moment: datetime, holidays: set[date]) -> datetime:
    day = moment.date() + timedelta(days=1)
    while not is_working_day(day, holidays):
        day += timedelta(days=1)
    return datetime.combine(day, datetime.min.time())


def add_working_hours(start: datetime, hours: float, holidays: set[date]) -> datetime:
    """`start` plus `hours` of working time (non-working days don't count)."""
    current = start
    if not is_working_day(current.date(), holidays):
        current = _next_working_midnight(current, holidays)
    remaining = timedelta(hours=hours)
    while True:
        day_end = datetime.combine(current.date() + timedelta(days=1), datetime.min.time())
        available = day_end - current
        if remaining <= available:
            return current + remaining
        remaining -= available
        current = _next_working_midnight(current, holidays)


async def sla_deadline(db: AsyncSession, hours: float, start: datetime | None = None) -> datetime:
    """When an SLA of `hours` working hours, starting now (or at `start`), runs out."""
    return add_working_hours(start or now_ist(), hours, await load_holidays(db))
