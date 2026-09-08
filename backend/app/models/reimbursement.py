import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.policy import CityGroupType


class InvoiceStatus(str, enum.Enum):
    PROCESSING = "PROCESSING"
    READY_FOR_REVIEW = "READY_FOR_REVIEW"
    REVIEWED = "REVIEWED"
    ERROR = "ERROR"


class GstinValidationStatus(str, enum.Enum):
    VALID = "VALID"
    INVALID = "INVALID"
    PENDING = "PENDING"


class ClaimStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PENDING_EXCEPTION = "PENDING_EXCEPTION"
    SUBMITTED = "SUBMITTED"
    IN_APPROVAL = "IN_APPROVAL"
    READY_FOR_PAYMENT = "READY_FOR_PAYMENT"
    SENT_BACK = "SENT_BACK"
    REJECTED = "REJECTED"
    ON_HOLD = "ON_HOLD"
    PAID = "PAID"


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("uploader_user_id", "file_sha256", name="uq_invoices_uploader_file_sha"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    uploader_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    image_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    status: Mapped[InvoiceStatus] = mapped_column(
        Enum(InvoiceStatus), nullable=False, default=InvoiceStatus.PROCESSING, index=True
    )
    extraction_error: Mapped[str | None] = mapped_column(Text)
    duplicate_invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), index=True)
    duplicate_acknowledged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    gstin_validation_status: Mapped[GstinValidationStatus | None] = mapped_column(
        Enum(GstinValidationStatus)
    )
    gstin_validation_checked_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class InvoiceField(Base):
    __tablename__ = "invoice_fields"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), nullable=False, index=True)
    field_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    original_value: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    final_value: Mapped[str | None] = mapped_column(Text)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    confirmed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class InvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    unit: Mapped[str | None] = mapped_column(String(32))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    taxable_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    tax_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    cgst: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    sgst: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    igst: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("expense_categories.id"), index=True)
    category_name: Mapped[str | None] = mapped_column(String(128))
    is_blacklisted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class GstinValidationCache(Base):
    __tablename__ = "gstin_validation_cache"

    gstin: Mapped[str] = mapped_column(String(15), primary_key=True)
    status: Mapped[GstinValidationStatus] = mapped_column(Enum(GstinValidationStatus), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(255))
    raw_response: Mapped[dict | None] = mapped_column(JSON)
    checked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class ClaimDraft(Base):
    __tablename__ = "claim_drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.employee_id"), index=True)
    trip_purpose: Mapped[str | None] = mapped_column(String(255))
    departure_date: Mapped[date | None] = mapped_column(Date)
    return_date: Mapped[date | None] = mapped_column(Date)
    office_location: Mapped[str | None] = mapped_column(String(255))
    from_city: Mapped[str | None] = mapped_column(String(128))
    destination_city: Mapped[str | None] = mapped_column(String(128), index=True)
    destination_city_group: Mapped[CityGroupType | None] = mapped_column(Enum(CityGroupType))
    advance_received: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    status: Mapped[ClaimStatus] = mapped_column(Enum(ClaimStatus), nullable=False, default=ClaimStatus.DRAFT)
    claim_reference: Mapped[str | None] = mapped_column(String(32), index=True)
    current_approval_stage: Mapped[int | None] = mapped_column(Integer)
    approved_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    payment_utr: Mapped[str | None] = mapped_column(String(128))
    payment_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    payment_recorded_at: Mapped[datetime | None] = mapped_column(DateTime)
    payment_recorded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reject_reason: Mapped[str | None] = mapped_column(Text)
    compliance_report: Mapped[dict | None] = mapped_column(JSON)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ClaimInvoice(Base):
    __tablename__ = "claim_invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claim_drafts.id"), nullable=False, index=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), nullable=False, index=True)


class ClaimTrip(Base):
    __tablename__ = "claim_trips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claim_drafts.id"), nullable=False, index=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("travel_trips.id"), nullable=False, index=True)


class ClaimExpense(Base):
    __tablename__ = "claim_expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claim_drafts.id"), nullable=False, index=True)
    expense_category_id: Mapped[int | None] = mapped_column(ForeignKey("expense_categories.id"))
    category_name: Mapped[str] = mapped_column(String(128), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    cap_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    policy_status: Mapped[str] = mapped_column(String(32), nullable=False, default="OK")
    exception_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
