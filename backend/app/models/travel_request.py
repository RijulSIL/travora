import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
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
    PARTIALLY_BOOKED = "PARTIALLY_BOOKED"
    BOOKED = "BOOKED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class TripType(str, enum.Enum):
    ONE_WAY = "ONE_WAY"
    ROUND_TRIP = "ROUND_TRIP"
    MULTI_CITY = "MULTI_CITY"


class TravelRequestTravelType(str, enum.Enum):
    PROJECT = "PROJECT"
    NON_PROJECT = "NON_PROJECT"


class TravelOptionType(str, enum.Enum):
    """Which admin-managed dropdown a TravelRequestOption row belongs to."""

    PROJECT_CODE = "PROJECT_CODE"
    TRIP_PURPOSE = "TRIP_PURPOSE"


class TravelRequestOption(Base):
    """Admin-managed dropdown entries for the travel request form (Project Code, Trip Purpose).

    `value` is what a TravelRequest stores (project_code / purpose) as a plain string — same
    pattern as CityGroupTier.code, no hard foreign key — so a historical request keeps reading
    exactly as submitted even after its option is later renamed or deactivated. `value` is
    immutable once created for the same reason; `label` is the editable display text. Options
    are deactivated, never deleted."""

    __tablename__ = "travel_request_options"
    __table_args__ = (UniqueConstraint("option_type", "value", name="uq_travel_request_options_type_value"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    option_type: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(128), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    # Only meaningful on a TRIP_PURPOSE row: when a PROJECT-type request is submitted with this
    # purpose selected, every email configured for its project_code (ProjectNotificationRecipient
    # below) gets notified — see travel_request_service.notify_project_stakeholders_if_applicable.
    notify_project_stakeholders: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class ProjectNotificationRecipient(Base):
    """Admin-managed "who to email" list for a given project_code (a TravelRequestOption value,
    stored the same unbound way — no FK, see that model's docstring: the value itself is
    immutable once created, so this list never gets orphaned by a label rename). These people
    don't need an account on the system at all — they're just plain email addresses
    notify_project_stakeholders_if_applicable (travel_request_service.py) sends to."""

    __tablename__ = "project_notification_recipients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_code: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


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
    # Value of the selected active TRIP_PURPOSE option (see TravelRequestOption); older rows may
    # still hold the free text that was typed before this became a dropdown.
    purpose: Mapped[str | None] = mapped_column(Text)
    travel_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default=TravelRequestTravelType.NON_PROJECT.value, server_default="NON_PROJECT"
    )
    # Value of the selected PROJECT_CODE option; only set when travel_type == PROJECT.
    project_code: Mapped[str | None] = mapped_column(String(128))
    # Legacy: the Preferred Cabin Class input was removed from the form, the column is kept
    # only so already-submitted requests keep their data.
    preferred_class: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)
    # The traveler's choice for each ticketable leg, as a recommendation for the Travel Desk:
    # [{"seq": 1, "choice": "option", "option": {...}, "note": None, "searched_at": "..."}, or
    #  {"seq": 2, "choice": "own", "option": None, "note": "Any evening train after 6 pm"}].
    leg_picks: Mapped[list | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default=TravelRequestStatus.PENDING.value, index=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    # Which TravelRequestApprovalStage.stage_number is currently active — mirrors
    # ClaimDraft.current_approval_stage. None once the request leaves PENDING (approved/
    # rejected/cancelled) or while it's gated behind an exception (same as claims).
    current_approval_stage: Mapped[int | None] = mapped_column(Integer)
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
    tickets = relationship(
        "TravelRequestTicket",
        order_by="TravelRequestTicket.leg_sequence, TravelRequestTicket.uploaded_at",
        viewonly=True,
    )
    # selectin so every query that returns a TravelRequest (there are many, each with its own
    # selectinload list) serializes safely under the async session without per-site opt-in.
    supporting_documents = relationship(
        "TravelRequestSupportingDocument",
        order_by="TravelRequestSupportingDocument.uploaded_at",
        lazy="selectin",
        viewonly=True,
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
    leg_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
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


class TravelRequestSupportingDocument(Base):
    """Additional documents the Travel Desk can attach to a request (hotel voucher, itinerary,
    ...). Optional, and they don't change the request's status. Separate from
    TravelRequestTicket, which is strictly one ticket per itinerary leg."""

    __tablename__ = "travel_request_supporting_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    travel_request_id: Mapped[int] = mapped_column(
        ForeignKey("travel_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class TravelRequestApprovalStage(Base):
    """Mirrors ClaimApprovalStage exactly — one row per configured stage, advanced in order by
    workflow_service.approve_travel_request_stage/reject_travel_request_stage. Reuses
    ClaimApprovalStageStatus's values (PENDING/APPROVED/SENT_BACK/REJECTED) plus the same
    "NOT_STARTED" sentinel claims use for stages that haven't become active yet — no new status
    enum needed since the meaning is identical."""

    __tablename__ = "travel_request_approval_stages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    travel_request_id: Mapped[int] = mapped_column(
        ForeignKey("travel_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    stage_number: Mapped[int] = mapped_column(Integer, nullable=False)
    stage_label: Mapped[str] = mapped_column(String(128), nullable=False)
    required_role: Mapped[str | None] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="NOT_STARTED")
    sla_deadline_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Same SLA bookkeeping as ClaimApprovalStage (see app.workers.sla_monitor).
    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime)
    sla_breached_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    comment: Mapped[str | None] = mapped_column(Text)


class TravelOptionSearch(Base):
    """A saved flight/train/bus search for the travel request form, so the same route, date and
    classes aren't searched again (and paid for again) within a few hours. `results` is the list
    of options shown to the traveler."""

    __tablename__ = "travel_option_searches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cache_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    from_city: Mapped[str] = mapped_column(String(128), nullable=False)
    to_city: Mapped[str] = mapped_column(String(128), nullable=False)
    travel_date: Mapped[date] = mapped_column(Date, nullable=False)
    classes: Mapped[str] = mapped_column(String(128), nullable=False)
    results: Mapped[list] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
