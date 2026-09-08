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
    created_by_user_id: int
    created_at: datetime


class ERPLedgerEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    claim_id: int
    employee_id: str | None = None
    cost_centre: str | None = None
    expense_category_breakdown: dict | None = None
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    payment_reference: str
    payment_date: datetime
    erp_system: str | None = None
    erp_entry_id: str | None = None
    status: str
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


class ExceptionRequestLogOut(BaseModel):
    exception_id: int
    claim_id: int | None = None
    claim_ref: str | None = None
    employee: str | None = None
    employee_id: str | None = None
    exception_type: str
    status: str
    requested_on: datetime
    decided_by: str | None = None
    description: str | None = None
    required_approvers: list[str] = Field(default_factory=list)
    decisions: list[ExceptionApprovalDecisionOut] = Field(default_factory=list)
