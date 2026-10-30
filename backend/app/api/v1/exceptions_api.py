from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, is_direct_report, require_any_permission
from app.models.auth import Role, User
from app.models.claim_workflow import ExceptionApproval
from app.schemas.workflow import ExceptionDecisionBody, ExceptionItemsDecisionBody, ExceptionRequestOut
from app.services.workflow_service import (
    DEPARTMENT_HEAD,
    decide_claim_exception_items,
    decide_exception_request,
    get_exception_request,
    is_department_head_for,
)

# Claim exceptions are no longer requested one at a time mid-wizard — they're raised together
# when the claim is submitted (POST /claims/{id}/submit with a reason per flagged expense), so
# an unsubmitted claim never has any. Travel-request exceptions have their own creation path.
router = APIRouter(prefix="/exceptions", tags=["exceptions"])


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
        # Anyone else — a Reporting Manager, or any role that manages people — is scoped to
        # literal direct reports only, same as /claims/team and employee_claims (see
        # is_direct_report's docstring for why this needed centralizing).
        broad_view_roles = {Role.HRBP_HR, Role.FINANCE, Role.IT_ADMIN, Role.CEO, Role.GROUP_HEAD_HR}
        allowed = role in broad_view_roles or await is_direct_report(
            manager_user_id=uid, target_user_id=row.requested_by_user_id, db=db
        )
        # The department head asked to approve this one may open it too.
        if not allowed and await _has_department_head_step(row.id, db):
            requester = await db.get(User, row.requested_by_user_id)
            allowed = await is_department_head_for(uid, requester.employee_id if requester else None, db)
        # Whoever's actually assigned the pending step may open it too — covers a pooled role
        # (e.g. ADMIN, RECRUITER, PAYROLL) that isn't in broad_view_roles and isn't the direct
        # manager, same as decide_exception_request already lets them act on it.
        if not allowed:
            allowed = await _has_pending_step_for_role(row.id, role.value, db)
        if not allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return row


async def _has_department_head_step(exception_id: int, db: AsyncSession) -> bool:
    found = (
        await db.execute(
            select(ExceptionApproval.id).where(
                ExceptionApproval.exception_request_id == exception_id,
                ExceptionApproval.required_role == DEPARTMENT_HEAD,
            )
        )
    ).scalars().first()
    return found is not None


async def _has_pending_step_for_role(exception_id: int, role_value: str, db: AsyncSession) -> bool:
    found = (
        await db.execute(
            select(ExceptionApproval.id).where(
                ExceptionApproval.exception_request_id == exception_id,
                ExceptionApproval.required_role == role_value,
                ExceptionApproval.status == "PENDING",
            )
        )
    ).scalars().first()
    return found is not None


@router.post("/{exception_id}/approve", response_model=ExceptionRequestOut)
async def decide_exception(
    exception_id: int,
    payload: ExceptionDecisionBody,
    claims: dict = Depends(
        require_any_permission("approve_claims", "configure_policy", "approve_exception")
    ),
    db: AsyncSession = Depends(get_db),
) -> ExceptionRequestOut:
    row = await decide_exception_request(exception_id, int(claims["sub"]), payload.approve, payload.comment, db)
    return row


@router.post("/{exception_id}/decide-items", response_model=ExceptionRequestOut)
async def decide_exception_items(
    exception_id: int,
    payload: ExceptionItemsDecisionBody,
    claims: dict = Depends(
        require_any_permission("approve_claims", "configure_policy", "approve_exception")
    ),
    db: AsyncSession = Depends(get_db),
) -> ExceptionRequestOut:
    """A claim's exceptions, decided one by one: Accept / Reject / Send back for every exception
    this step still has to decide, all submitted together."""
    return await decide_claim_exception_items(
        exception_id, int(claims["sub"]), [d.model_dump() for d in payload.decisions], db
    )
