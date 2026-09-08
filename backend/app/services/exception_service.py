from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User
from app.models.claim_workflow import ExceptionRequest, ExceptionRequestStatus
from app.models.employee import Employee
from app.models.policy import AirEligibility, ImpactLevel
from app.models.reimbursement import ClaimDraft, ClaimExpense


async def detect_claim_exceptions(claim: ClaimDraft, expenses: list[ClaimExpense], db: AsyncSession) -> list[dict]:
    exceptions = []
    
    # 1. Room Rent Deviation
    for exp in expenses:
        if "hotel" in exp.category_name.lower() or "accommodation" in exp.category_name.lower():
            if exp.policy_status in ("HARD_BLOCK", "SOFT_FLAG"):
                exceptions.append({
                    "type": "ROOM_RENT_DEVIATION",
                    "description": f"Hotel expense of {exp.amount} exceeds policy cap of {exp.cap_amount}."
                })

    # 2. Air Travel for Level 5/6 (or conditional/no eligibility)
    user = await db.get(User, claim.employee_user_id)
    if user and user.employee_id:
        emp = await db.get(Employee, user.employee_id)
        if emp and emp.impact_level_id:
            impact = await db.get(ImpactLevel, emp.impact_level_id)
            if impact:
                # Check for air travel in expenses or linked trips
                has_air = any("air" in exp.category_name.lower() or "flight" in exp.category_name.lower() for exp in expenses)
                if has_air and impact.air_eligibility in (AirEligibility.NO, AirEligibility.CONDITIONAL):
                    exceptions.append({
                        "type": "AIR_TRAVEL_L5_L6",
                        "description": f"Air travel claimed by employee at {impact.level_code} level ({impact.air_eligibility.value})."
                    })
                
                # 3. Hired Taxi for Level 4+ (not eligible for hired taxi)
                # Local conveyance mode check
                # PRD says Hired Taxi for Level 4+ is an exception
                has_hired_taxi = any("hired taxi" in exp.category_name.lower() or "taxi" in exp.category_name.lower() for exp in expenses)
                if has_hired_taxi and impact.level_code.startswith(("L4", "L5", "L6")):
                    # Check if 'Hired Taxi' is in local_conveyance_modes
                    modes = impact.local_conveyance_modes or []
                    if "Hired Taxi" not in modes:
                        exceptions.append({
                            "type": "HIRED_TAXI_UNAUTHORIZED",
                            "description": f"Hired Taxi claimed by {impact.level_code} employee (not in eligible modes)."
                        })

    # 4. Tatkal Train Booking
    from app.models.reimbursement import ClaimInvoice, InvoiceField
    
    tatkal_query = select(InvoiceField).join(
        ClaimInvoice, ClaimInvoice.invoice_id == InvoiceField.invoice_id
    ).where(
        ClaimInvoice.claim_id == claim.id,
        InvoiceField.field_key == "is_tatkal",
        InvoiceField.final_value == "true"
    )
    tatkal_fields = (await db.execute(tatkal_query)).scalars().all()
    
    if len(tatkal_fields) > 0:
        exceptions.append({
            "type": "TRAIN_TATKAL",
            "description": "Tatkal train booking explicitly flagged on invoice. Requires Function Head approval."
        })

    return exceptions

async def trigger_exceptions_if_needed(claim: ClaimDraft, expenses: list[ClaimExpense], db: AsyncSession) -> bool:
    """Detects and creates exception requests. Returns True if exceptions were created."""
    exception_defs = await detect_claim_exceptions(claim, expenses, db)
    if not exception_defs:
        return False
        
    for edef in exception_defs:
        # Check if already exists for this claim
        existing = await db.execute(
            select(ExceptionRequest).where(
                ExceptionRequest.claim_id == claim.id,
                ExceptionRequest.exception_type == edef["type"]
            )
        )
        if existing.scalar_one_or_none():
            continue
            
        req = ExceptionRequest(
            claim_id=claim.id,
            requested_by_user_id=claim.employee_user_id,
            exception_type=edef["type"],
            description=edef["description"],
            status=ExceptionRequestStatus.PENDING.value
        )
        db.add(req)
        
    await db.flush()
    return True
