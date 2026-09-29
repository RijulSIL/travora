from decimal import Decimal

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
    # Split for REPORTING_MANAGER (and acting delegates) whose "Pending Approvals" covers
    # both claims and travel requests — lets the UI show where the pending count comes from.
    pending_claims_count: int = 0
    pending_travel_requests_count: int = 0
    outstanding_advance_amount: str = Field(default="0.00")
    outstanding_advance_days: int = 0
    hotel_cap_group_a: str | None = None
    payment_queue_total_inr: str | None = None
    exception_requests_pending_count: int = 0
    advance_deductions_flagged_count: int = 0
    # Only populated for HRBP_HR: requests awaiting ticketing (APPROVED or PARTIALLY_BOOKED).
    travel_desk_queue_count: int = 0
    # From company profile (allowed for all authenticated users — no bank / GSTIN payload).
    company_office_locations: list[str] = Field(default_factory=list)
    workflow_submission_deadline_mode: str = "hard_block"
    workflow_submission_max_working_days: int = 5
    is_acting_delegate: bool = False
    # Roles of everyone currently delegating to this user — must match frontend's
    # navConfig.js DELEGATABLE_NAV_BY_ROLE / permissions.js DELEGATABLE_PERMISSIONS keys
    # exactly, since the frontend uses this to decide which "current queue" nav items and
    # permissions to grant, on top of the user's own base role.
    delegated_roles: list[str] = Field(default_factory=list)
    # Org-wide admin toggle (User Management) — the Profile page's Delegation section reads
    # this to show "disabled by your administrator" instead of a working form.
    delegation_feature_enabled: bool = True
    # Whether this user's OWN role has anything worth delegating (a "current approval
    # queue") at all — EMPLOYEE and IT_ADMIN don't, so they can't create a delegation
    # regardless of the org-wide toggle above.
    can_create_delegation: bool = False
    # Only populated for REPORTING_MANAGER: their personal claim auto-approve threshold
    # (null = disabled, always require manual review) and the org-wide ceiling it is capped at.
    auto_approve_threshold: str | None = None
    org_auto_approve_ceiling: str | None = None


class AutoApproveThresholdIn(BaseModel):
    threshold: Decimal | None = Field(default=None, ge=0)


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
