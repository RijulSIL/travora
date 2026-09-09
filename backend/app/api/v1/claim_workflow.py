from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_any_permission, require_permission
from app.models.reimbursement import Invoice
from app.models.travel_booking import TravelTrip
from app.schemas.reimbursement import ClaimDraftOut, InvoiceOut
from app.schemas.travel_booking import TripOut
from app.schemas.workflow import (
    ApprovalActionBody,
    ClaimTimelineEventOut,
    ModifyAmountBody,
    PaymentBody,
    RejectBody,
    SendBackBody,
)
from app.services.claim_response_builder import claim_workflow_bundle_dict
from app.services.reimbursement_service import get_claim_bundle
from app.services.travel_request_service import desk_ticket_ids_for_trips
from app.services.workflow_service import (
    approve_claim_stage,
    assert_user_can_view_claim_workflow,
    get_approval_chain,
    get_claim_timeline,
    list_pending_approvals,
    modify_claim_amount,
    record_claim_payment,
    reject_claim,
    send_back_claim,
)

router = APIRouter(prefix="/claims", tags=["claim-workflow"])


@router.get("/pending-approvals")
async def pending_approvals(
    claims: dict = Depends(require_any_permission("approve_stage_1", "approve_stage_2", "approve_stage_3", "approve_stage_4", "process_payments", "approve_exception")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    return await list_pending_approvals(int(claims["sub"]), db)


@router.get("/{claim_id}")
async def get_claim_detail(
    claim_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        print(f"FETCHING CLAIM DETAIL: {claim_id}")
        claim = await assert_user_can_view_claim_workflow(claim_id, int(claims["sub"]), db)
        _claim, expenses, invoice_ids, trip_ids = await get_claim_bundle(claim.id, claim.employee_user_id, db)
        bundle = claim_workflow_bundle_dict(_claim, expenses, invoice_ids, trip_ids)

        linked_invoices: list[dict] = []
        if invoice_ids:
            inv_rows = (
                await db.execute(select(Invoice).where(Invoice.id.in_(invoice_ids)))
            ).scalars().all()
            inv_by_id = {i.id: i for i in inv_rows}
            linked_invoices = [
                InvoiceOut.model_validate(inv_by_id[iid]).model_dump()
                for iid in invoice_ids
                if iid in inv_by_id
            ]

        linked_trips: list[dict] = []
        if trip_ids:
            trip_rows = (
                await db.execute(select(TravelTrip).where(TravelTrip.id.in_(trip_ids)))
            ).scalars().all()
            desk_ids = await desk_ticket_ids_for_trips(trip_rows, db)
            trip_by_id = {t.id: t for t in trip_rows}
            linked_trips = [
                TripOut.model_validate(trip_by_id[tid])
                .model_copy(update={"desk_ticket_id": desk_ids.get(tid)})
                .model_dump()
                for tid in trip_ids
                if tid in trip_by_id
            ]

        print(f"SUCCESS FETCHING CLAIM DETAIL: {claim_id}")
        return jsonable_encoder({**bundle, "linked_invoices": linked_invoices, "linked_trips": linked_trips})
    except Exception as e:
        import traceback
        print("="*50)
        print(f"GET CLAIM DETAIL ERROR: {e}")
        traceback.print_exc()
        print("="*50)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/{claim_id}/approval-chain")
async def approval_chain(
    claim_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    claim = await assert_user_can_view_claim_workflow(claim_id, int(claims["sub"]), db)
    return await get_approval_chain(claim, db)


@router.get("/{claim_id}/timeline", response_model=list[ClaimTimelineEventOut])
async def claim_timeline(
    claim_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    claim = await assert_user_can_view_claim_workflow(claim_id, int(claims["sub"]), db)
    return await get_claim_timeline(claim, db)


@router.post("/{claim_id}/approve", response_model=ClaimDraftOut)
async def approve_stage(
    claim_id: int,
    payload: ApprovalActionBody | None = None,
    claims: dict = Depends(require_any_permission("approve_stage_1", "approve_stage_2", "approve_stage_3")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    claim = await approve_claim_stage(claim_id, int(claims["sub"]), payload.comment if payload else None, db)
    _claim, expenses, invoice_ids, trip_ids = await get_claim_bundle(claim.id, claim.employee_user_id, db)
    return claim_workflow_bundle_dict(_claim, expenses, invoice_ids, trip_ids)


@router.post("/{claim_id}/send-back", response_model=ClaimDraftOut)
async def send_back(
    claim_id: int,
    payload: SendBackBody,
    claims: dict = Depends(require_any_permission("approve_stage_1", "approve_stage_2", "approve_stage_3")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    claim = await send_back_claim(claim_id, int(claims["sub"]), payload.comment, db)
    _claim, expenses, invoice_ids, trip_ids = await get_claim_bundle(claim.id, claim.employee_user_id, db)
    return claim_workflow_bundle_dict(_claim, expenses, invoice_ids, trip_ids)


@router.post("/{claim_id}/reject", response_model=ClaimDraftOut)
async def reject(
    claim_id: int,
    payload: RejectBody,
    claims: dict = Depends(require_any_permission("approve_stage_1", "approve_stage_2", "approve_stage_3", "process_payments")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    claim = await reject_claim(claim_id, int(claims["sub"]), payload.reason, db)
    _claim, expenses, invoice_ids, trip_ids = await get_claim_bundle(claim.id, claim.employee_user_id, db)
    return claim_workflow_bundle_dict(_claim, expenses, invoice_ids, trip_ids)


@router.post("/{claim_id}/modify-amount", response_model=ClaimDraftOut)
async def modify_amount(
    claim_id: int,
    payload: ModifyAmountBody,
    claims: dict = Depends(require_any_permission("approve_stage_1", "approve_stage_2", "approve_stage_3")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    claim = await modify_claim_amount(claim_id, int(claims["sub"]), payload.new_amount, payload.comment, db)
    _claim, expenses, invoice_ids, trip_ids = await get_claim_bundle(claim.id, claim.employee_user_id, db)
    return claim_workflow_bundle_dict(_claim, expenses, invoice_ids, trip_ids)


@router.post("/{claim_id}/payment", response_model=ClaimDraftOut)
async def record_payment(
    claim_id: int,
    payload: PaymentBody,
    claims: dict = Depends(require_permission("process_payments")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    claim = await record_claim_payment(claim_id, int(claims["sub"]), payload.utr_reference, payload.amount, db)
    _claim, expenses, invoice_ids, trip_ids = await get_claim_bundle(claim.id, claim.employee_user_id, db)
    return claim_workflow_bundle_dict(_claim, expenses, invoice_ids, trip_ids)
