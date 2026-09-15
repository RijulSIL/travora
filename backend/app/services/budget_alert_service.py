"""Budget alerts are informational only — nothing is blocked when a team runs over.

When a manager's team crosses 75% of its configured monthly spend budget, and again if it
crosses 100%, the manager (and only the manager) gets a one-time notification/email for that
threshold for that calendar month. Checked right after a claim is submitted, since that's the
same moment `ClaimDraft`/`ClaimExpense` rows start counting toward "spend" in the team-spend report.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User
from app.models.claim_workflow import Notification
from app.models.employee import Employee
from app.models.reimbursement import ClaimDraft, ClaimExpense
from app.services.budget_service import get_effective_budget, is_budgets_enabled
from app.services.notification_service import create_notification

_BUDGET_ALERT_CATEGORY = "BUDGET_ALERT"


def _fmt_inr(value: Decimal) -> str:
    return f"₹{value.quantize(Decimal('0.01')):,}"


async def check_and_notify_budget_threshold(employee_user_id: int, db: AsyncSession) -> None:
    if not await is_budgets_enabled(db):
        return

    employee_user = await db.get(User, employee_user_id)
    if employee_user is None or not employee_user.employee_id:
        return
    emp = await db.get(Employee, employee_user.employee_id)
    if emp is None or not emp.reporting_manager_id:
        return

    manager = (
        await db.execute(select(User).where(User.employee_id == emp.reporting_manager_id))
    ).scalar_one_or_none()
    if manager is None:
        return

    effective_budget, _source = await get_effective_budget(manager.id, db)
    if effective_budget is None or effective_budget <= 0:
        return

    sub_emp_ids = (
        await db.execute(select(Employee.employee_id).where(Employee.reporting_manager_id == emp.reporting_manager_id))
    ).scalars().all()
    if not sub_emp_ids:
        return
    team_user_ids = (await db.execute(select(User.id).where(User.employee_id.in_(sub_emp_ids)))).scalars().all()
    if not team_user_ids:
        return

    today = date.today()
    month_start = date(today.year, today.month, 1)
    spend = Decimal(
        str(
            (
                await db.execute(
                    select(func.coalesce(func.sum(ClaimExpense.amount), 0))
                    .select_from(ClaimExpense)
                    .join(ClaimDraft, ClaimDraft.id == ClaimExpense.claim_id)
                    .where(
                        ClaimDraft.employee_user_id.in_(team_user_ids),
                        ClaimDraft.status.notin_(["DRAFT", "REJECTED"]),
                        func.date(ClaimDraft.created_at) >= month_start,
                    )
                )
            ).scalar_one()
            or 0
        )
    )

    utilization = spend / effective_budget
    if utilization >= Decimal("1"):
        title = f"Team budget breach — {today.strftime('%b %Y')}"
        body = (
            f"Your team has spent {_fmt_inr(spend)} against a monthly budget of {_fmt_inr(effective_budget)} "
            f"for {today.strftime('%B %Y')}. Nothing is blocked — this is for your visibility, and your "
            "team spend chart will now show the deficit."
        )
    elif utilization >= Decimal("0.75"):
        title = f"Team budget reminder — {today.strftime('%b %Y')}"
        body = (
            f"Your team has spent {_fmt_inr(spend)} of the {_fmt_inr(effective_budget)} monthly budget "
            f"for {today.strftime('%B %Y')}, crossing 75% utilization."
        )
    else:
        return

    # "reminder" (75%) and "breach" (100%) never share a title, so this is already a
    # unique dedupe key per manager per month per threshold — no extra marker needed.
    already_sent = (
        await db.execute(
            select(Notification.sqlid).where(
                Notification.user_id == manager.id,
                Notification.category == _BUDGET_ALERT_CATEGORY,
                Notification.title == title,
            )
        )
    ).first()
    if already_sent:
        return

    await create_notification(
        user_id=manager.id,
        title=title,
        body=body,
        link="/dashboard",
        category=_BUDGET_ALERT_CATEGORY,
        db=db,
    )
    # create_notification() only adds+flushes; this call owns its own commit so the
    # alert persists regardless of what the caller does with its transaction afterward.
    await db.commit()
