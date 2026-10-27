"""Travel request API schemas."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.travel_request import TravelRequestMode, TravelRequestTravelType


class TravelRequestTicketAttachmentOut(BaseModel):
    """Ticket artifact metadata (no filesystem path exposed)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    leg_sequence: int = 1
    original_filename: str
    content_type: str
    file_size_bytes: int
    pnr_or_booking_ref: str | None = None
    notes_for_employee: str | None = None


class TravelRequestSupportingDocumentOut(BaseModel):
    """Travel Desk-uploaded supporting document metadata (no filesystem path exposed)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    original_filename: str
    content_type: str
    file_size_bytes: int
    description: str | None = None
    uploaded_at: datetime


class SupportingDocumentUploadOut(TravelRequestSupportingDocumentOut):
    # The request's status after the upload (additional documents don't change it).
    request_status: str


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

class LegPickIn(BaseModel):
    seq: int
    choice: str  # "option" (picked from the search) or "own" (described in a note)
    option: dict | None = None
    note: str | None = Field(default=None, max_length=500)
    searched_at: str | None = None
    time_windows: list[str] = Field(default_factory=list, max_length=4)  # when they wanted to leave
    bus_types: list[str] = Field(default_factory=list, max_length=5)  # bus legs (choice "bus"): kinds of bus


class TravelOptionSearchIn(BaseModel):
    mode: str
    from_city: str = Field(..., min_length=1, max_length=128)
    to_city: str = Field(..., min_length=1, max_length=128)
    travel_date: date
    # NIGHT / MORNING / AFTERNOON / EVENING — at least one; only the departure time has to fall in it
    time_windows: list[str] = Field(..., min_length=1, max_length=4)


class TravelRequestCreate(BaseModel):
    trip_type: str = "ONE_WAY"
    travel_mode: TravelRequestMode | str = Field(...)
    from_city: str | None = None
    to_city: str | None = None
    travel_date: date | None = None
    return_date: date | None = None
    travel_type: TravelRequestTravelType | str = TravelRequestTravelType.NON_PROJECT.value
    project_code: str | None = None
    purpose: str | None = None
    notes: str | None = None
    legs: list[TravelRequestLegIn] | None = None
    # One choice per ticketable leg — see travel_request_service.validate_leg_picks.
    leg_picks: list[LegPickIn] = Field(default_factory=list)


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
    travel_type: str = TravelRequestTravelType.NON_PROJECT.value
    project_code: str | None = None
    purpose: str | None = None
    notes: str | None = None
    leg_picks: list[dict] | None = None
    status: str
    rejection_reason: str | None = None
    requested_at: datetime
    updated_at: datetime | None = None
    legs: list[TravelRequestLegOut] | None = None
    exception: TravelExceptionSummaryOut | None = None
    segments: list[TravelRequestSegmentOut] = Field(default_factory=list)
    supporting_documents: list[TravelRequestSupportingDocumentOut] = Field(default_factory=list)


class TravelRequestListItemOut(BaseModel):
    request: TravelRequestOut
    ticket: TravelRequestTicketAttachmentOut | None = None


class DeskQueueItemOut(BaseModel):
    request: TravelRequestOut
    employee_display_name: str
    impact_level_code: str
    # Approver queue only: earlier stages whose approver missed their SLA (request passed on).
    sla_passed_over: list[str] = Field(default_factory=list)


class TravelRejectIn(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)


class TravelApproveIn(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)


class EntitlementNoteOut(BaseModel):
    impact_level: str
    text: str


class TicketUploadForm(BaseModel):
    """JSON optional fields for desk upload (also accepted as Form fields)."""

    leg_sequence: int = 1
    pnr_or_booking_ref: str | None = None
    provider: str | None = None
    notes_for_employee: str | None = None


class TravelOptionOut(BaseModel):
    """One entry of an admin-managed travel-request dropdown."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    option_type: str
    value: str
    label: str
    is_active: bool
    # Only meaningful on a TRIP_PURPOSE row — see TravelRequestOption's docstring.
    notify_project_stakeholders: bool = False


class TravelOptionsOut(BaseModel):
    """Active options the travel request form offers."""

    project_codes: list[TravelOptionOut] = Field(default_factory=list)
    trip_purposes: list[TravelOptionOut] = Field(default_factory=list)


class TravelOptionIn(BaseModel):
    option_type: str
    value: str = Field(..., min_length=1, max_length=128)
    label: str | None = Field(default=None, max_length=255)


class TravelOptionUpdateIn(BaseModel):
    # Omit to keep the current value. Changing it also rewrites requests already using it.
    value: str | None = Field(default=None, min_length=1, max_length=128)
    label: str = Field(..., min_length=1, max_length=255)
    is_active: bool = True
    notify_project_stakeholders: bool = False


class ProjectRecipientIn(BaseModel):
    project_code: str = Field(..., min_length=1, max_length=128)
    email: str = Field(..., min_length=3, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)


class ProjectRecipientUpdateIn(BaseModel):
    # project_code is deliberately absent — moving a recipient to a different project is an
    # add-to-the-new-one/remove-from-the-old-one action, not an edit of this row.
    email: str = Field(..., min_length=3, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)


class ProjectRecipientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_code: str
    email: str
    display_name: str | None = None


class CityExpenseLimitOut(BaseModel):
    """What the travel policy allows the requester to spend in one destination city."""

    city: str
    city_group: str
    city_group_name: str | None = None
    impact_level: str
    # None when no limit row is configured for this level/city-group combination.
    hotel_cap: Decimal | None = None
    hotel_is_hard_block: bool = False
    food_cap: Decimal | None = None
    food_is_hard_block: bool = False
    incidental_cap: Decimal | None = None
    incidental_is_hard_block: bool = False
    day_visit_cap: Decimal | None = None
    day_visit_is_hard_block: bool = False
    has_limits: bool = False
