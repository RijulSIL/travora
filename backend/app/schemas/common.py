from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.auth import Role
from app.models.policy import AirClass, AirEligibility, CityGroupType, PolicyStatus


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


class AdminUserCreateIn(BaseModel):
    email: str
    password: str
    full_name: str | None = None
    role: Role = Role.EMPLOYEE
    employee_id: str | None = None
    mfa_verified: bool = True
    impact_level_id: int | None = None
    reporting_manager_id: str | None = None
    department: str | None = None


class AdminUserUpdateIn(BaseModel):
    full_name: str | None = None
    role: Role | None = None
    impact_level_id: int | None = None
    department: str | None = None
    office_location: str | None = None
    reporting_manager_id: str | None = None


class AdminBulkImportErrorOut(BaseModel):
    row: int
    employee_id: str | None = None
    email: str | None = None
    error: str


class AdminBulkImportSummaryOut(BaseModel):
    created: int
    failed: int
    errors: list[AdminBulkImportErrorOut] = Field(default_factory=list)


class PolicyVersionIn(BaseModel):
    version_number: str
    effective_from: date
    effective_to: date | None = None
    status: PolicyStatus = PolicyStatus.DRAFT


class PolicyVersionOut(PolicyVersionIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    approved_by: int | None = None
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
    group_type: CityGroupType
    effective_from: date
    effective_to: date | None = None


class CityGroupOut(CityGroupIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class ExpenseLimitIn(BaseModel):
    policy_version_id: int
    impact_level_id: int
    city_group: CityGroupType
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


class CompanyProfileOut(CompanyProfileIn):
    id: int
