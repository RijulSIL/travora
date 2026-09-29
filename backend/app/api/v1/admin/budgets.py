from fastapi import APIRouter, Depends

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_mfa, require_role
from app.models.auth import Role
from app.schemas.budget import (
    BudgetConfigIn,
    BudgetConfigOut,
    BudgetOptionsOut,
    DepartmentBudgetIn,
    DepartmentBudgetOut,
    ManagerBudgetIn,
    ManagerBudgetOut,
)
from app.services.budget_service import (
    delete_department_budget,
    delete_manager_budget,
    is_budgets_enabled,
    list_department_budgets,
    list_department_options,
    list_manager_budgets,
    list_manager_options,
    set_budgets_enabled,
    upsert_department_budget,
    upsert_manager_budget,
)

router = APIRouter(prefix="/admin/budgets", tags=["admin-budgets"])

# Restricted to IT_ADMIN only for now — unlike the rest of the policy/config admin screens,
# which HRBP_HR/FINANCE/GROUP_HEAD_HR/PAYROLL can also read or edit via configure_policy /
# view_admin_readonly. allow_delegate=False: budgets are config, not a "current queue" item.
_READ = [Depends(require_role(Role.IT_ADMIN, allow_delegate=False))]
_WRITE = [Depends(require_role(Role.IT_ADMIN, allow_delegate=False)), Depends(require_mfa)]


@router.get("/config", response_model=BudgetConfigOut, dependencies=_READ)
async def get_budget_config(db=Depends(get_db)) -> dict:
    return {"enabled": await is_budgets_enabled(db)}


@router.put("/config", response_model=BudgetConfigOut, dependencies=_WRITE)
async def update_budget_config(
    payload: BudgetConfigIn, claims: dict = Depends(get_current_claims), db=Depends(get_db)
) -> dict:
    enabled = await set_budgets_enabled(payload.enabled, int(claims["sub"]), db)
    return {"enabled": enabled}


@router.get("/options", response_model=BudgetOptionsOut, dependencies=_READ)
async def get_budget_options(db=Depends(get_db)) -> dict:
    return {
        "departments": await list_department_options(db),
        "managers": await list_manager_options(db),
    }


@router.get("/departments", response_model=list[DepartmentBudgetOut], dependencies=_READ)
async def get_department_budgets(db=Depends(get_db)):
    return await list_department_budgets(db)


@router.post("/departments", response_model=DepartmentBudgetOut, dependencies=_WRITE)
async def create_department_budget(
    payload: DepartmentBudgetIn, claims: dict = Depends(get_current_claims), db=Depends(get_db)
):
    return await upsert_department_budget(payload.department, payload.monthly_amount, int(claims["sub"]), db)


@router.delete("/departments/{budget_id}", dependencies=_WRITE)
async def remove_department_budget(budget_id: int, db=Depends(get_db)) -> dict[str, str]:
    await delete_department_budget(budget_id, db)
    return {"status": "deleted"}


@router.get("/managers", response_model=list[ManagerBudgetOut], dependencies=_READ)
async def get_manager_budgets(db=Depends(get_db)):
    return await list_manager_budgets(db)


@router.post("/managers", response_model=ManagerBudgetOut, dependencies=_WRITE)
async def create_manager_budget(
    payload: ManagerBudgetIn, claims: dict = Depends(get_current_claims), db=Depends(get_db)
):
    row = await upsert_manager_budget(payload.manager_user_id, payload.monthly_amount, int(claims["sub"]), db)
    managers = await list_manager_budgets(db)
    return next(m for m in managers if m["id"] == row.id)


@router.delete("/managers/{budget_id}", dependencies=_WRITE)
async def remove_manager_budget(budget_id: int, db=Depends(get_db)) -> dict[str, str]:
    await delete_manager_budget(budget_id, db)
    return {"status": "deleted"}
