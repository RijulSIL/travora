"""The company's office locations (company_profile.office_locations): the list people pick from
in User management and the CSV import, and the starting office on travel claims. Names match
ignoring capitals and extra spaces, like departments (see department_service)."""

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.services.department_service import clean_department_name, department_key

office_key = department_key
clean_office_name = clean_department_name


def match_office(name: str | None, offices: list[str]) -> str | None:
    wanted = office_key(name)
    if not wanted:
        return None
    return next((o for o in offices if office_key(o) == wanted), None)


async def office_counts(db: AsyncSession) -> dict[str, int]:
    """Active people per office, as stored on their records — including offices not on the list."""
    rows = (
        await db.execute(
            select(Employee.office_location, func.count())
            .where(Employee.office_location.isnot(None), Employee.is_active.is_(True))
            .group_by(Employee.office_location)
        )
    ).all()
    counts: dict[str, int] = {}
    for name, count in rows:
        if name and name.strip():
            counts[name.strip()] = counts.get(name.strip(), 0) + int(count)
    return counts


def validate_office_list(names: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: dict[str, str] = {}
    for raw in names:
        name = clean_office_name(raw)
        if not name:
            continue
        if len(name) > 255:
            raise HTTPException(status_code=422, detail=f"Office name is too long: {name[:40]}…")
        key = office_key(name)
        if key in seen:
            raise HTTPException(status_code=422, detail=f"There's already an office called {seen[key]}")
        seen[key] = name
        cleaned.append(name)
    return cleaned


async def rename_office(old: str, new: str, db: AsyncSession) -> None:
    """Moves the people in the old office to the new name. Claims keep the office they were made
    from. Doesn't commit."""
    await db.execute(
        update(Employee)
        .where(func.lower(func.trim(Employee.office_location)) == office_key(old))
        .values(office_location=new)
        .execution_options(synchronize_session=False)
    )
