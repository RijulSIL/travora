from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import (
    get_current_claims,
    require_any_permission,
    require_hrbp_role,
    require_mfa,
    require_permission,
)
from app.models.employee import Employee
from app.models.expense_category import ExpenseCategory
from app.models.policy import CityGroup, ExpenseLimit, ImpactLevel, PolicyStatus, PolicyVersion
from app.schemas.common import (
    CityGroupIn,
    CityGroupOut,
    ExpenseLimitIn,
    ExpenseLimitOut,
    ImpactLevelIn,
    ImpactLevelOut,
    PolicyVersionIn,
    PolicyVersionOut,
)
from app.services.policy_engine import (
    diff_policy_versions,
    enforce_immutability,
    resolve_city_group,
    validate_city_group_overlap,
)

router = APIRouter(prefix="/admin", tags=["admin-policy"])

_READ_ADMIN_POLICY = [Depends(require_any_permission("configure_policy", "view_admin_readonly"))]
_WRITE_ADMIN_POLICY = [Depends(require_permission("configure_policy")), Depends(require_mfa)]
_CITY_GROUP_RESOLVE = [
    Depends(require_any_permission("submit_claim", "configure_policy", "view_admin_readonly")),
]


async def _clone_policy_snapshot_from_source(
    source_version_id: int, target_version_id: int, db: AsyncSession
) -> None:
    source_levels = (
        await db.execute(select(ImpactLevel).where(ImpactLevel.policy_version_id == source_version_id))
    ).scalars().all()
    source_limits = (
        await db.execute(select(ExpenseLimit).where(ExpenseLimit.policy_version_id == source_version_id))
    ).scalars().all()
    source_categories = (
        await db.execute(
            select(ExpenseCategory).where(ExpenseCategory.policy_version_id == source_version_id)
        )
    ).scalars().all()
    source_to_target_level_ids: dict[int, int] = {}
    for source_level in source_levels:
        clone = ImpactLevel(
            level_code=source_level.level_code,
            level_name=source_level.level_name,
            air_eligibility=source_level.air_eligibility,
            air_class_allowed=source_level.air_class_allowed,
            air_eligibility_conditions=source_level.air_eligibility_conditions,
            train_classes_allowed=source_level.train_classes_allowed,
            local_conveyance_modes=source_level.local_conveyance_modes,
            vehicle_rate_4w=source_level.vehicle_rate_4w,
            vehicle_rate_2w=source_level.vehicle_rate_2w,
            twin_sharing_mandatory=source_level.twin_sharing_mandatory,
            is_deprecated=source_level.is_deprecated,
            policy_version_id=target_version_id,
        )
        db.add(clone)
        await db.flush()
        source_to_target_level_ids[source_level.id] = clone.id

    for source_limit in source_limits:
        target_impact_level_id = source_to_target_level_ids.get(source_limit.impact_level_id)
        if target_impact_level_id is None:
            continue
        db.add(
            ExpenseLimit(
                policy_version_id=target_version_id,
                impact_level_id=target_impact_level_id,
                city_group=source_limit.city_group,
                hotel_cap=source_limit.hotel_cap,
                hotel_is_hard_block=source_limit.hotel_is_hard_block,
                food_cap=source_limit.food_cap,
                food_is_hard_block=source_limit.food_is_hard_block,
                incidental_cap=source_limit.incidental_cap,
                incidental_is_hard_block=source_limit.incidental_is_hard_block,
                day_visit_cap=source_limit.day_visit_cap,
                day_visit_is_hard_block=source_limit.day_visit_is_hard_block,
            )
        )

    source_to_target_category_ids: dict[int, int] = {}
    for source_category in source_categories:
        clone = ExpenseCategory(
            name=source_category.name,
            parent_category_id=None,
            bill_mandatory=source_category.bill_mandatory,
            gst_invoice_required=source_category.gst_invoice_required,
            blacklisted_items=source_category.blacklisted_items,
            is_active=source_category.is_active,
            policy_version_id=target_version_id,
        )
        db.add(clone)
        await db.flush()
        source_to_target_category_ids[source_category.id] = clone.id

    for source_category in source_categories:
        if source_category.parent_category_id is None:
            continue
        target_category_id = source_to_target_category_ids.get(source_category.id)
        target_parent_id = source_to_target_category_ids.get(source_category.parent_category_id)
        if target_category_id is None:
            continue
        target_category = await db.get(ExpenseCategory, target_category_id)
        if target_category is None:
            continue
        target_category.parent_category_id = target_parent_id


@router.get("/impact-levels", response_model=list[ImpactLevelOut], dependencies=_READ_ADMIN_POLICY)
async def list_impact_levels(
    policy_version_id: int | None = Query(None), db: AsyncSession = Depends(get_db)
) -> list[ImpactLevel]:
    query = select(ImpactLevel)
    if policy_version_id is not None:
        query = query.where(ImpactLevel.policy_version_id == policy_version_id)
    return (await db.execute(query)).scalars().all()


@router.post("/impact-levels", response_model=ImpactLevelOut, dependencies=_WRITE_ADMIN_POLICY)
async def create_impact_level(payload: ImpactLevelIn, db: AsyncSession = Depends(get_db)) -> ImpactLevel:
    await enforce_immutability(payload.policy_version_id, db)
    item = ImpactLevel(**payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/impact-levels/{item_id}", response_model=ImpactLevelOut, dependencies=_WRITE_ADMIN_POLICY)
async def update_impact_level(
    item_id: int, payload: ImpactLevelIn, db: AsyncSession = Depends(get_db)
) -> ImpactLevel:
    item = await db.get(ImpactLevel, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Impact level not found")
    await enforce_immutability(item.policy_version_id, db)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/impact-levels/{item_id}", dependencies=_WRITE_ADMIN_POLICY)
async def deprecate_impact_level(item_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    item = await db.get(ImpactLevel, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Impact level not found")
    await enforce_immutability(item.policy_version_id, db)
    item.is_deprecated = True
    await db.commit()
    return {"status": "deprecated"}


@router.get("/city-groups", response_model=list[CityGroupOut], dependencies=_READ_ADMIN_POLICY)
async def list_city_groups(db: AsyncSession = Depends(get_db)) -> list[CityGroup]:
    return (await db.execute(select(CityGroup))).scalars().all()


@router.post("/city-groups", response_model=CityGroupOut, dependencies=_WRITE_ADMIN_POLICY)
async def create_city_group(payload: CityGroupIn, db: AsyncSession = Depends(get_db)) -> CityGroup:
    if payload.effective_to is not None and payload.effective_to <= payload.effective_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="effective_to must be after effective_from",
        )
    await validate_city_group_overlap(
        payload.city_name, payload.effective_from, payload.effective_to, db
    )
    item = CityGroup(**payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/city-groups/{item_id}", response_model=CityGroupOut, dependencies=_WRITE_ADMIN_POLICY)
async def update_city_group(
    item_id: int, payload: CityGroupIn, db: AsyncSession = Depends(get_db)
) -> CityGroup:
    item = await db.get(CityGroup, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="City group not found")
    if payload.effective_to is not None and payload.effective_to <= payload.effective_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="effective_to must be after effective_from",
        )
    await validate_city_group_overlap(
        payload.city_name,
        payload.effective_from,
        payload.effective_to,
        db,
        excluding_id=item.id,
    )
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


@router.get("/city-groups/resolve", dependencies=_CITY_GROUP_RESOLVE)
async def resolve_city_group_endpoint(
    city_name: str = Query(..., min_length=1),
    travel_date: date = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    group = await resolve_city_group(city_name=city_name.strip(), travel_date=travel_date, db=db)
    return {"city_name": city_name.strip(), "travel_date": travel_date.isoformat(), "group_type": group.value}


@router.delete("/city-groups/{item_id}", dependencies=_WRITE_ADMIN_POLICY)
async def delete_city_group(item_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    item = await db.get(CityGroup, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="City group not found")
    await db.delete(item)
    await db.commit()
    return {"status": "deleted"}


@router.get("/expense-limits", response_model=list[ExpenseLimitOut], dependencies=_READ_ADMIN_POLICY)
async def list_expense_limits(
    policy_version_id: int | None = Query(None), db: AsyncSession = Depends(get_db)
) -> list[ExpenseLimit]:
    query = select(ExpenseLimit)
    if policy_version_id is not None:
        query = query.where(ExpenseLimit.policy_version_id == policy_version_id)
    return (await db.execute(query)).scalars().all()


@router.post("/expense-limits", response_model=ExpenseLimitOut, dependencies=_WRITE_ADMIN_POLICY)
async def create_expense_limit(
    payload: ExpenseLimitIn, db: AsyncSession = Depends(get_db)
) -> ExpenseLimit:
    await enforce_immutability(payload.policy_version_id, db)
    item = ExpenseLimit(**payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/expense-limits/{item_id}", response_model=ExpenseLimitOut, dependencies=_WRITE_ADMIN_POLICY)
async def update_expense_limit(
    item_id: int, payload: ExpenseLimitIn, db: AsyncSession = Depends(get_db)
) -> ExpenseLimit:
    item = await db.get(ExpenseLimit, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Expense limit not found")
    await enforce_immutability(item.policy_version_id, db)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/expense-limits/{item_id}", dependencies=_WRITE_ADMIN_POLICY)
async def delete_expense_limit(item_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    item = await db.get(ExpenseLimit, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Expense limit not found")
    await enforce_immutability(item.policy_version_id, db)
    await db.delete(item)
    await db.commit()
    return {"status": "deleted"}


@router.get("/policy-versions", response_model=list[PolicyVersionOut], dependencies=_READ_ADMIN_POLICY)
async def list_policy_versions(db: AsyncSession = Depends(get_db)) -> list[PolicyVersion]:
    return (await db.execute(select(PolicyVersion))).scalars().all()


@router.post("/policy-versions", response_model=PolicyVersionOut, dependencies=_WRITE_ADMIN_POLICY)
async def create_policy_version(
    payload: PolicyVersionIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> PolicyVersion:
    user_id = int(claims["sub"])
    item = PolicyVersion(
        **payload.model_dump(exclude={"status"}),
        status=PolicyStatus.DRAFT,
        created_by=user_id,
    )
    db.add(item)
    await db.flush()
    source_version = (
        await db.execute(
            select(PolicyVersion)
            .where(PolicyVersion.status == PolicyStatus.ACTIVE)
            .order_by(PolicyVersion.effective_from.desc(), PolicyVersion.id.desc())
        )
    ).scalars().first()
    if source_version is None:
        source_version = (
            await db.execute(select(PolicyVersion).order_by(PolicyVersion.id.desc()))
        ).scalars().first()
    if source_version is not None:
        await _clone_policy_snapshot_from_source(source_version.id, item.id, db)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/policy-versions/{version_id}", response_model=PolicyVersionOut, dependencies=_WRITE_ADMIN_POLICY)
async def update_policy_version(
    version_id: int, payload: PolicyVersionIn, db: AsyncSession = Depends(get_db)
) -> PolicyVersion:
    item = await db.get(PolicyVersion, version_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Policy version not found")
    await enforce_immutability(item.id, db)
    if item.status != PolicyStatus.DRAFT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft versions can be updated")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    item.status = PolicyStatus.DRAFT
    await db.commit()
    await db.refresh(item)
    return item


@router.post("/policy-versions/{version_id}/submit", dependencies=_WRITE_ADMIN_POLICY)
async def submit_policy_version(version_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    item = await db.get(PolicyVersion, version_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Policy version not found")
    await enforce_immutability(item.id, db)
    if item.status != PolicyStatus.DRAFT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only drafts can be submitted")
    item.status = PolicyStatus.PENDING_HRBP
    await db.commit()
    return {"status": "pending_hrbp"}


@router.post(
    "/policy-versions/{version_id}/approve",
    dependencies=[Depends(require_hrbp_role()), Depends(require_mfa)],
)
async def approve_policy_version(
    version_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    item = await db.get(PolicyVersion, version_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Policy version not found")
    await enforce_immutability(item.id, db)
    if item.status != PolicyStatus.PENDING_HRBP:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only pending versions can be approved")

    active_versions = (
        await db.execute(select(PolicyVersion).where(PolicyVersion.status == PolicyStatus.ACTIVE))
    ).scalars().all()
    for active in active_versions:
        active.status = PolicyStatus.ARCHIVED
        active.effective_to = item.effective_from
    item.status = PolicyStatus.ACTIVE
    item.approved_by = int(claims["sub"])
    await db.commit()
    return {"status": "active"}


@router.delete("/policy-versions/{version_id}", dependencies=_WRITE_ADMIN_POLICY)
async def delete_policy_version(version_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    item = await db.get(PolicyVersion, version_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Policy version not found")
    await enforce_immutability(item.id, db)
    if item.status != PolicyStatus.DRAFT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft versions can be deleted")
    await db.delete(item)
    await db.commit()
    return {"status": "deleted"}


@router.get("/policy-versions/diff", dependencies=_READ_ADMIN_POLICY)
async def diff_policy(v1: int = Query(...), v2: int = Query(...), db: AsyncSession = Depends(get_db)) -> dict:
    return await diff_policy_versions(v1, v2, db)


@router.get("/dashboard/stats", dependencies=_READ_ADMIN_POLICY)
async def dashboard_stats(db: AsyncSession = Depends(get_db)) -> dict:
    active_policy = (
        await db.execute(select(PolicyVersion).where(PolicyVersion.status == PolicyStatus.ACTIVE))
    ).scalar_one_or_none()
    employee_count = await db.scalar(select(func.count()).select_from(Employee))
    pending_count = await db.scalar(
        select(func.count()).select_from(PolicyVersion).where(PolicyVersion.status == PolicyStatus.PENDING_HRBP)
    )
    impact_count = 0
    if active_policy:
        impact_count = await db.scalar(
            select(func.count())
            .select_from(ImpactLevel)
            .where(
                ImpactLevel.policy_version_id == active_policy.id,
                ImpactLevel.is_deprecated.is_(False),
            )
        )
    return {
        "active_policy_version": active_policy.version_number if active_policy else None,
        "total_employees": employee_count or 0,
        "pending_hrbp_approvals": pending_count or 0,
        "impact_level_count": impact_count or 0,
        "as_of": date.today().isoformat(),
    }
