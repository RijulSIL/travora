from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import (
    get_current_claims,
    require_any_permission,
    require_mfa,
    require_permission,
)
from app.core.timezone import now_ist, today_ist
from app.models.auth import User
from app.models.employee import Employee
from app.models.expense_category import ExpenseCategory
from app.models.policy import (
    CityGroup,
    CityGroupTier,
    ExpenseLimit,
    ImpactLevel,
    PolicyApproval,
    PolicyStatus,
    PolicyVersion,
)
from app.schemas.common import (
    CityGroupIn,
    CityGroupOut,
    CityGroupTierIn,
    CityGroupTierOut,
    CityGroupTierUpdateIn,
    ExpenseLimitIn,
    ExpenseLimitOut,
    ImpactLevelIn,
    ImpactLevelOut,
    PolicyScheduleIn,
    PolicyVersionIn,
    PolicyVersionOut,
)
from app.schemas.workflow import RejectBody
from app.services.audit_service import log_event
from app.services.policy_engine import (
    diff_policy_versions,
    enforce_city_group_immutability,
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
            notes=source_category.notes,
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


async def _assert_valid_tier_code(code: str, db: AsyncSession) -> None:
    exists = await db.scalar(select(CityGroupTier.id).where(CityGroupTier.code == code))
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"'{code}' is not a configured city-group tier",
        )


async def _set_only_default_tier(db: AsyncSession, keep_id: int | None) -> None:
    """Unsets is_default on every tier except keep_id (None on create, since the new tier isn't
    persisted yet and so can't already be among the current defaults)."""
    query = select(CityGroupTier).where(CityGroupTier.is_default.is_(True))
    if keep_id is not None:
        query = query.where(CityGroupTier.id != keep_id)
    for other in (await db.execute(query)).scalars().all():
        other.is_default = False


@router.get("/city-group-tiers", response_model=list[CityGroupTierOut], dependencies=_READ_ADMIN_POLICY)
async def list_city_group_tiers(db: AsyncSession = Depends(get_db)) -> list[CityGroupTier]:
    return (await db.execute(select(CityGroupTier).order_by(CityGroupTier.id))).scalars().all()


@router.post("/city-group-tiers", response_model=CityGroupTierOut, dependencies=_WRITE_ADMIN_POLICY)
async def create_city_group_tier(payload: CityGroupTierIn, db: AsyncSession = Depends(get_db)) -> CityGroupTier:
    existing = await db.scalar(select(CityGroupTier).where(CityGroupTier.code == payload.code))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"A tier with code '{payload.code}' already exists"
        )
    if payload.is_default:
        await _set_only_default_tier(db, keep_id=None)
    item = CityGroupTier(
        code=payload.code, display_name=payload.display_name, is_default=payload.is_default, is_deprecated=False
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/city-group-tiers/{item_id}", response_model=CityGroupTierOut, dependencies=_WRITE_ADMIN_POLICY)
async def update_city_group_tier(
    item_id: int, payload: CityGroupTierUpdateIn, db: AsyncSession = Depends(get_db)
) -> CityGroupTier:
    """code is never editable here — see CityGroupTier's docstring for why renaming it would
    silently orphan every CityGroup/ExpenseLimit/claim row already referencing the old string."""
    item = await db.get(CityGroupTier, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="City group tier not found")
    if not payload.is_default and item.is_default:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="At least one city-group tier must stay marked default — set a different tier as default first",
        )
    if payload.is_default and not item.is_default:
        if item.is_deprecated:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A deprecated tier cannot be made default")
        await _set_only_default_tier(db, keep_id=item.id)
    item.display_name = payload.display_name
    item.is_default = payload.is_default
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/city-group-tiers/{item_id}", dependencies=_WRITE_ADMIN_POLICY)
async def deprecate_city_group_tier(item_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    item = await db.get(CityGroupTier, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="City group tier not found")
    if item.is_default:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot deprecate the default city-group tier; set another tier as default first",
        )
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
    await _assert_valid_tier_code(payload.group_type, db)
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
    enforce_city_group_immutability(item)
    if payload.effective_to is not None and payload.effective_to <= payload.effective_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="effective_to must be after effective_from",
        )
    await _assert_valid_tier_code(payload.group_type, db)
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
    return {"city_name": city_name.strip(), "travel_date": travel_date.isoformat(), "group_type": group}


@router.delete("/city-groups/{item_id}", dependencies=_WRITE_ADMIN_POLICY)
async def delete_city_group(item_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    item = await db.get(CityGroup, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="City group not found")
    enforce_city_group_immutability(item)
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
    await _assert_valid_tier_code(payload.city_group, db)
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
    await _assert_valid_tier_code(payload.city_group, db)
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


@router.get("/policy-versions/{version_id}/approval-chain", dependencies=_READ_ADMIN_POLICY)
async def get_policy_approval_chain(version_id: int, db: AsyncSession = Depends(get_db)) -> list[dict]:
    """So the admin UI can show whose turn it actually is — Approve/Reject will 403 if you're
    not the role currently PENDING, and a multi-stage chain means that might not be whoever
    the blanket approve_policy permission suggests."""
    rows = (
        await db.execute(
            select(PolicyApproval).where(PolicyApproval.policy_version_id == version_id).order_by(PolicyApproval.id)
        )
    ).scalars().all()
    return [
        {
            "required_role": row.required_role,
            "status": row.status,
            "acted_by_user_id": row.acted_by_user_id,
            "acted_at": row.acted_at.isoformat() if row.acted_at else None,
            "comment": row.comment,
        }
        for row in rows
    ]


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
    await log_event(
        entity_type="policy_version",
        entity_id=str(item.id),
        action="policy_version_created",
        actor_id=user_id,
        old=None,
        new={"version_number": item.version_number},
        db=db,
    )
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
async def submit_policy_version(
    version_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    from app.services.workflow_service import EXCEPTION_APPROVAL_CHAINS, get_workflow_config

    item = await db.get(PolicyVersion, version_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Policy version not found")
    await enforce_immutability(item.id, db)
    if item.status != PolicyStatus.DRAFT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only drafts can be submitted")

    # A version re-submitted after an earlier rejection still has its old (now-stale)
    # PolicyApproval rows from that previous cycle — clear them so this submission starts a
    # fresh chain instead of colliding with them (the (version, role) pair is unique) or
    # confusing the "which stage is active" lookup with leftover REJECTED rows.
    await db.execute(delete(PolicyApproval).where(PolicyApproval.policy_version_id == item.id))

    cfg = await get_workflow_config(db)
    chain = cfg.get("exception_chains", {}).get("POLICY_APPROVAL") or EXCEPTION_APPROVAL_CHAINS["POLICY_APPROVAL"]
    item.status = PolicyStatus.PENDING_HRBP
    for i, role in enumerate(chain):
        db.add(
            PolicyApproval(
                policy_version_id=item.id,
                required_role=role,
                status="PENDING" if i == 0 else "AWAITING",
            )
        )
    await log_event(
        entity_type="policy_version",
        entity_id=str(item.id),
        action="policy_version_submitted",
        actor_id=int(claims["sub"]),
        old={"status": PolicyStatus.DRAFT.value},
        new={"status": PolicyStatus.PENDING_HRBP.value, "approval_chain": chain},
        db=db,
    )
    await db.commit()
    return {"status": "pending_hrbp"}


@router.post(
    "/policy-versions/{version_id}/approve",
    dependencies=[Depends(require_permission("approve_policy")), Depends(require_mfa)],
)
async def approve_policy_version(
    version_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """approve_policy (the route-level gate above) is deliberately a coarse pre-filter — "is
    this the kind of role that could ever approve a policy" — same two-layer pattern as claim
    stages and exceptions. The real, fine-grained "is it actually your turn" check is the
    _user_matches_required_role call below, against whichever role the configured
    POLICY_APPROVAL chain currently has active for this version."""
    from app.services.workflow_service import _user_matches_required_role

    item = await db.get(PolicyVersion, version_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Policy version not found")
    await enforce_immutability(item.id, db)
    if item.status != PolicyStatus.PENDING_HRBP:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only pending versions can be approved")

    approvals = (
        await db.execute(
            select(PolicyApproval).where(PolicyApproval.policy_version_id == item.id).order_by(PolicyApproval.id)
        )
    ).scalars().all()
    active_stage = next((a for a in approvals if a.status == "PENDING"), None)
    if active_stage is None:
        raise HTTPException(status_code=409, detail="No active approval stage for this policy version")

    approver = await db.get(User, int(claims["sub"]))
    if approver is None or not await _user_matches_required_role(approver, active_stage.required_role, None, db):
        raise HTTPException(
            status_code=403, detail="Your role is not the active stage of this policy's approval chain"
        )

    now = now_ist()
    active_stage.status = "APPROVED"
    active_stage.acted_by_user_id = approver.id
    active_stage.acted_at = now

    current_idx = approvals.index(active_stage)
    next_stage = approvals[current_idx + 1] if current_idx + 1 < len(approvals) else None

    if next_stage is not None and next_stage.status == "AWAITING":
        next_stage.status = "PENDING"
        await log_event(
            entity_type="policy_version",
            entity_id=str(item.id),
            action="policy_version_stage_approved",
            actor_id=approver.id,
            old={"stage_role": active_stage.required_role},
            new={"next_stage_role": next_stage.required_role},
            db=db,
        )
        await db.commit()
        return {"status": "pending_hrbp", "next_approver_role": next_stage.required_role}

    # Last stage of the chain just approved — this version goes ACTIVE, but deliberately WITHOUT
    # an effective_from yet. Whoever holds approve_policy now has to make a separate, explicit
    # call to schedule_policy_version (below) to actually pick when it takes effect — that's
    # what "applied system-wide" is keyed off (get_active_policy_version only ever looks at
    # effective_from, never at this status), and it's also what keeps approval and archival from
    # happening in the same instant: assigning effective_from here (to "today", as earlier
    # revisions of this endpoint did) would make the version immutable the moment it's approved
    # (enforce_immutability triggers at effective_from <= today), closing off the very scheduling
    # window this feature exists to provide. The old ACTIVE version (if any) stays exactly as it
    # is — still genuinely governing every date up to whenever HRBP actually schedules this one —
    # until schedule_policy_version's first call on this version archives it with a real handoff
    # date, at which point it stays interchangeable with this one.
    stuck_active = (
        await db.execute(
            select(PolicyVersion).where(
                PolicyVersion.status == PolicyStatus.ACTIVE,
                (PolicyVersion.effective_from.is_(None)) | (PolicyVersion.effective_from > today_ist()),
            )
        )
    ).scalars().first()
    if stuck_active is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Version {stuck_active.version_number} is already approved and "
                + (
                    f"scheduled to take effect on {stuck_active.effective_from.isoformat()}"
                    if stuck_active.effective_from
                    else "awaiting a scheduled date"
                )
                + "; schedule or wait for it to start before approving another version"
            ),
        )
    item.status = PolicyStatus.ACTIVE
    item.approved_by = approver.id
    item.approved_at = now
    await log_event(
        entity_type="policy_version",
        entity_id=str(item.id),
        action="policy_version_approved",
        actor_id=approver.id,
        old={"status": PolicyStatus.PENDING_HRBP.value},
        new={"status": PolicyStatus.ACTIVE.value, "approved_at": item.approved_at.isoformat()},
        db=db,
    )
    await db.commit()
    return {"status": "active"}


@router.put(
    "/policy-versions/{version_id}/schedule",
    response_model=PolicyVersionOut,
    dependencies=_WRITE_ADMIN_POLICY,
)
async def schedule_policy_version(
    version_id: int,
    payload: PolicyScheduleIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> PolicyVersion:
    """Picks (or moves) when a fully-approved version actually takes effect, right up until that
    date arrives — enforce_immutability is what cuts this off the moment it does, same rule that
    already locks every other field on this version. The FIRST call on a given version (its
    effective_from is still None here) is also the moment it truly supersedes whatever else is
    ACTIVE: that version gets archived with its effective_to set to this date, same handoff
    approve_policy_version used to do inline before this became a separate step. A LATER call
    (effective_from already set, just moving the date) instead keeps whatever it already
    archived in sync — find it by matching the OLD effective_from (the handoff point the first
    call set up) and carry the new date onto it too, or moving this date out would open a gap
    with nothing governing travel dates in between."""
    item = await db.get(PolicyVersion, version_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Policy version not found")
    await enforce_immutability(item.id, db)
    if item.status != PolicyStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Only an approved (active) version can be scheduled"
        )
    if item.effective_from is not None and item.effective_from <= today_ist():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This version has already taken effect and can no longer be rescheduled",
        )
    if payload.effective_from < today_ist():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Cannot schedule a date in the past"
        )

    old_date = item.effective_from
    if old_date is None:
        active_versions = (
            await db.execute(
                select(PolicyVersion).where(PolicyVersion.status == PolicyStatus.ACTIVE, PolicyVersion.id != item.id)
            )
        ).scalars().all()
        for active in active_versions:
            active.status = PolicyStatus.ARCHIVED
            active.effective_to = payload.effective_from
    else:
        predecessors = (
            await db.execute(select(PolicyVersion).where(PolicyVersion.effective_to == old_date))
        ).scalars().all()
        for predecessor in predecessors:
            predecessor.effective_to = payload.effective_from
    item.effective_from = payload.effective_from

    await log_event(
        entity_type="policy_version",
        entity_id=str(item.id),
        action="policy_version_scheduled",
        actor_id=int(claims["sub"]),
        old={"effective_from": old_date.isoformat() if old_date else None},
        new={"effective_from": item.effective_from.isoformat()},
        db=db,
    )
    await db.commit()
    await db.refresh(item)
    return item


@router.post(
    "/policy-versions/{version_id}/reject",
    dependencies=[Depends(require_permission("approve_policy")), Depends(require_mfa)],
)
async def reject_policy_version(
    version_id: int,
    payload: RejectBody,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """The counterpart to approve — sends a submitted version back to DRAFT instead of
    leaving it stuck in PENDING_HRBP forever with no way to edit or delete it (the only two
    outcomes that existed before this: approve it, or leave it pending indefinitely). Back in
    DRAFT, the creator can revise it using the existing edit endpoints and resubmit — which
    clears these approval rows and starts the chain fresh. Same active-stage check as approve:
    whoever's turn it currently is can also be the one to send it back, not just anyone who
    generally holds approve_policy."""
    from app.services.workflow_service import _user_matches_required_role

    item = await db.get(PolicyVersion, version_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Policy version not found")
    await enforce_immutability(item.id, db)
    if item.status != PolicyStatus.PENDING_HRBP:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only pending versions can be rejected")

    approvals = (
        await db.execute(
            select(PolicyApproval).where(PolicyApproval.policy_version_id == item.id).order_by(PolicyApproval.id)
        )
    ).scalars().all()
    active_stage = next((a for a in approvals if a.status == "PENDING"), None)
    if active_stage is None:
        raise HTTPException(status_code=409, detail="No active approval stage for this policy version")

    approver = await db.get(User, int(claims["sub"]))
    if approver is None or not await _user_matches_required_role(approver, active_stage.required_role, None, db):
        raise HTTPException(
            status_code=403, detail="Your role is not the active stage of this policy's approval chain"
        )

    now = now_ist()
    for a in approvals:
        if a.status in ("PENDING", "AWAITING"):
            a.status = "REJECTED"
    active_stage.acted_by_user_id = approver.id
    active_stage.acted_at = now
    active_stage.comment = payload.reason

    item.status = PolicyStatus.DRAFT
    await log_event(
        entity_type="policy_version",
        entity_id=str(item.id),
        action="policy_version_rejected",
        actor_id=approver.id,
        old={"status": PolicyStatus.PENDING_HRBP.value},
        new={"status": PolicyStatus.DRAFT.value, "reason": payload.reason},
        db=db,
    )
    await db.commit()
    return {"status": "draft"}


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
    # A status == ACTIVE row can be scheduled for a future effective_from (see
    # reschedule_policy_version) — "the active policy" here means whichever version's date
    # range actually covers today, same date-range resolution get_active_policy_version uses,
    # not just whatever the workflow status happens to say.
    today = today_ist()
    active_policy = (
        await db.execute(
            select(PolicyVersion)
            .where(
                and_(
                    PolicyVersion.effective_from.is_not(None),
                    PolicyVersion.effective_from <= today,
                    (PolicyVersion.effective_to.is_(None)) | (PolicyVersion.effective_to >= today),
                )
            )
            .order_by(PolicyVersion.effective_from.desc(), PolicyVersion.id.desc())
        )
    ).scalars().first()
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
        "as_of": today_ist().isoformat(),
    }
