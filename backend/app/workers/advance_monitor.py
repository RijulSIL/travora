import asyncio
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.auth import Role, User
from app.models.claim_workflow import AdvanceRequest, AdvanceRequestStatus, NotificationCategory
from app.services.audit_service import log_event
from app.services.notification_service import create_notification


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)

async def monitor_advances(db: AsyncSession):
    """
    Check for outstanding advances and send notifications at 15 and 21 day marks.
    """
    now = _now()
    
    # Query for pending/approved advances
    result = await db.execute(
        select(AdvanceRequest, User)
        .join(User, User.id == AdvanceRequest.employee_user_id)
        .where(
            AdvanceRequest.status.in_([
                AdvanceRequestStatus.IN_APPROVAL.value, 
                AdvanceRequestStatus.APPROVED.value
            ])
        )
    )
    rows = result.all()
    
    for adv, user in rows:
        age_days = (now - adv.created_at).days if adv.created_at else 0
        
        # Day 15: Reminder to Employee
        if age_days == 15:
            await create_notification(
                user_id=user.id,
                title="Reminder: Outstanding Advance",
                body=f"Your advance of INR {adv.amount} has been outstanding for 15 days. Please settle it by submitting a claim.",
                link="/advances/my",
                category=NotificationCategory.ADVANCE.value,
                db=db,
            )
            await log_event(
                entity_type="advance_request",
                entity_id=str(adv.id),
                action="day15_reminder_sent",
                actor_id=None,
                old=None,
                new={"age_days": 15},
                db=db
            )
            
        # Day 21: Escalation to Payroll/HR
        elif age_days >= 21:
            # Notify Payroll and HRBP roles
            approvers_result = await db.execute(
                select(User).where(User.role.in_([Role.PAYROLL, Role.HRBP_HR]))
            )
            approvers = approvers_result.scalars().all()
            
            for approver in approvers:
                await create_notification(
                    user_id=approver.id,
                    title=f"Critical: Advance Outstanding (Day {age_days})",
                    body=f"Employee {user.full_name or user.email} has an outstanding advance of INR {adv.amount} for {age_days} days.",
                    link=f"/admin/advances?user_id={user.id}",
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
                db=db
            )
            
    await db.commit()

if __name__ == "__main__":
    async def main():
        async with AsyncSessionLocal() as db:
            await monitor_advances(db)
            
    asyncio.run(main())
