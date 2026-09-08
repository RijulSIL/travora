import asyncio
from datetime import datetime, UTC
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import AsyncSessionLocal
from app.models.claim_workflow import ClaimApprovalStage, ClaimApprovalStageStatus, NotificationCategory
from app.models.reimbursement import ClaimDraft
from app.models.employee import Employee
from app.models.auth import User, Role
from app.services.notification_service import create_notification

def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)

async def monitor_slas(db: AsyncSession):
    """
    Check for pending claim stages with breached SLAs and escalate/notify.
    """
    now = _now()
    
    # Query for pending stages with breached SLAs
    result = await db.execute(
        select(ClaimApprovalStage, ClaimDraft)
        .join(ClaimDraft, ClaimDraft.id == ClaimApprovalStage.claim_id)
        .where(
            ClaimApprovalStage.status == ClaimApprovalStageStatus.PENDING.value,
            ClaimApprovalStage.sla_deadline_at < now
        )
    )
    rows = result.all()
    
    for stage, claim in rows:
        print(f"SLA breached for Claim {claim.id} at Stage {stage.stage_number}")
        
        # Find the employee and managers
        emp = await db.get(Employee, claim.employee_id)
        if not emp:
            continue
            
        manager_id = emp.reporting_manager_id
        if not manager_id:
            continue
            
        manager_emp = await db.get(Employee, manager_id)
        if not manager_emp:
            continue
            
        skip_level_manager_id = manager_emp.reporting_manager_id
        if not skip_level_manager_id:
            continue
            
        # Find the skip-level manager user to notify
        skip_level_user_result = await db.execute(
            select(User).where(User.employee_id == skip_level_manager_id)
        )
        skip_level_user = skip_level_user_result.scalar_one_or_none()
        
        if skip_level_user:
            print(f"Notifying skip-level manager {skip_level_user.email}")
            await create_notification(
                user_id=skip_level_user.id,
                title=f"SLA Breach Escalation: Claim {claim.claim_reference or claim.id}",
                body=f"Stage {stage.stage_number} is overdue. Escalated to you as skip-level manager.",
                link=f"/claims/{claim.id}/review",
                category=NotificationCategory.SLA_BREACH.value,
                db=db,
            )
            
    await db.commit()

if __name__ == "__main__":
    async def main():
        async with AsyncSessionLocal() as db:
            await monitor_slas(db)
            
    asyncio.run(main())
