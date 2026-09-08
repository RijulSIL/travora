from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.rbac import get_current_claims
from app.models.auth import Delegation, User
from app.schemas.me import MeOut, DelegationIn, DelegationOut
from app.services.me_service import build_me_profile

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
    user_id = int(claims["sub"])
    if user_id == payload.delegatee_id:
        raise HTTPException(status_code=400, detail="Cannot delegate to yourself")
        
    delegatee = await db.get(User, payload.delegatee_id)
    if not delegatee:
        raise HTTPException(status_code=404, detail="Delegatee not found")

    try:
        start = datetime.fromisoformat(payload.start_date)
        end = datetime.fromisoformat(payload.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    if end < start:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    # Deactivate existing active delegations for this delegator
    active_result = await db.execute(
        select(Delegation).where(Delegation.delegator_id == user_id, Delegation.is_active == True)
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
            User.is_active == True,
            (User.full_name.ilike(f"%{q}%")) | (User.email.ilike(f"%{q}%"))
        )
        .limit(10)
    )
    users = result.all()
    
    return [
        {"id": u.id, "email": u.email, "full_name": u.full_name} 
        for u in users
    ]
