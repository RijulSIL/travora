from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.claim_workflow import AdvanceRequest, AdvanceRequestStatus
from app.models.reimbursement import ClaimDraft, ClaimStatus


async def get_outstanding_advance(user_id: int, db: AsyncSession) -> Decimal:
    """
    Calculate the total outstanding advance amount for a user.
    Outstanding = Sum of Approved Advances - Sum of advances deducted on PAID claims.
    """
    # Sum of approved advances
    adv_result = await db.execute(
        select(func.sum(AdvanceRequest.amount))
        .where(
            AdvanceRequest.employee_user_id == user_id,
            AdvanceRequest.status == AdvanceRequestStatus.APPROVED.value
        )
    )
    approved_sum = adv_result.scalar() or Decimal("0")

    # Sum of advances deducted on paid claims
    claim_result = await db.execute(
        select(func.sum(ClaimDraft.advance_received))
        .where(
            ClaimDraft.employee_user_id == user_id,
            ClaimDraft.status == ClaimStatus.PAID
        )
    )
    deducted_sum = claim_result.scalar() or Decimal("0")

    outstanding = approved_sum - deducted_sum
    return max(outstanding, Decimal("0"))

async def get_advance_aging(user_id: int, db: AsyncSession) -> int:
    """
    Calculate the days outstanding for the oldest approved advance that hasn't been fully covered.
    For simplicity, if there is any outstanding advance, we return the age of the oldest approved advance.
    """
    outstanding = await get_outstanding_advance(user_id, db)
    if outstanding <= 0:
        return 0

    # Get the oldest approved advance
    result = await db.execute(
        select(AdvanceRequest.created_at)
        .where(
            AdvanceRequest.employee_user_id == user_id,
            AdvanceRequest.status == AdvanceRequestStatus.APPROVED.value
        )
        .order_by(AdvanceRequest.created_at.asc())
        .limit(1)
    )
    oldest_created_at = result.scalar()
    if not oldest_created_at:
        return 0

    now = datetime.now()
    return (now - oldest_created_at).days
