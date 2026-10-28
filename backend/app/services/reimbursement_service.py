import asyncio
import hashlib
import logging
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timezone import now_ist
from app.models.auth import User
from app.models.claim_workflow import NotificationCategory
from app.models.employee import Employee
from app.models.expense_category import ExpenseCategory
from app.models.policy import AirEligibility, ExpenseLimit, ImpactLevel
from app.models.reimbursement import (
    ClaimDraft,
    ClaimExpense,
    ClaimInvoice,
    ClaimStatus,
    ClaimTrip,
    GstinValidationCache,
    GstinValidationStatus,
    Invoice,
    InvoiceField,
    InvoiceLineItem,
    InvoiceStatus,
    ReimbursementCategory,
)
from app.models.travel_booking import TravelMode, TravelTrip
from app.models.travel_request import TravelOptionType, TravelRequestTravelType
from app.schemas.reimbursement import ClaimDraftIn, InvoiceFieldsUpdateRequest
from app.services.budget_alert_service import check_and_notify_budget_threshold
from app.services.claim_submission_rules import validate_claim_submission
from app.services.expense_category_service import check_blacklist
from app.services.invoice_gemini_extraction import extract_invoice_with_gemini_sync
from app.services.notification_service import create_notification
from app.services.policy_engine import (
    check_cap,
    get_active_policy_version,
    get_expense_limits,
    resolve_city_group,
)
from app.services.workflow_service import (
    CLAIM_EXCEPTION_REASON_MIN_CHARS,
    EXCEPTION_SUBMISSION_BLOCK,
    assert_user_can_view_claim_workflow,
    cancel_pending_claim_exceptions,
    claim_exception_request_awaiting_resubmit,
    close_claim_exception_request,
    exception_submission_mode,
    get_workflow_config,
    init_claim_approval_chain,
    init_claim_exception_route,
    is_exception_enabled,
    plan_claim_exception_resume,
    raise_claim_exception_request,
    resume_claim_exception_request,
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

# Not every valid invoice carries a GSTIN (unregistered vendors, cash memos, foreign
# expenses) — must match frontend's InvoiceReview.jsx OPTIONAL_FIELD_KEYS exactly, or
# review can look complete in the UI while the backend still refuses to mark it REVIEWED.
# Never block review. expense_category only labels the line items at extraction (claims are built
# from line items), and review shows it as optional — so it mustn't hold the invoice back either.
OPTIONAL_INVOICE_FIELD_KEYS = {"supplier_gstin", "company_gstin", "expense_category", "nights"}
GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")

# A claim in any of these states moves its invoices to the Archived Invoices view
# (app/api/v1/invoices.py), off the Upload Invoices page and out of its 30-invoice count.
# Until then — submitted, in exception review, in approval, approved — they stay on the Upload
# Invoices page under "On a claim", so the employee can follow them until they're paid.
INVOICE_ARCHIVING_CLAIM_STATUSES = {
    ClaimStatus.PAID,
    ClaimStatus.REJECTED,
}

# A claim in any of these states blocks further edits to its invoices' extracted fields
# (below), so a receipt that's already been submitted can't quietly change
# afterwards. Every post-submit status belongs here. Only DRAFT and SENT_BACK leave them editable.
INVOICE_LOCKING_CLAIM_STATUSES = {
    ClaimStatus.SUBMITTED,
    ClaimStatus.PENDING_EXCEPTION,
    ClaimStatus.ON_HOLD,
    ClaimStatus.IN_APPROVAL,
    ClaimStatus.READY_FOR_PAYMENT,
    ClaimStatus.PAID,
    ClaimStatus.REJECTED,
}


async def get_invoice_claim_link(
    invoice_id: int, db: AsyncSession
) -> tuple[int | None, str | None, ClaimStatus | None]:
    """The single most relevant claim link for an invoice: its current non-rejected
    claim if one holds it, otherwise its most recent rejected one, otherwise none."""
    rows = (
        await db.execute(
            select(ClaimInvoice.claim_id, ClaimDraft.claim_reference, ClaimDraft.status)
            .join(ClaimDraft, ClaimDraft.id == ClaimInvoice.claim_id)
            .where(ClaimInvoice.invoice_id == invoice_id)
            .order_by(ClaimInvoice.id.desc())
        )
    ).all()
    if not rows:
        return None, None, None
    non_rejected = next((row for row in rows if row[2] != ClaimStatus.REJECTED), None)
    chosen = non_rejected or rows[0]
    return chosen[0], chosen[1], chosen[2]


def _now() -> datetime:
    return now_ist()


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
            detail="Supported invoice formats are JPEG, PNG, HEIC and PDF",
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The file is empty"
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


async def _fetch_fx_rate_to_inr(currency: str) -> Decimal | None:
    """Look up a real, current published exchange rate to convert a foreign-currency
    invoice total to INR — replaces asking Gemini to guess a rate from "general knowledge,"
    which is frequently stale or simply wrong since the model has no live market data.
    Returns None on any failure (unsupported currency, network error, bad response) so the
    caller can fall back to Gemini's own estimate rather than risk a confidently-wrong
    number with no signal that it's unreliable."""
    base = settings.fx_rate_api_base
    token = currency.strip().upper()
    if not base or not token or token in _INR_CURRENCY_TOKENS:
        return None
    url = f"{base.rstrip('/')}/{token}"
    try:
        async with httpx.AsyncClient(timeout=settings.fx_http_timeout_seconds) as client:
            response = await client.get(url)
    except (httpx.HTTPError, OSError):
        return None
    if response.status_code != 200:
        return None
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict) or body.get("result") != "success":
        return None
    rate = (body.get("rates") or {}).get("INR")
    if rate is None:
        return None
    try:
        return Decimal(str(rate))
    except Exception:
        return None


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


async def _reclaim_existing_invoice_upload(
    existing: Invoice, db: AsyncSession, *, reimbursement_category: ReimbursementCategory | None = None
) -> Invoice:
    """Hands back an invoice that's already been uploaded by this employee (same file
    hash). A rejected claim retires its invoices from direct reuse (see
    assert_invoices_eligible_for_claim) — re-uploading the exact same file is how an
    employee reclaims one. If nothing but rejected claims still reference it, drop those
    dead links so it goes back to being a fresh, pickable invoice; if an active
    (non-rejected) claim holds it, leave it locked and just hand back the same row."""
    still_locked = (
        await db.execute(
            select(ClaimInvoice.id)
            .join(ClaimDraft, ClaimDraft.id == ClaimInvoice.claim_id)
            .where(ClaimInvoice.invoice_id == existing.id, ClaimDraft.status != ClaimStatus.REJECTED)
        )
    ).first()
    if still_locked is None:
        await db.execute(delete(ClaimInvoice).where(ClaimInvoice.invoice_id == existing.id))
        # A fresh re-upload is a new "current intent" — let it correct the category rather
        # than being stuck with whatever was picked the first time this file was uploaded.
        if reimbursement_category is not None:
            existing.reimbursement_category = reimbursement_category
        await db.commit()
    return existing


async def store_invoice_upload(
    *,
    user_id: int,
    filename: str,
    content_type: str,
    content: bytes,
    db: AsyncSession,
    reimbursement_category: ReimbursementCategory = ReimbursementCategory.TRAVEL,
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
        return await _reclaim_existing_invoice_upload(existing, db, reimbursement_category=reimbursement_category)

    storage_root = Path(settings.invoice_storage_dir) / str(user_id)
    storage_root.mkdir(parents=True, exist_ok=True)
    safe_suffix = Path(filename).suffix.lower()
    storage_path = storage_root / f"{file_hash}{safe_suffix}"
    storage_path.write_bytes(content)
    
    # Compute perceptual hash if it is an image
    im_hash_str = None
    if content_type.startswith("image/"):
        try:
            import io

            import imagehash
            from PIL import Image
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
        reimbursement_category=reimbursement_category,
    )
    db.add(invoice)
    try:
        await db.flush()
    except IntegrityError:
        # Two near-simultaneous uploads of the same file (double-click, a dropped file
        # processed twice, ...) can both pass the existence check above before either
        # commits — the loser hits this unique constraint instead of crashing.
        await db.rollback()
        existing = (
            await db.execute(
                select(Invoice).where(
                    Invoice.uploader_user_id == user_id,
                    Invoice.file_sha256 == file_hash,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise
        return await _reclaim_existing_invoice_upload(existing, db, reimbursement_category=reimbursement_category)
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


def _has_token(text: str, token: str) -> bool:
    """Word-boundary match — plain substring containment let "bus" match inside
    "Business", "air" match inside "affair"/"repair", "cab" inside "cabinet", etc.,
    which was silently miscategorizing ordinary invoices (a "Google Workspace Business
    Base" subscription was filed as Bus Travel purely because of this)."""
    return re.search(rf"\b{re.escape(token)}\b", text) is not None


def _infer_category(filename: str) -> tuple[str, str]:
    # Underscores/hyphens count as "word" characters to \b, so "air_india.pdf" wouldn't
    # otherwise match \bair\b — treat them as separators like a space would be. Callers pass
    # in more than just the filename here — Gemini's bill-level expense_category guess and
    # per-line-item category_hint (see _persist_parsed_extraction) are prepended to the text
    # this matches against, so a real content-based classification wins over the filename
    # whenever Gemini provided one.
    normalized = re.sub(r"[_-]+", " ", filename.lower())
    if any(_has_token(normalized, token) for token in ("hotel", "accommodation", "stay")):
        return ("Hotel/Accommodation", "hotel")
    # Bare "room" is a genuine hotel signal on its own (room-type + night-count is standard
    # Indian hotel-bill phrasing, e.g. "Executive Room — 2 nights", "Room Rent") — but it
    # false-positives on any other kind of room a bill happens to mention (observed: a
    # coworking space's "Meeting room — 2 hours" booking filed as a hotel stay). Exclude the
    # specific non-hotel room types rather than dropping "room" altogether, which would also
    # lose genuine hotel lines that never spell out "hotel"/"accommodation"/"stay".
    if _has_token(normalized, "room") and not any(
        _has_token(normalized, excl) for excl in ("meeting", "conference", "server", "board", "waiting", "class")
    ):
        return ("Hotel/Accommodation", "hotel")
    if any(_has_token(normalized, token) for token in ("meal", "food", "dinner", "lunch", "breakfast")):
        return ("Food & Meals", "food")
    if any(_has_token(normalized, token) for token in ("uber", "taxi", "cab", "auto", "conveyance")):
        return ("Local Conveyance", "conveyance")
    if any(_has_token(normalized, token) for token in ("train", "irctc", "railway", "rail")):
        return ("Train Travel", "train")
    if any(
        _has_token(normalized, token)
        for token in ("flight", "air", "indigo", "vistara", "airindia", "spicejet", "airline", "aeroplane")
    ):
        return ("Air Travel", "air")
    if any(_has_token(normalized, token) for token in ("bus", "redbus", "volvo", "coach")):
        return ("Bus Travel", "bus")
    if any(_has_token(normalized, token) for token in ("fuel", "petrol", "diesel", "cng", "fillingstation")):
        return ("Fuel", "fuel")
    if any(
        _has_token(normalized, token)
        for token in ("software", "subscription", "saas", "license", "licence", "app", "cloud")
    ):
        return ("Software/Subscription", "software")
    if any(
        _has_token(normalized, token)
        for token in ("stationery", "stationary", "supplies", "printer", "printing", "office")
    ):
        return ("Office Supplies", "supplies")
    if any(
        _has_token(normalized, token)
        for token in ("telecom", "internet", "broadband", "mobile", "sim", "wifi", "airtel", "jio", "vodafone")
    ):
        return ("Telecom & Internet", "telecom")
    if any(
        _has_token(normalized, token)
        for token in ("consulting", "consultant", "professional", "legal", "audit", "advisory", "freelance")
    ):
        return ("Professional Services", "professional")
    if any(_has_token(normalized, token) for token in ("courier", "postage", "speedpost", "dtdc", "fedex", "bluedart")):
        return ("Courier & Postage", "courier")
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


_INR_CURRENCY_TOKENS = {"INR", "RS", "RS.", "RUPEE", "RUPEES", "₹"}


def _is_non_inr_currency(currency_value: str) -> bool:
    """True only when extraction returned a currency we can positively identify as NOT
    INR — an empty/unrecognized value is treated as INR (today's long-standing default)
    rather than flagged, since Gemini doesn't always bother returning it for INR invoices."""
    token = currency_value.strip().upper()
    if not token:
        return False
    return token not in _INR_CURRENCY_TOKENS


def _normalize_place_of_supply(raw_value: str, supplier_gstin: str) -> tuple[str, Decimal | None]:
    """Gemini is asked to return a 2-digit GST state code, but receipts rarely print one
    literally — it often returns a state name, an unpadded single digit, or nothing at
    all. Recover a clean code where possible: (1) take the leading 1-2 digits of whatever
    was returned, zero-padded; (2) if that yields nothing usable, fall back to the first
    two digits of a valid supplier GSTIN, which *are* the state code by construction.
    Returns (value, forced_confidence) — forced_confidence is None when no fallback was
    needed (Gemini's own confidence stands), otherwise a capped value signalling the
    reviewer should double check a derived-not-extracted number."""
    digits = re.match(r"\s*(\d{1,2})", raw_value or "")
    if digits:
        return digits.group(1).zfill(2), None
    if GSTIN_PATTERN.match((supplier_gstin or "").strip().upper()):
        return supplier_gstin.strip().upper()[:2], Decimal("40.00")
    return "", None


async def _get_impact_level_id_for_user(user_id: int, db: AsyncSession) -> int | None:
    user = await db.get(User, user_id)
    if not user or not user.employee_id:
        return None
    employee = await db.get(Employee, user.employee_id)
    return employee.impact_level_id if employee else None


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
        "other_tax",
        "is_tatkal",
        "expense_category",
        "nights",
    ]
    extracted: dict[str, tuple[str, Decimal]] = {
        key: _parsed_field(raw_fields.get(key)) for key in keys
    }
    # Bill-level "what is this for" classification (see EXTRACTION_PROMPT) — used below as a
    # content-based hint for both the synthetic single-line fallback and each real line item,
    # taking precedence over the filename-only heuristic _infer_category otherwise falls back to.
    top_category_hint = extracted["expense_category"][0]
    # The vendor name is often the single clearest categorization signal there is (e.g. "Osaka
    # Business Hotel KK" is unambiguously a hotel stay even when Gemini's line-item description
    # and category_hint are generic, like a bare "Room Charge" or "Service Fee") — both
    # _infer_category call sites below need it, not just the blacklist check further down.
    vendor_lower = (extracted.get("vendor_name", ("",))[0] or "").lower()
    pos_value, pos_forced_confidence = _normalize_place_of_supply(
        extracted["place_of_supply"][0], extracted["supplier_gstin"][0]
    )
    extracted["place_of_supply"] = (
        pos_value,
        pos_forced_confidence if pos_forced_confidence is not None else extracted["place_of_supply"][1],
    )
    currency_value = extracted.get("currency", ("",))[0]
    is_foreign_currency = _is_non_inr_currency(currency_value)
    # "grand_total" stays the raw original-currency figure Gemini read off the document
    # (kept for reference in the review UI) — converted_grand_total, computed below, is
    # what actually feeds the taxable/tax/line-item math for a foreign invoice.
    converted_grand_total = extracted.get("grand_total", ("0", Decimal(0)))
    original_foreign_total = Decimal("0.00")
    if is_foreign_currency:
        original_foreign_total = _parsed_money(extracted["grand_total"][0])
        # GST is an Indian tax — a foreign invoice legitimately has none, so the 18%
        # fabrication below must not run for it (it would otherwise invent CGST/SGST that
        # was never on the invoice). Flag it instead of silently treating the total as INR.
        invoice.extraction_error = (
            f"Non-INR currency detected ({currency_value} {original_foreign_total}) — the INR "
            "conversion below must be checked and confirmed before this invoice can be used on "
            "a claim."
        )
        # Prefer a real, currently-published exchange rate over Gemini's own guess (which was
        # only ever "best general knowledge," not a live rate, and was frequently off by a
        # meaningful margin). A live rate is trustworthy enough to only need a one-click
        # confirm (yellow tier, >=60) rather than forcing the reviewer to manually retype the
        # number before it can be confirmed (orange tier, <60 — see update_invoice_fields /
        # InvoiceReview.jsx's confirmOrangeCorrection, which requires an actual edit).
        live_rate = await _fetch_fx_rate_to_inr(currency_value)
        if live_rate is not None and original_foreign_total > 0:
            converted_value = str((original_foreign_total * live_rate).quantize(Decimal("0.01")))
            forced_confidence = Decimal("75.00")
        else:
            # Live lookup unavailable (unsupported currency, network error, zero total) —
            # fall back to Gemini's estimate, still capped low so a human must correct/confirm
            # it manually rather than trust an unverified guess.
            est_value, est_confidence = _parsed_field(raw_fields.get("grand_total_inr_estimate"))
            # No rate and no estimate: the rupee amount is left EMPTY (confidence 0), so review
            # can't finish until the employee types what they actually paid in INR. (Copying the
            # foreign number in as rupees used to pay "USD 60" as ₹60.)
            converted_value = est_value if est_value.strip() else ""
            forced_confidence = min(est_confidence, Decimal("40.00")) if est_value.strip() else Decimal("0.00")
        db.add(
            InvoiceField(
                invoice_id=invoice.id,
                field_key="grand_total_inr_estimate",
                original_value=converted_value or None,
                final_value=None,
                confidence=forced_confidence,
            )
        )
        # Downstream math (line-item synthesis, claim totals, policy caps) needs an actual
        # INR number to work with. With no INR figure yet, the line items keep the foreign
        # amounts' proportions; review rescales them to the INR total the employee enters
        # (_rescale_line_items_to_total), and the invoice can't go on a claim before that.
        converted_grand_total = (converted_value or str(original_foreign_total), forced_confidence)

    travel_date = date.today()
    idate = extracted.get("invoice_date", ("", Decimal(0)))[0]
    if idate:
        try:
            travel_date = date.fromisoformat(str(idate)[:10])
        except ValueError:
            travel_date = date.today()

    line_raw: list[dict] = list(parsed.get("line_items") or [])
    if is_foreign_currency and line_raw and original_foreign_total > 0:
        # Gemini gave real structured line items in the invoice's own currency — scale each
        # one by the same total-conversion ratio rather than leaving them unconverted (the
        # synthetic single-line fallback below already builds its numbers from the already-
        # converted total, so this branch only ever applies to genuine itemized extractions).
        scale = _parsed_money(converted_grand_total[0]) / original_foreign_total
        money_keys = ("unit_price", "taxable_value", "cgst", "sgst", "igst", "other_tax", "total_amount")
        line_raw = [
            {
                **raw,
                **{key: str((_parsed_money(raw.get(key)) * scale).quantize(Decimal("0.01"))) for key in money_keys},
            }
            for raw in line_raw
        ]
        # Gemini is asked not to put tax into cgst/sgst/igst on a non-INR invoice (see
        # EXTRACTION_PROMPT's other_tax rule), but it doesn't always follow that instruction —
        # a document with a generic "Tax"/"VAT" line can still get bucketed into igst out of
        # habit. Since GST literally cannot apply to a foreign vendor invoice, enforce this as
        # a hard server-side invariant rather than trust the model: reclassify any cgst/sgst/
        # igst Gemini reported here into other_tax. This must never be skipped — cgst/sgst/igst
        # feed Input Tax Credit eligibility, and crediting ITC on tax that was never Indian GST
        # is a real compliance error, not just a display nuance.
        for raw in line_raw:
            misclassified = (
                _parsed_money(raw.get("cgst")) + _parsed_money(raw.get("sgst")) + _parsed_money(raw.get("igst"))
            )
            if misclassified > 0:
                raw["other_tax"] = str((_parsed_money(raw.get("other_tax")) + misclassified).quantize(Decimal("0.01")))
                raw["cgst"] = "0.00"
                raw["sgst"] = "0.00"
                raw["igst"] = "0.00"
        # Gemini's itemized read frequently doesn't sum to the grand total it separately read
        # off the same document — a tax/fee/service-charge line it failed to itemize (e.g. a
        # foreign "Sales Tax" line, which isn't Indian GST and so has nowhere else to go) is
        # the usual cause. Rather than let that amount silently vanish from the line-item
        # breakdown, surface it as its own visible "other tax" line so a reviewer can see it
        # was there — kept out of taxable_value/cgst/sgst/igst so it never counts toward Input
        # Tax Credit eligibility (it was never Indian GST).
        line_items_total = sum((_parsed_money(r.get("total_amount")) for r in line_raw), Decimal("0.00"))
        gap = (_parsed_money(converted_grand_total[0]) - line_items_total).quantize(Decimal("0.01"))
        if gap > Decimal("0.01"):
            line_raw.append(
                {
                    "description": "Other taxes (not itemized on the document)",
                    "quantity": "1.00",
                    "unit": "EA",
                    "unit_price": "0.00",
                    "taxable_value": "0.00",
                    "tax_rate": "0.00",
                    "cgst": "0.00",
                    "sgst": "0.00",
                    "igst": "0.00",
                    "other_tax": str(gap),
                    "total_amount": str(gap),
                    "category_hint": line_raw[0].get("category_hint", "incidental") if line_raw else "incidental",
                }
            )
        # The top-level total_taxable_value/cgst/sgst/igst/other_tax fields (shown/edited in
        # the review UI, separate from the per-line-item rows) must reflect the same converted
        # INR figures too — sum the now-converted line items (including the reconciliation
        # line above, if any) rather than leaving those fields at whatever Gemini originally
        # read off the document in its original currency.
        extracted["total_taxable_value"] = (
            str(sum((_parsed_money(r.get("taxable_value")) for r in line_raw), Decimal("0.00"))),
            converted_grand_total[1],
        )
        extracted["cgst"] = (
            str(sum((_parsed_money(r.get("cgst")) for r in line_raw), Decimal("0.00"))), converted_grand_total[1]
        )
        extracted["sgst"] = (
            str(sum((_parsed_money(r.get("sgst")) for r in line_raw), Decimal("0.00"))), converted_grand_total[1]
        )
        extracted["igst"] = (
            str(sum((_parsed_money(r.get("igst")) for r in line_raw), Decimal("0.00"))), converted_grand_total[1]
        )
        extracted["other_tax"] = (
            str(sum((_parsed_money(r.get("other_tax")) for r in line_raw), Decimal("0.00"))), converted_grand_total[1]
        )
    if not line_raw:
        total = _parsed_money(converted_grand_total[0])
        taxable = _parsed_money(extracted.get("total_taxable_value", ("0",))[0])
        cgst = _parsed_money(extracted.get("cgst", ("0",))[0])
        sgst = _parsed_money(extracted.get("sgst", ("0",))[0])
        igst = _parsed_money(extracted.get("igst", ("0",))[0])
        # Gemini's own top-level read of a non-Indian-GST tax (e.g. a foreign "Sales Tax"
        # line) even without full itemization — never fabricated for an INR invoice.
        other_tax = _parsed_money(extracted.get("other_tax", ("0",))[0]) if is_foreign_currency else Decimal("0.00")
        if is_foreign_currency and (cgst > 0 or sgst > 0 or igst > 0):
            # Same hard invariant as the real-line-items branch above: GST cannot apply to a
            # foreign invoice, so anything Gemini put in cgst/sgst/igst here (despite the
            # prompt instruction) is reclassified into other_tax rather than left to inflate
            # Input Tax Credit eligibility. Done before computing taxable below so the two
            # stay arithmetically consistent (taxable + cgst + sgst + igst + other_tax = total).
            other_tax = (other_tax + cgst + sgst + igst).quantize(Decimal("0.01"))
            cgst = sgst = igst = Decimal("0.00")
        if taxable <= 0 and total > 0:
            # The 18% GST back-calculation only makes sense for an INR invoice — for a
            # foreign one, treat the total minus any separately-identified non-GST tax as
            # taxable, with no fabricated Indian GST split.
            taxable = (
                (total - other_tax) if is_foreign_currency else (total / Decimal("1.18")).quantize(Decimal("0.01"))
            )
        tax = (total - taxable - other_tax).quantize(Decimal("0.01")) if total > 0 else Decimal("0.00")
        if not is_foreign_currency and cgst == 0 and sgst == 0 and igst == 0 and tax > 0:
            cgst = (tax / 2).quantize(Decimal("0.01"))
            sgst = (tax - cgst).quantize(Decimal("0.01"))
        cat_name, cat_frag = _infer_category(f"{top_category_hint} {vendor_lower} {invoice.original_filename}")
        line_raw = [
            {
                "description": cat_name,
                "quantity": "1.00",
                "unit": "EA",
                "unit_price": str(taxable),
                "taxable_value": str(taxable),
                "tax_rate": "18.00" if total > 0 and not is_foreign_currency else "0.00",
                "cgst": str(cgst),
                "sgst": str(sgst),
                "igst": str(igst),
                "other_tax": str(other_tax),
                "total_amount": str(total) if total > 0 else str(taxable),
                "category_hint": cat_frag,
            }
        ]
        if is_foreign_currency:
            extracted["cgst"] = (str(cgst), converted_grand_total[1])
            extracted["sgst"] = (str(sgst), converted_grand_total[1])
            extracted["igst"] = (str(igst), converted_grand_total[1])
            extracted["other_tax"] = (str(other_tax), converted_grand_total[1])

    if is_foreign_currency:
        # GST doesn't apply to a foreign invoice — the full converted total, minus whatever
        # non-GST "other tax" was identified, is always the taxable value, by definition. Pin
        # it here (after both the real-line-items and synthetic branches above) so "Grand
        # Total" and "Total Taxable Value" always reconcile in the review UI, even when
        # Gemini's itemized read doesn't sum to the total it separately reported for the
        # document (a real extraction inconsistency — a missed line, discount, or rounding on
        # the source invoice) — the line-item-summed total_taxable_value the real-items
        # branch above computes would otherwise drift.
        cgst_amt = _parsed_money(extracted.get("cgst", ("0",))[0])
        sgst_amt = _parsed_money(extracted.get("sgst", ("0",))[0])
        igst_amt = _parsed_money(extracted.get("igst", ("0",))[0])
        other_tax_amt = _parsed_money(extracted.get("other_tax", ("0",))[0])
        taxable_amt = (
            _parsed_money(converted_grand_total[0]) - cgst_amt - sgst_amt - igst_amt - other_tax_amt
        ).quantize(Decimal("0.01"))
        extracted["total_taxable_value"] = (str(taxable_amt), converted_grand_total[1])

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
        other_tax = _parsed_money(raw.get("other_tax"))
        total_amt = _parsed_money(raw.get("total_amount"))
        hint = str(raw.get("category_hint") or "").lower()
        cat_name, cat_frag = _infer_category(
            f"{hint} {top_category_hint} {vendor_lower} {description} {filename_lower}"
        )
        category = await _find_category(cat_frag, db, travel_date=travel_date)
        # total_amount must always equal taxable_value + tax by definition — Gemini
        # sometimes reports a line item's own total_amount inconsistently with its own
        # taxable/cgst/sgst/igst fields (observed: taxable=99, cgst=sgst=8.91 each, but
        # total_amount also reported as 99 instead of 116.82 — silently undercounting the
        # claim by the tax amount). Whenever a taxable value or other_tax was extracted, the
        # components-derived total is arithmetically guaranteed correct and takes precedence;
        # the raw total_amount is only trusted as a last resort when neither exists.
        if taxable > 0 or other_tax > 0:
            total_amt = (taxable + cgst + sgst + igst + other_tax).quantize(Decimal("0.01"))
        bl_text = f"{description} {vendor_lower} {filename_lower}"
        impact_level_id = await _get_impact_level_id_for_user(invoice.uploader_user_id, db)
        configured_hit = False
        if category:
            configured_hit, _matched = await check_blacklist(
                bl_text, [category.id], db, impact_level_id=impact_level_id
            )
        is_blacklisted = configured_hit or any(t in bl_text for t in ("alcohol", "tobacco"))
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
                other_tax=other_tax,
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

    # Every value here is fabricated (hash-derived total, a vendor name guessed from the
    # filename, hardcoded GSTINs, today's date, ...) — never actually read off the
    # document. Confidence is kept low across the board so InvoiceReview.jsx treats every
    # field as needing a real correction instead of silently auto-confirming made-up
    # numbers as if Gemini had genuinely extracted them.
    FABRICATED_CONFIDENCE = Decimal("20.00")
    # is_tatkal is a checkbox — the "must differ from the guessed value" rule that low
    # confidence otherwise forces doesn't fit a boolean (false is a legitimate, common
    # answer), so it only needs an explicit confirm, not a forced flip.
    BOOLEAN_FIELD_CONFIDENCE = Decimal("65.00")

    extracted_fields = {
        "vendor_name": (stem or "Uploaded Vendor", FABRICATED_CONFIDENCE),
        "supplier_gstin": (gstin, FABRICATED_CONFIDENCE),
        "company_gstin": ("06AAACC4175D1Z0", FABRICATED_CONFIDENCE),
        "invoice_number": (invoice_number, FABRICATED_CONFIDENCE),
        "invoice_date": (today, FABRICATED_CONFIDENCE),
        "place_of_supply": ("27", FABRICATED_CONFIDENCE),
        "payment_mode": ("Card", FABRICATED_CONFIDENCE),
        "currency": ("INR", FABRICATED_CONFIDENCE),
        "grand_total": (str(total), FABRICATED_CONFIDENCE),
        "total_taxable_value": (str(taxable), FABRICATED_CONFIDENCE),
        "cgst": (str((tax / 2).quantize(Decimal("0.01"))), FABRICATED_CONFIDENCE),
        "sgst": (str((tax / 2).quantize(Decimal("0.01"))), FABRICATED_CONFIDENCE),
        "igst": ("0.00", FABRICATED_CONFIDENCE),
        # Mock extraction is always a plain domestic INR invoice — genuinely 0, not a guess.
        "other_tax": ("0.00", Decimal("99.00")),
        "is_tatkal": ("false", BOOLEAN_FIELD_CONFIDENCE),
        "expense_category": (category_name, FABRICATED_CONFIDENCE),
    }
    for key, (value, confidence) in extracted_fields.items():
        db.add(
            InvoiceField(
                invoice_id=invoice.id,
                field_key=key,
                original_value=value,
                final_value=None,
                confidence=confidence,
            )
        )

    description = category_name
    impact_level_id = await _get_impact_level_id_for_user(invoice.uploader_user_id, db)
    configured_hit = False
    if category:
        configured_hit, _matched = await check_blacklist(
            f"{description} {invoice.original_filename.lower()}", [category.id], db, impact_level_id=impact_level_id
        )
    is_blacklisted = configured_hit or any(token in invoice.original_filename.lower() for token in ("alcohol", "tobacco"))
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


_LINE_MONEY_FIELDS = ("unit_price", "taxable_value", "cgst", "sgst", "igst", "other_tax", "total_amount")


async def _rescale_line_items_to_total(invoice_id: int, fields: dict, db: AsyncSession) -> None:
    """Claims are built from an invoice's line items, so when review corrects the invoice's total
    the line items must follow: each line (amount and its tax) is scaled in proportion so they add
    up to the corrected total, keeping its category and blacklisted flag. A foreign invoice's line
    items are in rupees, so they follow its INR total instead of the original-currency one."""
    currency_field = fields.get("currency")
    currency = (currency_field.final_value or currency_field.original_value) if currency_field else None
    key = "grand_total_inr_estimate" if _is_non_inr_currency(currency or "") else "grand_total"
    total_field = fields.get(key)
    if total_field is None:
        return
    raw = total_field.final_value if total_field.final_value not in (None, "") else total_field.original_value
    try:
        target = Decimal(str(raw).replace(",", "").strip()).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return  # not a number: left for review validation, line items untouched
    if target <= 0:
        return
    lines = (
        await db.execute(select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice_id).order_by(InvoiceLineItem.id))
    ).scalars().all()
    current = sum((line.total_amount or Decimal("0") for line in lines), Decimal("0"))
    if not lines or current <= 0 or abs(current - target) < Decimal("0.01"):
        return
    ratio = target / current
    for line in lines:
        for name in _LINE_MONEY_FIELDS:
            value = getattr(line, name)
            if value is not None:
                setattr(line, name, (value * ratio).quantize(Decimal("0.01")))
    # Rounding: put any leftover paisa on the largest line so the lines add up exactly.
    residue = target - sum((line.total_amount or Decimal("0") for line in lines), Decimal("0"))
    if residue:
        largest = max(lines, key=lambda line: line.total_amount or Decimal("0"))
        largest.total_amount = (largest.total_amount or Decimal("0")) + residue
        largest.taxable_value = (largest.taxable_value or Decimal("0")) + residue


# Review edits are free text, so the values everything downstream does sums and date maths on
# are checked before they're saved. Labels match InvoiceReview.jsx's FIELD_LABELS.
_INVOICE_TOTAL_FIELD_LABELS = {"grand_total": "Total", "grand_total_inr_estimate": "Rupee amount"}
_INVOICE_MONEY_FIELD_LABELS = {
    "total_taxable_value": "Taxable value",
    "cgst": "CGST",
    "sgst": "SGST",
    "igst": "IGST",
    "other_tax": "Other tax",
}


def _validate_invoice_field_values(payload: InvoiceFieldsUpdateRequest) -> None:
    """Refuse (422) a review edit whose amount isn't a number (totals above zero, taxes zero or
    more), whose invoice date isn't a real date, or whose nights aren't a whole number. Blank
    values are left to the review-complete check."""
    for update in payload.fields:
        raw = str(update.final_value).strip() if update.final_value is not None else ""
        if not raw:
            continue
        key = update.field_key
        if key in _INVOICE_TOTAL_FIELD_LABELS or key in _INVOICE_MONEY_FIELD_LABELS:
            label = _INVOICE_TOTAL_FIELD_LABELS.get(key) or _INVOICE_MONEY_FIELD_LABELS[key]
            try:
                amount = Decimal(raw.replace(",", ""))
            except InvalidOperation:
                amount = None
            if amount is None or not amount.is_finite():
                raise HTTPException(status_code=422, detail=f"{label} must be a number")
            if key in _INVOICE_TOTAL_FIELD_LABELS and amount <= 0:
                raise HTTPException(status_code=422, detail=f"{label} must be greater than zero")
            if amount < 0:
                raise HTTPException(status_code=422, detail=f"{label} can't be negative")
        elif key == "invoice_date":
            try:
                date.fromisoformat(raw[:10])
                if raw[10:] and raw[10] not in "T ":
                    raise ValueError
            except ValueError:
                raise HTTPException(
                    status_code=422, detail="Invoice date must be a real date (YYYY-MM-DD)"
                ) from None
        elif key == "nights":
            try:
                nights = Decimal(raw)
            except InvalidOperation:
                nights = None
            if nights is None or not nights.is_finite() or nights < 0 or nights != nights.to_integral_value():
                raise HTTPException(status_code=422, detail="Nights must be a whole number")


async def update_invoice_fields(
    invoice_id: int, payload: InvoiceFieldsUpdateRequest, user_id: int, db: AsyncSession
) -> Invoice:
    invoice = _ensure_invoice_owner(await db.get(Invoice, invoice_id), user_id)
    _validate_invoice_field_values(payload)
    _, claim_reference, claim_status = await get_invoice_claim_link(invoice_id, db)
    if claim_status in INVOICE_LOCKING_CLAIM_STATUSES:
        label = claim_reference or "its claim"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"This invoice can no longer be edited — {label} is "
                f"{claim_status.value.replace('_', ' ').title()}. Re-upload the file to review it as a new invoice."
            ),
        )
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
    await _rescale_line_items_to_total(invoice_id, fields, db)

    refreshed = (
        await db.execute(select(InvoiceField).where(InvoiceField.invoice_id == invoice_id))
    ).scalars().all()
    field_by_key = {f.field_key: f for f in refreshed}

    review_complete = True
    for field in field_by_key.values():
        if field.field_key in OPTIONAL_INVOICE_FIELD_KEYS:
            continue
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


async def release_invoice_from_draft(invoice_id: int, user_id: int, db: AsyncSession) -> Invoice:
    """Unlink an invoice from its current claim — but only while that claim is still a
    DRAFT. A submitted (or further along) claim is never touched here; that's what
    INVOICE_LOCKING_CLAIM_STATUSES / delete_invoice's own check already guards. This exists
    because an invoice attached to an untouched draft otherwise has no way back into the
    "unlinked" pool a new claim's invoice picker draws from, short of reopening that exact
    draft, unchecking it, and saving — see the invoice picker's `unlinked` filter."""
    invoice = _ensure_invoice_owner(await db.get(Invoice, invoice_id), user_id)
    claim_id, claim_reference, claim_status = await get_invoice_claim_link(invoice_id, db)
    if claim_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This invoice isn't attached to any claim.")
    if claim_status != ClaimStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"This invoice can only be removed from a claim that's still a draft — "
                f"{claim_reference or f'claim #{claim_id}'} is {claim_status.value.replace('_', ' ').title()}."
            ),
        )
    await db.execute(
        delete(ClaimInvoice).where(ClaimInvoice.claim_id == claim_id, ClaimInvoice.invoice_id == invoice_id)
    )
    await db.commit()
    await db.refresh(invoice)
    return invoice


async def delete_invoice(invoice_id: int, user_id: int, db: AsyncSession) -> None:
    invoice = _ensure_invoice_owner(await db.get(Invoice, invoice_id), user_id)

    # A rejected claim releases its invoices (same rule as assert_invoices_eligible_for_claim) —
    # only a still-live or already-paid claim keeps this invoice locked down.
    blocking_claim_id = (
        await db.execute(
            select(ClaimInvoice.claim_id)
            .join(ClaimDraft, ClaimDraft.id == ClaimInvoice.claim_id)
            .where(ClaimInvoice.invoice_id == invoice_id, ClaimDraft.status != ClaimStatus.REJECTED)
        )
    ).scalars().first()
    if blocking_claim_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This invoice is attached to claim #{blocking_claim_id}. Remove it from the claim before deleting.",
        )

    # Any remaining links are to rejected claims only — drop them so the FK to this
    # invoice doesn't block the delete below; the claim record itself is untouched.
    await db.execute(delete(ClaimInvoice).where(ClaimInvoice.invoice_id == invoice_id))

    # Clear other invoices' duplicate flag pointing at this one before it disappears.
    referring = (
        await db.execute(select(Invoice).where(Invoice.duplicate_invoice_id == invoice_id))
    ).scalars().all()
    for other in referring:
        other.duplicate_invoice_id = None

    await db.execute(delete(InvoiceField).where(InvoiceField.invoice_id == invoice_id))
    await db.execute(delete(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice_id))

    storage_path = Path(invoice.storage_path)
    await db.delete(invoice)
    await db.commit()

    try:
        if storage_path.is_file():
            storage_path.unlink()
    except OSError:
        logger.warning("Could not remove invoice file %s from disk", storage_path)


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


def _dedicated_exception_type(category_name: str) -> str | None:
    """The one dedicated exception type a category has its own approval chain for, derived
    purely from the category name — the single place this mapping is computed. Both
    _build_claim_expenses (below) and ClaimExpenseOut.exception_type (read back by
    ExceptionRequestModal.jsx, which no longer re-derives its own guess) use this, so the
    frontend and backend can no longer disagree on which type an exception request should use.
    None means there's no dedicated chain — callers fall back to a generic f"{category}_DEVIATION".
    """
    normalized = (category_name or "").lower()
    if "hotel" in normalized or "accommodation" in normalized or "stay" in normalized:
        return "ROOM_RENT_DEVIATION"
    if "food" in normalized or "meal" in normalized:
        return "FOOD_DEVIATION"
    if "incidental" in normalized:
        return "INCIDENTAL_DEVIATION"
    if "train" in normalized:
        return "TRAIN_TATKAL"
    if "air" in normalized or "flight" in normalized:
        return "AIR_TRAVEL_L5_L6"
    if "taxi" in normalized or "conveyance" in normalized:
        return "HIRED_TAXI_UNAUTHORIZED"
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
    if not impact or not impact.twin_sharing_mandatory:
        return False

    # Only a colleague's stay can mean a shared room — the employee's own other claims for the
    # same trip (say food on one, the hotel on another) never halve their cap.
    query = select(ClaimDraft).where(
        and_(
            ClaimDraft.id != claim.id,
            ClaimDraft.employee_user_id != claim.employee_user_id,
            ClaimDraft.destination_city == claim.destination_city,
            ClaimDraft.departure_date <= claim.return_date,
            ClaimDraft.return_date >= claim.departure_date,
            ClaimDraft.status.in_([ClaimStatus.IN_APPROVAL, ClaimStatus.PAID, ClaimStatus.READY_FOR_PAYMENT])
        )
    )
    candidates = (await db.execute(query)).scalars().all()
    
    for cand in candidates:
        if cand.employee_user_id == claim.employee_user_id:
            continue
        cand_user = await db.get(User, cand.employee_user_id)
        if not cand_user or not cand_user.employee_id:
            continue
        cand_emp = await db.get(Employee, cand_user.employee_id)
        if not cand_emp or not cand_emp.impact_level_id:
            continue
        cand_impact = await db.get(ImpactLevel, cand_emp.impact_level_id)
        if not cand_impact:
            continue
        if cand_impact.twin_sharing_mandatory:
            return True
            
    return False


# Mirrors the state-code table Gemini is instructed to use for place_of_supply (see
# invoice_gemini_extraction.EXTRACTION_PROMPT) — lets the policy-check screen show a readable
# state name instead of the raw 2-digit GST code.
_GST_STATE_NAMES = {
    "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra", "29": "Karnataka",
    "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
    "35": "Andaman & Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
    "97": "Other Territory",
}


async def _claim_invoice_breakdown(invoice_ids: list[int], db: AsyncSession) -> dict[str, list[dict]]:
    """Per-category list of the invoices (vendor + place) behind a ClaimExpense's total.

    ClaimExpense rows are aggregated across every invoice sharing a category (see
    _build_claim_expenses below), so the policy-check screen needs this separately to show an
    employee which actual invoice/vendor/place a flagged category's amount came from.
    """
    if not invoice_ids:
        return {}

    line_items = (
        await db.execute(
            select(InvoiceLineItem).where(
                InvoiceLineItem.invoice_id.in_(invoice_ids),
                InvoiceLineItem.is_blacklisted.is_(False),
            )
        )
    ).scalars().all()
    if not line_items:
        return {}

    invoices = (await db.execute(select(Invoice).where(Invoice.id.in_(invoice_ids)))).scalars().all()
    filenames = {inv.id: inv.original_filename for inv in invoices}

    fields = (
        await db.execute(
            select(InvoiceField).where(
                InvoiceField.invoice_id.in_(invoice_ids),
                InvoiceField.field_key.in_(["vendor_name", "place_of_supply"]),
            )
        )
    ).scalars().all()
    vendor_names: dict[int, str] = {}
    places: dict[int, str] = {}
    for field in fields:
        value = (field.final_value or field.original_value or "").strip()
        if not value:
            continue
        if field.field_key == "vendor_name":
            vendor_names[field.invoice_id] = value
        elif field.field_key == "place_of_supply":
            places[field.invoice_id] = _GST_STATE_NAMES.get(value, value)

    totals: dict[tuple[str, int], Decimal] = defaultdict(lambda: Decimal("0.00"))
    line_item_rows: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for item in line_items:
        category = item.category_name or "Uncategorised"
        key = (category, item.invoice_id)
        totals[key] += item.total_amount
        line_item_rows[key].append({"description": item.description, "amount": item.total_amount})

    breakdown: dict[str, list[dict]] = defaultdict(list)
    for (category, invoice_id), amount in totals.items():
        breakdown[category].append(
            {
                "invoice_id": invoice_id,
                "vendor_name": vendor_names.get(invoice_id),
                "original_filename": filenames.get(invoice_id, ""),
                "place_of_supply": places.get(invoice_id),
                "amount": amount,
                "line_items": line_item_rows[(category, invoice_id)],
            }
        )
    return breakdown


async def _invoice_dates_and_nights(
    invoice_ids: list[int], db: AsyncSession
) -> tuple[dict[int, date | None], dict[int, int]]:
    """Each invoice's bill date and (hotel bills) number of nights, as reviewed (final value, else
    what extraction read)."""
    if not invoice_ids:
        return {}, {}
    rows = (
        await db.execute(
            select(InvoiceField).where(
                InvoiceField.invoice_id.in_(invoice_ids), InvoiceField.field_key.in_(("invoice_date", "nights"))
            )
        )
    ).scalars().all()
    dates: dict[int, date | None] = {}
    nights: dict[int, int] = {}
    for row in rows:
        value = str(row.final_value if row.final_value not in (None, "") else (row.original_value or "")).strip()
        if row.field_key == "invoice_date":
            try:
                dates[row.invoice_id] = date.fromisoformat(value[:10])
            except ValueError:
                dates[row.invoice_id] = None
        else:
            try:
                count = int(Decimal(value))
            except (InvalidOperation, ValueError):
                continue
            if count > 0:
                nights[row.invoice_id] = count
    return dates, nights


def _hotel_nights(invoice_ids: set[int], bill_nights: dict[int, int], claim: ClaimDraft) -> int:
    """Nights a hotel cap covers: the nights on the bills (a bill without them counts as 1), or —
    when no bill has them — the trip's nights (return − departure), at least 1."""
    known = [bill_nights[i] for i in invoice_ids if i in bill_nights]
    if known:
        return sum(known) + (len(invoice_ids) - len(known))
    if claim.departure_date and claim.return_date:
        return max((claim.return_date - claim.departure_date).days, 1)
    return 1


async def _build_claim_expenses(
    claim: ClaimDraft, invoice_ids: list[int], db: AsyncSession
) -> tuple[list[ClaimExpense], dict]:
    grouped: dict[tuple[int | None, str], Decimal] = defaultdict(lambda: Decimal("0.00"))
    grouped_taxable: dict[tuple[int | None, str], Decimal] = defaultdict(lambda: Decimal("0.00"))
    gst_summary = {
        "taxable_value": Decimal("0.00"),
        "total_taxable_value": Decimal("0.00"),
        "cgst": Decimal("0.00"),
        "sgst": Decimal("0.00"),
        "igst": Decimal("0.00"),
        # Non-Indian-GST tax (foreign VAT/sales tax etc.) — kept separate from cgst/sgst/igst
        # below and deliberately excluded from itc_eligible_amount: it was never Indian GST
        # charged by a GST-registered vendor, so it can never be claimed as Input Tax Credit.
        "other_tax": Decimal("0.00"),
        "grand_total": Decimal("0.00"),
        "itc_eligible_amount": Decimal("0.00"),
    }
    line_items = (
        await db.execute(select(InvoiceLineItem).where(InvoiceLineItem.invoice_id.in_(invoice_ids)))
    ).scalars().all()
    # Policy caps are per night (hotel) / per day (food, incidentals, day visit), so caps are
    # checked against each bill's own date and nights, not the claim's lump total.
    bill_dates, bill_nights = await _invoice_dates_and_nights(invoice_ids, db)
    per_day: dict[tuple[int | None, str], dict] = defaultdict(lambda: defaultdict(lambda: Decimal("0.00")))
    group_invoices: dict[tuple[int | None, str], set[int]] = defaultdict(set)
    for item in line_items:
        gst_summary["taxable_value"] += item.taxable_value
        gst_summary["total_taxable_value"] += item.taxable_value
        gst_summary["cgst"] += item.cgst
        gst_summary["sgst"] += item.sgst
        gst_summary["igst"] += item.igst
        gst_summary["other_tax"] += item.other_tax
        gst_summary["grand_total"] += item.total_amount
        if not item.is_blacklisted:
            key = (item.category_id, item.category_name or "Uncategorised")
            grouped[key] += item.total_amount
            grouped_taxable[key] += item.taxable_value
            per_day[key][bill_dates.get(item.invoice_id)] += item.total_amount
            group_invoices[key].add(item.invoice_id)
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

    limit_row = await _resolve_limit_row(claim, db)
    twin_sharing_active = await _is_twin_sharing_active(claim, db)
    cfg = await get_workflow_config(db)
    # Which exception type each capped field's HARD_BLOCK/SOFT_FLAG actually surfaces as —
    # mirrors _dedicated_exception_type's hotel/food/incidental mapping (day_visit has no
    # dedicated chain there, but DAY_VISIT_EXTERNAL_MEETING is what detect_claim_exceptions
    # auto-raises for it, so that's the toggle this gate has to check).
    field_exception_types = {
        "hotel": "ROOM_RENT_DEVIATION",
        "food": "FOOD_DEVIATION",
        "incidental": "INCIDENTAL_DEVIATION",
        "day_visit": "DAY_VISIT_EXTERNAL_MEETING",
    }
    # Policy exceptions don't apply to relocation claims (for now): no caps, no flags.
    no_policy_checks = claim.reimbursement_category == ReimbursementCategory.RELOCATION
    expenses: list[ClaimExpense] = []
    for (category_id, category_name), amount in grouped.items():
        cap_amount = None
        policy_status = "OK"
        field = _category_limit_field(category_name)
        if no_policy_checks:
            expense = ClaimExpense(
                claim_id=claim.id,
                expense_category_id=category_id,
                category_name=category_name,
                amount=amount,
                taxable_value=grouped_taxable.get((category_id, category_name), Decimal("0.00")),
                cap_amount=None,
                policy_status="OK",
                exception_requested=False,
                exception_type=None,
            )
            db.add(expense)
            expenses.append(expense)
            continue
        if limit_row and field and is_exception_enabled(cfg, field_exception_types.get(field, field)):
            unit_cap = getattr(limit_row, f"{field}_cap")
            if twin_sharing_active and field == "hotel" and unit_cap:
                unit_cap = unit_cap / 2
            key = (category_id, category_name)
            if unit_cap is None:
                cap_amount = None
            elif field == "hotel":
                # Nightly cap × nights: the nights on the hotel bills (read at extraction,
                # correctable in review), or the trip's nights if no bill has them.
                nights = _hotel_nights(group_invoices[key], bill_nights, claim)
                cap_amount = unit_cap * nights
                policy_status, _ = check_cap(limit_row, field, amount, override_cap=cap_amount)
            else:
                # Daily cap, checked day by day (bills grouped by their bill date); flagged if any
                # one day goes over. The cap shown is the daily cap × the number of bill days.
                days = per_day[key]
                cap_amount = unit_cap * max(len(days), 1)
                for day_total in days.values():
                    day_status, _ = check_cap(limit_row, field, day_total, override_cap=unit_cap)
                    if day_status == "HARD_BLOCK" or (day_status == "SOFT_FLAG" and policy_status == "OK"):
                        policy_status = day_status

        # Override policy_status for non-cap policy exceptions
        normalized_cat = (category_name or "").lower()
        exc_type = None

        if (
            has_tatkal
            and ("train" in normalized_cat or not has_train_expense)
            and is_exception_enabled(cfg, "TRAIN_TATKAL")
        ):
            policy_status = "HARD_BLOCK"
            exc_type = "TRAIN_TATKAL"
            has_train_expense = True  # Ensure it only applies once if miscategorized
        elif (
            ("air" in normalized_cat or "flight" in normalized_cat)
            and impact
            and is_exception_enabled(cfg, "AIR_TRAVEL_L5_L6")
        ):
            if impact.air_eligibility in (AirEligibility.NO, AirEligibility.CONDITIONAL):
                policy_status = "HARD_BLOCK"
                exc_type = "AIR_TRAVEL_L5_L6"
        elif (
            ("taxi" in normalized_cat or "hired taxi" in normalized_cat or "local conveyance" in normalized_cat)
            and impact
            and is_exception_enabled(cfg, "HIRED_TAXI_UNAUTHORIZED")
        ):
            if impact.level_code.startswith(("L4", "L5", "L6")):
                modes = impact.local_conveyance_modes or []
                if "Hired Taxi" not in modes:
                    policy_status = "HARD_BLOCK"
                    exc_type = "HIRED_TAXI_UNAUTHORIZED"

        if exc_type is None and policy_status in ("HARD_BLOCK", "SOFT_FLAG"):
            # Cap-driven categories use the type of the cap that flagged them (day visits too —
            # DAY_VISIT_EXTERNAL_MEETING has its own chain); anything else falls back to its
            # dedicated type, or the generic f"{category}_DEVIATION" (POLICY_EXCEPTION_GENERAL
            # chain). Stored on the expense, so submit and every later read use this one value.
            exc_type = (
                field_exception_types.get(field)
                or _dedicated_exception_type(category_name)
                or f"{(category_name or 'GENERAL').upper()}_DEVIATION"
            )

        expense = ClaimExpense(
            claim_id=claim.id,
            expense_category_id=category_id,
            category_name=category_name,
            amount=amount,
            taxable_value=grouped_taxable.get((category_id, category_name), Decimal("0.00")),
            cap_amount=cap_amount,
            policy_status=policy_status,
            exception_requested=False,
            exception_type=exc_type,
        )
        db.add(expense)
        expenses.append(expense)
    await db.flush()

    breakdown = await _claim_invoice_breakdown(invoice_ids, db)
    for expense in expenses:
        expense.invoice_breakdown = breakdown.get(expense.category_name, [])

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
    invoice_ids: list[int],
    user_id: int,
    db: AsyncSession,
    *,
    exclude_claim_id: int | None = None,
    claim_category: ReimbursementCategory | None = None,
) -> None:
    for iid in invoice_ids:
        inv = await db.get(Invoice, iid)
        if inv is None:
            raise HTTPException(status_code=404, detail=f"Invoice {iid} not found")
        inv_label = inv.original_filename or f"Invoice {iid}"
        if inv.uploader_user_id != user_id:
            raise HTTPException(status_code=403, detail=f"{inv_label} cannot be linked to this claim")
        # Each claim type draws only from invoices tagged for it: Travel claims from Travel,
        # General Reimbursement from General, relocation claims (Travel Claim form, trip purpose
        # Relocation) from Relocation — the three never mix.
        if claim_category is not None and inv.reimbursement_category != claim_category:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"{inv_label} is a {inv.reimbursement_category.value.title()} invoice and cannot be "
                    f"added to a {claim_category.value.title()} claim"
                ),
            )
        if inv.status != InvoiceStatus.REVIEWED:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{inv_label} must complete review before it can be used on a claim",
            )
        if inv.duplicate_invoice_id and not inv.duplicate_acknowledged:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{inv_label} is flagged as a duplicate and must be acknowledged before claim use",
            )
        # Once an invoice has been on any claim — approved, in progress, or rejected — it's
        # retired from direct reuse. The only way to attach that same receipt to a new claim
        # is to re-upload the file (see store_invoice_upload, which clears a purely-rejected
        # history so the re-uploaded copy comes back available).
        conflicting_claim_id = (
            await db.execute(
                select(ClaimInvoice.claim_id)
                .join(ClaimDraft, ClaimDraft.id == ClaimInvoice.claim_id)
                .where(
                    ClaimInvoice.invoice_id == iid,
                    ClaimDraft.id != (exclude_claim_id if exclude_claim_id is not None else -1),
                )
            )
        ).scalars().first()
        if conflicting_claim_id is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"{inv_label} is already attached to claim #{conflicting_claim_id}. "
                    "Re-upload the file to use it on a new claim."
                ),
            )


async def trip_ids_on_claims(
    trip_ids: list[int], db: AsyncSession, *, exclude_claim_id: int | None = None
) -> dict[int, str]:
    """Which of these trips already sit on a claim — any claim but a rejected one (a deleted
    draft leaves no link behind) — mapped to that claim's reference, for "still to claim" and
    the one-claim-per-trip rule."""
    if not trip_ids:
        return {}
    query = (
        select(ClaimTrip.trip_id, ClaimDraft.id, ClaimDraft.claim_reference)
        .join(ClaimDraft, ClaimDraft.id == ClaimTrip.claim_id)
        .where(ClaimTrip.trip_id.in_(trip_ids), ClaimDraft.status != ClaimStatus.REJECTED)
    )
    if exclude_claim_id is not None:
        query = query.where(ClaimDraft.id != exclude_claim_id)
    rows = (await db.execute(query)).all()
    return {trip_id: reference or f"claim #{claim_id}" for trip_id, claim_id, reference in rows}


async def assert_trips_not_on_other_claim(trip_ids: list[int], claim_id: int, db: AsyncSession) -> None:
    """A booked trip is claimed once: refuse (409) a trip already on another claim, naming it."""
    linked = await trip_ids_on_claims(trip_ids, db, exclude_claim_id=claim_id)
    if not linked:
        return
    trip_id, where = next(iter(linked.items()))
    trip = await db.get(TravelTrip, trip_id)
    label = (trip.reference_id if trip is not None and trip.reference_id else None) or f"Trip {trip_id}"
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"{label} is already on {where}. A trip can only be claimed once.",
    )


def _assert_trip_dates_in_order(claim: Any) -> None:
    if claim.departure_date and claim.return_date and claim.return_date < claim.departure_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Return date must be on or after the departure date",
        )


def assert_claim_complete_for_submit(claim: ClaimDraft, invoice_ids: list[int], expenses: list) -> None:
    """What the claim wizards require before Submit, checked again here so a claim can't reach
    approvers half-filled: a travel claim needs its trip details (TravelClaimWizard's step 1 —
    a relocation claim takes its cities from the relocation approval and has no trip dates),
    and every claim needs at least one bill adding up to more than ₹0."""
    if claim.reimbursement_category == ReimbursementCategory.TRAVEL:
        required = (
            ("trip_purpose", "Trip purpose"),
            ("office_location", "Office location"),
            ("from_city", "From city"),
            ("destination_city", "Destination city"),
            ("departure_date", "Departure date"),
            ("return_date", "Return date"),
        )
        missing = [
            label for key, label in required
            if getattr(claim, key) is None or not str(getattr(claim, key)).strip()
        ]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Fill in the trip details before submitting: {', '.join(missing)}",
            )
        _assert_trip_dates_in_order(claim)
    if not invoice_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Add at least one bill to submit this claim",
        )
    total = sum((Decimal(str(expense.amount or 0)) for expense in expenses), Decimal("0"))
    if total <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The bills on this claim add up to ₹0, so there's nothing to reimburse",
        )


async def create_or_update_claim_draft(
    payload: ClaimDraftIn, user_id: int, db: AsyncSession
) -> tuple[ClaimDraft, list[ClaimExpense], list[int], list[int]]:
    try:
        return await _create_or_update_claim_draft_impl(payload, user_id, db)
    except Exception as e:
        logger.exception("Error in create_or_update_claim_draft: %s", e)
        raise


async def delete_claim_draft(claim_id: int, user_id: int, db: AsyncSession) -> None:
    """Delete a claim that's still a DRAFT — anything further along (even SENT_BACK, since
    that's mid-approval-history, not a fresh draft) is refused. Frees up every invoice/trip
    it held (they simply become unlinked again, same as release_invoice_from_draft) and
    drops any exception requests on it — only a claim reopened after a send-back can still
    carry some (exceptions are raised at submit, never on a fresh draft)."""
    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    if claim.employee_user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete another employee's claim")
    if claim.status != ClaimStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only a draft claim can be deleted — this claim is {claim.status.value.replace('_', ' ').title()}.",
        )

    from app.models.claim_workflow import ClaimApprovalStage, ExceptionRequest

    # A claim that was ever submitted keeps its history — this also covers one left in DRAFT by
    # an edit after a send-back from before sent-back claims kept their status.
    ever_submitted = claim.claim_reference is not None or claim.submitted_at is not None or (
        await db.execute(select(ClaimApprovalStage.id).where(ClaimApprovalStage.claim_id == claim_id).limit(1))
    ).first() is not None
    if ever_submitted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This claim has already been through approval, so it can't be deleted — its history is kept. "
                "Correct it and submit it again instead."
            ),
        )

    # claim_invoices, claim_trips, claim_expenses and exception_requests have no DB-level
    # ON DELETE CASCADE (NO ACTION), so they're removed explicitly; only claim_approval_stages
    # cascades at the DB level (and a DRAFT claim never has approval stages anyway).
    await db.execute(delete(ClaimInvoice).where(ClaimInvoice.claim_id == claim_id))
    await db.execute(delete(ClaimTrip).where(ClaimTrip.claim_id == claim_id))
    await db.execute(delete(ClaimExpense).where(ClaimExpense.claim_id == claim_id))
    await db.execute(delete(ExceptionRequest).where(ExceptionRequest.claim_id == claim_id))
    await db.delete(claim)
    await db.commit()


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
    # A sent-back claim stays SENT_BACK while the employee corrects it (submit_claim accepts it
    # as-is) — flipping it to DRAFT would hide it from the approver who sent it back and let it
    # be deleted along with its approval history (see delete_claim_draft).

    # Relocation: started from the Travel Claim form with trip purpose "Relocation". It's its own
    # claim type (RELOCATION), raised against an approved relocation, with Relocation invoices only
    # and no trips; origin/destination come from that relocation approval.
    from app.services.relocation_service import RELOCATION_TRIP_PURPOSE, assert_usable_for_claim

    relocation = None
    if (
        payload.trip_purpose == RELOCATION_TRIP_PURPOSE
        or payload.reimbursement_category == ReimbursementCategory.RELOCATION
        or payload.relocation_request_id
    ):
        relocation = await assert_usable_for_claim(payload.relocation_request_id, user_id, db)
        payload = payload.model_copy(
            update={
                "reimbursement_category": ReimbursementCategory.RELOCATION,
                "trip_purpose": RELOCATION_TRIP_PURPOSE,
                "travel_type": "NON_PROJECT",
                "project_code": None,
                "trip_ids": [],
                "from_city": relocation.origin_city,
                "destination_city": relocation.destination_city,
                "office_location": payload.office_location or relocation.destination_city,
            }
        )

    if payload.invoice_ids:
        await assert_invoices_eligible_for_claim(
            payload.invoice_ids,
            user_id,
            db,
            exclude_claim_id=claim.id,
            claim_category=payload.reimbursement_category,
        )
    await assert_trips_not_on_other_claim(list(payload.trip_ids), claim.id, db)
    _assert_trip_dates_in_order(payload)

    # Validated the same way _validate_request_details validates a travel request — the Travel
    # Claim wizard offers the identical admin-managed dropdowns (GET /travel-requests/options),
    # so a claim's travel_type/project_code/trip_purpose must resolve against the same active
    # TravelRequestOption rows. General Reimbursement never sends travel_type=PROJECT or a
    # trip_purpose, so this is a no-op for that wizard.
    from app.services.travel_request_service import _require_active_option

    type_val = (payload.travel_type or "NON_PROJECT").upper()
    if type_val not in {t.value for t in TravelRequestTravelType}:
        raise HTTPException(status_code=422, detail="Invalid travel_type")
    # A value the claim already has is kept as it is (it may have been renamed or retired since);
    # a new one must be an available option, and one an option was renamed from (say, from a trip
    # raised before the rename) is saved under the option's new name.
    if type_val == TravelRequestTravelType.PROJECT.value:
        if not payload.project_code or not payload.project_code.strip():
            raise HTTPException(status_code=422, detail="Project code is required for project travel")
        if payload.project_code != claim.project_code:
            payload = payload.model_copy(
                update={
                    "project_code": await _require_active_option(
                        TravelOptionType.PROJECT_CODE, payload.project_code, "Project code", db
                    )
                }
            )
    if payload.trip_purpose and payload.trip_purpose.strip() and payload.trip_purpose != claim.trip_purpose:
        payload = payload.model_copy(
            update={
                "trip_purpose": await _require_active_option(
                    TravelOptionType.TRIP_PURPOSE, payload.trip_purpose, "Trip purpose", db
                )
            }
        )

    # Set standard fields from payload
    exclude_keys = {"claim_id", "invoice_ids", "trip_ids"}
    for key, value in payload.model_dump(exclude=exclude_keys).items():
        if hasattr(claim, key):
            setattr(claim, key, value)
    claim.relocation_request_id = relocation.id if relocation else None

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
    await annotate_expense_exceptions(claim, expenses, db)
    return claim, expenses, payload.invoice_ids, payload.trip_ids


async def annotate_expense_exceptions(
    claim: ClaimDraft, expenses: list[ClaimExpense], db: AsyncSession, cfg: dict | None = None
) -> None:
    """Attach (transient, not persisted) what the wizard's submit modal needs per flagged
    expense: `exception_mode` (ALLOW/BLOCK, the Approval Matrix's "When flagged" setting),
    `exception_status` (its latest exception request's status, if any) and
    `exception_reason_required` — True while the claim is still editable and this expense has no
    approved exception for its current amount (an approved one survives a send-back only while
    the amount is unchanged).

    A claim's exception request on the shared route lists every exception on it: each expense
    then also gets its own exception's state there — `exception_status` (PENDING / SENT_BACK /
    APPROVED / REJECTED), `exception_reason` (the reason given, to edit after a send-back),
    `exception_comment` (why it was sent back or rejected) and `exception_decisions` (each
    approver's decision on it). A sent-back exception needs a fresh look before resubmitting (its
    reason is prefilled); one already accepted doesn't, while its amount is unchanged."""
    from app.models.claim_workflow import ExceptionApproval, ExceptionRequest, ExceptionRequestStatus
    from app.services.workflow_service import describe_exception_items, is_itemized_claim_request

    cfg = cfg or await get_workflow_config(db)
    requests = (
        await db.execute(
            select(ExceptionRequest)
            .where(
                ExceptionRequest.claim_id == claim.id,
                ExceptionRequest.status != ExceptionRequestStatus.CANCELLED.value,
            )
            .order_by(ExceptionRequest.id)
        )
    ).scalars().all()
    editable = claim.status in (ClaimStatus.DRAFT, ClaimStatus.SENT_BACK)
    itemized = [req for req in requests if is_itemized_claim_request(req)]
    items: list[dict] = []
    if itemized:
        current = itemized[-1]
        steps = (
            await db.execute(select(ExceptionApproval).where(ExceptionApproval.exception_request_id == current.id))
        ).scalars().all()
        items = [i for i in await describe_exception_items(current, list(steps), db) if i["status"] != "DROPPED"]
    for expense in expenses:
        exc_type = expense.exception_type
        expense.exception_item_id = None
        expense.exception_reason = None
        expense.exception_comment = None
        expense.exception_decisions = []
        item = next(
            (i for i in items if i["exception_type"] == exc_type and i["category_name"] == expense.category_name),
            None,
        )
        if exc_type and item is not None:
            same_amount = item["claimed_amount"] is not None and Decimal(item["claimed_amount"]) == Decimal(
                str(expense.amount)
            )
            expense.exception_mode = exception_submission_mode(cfg, exc_type)
            expense.exception_item_id = item["item_id"]
            expense.exception_status = item["status"]
            expense.exception_reason = item["reason"]
            expense.exception_decisions = item["decisions"]
            if item["status"] in (ExceptionRequestStatus.SENT_BACK.value, ExceptionRequestStatus.REJECTED.value):
                expense.exception_comment = item["decision_comment"]
            expense.exception_reason_required = editable and (
                item["status"] == ExceptionRequestStatus.SENT_BACK.value or not same_amount
            )
            continue
        latest = None
        for req in requests:
            if is_itemized_claim_request(req):
                continue
            # Requests raised before per-expense tracking have no category — match on type.
            if req.exception_type == exc_type and req.expense_category_name in (None, expense.category_name):
                latest = req
        approved_for_amount = (
            latest is not None
            and latest.status == ExceptionRequestStatus.APPROVED.value
            and latest.claimed_amount is not None
            and Decimal(str(latest.claimed_amount)) == Decimal(str(expense.amount))
        )
        expense.exception_mode = exception_submission_mode(cfg, exc_type) if exc_type else None
        expense.exception_status = latest.status if latest is not None else None
        expense.exception_reason_required = bool(exc_type) and editable and not approved_for_amount


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

    breakdown = await _claim_invoice_breakdown(invoice_ids, db)
    for expense in expenses:
        expense.invoice_breakdown = breakdown.get(expense.category_name, [])
        if expense.exception_type is None and expense.policy_status != "OK":
            # Rows saved before exception_type was stored — best-effort fallback from the name.
            expense.exception_type = _dedicated_exception_type(expense.category_name) or (
                f"{(expense.category_name or 'GENERAL').upper()}_DEVIATION"
            )
    await annotate_expense_exceptions(claim, expenses, db)

    return claim, expenses, invoice_ids, trip_ids


async def list_claims(
    user_id: int,
    db: AsyncSession,
    *,
    employee_user_id: int | None = None,
    limit: int = 200,
) -> list[ClaimDraft]:
    target_user_id = employee_user_id or user_id
    query = select(ClaimDraft).where(
        ClaimDraft.employee_user_id == target_user_id,
        ClaimDraft.is_exception_shell.is_(False),
    )
    if target_user_id != user_id:
        query = query.where(ClaimDraft.status != ClaimStatus.DRAFT.value)
    query = query.order_by(ClaimDraft.created_at.desc()).limit(limit)
    return (await db.execute(query)).scalars().all()


async def list_claims_all(
    db: AsyncSession,
    *,
    viewer_user_id: int | None = None,
    limit: int = 500,
) -> list[ClaimDraft]:
    # Drafts are private scratch data until the owner submits them — exclude everyone
    # else's drafts from this org-wide listing, same rule list_claims already applies.
    # Exception-request shell claims are plumbing, not real claims — never listed here.
    query = select(ClaimDraft).where(ClaimDraft.is_exception_shell.is_(False))
    if viewer_user_id is not None:
        query = query.where(
            or_(
                ClaimDraft.status != ClaimStatus.DRAFT.value,
                ClaimDraft.employee_user_id == viewer_user_id,
            )
        )
    else:
        query = query.where(ClaimDraft.status != ClaimStatus.DRAFT.value)
    query = query.order_by(ClaimDraft.created_at.desc()).limit(limit)
    return (await db.execute(query)).scalars().all()


async def submit_claim(
    claim_id: int,
    user_id: int,
    db: AsyncSession,
    exception_reasons: list[dict] | None = None,
    undertaking_accepted: bool = False,
) -> ClaimDraft:
    """Submit a draft (or sent-back) claim. Every flagged expense still needing an exception
    must come with a reason in `exception_reasons` ({exception_type, category_name, reason}) —
    the wizard's submit modal collects one per flagged expense (a sent-back one keeps its reason
    unless a new one is given). Together they become the claim's one exception request, an item
    per exception, raised here and nowhere else, so an unsubmitted claim never has one. A claim
    with any exception skips the normal approval stages: the shared claim exception route is its
    approval, and it goes to Finance once the last step accepts every exception; any rejection
    rejects the whole claim, a send-back returns it to the employee (see
    workflow_service.raise_claim_exception_request / decide_claim_exception_items). A claim with
    no exceptions takes the normal approval chain."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    claim, expenses, invoice_ids, trip_ids = await get_claim_bundle(claim_id, user_id, db)
    if claim.status not in (ClaimStatus.DRAFT, ClaimStatus.SENT_BACK):
        raise HTTPException(status_code=409, detail="Only draft or sent-back claims can be submitted")
    assert_claim_complete_for_submit(claim, invoice_ids, expenses)
    await assert_trips_not_on_other_claim(list(trip_ids), claim.id, db)
    if invoice_ids:
        await assert_invoices_eligible_for_claim(
            list(invoice_ids),
            user_id,
            db,
            exclude_claim_id=claim.id,
            claim_category=claim.reimbursement_category,
        )

    relocation = None
    if claim.reimbursement_category == ReimbursementCategory.RELOCATION:
        from app.services.relocation_service import assert_usable_for_claim

        relocation = await assert_usable_for_claim(claim.relocation_request_id, user_id, db)
        if not undertaking_accepted:
            raise HTTPException(
                status_code=422,
                detail="Accept the relocation undertaking to submit this claim",
            )

    cfg = await get_workflow_config(db)
    needing = [expense for expense in expenses if expense.exception_reason_required]
    blocked = [
        expense for expense in needing
        if exception_submission_mode(cfg, expense.exception_type) == EXCEPTION_SUBMISSION_BLOCK
    ]
    if blocked:
        names = ", ".join(expense.category_name for expense in blocked)
        raise HTTPException(
            status_code=409,
            detail=f"Policy doesn't allow submitting these expenses, even with an exception: {names}. "
            "Remove their invoices to submit the claim.",
        )
    reasons: dict[tuple[str, str], str] = {}
    for item in exception_reasons or []:
        key = (str(item.get("exception_type") or ""), str(item.get("category_name") or ""))
        reasons[key] = str(item.get("reason") or "").strip()
    # An exception sent back (or already accepted on a request the employee is resubmitting)
    # keeps the reason it was given unless a new one is typed.
    for expense in expenses:
        key = (expense.exception_type, expense.category_name)
        if expense.exception_type and not reasons.get(key) and getattr(expense, "exception_reason", None):
            reasons[key] = expense.exception_reason.strip()
    missing = [
        expense.category_name
        for expense in needing
        if len(reasons.get((expense.exception_type, expense.category_name), ""))
        < CLAIM_EXCEPTION_REASON_MIN_CHARS
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Give a reason of at least {CLAIM_EXCEPTION_REASON_MIN_CHARS} characters for each "
            f"policy exception: {', '.join(missing)}",
        )

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
    if relocation is not None:
        from app.services.relocation_service import render_undertaking

        # Saved exactly as accepted — with this claim's origin, destination and amount.
        claim.undertaking_accepted_at = claim.submitted_at
        claim.undertaking_text = render_undertaking(
            relocation.origin_city,
            relocation.destination_city,
            sum((Decimal(str(e.amount)) for e in expenses), Decimal("0")),
        )
    # Anything still pending here predates exceptions-on-submit (raised mid-wizard on a draft) —
    # superseded by the reasons given now.
    await cancel_pending_claim_exceptions(claim.id, "Superseded by the reason given at submission.", db)

    # Resubmitting after an exception approver sent some exceptions back: the same request picks up
    # at that approver's step (see resume_claim_exception_request) — unless the claim changed
    # beyond those exceptions (a new one, or an accepted one's amount), then it starts afresh.
    resubmitting = await claim_exception_request_awaiting_resubmit(claim.id, db)
    plan = None
    if resubmitting is not None:
        from app.services.workflow_service import _load_exception_items

        plan = plan_claim_exception_resume(await _load_exception_items(resubmitting.id, db), expenses)
        if plan is None:
            await close_claim_exception_request(
                resubmitting, "Started again: the claim changed after its exceptions were sent back.", db
            )
    covered_by_resubmitted = (
        {(e.exception_type, e.category_name) for e in expenses if getattr(e, "exception_item_id", None)}
        if resubmitting is not None and plan is None
        else set()
    )
    to_raise = (
        []
        if plan is not None
        else [
            e
            for e in expenses
            if e.exception_type
            and (e.exception_reason_required or (e.exception_type, e.category_name) in covered_by_resubmitted)
        ]
    )
    # Both set the claim reference used in the notifications below.
    if any(expense.exception_type for expense in expenses):
        # A claim with policy exceptions is approved by its exception approvers alone and then
        # goes to Finance — it skips the normal approval stages entirely.
        await init_claim_exception_route(
            claim, db, exceptions_pending=bool(to_raise) or bool(plan and plan["remaining"])
        )
    else:
        await init_claim_approval_chain(claim, db)
    if plan is not None:
        await resume_claim_exception_request(claim, resubmitting, plan, reasons, cfg, db)
    elif to_raise:
        await raise_claim_exception_request(
            claim,
            items=[
                {
                    "exception_type": e.exception_type,
                    "category_name": e.category_name,
                    "amount": e.amount,
                    "cap_amount": getattr(e, "cap_amount", None),
                    "reason": reasons[(e.exception_type, e.category_name)],
                }
                for e in to_raise
            ],
            cfg=cfg,
            db=db,
        )
    for expense in to_raise:
        expense.exception_requested = True
    if to_raise:
        claim_ref = claim.claim_reference or f"CLM-{claim.id}"
        count = len(to_raise)
        await create_notification(
            user_id=claim.employee_user_id,
            title=f"Exception{'s' if count > 1 else ''} sent for approval: {claim_ref}",
            body=(
                f"{count} policy exception{'s were' if count > 1 else ' was'} sent to approvers with your claim. "
                "Once every exception is approved, the claim goes to Finance for payment."
            ),
            link=f"/claims/{claim.id}",
            category=NotificationCategory.EXCEPTION.value,
            db=db,
        )
    await db.commit()
    await db.refresh(claim)

    try:
        await check_and_notify_budget_threshold(claim.employee_user_id, db)
    except Exception:
        logger.exception("Budget threshold check failed for claim %s", claim.id)

    return claim
