from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class ApproverScopeOut(BaseModel):
    """Which parts of the live Approval Matrix this user's role (plus anything they're
    currently delegate-covering) is actually wired into — the frontend uses this to show nav
    items / page content only where the role currently has something to do, instead of a
    hardcoded per-role nav list that silently goes stale whenever an admin reconfigures
    routing (see workflow_service.get_approver_scope)."""

    claims: bool = False
    claim_categories: list[str] = Field(default_factory=list)
    travel_request: bool = False
    exceptions: list[str] = Field(default_factory=list)
    # This role is a stage in the Relocation Approval workflow.
    relocation: bool = False
    # Policy versions currently waiting on this user's approval (Policy Approval chain) — lets
    # them open the policy pages to review and decide, whatever their policy rights.
    policy: int = 0


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
    reporting_manager_name: str | None = None
    pending_approvals_count: int = 0
    # Split for REPORTING_MANAGER (and acting delegates) whose "Pending Approvals" covers
    # both claims and travel requests — lets the UI show where the pending count comes from.
    pending_claims_count: int = 0
    pending_travel_requests_count: int = 0
    pending_relocation_count: int = 0
    hotel_cap_group_a: str | None = None
    payment_queue_total_inr: str | None = None
    exception_requests_pending_count: int = 0
    # Only populated for HRBP_HR: requests awaiting ticketing (APPROVED or PARTIALLY_BOOKED).
    travel_desk_queue_count: int = 0
    # From company profile (allowed for all authenticated users — no bank / GSTIN payload).
    company_office_locations: list[str] = Field(default_factory=list)
    # A trip's claim window, in days after its to date: late (needs a late-claim exception) after
    # the first, archived (can't be claimed) after the second — claim_submission_rules.claim_windows.
    workflow_claim_late_after_days: int = 7
    workflow_claim_archive_after_days: int = 15
    is_acting_delegate: bool = False
    # Roles of everyone currently delegating to this user — must match frontend's
    # navConfig.js DELEGATABLE_NAV_BY_ROLE keys exactly, since the frontend uses this to decide
    # which "current queue" nav items to inject on top of the user's own base role. (The
    # delegated *permissions* themselves are already folded into `permissions` below — the
    # frontend no longer needs to re-derive them from the role list itself.)
    delegated_roles: list[str] = Field(default_factory=list)
    # Org-wide admin toggle (User Management) — the Profile page's Delegation section reads
    # this to show "disabled by your administrator" instead of a working form.
    delegation_feature_enabled: bool = True
    # Whether this user's OWN role has anything worth delegating (a "current approval
    # queue") at all — EMPLOYEE and IT_ADMIN don't, so they can't create a delegation
    # regardless of the org-wide toggle above.
    can_create_delegation: bool = False
    # The Manager setting (always on for the CEO): people can report to them, on top of their role.
    is_manager: bool = False
    # Still on the temporary password: the app shows "Set your password" before anything else.
    must_change_password: bool = False
    # Only populated for managers: their personal claim auto-approve threshold
    # (null = disabled, always require manual review) and the org-wide ceiling it is capped at.
    auto_approve_threshold: str | None = None
    org_auto_approve_ceiling: str | None = None
    approver_scope: ApproverScopeOut = Field(default_factory=ApproverScopeOut)
    # This viewer's own effective, delegation-merged permission set — computed server-side from
    # the (admin-editable) role->permission matrix, see permission_config_service.py. The
    # frontend trusts this directly instead of keeping its own hardcoded copy of the matrix, so
    # RoleGuard/nav visibility automatically track whatever an IT Admin has configured.
    permissions: list[str] = Field(default_factory=list)
    # The viewer's own advance still left to use (Finance grants it; a paid claim uses it first).
    # Read-only and only ever this user's own figure — Finance alone manages advances.
    outstanding_advance: str = "0.00"


class PolicyCapOut(BaseModel):
    amount: str | None = None
    # Hard block = a claim over this cap is rejected outright; otherwise it needs an exception.
    is_hard_block: bool = False


class CityTierLimitsOut(BaseModel):
    city_group: str
    city_group_name: str
    is_default: bool = False
    hotel: PolicyCapOut
    food: PolicyCapOut
    incidental: PolicyCapOut
    day_visit: PolicyCapOut


class MyPolicyLimitsOut(BaseModel):
    """Everything the travel policy in force today allows the signed-in employee, at their impact level."""

    has_policy: bool = False
    policy_version: str | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    impact_level_code: str | None = None
    impact_level_name: str | None = None
    air_eligibility: str | None = None
    air_class_allowed: str | None = None
    air_eligibility_conditions: dict | None = None
    train_classes_allowed: list[str] = Field(default_factory=list)
    local_conveyance_modes: list[str] = Field(default_factory=list)
    vehicle_rate_4w: str | None = None
    vehicle_rate_2w: str | None = None
    twin_sharing_mandatory: bool = False
    city_limits: list[CityTierLimitsOut] = Field(default_factory=list)


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
