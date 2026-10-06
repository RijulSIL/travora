import asyncio
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.timezone import now_ist
from app.models.auth import Role, User
from app.models.claim_workflow import AdvanceRequest, AdvanceRequestStatus, NotificationCategory
from app.services.advance_service import get_outstanding_advance
from app.services.audit_service import log_event
from app.services.notification_service import create_notification


def _now() -> datetime:
    return now_ist()

async def monitor_advances(db: AsyncSession):
    """
    Escalate advances still outstanding after 21 days — to Finance only, since advances are
    a Finance-only concern end to end (no employee reminder, no Payroll/HRBP visibility).
    """
    now = _now()

    result = await db.execute(
        select(AdvanceRequest, User)
        .join(User, User.id == AdvanceRequest.employee_user_id)
        .where(AdvanceRequest.status == AdvanceRequestStatus.APPROVED.value)
    )
    rows = result.all()

    checked_employees: set[int] = set()
    for adv, user in rows:
        age_days = (now - adv.created_at).days if adv.created_at else 0
        if age_days < 21 or adv.employee_user_id in checked_employees:
            continue
        checked_employees.add(adv.employee_user_id)

        # A grant this old may already be fully drawn down by paid claims — only escalate
        # while the employee's pooled balance (see get_outstanding_advance) is still nonzero.
        if await get_outstanding_advance(adv.employee_user_id, db) <= 0:
            continue

        finance_result = await db.execute(select(User).where(User.role == Role.FINANCE))
        finance_users = finance_result.scalars().all()

        for finance_user in finance_users:
            await create_notification(
                user_id=finance_user.id,
                title=f"Advance outstanding (Day {age_days})",
                body=f"Employee {user.full_name or user.email} still has an outstanding advance for {age_days}+ days.",
                link="/finance/advances",
                category=NotificationCategory.ADVANCE.value,
                db=db,
            )

        await log_event(
            entity_type="advance_request",
            entity_id=str(adv.id),
            action="day21_escalation_sent",
            actor_id=None,
            old=None,
            new={"age_days": age_days},
            db=db,
        )

    await db.commit()

if __name__ == "__main__":
    async def main():
        async with AsyncSessionLocal() as db:
            await monitor_advances(db)
            
    asyncio.run(main())
