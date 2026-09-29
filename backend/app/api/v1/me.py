from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims
from app.models.auth import Delegation, Role, User
from app.schemas.me import AutoApproveThresholdIn, DelegationIn, DelegationOut, MeOut
from app.services.claim_submission_rules import parse_auto_approve_threshold
from app.services.me_service import build_me_profile
from app.services.workflow_service import get_workflow_config

router = APIRouter(tags=["me"])


@router.get("/me", response_model=MeOut)
async def read_me(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> MeOut:
    try:
        return await build_me_profile(int(claims["sub"]), db)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found") from None


@router.patch("/me/auto-approve-threshold", response_model=MeOut)
async def update_auto_approve_threshold(
    payload: AutoApproveThresholdIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> MeOut:
    user_id = int(claims["sub"])
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != Role.REPORTING_MANAGER:
        raise HTTPException(
            status_code=403,
            detail="Only reporting managers can set a personal auto-approve threshold",
        )

    if payload.threshold is not None:
        cfg = await get_workflow_config(db)
        ceiling = parse_auto_approve_threshold(cfg)
        if payload.threshold > ceiling:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Your threshold cannot exceed the org-wide auto-approve ceiling of "
                    f"₹{ceiling.quantize(Decimal('0.01'))}, set by your administrator."
                ),
            )

    user.auto_approve_threshold = payload.threshold
    await db.commit()

    try:
        return await build_me_profile(user_id, db)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found") from None


@router.get("/me/delegations", response_model=list[DelegationOut])
async def list_delegations(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
):
    user_id = int(claims["sub"])
    result = await db.execute(
        select(Delegation)
        .where(Delegation.delegator_id == user_id)
        .order_by(Delegation.start_date.desc())
    )
    delegations = result.scalars().all()
    
    out = []
    for d in delegations:
        delegatee = await db.get(User, d.delegatee_id)
        out.append(
            DelegationOut(
                id=d.id,
                delegator_id=d.delegator_id,
                delegatee_id=d.delegatee_id,
                delegatee_name=delegatee.full_name if delegatee else None,
                delegatee_email=delegatee.email if delegatee else None,
                start_date=d.start_date.date().isoformat(),
                end_date=d.end_date.date().isoformat(),
                is_active=d.is_active,
                created_at=d.created_at.isoformat(),
            )
        )
    return out


@router.post("/me/delegations", response_model=DelegationOut)
async def create_delegation(
    payload: DelegationIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
):
    from app.core.rbac import DELEGATABLE_PERMISSIONS
    from app.services.delegation_service import is_delegation_enabled

    if not await is_delegation_enabled(db):
        raise HTTPException(status_code=409, detail="Delegation is currently disabled by your administrator")

    user_id = int(claims["sub"])
    delegator = await db.get(User, user_id)
    if delegator is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not DELEGATABLE_PERMISSIONS.get(delegator.role, set()):
        raise HTTPException(status_code=403, detail="Delegation is not available for your role")

    if user_id == payload.delegatee_id:
        raise HTTPException(status_code=400, detail="Cannot delegate to yourself")

    delegatee = await db.get(User, payload.delegatee_id)
    if not delegatee:
        raise HTTPException(status_code=404, detail="Delegatee not found")

    try:
        start = datetime.fromisoformat(payload.start_date)
        end = datetime.fromisoformat(payload.end_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid date format") from exc

    if end < start:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    # Deactivate existing active delegations for this delegator
    active_result = await db.execute(
        select(Delegation).where(Delegation.delegator_id == user_id, Delegation.is_active)
    )
    for existing in active_result.scalars():
        existing.is_active = False

    new_del = Delegation(
        delegator_id=user_id,
        delegatee_id=payload.delegatee_id,
        start_date=start,
        end_date=end,
        is_active=True,
    )
    db.add(new_del)
    await db.commit()
    await db.refresh(new_del)

    return DelegationOut(
        id=new_del.id,
        delegator_id=new_del.delegator_id,
        delegatee_id=new_del.delegatee_id,
        delegatee_name=delegatee.full_name,
        delegatee_email=delegatee.email,
        start_date=new_del.start_date.date().isoformat(),
        end_date=new_del.end_date.date().isoformat(),
        is_active=new_del.is_active,
        created_at=new_del.created_at.isoformat(),
    )


@router.delete("/me/delegations/{delegation_id}")
async def delete_delegation(
    delegation_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
):
    user_id = int(claims["sub"])
    delegation = await db.get(Delegation, delegation_id)
    if not delegation or delegation.delegator_id != user_id:
        raise HTTPException(status_code=404, detail="Delegation not found")
        
    await db.delete(delegation)
    await db.commit()
    return {"status": "ok"}


@router.get("/me/users-search")
async def search_users(
    q: str,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
):
    if not q or len(q) < 2:
        return []
    
    # Exclude current user from search
    user_id = int(claims["sub"])
    
    result = await db.execute(
        select(User.id, User.email, User.full_name)
        .where(
            User.id != user_id,
            User.is_active,
            (User.full_name.ilike(f"%{q}%")) | (User.email.ilike(f"%{q}%"))
        )
        .limit(10)
    )
    users = result.all()

    return [
        {"id": u.id, "email": u.email, "full_name": u.full_name}
        for u in users
    ]


@router.get("/me/org-chart")
async def get_org_chart(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
):
    """Just the viewer's own reporting line — their manager chain up to the top, plus
    their own subtree of reports. Not the whole company: other branches (peers' teams,
    unrelated departments) are deliberately left out. Visible to anyone above a plain
    individual contributor (managers, HR, finance, leadership, admin roles), but not to
    the EMPLOYEE role. Fields are limited to name/designation/department — nothing from
    Employee that's sensitive (bank details, cost centre, office location)."""
    from app.models.employee import Employee

    if Role(claims.get("role")) == Role.EMPLOYEE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not available for this role")

    user = await db.get(User, int(claims["sub"]))
    if user is None or not user.employee_id:
        return {"roots": []}

    employees = (await db.execute(select(Employee).where(Employee.is_active.is_(True)))).scalars().all()
    by_id = {e.employee_id: e for e in employees}
    viewer = by_id.get(user.employee_id)
    if viewer is None:
        return {"roots": []}

    children_by_manager: dict[str | None, list[Employee]] = {}
    for e in employees:
        parent_id = e.reporting_manager_id if e.reporting_manager_id in by_id else None
        children_by_manager.setdefault(parent_id, []).append(e)

    def build_node(emp: Employee, ancestors: set[str], *, is_viewer: bool = False) -> dict:
        node = {
            "employee_id": emp.employee_id,
            "full_name": emp.full_name,
            "designation": emp.designation,
            "department": emp.department,
            "is_viewer": is_viewer,
            "children": [],
        }
        # Guard against a malformed reporting_manager_id cycle in the underlying HR data
        # turning this into infinite recursion.
        if emp.employee_id in ancestors:
            return node
        next_ancestors = ancestors | {emp.employee_id}
        for child in sorted(children_by_manager.get(emp.employee_id, []), key=lambda c: c.full_name):
            node["children"].append(build_node(child, next_ancestors))
        return node

    # Walk up the reporting chain (closest manager first), same cycle guard as above.
    chain: list[Employee] = []
    seen = {viewer.employee_id}
    curr = viewer
    while curr.reporting_manager_id and curr.reporting_manager_id in by_id and curr.reporting_manager_id not in seen:
        mgr = by_id[curr.reporting_manager_id]
        chain.append(mgr)
        seen.add(mgr.employee_id)
        curr = mgr

    node = build_node(viewer, set(), is_viewer=True)
    for ancestor in chain:
        node = {
            "employee_id": ancestor.employee_id,
            "full_name": ancestor.full_name,
            "designation": ancestor.designation,
            "department": ancestor.department,
            "is_viewer": False,
            "children": [node],
        }
    return {"roots": [node]}
