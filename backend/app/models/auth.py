import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Role(str, enum.Enum):
    EMPLOYEE = "EMPLOYEE"
    # No longer given to anyone: being a manager is the User.is_manager setting, on top of any
    # role. The value stays as the name of the approval step "this person's manager" and as the
    # key of the Manager row in Role permissions; a legacy user/token still counts as a manager.
    REPORTING_MANAGER = "REPORTING_MANAGER"
    HRBP_HR = "HRBP_HR"
    PAYROLL = "PAYROLL"
    FINANCE = "FINANCE"
    IT_ADMIN = "IT_ADMIN"
    CEO = "CEO"
    GROUP_HEAD_HR = "GROUP_HEAD_HR"
    # Uses the app like a regular employee, and approves relocation requests (the first stage of
    # the default Relocation Approval workflow — see workflow_service.RELOCATION_REQUEST_DEFAULT_STAGES).
    RECRUITER = "RECRUITER"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    employee_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("employees.employee_id"), nullable=True, index=True
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False, length=50), nullable=False, default=Role.EMPLOYEE)
    mfa_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # The Manager setting: people can report to them, and they get the Manager permissions on top
    # of their role. Always on for the CEO. See rbac.is_manager.
    is_manager: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    auto_approve_threshold: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # When this token was swapped for a new one (auth_service.rotate_refresh_token); NULL if it
    # never was — e.g. cancelled by logging out, which gets no grace period.
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Delegation(Base):
    __tablename__ = "delegations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    delegator_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    delegatee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    start_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class DelegationConfig(Base):
    """Single-row org-wide toggle for the delegation feature (same pattern as
    BudgetConfig). While disabled, existing Delegation rows are left untouched but
    every permission/role check treats them as inactive — see app.core.rbac."""

    __tablename__ = "delegation_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class RolePermissionConfig(Base):
    """Single-row admin-editable override of app.core.rbac's PERMISSION_MATRIX /
    DELEGATABLE_PERMISSIONS (same pattern as WorkflowConfigRow for claim-approval routing).
    Absent row => those hardcoded dicts are authoritative, unchanged from today — see
    app.services.permission_config_service.get_effective_permission_matrix.

    config_json shape: {"permissions": {role_value: [perm, ...]}, "delegatable_permissions":
    {role_value: [perm, ...]}}. submit_claim/view_self are never stored here — they're an
    unconditional baseline every role always has, outside this config entirely."""

    __tablename__ = "role_permission_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    config_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
