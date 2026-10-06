from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, is_direct_report, require_any_permission, require_permission
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
    row = await create_exception_request(
        payload.claim_id, user_id, payload.exception_type, payload.description, db
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
        # HRBP_HR/FINANCE/IT_ADMIN/CEO/GROUP_HEAD_HR hold view_reports org-wide by design.
        # REPORTING_MANAGER holds neither — scoped to literal direct reports only, same as
        # /claims/team and employee_claims (see is_direct_report's docstring for why this
        # needed centralizing: this exact check was missing here before).
        broad_view_roles = {Role.HRBP_HR, Role.FINANCE, Role.IT_ADMIN, Role.CEO, Role.GROUP_HEAD_HR}
        if role == Role.REPORTING_MANAGER:
            if not await is_direct_report(manager_user_id=uid, target_user_id=row.requested_by_user_id, db=db):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        elif role not in broad_view_roles:
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
