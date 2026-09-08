import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, JSON, Numeric, String, func
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


class CityGroupType(str, enum.Enum):
    A = "A"
    B = "B"
    C = "C"


class PolicyVersion(Base):
    __tablename__ = "policy_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    status: Mapped[PolicyStatus] = mapped_column(Enum(PolicyStatus), nullable=False)
    approved_by: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


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
    group_type: Mapped[CityGroupType] = mapped_column(Enum(CityGroupType), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)


class ExpenseLimit(Base):
    __tablename__ = "expense_limits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    policy_version_id: Mapped[int] = mapped_column(ForeignKey("policy_versions.id"), nullable=False)
    impact_level_id: Mapped[int] = mapped_column(ForeignKey("impact_levels.id"), nullable=False)
    city_group: Mapped[CityGroupType] = mapped_column(Enum(CityGroupType), nullable=False)
    hotel_cap: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    hotel_is_hard_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    food_cap: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    food_is_hard_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    incidental_cap: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    incidental_is_hard_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    day_visit_cap: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    day_visit_is_hard_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
