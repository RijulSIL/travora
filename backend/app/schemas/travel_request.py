"""Travel request API schemas."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.travel_request import TravelRequestMode


class TravelRequestTicketAttachmentOut(BaseModel):
    """Ticket artifact metadata (no filesystem path exposed)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    leg_sequence: int = 1
    original_filename: str
    content_type: str
    file_size_bytes: int
    pnr_or_booking_ref: str | None = None
    ticket_amount: Decimal | None = None
    ticket_travel_class: str | None = None
    external_booking_source: str | None = None
    notes_for_employee: str | None = None


class TravelRequestSegmentOut(BaseModel):
    """One independently-ticketable leg of a request: the whole trip for ONE_WAY, onward/return
    for ROUND_TRIP, or one row per TravelRequestLeg for MULTI_CITY."""

    seq: int
    label: str
    mode: str
    from_city: str | None = None
    to_city: str | None = None
    travel_date: date | None = None
    ticket: TravelRequestTicketAttachmentOut | None = None


class TravelRequestLegIn(BaseModel):
    travel_mode: TravelRequestMode | str | None = None
    from_city: str = Field(..., min_length=1, max_length=128)
    to_city: str = Field(..., min_length=1, max_length=128)
    travel_date: date
    preferred_time: str | None = None

class TravelRequestLegOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    leg_sequence: int
    travel_mode: str | None = None
    from_city: str
    to_city: str
    travel_date: date
    preferred_time: str | None = None

class TravelRequestCreate(BaseModel):
    trip_type: str = "ONE_WAY"
    travel_mode: TravelRequestMode | str = Field(...)
    from_city: str | None = None
    to_city: str | None = None
    travel_date: date | None = None
    return_date: date | None = None
    purpose: str | None = None
    preferred_class: str | None = None
    notes: str | None = None
    legs: list[TravelRequestLegIn] | None = None


class TravelRequestExceptionCreate(TravelRequestCreate):
    justification: str = Field(..., min_length=1, max_length=2000)


class TravelExceptionApprovalOut(BaseModel):
    required_role: str
    status: str
    acted_at: datetime | None = None
    comment: str | None = None


class TravelExceptionSummaryOut(BaseModel):
    id: int
    exception_type: str
    exception_types: list[str] = Field(default_factory=list)
    status: str
    description: str | None = None
    decision_comment: str | None = None
    approvals: list[TravelExceptionApprovalOut] = Field(default_factory=list)


class TravelRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_user_id: int
    trip_type: str
    travel_mode: str
    from_city: str | None
    to_city: str | None
    travel_date: date | None
    return_date: date | None
    purpose: str | None = None
    preferred_class: str | None = None
    notes: str | None = None
    status: str
    rejection_reason: str | None = None
    requested_at: datetime
    updated_at: datetime | None = None
    legs: list[TravelRequestLegOut] | None = None
    exception: TravelExceptionSummaryOut | None = None
    segments: list[TravelRequestSegmentOut] = Field(default_factory=list)


class TravelRequestListItemOut(BaseModel):
    request: TravelRequestOut
    ticket: TravelRequestTicketAttachmentOut | None = None


class DeskQueueItemOut(BaseModel):
    request: TravelRequestOut
    employee_display_name: str
    impact_level_code: str


class TravelRejectIn(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)


class EntitlementNoteOut(BaseModel):
    impact_level: str
    text: str


class TicketUploadForm(BaseModel):
    """JSON optional fields for desk upload (also accepted as Form fields)."""

    leg_sequence: int = 1
    pnr_or_booking_ref: str | None = None
    ticket_amount: Decimal | None = None
    ticket_travel_class: str | None = None
    provider: str | None = None
    reference_id: str | None = None
    external_booking_source: str | None = None
    notes_for_employee: str | None = None
