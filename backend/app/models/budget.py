from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BudgetConfig(Base):
    """Single-row org-wide toggle for the team-budget feature."""

    __tablename__ = "budget_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class DepartmentBudget(Base):
    """Default monthly spend budget for a department, used when no manager override exists."""

    __tablename__ = "department_budgets"
    __table_args__ = (UniqueConstraint("department", name="uq_department_budgets_department"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    department: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    monthly_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class ManagerBudget(Base):
    """Per-manager monthly spend budget override; takes precedence over the department default."""

    __tablename__ = "manager_budgets"
    __table_args__ = (UniqueConstraint("manager_user_id", name="uq_manager_budgets_manager"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    manager_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    monthly_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
