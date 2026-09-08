import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ReportFormat(str, enum.Enum):
    PDF = "PDF"
    EXCEL = "EXCEL"
    CSV = "CSV"


class ScheduleFrequency(str, enum.Enum):
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"


class ERPPostStatus(str, enum.Enum):
    POSTED = "POSTED"
    FAILED = "FAILED"
    PENDING = "PENDING"


class ERPLedgerEntry(Base):
    __tablename__ = "erp_ledger_entries"
    __table_args__ = (UniqueConstraint("claim_id", name="uq_erp_ledger_entries_claim_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claim_drafts.id"), nullable=False, index=True)
    employee_id: Mapped[str | None] = mapped_column(String(64), index=True)
    cost_centre: Mapped[str | None] = mapped_column(String(128), index=True)
    expense_category_breakdown: Mapped[dict | None] = mapped_column(JSON)
    taxable_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    cgst: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    sgst: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    igst: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    payment_reference: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    payment_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    erp_system: Mapped[str | None] = mapped_column(String(64))
    erp_entry_id: Mapped[str | None] = mapped_column(String(128), index=True)
    status: Mapped[ERPPostStatus] = mapped_column(
        Enum(ERPPostStatus), nullable=False, default=ERPPostStatus.POSTED, index=True
    )
    failure_reason: Mapped[str | None] = mapped_column(Text)
    posted_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class ScheduledReport(Base):
    __tablename__ = "scheduled_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    report_format: Mapped[ReportFormat] = mapped_column(Enum(ReportFormat), nullable=False, index=True)
    frequency: Mapped[ScheduleFrequency] = mapped_column(
        Enum(ScheduleFrequency), nullable=False, index=True
    )
    recipients: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    filters: Mapped[dict | None] = mapped_column(JSON)
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
