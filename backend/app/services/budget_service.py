from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Role, User
from app.models.budget import BudgetConfig, DepartmentBudget, ManagerBudget
from app.models.employee import Employee


async def _get_config_row(db: AsyncSession) -> BudgetConfig:
    row = await db.get(BudgetConfig, 1)
    if row is None:
        row = BudgetConfig(id=1, enabled=False)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


async def is_budgets_enabled(db: AsyncSession) -> bool:
    row = await _get_config_row(db)
    return bool(row.enabled)


async def set_budgets_enabled(enabled: bool, user_id: int | None, db: AsyncSession) -> bool:
    row = await _get_config_row(db)
    row.enabled = enabled
    row.updated_by_user_id = user_id
    await db.commit()
    return bool(row.enabled)


async def list_department_budgets(db: AsyncSession) -> list[DepartmentBudget]:
    result = await db.execute(select(DepartmentBudget).order_by(DepartmentBudget.department))
    return list(result.scalars().all())


async def upsert_department_budget(
    department: str, monthly_amount: Decimal, user_id: int | None, db: AsyncSession
) -> DepartmentBudget:
    existing = (
        await db.execute(select(DepartmentBudget).where(DepartmentBudget.department == department))
    ).scalar_one_or_none()
    if existing:
        existing.monthly_amount = monthly_amount
        existing.updated_by_user_id = user_id
        await db.commit()
        await db.refresh(existing)
        return existing
    row = DepartmentBudget(department=department, monthly_amount=monthly_amount, updated_by_user_id=user_id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def delete_department_budget(budget_id: int, db: AsyncSession) -> None:
    row = await db.get(DepartmentBudget, budget_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department budget not found")
    await db.delete(row)
    await db.commit()


async def list_manager_budgets(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(ManagerBudget, User, Employee)
        .join(User, User.id == ManagerBudget.manager_user_id)
        .outerjoin(Employee, Employee.employee_id == User.employee_id)
        .order_by(User.full_name)
    )
    rows = []
    for budget, user, emp in result.all():
        rows.append(
            {
                "id": budget.id,
                "manager_user_id": budget.manager_user_id,
                "manager_name": user.full_name,
                "manager_email": user.email,
                "department": emp.department if emp else None,
                "monthly_amount": budget.monthly_amount,
            }
        )
    return rows


async def upsert_manager_budget(
    manager_user_id: int, monthly_amount: Decimal, user_id: int | None, db: AsyncSession
) -> ManagerBudget:
    manager = await db.get(User, manager_user_id)
    if manager is None or manager.role != Role.REPORTING_MANAGER:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reporting manager not found")

    existing = (
        await db.execute(select(ManagerBudget).where(ManagerBudget.manager_user_id == manager_user_id))
    ).scalar_one_or_none()
    if existing:
        existing.monthly_amount = monthly_amount
        existing.updated_by_user_id = user_id
        await db.commit()
        await db.refresh(existing)
        return existing
    row = ManagerBudget(manager_user_id=manager_user_id, monthly_amount=monthly_amount, updated_by_user_id=user_id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def delete_manager_budget(budget_id: int, db: AsyncSession) -> None:
    row = await db.get(ManagerBudget, budget_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manager budget not found")
    await db.delete(row)
    await db.commit()


async def list_department_options(db: AsyncSession) -> list[str]:
    result = await db.execute(
        select(Employee.department).where(Employee.department.is_not(None)).distinct().order_by(Employee.department)
    )
    return [d for d in result.scalars().all() if d]


async def list_manager_options(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(User, Employee)
        .outerjoin(Employee, Employee.employee_id == User.employee_id)
        .where(User.role == Role.REPORTING_MANAGER)
        .order_by(User.full_name)
    )
    return [
        {
            "user_id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "department": emp.department if emp else None,
        }
        for user, emp in result.all()
    ]


async def get_effective_budget(manager_user_id: int, db: AsyncSession) -> tuple[Decimal | None, str | None]:
    """Manager-level override wins; falls back to the manager's own department default."""
    manager_budget = (
        await db.execute(select(ManagerBudget).where(ManagerBudget.manager_user_id == manager_user_id))
    ).scalar_one_or_none()
    if manager_budget is not None:
        return manager_budget.monthly_amount, "manager"

    manager = await db.get(User, manager_user_id)
    if manager is None or not manager.employee_id:
        return None, None
    emp = await db.get(Employee, manager.employee_id)
    if emp is None or not emp.department:
        return None, None

    dept_budget = (
        await db.execute(select(DepartmentBudget).where(DepartmentBudget.department == emp.department))
    ).scalar_one_or_none()
    if dept_budget is not None:
        return dept_budget.monthly_amount, "department"

    return None, None
