"""Travel booking (/booking). Historical self-serve flows are unused by SPA; merged trip listing is authoritative."""

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_permission
from app.schemas.travel_booking import (
    BoardingPassOut,
    BusBookIn,
    BusOptionOut,
    BusSearchIn,
    CancelTripIn,
    FlightBookIn,
    FlightOptionOut,
    FlightSearchIn,
    LocalConveyanceClaimIn,
    LocalConveyanceClaimOut,
    SearchEnvelopeOut,
    TrainBookIn,
    TrainOptionOut,
    TrainSearchIn,
    TripOut,
)
from app.services.travel_booking_service import (
    book_bus,
    book_flight,
    book_train,
    cancel_trip,
    get_train_pnr_status,
    list_trips,
    search_buses,
    search_flights,
    search_trains,
    submit_local_conveyance_claim,
    upload_boarding_pass,
)
from app.services.travel_request_service import desk_ticket_ids_for_trips

router = APIRouter(
    prefix="/booking",
    tags=["booking"],
    dependencies=[Depends(require_permission("submit_claim"))],
)


@router.get("/flights/search", response_model=dict)
async def flights_search(
    from_city: str,
    to_city: str,
    travel_date: str,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    payload = FlightSearchIn(from_city=from_city, to_city=to_city, travel_date=travel_date)
    data = await search_flights(payload.from_city, payload.to_city, payload.travel_date, int(claims["sub"]), db)
    envelope = SearchEnvelopeOut(
        impact_level=data["impact_level"],
        in_policy_note=data["in_policy_note"],
    ).model_dump()
    envelope["results"] = [FlightOptionOut.model_validate(item).model_dump() for item in data["results"]]
    return envelope


@router.post("/flights/book", response_model=TripOut)
async def flights_book(
    payload: FlightBookIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> TripOut:
    return await book_flight(payload.model_dump(), int(claims["sub"]), db)


@router.post("/flights/{trip_id}/cancel", response_model=TripOut)
async def flights_cancel(
    trip_id: int,
    payload: CancelTripIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> TripOut:
    return await cancel_trip(
        trip_id=trip_id,
        reason=payload.reason,
        refunded_amount=payload.refunded_amount,
        user_id=int(claims["sub"]),
        db=db,
    )


@router.post("/flights/{trip_id}/boarding-pass", response_model=BoardingPassOut)
async def flights_boarding_pass(
    trip_id: int,
    file: UploadFile = File(...),
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> BoardingPassOut:
    stored = await upload_boarding_pass(trip_id, file, int(claims["sub"]), db)
    return BoardingPassOut(trip_id=trip_id, boarding_pass_path=stored)


@router.get("/trains/search", response_model=dict)
async def trains_search(
    from_city: str,
    to_city: str,
    travel_date: str,
    tatkal: bool = False,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    payload = TrainSearchIn(from_city=from_city, to_city=to_city, travel_date=travel_date, tatkal=tatkal)
    data = await search_trains(
        payload.from_city, payload.to_city, payload.travel_date, payload.tatkal, int(claims["sub"]), db
    )
    envelope = SearchEnvelopeOut(
        impact_level=data["impact_level"],
        in_policy_note=data["in_policy_note"],
    ).model_dump()
    envelope["results"] = [TrainOptionOut.model_validate(item).model_dump() for item in data["results"]]
    return envelope


@router.post("/trains/book", response_model=TripOut)
async def trains_book(
    payload: TrainBookIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> TripOut:
    return await book_train(payload.model_dump(), int(claims["sub"]), db)


@router.get("/trains/{pnr}/status", response_model=dict)
async def trains_status(
    pnr: str,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await get_train_pnr_status(pnr, int(claims["sub"]), db)


@router.get("/buses/search", response_model=dict)
async def buses_search(
    from_city: str,
    to_city: str,
    travel_date: str,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    payload = BusSearchIn(from_city=from_city, to_city=to_city, travel_date=travel_date)
    data = await search_buses(payload.from_city, payload.to_city, payload.travel_date, int(claims["sub"]), db)
    envelope = SearchEnvelopeOut(
        impact_level=data["impact_level"],
        in_policy_note=data["in_policy_note"],
    ).model_dump()
    envelope["results"] = [BusOptionOut.model_validate(item).model_dump() for item in data["results"]]
    return envelope


@router.post("/buses/book", response_model=TripOut)
async def buses_book(
    payload: BusBookIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> TripOut:
    return await book_bus(payload.model_dump(), int(claims["sub"]), db)


@router.get("/trips", response_model=list[TripOut])
@router.get("/trips/my", response_model=list[TripOut])
async def my_trips(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> list[TripOut]:
    from sqlalchemy import select

    from app.models.travel_request import TravelRequest

    trips = await list_trips(int(claims["sub"]), db)
    desk_ids = await desk_ticket_ids_for_trips(trips, db)
    
    # Fetch return dates from travel requests
    req_ids = [t.travel_request_id for t in trips if t.travel_request_id]
    return_dates = {}
    if req_ids:
        res = await db.execute(select(TravelRequest.id, TravelRequest.return_date).where(TravelRequest.id.in_(req_ids)))
        return_dates = {row.id: row.return_date for row in res.all()}

    return [
        TripOut.model_validate(t).model_copy(update={
            "desk_ticket_id": desk_ids.get(t.id),
            "return_date": return_dates.get(t.travel_request_id) if t.travel_request_id else None
        })
        for t in trips
    ]


@router.post("/local-conveyance/claim", response_model=LocalConveyanceClaimOut)
async def create_local_conveyance_claim(
    payload: LocalConveyanceClaimIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> LocalConveyanceClaimOut:
    return await submit_local_conveyance_claim(payload.model_dump(), int(claims["sub"]), db)
