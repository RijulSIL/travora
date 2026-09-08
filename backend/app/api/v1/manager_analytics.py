from datetime import date

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims
from app.models.auth import Role, User
from app.models.employee import Employee
from app.models.reimbursement import ClaimDraft, ClaimExpense

router = APIRouter(prefix="/reports/manager", tags=["reports"])

@router.get("/team-spend")
async def get_team_spend(
    db: AsyncSession = Depends(get_db),
    claims: dict = Depends(get_current_claims),
):
    try:
        role = Role(claims.get("role"))
    except ValueError:
        role = Role.EMPLOYEE
        
    if role != Role.REPORTING_MANAGER:
        raise HTTPException(status_code=403, detail="Forbidden")

    current_user_id = int(claims["sub"])
    mgr = await db.get(User, current_user_id)
    if not mgr or not mgr.employee_id:
        return {"spend_by_month": [], "spend_by_category": []}

    # Find subordinates
    sub_stmt = select(Employee.employee_id).where(Employee.reporting_manager_id == mgr.employee_id)
    sub_emp_ids = (await db.execute(sub_stmt)).scalars().all()
    if not sub_emp_ids:
        return {"spend_by_month": [], "spend_by_category": []}

    user_stmt = select(User.id).where(User.employee_id.in_(sub_emp_ids))
    team_user_ids = (await db.execute(user_stmt)).scalars().all()
    
    if not team_user_ids:
        return {"spend_by_month": [], "spend_by_category": []}

    # Aggregate spend by month for the last 6 months
    today = date.today()
    six_months_ago = today - relativedelta(months=5)
    start_date = date(six_months_ago.year, six_months_ago.month, 1)

    expenses_result = await db.execute(
        select(ClaimDraft.created_at, ClaimExpense.amount, ClaimExpense.category_name)
        .join(ClaimExpense, ClaimExpense.claim_id == ClaimDraft.id)
        .where(
            ClaimDraft.employee_user_id.in_(team_user_ids),
            ClaimDraft.status.notin_(["DRAFT", "REJECTED"]),
            func.date(ClaimDraft.created_at) >= start_date,
        )
    )
    expenses = expenses_result.all()

    # Process spend by month
    monthly_totals = {}
    for i in range(6):
        d = start_date + relativedelta(months=i)
        month_label = d.strftime("%b")
        monthly_totals[month_label] = {"month": month_label, "budget": 50000, "spend": 0}

    category_totals = {}

    for created_at, amount, cat_name in expenses:
        month_label = created_at.strftime("%b")
        if month_label in monthly_totals:
            monthly_totals[month_label]["spend"] += float(amount)
        
        if cat_name not in category_totals:
            category_totals[cat_name] = 0
        category_totals[cat_name] += float(amount)

    spend_by_month = list(monthly_totals.values())
    
    # Sort categories by spend descending
    sorted_cats = sorted([{"name": k, "value": v} for k, v in category_totals.items()], key=lambda x: x["value"], reverse=True)
    
    return {
        "spend_by_month": spend_by_month,
        "spend_by_category": sorted_cats
    }
