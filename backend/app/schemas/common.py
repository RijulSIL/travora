from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.auth import Role
from app.models.policy import AirClass, AirEligibility, PolicyStatus


class LoginRequest(BaseModel):
    email: str
    password: str


class MFAVerifyRequest(BaseModel):
    mfa_token: str
    otp_code: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict
    refresh_token: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: str


def _validate_password_complexity(value: str) -> str:
    import re
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if not re.search(r"[A-Z]", value):
        raise ValueError("Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", value):
        raise ValueError("Password must contain at least one lowercase letter")
    if not re.search(r"[0-9]", value):
        raise ValueError("Password must contain at least one number")
    if not re.search(r"[!@#$%^&*()_+={}\[\]|\\:;\"'<>,.?/~`-]", value):
        raise ValueError("Password must contain at least one special character")
    return value


class ResetPasswordRequest(BaseModel):
    email: str
    otp_code: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password_complexity(cls, value: str) -> str:
        return _validate_password_complexity(value)


class SetInitialPasswordRequest(BaseModel):
    """First sign-in: replace the temporary password with their own."""

    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password_complexity(cls, value: str) -> str:
        return _validate_password_complexity(value)


class ChangePasswordRequestOTP(BaseModel):
    current_password: str


class ChangePasswordConfirm(BaseModel):
    otp_code: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password_complexity(cls, value: str) -> str:
        return _validate_password_complexity(value)



class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str | None = None
    role: Role
    mfa_verified: bool
    is_active: bool


class AdminUserOut(BaseModel):
    user_id: int
    email: str
    full_name: str | None = None
    role: Role
    mfa_verified: bool
    is_active: bool
    employee_id: str | None = None
    department: str | None = None
    impact_level_id: int | None = None
    office_location: str | None = None
    reporting_manager_id: str | None = None
    # The Manager setting (always on for the CEO) — people can report to them.
    is_manager: bool = False
    # Still on the temporary password (hasn't signed in and set their own yet).
    must_change_password: bool = False
    welcome_email_sent_at: datetime | None = None


class AdminUserCreateIn(BaseModel):
    email: str
    # Blank: the temporary password (welcome_service.TEMPORARY_PASSWORD). Either way they must set
    # their own at their first sign-in.
    password: str | None = None
    send_welcome_email: bool = True
    full_name: str | None = None
    role: Role = Role.EMPLOYEE
    employee_id: str | None = None
    mfa_verified: bool = True
    impact_level_id: int | None = None
    reporting_manager_id: str | None = None
    department: str | None = None
    is_manager: bool = False


class AdminUserUpdateIn(BaseModel):
    full_name: str | None = None
    role: Role | None = None
    impact_level_id: int | None = None
    department: str | None = None
    office_location: str | None = None
    reporting_manager_id: str | None = None
    is_manager: bool | None = None


class AdminTeamMoveIn(BaseModel):
    """Move everyone reporting to a manager to another manager (before turning Manager off or
    deactivating them). Their waiting manager-step approvals follow."""

    new_manager_employee_id: str


class AdminTeamAddIn(BaseModel):
    """Turn someone's Manager setting on and put these people under them (the CSV import's
    one-click fix for people whose named manager wasn't a manager yet)."""

    employee_ids: list[str]


class AdminTeamSummaryOut(BaseModel):
    reports: list[dict] = Field(default_factory=list)
    waiting_claims: int = 0
    waiting_travel_requests: int = 0
    waiting_exceptions: int = 0


class AdminBulkImportErrorOut(BaseModel):
    row: int
    employee_id: str | None = None
    email: str | None = None
    error: str


class AdminBulkImportSummaryOut(BaseModel):
    created: int
    failed: int
    errors: list[AdminBulkImportErrorOut] = Field(default_factory=list)
    # People who were added, but without something they asked for (e.g. a manager ID that didn't match).
    warnings: list[AdminBulkImportErrorOut] = Field(default_factory=list)
    # People left without a manager only because the manager named for them isn't one yet, grouped
    # by that person: {manager_user_id, manager_employee_id, manager_name, people: [{employee_id,
    # full_name, row}]}. The result screen offers "make them a manager and link these people".
    unlinked_managers: list[dict] = Field(default_factory=list)
    # Departments the import added to the company's list (chosen on the check screen).
    added_departments: list[str] = Field(default_factory=list)
    # How many welcome emails are going out (sent in the background after the import finishes).
    welcome_emails_queued: int = 0


class PolicyVersionIn(BaseModel):
    version_number: str
    # effective_from is deliberately NOT here — it's never user-supplied at draft time. Even once
    # approved, it stays unset until a separate schedule_policy_version call picks it — see
    # PolicyVersion's docstring for the bug this design closes.
    effective_to: date | None = None
    status: PolicyStatus = PolicyStatus.DRAFT


class PolicyScheduleIn(BaseModel):
    effective_from: date


class PolicyVersionOut(PolicyVersionIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # None until explicitly scheduled (which can happen well after approval) — see the comment
    # on PolicyVersionIn above.
    effective_from: date | None = None
    approved_by: int | None = None
    approved_at: datetime | None = None
    created_by: int | None = None
    created_at: datetime


class ImpactLevelIn(BaseModel):
    level_code: str
    level_name: str
    air_eligibility: AirEligibility
    air_class_allowed: AirClass | None = None
    air_eligibility_conditions: dict | None = None
    train_classes_allowed: list | None = None
    local_conveyance_modes: list | None = None
    vehicle_rate_4w: Decimal | None = None
    vehicle_rate_2w: Decimal | None = None
    twin_sharing_mandatory: bool = False
    policy_version_id: int


class ImpactLevelOut(ImpactLevelIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_deprecated: bool


class CityGroupIn(BaseModel):
    city_name: str
    # A CityGroupTier's `code` — validated against the live tier list server-side (see
    # admin/policy.py), not a fixed enum, since tiers are now admin-managed.
    group_type: str
    effective_from: date
    effective_to: date | None = None


class CityGroupOut(CityGroupIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class CityGroupTierIn(BaseModel):
    code: str
    display_name: str
    is_default: bool = False


# code is deliberately absent here — it's immutable once created (see CityGroupTier's docstring
# for why renaming it would silently orphan every row that already stores the old string).
# is_deprecated is also absent — that's DELETE's job (soft-deprecate), matching ImpactLevel's
# PUT-edits/DELETE-deprecates split.
class CityGroupTierUpdateIn(BaseModel):
    display_name: str
    is_default: bool


class CityGroupTierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    display_name: str
    is_default: bool
    is_deprecated: bool


class ExpenseLimitIn(BaseModel):
    policy_version_id: int
    impact_level_id: int
    city_group: str
    hotel_cap: Decimal | None = None
    hotel_is_hard_block: bool = False
    food_cap: Decimal | None = None
    food_is_hard_block: bool = False
    incidental_cap: Decimal | None = None
    incidental_is_hard_block: bool = False
    day_visit_cap: Decimal | None = None
    day_visit_is_hard_block: bool = False


class UserRoleUpdateIn(BaseModel):
    role: Role


class ExpenseLimitOut(ExpenseLimitIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class ExpenseCategoryIn(BaseModel):
    name: str
    parent_category_id: int | None = None
    bill_mandatory: bool = False
    gst_invoice_required: bool = False
    blacklisted_items: list[str] | None = None
    notes: str | None = None
    policy_version_id: int


class ExpenseCategoryOut(ExpenseCategoryIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_active: bool
    children: list["ExpenseCategoryOut"] = Field(default_factory=list)


class BlacklistCheckRequest(BaseModel):
    description: str
    category_ids: list[int]
    impact_level_id: int | None = None
    impact_level_code: str | None = None


class CompanyProfileIn(BaseModel):
    company_name: str
    gstins: list[str] = []
    office_locations: list[str] = []
    bank_details: dict | None = None
    # The company's department list; None leaves it as it is.
    departments: list[str] | None = None
    # {old name: new name} for departments renamed in this save — moves the people in them, their
    # department head and team budget to the new name.
    department_renames: dict[str, str] = Field(default_factory=dict)
    # {old name: new name} for offices renamed in this save — moves the people in them.
    office_renames: dict[str, str] = Field(default_factory=dict)


class CompanyProfileOut(BaseModel):
    id: int
    company_name: str
    gstins: list[str] = []
    office_locations: list[str] = []
    bank_details: dict | None = None
    departments: list[str] = Field(default_factory=list)
    # Active people per department (as stored on their records), for "N people" on each.
    department_counts: dict[str, int] = Field(default_factory=dict)
    # Active people per office as stored on their records, including offices not on the list.
    office_counts: dict[str, int] = Field(default_factory=dict)


class DelegationConfigOut(BaseModel):
    enabled: bool


class DelegationConfigIn(BaseModel):
    enabled: bool
