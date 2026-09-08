from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Employee(Base):
    __tablename__ = "employees"

    employee_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    designation: Mapped[str | None] = mapped_column(String(255))
    impact_level_id: Mapped[int | None] = mapped_column(ForeignKey("impact_levels.id"), index=True)
    reporting_manager_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.employee_id"), nullable=True, index=True
    )
    business_unit: Mapped[str | None] = mapped_column(String(255))
    department: Mapped[str | None] = mapped_column(String(255), index=True)
    office_location: Mapped[str | None] = mapped_column(String(255))
    cost_centre: Mapped[str | None] = mapped_column(String(128))
    bank_account_details: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    old_value: Mapped[dict | None] = mapped_column(JSON)
    new_value: Mapped[dict | None] = mapped_column(JSON)
    previous_event_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    event_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
