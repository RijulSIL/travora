from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User
from app.models.claim_workflow import ExceptionApproval, ExceptionRequest, ExceptionRequestStatus
from app.models.employee import Employee
from app.models.policy import ImpactLevel
from app.models.travel_booking import (
    LocalConveyanceClaim,
    LocalConveyanceStatus,
    TravelMode,
    TravelTrip,
    TripStatus,
)

FLIGHT_ALLOWED_CLASSES: dict[str, set[str]] = {
    "L1": {"ECONOMY", "PREMIUM_ECONOMY"},
    "L2": {"ECONOMY"},
    "L3": {"ECONOMY"},
    "L4A": {"ECONOMY"},
    "L4B": {"ECONOMY"},
    "L4C": {"ECONOMY"},
    "L5A": {"ECONOMY"},
    "L5B": {"ECONOMY"},
    "L5C": {"ECONOMY"},
    "L6A": {"ECONOMY"},
    "L6B": {"ECONOMY"},
    "L6C": {"ECONOMY"},
    "L6D": {"ECONOMY"},
}

TRAIN_ALLOWED_CLASSES: dict[str, set[str]] = {
    "L1": {"1AC", "EC"},
    "L2": {"1AC", "EC"},
    "L3": {"1AC", "EC"},
    "L4A": {"2AC", "CC"},
    "L4B": {"2AC", "CC"},
    "L4C": {"2AC", "CC"},
    "L5A": {"2AC", "CC"},
    "L5B": {"3AC", "CC", "SL"},
    "L5C": {"3AC", "CC", "SL"},
    "L6A": {"3AC", "CC", "SL"},
    "L6B": {"3AC", "CC", "SL"},
    "L6C": {"3AC", "CC", "SL"},
    "L6D": {"3AC", "CC", "SL"},
}

LEVELS_REQUIRING_AIR_UNLOCK = {"L5A", "L5B", "L5C", "L6A", "L6B", "L6C", "L6D"}
LEVELS_L2_TO_L4C = {"L2", "L3", "L4A", "L4B", "L4C"}
LEVELS_L5A_TO_L6D = {"L5A", "L5B", "L5C", "L6A", "L6B", "L6C", "L6D"}
PREFERRED_BUS_OPERATORS = {"Volvo Travels", "InterCity AC", "Corporate Fleet"}
EXCEPTION_REQUIRED_ROLES: dict[str, set[str]] = {
    "AIR_TRAVEL_UNLOCK": {"REPORTING_MANAGER", "HRBP_HR", "IT_ADMIN"},
    "TRAIN_TATKAL": {"REPORTING_MANAGER", "HRBP_HR"},
    "FLIGHT_ADVANCE_BOOKING_OVERRIDE": {"REPORTING_MANAGER"},
    "FLIGHT_COST_DELTA": {"REPORTING_MANAGER", "HRBP_HR"},
}


def _normalize_level(level: str | None) -> str:
    if not level:
        return "L5A"
    return level.strip().upper()


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


async def _get_user_impact_level_code(user_id: int, db: AsyncSession) -> str:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.employee_id:
        return "L5A"

    employee = await db.get(Employee, user.employee_id)
    if employee is None or employee.impact_level_id is None:
        return "L5A"
    impact = await db.get(ImpactLevel, employee.impact_level_id)
    if impact is None:
        return "L5A"
    return _normalize_level(impact.level_code)


async def _has_completed_exception_chain(user_id: int, exception_type: str, db: AsyncSession) -> bool:
    q = select(ExceptionRequest).where(
        and_(
            ExceptionRequest.requested_by_user_id == user_id,
            ExceptionRequest.exception_type == exception_type,
            ExceptionRequest.status == ExceptionRequestStatus.APPROVED.value,
        )
    )
    candidates = list((await db.execute(q)).scalars().all())
    if not candidates:
        return False
    required_roles = EXCEPTION_REQUIRED_ROLES.get(exception_type, {"HRBP_HR"})
    for row in candidates:
        approvals = (
            await db.execute(
                select(ExceptionApproval).where(ExceptionApproval.exception_request_id == row.id)
            )
        ).scalars().all()
        approved_roles = {
            a.required_role for a in approvals if a.status == ExceptionRequestStatus.APPROVED.value
        }
        if required_roles.issubset(approved_roles):
            return True
    return False


def _mock_flight_inventory(from_city: str, to_city: str, travel_date: date) -> list[dict]:
    return [
        {
            "provider": "IndiGo",
            "flight_number": "6E-204",
            "departure_time": "06:00",
            "arrival_time": "08:15",
            "duration": "2h 15m",
            "travel_class": "ECONOMY",
            "price": Decimal("4850.00"),
            "from_city": from_city,
            "to_city": to_city,
            "travel_date": travel_date,
        },
        {
            "provider": "Air India",
            "flight_number": "AI-131",
            "departure_time": "09:30",
            "arrival_time": "11:55",
            "duration": "2h 25m",
            "travel_class": "ECONOMY",
            "price": Decimal("5200.00"),
            "from_city": from_city,
            "to_city": to_city,
            "travel_date": travel_date,
        },
        {
            "provider": "Vistara",
            "flight_number": "UK-995",
            "departure_time": "14:00",
            "arrival_time": "16:10",
            "duration": "2h 10m",
            "travel_class": "BUSINESS",
            "price": Decimal("18500.00"),
            "from_city": from_city,
            "to_city": to_city,
            "travel_date": travel_date,
        },
    ]


async def search_flights(from_city: str, to_city: str, travel_date: date, user_id: int, db: AsyncSession) -> dict:
    impact_level = await _get_user_impact_level_code(user_id, db)
    allowed = FLIGHT_ALLOWED_CLASSES.get(impact_level, {"ECONOMY"})
    inventory = _mock_flight_inventory(from_city, to_city, travel_date)
    days_in_advance = (travel_date - date.today()).days

    if impact_level in LEVELS_REQUIRING_AIR_UNLOCK:
        has_unlock = await _has_completed_exception_chain(user_id, "AIR_TRAVEL_UNLOCK", db)
        if not has_unlock:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Air search is locked for your level until Function Head + Group Head HR + CEO "
                    "exception approval is recorded."
                ),
            )

    min_advance_enforced = days_in_advance < 7
    has_advance_override = await _has_completed_exception_chain(
        user_id, "FLIGHT_ADVANCE_BOOKING_OVERRIDE", db
    )
    if min_advance_enforced and not has_advance_override:
        raise HTTPException(
            status_code=422,
            detail="Minimum 7-day advance booking window is enforced.",
        )

    eligible = [row for row in inventory if row["travel_class"] in allowed]
    if not eligible:
        return {"impact_level": impact_level, "in_policy_note": "No eligible flights found.", "results": []}

    lowest = min(r["price"] for r in eligible)
    has_cost_exception = await _has_completed_exception_chain(user_id, "FLIGHT_COST_DELTA", db)
    results = []
    for row in eligible:
        cost_delta = (row["price"] - lowest).quantize(Decimal("0.01"))
        expensive = row["price"] > (lowest * Decimal("1.40"))
        selectable = True
        badge = "In Policy"
        block_reason = None
        if expensive:
            badge = "Warning"
            if not has_cost_exception:
                selectable = False
                block_reason = "Cost exception approval required for high fare delta."
        results.append(
            {
                **row,
                "in_policy": not expensive,
                "badge": badge,
                "selectable": selectable,
                "cost_delta_vs_lowest": cost_delta,
                "selection_block_reason": block_reason,
            }
        )

    return {
        "impact_level": impact_level,
        "in_policy_note": "Search results are entitlement-filtered. Non-eligible classes are hidden.",
        "results": results,
    }


def _mock_train_inventory(from_city: str, to_city: str, travel_date: date) -> list[dict]:
    return [
        {
            "provider": "IRCTC",
            "train_number": "12431",
            "train_name": "Rajdhani Express",
            "departure_time": "17:10",
            "arrival_time": "08:30",
            "travel_class": "2AC",
            "fare": Decimal("2950.00"),
            "from_city": from_city,
            "to_city": to_city,
            "travel_date": travel_date,
        },
        {
            "provider": "IRCTC",
            "train_number": "12622",
            "train_name": "Karnataka Express",
            "departure_time": "20:40",
            "arrival_time": "12:35",
            "travel_class": "3AC",
            "fare": Decimal("1980.00"),
            "from_city": from_city,
            "to_city": to_city,
            "travel_date": travel_date,
        },
    ]


async def search_trains(
    from_city: str, to_city: str, travel_date: date, tatkal: bool, user_id: int, db: AsyncSession
) -> dict:
    impact_level = await _get_user_impact_level_code(user_id, db)
    allowed = TRAIN_ALLOWED_CLASSES.get(impact_level, {"3AC", "CC", "SL"})
    tatkal_allowed = await _has_completed_exception_chain(user_id, "TRAIN_TATKAL", db)
    if tatkal and not tatkal_allowed:
        raise HTTPException(status_code=403, detail="Tatkal requires Function Head pre-approval.")

    inventory = [row for row in _mock_train_inventory(from_city, to_city, travel_date) if row["travel_class"] in allowed]
    results = []
    for row in inventory:
        selectable = not tatkal or tatkal_allowed
        results.append(
            {
                **row,
                "tatkal_allowed": tatkal_allowed,
                "selectable": selectable,
                "selection_block_reason": None if selectable else "Tatkal pre-approval is missing.",
            }
        )
    return {
        "impact_level": impact_level,
        "in_policy_note": "Train classes are filtered by entitlement.",
        "results": results,
    }


def _mock_bus_inventory(from_city: str, to_city: str, travel_date: date) -> list[dict]:
    return [
        {
            "provider": "redBus",
            "operator": "Volvo Travels",
            "departure_time": "22:15",
            "arrival_time": "05:45",
            "bus_type": "AC Sleeper",
            "fare": Decimal("1450.00"),
            "from_city": from_city,
            "to_city": to_city,
            "travel_date": travel_date,
        },
        {
            "provider": "AbhiBus",
            "operator": "InterCity AC",
            "departure_time": "23:00",
            "arrival_time": "06:00",
            "bus_type": "AC Seater",
            "fare": Decimal("1200.00"),
            "from_city": from_city,
            "to_city": to_city,
            "travel_date": travel_date,
        },
    ]


async def search_buses(from_city: str, to_city: str, travel_date: date, user_id: int, db: AsyncSession) -> dict:
    impact_level = await _get_user_impact_level_code(user_id, db)
    results = []
    for row in _mock_bus_inventory(from_city, to_city, travel_date):
        results.append(
            {
                **row,
                "preferred_operator": row["operator"] in PREFERRED_BUS_OPERATORS,
            }
        )
    return {"impact_level": impact_level, "in_policy_note": "All levels are entitled to AC buses.", "results": results}


async def _create_trip(payload: dict, mode: TravelMode, user_id: int, db: AsyncSession) -> TravelTrip:
    ref = payload.get("reference_id") or f"{mode.value[:2]}-{uuid4().hex[:10].upper()}"
    row = TravelTrip(
        employee_user_id=user_id,
        mode=mode,
        from_city=payload["from_city"],
        to_city=payload["to_city"],
        travel_date=payload["travel_date"],
        provider=payload["provider"],
        reference_id=ref,
        travel_class=payload.get("travel_class"),
        amount=Decimal(str(payload["amount"])).quantize(Decimal("0.01")),
        gst_invoice_requested=bool(payload.get("gst_invoice_requested", False)),
        eticket_url=f"/api/v1/booking/trips/{ref}/eticket",
        booking_metadata=payload.get("booking_metadata"),
        status=payload.get("status", TripStatus.CONFIRMED),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def book_flight(payload: dict, user_id: int, db: AsyncSession) -> TravelTrip:
    entitlement = await search_flights(payload["from_city"], payload["to_city"], payload["travel_date"], user_id, db)
    allowed_keys = {
        (item["provider"], item["flight_number"], item["travel_class"]): item for item in entitlement["results"]
    }
    key = (payload["provider"], payload["flight_number"], payload["travel_class"])
    option = allowed_keys.get(key)
    if option is None:
        raise HTTPException(status_code=422, detail="Selected flight is not entitled or unavailable.")
    if not option["selectable"]:
        raise HTTPException(status_code=422, detail=option["selection_block_reason"] or "Selected flight is locked.")
    return await _create_trip(
        {
            "from_city": option["from_city"],
            "to_city": option["to_city"],
            "travel_date": option["travel_date"],
            "provider": option["provider"],
            "travel_class": option["travel_class"],
            "amount": option["price"],
            "reference_id": f"FLT-{uuid4().hex[:10].upper()}",
            "gst_invoice_requested": True,
            "booking_metadata": {"flight_number": payload["flight_number"], "gst_request_status": "REQUESTED"},
            "status": TripStatus.CONFIRMED,
        },
        mode=TravelMode.FLIGHT,
        user_id=user_id,
        db=db,
    )


async def book_train(payload: dict, user_id: int, db: AsyncSession) -> TravelTrip:
    entitlement = await search_trains(
        payload["from_city"], payload["to_city"], payload["travel_date"], False, user_id, db
    )
    allowed_keys = {
        (item["provider"], item["train_number"], item["travel_class"]): item for item in entitlement["results"]
    }
    key = (payload["provider"], payload["train_number"], payload["travel_class"])
    option = allowed_keys.get(key)
    if option is None:
        raise HTTPException(status_code=422, detail="Selected train option is not entitled or unavailable.")
    return await _create_trip(
        {
            "from_city": payload["from_city"],
            "to_city": payload["to_city"],
            "travel_date": payload["travel_date"],
            "provider": option["provider"],
            "travel_class": option["travel_class"],
            "amount": option["fare"],
            "reference_id": payload["pnr"],
            "booking_metadata": {"train_number": payload["train_number"], "pnr": payload["pnr"]},
            "status": TripStatus.WAITLIST if payload.get("is_waitlist") else TripStatus.CONFIRMED,
        },
        mode=TravelMode.TRAIN,
        user_id=user_id,
        db=db,
    )


async def book_bus(payload: dict, user_id: int, db: AsyncSession) -> TravelTrip:
    entitlement = await search_buses(payload["from_city"], payload["to_city"], payload["travel_date"], user_id, db)
    selected = next(
        (
            item
            for item in entitlement["results"]
            if item["provider"] == payload["provider"]
            and item["operator"] == payload["operator"]
            and item["bus_type"] == payload["bus_type"]
        ),
        None,
    )
    if selected is None:
        raise HTTPException(status_code=422, detail="Selected bus option is not available.")
    if "AC" not in selected["bus_type"].upper():
        raise HTTPException(status_code=422, detail="Non-AC bus booking is not reimbursable under current policy.")
    return await _create_trip(
        {
            "from_city": payload["from_city"],
            "to_city": payload["to_city"],
            "travel_date": payload["travel_date"],
            "provider": selected["provider"],
            "travel_class": selected["bus_type"],
            "amount": selected["fare"],
            "reference_id": f"BUS-{uuid4().hex[:10].upper()}",
            "booking_metadata": {"operator": selected["operator"]},
            "status": TripStatus.CONFIRMED,
        },
        mode=TravelMode.BUS,
        user_id=user_id,
        db=db,
    )


async def list_trips(user_id: int, db: AsyncSession) -> list[TravelTrip]:
    """Merged scope: trips on the user's account plus desk bookings assigned by employee id."""
    # Lazy import avoids circular imports (travel_request_service pulls policy helpers from this module).
    from app.services.travel_request_service import list_trips_for_merged_employee_scope

    return await list_trips_for_merged_employee_scope(user_id, db)


async def cancel_trip(trip_id: int, reason: str, refunded_amount: Decimal, user_id: int, db: AsyncSession) -> TravelTrip:
    trip = await db.get(TravelTrip, trip_id)
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    if trip.employee_user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if trip.status == TripStatus.CANCELLED:
        raise HTTPException(status_code=409, detail="Trip is already cancelled")

    trip.status = TripStatus.CANCELLED
    trip.cancellation_reason = reason
    trip.refunded_amount = refunded_amount.quantize(Decimal("0.01"))
    trip.cancelled_at = _now()
    await db.commit()
    await db.refresh(trip)
    return trip


async def upload_boarding_pass(trip_id: int, file: UploadFile, user_id: int, db: AsyncSession) -> str:
    trip = await db.get(TravelTrip, trip_id)
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    if trip.employee_user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if trip.mode != TravelMode.FLIGHT:
        raise HTTPException(status_code=422, detail="Boarding pass is only applicable to flights")

    extension = Path(file.filename or "boarding-pass.pdf").suffix or ".pdf"
    directory = Path("storage") / "boarding_passes" / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{trip_id}-{uuid4().hex}{extension}"
    content = await file.read()
    path.write_bytes(content)
    trip.boarding_pass_path = str(path).replace("\\", "/")
    await db.commit()
    return trip.boarding_pass_path


async def get_train_pnr_status(pnr: str, user_id: int, db: AsyncSession) -> dict:
    result = await db.execute(
        select(TravelTrip).where(
            and_(
                TravelTrip.employee_user_id == user_id,
                TravelTrip.mode == TravelMode.TRAIN,
                TravelTrip.reference_id == pnr,
            )
        )
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=404, detail="PNR not found")

    return {
        "pnr": pnr,
        "status": trip.status.value,
        "last_updated_at": _now(),
        "trip_id": trip.id,
    }


async def submit_local_conveyance_claim(payload: dict, user_id: int, db: AsyncSession) -> LocalConveyanceClaim:
    impact_level = await _get_user_impact_level_code(user_id, db)
    mode = payload["mode"].strip().upper()
    bill_reference = payload.get("bill_reference")
    distance_km = payload.get("distance_km")
    amount = payload.get("amount")
    bill_required = True
    manager_approval_required = False
    metadata: dict = {"impact_level": impact_level}

    linked_trip_id = payload.get("trip_id")
    if linked_trip_id is not None:
        linked_trip = await db.get(TravelTrip, linked_trip_id)
        if linked_trip is None:
            raise HTTPException(status_code=404, detail=f"Trip {linked_trip_id} not found")
        if linked_trip.employee_user_id != user_id:
            raise HTTPException(status_code=403, detail="Cannot link a trip that does not belong to you")
        if linked_trip.travel_date != payload["travel_date"]:
            raise HTTPException(status_code=422, detail="trip_id travel date does not match claim travel_date")
        city = (payload.get("city") or "").strip()
        if city and city.lower() not in {linked_trip.from_city.lower(), linked_trip.to_city.lower()}:
            raise HTTPException(status_code=422, detail="trip_id city context is inconsistent with provided city")

    if mode in {"HIRED_TAXI", "INNOVA"}:
        if impact_level != "L1":
            raise HTTPException(status_code=422, detail="Hired Taxi/Innova is only entitled for L1.")
        bill_required = True
    elif mode in {"UBER_SEDAN", "UBER_PREMIUM"}:
        if impact_level not in LEVELS_L2_TO_L4C:
            raise HTTPException(status_code=422, detail=f"{mode} is only entitled for L2-L4C.")
        bill_required = True
    elif mode in {"UBER_GO", "UBER_AUTO", "AUTO", "METRO", "PUBLIC_TRANSPORT"}:
        if impact_level not in LEVELS_L5A_TO_L6D:
            raise HTTPException(status_code=422, detail=f"{mode} is only entitled for L5A-L6D.")
        bill_required = mode in {"UBER_GO", "UBER_AUTO"}
    elif mode == "PERSONAL_4W":
        manager_approval_required = True
        if distance_km is None:
            raise HTTPException(status_code=422, detail="distance_km is required for PERSONAL_4W.")
        amount = (Decimal(str(distance_km)) * Decimal("8.50")).quantize(Decimal("0.01"))
        metadata["computed_rate_per_km"] = "8.50"
    elif mode == "PERSONAL_2W":
        manager_approval_required = True
        if distance_km is None:
            raise HTTPException(status_code=422, detail="distance_km is required for PERSONAL_2W.")
        amount = (Decimal(str(distance_km)) * Decimal("4.00")).quantize(Decimal("0.01"))
        metadata["computed_rate_per_km"] = "4.00"
    else:
        raise HTTPException(status_code=422, detail="Unsupported local conveyance mode")

    if bill_required and not bill_reference:
        raise HTTPException(status_code=422, detail="bill_reference is required for selected mode")
    if amount is None:
        raise HTTPException(status_code=422, detail="amount is required for selected mode")

    claim = LocalConveyanceClaim(
        employee_user_id=user_id,
        trip_id=linked_trip_id,
        mode=mode,
        city=payload.get("city"),
        travel_date=payload["travel_date"],
        amount=Decimal(str(amount)).quantize(Decimal("0.01")),
        distance_km=Decimal(str(distance_km)).quantize(Decimal("0.01")) if distance_km is not None else None,
        bill_required=bill_required,
        bill_reference=bill_reference,
        manager_approval_required=manager_approval_required,
        claim_metadata=metadata,
        status=LocalConveyanceStatus.SUBMITTED,
    )
    db.add(claim)
    await db.commit()
    await db.refresh(claim)
    return claim
