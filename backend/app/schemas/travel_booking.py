from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.travel_booking import LocalConveyanceStatus, TravelMode, TripStatus


class FlightSearchIn(BaseModel):
    from_city: str = Field(..., min_length=2, max_length=128)
    to_city: str = Field(..., min_length=2, max_length=128)
    travel_date: date


class FlightOptionOut(BaseModel):
    provider: str
    flight_number: str
    departure_time: str
    arrival_time: str
    duration: str
    travel_class: str
    price: Decimal
    in_policy: bool
    badge: str
    selectable: bool
    cost_delta_vs_lowest: Decimal
    selection_block_reason: str | None = None


class TrainSearchIn(BaseModel):
    from_city: str = Field(..., min_length=2, max_length=128)
    to_city: str = Field(..., min_length=2, max_length=128)
    travel_date: date
    tatkal: bool = False


class TrainOptionOut(BaseModel):
    provider: str
    train_number: str
    train_name: str
    departure_time: str
    arrival_time: str
    travel_class: str
    fare: Decimal
    tatkal_allowed: bool
    selectable: bool
    selection_block_reason: str | None = None


class BusSearchIn(BaseModel):
    from_city: str = Field(..., min_length=2, max_length=128)
    to_city: str = Field(..., min_length=2, max_length=128)
    travel_date: date


class BusOptionOut(BaseModel):
    provider: str
    operator: str
    departure_time: str
    arrival_time: str
    bus_type: str
    fare: Decimal
    preferred_operator: bool


class FlightBookIn(BaseModel):
    provider: str
    flight_number: str
    from_city: str
    to_city: str
    travel_date: date
    travel_class: str


class TrainBookIn(BaseModel):
    provider: str
    train_number: str
    train_name: str
    from_city: str
    to_city: str
    travel_date: date
    travel_class: str
    pnr: str = Field(..., min_length=3, max_length=32)
    is_waitlist: bool = False


class BusBookIn(BaseModel):
    provider: str
    operator: str
    from_city: str
    to_city: str
    travel_date: date
    bus_type: str


class TripOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_user_id: int
    travel_request_id: int | None = None
    booked_by_travel_desk: bool = False
    assigned_to_employee_id: str | None = None
    mode: TravelMode
    from_city: str
    to_city: str
    travel_date: date
    provider: str
    reference_id: str
    travel_class: str | None = None
    amount: Decimal
    gst_invoice_requested: bool
    eticket_url: str | None = None
    booking_metadata: dict | None = None
    status: TripStatus
    refunded_amount: Decimal | None = None
    boarding_pass_path: str | None = None
    desk_ticket_id: int | None = None
    return_date: date | None = None
    created_at: datetime


class CancelTripIn(BaseModel):
    reason: str = Field(..., min_length=1, max_length=255)
    refunded_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))


class BoardingPassOut(BaseModel):
    trip_id: int
    boarding_pass_path: str


class LocalConveyanceClaimIn(BaseModel):
    trip_id: int | None = None
    mode: str = Field(..., min_length=2, max_length=64)
    city: str | None = Field(default=None, max_length=128)
    travel_date: date
    amount: Decimal | None = Field(default=None, ge=Decimal("0"))
    distance_km: Decimal | None = Field(default=None, ge=Decimal("0"))
    bill_reference: str | None = Field(default=None, max_length=512)


class LocalConveyanceClaimOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_user_id: int
    trip_id: int | None = None
    mode: str
    city: str | None = None
    travel_date: date
    amount: Decimal
    distance_km: Decimal | None = None
    bill_required: bool
    bill_reference: str | None = None
    manager_approval_required: bool
    claim_metadata: dict | None = None
    status: LocalConveyanceStatus
    created_at: datetime


class SearchEnvelopeOut(BaseModel):
    impact_level: str
    in_policy_note: str
