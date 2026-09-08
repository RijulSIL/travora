from datetime import date
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_any_permission, require_permission
from app.models.reimbursement import Invoice, InvoiceField
from app.schemas.reimbursement import (
    DuplicateCheckOut,
    GstinValidationOut,
    GstinValidationRequest,
    InvoiceExtractionOut,
    InvoiceFieldsUpdateRequest,
    InvoiceOut,
)
from app.services.reimbursement_service import (
    get_invoice_extraction,
    get_invoice_for_view,
    store_invoice_upload,
    update_invoice_fields,
    validate_gstin,
)

router = APIRouter(
    prefix="/invoices",
    tags=["invoices"],
)


@router.post(
    "/upload",
    response_model=InvoiceOut,
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def upload_invoice(
    file: UploadFile = File(...),
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
        )
    except Exception as e:
        import traceback
        print("="*50)
        print(f"UPLOAD ERROR: {e}")
        traceback.print_exc()
        print("="*50)
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "",
    response_model=list[InvoiceOut],
    dependencies=[Depends(require_permission("submit_claim"))],
)
async def list_invoices(
    unlinked: bool = Query(False),
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db)
):
    from app.models.reimbursement import ClaimDraft, ClaimInvoice, ClaimStatus

    query = (
        select(Invoice, InvoiceField.final_value, InvoiceField.original_value)
        .outerjoin(
            InvoiceField,
            and_(
                InvoiceField.invoice_id == Invoice.id,
                InvoiceField.field_key == "grand_total",
            ),
        )
        .where(Invoice.uploader_user_id == int(claims["sub"]))
    )

    if unlinked:
        subq = (
            select(ClaimInvoice.invoice_id)
            .join(ClaimDraft, ClaimDraft.id == ClaimInvoice.claim_id)
            .where(ClaimDraft.status == ClaimStatus.PAID)
        )
        query = query.where(Invoice.id.not_in(subq))

    result = await db.execute(query.order_by(Invoice.created_at.desc()))
    rows = result.all()

    invoices_list = []
    for invoice, final_val, orig_val in rows:
        amount_str = final_val or orig_val or "0"
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
    grand_total_field = next((f for f in fields if f.field_key == "grand_total"), None)
    total_amount = Decimal("0")
    if grand_total_field:
        amount_str = grand_total_field.final_value or grand_total_field.original_value or "0"
        try:
            total_amount = Decimal(amount_str)
        except Exception:
            pass

    invoice_dict = InvoiceOut.model_validate(invoice).model_dump()
    invoice_dict["total_amount"] = total_amount
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
    grand_total_field = next((f for f in refreshed if f.field_key == "grand_total"), None)
    total_amount = Decimal("0")
    if grand_total_field:
        amount_str = grand_total_field.final_value or grand_total_field.original_value or "0"
        try:
            total_amount = Decimal(amount_str)
        except Exception:
            pass
    invoice.total_amount = total_amount
    return invoice


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
