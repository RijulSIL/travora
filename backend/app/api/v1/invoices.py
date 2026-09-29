from datetime import date
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_any_permission, require_permission
from app.models.reimbursement import ClaimStatus, Invoice, InvoiceField, ReimbursementCategory
from app.schemas.reimbursement import (
    DuplicateCheckOut,
    GstinValidationOut,
    GstinValidationRequest,
    InvoiceExtractionOut,
    InvoiceFieldsUpdateRequest,
    InvoiceOut,
)
from app.services.reimbursement_service import (
    INVOICE_LOCKING_CLAIM_STATUSES,
    delete_invoice,
    get_invoice_claim_link,
    get_invoice_extraction,
    get_invoice_for_view,
    store_invoice_upload,
    store_payment_proof,
    update_invoice_fields,
    validate_gstin,
)

router = APIRouter(
    prefix="/invoices",
    tags=["invoices"],
)


def _effective_grand_total(fields: list[InvoiceField]) -> Decimal:
    """A non-INR invoice carries its original-currency grand_total plus a separate
    grand_total_inr_estimate conversion (see reimbursement_service._persist_parsed_
    extraction) — the conversion, when present, is the real amount everything downstream
    should use; grand_total is kept only as reference to what the document actually said."""
    by_key = {f.field_key: f for f in fields}
    for key in ("grand_total_inr_estimate", "grand_total"):
        field = by_key.get(key)
        if field is None:
            continue
        amount_str = field.final_value or field.original_value
        if not amount_str:
            continue
        try:
            return Decimal(amount_str)
        except Exception:
            continue
    return Decimal("0")


@router.post(
    "/upload",
    response_model=InvoiceOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def upload_invoice(
    file: UploadFile = File(...),
    reimbursement_category: ReimbursementCategory = Form(ReimbursementCategory.TRAVEL),
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> Invoice:
    try:
        content = await file.read()
        return await store_invoice_upload(
            user_id=int(claims["sub"]),
            filename=file.filename or "invoice",
            content_type=file.content_type or "application/octet-stream",
            content=content,
            db=db,
            reimbursement_category=reimbursement_category,
        )
    except Exception as e:
        import traceback
        print("="*50)
        print(f"UPLOAD ERROR: {e}")
        traceback.print_exc()
        print("="*50)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "",
    response_model=list[InvoiceOut],
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def list_invoices(
    unlinked: bool = Query(False),
    editing_claim_id: int | None = Query(None),
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import func

    from app.models.reimbursement import ClaimDraft, ClaimInvoice, ClaimStatus

    # assert_invoices_eligible_for_claim is meant to keep at most one non-rejected claim
    # link per invoice, but that hasn't always held in practice (data seen with an invoice
    # linked to two different non-rejected claims) — a plain join would fan such an invoice
    # out into duplicate rows. Pin the join to a single relevant link id per invoice so
    # this stays one row per invoice no matter what the data actually contains.
    active_invoice_ids = (
        select(ClaimInvoice.invoice_id)
        .join(ClaimDraft, ClaimDraft.id == ClaimInvoice.claim_id)
        .where(ClaimDraft.status != ClaimStatus.REJECTED)
    )

    # Prefer the invoice's current non-rejected link (it's still "in use"); only surface
    # a rejected link — for the Archived Invoices history view — when nothing else holds
    # the invoice. This does not affect reuse eligibility, which stays governed entirely
    # by assert_invoices_eligible_for_claim / the `unlinked` filter below.
    relevant_link_ids = (
        select(func.max(ClaimInvoice.id))
        .join(ClaimDraft, ClaimDraft.id == ClaimInvoice.claim_id)
        .where(
            or_(
                ClaimDraft.status != ClaimStatus.REJECTED,
                and_(
                    ClaimDraft.status == ClaimStatus.REJECTED,
                    ClaimInvoice.invoice_id.not_in(active_invoice_ids),
                ),
            )
        )
        .group_by(ClaimInvoice.invoice_id)
        .scalar_subquery()
    )

    grand_total_field = aliased(InvoiceField)
    inr_estimate_field = aliased(InvoiceField)
    query = (
        select(
            Invoice,
            grand_total_field.final_value,
            grand_total_field.original_value,
            inr_estimate_field.final_value,
            inr_estimate_field.original_value,
            ClaimDraft.id,
            ClaimDraft.status,
            ClaimDraft.claim_reference,
        )
        .outerjoin(
            grand_total_field,
            and_(
                grand_total_field.invoice_id == Invoice.id,
                grand_total_field.field_key == "grand_total",
            ),
        )
        .outerjoin(
            # Non-INR invoices carry an original-currency grand_total plus this separate
            # INR conversion (see reimbursement_service._persist_parsed_extraction) — the
            # conversion, not the original-currency figure, is the real amount to display.
            inr_estimate_field,
            and_(
                inr_estimate_field.invoice_id == Invoice.id,
                inr_estimate_field.field_key == "grand_total_inr_estimate",
            ),
        )
        .outerjoin(
            ClaimInvoice,
            and_(ClaimInvoice.invoice_id == Invoice.id, ClaimInvoice.id.in_(relevant_link_ids)),
        )
        .outerjoin(ClaimDraft, ClaimDraft.id == ClaimInvoice.claim_id)
        .where(Invoice.uploader_user_id == int(claims["sub"]))
    )

    if unlinked:
        # Matches assert_invoices_eligible_for_claim: any claim history at all — even a
        # rejected one — retires the invoice from direct reuse. Re-uploading the same file
        # is the only way back in (see store_invoice_upload). Exception: when editing an
        # existing claim, that claim's own already-linked invoices must still show up here
        # (as already-selected) — otherwise re-opening a sent-back claim in the wizard shows
        # "no invoices" for a claim that actually has one, since its own link is what's
        # excluding it.
        subq = select(ClaimInvoice.invoice_id)
        if editing_claim_id is not None:
            subq = subq.where(ClaimInvoice.claim_id != editing_claim_id)
        query = query.where(Invoice.id.not_in(subq))

    result = await db.execute(query.order_by(Invoice.created_at.desc()))
    rows = result.all()

    invoices_list = []
    for invoice, final_val, orig_val, est_final_val, est_orig_val, claim_id, claim_status, claim_reference in rows:
        amount_str = est_final_val or est_orig_val or final_val or orig_val or "0"
        try:
            total_amount = Decimal(amount_str)
        except Exception:
            total_amount = Decimal("0")

        inv_dict = {
            "id": invoice.id,
            "original_filename": invoice.original_filename,
            "content_type": invoice.content_type,
            "file_size_bytes": invoice.file_size_bytes,
            "status": invoice.status,
            "duplicate_invoice_id": invoice.duplicate_invoice_id,
            "duplicate_acknowledged": invoice.duplicate_acknowledged,
            "gstin_validation_status": invoice.gstin_validation_status,
            "extraction_error": invoice.extraction_error,
            "created_at": invoice.created_at,
            "total_amount": total_amount,
            "reimbursement_category": invoice.reimbursement_category,
            "payment_proof_original_filename": invoice.payment_proof_original_filename,
            "payment_proof_uploaded_at": invoice.payment_proof_uploaded_at,
            "linked_claim_id": claim_id,
            "linked_claim_reference": claim_reference,
            "linked_claim_status": claim_status.value if claim_status else None,
            "is_archived": claim_status in INVOICE_LOCKING_CLAIM_STATUSES,
            "is_locked": claim_status in INVOICE_LOCKING_CLAIM_STATUSES,
            # Matches delete_invoice: a rejected-only history doesn't block deletion,
            # only a still-active (non-rejected) claim link does.
            "can_delete": claim_status is None or claim_status == ClaimStatus.REJECTED,
        }
        invoices_list.append(inv_dict)

    return invoices_list


@router.get(
    "/duplicate-check",
    response_model=DuplicateCheckOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def duplicate_check(
    vendor_name: str = Query(...),
    invoice_date: date = Query(...),
    grand_total: Decimal = Query(...),
    db: AsyncSession = Depends(get_db),
) -> DuplicateCheckOut:
    candidates = (await db.execute(select(Invoice.id))).scalars().all()
    target = {
        "vendor_name": vendor_name,
        "invoice_date": invoice_date.isoformat(),
        "grand_total": str(grand_total),
    }
    for invoice_id in candidates:
        fields = {
            field.field_key: field.final_value or field.original_value
            for field in (
                await db.execute(select(InvoiceField).where(InvoiceField.invoice_id == invoice_id))
            ).scalars()
        }
        if all(fields.get(key) == value for key, value in target.items()):
            return DuplicateCheckOut(duplicate_invoice_id=invoice_id, is_duplicate=True)
    return DuplicateCheckOut(duplicate_invoice_id=None, is_duplicate=False)


@router.get(
    "/{invoice_id}/extraction",
    response_model=InvoiceExtractionOut,
    dependencies=[
        Depends(require_any_permission("submit_claim", "view_reports", "process_payments"))
    ],
)
async def invoice_extraction(
    invoice_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    invoice, fields, line_items = await get_invoice_extraction(
        invoice_id, int(claims["sub"]), db
    )
    total_amount = _effective_grand_total(fields)

    claim_id, claim_reference, claim_status = await get_invoice_claim_link(invoice_id, db)

    invoice_dict = InvoiceOut.model_validate(invoice).model_dump()
    invoice_dict["total_amount"] = total_amount
    invoice_dict["linked_claim_id"] = claim_id
    invoice_dict["linked_claim_reference"] = claim_reference
    invoice_dict["linked_claim_status"] = claim_status.value if claim_status else None
    invoice_dict["is_archived"] = claim_status in INVOICE_LOCKING_CLAIM_STATUSES
    invoice_dict["is_locked"] = claim_status in INVOICE_LOCKING_CLAIM_STATUSES
    invoice_dict["can_delete"] = claim_status is None or claim_status == ClaimStatus.REJECTED
    return {
        **invoice_dict,
        "fields": fields,
        "line_items": line_items,
    }


@router.get(
    "/{invoice_id}/file",
    dependencies=[
        Depends(require_any_permission("submit_claim", "view_reports", "process_payments"))
    ],
)
async def invoice_file(
    invoice_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    invoice = await get_invoice_for_view(invoice_id, int(claims["sub"]), db)
    filename = invoice.original_filename or f"invoice-{invoice.id}"
    return FileResponse(
        path=Path(invoice.storage_path),
        media_type=invoice.content_type or "application/octet-stream",
        filename=filename,
    )


@router.post(
    "/{invoice_id}/payment-proof",
    response_model=InvoiceOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def upload_payment_proof(
    invoice_id: int,
    file: UploadFile = File(...),
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> Invoice:
    content = await file.read()
    return await store_payment_proof(
        invoice_id=invoice_id,
        user_id=int(claims["sub"]),
        filename=file.filename or "payment-proof",
        content_type=file.content_type or "application/octet-stream",
        content=content,
        db=db,
    )


@router.get(
    "/{invoice_id}/payment-proof-file",
    dependencies=[
        Depends(require_any_permission("submit_claim", "view_reports", "process_payments"))
    ],
)
async def payment_proof_file(
    invoice_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    invoice = await get_invoice_for_view(invoice_id, int(claims["sub"]), db)
    if not invoice.payment_proof_storage_path:
        raise HTTPException(status_code=404, detail="No payment proof uploaded for this invoice")
    filename = invoice.payment_proof_original_filename or f"payment-proof-{invoice.id}"
    return FileResponse(
        path=Path(invoice.payment_proof_storage_path),
        media_type=invoice.payment_proof_content_type or "application/octet-stream",
        filename=filename,
    )


@router.put(
    "/{invoice_id}/fields",
    response_model=InvoiceOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def confirm_invoice_fields(
    invoice_id: int,
    payload: InvoiceFieldsUpdateRequest,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> Invoice:
    invoice = await update_invoice_fields(invoice_id, payload, int(claims["sub"]), db)
    refreshed = (
        await db.execute(select(InvoiceField).where(InvoiceField.invoice_id == invoice_id))
    ).scalars().all()
    invoice.total_amount = _effective_grand_total(refreshed)
    return invoice


@router.delete(
    "/{invoice_id}",
    status_code=204,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def remove_invoice(
    invoice_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> None:
    await delete_invoice(invoice_id, int(claims["sub"]), db)


@router.post(
    "/validate-gstin",
    response_model=GstinValidationOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def validate_supplier_gstin(
    payload: GstinValidationRequest, db: AsyncSession = Depends(get_db)
) -> dict:
    result = await validate_gstin(payload.gstin, db)
    await db.commit()
    cache = result.cache
    return {
        "gstin": cache.gstin,
        "status": cache.status,
        "legal_name": cache.legal_name,
        "checked_at": cache.checked_at,
        "source": result.source,
        "pending": result.is_pending,
    }
