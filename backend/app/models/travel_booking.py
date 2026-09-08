import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, JSON, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TravelMode(str, enum.Enum):
    FLIGHT = "FLIGHT"
    TRAIN = "TRAIN"
    BUS = "BUS"


class TripStatus(str, enum.Enum):
    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"
    WAITLIST = "WAITLIST"


class LocalConveyanceStatus(str, enum.Enum):
    SUBMITTED = "SUBMITTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class TravelTrip(Base):
    __tablename__ = "travel_trips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    travel_request_id: Mapped[int | None] = mapped_column(ForeignKey("travel_requests.id"), nullable=True, index=True)
    booked_by_travel_desk: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    assigned_to_employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.employee_id"), nullable=True)
    mode: Mapped[TravelMode] = mapped_column(Enum(TravelMode), nullable=False, index=True)
    from_city: Mapped[str] = mapped_column(String(128), nullable=False)
    to_city: Mapped[str] = mapped_column(String(128), nullable=False)
    travel_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    reference_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    travel_class: Mapped[str | None] = mapped_column(String(64))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    gst_invoice_requested: Mapped[bool] = mapped_column(nullable=False, default=False)
    eticket_url: Mapped[str | None] = mapped_column(String(512))
    booking_metadata: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[TripStatus] = mapped_column(Enum(TripStatus), nullable=False, default=TripStatus.CONFIRMED)
    cancellation_reason: Mapped[str | None] = mapped_column(Text)
    refunded_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    boarding_pass_path: Mapped[str | None] = mapped_column(String(512))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class LocalConveyanceClaim(Base):
    __tablename__ = "local_conveyance_claims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("travel_trips.id"), index=True)
    mode: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    city: Mapped[str | None] = mapped_column(String(128))
    travel_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    distance_km: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    bill_required: Mapped[bool] = mapped_column(nullable=False, default=True)
    bill_reference: Mapped[str | None] = mapped_column(String(512))
    manager_approval_required: Mapped[bool] = mapped_column(nullable=False, default=False)
    claim_metadata: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[LocalConveyanceStatus] = mapped_column(
        Enum(LocalConveyanceStatus), nullable=False, default=LocalConveyanceStatus.SUBMITTED
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
