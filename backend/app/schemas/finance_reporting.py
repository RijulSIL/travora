from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.finance import ReportFormat, ScheduleFrequency


class FinanceFilterParams(BaseModel):
    from_date: date | None = None
    to_date: date | None = None
    department: str | None = None
    expense_category: str | None = None
    office_location: str | None = None
    employee_level: str | None = None
    impact_level: str | None = None


class GstSummaryOut(BaseModel):
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    total_tax: Decimal
    itc_eligible_amount: Decimal


class SpendByCategoryOut(BaseModel):
    category: str
    amount: Decimal


class ERPPostIn(BaseModel):
    claim_id: int
    erp_system: str | None = None


class ERPPostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    claim_id: int
    payment_reference: str
    payment_date: datetime
    erp_system: str | None = None
    erp_entry_id: str | None = None
    status: str
    created_at: datetime


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    entity_type: str
    entity_id: str
    action: str
    actor_id: int | None = None
    old_value: dict | None = None
    new_value: dict | None = None
    previous_event_hash: str | None = None
    event_hash: str
    timestamp: datetime


class ReportScheduleIn(BaseModel):
    report_type: str
    report_format: ReportFormat
    frequency: ScheduleFrequency
    recipients: list[str] = Field(min_length=1)
    filters: dict | None = None

    @field_validator("report_format")
    @classmethod
    def csv_only_format(cls, value: ReportFormat) -> ReportFormat:
        if value != ReportFormat.CSV:
            raise ValueError("Only CSV report_format is currently supported")
        return value


class ReportScheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    report_type: str
    report_format: ReportFormat
    frequency: ScheduleFrequency
    recipients: list[str]
    filters: dict | None = None
    is_active: bool
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    created_by_user_id: int
    created_at: datetime


class ERPLedgerEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    claim_id: int
    claim_reference: str | None = None
    employee_id: str | None = None
    employee_name: str | None = None
    cost_centre: str | None = None
    expense_category_breakdown: dict | None = None
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    # The GST split above is what gets posted to the books; these three tell the actual
    # payment story — how the total claimed was split between cash paid out, tax withheld,
    # and any advance netted off — which the ledger table itself never stored.
    total_claimed: Decimal | None = None
    payment_amount: Decimal | None = None
    tds_deduction: Decimal | None = None
    advance_deducted: Decimal | None = None
    payment_reference: str
    payment_date: datetime
    erp_system: str | None = None
    erp_entry_id: str | None = None
    status: str
    failure_reason: str | None = None
    posted_by_name: str | None = None
    created_at: datetime


class PolicyViolationRowOut(BaseModel):
    claim_id: int
    employee_id: str | None = None
    department: str | None = None
    category: str
    claimed: Decimal
    cap: Decimal
    excess: Decimal


class PolicyViolationsOut(BaseModel):
    departments: list[str]
    categories: list[str]
    matrix: dict[str, dict[str, int]]
    violations: list[PolicyViolationRowOut]


class ExceptionApprovalDecisionOut(BaseModel):
    required_role: str
    status: str
    acted_by_user_id: int | None = None
    acted_at: datetime | None = None
    comment: str | None = None


class ExceptionTravelRequestLegOut(BaseModel):
    from_city: str
    to_city: str
    travel_date: date
    travel_mode: str | None = None


class ExceptionTravelRequestOut(BaseModel):
    id: int
    trip_type: str
    travel_mode: str
    from_city: str | None = None
    to_city: str | None = None
    travel_date: date | None = None
    return_date: date | None = None
    purpose: str | None = None
    preferred_class: str | None = None
    notes: str | None = None
    requested_at: datetime
    legs: list[ExceptionTravelRequestLegOut] = Field(default_factory=list)


class ExceptionRequestLogOut(BaseModel):
    exception_id: int
    exception_ref: str | None = None
    claim_id: int | None = None
    claim_ref: str | None = None
    employee: str | None = None
    employee_id: str | None = None
    exception_type: str
    exception_types: list[str] = Field(default_factory=list)
    status: str
    requested_on: datetime
    decided_by: str | None = None
    description: str | None = None
    required_approvers: list[str] = Field(default_factory=list)
    decisions: list[ExceptionApprovalDecisionOut] = Field(default_factory=list)
    # Only ever set for a travel-request-linked exception (AIR_TRAVEL_UNLOCK,
    # FLIGHT_ADVANCE_BOOKING_OVERRIDE, ...) — the claim-linked case has nothing analogous here
    # since claim_ref already links out to the full claim review screen.
    travel_request: ExceptionTravelRequestOut | None = None
