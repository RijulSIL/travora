from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import require_any_permission, require_mfa, require_permission
from app.models.expense_category import ExpenseCategory
from app.models.policy import PolicyStatus, PolicyVersion
from app.schemas.common import BlacklistCheckRequest, ExpenseCategoryIn
from app.services.policy_engine import enforce_immutability, get_active_policy_version
from app.services.expense_category_service import check_blacklist

router = APIRouter(prefix="/admin/expense-categories", tags=["admin-expense-categories"])

_READ_EXPENSE_CATEGORIES = [Depends(require_any_permission("configure_policy", "view_admin_readonly"))]
_WRITE_EXPENSE_CATEGORIES = [Depends(require_permission("configure_policy")), Depends(require_mfa)]
_EXPENSE_CATEGORY_TOOLS = [
    Depends(require_any_permission("submit_claim", "configure_policy", "view_admin_readonly")),
]


def _category_to_dict(category: ExpenseCategory) -> dict:
    return {
        "id": category.id,
        "name": category.name,
        "parent_category_id": category.parent_category_id,
        "bill_mandatory": category.bill_mandatory,
        "gst_invoice_required": category.gst_invoice_required,
        "blacklisted_items": category.blacklisted_items or [],
        "is_active": category.is_active,
        "policy_version_id": category.policy_version_id,
        "children": [],
    }


async def _validate_policy_target(policy_version_id: int, db: AsyncSession) -> None:
    policy_version = await db.get(PolicyVersion, policy_version_id)
    if policy_version is None:
        raise HTTPException(status_code=400, detail="policy_version_id does not exist")
    if policy_version.status != PolicyStatus.DRAFT:
        raise HTTPException(
            status_code=400,
            detail="Expense categories can only be edited for draft policy versions",
        )
    await enforce_immutability(policy_version_id, db)


async def _validate_parent_hierarchy(
    *,
    parent_category_id: int | None,
    policy_version_id: int,
    db: AsyncSession,
    category_id: int | None = None,
) -> None:
    if parent_category_id is None:
        return
    if category_id is not None and parent_category_id == category_id:
        raise HTTPException(status_code=400, detail="Category cannot be its own parent")

    parent = await db.get(ExpenseCategory, parent_category_id)
    if parent is None:
        raise HTTPException(status_code=400, detail="parent_category_id does not exist")
    if parent.policy_version_id != policy_version_id:
        raise HTTPException(
            status_code=400,
            detail="Parent and child categories must belong to the same policy version",
        )

    seen: set[int] = set()
    current = parent
    while current is not None:
        if current.id in seen:
            raise HTTPException(status_code=400, detail="Category hierarchy contains a cycle")
        seen.add(current.id)
        if current.policy_version_id != policy_version_id:
            raise HTTPException(
                status_code=400,
                detail="Category hierarchy must stay within one policy version",
            )
        if category_id is not None and current.id == category_id:
            raise HTTPException(status_code=400, detail="Category hierarchy cannot contain cycles")
        if current.parent_category_id is None:
            break
        current = await db.get(ExpenseCategory, current.parent_category_id)


async def _validate_child_version_isolation(
    *, category_id: int, policy_version_id: int, db: AsyncSession
) -> None:
    children = (
        await db.execute(
            select(ExpenseCategory).where(ExpenseCategory.parent_category_id == category_id)
        )
    ).scalars().all()
    if any(child.policy_version_id != policy_version_id for child in children):
        raise HTTPException(
            status_code=400,
            detail="Child categories must belong to the same policy version",
        )


@router.get("", dependencies=_READ_EXPENSE_CATEGORIES)
async def list_expense_categories(
    policy_version_id: int | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    resolved_policy_version_id = policy_version_id
    if resolved_policy_version_id is None:
        active_version = await get_active_policy_version(date.today(), db)
        resolved_policy_version_id = active_version.id
    categories = (
        await db.execute(
            select(ExpenseCategory).where(
                ExpenseCategory.is_active.is_(True),
                ExpenseCategory.policy_version_id == resolved_policy_version_id,
            )
        )
    ).scalars().all()
    by_id = {category.id: _category_to_dict(category) for category in categories}
    roots = []
    for category in categories:
        item = by_id[category.id]
        if category.parent_category_id and category.parent_category_id in by_id:
            by_id[category.parent_category_id]["children"].append(item)
        else:
            roots.append(item)
    return roots


@router.post("", dependencies=_WRITE_EXPENSE_CATEGORIES)
async def create_expense_category(
    payload: ExpenseCategoryIn, db: AsyncSession = Depends(get_db)
) -> dict:
    await _validate_policy_target(payload.policy_version_id, db)
    await _validate_parent_hierarchy(
        parent_category_id=payload.parent_category_id,
        policy_version_id=payload.policy_version_id,
        db=db,
    )
    item = ExpenseCategory(**payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _category_to_dict(item)


@router.put("/{category_id}", dependencies=_WRITE_EXPENSE_CATEGORIES)
async def update_expense_category(
    category_id: int, payload: ExpenseCategoryIn, db: AsyncSession = Depends(get_db)
) -> dict:
    item = await db.get(ExpenseCategory, category_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Expense category not found")
    await _validate_policy_target(payload.policy_version_id, db)
    await _validate_parent_hierarchy(
        parent_category_id=payload.parent_category_id,
        policy_version_id=payload.policy_version_id,
        db=db,
        category_id=category_id,
    )
    await _validate_child_version_isolation(
        category_id=category_id,
        policy_version_id=payload.policy_version_id,
        db=db,
    )
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return _category_to_dict(item)


@router.delete("/{category_id}", dependencies=_WRITE_EXPENSE_CATEGORIES)
async def deactivate_expense_category(
    category_id: int, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    item = await db.get(ExpenseCategory, category_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Expense category not found")
    await _validate_policy_target(item.policy_version_id, db)
    active_children = (
        await db.execute(
            select(ExpenseCategory).where(
                ExpenseCategory.parent_category_id == category_id,
                ExpenseCategory.is_active.is_(True),
            )
        )
    ).scalars().all()
    if active_children:
        raise HTTPException(
            status_code=409,
            detail="Cannot deactivate a category with active child categories",
        )
    item.is_active = False
    await db.commit()
    return {"status": "inactive"}


@router.post("/blacklist-check", dependencies=_EXPENSE_CATEGORY_TOOLS)
async def blacklist_check(payload: BlacklistCheckRequest, db: AsyncSession = Depends(get_db)) -> dict:
    is_blacklisted, matched_items = await check_blacklist(
        payload.description,
        payload.category_ids,
        db,
        impact_level_id=payload.impact_level_id,
        impact_level_code=payload.impact_level_code,
    )
    return {"is_blacklisted": is_blacklisted, "matched_items": matched_items}
