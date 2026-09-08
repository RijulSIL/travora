from pydantic import BaseModel, Field


class MeOut(BaseModel):
    """Current user profile enriched for shell and dashboards."""

    user_id: int
    email: str
    full_name: str | None = None
    role: str
    employee_id: str | None = None
    impact_level_code: str | None = None
    impact_level_name: str | None = None
    department: str | None = None
    office_location: str | None = None
    reporting_manager_id: str | None = None
    pending_approvals_count: int = 0
    outstanding_advance_amount: str = Field(default="0.00")
    outstanding_advance_days: int = 0
    hotel_cap_group_a: str | None = None
    payment_queue_total_inr: str | None = None
    exception_requests_pending_count: int = 0
    advance_deductions_flagged_count: int = 0
    # From company profile (allowed for all authenticated users — no bank / GSTIN payload).
    company_office_locations: list[str] = Field(default_factory=list)
    workflow_submission_deadline_mode: str = "hard_block"
    workflow_submission_max_working_days: int = 5
    is_acting_delegate: bool = False


class DelegationIn(BaseModel):
    delegatee_id: int
    start_date: str  # ISO date string
    end_date: str    # ISO date string


class DelegationOut(BaseModel):
    id: int
    delegator_id: int
    delegatee_id: int
    delegatee_name: str | None = None
    delegatee_email: str | None = None
    start_date: str
    end_date: str
    is_active: bool
    created_at: str
