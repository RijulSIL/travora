from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.finance import ReportFormat, ScheduleFrequency
from app.schemas.common import check_email_address


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
    actor_name: str | None = None
    entity_label: str | None = None


class AuditLogPageOut(BaseModel):
    items: list[AuditLogOut]
    total: int
    page: int
    page_size: int


class AuditCountOut(BaseModel):
    key: str
    count: int


class AuditGapOut(BaseModel):
    id: int | None = None
    kind: str
    timestamp: datetime | None = None
    action: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    linked_to_id: int | None = None
    is_old: bool


class AuditIntegrityOut(BaseModel):
    status: str
    total: int
    recheck_from_id: int | None = None
    rechecked: int
    gaps: list[AuditGapOut]


class AuditOverviewOut(BaseModel):
    total: int
    first_at: datetime | None = None
    people: int
    entity_counts: list[AuditCountOut]
    action_counts: list[AuditCountOut]
    integrity: AuditIntegrityOut


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

    @field_validator("report_type")
    @classmethod
    def known_report_type(cls, value: str) -> str:
        from app.services.finance_reporting_service import SCHEDULABLE_REPORT_TYPES

        cleaned = value.strip()
        if cleaned not in SCHEDULABLE_REPORT_TYPES:
            raise ValueError(f"{cleaned or 'That'} isn't a report that can be scheduled")
        return cleaned

    @field_validator("recipients")
    @classmethod
    def valid_recipients(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for address in value:
            email = check_email_address(address)
            if email not in cleaned:
                cleaned.append(email)
        return cleaned


class ReportScheduleActiveIn(BaseModel):
    is_active: bool


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
    id: int | None = None
    required_role: str
    status: str
    acted_by_user_id: int | None = None
    acted_at: datetime | None = None
    acted_by_name: str | None = None
    sla_deadline_at: datetime | None = None
    comment: str | None = None


class ExceptionItemStepDecisionOut(BaseModel):
    """One step's decision on one exception of a claim's exception request."""

    exception_approval_id: int
    step: int | None = None
    required_role: str | None = None
    decision: str
    comment: str | None = None
    decided_by_user_id: int | None = None
    decided_by_name: str | None = None
    decided_at: datetime | None = None


class ExceptionItemOut(BaseModel):
    """One exception listed on a claim's exception request."""

    item_id: int
    exception_type: str
    exception_type_label: str | None = None
    category_name: str | None = None
    claimed_amount: Decimal | None = None
    cap_amount: Decimal | None = None
    reason: str | None = None
    status: str
    decision_comment: str | None = None
    # Whether the step now waiting still has to decide this one.
    awaiting_current_step: bool = False
    decisions: list[ExceptionItemStepDecisionOut] = Field(default_factory=list)


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
    travel_type: str | None = None
    project_code: str | None = None
    purpose: str | None = None
    notes: str | None = None
    # The traveler's flight/train/bus choice per leg (see TravelRequest.leg_picks).
    leg_picks: list[dict] = Field(default_factory=list)
    requested_at: datetime
    legs: list[ExceptionTravelRequestLegOut] = Field(default_factory=list)


class ExceptionRequestLogOut(BaseModel):
    exception_id: int
    exception_ref: str | None = None
    # CLAIM_EXCEPTIONS / TRAVEL_EXCEPTIONS; None for requests raised before the shared routes.
    route_key: str | None = None
    # A claim's one request listing each exception (decided one by one), with those exceptions.
    itemized: bool = False
    items: list[ExceptionItemOut] = Field(default_factory=list)
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
    # Claim-linked requests: the flagged expense this was raised for, and its amount at submit.
    expense_category_name: str | None = None
    claimed_amount: Decimal | None = None
    decision_comment: str | None = None
    required_approvers: list[str] = Field(default_factory=list)
    decisions: list[ExceptionApprovalDecisionOut] = Field(default_factory=list)
    # Only ever set for a travel-request-linked exception (AIR_TRAVEL_UNLOCK,
    # FLIGHT_ADVANCE_BOOKING_OVERRIDE, ...) — the claim-linked case has nothing analogous here
    # since claim_ref already links out to the full claim review screen.
    travel_request: ExceptionTravelRequestOut | None = None
