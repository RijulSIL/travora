"""The company's departments: one list, kept on the company profile (Company profile page), used by
User management, the CSV import, the Approval matrix's department heads and Team budgets.

A person's department is still stored as text on their employee record. Names are matched ignoring
capitals and extra spaces ("human resources " is Human Resources). Renaming a department moves the
people in it, its department head and its team budget to the new name. A department can't be taken
off the list while active people are still in it (see removal_blocked_message); its head and team
budget don't block that, they just stay set up under the old name until they're changed."""

import re

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import DepartmentBudget
from app.models.claim_workflow import WorkflowConfigRow
from app.models.employee import Employee
from app.models.expense_category import CompanyProfile

# What the app offered before the list was configurable (and what a company starts with).
DEFAULT_DEPARTMENTS = [
    "Engineering",
    "Human Resources",
    "Finance",
    "Sales",
    "Marketing",
    "Operations",
    "IT",
    "Legal",
    "Customer Support",
    "Design",
    "Product",
]


def department_key(name: str | None) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def clean_department_name(name: str | None) -> str:
    return re.sub(r"\s+", " ", (name or "").strip())


def match_department(name: str | None, departments: list[str]) -> str | None:
    """The department on the list this name means (ignoring capitals and spaces), or None."""
    wanted = department_key(name)
    if not wanted:
        return None
    return next((d for d in departments if department_key(d) == wanted), None)


async def get_departments(db: AsyncSession) -> list[str]:
    profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    if profile is None or profile.departments is None:
        return list(DEFAULT_DEPARTMENTS)
    return list(profile.departments)


async def department_counts(db: AsyncSession) -> dict[str, int]:
    """Active people per department, as stored on their records."""
    rows = (
        await db.execute(
            select(Employee.department, func.count())
            .where(Employee.department.isnot(None), Employee.is_active.is_(True))
            .group_by(Employee.department)
        )
    ).all()
    counts: dict[str, int] = {}
    for name, count in rows:
        if name and name.strip():
            counts[name.strip()] = counts.get(name.strip(), 0) + int(count)
    return counts


async def departments_with_people(db: AsyncSession) -> list[str]:
    """The list, plus any department someone is still in that has been taken off it — so pages
    that configure per-department things (heads, budgets) can still reach them."""
    departments = await get_departments(db)
    extra = sorted(d for d in await department_counts(db) if match_department(d, departments) is None)
    return departments + extra


def validate_department_list(names: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: dict[str, str] = {}
    for raw in names:
        name = clean_department_name(raw)
        if not name:
            continue
        if len(name) > 255:
            raise HTTPException(status_code=422, detail=f"Department name is too long: {name[:40]}…")
        key = department_key(name)
        if key in seen:
            raise HTTPException(status_code=422, detail=f"There's already a department called {seen[key]}")
        seen[key] = name
        cleaned.append(name)
    return cleaned


def _people(count: int) -> str:
    return f"{count} {'person' if count == 1 else 'people'}"


async def removal_blocked_message(old_list: list[str], new_list: list[str], db: AsyncSession) -> str | None:
    """Why the new list can't be saved: departments taken off it that active people are still in
    (counted after any renames have moved people), or None. Mentions a head or team budget such a
    department also has, since those stay behind under its name too."""
    counts = await department_counts(db)
    blocked: list[tuple[str, int]] = []
    for name in old_list:
        if match_department(name, new_list) is not None:
            continue
        people = sum(n for dept, n in counts.items() if department_key(dept) == department_key(name))
        if people:
            blocked.append((name, people))
    if not blocked:
        return None

    row = await db.get(WorkflowConfigRow, 1)
    config = row.config_json if row is not None and isinstance(row.config_json, dict) else {}
    heads = config.get("department_heads") or {}
    budgets = (await db.execute(select(DepartmentBudget.department))).scalars().all()
    parts = [f"{name} still has {_people(people)}" for name, people in blocked]
    message = f"{' and '.join(parts)} — move them to another department first"
    for name, _ in blocked:
        extras = []
        if any(department_key(head) == department_key(name) for head in heads):
            extras.append("a department head")
        if any(department_key(budget) == department_key(name) for budget in budgets):
            extras.append("a team budget")
        if extras:
            message += f". {name} also has {' and '.join(extras)}, which you may want to change too"
    return message


async def rename_department(old: str, new: str, db: AsyncSession) -> None:
    """Moves everything that refers to the old name — people, the department head setting and the
    team budget — to the new one. Doesn't commit."""
    old_key = department_key(old)
    await db.execute(
        update(Employee)
        .where(func.lower(func.trim(Employee.department)) == old_key)
        .values(department=new)
        .execution_options(synchronize_session=False)
    )
    row = await db.get(WorkflowConfigRow, 1)
    if row is not None and isinstance(row.config_json, dict):
        heads = row.config_json.get("department_heads") or {}
        renamed = {(new if department_key(name) == old_key else name): entry for name, entry in heads.items()}
        if renamed != heads:
            row.config_json = {**row.config_json, "department_heads": renamed}
    budgets = (await db.execute(select(DepartmentBudget))).scalars().all()
    taken = {department_key(b.department) for b in budgets}
    for budget in budgets:
        if department_key(budget.department) == old_key:
            if department_key(new) in taken and department_key(new) != old_key:
                raise HTTPException(status_code=422, detail=f"{new} already has a team budget")
            budget.department = new
