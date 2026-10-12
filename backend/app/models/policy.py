import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PolicyStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PENDING_HRBP = "PENDING_HRBP"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class AirEligibility(str, enum.Enum):
    YES = "YES"
    NO = "NO"
    CONDITIONAL = "CONDITIONAL"


class AirClass(str, enum.Enum):
    ECONOMY = "ECONOMY"
    PREMIUM_ECONOMY = "PREMIUM_ECONOMY"
    BUSINESS = "BUSINESS"


class CityGroupTier(Base):
    """The admin-managed, open-ended list of city-group tiers (Metro/A/B/C/however many an admin
    wants) — replaces what used to be a fixed CityGroupType enum. CityGroup.group_type,
    ExpenseLimit.city_group and ClaimDraft.destination_city_group all just store a tier's `code`
    as a plain string (same pattern as ImpactLevel.level_code — no hard foreign key), so a
    historical claim or expense-limit row stays exactly as readable even after its tier is later
    deprecated. `code` is immutable once created (see update_city_group_tier) — renaming it would
    silently orphan every already-stored row that references the old string. Exactly one tier
    must have is_default=True at all times: that's what resolve_city_group falls back to when a
    travelled-to city has no matching classification, replacing the old hardcoded "default to C"."""

    __tablename__ = "city_group_tiers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_deprecated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class PolicyVersion(Base):
    """effective_from is null for the entire DRAFT/PENDING_HRBP lifetime, and stays null even
    once approve_policy_version moves a version to ACTIVE — it's a separate, later, explicit
    step (schedule_policy_version) that picks the date, which can then be moved again any
    number of times right up until it's reached (enforce_immutability cuts it off then). This
    closes a real bug the old "set it during drafting" design had: two pending drafts with
    independently pre-set future dates, approved out of that chronological order, could archive
    an earlier-dated version with an effective_to *before* its own effective_from. Never
    assigning a date until a deliberate scheduling call — and refusing to approve a second
    version while an earlier one is still unscheduled or scheduled ahead — makes that
    structurally impossible."""

    __tablename__ = "policy_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_to: Mapped[date | None] = mapped_column(Date)
    status: Mapped[PolicyStatus] = mapped_column(Enum(PolicyStatus), nullable=False)
    approved_by: Mapped[int | None] = mapped_column(Integer)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class PolicyApproval(Base):
    """One row per role in the configured POLICY_APPROVAL chain (see workflow_service's
    EXCEPTION_APPROVAL_CHAINS — reusing that same configurable-chain storage, even though
    policy approval isn't an exception type) for a given submitted PolicyVersion. Mirrors
    ExceptionApproval's shape/semantics exactly: only one row is ever PENDING at a time (the
    "whose turn is it" stage), the rest are AWAITING until their turn comes, ordered by id."""

    __tablename__ = "policy_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    policy_version_id: Mapped[int] = mapped_column(
        ForeignKey("policy_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    required_role: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    acted_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    acted_at: Mapped[datetime | None] = mapped_column(DateTime)
    comment: Mapped[str | None] = mapped_column(Text)


class ImpactLevel(Base):
    __tablename__ = "impact_levels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    level_code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    level_name: Mapped[str] = mapped_column(String(128), nullable=False)
    air_eligibility: Mapped[AirEligibility] = mapped_column(Enum(AirEligibility), nullable=False)
    air_class_allowed: Mapped[AirClass | None] = mapped_column(Enum(AirClass))
    air_eligibility_conditions: Mapped[dict | None] = mapped_column(JSON)
    train_classes_allowed: Mapped[list | None] = mapped_column(JSON)
    local_conveyance_modes: Mapped[list | None] = mapped_column(JSON)
    vehicle_rate_4w: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    vehicle_rate_2w: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    twin_sharing_mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_deprecated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    policy_version_id: Mapped[int] = mapped_column(ForeignKey("policy_versions.id"), nullable=False)


class CityGroup(Base):
    __tablename__ = "city_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    city_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    # A CityGroupTier's `code`, stored as a plain string — see CityGroupTier's docstring for why
    # this isn't a foreign key.
    group_type: Mapped[str] = mapped_column(String(32), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)


class ExpenseLimit(Base):
    __tablename__ = "expense_limits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    policy_version_id: Mapped[int] = mapped_column(ForeignKey("policy_versions.id"), nullable=False)
    impact_level_id: Mapped[int] = mapped_column(ForeignKey("impact_levels.id"), nullable=False)
    # A CityGroupTier's `code` — see CityGroup.group_type above.
    city_group: Mapped[str] = mapped_column(String(32), nullable=False)
    hotel_cap: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    hotel_is_hard_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    food_cap: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    food_is_hard_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    incidental_cap: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    incidental_is_hard_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    day_visit_cap: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    day_visit_is_hard_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
