from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_any_permission, require_permission
from app.models.auth import Role
from app.schemas.workflow import ExceptionDecisionBody, ExceptionRequestIn, ExceptionRequestOut
from app.services.workflow_service import (
    create_exception_request,
    decide_exception_request,
    get_exception_request,
)

router = APIRouter(prefix="/exceptions", tags=["exceptions"])


@router.post(
    "/request",
    response_model=ExceptionRequestOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def request_exception(
    payload: ExceptionRequestIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> ExceptionRequestOut:
    user_id = int(claims["sub"])
    claim_id = payload.claim_id
    
    if not claim_id:
        # Create a shell claim draft in the database
        from app.models.auth import User
        from app.models.reimbursement import ClaimDraft, ClaimStatus
        user = await db.get(User, user_id)
        claim = ClaimDraft(
            employee_user_id=user_id,
            employee_id=user.employee_id if user else None,
            trip_purpose=f"Auto-generated Shell for Travel Booking Exception ({payload.exception_type})",
            status=ClaimStatus.DRAFT
        )
        db.add(claim)
        await db.flush()
        claim_id = claim.id

    row = await create_exception_request(
        claim_id, user_id, payload.exception_type, payload.description, db
    )
    return row


@router.get("/{exception_id}", response_model=ExceptionRequestOut)
async def get_exception(
    exception_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> ExceptionRequestOut:
    row = await get_exception_request(exception_id, db)
    uid = int(claims["sub"])
    if row.requested_by_user_id != uid:
        try:
            role = Role(claims.get("role"))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden") from exc
        if role not in {Role.REPORTING_MANAGER, Role.HRBP_HR, Role.FINANCE, Role.IT_ADMIN, Role.CEO, Role.GROUP_HEAD_HR}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return row


@router.post("/{exception_id}/approve", response_model=ExceptionRequestOut)
async def decide_exception(
    exception_id: int,
    payload: ExceptionDecisionBody,
    claims: dict = Depends(
        require_any_permission("approve_stage_2", "approve_stage_4", "configure_policy", "approve_exception")
    ),
    db: AsyncSession = Depends(get_db),
) -> ExceptionRequestOut:
    row = await decide_exception_request(exception_id, int(claims["sub"]), payload.approve, payload.comment, db)
    return row
