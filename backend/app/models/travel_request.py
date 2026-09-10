import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TravelRequestMode(str, enum.Enum):
    FLIGHT = "FLIGHT"
    TRAIN = "TRAIN"
    BUS = "BUS"


class TravelRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    PENDING_EXCEPTION = "PENDING_EXCEPTION"
    APPROVED = "APPROVED"
    BOOKED = "BOOKED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class TripType(str, enum.Enum):
    ONE_WAY = "ONE_WAY"
    ROUND_TRIP = "ROUND_TRIP"
    MULTI_CITY = "MULTI_CITY"


class TravelRequest(Base):
    __tablename__ = "travel_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    trip_type: Mapped[str] = mapped_column(String(24), nullable=False, default=TripType.ONE_WAY.value)
    travel_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    from_city: Mapped[str | None] = mapped_column(String(128), nullable=True) # Optional for multi-city
    to_city: Mapped[str | None] = mapped_column(String(128), nullable=True) # Optional for multi-city
    travel_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True) # Optional for multi-city
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    purpose: Mapped[str | None] = mapped_column(Text)
    preferred_class: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default=TravelRequestStatus.PENDING.value, index=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    legs = relationship(
        "TravelRequestLeg",
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="TravelRequestLeg.leg_sequence"
    )

class TravelRequestLeg(Base):
    __tablename__ = "travel_request_legs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    travel_request_id: Mapped[int] = mapped_column(ForeignKey("travel_requests.id"), nullable=False, index=True)
    leg_sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    travel_mode: Mapped[str | None] = mapped_column(String(16))
    from_city: Mapped[str] = mapped_column(String(128), nullable=False)
    to_city: Mapped[str] = mapped_column(String(128), nullable=False)
    travel_date: Mapped[date] = mapped_column(Date, nullable=False)
    preferred_time: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    request = relationship("TravelRequest", back_populates="legs")


class TravelRequestTicket(Base):
    __tablename__ = "travel_request_tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    travel_request_id: Mapped[int] = mapped_column(ForeignKey("travel_requests.id"), nullable=False, index=True)
    travel_trip_id: Mapped[int | None] = mapped_column(ForeignKey("travel_trips.id"), nullable=True, index=True)
    uploaded_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    pnr_or_booking_ref: Mapped[str | None] = mapped_column(String(128))
    ticket_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    ticket_travel_class: Mapped[str | None] = mapped_column(String(64))
    external_booking_source: Mapped[str | None] = mapped_column(String(128))
    notes_for_employee: Mapped[str | None] = mapped_column(Text)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
