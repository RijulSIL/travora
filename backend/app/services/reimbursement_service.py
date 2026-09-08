import asyncio
import hashlib
import logging
import re
from collections import defaultdict

logger = logging.getLogger(__name__)
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.auth import User
from app.models.employee import Employee
from app.models.expense_category import ExpenseCategory
from app.models.reimbursement import ClaimStatus
from app.models.policy import ExpenseLimit, ImpactLevel, AirEligibility
from app.models.reimbursement import (
    ClaimDraft,
    ClaimExpense,
    ClaimInvoice,
    ClaimTrip,
    GstinValidationCache,
    GstinValidationStatus,
    Invoice,
    InvoiceField,
    InvoiceLineItem,
    InvoiceStatus,
)
from app.services.audit_service import log_event
from app.services.exception_service import trigger_exceptions_if_needed
from app.services.notification_service import create_notification
from app.services.advance_service import get_outstanding_advance
from app.models.travel_booking import TravelMode, TravelTrip
from app.schemas.reimbursement import ClaimDraftIn, InvoiceFieldsUpdateRequest
from app.services.claim_submission_rules import validate_claim_submission
from app.services.invoice_gemini_extraction import extract_invoice_with_gemini_sync
from app.services.policy_engine import (
    check_cap,
    get_active_policy_version,
    get_expense_limits,
    resolve_city_group,
)
from app.services.workflow_service import (
    assert_user_can_view_claim_workflow,
    get_workflow_config,
    init_claim_approval_chain,
)

logger = logging.getLogger(__name__)

MAX_INVOICE_SIZE_BYTES = 10 * 1024 * 1024
MAX_INVOICES_PER_CLAIM = 30
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".pdf"}
SUPPORTED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/heic",
    "application/pdf",
}
GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def user_may_attach_trip_to_claim(trip: TravelTrip, user: User) -> bool:
    """Self-booked employee trip, or travel-desk trip assigned to this user's employee id."""
    if trip.employee_user_id == user.id:
        return True
    if (
        user.employee_id
        and trip.booked_by_travel_desk
        and trip.assigned_to_employee_id == user.employee_id
    ):
        return True
    return False


def _decimal_from_hash(file_hash: str, minimum: int = 250, span: int = 9000) -> Decimal:
    amount = minimum + (int(file_hash[:8], 16) % span)
    return Decimal(amount).quantize(Decimal("0.01"))


def _validate_upload(filename: str, content_type: str, content: bytes) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS or content_type not in SUPPORTED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Supported invoice formats are JPEG, PNG, HEIC, PDF, Word and Excel",
        )
    if len(content) > MAX_INVOICE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Invoice file exceeds 10 MB")


def _ensure_invoice_owner(invoice: Invoice | None, user_id: int) -> Invoice:
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.uploader_user_id != user_id:
        raise HTTPException(status_code=403, detail="Not allowed to access this invoice")
    return invoice


@dataclass
class GstinValidationResult:
    cache: GstinValidationCache
    source: str
    is_pending: bool


def _parse_gstn_legal_name(data: Any) -> str | None:
    if isinstance(data, dict):
        for key in ("tradeNam", "tradNam", "lgnm", "legalName", "legal_name"):
            val = data.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
        for nested in ("taxpayer", "result", "data", "response"):
            sub = data.get(nested)
            name = _parse_gstn_legal_name(sub)
            if name:
                return name
    return None


async def _fetch_gstin_live(gstin: str) -> dict[str, Any] | None:
    base = settings.gstn_public_api_base
    if not base:
        return None
    url = f"{base.rstrip('/')}/{gstin}"
    try:
        async with httpx.AsyncClient(timeout=settings.gstn_http_timeout_seconds) as client:
            response = await client.get(url)
    except (httpx.HTTPError, OSError):
        return None
    if response.status_code != 200:
        return None
    try:
        body = response.json()
    except ValueError:
        return None
    legal = _parse_gstn_legal_name(body)
    valid_flag = body.get("valid") if isinstance(body, dict) else None
    if isinstance(valid_flag, bool):
        valid = valid_flag
    elif isinstance(body, dict) and body.get("error_code"):
        valid = False
    else:
        valid = legal is not None
    return {"valid": valid, "legal_name": legal, "raw": body}


async def validate_gstin(gstin: str, db: AsyncSession) -> GstinValidationResult:
    normalized = gstin.strip().upper()[:15]
    now = _now()
    ttl_start = now - timedelta(hours=24)
    cached = await db.get(GstinValidationCache, normalized)

    if not GSTIN_PATTERN.match(normalized):
        if cached is None:
            cached = GstinValidationCache(gstin=normalized, status=GstinValidationStatus.INVALID)
            db.add(cached)
        cached.status = GstinValidationStatus.INVALID
        cached.legal_name = None
        cached.raw_response = {"source": "regex_only", "live_attempted": bool(settings.gstn_public_api_base)}
        cached.checked_at = now
        await db.flush()
        return GstinValidationResult(cache=cached, source="regex_only", is_pending=False)

    live = await _fetch_gstin_live(normalized)
    if live is not None:
        gst_status = GstinValidationStatus.VALID if live.get("valid") else GstinValidationStatus.INVALID
        legal = live.get("legal_name") if gst_status == GstinValidationStatus.VALID else None
        if cached is None:
            cached = GstinValidationCache(gstin=normalized, status=gst_status)
            db.add(cached)
        cached.status = gst_status
        cached.legal_name = legal
        raw = dict(live.get("raw") or {})
        raw["source"] = "gstn_live"
        cached.raw_response = raw
        cached.checked_at = now
        await db.flush()
        return GstinValidationResult(cache=cached, source="gstn_live", is_pending=False)

    if cached is not None and cached.checked_at >= ttl_start:
        pending = cached.status == GstinValidationStatus.PENDING
        return GstinValidationResult(cache=cached, source="cache", is_pending=pending)

    if cached is None:
        cached = GstinValidationCache(gstin=normalized, status=GstinValidationStatus.PENDING)
        db.add(cached)
    cached.status = GstinValidationStatus.PENDING
    cached.legal_name = None
    cached.raw_response = {
        "source": "pending_fallback",
        "reason": "gstn_live_unavailable_or_unconfigured",
    }
    cached.checked_at = now
    await db.flush()
    return GstinValidationResult(cache=cached, source="pending_fallback", is_pending=True)


async def store_invoice_upload(
    *, user_id: int, filename: str, content_type: str, content: bytes, db: AsyncSession
) -> Invoice:
    _validate_upload(filename, content_type, content)
    file_hash = hashlib.sha256(content).hexdigest()
    existing = (
        await db.execute(
            select(Invoice).where(
                Invoice.uploader_user_id == user_id,
                Invoice.file_sha256 == file_hash,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return existing

    storage_root = Path(settings.invoice_storage_dir) / str(user_id)
    storage_root.mkdir(parents=True, exist_ok=True)
    safe_suffix = Path(filename).suffix.lower()
    storage_path = storage_root / f"{file_hash}{safe_suffix}"
    storage_path.write_bytes(content)
    
    # Compute perceptual hash if it is an image
    im_hash_str = None
    if content_type.startswith("image/"):
        try:
            import imagehash
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(content))
            im_hash_str = str(imagehash.phash(img))
        except Exception as e:
            print(f"Failed to compute image hash: {e}")
            
    duplicate_invoice_id = None
    if im_hash_str:
        import imagehash
        # Find if a perceptually similar invoice exists
        existing_hashes = (
            await db.execute(
                select(Invoice.id, Invoice.image_hash).where(
                    Invoice.uploader_user_id == user_id,
                    Invoice.image_hash.isnot(None),
                )
            )
        ).all()
        
        target_hash = imagehash.hex_to_hash(im_hash_str)
        for inv_id, h_str in existing_hashes:
            if h_str:
                try:
                    h = imagehash.hex_to_hash(h_str)
                    if target_hash - h < 5:  # Hamming distance < 5 means highly similar
                        duplicate_invoice_id = inv_id
                        break
                except Exception:
                    pass

    invoice = Invoice(
        uploader_user_id=user_id,
        file_sha256=file_hash,
        original_filename=filename,
        content_type=content_type,
        file_size_bytes=len(content),
        storage_path=str(storage_path),
        image_hash=im_hash_str,
        duplicate_invoice_id=duplicate_invoice_id,
        status=InvoiceStatus.PROCESSING,
    )
    db.add(invoice)
    await db.flush()
    await run_invoice_extraction(invoice, db)
    await db.commit()
    await db.refresh(invoice)
    return invoice


async def _find_category(
    name_fragment: str,
    db: AsyncSession,
    *,
    policy_version_id: int | None = None,
    travel_date: date | None = None,
) -> ExpenseCategory | None:
    resolved_policy_version_id = policy_version_id
    if resolved_policy_version_id is None:
        try:
            version = await get_active_policy_version(travel_date or date.today(), db)
        except HTTPException:
            version = await get_active_policy_version(date.today(), db)
        resolved_policy_version_id = version.id
    result = await db.execute(
        select(ExpenseCategory)
        .where(
            ExpenseCategory.is_active.is_(True),
            ExpenseCategory.policy_version_id == resolved_policy_version_id,
            func.lower(ExpenseCategory.name).contains(name_fragment.lower()),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


def _infer_category(filename: str) -> tuple[str, str]:
    normalized = filename.lower()
    if any(token in normalized for token in ("hotel", "stay", "room")):
        return ("Hotel/Accommodation", "hotel")
    if any(token in normalized for token in ("meal", "food", "dinner", "lunch", "breakfast")):
        return ("Food & Meals", "food")
    if any(token in normalized for token in ("uber", "taxi", "cab", "auto")):
        return ("Local Conveyance", "conveyance")
    if any(token in normalized for token in ("train", "irctc", "railway", "rail")):
        return ("Train Travel", "train")
    if any(token in normalized for token in ("flight", "air", "indigo", "vistara", "airindia", "spicejet", "airline", "aeroplane")):
        return ("Air Travel", "air")
    if any(token in normalized for token in ("bus", "redbus", "volvo", "coach")):
        return ("Bus Travel", "bus")
    return ("Incidentals", "incidental")


def _coerce_confidence(raw: Any) -> Decimal:
    try:
        c = Decimal(str(raw))
    except Exception:
        c = Decimal("70")
    return max(Decimal("0"), min(Decimal("100"), c))


def _parsed_field(block: Any) -> tuple[str, Decimal]:
    if isinstance(block, dict):
        val = block.get("value")
        conf = _coerce_confidence(block.get("confidence", 70))
    else:
        val = block
        conf = Decimal("70")
    s = "" if val is None else str(val).strip()
    return s, conf


def _parsed_money(s: Any) -> Decimal:
    if s is None or not str(s).strip():
        return Decimal("0.00")
    t = str(s).strip().replace(",", "")
    try:
        return Decimal(t).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0.00")


async def _persist_parsed_extraction(invoice: Invoice, parsed: dict, db: AsyncSession) -> None:
    raw_fields = parsed.get("fields") or {}
    keys = [
        "vendor_name",
        "supplier_gstin",
        "company_gstin",
        "invoice_number",
        "invoice_date",
        "place_of_supply",
        "payment_mode",
        "currency",
        "grand_total",
        "total_taxable_value",
        "cgst",
        "sgst",
        "igst",
        "is_tatkal",
    ]
    extracted: dict[str, tuple[str, Decimal]] = {
        key: _parsed_field(raw_fields.get(key)) for key in keys
    }

    travel_date = date.today()
    idate = extracted.get("invoice_date", ("", Decimal(0)))[0]
    if idate:
        try:
            travel_date = date.fromisoformat(str(idate)[:10])
        except ValueError:
            travel_date = date.today()

    line_raw: list[dict] = list(parsed.get("line_items") or [])
    if not line_raw:
        total = _parsed_money(extracted.get("grand_total", ("0",))[0])
        taxable = _parsed_money(extracted.get("total_taxable_value", ("0",))[0])
        if taxable <= 0 and total > 0:
            taxable = (total / Decimal("1.18")).quantize(Decimal("0.01"))
        tax = (total - taxable).quantize(Decimal("0.01")) if total > 0 else Decimal("0.00")
        cgst = _parsed_money(extracted.get("cgst", ("0",))[0])
        sgst = _parsed_money(extracted.get("sgst", ("0",))[0])
        igst = _parsed_money(extracted.get("igst", ("0",))[0])
        if cgst == 0 and sgst == 0 and igst == 0 and tax > 0:
            cgst = (tax / 2).quantize(Decimal("0.01"))
            sgst = (tax - cgst).quantize(Decimal("0.01"))
        cat_name, cat_frag = _infer_category(invoice.original_filename)
        line_raw = [
            {
                "description": cat_name,
                "quantity": "1.00",
                "unit": "EA",
                "unit_price": str(taxable),
                "taxable_value": str(taxable),
                "tax_rate": "18.00" if total > 0 else "0.00",
                "cgst": str(cgst),
                "sgst": str(sgst),
                "igst": str(igst),
                "total_amount": str(total) if total > 0 else str(taxable),
                "category_hint": cat_frag,
            }
        ]

    for _key, (value, confidence) in extracted.items():
        db.add(
            InvoiceField(
                invoice_id=invoice.id,
                field_key=_key,
                original_value=value or None,
                final_value=value if confidence >= Decimal("90.00") else None,
                confidence=confidence,
            )
        )

    vendor_lower = (extracted.get("vendor_name", ("",))[0] or "").lower()
    filename_lower = invoice.original_filename.lower()
    for raw in line_raw:
        description = str(raw.get("description") or "Line item").strip()[:255] or "Line item"
        qty = _parsed_money(raw.get("quantity"))
        if qty <= 0:
            qty = Decimal("1.00")
        unit = str(raw.get("unit") or "EA").strip()[:32] or "EA"
        unit_price = _parsed_money(raw.get("unit_price"))
        taxable = _parsed_money(raw.get("taxable_value"))
        tax_rate = _parsed_money(raw.get("tax_rate"))
        cgst = _parsed_money(raw.get("cgst"))
        sgst = _parsed_money(raw.get("sgst"))
        igst = _parsed_money(raw.get("igst"))
        total_amt = _parsed_money(raw.get("total_amount"))
        hint = str(raw.get("category_hint") or "").lower()
        cat_name, cat_frag = _infer_category(f"{hint} {description} {filename_lower}")
        category = await _find_category(cat_frag, db, travel_date=travel_date)
        if total_amt <= 0 and taxable > 0:
            total_amt = (taxable + cgst + sgst + igst).quantize(Decimal("0.01"))
        bl_text = f"{description} {vendor_lower} {filename_lower}"
        is_blacklisted = any(t in bl_text for t in ("alcohol", "tobacco"))
        db.add(
            InvoiceLineItem(
                invoice_id=invoice.id,
                description=description,
                quantity=qty,
                unit=unit,
                unit_price=unit_price if unit_price > 0 else None,
                taxable_value=taxable,
                tax_rate=tax_rate if tax_rate > 0 else None,
                cgst=cgst,
                sgst=sgst,
                igst=igst,
                total_amount=total_amt if total_amt > 0 else taxable,
                category_id=category.id if category else None,
                category_name=category.name if category else cat_name,
                is_blacklisted=is_blacklisted,
            )
        )

    gstin = (extracted.get("supplier_gstin", ("",))[0] or "").strip().upper()
    if gstin:
        gstin_validation = await validate_gstin(gstin, db)
        invoice.gstin_validation_status = gstin_validation.cache.status
        invoice.gstin_validation_checked_at = gstin_validation.cache.checked_at
    else:
        invoice.gstin_validation_status = None
        invoice.gstin_validation_checked_at = None

    invoice.status = InvoiceStatus.READY_FOR_REVIEW
    invoice.duplicate_invoice_id = await find_duplicate_invoice(invoice.id, db)


async def run_invoice_extraction(invoice: Invoice, db: AsyncSession) -> None:
    invoice.extraction_error = None
    path = Path(invoice.storage_path)
    if settings.gemini_api_key and path.is_file():
        try:
            file_bytes = path.read_bytes()
            parsed = await asyncio.to_thread(
                extract_invoice_with_gemini_sync,
                file_bytes,
                invoice.content_type,
                api_key=settings.gemini_api_key,
                primary_model=settings.gemini_invoice_model_primary,
                fallback_model=settings.gemini_invoice_model_fallback,
            )
            await _persist_parsed_extraction(invoice, parsed, db)
            return
        except Exception as e:
            logger.warning("Invoice extraction: Gemini failed, using deterministic fallback: %s", e)
            invoice.extraction_error = str(e)[:2000]
            await db.execute(delete(InvoiceField).where(InvoiceField.invoice_id == invoice.id))
            await db.execute(
                delete(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice.id)
            )
    if not path.is_file():
        invoice.extraction_error = (
            f"{invoice.extraction_error}; stored file missing"
            if invoice.extraction_error
            else "Stored invoice file missing"
        )
    elif not settings.gemini_api_key and not invoice.extraction_error:
        invoice.extraction_error = (
            "Demo extraction: fields use sample GSTINs and amounts derived from the file hash. "
            "Set GEMINI_API_KEY for AI extraction from the uploaded document."
        )
    await run_mock_extraction(invoice, db)


async def run_mock_extraction(invoice: Invoice, db: AsyncSession) -> None:
    stem = Path(invoice.original_filename).stem.replace("_", " ").replace("-", " ").title()
    category_name, category_fragment = _infer_category(invoice.original_filename)
    category = await _find_category(category_fragment, db, travel_date=date.today())
    total = _decimal_from_hash(invoice.file_sha256)
    taxable = (total / Decimal("1.18")).quantize(Decimal("0.01"))
    tax = (total - taxable).quantize(Decimal("0.01"))
    today = date.today().isoformat()
    gstin = "27AABCO1234F1Z5"
    invoice_number = f"INV-{invoice.file_sha256[:8].upper()}"

    extracted_fields = {
        "vendor_name": (stem or "Uploaded Vendor", Decimal("92.00")),
        "supplier_gstin": (gstin, Decimal("78.00")),
        "company_gstin": ("06AAACC4175D1Z0", Decimal("88.00")),
        "invoice_number": (invoice_number, Decimal("64.00")),
        "invoice_date": (today, Decimal("94.00")),
        "place_of_supply": ("27", Decimal("83.00")),
        "payment_mode": ("Card", Decimal("72.00")),
        "currency": ("INR", Decimal("99.00")),
        "grand_total": (str(total), Decimal("90.00")),
        "total_taxable_value": (str(taxable), Decimal("86.00")),
        "cgst": (str((tax / 2).quantize(Decimal("0.01"))), Decimal("86.00")),
        "sgst": (str((tax / 2).quantize(Decimal("0.01"))), Decimal("86.00")),
        "igst": ("0.00", Decimal("86.00")),
        "is_tatkal": ("false", Decimal("90.00")),
    }
    for key, (value, confidence) in extracted_fields.items():
        db.add(
            InvoiceField(
                invoice_id=invoice.id,
                field_key=key,
                original_value=value,
                final_value=value if confidence >= Decimal("90.00") else None,
                confidence=confidence,
            )
        )

    description = category_name
    is_blacklisted = any(token in invoice.original_filename.lower() for token in ("alcohol", "tobacco"))
    db.add(
        InvoiceLineItem(
            invoice_id=invoice.id,
            description=description,
            quantity=Decimal("1.00"),
            unit="EA",
            unit_price=taxable,
            taxable_value=taxable,
            tax_rate=Decimal("18.00"),
            cgst=(tax / 2).quantize(Decimal("0.01")),
            sgst=(tax / 2).quantize(Decimal("0.01")),
            igst=Decimal("0.00"),
            total_amount=total,
            category_id=category.id if category else None,
            category_name=category.name if category else category_name,
            is_blacklisted=is_blacklisted,
        )
    )

    gstin_validation = await validate_gstin(gstin, db)
    invoice.gstin_validation_status = gstin_validation.cache.status
    invoice.gstin_validation_checked_at = gstin_validation.cache.checked_at
    invoice.status = InvoiceStatus.READY_FOR_REVIEW
    invoice.duplicate_invoice_id = await find_duplicate_invoice(invoice.id, db)


async def get_invoice_extraction(
    invoice_id: int, user_id: int, db: AsyncSession
) -> tuple[Invoice, list, list]:
    invoice = await get_invoice_for_view(invoice_id, user_id, db)
    fields = (
        await db.execute(select(InvoiceField).where(InvoiceField.invoice_id == invoice_id))
    ).scalars().all()
    line_items = (
        await db.execute(select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice_id))
    ).scalars().all()
    return invoice, fields, line_items


async def get_invoice_for_view(invoice_id: int, user_id: int, db: AsyncSession) -> Invoice:
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.uploader_user_id == user_id:
        return invoice
    linked_claim_ids = (
        await db.execute(
            select(ClaimInvoice.claim_id).where(ClaimInvoice.invoice_id == invoice_id)
        )
    ).scalars().all()
    for claim_id in linked_claim_ids:
        try:
            await assert_user_can_view_claim_workflow(int(claim_id), user_id, db)
            return invoice
        except HTTPException:
            continue
    raise HTTPException(status_code=403, detail="Not allowed to access this invoice")


async def update_invoice_fields(
    invoice_id: int, payload: InvoiceFieldsUpdateRequest, user_id: int, db: AsyncSession
) -> Invoice:
    invoice = _ensure_invoice_owner(await db.get(Invoice, invoice_id), user_id)
    fields = {
        field.field_key: field
        for field in (
            await db.execute(select(InvoiceField).where(InvoiceField.invoice_id == invoice_id))
        ).scalars()
    }
    payload_map = {u.field_key: u for u in payload.fields}
    for update in payload.fields:
        field = fields.get(update.field_key)
        if field is None:
            field = InvoiceField(
                invoice_id=invoice_id,
                field_key=update.field_key,
                original_value=None,
                confidence=Decimal("0.00"),
            )
            db.add(field)
            fields[update.field_key] = field
        field.final_value = update.final_value
        if update.confirmed:
            field.confirmed_at = _now()
            field.confirmed_by = user_id
        elif not update.confirmed:
            field.confirmed_at = None
            field.confirmed_by = None

    invoice.duplicate_acknowledged = payload.duplicate_acknowledged

    refreshed = (
        await db.execute(select(InvoiceField).where(InvoiceField.invoice_id == invoice_id))
    ).scalars().all()
    field_by_key = {f.field_key: f for f in refreshed}

    review_complete = True
    for field in field_by_key.values():
        upd = payload_map.get(field.field_key)
        final_val = (upd.final_value if upd is not None else None)
        if final_val is None:
            final_val = field.final_value
            
        # Red tone (confidence <= 0) strictly requires a non-empty value
        if field.confidence <= Decimal("0.00"):
            if not final_val or not str(final_val).strip():
                review_complete = False
                break
                
        # Yellow/Orange fields (confidence < 90 but > 0) must be confirmed by the user
        if Decimal("0.00") < field.confidence < Decimal("90.00"):
            if upd is None or not upd.confirmed:
                review_complete = False
                break

    if review_complete and invoice.duplicate_invoice_id and not invoice.duplicate_acknowledged:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Duplicate invoice flag must be acknowledged before review can be completed",
        )

    invoice.status = InvoiceStatus.REVIEWED if review_complete else InvoiceStatus.READY_FOR_REVIEW
    await db.commit()
    await db.refresh(invoice)
    return invoice


async def find_duplicate_invoice(invoice_id: int, db: AsyncSession) -> int | None:
    fields = {
        field.field_key: field.final_value or field.original_value
        for field in (
            await db.execute(select(InvoiceField).where(InvoiceField.invoice_id == invoice_id))
        ).scalars()
    }
    keys = ("vendor_name", "invoice_date", "grand_total")
    if not all(fields.get(key) for key in keys):
        return None

    candidate_ids = (
        await db.execute(select(Invoice.id).where(Invoice.id != invoice_id))
    ).scalars().all()
    for candidate_id in candidate_ids:
        candidate_fields = {
            field.field_key: field.final_value or field.original_value
            for field in (
                await db.execute(select(InvoiceField).where(InvoiceField.invoice_id == candidate_id))
            ).scalars()
        }
        if all(candidate_fields.get(key) == fields[key] for key in keys):
            return candidate_id
    return None


def _category_limit_field(category_name: str) -> str | None:
    normalized = category_name.lower()
    if "hotel" in normalized or "accommodation" in normalized or "stay" in normalized:
        return "hotel"
    if "food" in normalized or "meal" in normalized:
        return "food"
    if "incidental" in normalized:
        return "incidental"
    if "day" in normalized:
        return "day_visit"
    return None


async def _is_twin_sharing_active(claim: ClaimDraft, db: AsyncSession) -> bool:
    if not claim.destination_city or not claim.departure_date or not claim.return_date:
        return False
        
    user = await db.get(User, claim.employee_user_id)
    if not user or not user.employee_id:
        return False
    employee = await db.get(Employee, user.employee_id)
    if not employee or not employee.impact_level_id:
        return False
    impact = await db.get(ImpactLevel, employee.impact_level_id)
    if not impact:
        return False
        
    level_code = impact.level_code.strip().upper()
    if level_code not in {"L5B", "L5C", "L6A", "L6B", "L6C", "L6D"}:
        return False
        
    query = select(ClaimDraft).where(
        and_(
            ClaimDraft.id != claim.id,
            ClaimDraft.destination_city == claim.destination_city,
            ClaimDraft.departure_date <= claim.return_date,
            ClaimDraft.return_date >= claim.departure_date,
            ClaimDraft.status.in_([ClaimStatus.IN_APPROVAL, ClaimStatus.PAID, ClaimStatus.READY_FOR_PAYMENT])
        )
    )
    candidates = (await db.execute(query)).scalars().all()
    
    for cand in candidates:
        cand_user = await db.get(User, cand.employee_user_id)
        if not cand_user or not cand_user.employee_id:
            continue
        cand_emp = await db.get(Employee, cand_user.employee_id)
        if not cand_emp or not cand_emp.impact_level_id:
            continue
        cand_impact = await db.get(ImpactLevel, cand_emp.impact_level_id)
        if not cand_impact:
            continue
        cand_level = cand_impact.level_code.strip().upper()
        if cand_level in {"L5B", "L5C", "L6A", "L6B", "L6C", "L6D"}:
            return True
            
    return False


async def _build_claim_expenses(
    claim: ClaimDraft, invoice_ids: list[int], db: AsyncSession
) -> tuple[list[ClaimExpense], dict]:
    grouped: dict[tuple[int | None, str], Decimal] = defaultdict(lambda: Decimal("0.00"))
    gst_summary = {
        "taxable_value": Decimal("0.00"),
        "total_taxable_value": Decimal("0.00"),
        "cgst": Decimal("0.00"),
        "sgst": Decimal("0.00"),
        "igst": Decimal("0.00"),
        "grand_total": Decimal("0.00"),
        "itc_eligible_amount": Decimal("0.00"),
    }
    line_items = (
        await db.execute(select(InvoiceLineItem).where(InvoiceLineItem.invoice_id.in_(invoice_ids)))
    ).scalars().all()
    for item in line_items:
        gst_summary["taxable_value"] += item.taxable_value
        gst_summary["total_taxable_value"] += item.taxable_value
        gst_summary["cgst"] += item.cgst
        gst_summary["sgst"] += item.sgst
        gst_summary["igst"] += item.igst
        gst_summary["grand_total"] += item.total_amount
        if not item.is_blacklisted:
            grouped[(item.category_id, item.category_name or "Uncategorised")] += item.total_amount
            gst_summary["itc_eligible_amount"] += item.cgst + item.sgst + item.igst

    # Fetch user, employee and impact level for air/taxi eligibility checks
    user = await db.get(User, claim.employee_user_id)
    emp = None
    impact = None
    if user and user.employee_id:
        emp = await db.get(Employee, user.employee_id)
        if emp and emp.impact_level_id:
            impact = await db.get(ImpactLevel, emp.impact_level_id)

    # Check if tatkal is present in any linked invoices
    has_tatkal = False
    if invoice_ids:
        tatkal_query = select(InvoiceField).where(
            InvoiceField.invoice_id.in_(invoice_ids),
            InvoiceField.field_key == "is_tatkal",
            InvoiceField.final_value == "true"
        )
        tatkal_fields = (await db.execute(tatkal_query)).scalars().all()
        has_tatkal = len(tatkal_fields) > 0

    has_train_expense = any(cat and "train" in cat.lower() for _, cat in grouped.keys())

    # Fetch existing exception requests to restore exception_requested status
    from app.models.claim_workflow import ExceptionRequest
    exception_stmt = select(ExceptionRequest.exception_type).where(
        ExceptionRequest.claim_id == claim.id
    )
    existing_exception_types = set((await db.execute(exception_stmt)).scalars().all())

    limit_row = await _resolve_limit_row(claim, db)
    twin_sharing_active = await _is_twin_sharing_active(claim, db)
    expenses: list[ClaimExpense] = []
    for (category_id, category_name), amount in grouped.items():
        cap_amount = None
        policy_status = "OK"
        field = _category_limit_field(category_name)
        if limit_row and field:
            cap_amount = getattr(limit_row, f"{field}_cap")
            if twin_sharing_active and field == "hotel" and cap_amount:
                cap_amount = cap_amount / 2
            policy_status, _ = check_cap(limit_row, field, amount, override_cap=cap_amount)

        # Override policy_status for non-cap policy exceptions
        normalized_cat = (category_name or "").lower()
        exc_type = None
        
        if has_tatkal and ("train" in normalized_cat or not has_train_expense):
            policy_status = "HARD_BLOCK"
            exc_type = "TRAIN_TATKAL"
            has_train_expense = True  # Ensure it only applies once if miscategorized
        elif ("air" in normalized_cat or "flight" in normalized_cat) and impact:
            if impact.air_eligibility in (AirEligibility.NO, AirEligibility.CONDITIONAL):
                policy_status = "HARD_BLOCK"
                exc_type = "AIR_TRAVEL_L5_L6"
        elif ("taxi" in normalized_cat or "hired taxi" in normalized_cat or "local conveyance" in normalized_cat) and impact:
            if impact.level_code.startswith(("L4", "L5", "L6")):
                modes = impact.local_conveyance_modes or []
                if "Hired Taxi" not in modes:
                    policy_status = "HARD_BLOCK"
                    exc_type = "HIRED_TAXI_UNAUTHORIZED"
        elif field in ("hotel", "food", "incidental", "day_visit") and policy_status in ("HARD_BLOCK", "SOFT_FLAG"):
            if field == "hotel":
                exc_type = "ROOM_RENT_DEVIATION"

        exception_requested = False
        if exc_type and exc_type in existing_exception_types:
            exception_requested = True

        expense = ClaimExpense(
            claim_id=claim.id,
            expense_category_id=category_id,
            category_name=category_name,
            amount=amount,
            cap_amount=cap_amount,
            policy_status=policy_status,
            exception_requested=exception_requested,
        )
        db.add(expense)
        expenses.append(expense)
    await db.flush()
    return expenses, gst_summary


async def _resolve_limit_row(claim: ClaimDraft, db: AsyncSession) -> ExpenseLimit | None:
    if not claim.departure_date or not claim.destination_city_group or not claim.employee_id:
        return None
    employee = await db.get(Employee, claim.employee_id)
    if not employee or not employee.impact_level_id:
        return None
    try:
        policy = await get_active_policy_version(claim.departure_date, db)
    except HTTPException:
        return None
    return await get_expense_limits(
        policy.id, employee.impact_level_id, claim.destination_city_group, db
    )


def _serialize_money_map(values: dict[str, Decimal]) -> dict[str, str]:
    return {key: str(value.quantize(Decimal("0.01"))) for key, value in values.items()}


async def assert_invoices_eligible_for_claim(
    invoice_ids: list[int], user_id: int, db: AsyncSession
) -> None:
    for iid in invoice_ids:
        inv = await db.get(Invoice, iid)
        if inv is None:
            raise HTTPException(status_code=404, detail=f"Invoice {iid} not found")
        if inv.uploader_user_id != user_id:
            raise HTTPException(status_code=403, detail=f"Invoice {iid} cannot be linked to this claim")
        if inv.status != InvoiceStatus.REVIEWED:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invoice {iid} must complete review before it can be used on a claim",
            )
        if inv.duplicate_invoice_id and not inv.duplicate_acknowledged:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Invoice {iid} is flagged as a duplicate and must be acknowledged before claim use",
            )


async def create_or_update_claim_draft(
    payload: ClaimDraftIn, user_id: int, db: AsyncSession
) -> tuple[ClaimDraft, list[ClaimExpense], list[int], list[int]]:
    try:
        return await _create_or_update_claim_draft_impl(payload, user_id, db)
    except Exception as e:
        logger.exception("Error in create_or_update_claim_draft: %s", e)
        raise

async def _create_or_update_claim_draft_impl(
    payload: ClaimDraftIn, user_id: int, db: AsyncSession
) -> tuple[ClaimDraft, list[ClaimExpense], list[int], list[int]]:
    if len(payload.invoice_ids) > MAX_INVOICES_PER_CLAIM:
        raise HTTPException(status_code=400, detail="A claim session can include at most 30 invoices")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    claim = await db.get(ClaimDraft, payload.claim_id) if payload.claim_id else None
    if claim is None:
        claim = ClaimDraft(employee_user_id=user_id, employee_id=user.employee_id)
        db.add(claim)
        await db.flush()
    if claim.employee_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot edit another employee's claim")
    if claim.status not in (ClaimStatus.DRAFT, ClaimStatus.SENT_BACK):
        raise HTTPException(status_code=409, detail="Only draft or sent-back claims can be edited")
    if claim.status == ClaimStatus.SENT_BACK:
        # Re-open sent-back claims for correction/resubmission.
        claim.status = ClaimStatus.DRAFT
        claim.current_approval_stage = None

    if payload.invoice_ids:
        await assert_invoices_eligible_for_claim(payload.invoice_ids, user_id, db)

    # Set standard fields from payload
    exclude_keys = {"claim_id", "invoice_ids", "trip_ids"}
    for key, value in payload.model_dump(exclude=exclude_keys).items():
        if hasattr(claim, key):
            setattr(claim, key, value)
    
    # Auto-deduct outstanding advances if not provided in payload
    if payload.advance_received == Decimal("0"):
        outstanding = await get_outstanding_advance(user_id, db)
        if outstanding > 0:
            claim.advance_received = outstanding

    if payload.destination_city and payload.departure_date:
        claim.destination_city_group = await resolve_city_group(
            payload.destination_city, payload.departure_date, db
        )

    await db.execute(delete(ClaimInvoice).where(ClaimInvoice.claim_id == claim.id))
    await db.execute(delete(ClaimTrip).where(ClaimTrip.claim_id == claim.id))
    await db.execute(delete(ClaimExpense).where(ClaimExpense.claim_id == claim.id))
    for invoice_id in payload.invoice_ids:
        db.add(ClaimInvoice(claim_id=claim.id, invoice_id=invoice_id))
    for trip_id in payload.trip_ids:
        trip = await db.get(TravelTrip, trip_id)
        if trip is None:
            raise HTTPException(status_code=404, detail=f"Trip {trip_id} not found")
        if not user_may_attach_trip_to_claim(trip, user):
            raise HTTPException(status_code=403, detail=f"Trip {trip_id} cannot be linked to this claim")
        db.add(ClaimTrip(claim_id=claim.id, trip_id=trip_id))

    expenses, gst_summary = await _build_claim_expenses(claim, payload.invoice_ids, db)
    exceptions = [
        {
            "category_name": expense.category_name,
            "amount": str(expense.amount),
            "cap_amount": str(expense.cap_amount) if expense.cap_amount is not None else None,
            "policy_status": expense.policy_status,
        }
        for expense in expenses
        if expense.policy_status != "OK"
    ]
    total_claimed = sum((expense.amount for expense in expenses), Decimal("0.00"))
    claim.compliance_report = {
        "exceptions": exceptions,
        "gst_summary": _serialize_money_map(gst_summary),
        "total_claimed": str(total_claimed),
        "net_payable": str(total_claimed - (claim.advance_received or Decimal("0"))),
    }
    await db.commit()
    await db.refresh(claim)
    return claim, expenses, payload.invoice_ids, payload.trip_ids


async def get_claim_bundle(
    claim_id: int, user_id: int, db: AsyncSession
) -> tuple[ClaimDraft, list[ClaimExpense], list[int], list[int]]:
    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.employee_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot view another employee's claim")
    expenses = (
        await db.execute(select(ClaimExpense).where(ClaimExpense.claim_id == claim_id))
    ).scalars().all()
    invoice_ids = (
        await db.execute(select(ClaimInvoice.invoice_id).where(ClaimInvoice.claim_id == claim_id))
    ).scalars().all()
    trip_ids = (
        await db.execute(select(ClaimTrip.trip_id).where(ClaimTrip.claim_id == claim_id))
    ).scalars().all()
    return claim, expenses, invoice_ids, trip_ids


async def list_claims(
    user_id: int,
    db: AsyncSession,
    *,
    employee_user_id: int | None = None,
    limit: int = 200,
) -> list[ClaimDraft]:
    target_user_id = employee_user_id or user_id
    query = select(ClaimDraft).where(ClaimDraft.employee_user_id == target_user_id)
    if target_user_id != user_id:
        query = query.where(ClaimDraft.status != ClaimStatus.DRAFT.value)
    query = query.order_by(ClaimDraft.created_at.desc()).limit(limit)
    return (await db.execute(query)).scalars().all()


async def list_claims_all(
    db: AsyncSession,
    *,
    limit: int = 500,
) -> list[ClaimDraft]:
    query = (
        select(ClaimDraft)
        .order_by(ClaimDraft.created_at.desc())
        .limit(limit)
    )
    return (await db.execute(query)).scalars().all()


async def submit_claim(claim_id: int, user_id: int, db: AsyncSession) -> ClaimDraft:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    claim, expenses, invoice_ids, trip_ids = await get_claim_bundle(claim_id, user_id, db)
    if claim.status not in (ClaimStatus.DRAFT, ClaimStatus.SENT_BACK):
        raise HTTPException(status_code=409, detail="Only draft or sent-back claims can be submitted")
    if invoice_ids:
        await assert_invoices_eligible_for_claim(list(invoice_ids), user_id, db)
    if any(expense.policy_status == "HARD_BLOCK" for expense in expenses):
        # Relax block if it's a Room Rent deviation (which should go to exception instead)
        room_rent_only = all(
            ("hotel" in exp.category_name.lower() or "accommodation" in exp.category_name.lower())
            for exp in expenses if exp.policy_status == "HARD_BLOCK"
        )
        if not room_rent_only:
            raise HTTPException(status_code=409, detail="Hard-blocking policy exceptions must be resolved")

    # Trigger exceptions
    has_exceptions = await trigger_exceptions_if_needed(claim, expenses, db)
    if has_exceptions:
        claim.status = ClaimStatus.PENDING_EXCEPTION

    if trip_ids:
        flights = (
            await db.execute(
                select(TravelTrip).where(
                    TravelTrip.id.in_(trip_ids),
                    TravelTrip.mode == TravelMode.FLIGHT,
                )
            )
        ).scalars().all()
        missing_bp = []
        for trip in flights:
            if not user_may_attach_trip_to_claim(trip, user):
                raise HTTPException(
                    status_code=403,
                    detail=f"Trip {trip.id} is not yours to submit on this claim",
                )
            if not (trip.boarding_pass_path or "").strip():
                missing_bp.append(trip.reference_id)
        if missing_bp:
            refs = ", ".join(missing_bp)
            raise HTTPException(
                status_code=422,
                detail=(
                    "Boarding pass upload is mandatory for all linked flight trips before claim submission. "
                    f"Missing for: {refs}"
                ),
            )
    wf = await get_workflow_config(db)
    is_late, late_days = validate_claim_submission(claim, wf)
    if is_late:
        rep = dict(claim.compliance_report or {})
        rep["is_late_submission"] = True
        rep["late_by_days"] = late_days
        claim.compliance_report = rep
        
    claim.submitted_at = _now()
    await init_claim_approval_chain(claim, db)
    await db.commit()
    await db.refresh(claim)
    return claim
