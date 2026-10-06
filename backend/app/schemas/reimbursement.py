from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.policy import CityGroupType
from app.models.reimbursement import ClaimStatus, GstinValidationStatus, InvoiceStatus, ReimbursementCategory


class InvoiceFieldOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    field_key: str
    original_value: str | None = None
    confidence: Decimal
    final_value: str | None = None
    confirmed_at: datetime | None = None


class InvoiceLineItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    description: str
    quantity: Decimal | None = None
    unit: str | None = None
    unit_price: Decimal | None = None
    taxable_value: Decimal
    tax_rate: Decimal | None = None
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    other_tax: Decimal = Decimal("0")
    total_amount: Decimal
    category_id: int | None = None
    category_name: str | None = None
    is_blacklisted: bool


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    original_filename: str
    content_type: str
    file_size_bytes: int
    status: InvoiceStatus
    duplicate_invoice_id: int | None = None
    duplicate_acknowledged: bool
    gstin_validation_status: GstinValidationStatus | None = None
    extraction_error: str | None = None
    created_at: datetime
    total_amount: Decimal | None = None
    reimbursement_category: ReimbursementCategory = ReimbursementCategory.TRAVEL
    payment_proof_original_filename: str | None = None
    payment_proof_uploaded_at: datetime | None = None
    linked_claim_id: int | None = None
    linked_claim_reference: str | None = None
    linked_claim_status: str | None = None
    is_archived: bool = False
    is_locked: bool = False
    can_delete: bool = True


class InvoiceExtractionOut(InvoiceOut):
    fields: list[InvoiceFieldOut] = Field(default_factory=list)
    line_items: list[InvoiceLineItemOut] = Field(default_factory=list)


class InvoiceFieldUpdate(BaseModel):
    field_key: str
    final_value: str
    confirmed: bool = True


class InvoiceFieldsUpdateRequest(BaseModel):
    fields: list[InvoiceFieldUpdate]
    duplicate_acknowledged: bool = False


class GstinValidationRequest(BaseModel):
    gstin: str


class GstinValidationOut(BaseModel):
    gstin: str
    status: GstinValidationStatus
    legal_name: str | None = None
    checked_at: datetime
    source: str
    pending: bool = False


class DuplicateCheckOut(BaseModel):
    duplicate_invoice_id: int | None = None
    is_duplicate: bool


class ClaimDraftIn(BaseModel):
    claim_id: int | None = None
    # Which "New Claim" entry point created this draft — TRAVEL (default) or GENERAL. The
    # claim's *effective* routing category can still end up REALLOCATION if any linked
    # invoice is tagged that way (see reimbursement_service._resolve_claim_reimbursement_category);
    # this field is just what the wizard itself was opened as.
    reimbursement_category: ReimbursementCategory = ReimbursementCategory.TRAVEL
    invoice_ids: list[int] = Field(default_factory=list)
    trip_ids: list[int] = Field(default_factory=list)
    trip_purpose: str | None = None
    departure_date: date | None = None
    return_date: date | None = None
    office_location: str | None = None
    from_city: str | None = None
    destination_city: str | None = None


class ClaimExpenseLineItemOut(BaseModel):
    description: str
    amount: Decimal


class ClaimExpenseInvoiceOut(BaseModel):
    invoice_id: int
    vendor_name: str | None = None
    original_filename: str = ""
    place_of_supply: str | None = None
    amount: Decimal
    # The specific line(s) on this invoice that fall under the expense category this entry is
    # nested under — lets the exception modal point out exactly which charge to look for on the
    # invoice preview, since there's no bounding-box data to highlight it directly on the image.
    line_items: list[ClaimExpenseLineItemOut] = Field(default_factory=list)


class ClaimExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    expense_category_id: int | None = None
    category_name: str
    amount: Decimal
    taxable_value: Decimal = Decimal("0")
    cap_amount: Decimal | None = None
    policy_status: str
    exception_requested: bool
    # Which invoice(s) this category's total was aggregated from — see
    # reimbursement_service._claim_invoice_breakdown.
    invoice_breakdown: list[ClaimExpenseInvoiceOut] = Field(default_factory=list)
    # Which exception type requesting an exception on this expense should use (None if
    # policy_status is OK) — computed once server-side (see
    # reimbursement_service._dedicated_exception_type) and read directly by
    # ExceptionRequestModal.jsx, instead of the frontend re-deriving its own guess from
    # category_name (that duplication was the root cause of a past routing bug).
    exception_type: str | None = None


class ClaimDraftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_user_id: int
    employee_id: str | None = None
    trip_purpose: str | None = None
    departure_date: date | None = None
    return_date: date | None = None
    office_location: str | None = None
    from_city: str | None = None
    destination_city: str | None = None
    destination_city_group: CityGroupType | None = None
    reimbursement_category: ReimbursementCategory = ReimbursementCategory.TRAVEL
    advance_received: Decimal
    status: ClaimStatus
    claim_reference: str | None = None
    current_approval_stage: int | None = None
    approved_amount: Decimal | None = None
    payment_utr: str | None = None
    payment_amount: Decimal | None = None
    tds_deduction: Decimal = Decimal("0")
    payment_recorded_at: datetime | None = None
    reject_reason: str | None = None
    submitted_at: datetime | None = None
    compliance_report: dict | None = None
    created_at: datetime
    expenses: list[ClaimExpenseOut] = Field(default_factory=list)
    invoice_ids: list[int] = Field(default_factory=list)
    trip_ids: list[int] = Field(default_factory=list)


class PolicyCheckOut(BaseModel):
    id: int
    city_group: CityGroupType | None = None
    total_claimed: Decimal
    advance_received: Decimal
    net_payable: Decimal
    exceptions: list[dict] = Field(default_factory=list)
    gst_summary: dict
    expenses: list[ClaimExpenseOut] = Field(default_factory=list)
