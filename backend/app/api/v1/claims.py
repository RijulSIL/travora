from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
# Triggering reload to see if it fixes the hang

from app.core.database import get_db
from app.core.rbac import PERMISSION_MATRIX, get_current_claims, require_any_permission, require_permission
from app.models.auth import Role
from app.models.reimbursement import ClaimDraft, ClaimExpense, ClaimInvoice, ClaimTrip
from app.schemas.reimbursement import ClaimDraftIn, ClaimDraftOut, PolicyCheckOut
from app.services.reimbursement_service import (
    create_or_update_claim_draft,
    get_claim_bundle,
    list_claims,
    list_claims_all,
    submit_claim,
)

router = APIRouter(prefix="/claims", tags=["claims"])


def _claim_response(claim: ClaimDraft, expenses: list, invoice_ids: list[int], trip_ids: list[int]) -> dict:
    from app.schemas.reimbursement import ClaimExpenseOut
    return {
        **ClaimDraftOut.model_validate(claim).model_dump(exclude={"expenses", "invoice_ids"}),
        "expenses": [ClaimExpenseOut.model_validate(e).model_dump() for e in expenses],
        "invoice_ids": invoice_ids,
        "trip_ids": trip_ids,
    }


@router.post("/draft", response_model=ClaimDraftOut, dependencies=[Depends(require_permission("submit_claim"))])
async def save_claim_draft(
    payload: ClaimDraftIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    claim, expenses, invoice_ids, trip_ids = await create_or_update_claim_draft(
        payload, int(claims["sub"]), db
    )
    return _claim_response(claim, expenses, invoice_ids, trip_ids)


@router.get(
    "",
    response_model=list[ClaimDraftOut],
    dependencies=[Depends(require_any_permission("submit_claim", "view_reports", "process_payments"))],
)
async def employee_claims(
    employee_user_id: int | None = None,
    all_claims: bool = False,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    current_user_id = int(claims["sub"])
    try:
        role = Role(claims.get("role"))
    except ValueError:
        role = Role.EMPLOYEE

    if all_claims:
        allowed = PERMISSION_MATRIX.get(role, set())
        if not (allowed & {"view_reports", "process_payments"}):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        rows = await list_claims_all(db)
        response = []
        for claim in rows:
            expenses = (
                await db.execute(
                    select(ClaimExpense).where(ClaimExpense.claim_id == claim.id)
                )
            ).scalars().all()
            invoice_ids = list(
                (
                    await db.execute(
                        select(ClaimInvoice.invoice_id).where(ClaimInvoice.claim_id == claim.id)
                    )
                ).scalars().all()
            )
            trip_ids = list(
                (
                    await db.execute(
                        select(ClaimTrip.trip_id).where(ClaimTrip.claim_id == claim.id)
                    )
                ).scalars().all()
            )
            response.append(_claim_response(claim, expenses, invoice_ids, trip_ids))
        return response

    requested_user_id = employee_user_id
    if requested_user_id and requested_user_id != current_user_id:
        if role not in {Role.IT_ADMIN, Role.FINANCE, Role.HRBP_HR, Role.REPORTING_MANAGER, Role.PAYROLL, Role.CEO, Role.GROUP_HEAD_HR}:
            requested_user_id = current_user_id
    rows = await list_claims(current_user_id, db, employee_user_id=requested_user_id)
    response = []
    for claim in rows:
        if claim.employee_user_id == current_user_id:
            _claim, expenses, invoice_ids, trip_ids = await get_claim_bundle(claim.id, current_user_id, db)
            response.append(_claim_response(_claim, expenses, invoice_ids, trip_ids))
            continue
        expenses = (
            await db.execute(
                select(ClaimExpense).where(ClaimExpense.claim_id == claim.id)
            )
        ).scalars().all()
        invoice_ids = (
            await db.execute(
                select(ClaimInvoice.invoice_id).where(ClaimInvoice.claim_id == claim.id)
            )
        ).scalars().all()
        trip_ids = (
            await db.execute(
                select(ClaimTrip.trip_id).where(ClaimTrip.claim_id == claim.id)
            )
        ).scalars().all()
        response.append(_claim_response(claim, expenses, list(invoice_ids), list(trip_ids)))
    return response


@router.get(
    "/{claim_id}/policy-check",
    response_model=PolicyCheckOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def policy_check(
    claim_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    claim, expenses, _invoice_ids, _trip_ids = await get_claim_bundle(claim_id, int(claims["sub"]), db)
    report = claim.compliance_report or {}
    total_claimed = Decimal(str(report.get("total_claimed", "0")))
    return {
        "id": claim.id,
        "city_group": claim.destination_city_group,
        "total_claimed": total_claimed,
        "advance_received": claim.advance_received,
        "net_payable": Decimal(str(report.get("net_payable", total_claimed - claim.advance_received))),
        "exceptions": report.get("exceptions", []),
        "gst_summary": report.get("gst_summary", {}),
        "expenses": expenses,
    }


@router.get(
    "/team",
)
async def team_claims(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    from app.models.auth import User
    from app.models.employee import Employee
    from app.core.rbac import require_role
    
    # Check role manually
    if claims.get("role") not in ["REPORTING_MANAGER", "IT_ADMIN"]:
        raise HTTPException(status_code=403, detail="Only managers can view team claims")
    
    try:
        role = Role(claims.get("role"))
    except ValueError:
        role = Role.EMPLOYEE
        
    if role != Role.REPORTING_MANAGER:
        raise HTTPException(status_code=403, detail="Forbidden")
        
    current_user_id = int(claims["sub"])
    mgr = await db.get(User, current_user_id)
    if not mgr or not mgr.employee_id:
        return []
        
    # Find subordinates
    sub_stmt = select(Employee.employee_id).where(Employee.reporting_manager_id == mgr.employee_id)
    sub_emp_ids = (await db.execute(sub_stmt)).scalars().all()
    if not sub_emp_ids:
        return []
        
    user_stmt = select(User.id).where(User.employee_id.in_(sub_emp_ids))
    sub_user_ids = (await db.execute(user_stmt)).scalars().all()
    if not sub_user_ids:
        return []
        
    # Fetch claims for subordinates
    from app.models.reimbursement import ClaimStatus
    stmt = select(ClaimDraft).where(
        ClaimDraft.employee_user_id.in_(sub_user_ids),
        ClaimDraft.status != ClaimStatus.DRAFT.value
    )
    rows = (await db.execute(stmt)).scalars().all()
    
    response = []
    for claim in rows:
        expenses = (
            await db.execute(
                select(ClaimExpense).where(ClaimExpense.claim_id == claim.id)
            )
        ).scalars().all()
        invoice_ids = list(
            (
                await db.execute(
                    select(ClaimInvoice.invoice_id).where(ClaimInvoice.claim_id == claim.id)
                )
            ).scalars().all()
        )
        trip_ids = list(
            (
                await db.execute(
                    select(ClaimTrip.trip_id).where(ClaimTrip.claim_id == claim.id)
                )
            ).scalars().all()
        )
        response.append(_claim_response(claim, expenses, invoice_ids, trip_ids))
    return response


@router.get(
    "/team/spend",
)
async def team_spend(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from app.models.auth import User
    from app.models.employee import Employee
    
    try:
        role = Role(claims.get("role"))
    except ValueError:
        role = Role.EMPLOYEE
        
    if role != Role.REPORTING_MANAGER:
        raise HTTPException(status_code=403, detail="Forbidden")
        
    current_user_id = int(claims["sub"])
    mgr = await db.get(User, current_user_id)
    if not mgr or not mgr.employee_id:
        return {"total_spend": 0, "by_category": {}}
        
    # Find subordinates
    sub_stmt = select(Employee.employee_id).where(Employee.reporting_manager_id == mgr.employee_id)
    sub_emp_ids = (await db.execute(sub_stmt)).scalars().all()
    if not sub_emp_ids:
        return {"total_spend": 0, "by_category": {}}
        
    user_stmt = select(User.id).where(User.employee_id.in_(sub_emp_ids))
    sub_user_ids = (await db.execute(user_stmt)).scalars().all()
    if not sub_user_ids:
        return {"total_spend": 0, "by_category": {}}
        
    # Fetch claims for subordinates (only fully approved ones)
    from app.models.reimbursement import ClaimStatus
    stmt = select(ClaimDraft).where(
        ClaimDraft.employee_user_id.in_(sub_user_ids),
        ClaimDraft.status.in_([ClaimStatus.READY_FOR_PAYMENT.value, ClaimStatus.PAID.value])
    )
    rows = (await db.execute(stmt)).scalars().all()
    
    total_spend = Decimal("0")
    by_category = {}
    
    for claim in rows:
        report = claim.compliance_report or {}
        total_claimed = Decimal(str(report.get("total_claimed", "0")))
        total_spend += total_claimed
        
        # Breakdown by category
        expenses = (
            await db.execute(
                select(ClaimExpense).where(ClaimExpense.claim_id == claim.id)
            )
        ).scalars().all()
        
        for exp in expenses:
            cat = exp.category_name or "Other"
            amt = exp.amount or Decimal("0")
            by_category[cat] = by_category.get(cat, Decimal("0")) + amt
            
    return {
        "total_spend": total_spend,
        "by_category": by_category,
    }


@router.post(
    "/{claim_id}/submit",
    response_model=ClaimDraftOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def submit_employee_claim(
    claim_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    claim = await submit_claim(claim_id, int(claims["sub"]), db)
    _claim, expenses, invoice_ids, trip_ids = await get_claim_bundle(claim.id, int(claims["sub"]), db)
    return _claim_response(_claim, expenses, invoice_ids, trip_ids)
