from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.policy import CityGroupType
from app.models.reimbursement import ClaimStatus, GstinValidationStatus, InvoiceStatus


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
    invoice_ids: list[int] = Field(default_factory=list)
    trip_ids: list[int] = Field(default_factory=list)
    trip_purpose: str | None = None
    departure_date: date | None = None
    return_date: date | None = None
    office_location: str | None = None
    from_city: str | None = None
    destination_city: str | None = None
    advance_received: Decimal = Decimal("0")


class ClaimExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    expense_category_id: int | None = None
    category_name: str
    amount: Decimal
    cap_amount: Decimal | None = None
    policy_status: str
    exception_requested: bool


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
    advance_received: Decimal
    status: ClaimStatus
    claim_reference: str | None = None
    current_approval_stage: int | None = None
    approved_amount: Decimal | None = None
    payment_utr: str | None = None
    payment_amount: Decimal | None = None
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
