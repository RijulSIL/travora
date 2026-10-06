from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import now_ist
from app.models.claim_workflow import AdvanceRequest, AdvanceRequestStatus


async def get_outstanding_advance(user_id: int, db: AsyncSession) -> Decimal:
    """Total outstanding advance for a user — each grant's own `amount` is now the real
    remaining figure (claim payments and settlements both draw it down directly, see
    workflow_service._draw_down_advance), so this is just a straight sum, not a derived
    approved-minus-deducted calculation."""
    result = await db.execute(
        select(func.sum(AdvanceRequest.amount)).where(
            AdvanceRequest.employee_user_id == user_id,
            AdvanceRequest.status == AdvanceRequestStatus.APPROVED.value,
        )
    )
    total = result.scalar() or Decimal("0")
    return max(total, Decimal("0"))

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

    now = now_ist()
    return (now - oldest_created_at).days
