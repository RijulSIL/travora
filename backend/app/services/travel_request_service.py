"""Travel Request + Travel Desk ticket upload (Phase 1).

Lead validation uses IST calendar dates (the business's own timezone — see app.core.timezone)
and counts Mon–Fri as working days.
Minimum lead: first travel date >= today + N working days (exclusive of today: we advance until N weekdays counted).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import secrets
from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, asc, case, distinct, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.timezone import now_ist, today_ist
from app.models.auth import Delegation, Role, User
from app.models.employee import AuditLog, Employee
from app.models.policy import CityGroup, CityGroupTier, ImpactLevel
from app.models.reimbursement import ClaimTrip
from app.models.travel_booking import TravelMode, TravelTrip, TripStatus
from app.models.travel_request import (
    ProjectNotificationRecipient,
    TravelOptionType,
    TravelRequest,
    TravelRequestLeg,
    TravelRequestMode,
    TravelRequestOption,
    TravelRequestStatus,
    TravelRequestSupportingDocument,
    TravelRequestTicket,
    TravelRequestTravelType,
    TripType,
)

# Re-use entitlement lookups from booking service
from app.services.travel_booking_service import (
    FLIGHT_ALLOWED_CLASSES,
    LEVELS_REQUIRING_AIR_UNLOCK,
    TRAIN_ALLOWED_CLASSES,
    _file_kind,
    _get_user_impact_level_code,
    _normalize_level,
)

_TICKET_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".pdf"}
_TICKET_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/heic",
    "application/pdf",
}
MAX_TICKET_BYTES = 10 * 1024 * 1024


def _today_ist() -> date:
    return today_ist()


def earliest_travel_date_allowed(today: date, min_lead_working_days: int) -> date:
    """Smallest allowed travel_date: advance `today` until `min_lead_working_days` weekdays counted (tomorrow-forward)."""
    if min_lead_working_days <= 0:
        return today
    d = today
    remaining = min_lead_working_days
    while remaining > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            remaining -= 1
    return d


def _validate_ticket_file(
    filename: str, content_type: str, content: bytes, *, kind: str = "Ticket"
) -> tuple[str, str]:
    suffix = Path(filename).suffix.lower()
    if suffix not in _TICKET_EXTENSIONS or content_type not in _TICKET_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Supported {kind.lower()} formats are JPEG, PNG, HEIC and PDF",
        )
    if len(content) > MAX_TICKET_BYTES:
        raise HTTPException(status_code=413, detail=f"{kind} file exceeds 10 MB")
    if not content:
        raise HTTPException(status_code=422, detail=f"The {kind.lower()} file is empty")
    # The name and declared type are the uploader's word; the bytes must really be one of these.
    if _file_kind(content) is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"This file isn't a real JPEG, PNG, HEIC or PDF — upload the {kind.lower()} itself",
        )
    digest = hashlib.sha256(content).hexdigest()
    return digest, suffix


def parse_ticket_amount(value: object) -> Decimal:
    """The ticket's fare in rupees as the Travel Desk confirmed it. Required, and more than ₹0:
    it's what the travel spend reports add up for desk bookings."""
    text = str(value if value is not None else "").replace(",", "").replace("₹", "").strip()
    try:
        amount = Decimal(text)
    except InvalidOperation:
        amount = None
    if amount is None or not amount.is_finite() or amount <= 0:
        raise HTTPException(status_code=422, detail="Enter the ticket amount in rupees (more than ₹0)")
    if amount >= Decimal("10000000000"):
        raise HTTPException(status_code=422, detail="That ticket amount is too large — check it")
    return amount.quantize(Decimal("0.01"))


async def _policy_impact_level(user_id: int, db: AsyncSession) -> ImpactLevel | None:
    """The traveller's impact level in the policy version in effect today — the same row My
    limits shows (ImpactLevel rows are cloned per version, so their own impact_level_id may
    point at an older one). Their own row when no version covers today; None without one."""
    from app.services.me_service import _current_policy_and_level

    user = await db.get(User, user_id)
    employee = await db.get(Employee, user.employee_id) if user and user.employee_id else None
    own = await db.get(ImpactLevel, employee.impact_level_id) if employee and employee.impact_level_id else None
    if own is None:
        return None
    _, level = await _current_policy_and_level(own, db)
    return level or own


def travel_entitlement_from_level(level_code: str, impact: ImpactLevel | None) -> dict:
    """What a level may book, from its policy row (air_eligibility / air_class_allowed /
    train_classes_allowed); the built-in tables only fill in what the policy leaves unset.
    Train classes use the policy's codes (1A, 2A, 3A, CC, SL — not 1AC/2AC/3AC)."""
    from app.models.policy import AirEligibility
    from app.services.travel_booking_service import _canonical_train_class

    if impact is not None and impact.air_class_allowed is not None:
        top = _FLIGHT_CLASS_ORDER.index(impact.air_class_allowed.value)
        flight_classes = _FLIGHT_CLASS_ORDER[: top + 1]
    else:
        flight_classes = [c for c in _FLIGHT_CLASS_ORDER if c in FLIGHT_ALLOWED_CLASSES.get(level_code, {"ECONOMY"})]
    configured = list(impact.train_classes_allowed or []) if impact is not None else []
    train_codes = configured or sorted(TRAIN_ALLOWED_CLASSES.get(level_code, {"3AC", "CC", "SL"}))
    air = impact.air_eligibility.value if impact is not None and impact.air_eligibility else None
    if air is None:
        locked = level_code in LEVELS_REQUIRING_AIR_UNLOCK
        air = AirEligibility.CONDITIONAL.value if locked else AirEligibility.YES.value
    return {
        "impact_level": level_code,
        "air_eligibility": air,
        "flight_classes": flight_classes,
        "train_classes": sorted({_canonical_train_class(str(c)) for c in train_codes}),
    }


async def travel_entitlement(user_id: int, db: AsyncSession) -> dict:
    """The policy in effect's travel entitlement for this person (see travel_entitlement_from_level)."""
    impact = await _policy_impact_level(user_id, db)
    if impact is not None:
        level_code = _normalize_level(impact.level_code)
    else:
        level_code = await _get_user_impact_level_code(user_id, db)
    return travel_entitlement_from_level(level_code, impact)


def entitlement_note_text(entitlement: dict) -> str:
    """'Impact level L2; Eligible flight cabins: Economy, Premium Economy; Eligible train classes:
    1A, 2A, 3A, CC.' — the Travel Requests page shows each part as a chip."""
    air = entitlement["air_eligibility"]
    if air == "NO":
        flights = "Not eligible"
    else:
        flights = ", ".join(_FLIGHT_CLASS_LABEL.get(c, c) for c in entitlement["flight_classes"])
        if air == "CONDITIONAL":
            flights += " (with approval)"
    parts = [
        f"Impact level {entitlement['impact_level']}",
        f"Eligible flight cabins: {flights}",
        f"Eligible train classes: {', '.join(entitlement['train_classes'])}",
    ]
    return "; ".join(parts) + "."


async def entitlement_note_for_user(user_id: int, db: AsyncSession) -> dict[str, str]:
    """Plain-language policy summary for the Travel Requests page — from the policy in effect,
    the same as My limits and the option search."""
    entitlement = await travel_entitlement(user_id, db)
    return {"impact_level": entitlement["impact_level"], "text": entitlement_note_text(entitlement)}


# --- Choosing a flight/train/bus for each leg -------------------------------------------------

_FLIGHT_CLASS_ORDER = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS"]
_FLIGHT_CLASS_LABEL = {"ECONOMY": "Economy", "PREMIUM_ECONOMY": "Premium Economy", "BUSINESS": "Business"}
_TRAIN_CLASS_LABEL = {
    "1A": "First AC (1A)", "2A": "AC 2 Tier (2A)", "3A": "AC 3 Tier (3A)", "3E": "AC 3 Economy (3E)",
    "EC": "Executive Chair Car (EC)", "CC": "AC Chair Car (CC)", "SL": "Sleeper (SL)", "2S": "Second Sitting (2S)",
}
# Words a search result may use for a train class, mapped to its code (checked in this order).
_TRAIN_CLASS_WORDS = [
    ("EC", ("executive",)), ("1A", ("1a", "first ac", "1ac", "ac first")), ("2A", ("2a", "2ac", "2 tier", "two tier")),
    ("3E", ("3e", "economy")), ("3A", ("3a", "3ac", "3 tier", "three tier")), ("CC", ("cc", "chair car")),
    ("SL", ("sl", "sleeper")), ("2S", ("2s", "second sitting")),
]
OPTION_SEARCH_KEEP_HOURS = 12


async def allowed_travel_classes(user_id: int, mode: str, db: AsyncSession) -> list[str]:
    """The classes this person may book for a mode, as codes (trains: 3A, CC, …; flights:
    ECONOMY, …). Empty for buses, which have no class rule. From the policy in effect, like the
    entitlement note. (Flights keep their cabins even when air travel needs an exception: the
    search still shows what they'd fly if it's approved.)"""
    if mode == TravelRequestMode.BUS.value:
        return []
    entitlement = await travel_entitlement(user_id, db)
    if mode == TravelRequestMode.TRAIN.value:
        return entitlement["train_classes"]
    return entitlement["flight_classes"]


def _class_code(mode: str, text: str) -> str | None:
    lowered = f" {text.lower()} "
    if mode == TravelRequestMode.FLIGHT.value:
        if "business" in lowered:
            return "BUSINESS"
        if "premium" in lowered:
            return "PREMIUM_ECONOMY"
        if "economy" in lowered:
            return "ECONOMY"
        return None
    for code, words in _TRAIN_CLASS_WORDS:
        if any(re.search(rf"(^|[^a-z0-9]){re.escape(w)}([^a-z0-9]|$)", lowered) for w in words):
            return code
    return None


def _class_labels(mode: str, codes: list[str]) -> list[str]:
    labels = _FLIGHT_CLASS_LABEL if mode == TravelRequestMode.FLIGHT.value else _TRAIN_CLASS_LABEL
    return [labels.get(c, c) for c in codes]


TIME_WINDOWS = {
    # code: (label, first minute of the day, last minute of the day)
    "NIGHT": ("12 AM–6 AM", 0, 6 * 60 - 1),
    "MORNING": ("6 AM–12 PM", 6 * 60, 12 * 60 - 1),
    "AFTERNOON": ("12 PM–6 PM", 12 * 60, 18 * 60 - 1),
    "EVENING": ("6 PM–12 AM", 18 * 60, 24 * 60 - 1),
}


def clean_time_windows(windows) -> list[str]:
    """Known window codes, in the day's order, each once."""
    wanted = {str(w or "").strip().upper() for w in (windows or [])}
    return [code for code in TIME_WINDOWS if code in wanted]


def _minutes(clock: str) -> int | None:
    """'06:10' / '6:10 AM' / '18:35' → minutes after midnight, or None if it can't be read."""
    match = re.match(r"^\s*(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?\s*$", clock or "")
    if not match:
        return None
    hours, minutes, half = int(match.group(1)), int(match.group(2)), (match.group(3) or "").upper()
    if half == "PM" and hours < 12:
        hours += 12
    if half == "AM" and hours == 12:
        hours = 0
    if hours > 23 or minutes > 59:
        return None
    return hours * 60 + minutes


_VAGUE_NAMES = {"", "bus", "buses", "train", "flight", "unknown", "n/a", "na", "various", "private bus", "other"}


def _vague_option(mode: str, option: dict) -> bool:
    """Too vague to look up or book: no train/flight number, or a bus with no real operator name."""
    if mode in (TravelRequestMode.TRAIN.value, TravelRequestMode.FLIGHT.value):
        return not (option.get("number") or "").strip()
    names = {(option.get(k) or "").strip().lower() for k in ("name", "operator")}
    return names <= _VAGUE_NAMES


def _same_service_key(option: dict) -> str:
    """Train/flight number, or (buses) operator + departure: the same service listed twice shares it."""
    number = (option.get("number") or "").replace(" ", "").upper()
    if number:
        return number
    return f"{(option.get('operator') or option.get('name') or '').strip().lower()}|{option.get('depart_time') or ''}"


def _in_window(clock: str, window: str) -> bool:
    minute = _minutes(clock)
    _, start, end = TIME_WINDOWS[window]
    return minute is not None and start <= minute <= end


_TIMETABLE_LOCKS: dict[str, asyncio.Lock] = {}
# After the train timetable or flight schedules say the month's requests are used up or the key
# isn't accepted, that mode goes straight to the Gemini search until this time, instead of asking
# again on every search.
TIMETABLE_PAUSE_MINUTES = 60
_paused_until: dict[str, object] = {TravelRequestMode.TRAIN.value: None, TravelRequestMode.FLIGHT.value: None}


class TimetableUnavailable(Exception):
    """The train timetable / flight schedules can't answer this search (failed, paused, or a city
    with no station/airport we know): search_travel_options falls back to the Gemini search."""


def _provider_paused(mode: str) -> bool:
    until = _paused_until.get(mode)
    return until is not None and now_ist() < until


def _pause_provider(mode: str) -> None:
    _paused_until[mode] = now_ist() + timedelta(minutes=TIMETABLE_PAUSE_MINUTES)


async def _saved_search(key: str, fetch, *, mode: str, from_label: str, to_label: str, travel_date: date,
                        note: str, db: AsyncSession) -> tuple[list, object]:
    """The saved results for `key` if fresh (OPTION_SEARCH_KEEP_HOURS), else `await fetch()` and save
    them. A lock per key makes searches arriving together (the form asks once per time window) wait
    for the first one's results instead of each spending a request."""
    from app.models.travel_request import TravelOptionSearch

    async with _TIMETABLE_LOCKS.setdefault(key, asyncio.Lock()):
        # End this request's read transaction first: MySQL would otherwise keep showing it the
        # database as it was before it waited, without the search another request just saved —
        # and it would spend a request searching again.
        await db.commit()
        row = (
            await db.execute(select(TravelOptionSearch).where(TravelOptionSearch.cache_key == key))
        ).scalar_one_or_none()
        if row is not None and row.created_at >= now_ist() - timedelta(hours=OPTION_SEARCH_KEEP_HOURS):
            return row.results, row.created_at
        results = await fetch()
        if row is not None:
            await db.delete(row)
            await db.flush()
        db.add(
            TravelOptionSearch(
                cache_key=key, mode=mode, from_city=from_label[:128], to_city=to_label[:128],
                travel_date=travel_date, classes=note[:128], results=results,
            )
        )
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()  # saved meanwhile by another server process: we have the results anyway
        return results, now_ist()


async def _search_trains_in_timetable(
    *, from_city: str, to_city: str, travel_date: date, windows: list[str], allowed: list[str], labels: list[str],
    db: AsyncSession,
) -> dict:
    """Every train between the two cities that day, from the railway timetable (rail_timetable.py):
    one request per route and date, saved and filtered here for each time window. No fares: the
    timetable has none. Raises TimetableUnavailable when the timetable can't answer."""
    from app.services import rail_timetable

    from_code, to_code = rail_timetable.station_code(from_city), rail_timetable.station_code(to_city)
    for city, code in ((from_city, from_code), (to_city, to_code)):
        if not code:
            raise TimetableUnavailable(f"no station code for {city!r}")
    if from_code == to_code:
        raise HTTPException(status_code=422, detail="From and to are the same station")

    async def fetch() -> list:
        try:
            payload = await rail_timetable.fetch_trains_between(
                from_code, to_code, travel_date, api_key=settings.rapidapi_key, host=settings.rapidapi_irctc_host
            )
        except rail_timetable.RailSearchError as e:
            if e.pause:
                _pause_provider(TravelRequestMode.TRAIN.value)
            raise TimetableUnavailable(str(e)) from e
        return rail_timetable.parse_trains(payload, travel_date)

    key = hashlib.sha256(f"TRAIN|timetable|{from_code}|{to_code}|{travel_date}".encode()).hexdigest()
    trains, searched_at = await _saved_search(
        key, fetch, mode=TravelRequestMode.TRAIN.value, from_label=from_city, to_label=to_city,
        travel_date=travel_date, note=f"timetable|{from_code}|{to_code}", db=db,
    )
    return {
        "options": timetable_options(trains, windows=windows, allowed=allowed),
        "classes": labels,
        "windows": windows,
        "failed_windows": [],
        "searched_at": searched_at,
        "source": "timetable",
    }


def timetable_options(trains: list[dict], *, windows: list[str], allowed: list[str]) -> list[dict]:
    """The saved timetable trains leaving in one of `windows` with at least one in-policy class,
    in departure order, without prices. `travel_class` names the in-policy classes the train has."""
    options = []
    for train in trains:
        codes = train.get("classes") or []
        usable = [c for c in codes if c in allowed] if allowed else codes
        if allowed and not usable:
            continue  # no class they may book
        window = next((w for w in windows if _in_window(train.get("depart_time", ""), w)), None)
        if window is None:
            continue
        # (A search saved while fares were briefly estimated may still carry "fares": not shown.)
        option = {k: v for k, v in train.items() if k not in ("classes", "fares")}
        option["travel_class"] = _class_labels("TRAIN", usable)[0] if len(usable) == 1 else " / ".join(usable)
        option["fare_inr"] = None
        option["time_window"] = window
        options.append(option)
    options.sort(key=lambda o: _minutes(o.get("depart_time", "")) or 0)
    return options


async def _search_flights_in_schedule(
    *, from_city: str, to_city: str, travel_date: date, windows: list[str], labels: list[str], db: AsyncSession,
) -> dict:
    """Every flight from the origin city's airport to the destination city that day, from airline
    schedules (flight_schedule.py). Departures are fetched per half-day per airport — every
    destination at once — and saved, so other routes from that airport and date reuse them. No
    fares. Raises TimetableUnavailable when the schedules can't answer."""
    from app.services import flight_schedule

    origin = flight_schedule.origin_airport(from_city)
    destinations = flight_schedule.destination_airports(to_city)
    if not origin or not destinations:
        raise TimetableUnavailable(f"no airport for {from_city!r} or {to_city!r}")
    if origin in destinations:
        raise HTTPException(status_code=422, detail="From and to are the same airport")

    flights: list = []
    searched: list = []
    for half in sorted({flight_schedule.HALF_OF_WINDOW[w] for w in windows}):

        async def fetch(half: str = half) -> list:
            try:
                payload = await flight_schedule.fetch_departures(
                    origin, travel_date, half, api_key=settings.rapidapi_key, host=settings.rapidapi_aerodatabox_host
                )
            except flight_schedule.FlightSearchError as e:
                if e.pause:
                    _pause_provider(TravelRequestMode.FLIGHT.value)
                raise TimetableUnavailable(str(e)) from e
            return flight_schedule.parse_departures(payload, origin)

        key = hashlib.sha256(f"FLIGHT|schedule|{origin}|{travel_date}|{half}".encode()).hexdigest()
        found, at = await _saved_search(
            key, fetch, mode=TravelRequestMode.FLIGHT.value, from_label=origin, to_label="(all departures)",
            travel_date=travel_date, note=f"schedule|{origin}|{half}", db=db,
        )
        flights += found
        searched.append(at)
    return {
        "options": schedule_options(flights, destinations=destinations, windows=windows, labels=labels),
        "classes": labels,
        "windows": windows,
        "failed_windows": [],
        "searched_at": min(searched),
        "source": "schedule",
    }


def schedule_options(flights: list[dict], *, destinations, windows: list[str], labels: list[str]) -> list[dict]:
    """The saved departures going to one of `destinations` and leaving in one of `windows`, in
    departure order, each flight number once. `travel_class` names the classes their policy allows."""
    options = []
    seen: set[str] = set()
    for flight in sorted(flights, key=lambda f: _minutes(f.get("depart_time", "")) or 0):
        if flight.get("to_airport") not in destinations or flight.get("number") in seen:
            continue
        window = next((w for w in windows if _in_window(flight.get("depart_time", ""), w)), None)
        if window is None:
            continue
        seen.add(flight["number"])
        option = {k: v for k, v in flight.items() if k != "to_airport"}
        option["travel_class"] = " / ".join(labels)
        option["time_window"] = window
        options.append(option)
    return options


async def search_travel_options(
    *, user_id: int, mode: str, from_city: str, to_city: str, travel_date: date, time_windows, db: AsyncSession
) -> dict:
    """Real options for one leg leaving in the chosen time windows, in this person's allowed
    classes only. Each window is searched (and saved for OPTION_SEARCH_KEEP_HOURS) on its own,
    so adding a window only searches that window; results are merged in departure order."""
    import asyncio
    import hashlib as _hashlib

    from app.models.travel_request import TravelOptionSearch
    from app.services.travel_option_finder import check_option_sync, find_options_sync

    mode = str(mode or "").upper()
    if mode not in {m.value for m in TravelRequestMode}:
        raise HTTPException(status_code=422, detail="Choose flight, train or bus")
    from_city, to_city = (from_city or "").strip(), (to_city or "").strip()
    if not from_city or not to_city:
        raise HTTPException(status_code=422, detail="Enter where you're travelling from and to")
    if travel_date < today_ist():
        raise HTTPException(status_code=422, detail="The travel date is in the past")
    windows = clean_time_windows(time_windows)
    if not windows:
        raise HTTPException(status_code=422, detail="Choose when you want to leave")
    if mode == TravelRequestMode.BUS.value:
        # Buses aren't searched (no reliable source): the traveler picks a time and bus type.
        raise HTTPException(status_code=422, detail="Buses aren't searched — choose a time and bus type instead")

    allowed = await allowed_travel_classes(user_id, mode, db)
    classes_text = ",".join(allowed)
    labels = _class_labels(mode, allowed)

    # Trains from the railway timetable and flights from airline schedules when RapidAPI is set up;
    # Gemini searches the web when they can't answer (and for buses).
    if settings.rapidapi_key and mode != TravelRequestMode.BUS.value and not _provider_paused(mode):
        try:
            if mode == TravelRequestMode.TRAIN.value:
                return await _search_trains_in_timetable(
                    from_city=from_city, to_city=to_city, travel_date=travel_date, windows=windows,
                    allowed=allowed, labels=labels, db=db,
                )
            return await _search_flights_in_schedule(
                from_city=from_city, to_city=to_city, travel_date=travel_date, windows=windows, labels=labels, db=db,
            )
        except TimetableUnavailable as e:
            logger.warning("%s schedules unavailable (%s): searching with Gemini instead", mode.title(), e)

    def key_for(window: str) -> str:
        # "checked": results saved before every option was looked up again aren't reused.
        raw = f"{mode}|{from_city.lower()}|{to_city.lower()}|{travel_date}|{classes_text}|{window}|checked"
        return _hashlib.sha256(raw.encode()).hexdigest()

    keys = {w: key_for(w) for w in windows}
    rows = (
        await db.execute(select(TravelOptionSearch).where(TravelOptionSearch.cache_key.in_(list(keys.values()))))
    ).scalars().all()
    saved = {row.cache_key: row for row in rows}
    fresh_after = now_ist() - timedelta(hours=OPTION_SEARCH_KEEP_HOURS)
    results: dict[str, list] = {}
    searched_at = []
    for window, key in keys.items():
        row = saved.get(key)
        if row is not None and row.created_at >= fresh_after:
            results[window] = row.results
            searched_at.append(row.created_at)

    missing = [w for w in windows if w not in results]
    failed: list[str] = []
    if missing:
        if not settings.gemini_api_key:
            raise HTTPException(status_code=503, detail="Searching isn't set up yet — describe what you want instead")

        models = [settings.gemini_invoice_model_primary, settings.gemini_invoice_model_fallback]

        async def find(window: str) -> list[dict]:
            label, start, end = TIME_WINDOWS[window]
            found = await asyncio.to_thread(
                find_options_sync,
                mode=mode,
                from_city=from_city,
                to_city=to_city,
                day=travel_date,
                classes=labels,
                window=(label, f"{start // 60:02d}:{start % 60:02d}", f"{end // 60:02d}:{end % 60:02d}"),
                api_key=settings.gemini_api_key,
                models=models,
            )
            candidates = []
            seen: set[str] = set()
            for option in found:
                if _vague_option(mode, option) or _same_service_key(option) in seen:
                    continue
                seen.add(_same_service_key(option))
                if allowed:
                    code = _class_code(mode, option["travel_class"])
                    if code not in allowed:
                        continue  # out of policy: hidden
                    option["travel_class"] = _class_labels(mode, [code])[0]
                candidates.append(option)
            # Look every candidate up again; keep only what the timetable confirms, with its times.
            checks = await asyncio.gather(
                *(
                    asyncio.to_thread(
                        check_option_sync, mode=mode, option=option, from_city=from_city, to_city=to_city,
                        day=travel_date, api_key=settings.gemini_api_key, models=models,
                    )
                    for option in candidates
                ),
                return_exceptions=True,
            )
            options = []
            for option, checked in zip(candidates, checks, strict=True):
                if isinstance(checked, Exception) or checked is None:
                    continue  # doesn't run this route that day, or couldn't be confirmed
                option.update({k: v for k, v in checked.items() if v})
                if not _in_window(option["depart_time"], window):
                    continue  # really leaves outside the chosen time
                option["time_window"] = window
                options.append(option)
            return options

        outcomes = await asyncio.gather(*(find(w) for w in missing), return_exceptions=True)
        for window, options in zip(missing, outcomes, strict=True):
            if isinstance(options, Exception):
                failed.append(window)
                continue
            results[window] = options
            old = saved.get(keys[window])
            if old is not None:
                await db.delete(old)
                await db.flush()
            db.add(
                TravelOptionSearch(
                    cache_key=keys[window], mode=mode, from_city=from_city[:128], to_city=to_city[:128],
                    travel_date=travel_date, classes=f"{classes_text}|{window}"[:128], results=options,
                )
            )
        await db.commit()
        searched_at.append(now_ist())
        if len(failed) == len(windows):
            raise HTTPException(status_code=502, detail="Couldn't search right now — describe what you want instead")

    merged = [option for window in windows for option in results.get(window, [])]
    merged.sort(key=lambda o: _minutes(o.get("depart_time", "")) or 0)
    # Two windows' searches can both return the same service: keep the first.
    seen_keys: set[str] = set()
    unique = []
    for option in merged:
        if _same_service_key(option) in seen_keys:
            continue
        seen_keys.add(_same_service_key(option))
        unique.append(option)
    merged = unique
    if mode == TravelRequestMode.TRAIN.value:
        # Trains are shown without prices (Gemini's fare guesses aren't reliable enough).
        merged = [{**option, "fare_inr": None} for option in merged]
    return {
        "options": merged,
        "classes": labels,
        "windows": windows,
        "failed_windows": failed,
        "searched_at": min(searched_at) if searched_at else now_ist(),
    }


def _expected_leg_count(trip_type: str, return_date: date | None, legs: list | None) -> int:
    if trip_type == TripType.MULTI_CITY.value and legs:
        return len(legs)
    if trip_type == TripType.ROUND_TRIP.value and return_date:
        return 2
    return 1


# Bus types a traveler can ask for on a bus leg (buses aren't searched: the desk books them).
BUS_TYPES = ("AC_SLEEPER", "AC_SEATER", "NON_AC_SLEEPER", "NON_AC_SEATER", "VOLVO")


def clean_bus_types(types) -> list[str]:
    """Known bus type codes, in BUS_TYPES order, each once."""
    wanted = {str(t or "").strip().upper() for t in (types or [])}
    return [code for code in BUS_TYPES if code in wanted]


def _leg_mode(seq: int, *, trip_type: str, mode: str | None, legs: list | None) -> str:
    """The travel mode of ticketable leg `seq` (multi-city legs carry their own)."""
    mode_text = str(getattr(mode, "value", mode) or "").upper()
    if trip_type == TripType.MULTI_CITY.value and legs and 1 <= seq <= len(legs):
        leg = legs[seq - 1]
        own = leg.get("travel_mode") if isinstance(leg, dict) else getattr(leg, "travel_mode", None)
        return str(getattr(own, "value", own) or mode_text).upper()
    return mode_text


def validate_leg_picks(
    picks: list | None, *, trip_type: str, return_date: date | None, legs: list | None, mode: str | None = None
) -> list[dict]:
    """One choice per ticketable leg is required: for a train or flight leg a picked option, or a
    short note saying what they'd like instead; for a bus leg (never searched) when they want to
    leave and what kind of bus. Returns the cleaned list to store."""
    from app.services.travel_option_finder import _clean

    count = _expected_leg_count(trip_type, return_date, legs)
    by_seq: dict[int, dict] = {}
    for raw in picks or []:
        pick = raw.model_dump() if hasattr(raw, "model_dump") else dict(raw or {})
        try:
            seq = int(pick.get("seq"))
        except (TypeError, ValueError):
            continue
        if 1 <= seq <= count:
            by_seq[seq] = pick
    cleaned = []
    for seq in range(1, count + 1):
        pick = by_seq.get(seq)
        leg_name = "the trip" if count == 1 else f"leg {seq}"
        if pick is None:
            raise HTTPException(status_code=422, detail=f"Choose a flight, train or bus for {leg_name}")
        windows = clean_time_windows(pick.get("time_windows"))
        if _leg_mode(seq, trip_type=trip_type, mode=mode, legs=legs) == TravelRequestMode.BUS.value:
            bus_types = clean_bus_types(pick.get("bus_types"))
            if not windows:
                raise HTTPException(status_code=422, detail=f"Choose when you want to leave for {leg_name}")
            if not bus_types:
                raise HTTPException(status_code=422, detail=f"Choose a bus type for {leg_name}")
            cleaned.append(
                {"seq": seq, "choice": "bus", "option": None, "note": None, "time_windows": windows,
                 "bus_types": bus_types}
            )
        elif pick.get("choice") == "own":
            note = str(pick.get("note") or "").strip()
            if len(note) < 5:
                raise HTTPException(status_code=422, detail=f"Say what you'd like for {leg_name}")
            cleaned.append({"seq": seq, "choice": "own", "option": None, "note": note[:500], "time_windows": windows})
        elif pick.get("choice") == "option" and isinstance(pick.get("option"), dict):
            option = _clean(pick["option"])
            if not option["name"] and not option["number"]:
                raise HTTPException(status_code=422, detail=f"Choose a flight, train or bus for {leg_name}")
            searched_at = str(pick.get("searched_at") or "")[:32] or None
            cleaned.append(
                {
                    "seq": seq,
                    "choice": "option",
                    "option": option,
                    "note": None,
                    "searched_at": searched_at,
                    "time_windows": windows,
                }
            )
        else:
            raise HTTPException(status_code=422, detail=f"Choose a flight, train or bus for {leg_name}")
    return cleaned


async def list_travel_options(db: AsyncSession, *, include_inactive: bool = False) -> list[TravelRequestOption]:
    stmt = select(TravelRequestOption).order_by(
        TravelRequestOption.option_type.asc(), func.lower(TravelRequestOption.label).asc(), TravelRequestOption.id.asc()
    )
    if not include_inactive:
        stmt = stmt.where(TravelRequestOption.is_active.is_(True))
    return list((await db.execute(stmt)).scalars().all())


# Audit actions that can carry a rename of an option's value (old/new row snapshots).
_OPTION_RENAME_ACTIONS = ("travel_option_renamed", "travel_option_updated")


async def find_travel_option(
    option_type: TravelOptionType, value: str | None, db: AsyncSession
) -> TravelRequestOption | None:
    """The option a stored value means, active or not: the option with that value now, or else
    the option that was renamed away from it. Renaming an option doesn't rewrite the requests and
    claims that already carry the old text (they keep what they were raised with), so an old value
    is traced through the renames in the audit log — the newest rename from it wins."""
    stored = (value or "").strip()
    if not stored:
        return None
    row = await db.scalar(
        select(TravelRequestOption).where(
            TravelRequestOption.option_type == option_type.value, TravelRequestOption.value == stored
        )
    )
    if row is not None:
        return row
    renames = (
        await db.execute(
            select(AuditLog.entity_id, AuditLog.old_value, AuditLog.new_value)
            .where(AuditLog.entity_type == "travel_option", AuditLog.action.in_(_OPTION_RENAME_ACTIONS))
            .order_by(AuditLog.id.desc())
        )
    ).all()
    for entity_id, old, new in renames:
        old, new = old or {}, new or {}
        if (
            old.get("option_type") == option_type.value
            and old.get("value") == stored
            and new.get("value") != stored
            and str(entity_id).isdigit()
        ):
            option = await db.get(TravelRequestOption, int(entity_id))
            if option is not None and option.option_type == option_type.value:
                return option
    return None


async def _require_active_option(option_type: TravelOptionType, value: str, field_label: str, db: AsyncSession) -> str:
    """Returns the option's current `value`; 422 when it isn't an active admin-configured option.
    A value an option was renamed from (an old request's) gives the option's new value."""
    stored = value.strip()
    row = await find_travel_option(option_type, stored, db)
    if row is None or not row.is_active:
        raise HTTPException(status_code=422, detail=f"{field_label} '{stored}' is not an available option")
    return row.value


async def _validate_request_details(
    *,
    travel_type: TravelRequestTravelType | str | None,
    project_code: str | None,
    purpose: str | None,
    db: AsyncSession,
) -> dict:
    """Validates the project / purpose part of a request against the admin-managed options and
    returns the normalized column values to persist."""
    type_val = (
        travel_type.value if isinstance(travel_type, TravelRequestTravelType) else str(travel_type or "").upper()
    ) or TravelRequestTravelType.NON_PROJECT.value
    if type_val not in {t.value for t in TravelRequestTravelType}:
        raise HTTPException(status_code=422, detail="Invalid travel_type")

    resolved_project: str | None = None
    if type_val == TravelRequestTravelType.PROJECT.value:
        if not project_code or not project_code.strip():
            raise HTTPException(status_code=422, detail="Project code is required for project travel")
        resolved_project = await _require_active_option(TravelOptionType.PROJECT_CODE, project_code, "Project code", db)

    if not purpose or not purpose.strip():
        raise HTTPException(status_code=422, detail="Trip purpose is required")
    # "Relocation" belongs to the Travel Claim form (it starts the relocation reimbursement flow),
    # not to travel requests.
    if (purpose or "").strip().lower() == "relocation":
        raise HTTPException(
            status_code=422,
            detail="Relocation isn't a travel request purpose — claim relocation expenses from New Claim → Travel Claim",
        )
    resolved_purpose = await _require_active_option(TravelOptionType.TRIP_PURPOSE, purpose, "Trip purpose", db)

    return {
        "travel_type": type_val,
        "project_code": resolved_project,
        "purpose": resolved_purpose,
    }


def _trip_route_and_dates(request: TravelRequest) -> tuple[str, str, date | None, date | None]:
    """(from_city, to_city, start_date, end_date) across ONE_WAY/ROUND_TRIP (plain columns) and
    MULTI_CITY (per-leg) shapes — the single range a stakeholder notification can show."""
    legs = list(request.legs or [])
    if legs:
        leg_dates = [leg.travel_date for leg in legs if leg.travel_date]
        return (
            legs[0].from_city,
            legs[-1].to_city,
            min(leg_dates) if leg_dates else None,
            max(leg_dates) if leg_dates else None,
        )
    return (
        request.from_city or "",
        request.to_city or "",
        request.travel_date,
        request.return_date or request.travel_date,
    )


def _render_template_text(text: str, context: dict[str, str]) -> str:
    for key, value in context.items():
        text = text.replace("{{" + key + "}}", value)
    return text


logger = logging.getLogger(__name__)


async def _notify_stakeholders_once_booked(request: TravelRequest, db: AsyncSession) -> None:
    """Site visit email, sent once the request has just become fully BOOKED (every leg
    ticketed) — so stakeholders only hear about trips that are definitely
    happening. Called after the booking is committed; a failure here never undoes the booking."""
    try:
        # Reload with legs eagerly: the email's route/dates come from them, and a lazy load here
        # would fail under async (silently, since this is wrapped) after the caller's refresh.
        fresh = (
            await db.execute(
                select(TravelRequest).options(selectinload(TravelRequest.legs)).where(TravelRequest.id == request.id)
            )
        ).scalar_one()
        await notify_project_stakeholders_if_applicable(fresh, db)
    except Exception as e:  # noqa: BLE001 — notification failures must never surface as booking errors
        logger.exception("Failed to notify project stakeholders for travel request %s: %s", request.id, e)


async def notify_project_stakeholders_if_applicable(request: TravelRequest, db: AsyncSession) -> None:
    """Fires once a PROJECT-type request is fully booked by the Travel Desk (see
    _notify_stakeholders_once_booked) with a trip purpose that's been marked
    notify_project_stakeholders (admin-configured per TRIP_PURPOSE option — on by default for the
    seeded "Project Site Visit" purpose). Emails every address configured for this request's
    project_code (ProjectNotificationRecipient, admin-managed in Admin -> Travel Options) — plain
    emails, no account required on either end. Content comes from the "project_site_visit"
    NotificationTemplate row (Admin -> Notification Templates), with a hardcoded fallback if that
    row is ever missing. Caller wraps this in try/except — a notification failure must never
    block the booking itself."""
    if request.travel_type != TravelRequestTravelType.PROJECT.value or not request.project_code:
        return

    # The request keeps the purpose / project code it was raised with; if either has been renamed
    # since, the option (and the recipients, which move with a renamed code) are under the new name.
    option = await find_travel_option(TravelOptionType.TRIP_PURPOSE, request.purpose, db)
    if option is None or not option.notify_project_stakeholders:
        return
    project = await find_travel_option(TravelOptionType.PROJECT_CODE, request.project_code, db)
    project_code = project.value if project is not None else request.project_code

    recipients = (
        await db.execute(
            select(ProjectNotificationRecipient).where(
                ProjectNotificationRecipient.project_code == project_code
            )
        )
    ).scalars().all()
    if not recipients:
        return

    from app.models.claim_workflow import NotificationTemplate
    from app.services.notification_service import send_email_async

    employee = await db.get(User, request.employee_user_id)
    employee_name = (employee.full_name if employee else None) or (employee.email if employee else "An employee")

    from_city, to_city, start_date, end_date = _trip_route_and_dates(request)
    context = {
        "employee_name": employee_name,
        "project_code": request.project_code,
        "from_city": from_city or "—",
        "to_city": to_city or "—",
        "start_date": start_date.isoformat() if start_date else "—",
        "end_date": end_date.isoformat() if end_date else "—",
        "purpose": option.label or option.value,
    }

    template = await db.scalar(
        select(NotificationTemplate).where(NotificationTemplate.template_key == "project_site_visit")
    )
    subject_tpl = template.subject if template else "Upcoming site visit — {{project_code}}"
    body_tpl = (
        template.body_text
        if template
        else (
            "{{employee_name}} is visiting {{to_city}} for project {{project_code}} "
            "from {{start_date}} to {{end_date}}."
        )
    )
    subject = _render_template_text(subject_tpl, context)
    body = _render_template_text(body_tpl, context)

    for recipient in recipients:
        try:
            await send_email_async(to_email=recipient.email, subject=f"[Travora] {subject}", body_text=body)
        except Exception as e:
            print(f"Failed to notify project stakeholder {recipient.email}: {e}")


async def expense_limits_for_city(
    user_id: int, city: str, travel_date: date | None, db: AsyncSession
) -> dict:
    """The travel policy's expense caps for `city` at the requester's impact level — the same
    city-group + policy-version resolution claims use, so what a traveler sees here is what the
    claim check will later enforce. `has_limits` is False when no policy version covers the date
    or no limit row is configured for this level / city-group."""
    from app.services.policy_engine import get_active_policy_version, get_expense_limits, resolve_city_group

    on_date = travel_date or _today_ist()
    group_code = await resolve_city_group(city_name=city, travel_date=on_date, db=db)
    tier = (await db.execute(select(CityGroupTier).where(CityGroupTier.code == group_code))).scalar_one_or_none()
    level_code = await _get_user_impact_level_code(user_id, db)

    out: dict = {
        "city": city.strip(),
        "city_group": group_code,
        "city_group_name": tier.display_name if tier else None,
        "impact_level": level_code,
        "has_limits": False,
    }
    try:
        policy = await get_active_policy_version(on_date, db)
    except HTTPException:
        return out

    # ImpactLevel rows are cloned per policy version (new ids), so the employee's own
    # impact_level_id may point at an older version's row — match on level_code within the
    # version that governs this date instead.
    level = (
        await db.execute(
            select(ImpactLevel).where(
                ImpactLevel.policy_version_id == policy.id,
                func.upper(ImpactLevel.level_code) == level_code.upper(),
            )
        )
    ).scalars().first()
    if level is None:
        return out
    limit_row = await get_expense_limits(policy.id, level.id, group_code, db)
    if limit_row is None:
        return out

    for field in ("hotel", "food", "incidental", "day_visit"):
        out[f"{field}_cap"] = getattr(limit_row, f"{field}_cap")
        out[f"{field}_is_hard_block"] = getattr(limit_row, f"{field}_is_hard_block")
    out["has_limits"] = True
    return out


async def city_suggestions(prefix: str, limit: int, db: AsyncSession) -> list[str]:
    q = prefix.strip().lower()
    if len(q) < 1:
        return []
    stmt = (
        select(distinct(CityGroup.city_name))
        .where(func.lower(CityGroup.city_name).like(f"%{q}%"))
        .order_by(CityGroup.city_name.asc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [str(r) for r in rows]


def _same_city_name(a: str | None, b: str | None) -> bool:
    return bool(a and b) and " ".join(a.split()).lower() == " ".join(b.split()).lower()


def validate_trip_shape(
    *,
    trip_type: str | None,
    from_city: str | None,
    to_city: str | None,
    travel_date: date | None,
    return_date: date | None,
    legs: list | None,
    today: date,
) -> str:
    """The route and dates make a real trip: a known trip type; for one-way / round trip a from
    and to city that differ and a travel date (and, for a round trip, a return date not before
    it); for multi-city at least 2 legs in date order. No date may be in the past — a short-notice
    exception only covers future dates inside the notice window. Returns the trip type code."""
    trip = str(getattr(trip_type, "value", trip_type) or "").strip().upper()
    if trip not in {t.value for t in TripType}:
        raise HTTPException(status_code=422, detail="Choose one way, round trip or multi-city")

    if trip == TripType.MULTI_CITY.value:
        if not legs or len(legs) < 2:
            raise HTTPException(status_code=422, detail="Add at least 2 legs for a multi-city trip")
        previous: date | None = None
        for i, leg in enumerate(legs, start=1):
            if not (leg.from_city or "").strip() or not (leg.to_city or "").strip():
                raise HTTPException(status_code=422, detail=f"Enter where leg {i} goes from and to")
            if _same_city_name(leg.from_city, leg.to_city):
                raise HTTPException(status_code=422, detail=f"Leg {i} starts and ends in the same city")
            if leg.travel_date < today:
                raise HTTPException(status_code=422, detail=f"The date of leg {i} is in the past")
            if previous is not None and leg.travel_date < previous:
                raise HTTPException(
                    status_code=422, detail=f"Leg {i} is before leg {i - 1} — put the legs in date order"
                )
            previous = leg.travel_date
        return trip

    if not (from_city or "").strip() or not (to_city or "").strip():
        raise HTTPException(status_code=422, detail="Enter where you're travelling from and to")
    if _same_city_name(from_city, to_city):
        raise HTTPException(status_code=422, detail="From and to are the same city")
    if travel_date is None:
        raise HTTPException(status_code=422, detail="Choose a travel date")
    if travel_date < today:
        raise HTTPException(status_code=422, detail="The travel date is in the past")
    if trip == TripType.ROUND_TRIP.value:
        if return_date is None:
            raise HTTPException(status_code=422, detail="Choose a return date for a round trip")
        if return_date < travel_date:
            raise HTTPException(status_code=422, detail="The return date is before the departure date")
    return trip


async def _validate_common_travel_request_fields(
    *, user_id: int, travel_mode: TravelRequestMode | str, travel_date: date | None, legs: list | None, db: AsyncSession
) -> tuple[object, str]:
    """Shared, non-exception-related validation. Returns (user, normalized mode_val)."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.employee_id:
        raise HTTPException(status_code=422, detail="Travel requests require your profile to link to an employee id")

    mode_val = travel_mode.value if isinstance(travel_mode, TravelRequestMode) else str(travel_mode).upper()
    if mode_val not in {m.value for m in TravelRequestMode}:
        raise HTTPException(status_code=422, detail="Invalid travel_mode")

    return user, mode_val


async def _determine_blocking_exceptions(
    *, user_id: int, mode_val: str, impact_level: str, travel_date: date | None, legs: list | None, db: AsyncSession
) -> list[tuple[str, str]]:
    """Returns every (exception_type, message) this request needs a policy exception for.

    A single request can trip more than one check at once (e.g. a short-notice flight for
    someone whose level also has air travel locked) — all of them are collected and later
    rolled into one combined ExceptionRequest, not just the first match.

    Checks the primary trip fields plus every MULTI_CITY leg individually — a flight (or train)
    buried in leg 2 or 3 of a mixed-mode trip must trigger the same checks as a single-leg request.
    """
    flight_dates: list[date] = []
    train_dates: list[date] = []
    # Any mode with no dedicated advance-booking rule of its own (currently just BUS) still
    # needs *some* minimum-notice floor — see the TRAVEL_REQUEST_LEAD_TIME_OVERRIDE block below.
    other_dates: list[date] = []
    if mode_val == "FLIGHT" and travel_date:
        flight_dates.append(travel_date)
    elif mode_val == "TRAIN" and travel_date:
        train_dates.append(travel_date)
    elif travel_date:
        other_dates.append(travel_date)
    for leg in legs or []:
        leg_mode = leg.travel_mode.upper() if leg.travel_mode else mode_val
        if leg_mode == "FLIGHT" and leg.travel_date:
            flight_dates.append(leg.travel_date)
        elif leg_mode == "TRAIN" and leg.travel_date:
            train_dates.append(leg.travel_date)
        elif leg.travel_date:
            other_dates.append(leg.travel_date)

    if not flight_dates and not train_dates and not other_dates:
        return []

    from app.services.workflow_service import get_workflow_config, is_exception_enabled

    cfg = await get_workflow_config(db)
    blocking: list[tuple[str, str]] = []
    # Every check here is scoped to THIS request: an exception approved for an earlier trip
    # never exempts a new one (each short-notice / air-locked request needs its own approval).

    if flight_dates and is_exception_enabled(cfg, "FLIGHT_ADVANCE_BOOKING_OVERRIDE"):
        earliest_flight_date = min(flight_dates)
        min_days = settings.flight_advance_booking_min_days
        days_in_advance = (earliest_flight_date - date.today()).days
        if days_in_advance < min_days:
            blocking.append((
                "FLIGHT_ADVANCE_BOOKING_OVERRIDE",
                f"Minimum {min_days}-day advance booking window for flights is enforced.",
            ))

    if train_dates and is_exception_enabled(cfg, "TRAIN_ADVANCE_BOOKING_OVERRIDE"):
        # Separate from TRAIN_TATKAL (self-declared/invoice-detected, claims side) — this is
        # purely date-driven, same as the flight check above. Inclusive boundary (<=, not <):
        # a departure exactly `min_train_days` days out — e.g. booking on the 6th for the
        # 8th — is itself the short-notice case this is meant to catch, not the safe side of it.
        earliest_train_date = min(train_dates)
        min_train_days = settings.train_advance_booking_min_days
        train_days_in_advance = (earliest_train_date - date.today()).days
        if train_days_in_advance <= min_train_days:
            blocking.append((
                "TRAIN_ADVANCE_BOOKING_OVERRIDE",
                f"Trains departing within {min_train_days} day(s) of booking require exception approval.",
            ))

    if other_dates and is_exception_enabled(cfg, "TRAVEL_REQUEST_LEAD_TIME_OVERRIDE"):
        # Generic floor for any mode without its own dedicated advance-booking exception
        # (flight and train are covered above, at their own thresholds, instead of this one).
        min_lead_days = settings.travel_request_min_lead_working_days
        earliest_allowed = earliest_travel_date_allowed(_today_ist(), min_lead_days)
        earliest_other_date = min(other_dates)
        if earliest_other_date < earliest_allowed:
            blocking.append((
                "TRAVEL_REQUEST_LEAD_TIME_OVERRIDE",
                f"Travel must be booked at least {min_lead_days} working day(s) in advance. "
                f"Earliest allowed travel date is {earliest_allowed.isoformat()}.",
            ))

    if flight_dates and impact_level in LEVELS_REQUIRING_AIR_UNLOCK and is_exception_enabled(cfg, "AIR_TRAVEL_UNLOCK"):
        # Scoped to this specific request, not a standing unlock for the employee: a prior
        # AIR_TRAVEL_UNLOCK approval covered only the trip it was raised for, so every new
        # flight booking needs its own fresh exception approval. Gated on flight_dates since a
        # pure train trip never needs air-travel unlock regardless of impact level.
        blocking.append((
            "AIR_TRAVEL_UNLOCK",
            "Air travel is locked for your level until Reporting Manager + Group Head HR + CEO "
            "exception approval is recorded for this request.",
        ))

    return blocking


async def create_travel_request(
    *,
    user_id: int,
    trip_type: str,
    travel_mode: TravelRequestMode | str,
    from_city: str | None,
    to_city: str | None,
    travel_date: date | None,
    return_date: date | None,
    travel_type: TravelRequestTravelType | str | None,
    project_code: str | None,
    purpose: str | None,
    notes: str | None,
    legs: list | None,
    leg_picks: list | None = None,
    db: AsyncSession,
) -> TravelRequest:
    user, mode_val = await _validate_common_travel_request_fields(
        user_id=user_id, travel_mode=travel_mode, travel_date=travel_date, legs=legs, db=db
    )
    trip_type = validate_trip_shape(
        trip_type=trip_type, from_city=from_city, to_city=to_city, travel_date=travel_date,
        return_date=return_date, legs=legs, today=_today_ist(),
    )
    details = await _validate_request_details(
        travel_type=travel_type,
        project_code=project_code,
        purpose=purpose,
        db=db,
    )
    picks = validate_leg_picks(leg_picks, trip_type=trip_type, return_date=return_date, legs=legs, mode=mode_val)

    impact_level = await _get_user_impact_level_code(user_id, db)
    blocking = await _determine_blocking_exceptions(
        user_id=user_id, mode_val=mode_val, impact_level=impact_level, travel_date=travel_date, legs=legs, db=db
    )
    if blocking:
        combined_message = " ".join(message for _, message in blocking)
        # 403/409 (never 422) signal to the frontend that this block is exception-eligible —
        # i.e. the employee can resubmit via create_travel_request_with_exception instead of
        # this failing outright. A plain 422 stays reserved for genuine hard-validation errors
        # (invalid travel_mode, missing employee link, ...) that have no override path.
        status_code = (
            status.HTTP_403_FORBIDDEN
            if any(exc_type == "AIR_TRAVEL_UNLOCK" for exc_type, _ in blocking)
            else status.HTTP_409_CONFLICT
        )
        raise HTTPException(status_code=status_code, detail=combined_message)

    row = await _insert_travel_request_row(
        user_id=user_id,
        trip_type=trip_type,
        mode_val=mode_val,
        from_city=from_city,
        to_city=to_city,
        travel_date=travel_date,
        return_date=return_date,
        notes=notes,
        legs=legs,
        status_value=TravelRequestStatus.PENDING.value,
        leg_picks=picks,
        db=db,
        **details,
    )

    # Build the (possibly multi-stage, admin-configured) approval chain and notify its first
    # approver(s) — replaces the old hardcoded "just notify the reporting manager" block.
    try:
        from app.services.workflow_service import init_travel_request_approval_chain

        await init_travel_request_approval_chain(row, db)
        await db.commit()
    except Exception as e:
        print(f"Failed to initialize approval chain: {e}")

    # The site visit email (notify_project_stakeholders_if_applicable) goes out once the Travel
    # Desk has fully booked the trip — not here at submission, while it could still be rejected.
    return await _reload_travel_request_with_legs(row.id, db)


async def _insert_travel_request_row(
    *,
    user_id: int,
    trip_type: str,
    mode_val: str,
    from_city: str | None,
    to_city: str | None,
    travel_date: date | None,
    return_date: date | None,
    travel_type: str,
    project_code: str | None,
    purpose: str | None,
    notes: str | None,
    legs: list | None,
    leg_picks: list | None = None,
    status_value: str,
    db: AsyncSession,
) -> TravelRequest:
    row = TravelRequest(
        employee_user_id=user_id,
        trip_type=trip_type,
        travel_mode=mode_val,
        from_city=(from_city.strip() if from_city else None),
        to_city=(to_city.strip() if to_city else None),
        travel_date=travel_date,
        return_date=return_date,
        travel_type=travel_type,
        project_code=project_code,
        purpose=purpose,
        notes=notes,
        leg_picks=leg_picks or None,
        status=status_value,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    if legs and trip_type == TripType.MULTI_CITY.value:
        for i, leg in enumerate(legs):
            db.add(TravelRequestLeg(
                travel_request_id=row.id,
                leg_sequence=i+1,
                travel_mode=leg.travel_mode.upper() if leg.travel_mode else mode_val,
                from_city=leg.from_city,
                to_city=leg.to_city,
                travel_date=leg.travel_date,
                preferred_time=leg.preferred_time
            ))
        await db.commit()
        await db.refresh(row)

    return row


async def _reload_travel_request_with_legs(request_id: int, db: AsyncSession) -> TravelRequest:
    stmt = select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == request_id)
    return (await db.execute(stmt)).scalar_one()


async def create_travel_request_with_exception(
    *,
    user_id: int,
    trip_type: str,
    travel_mode: TravelRequestMode | str,
    from_city: str | None,
    to_city: str | None,
    travel_date: date | None,
    return_date: date | None,
    travel_type: TravelRequestTravelType | str | None,
    project_code: str | None,
    purpose: str | None,
    notes: str | None,
    legs: list | None,
    leg_picks: list | None = None,
    justification: str,
    db: AsyncSession,
) -> TravelRequest:
    """Same validation as create_travel_request, but when the request is only blocked by a
    policy exception, creates it anyway in PENDING_EXCEPTION status and raises the exception
    request instead of rejecting the submission outright."""
    await _validate_common_travel_request_fields(
        user_id=user_id, travel_mode=travel_mode, travel_date=travel_date, legs=legs, db=db
    )
    trip_type = validate_trip_shape(
        trip_type=trip_type, from_city=from_city, to_city=to_city, travel_date=travel_date,
        return_date=return_date, legs=legs, today=_today_ist(),
    )
    mode_val =travel_mode.value if isinstance(travel_mode, TravelRequestMode) else str(travel_mode).upper()
    details = await _validate_request_details(
        travel_type=travel_type,
        project_code=project_code,
        purpose=purpose,
        db=db,
    )
    picks = validate_leg_picks(leg_picks, trip_type=trip_type, return_date=return_date, legs=legs, mode=mode_val)

    impact_level = await _get_user_impact_level_code(user_id, db)
    blocking = await _determine_blocking_exceptions(
        user_id=user_id, mode_val=mode_val, impact_level=impact_level, travel_date=travel_date, legs=legs, db=db
    )

    if not blocking:
        # Nothing actually blocks this — no exception needed, submit normally.
        return await create_travel_request(
            user_id=user_id,
            trip_type=trip_type,
            travel_mode=travel_mode,
            from_city=from_city,
            to_city=to_city,
            travel_date=travel_date,
            return_date=return_date,
            travel_type=travel_type,
            project_code=project_code,
            purpose=purpose,
            notes=notes,
            legs=legs,
            leg_picks=leg_picks,
            db=db,
        )

    exception_types = [exc_type for exc_type, _ in blocking]

    row = await _insert_travel_request_row(
        user_id=user_id,
        trip_type=trip_type,
        mode_val=mode_val,
        from_city=from_city,
        to_city=to_city,
        travel_date=travel_date,
        return_date=return_date,
        notes=notes,
        legs=legs,
        status_value=TravelRequestStatus.PENDING_EXCEPTION.value,
        leg_picks=picks,
        db=db,
        **details,
    )

    from app.services.workflow_service import create_travel_exception_request

    # One combined ExceptionRequest for every type this submission tripped, not one per type —
    # its approval chain is the union of each type's required-approver roles.
    await create_travel_exception_request(row.id, user_id, exception_types, justification, db)

    # Once every exception approver signs off, this request is approved straight away (no normal
    # approval stages after the exception chain); the site visit email goes out once it's booked.
    return await _reload_travel_request_with_legs(row.id, db)


_TICKETED_STATUSES = (TravelRequestStatus.BOOKED.value, TravelRequestStatus.PARTIALLY_BOOKED.value)


def _compute_booking_status(req: TravelRequest, *, newly_ticketed_seq: int | None = None) -> tuple[str, int]:
    """BOOKED once every segment has a ticket; PARTIALLY_BOOKED once any has. Additional
    documents don't count. Returns (status, legs_pending).

    newly_ticketed_seq covers the ticket just added in this session, which req's viewonly
    relationships don't see until commit."""
    segment_seqs = {s["seq"] for s in _segments_for_request(req)}
    ticketed = {t.leg_sequence for t in (req.tickets or [])}
    if newly_ticketed_seq is not None:
        ticketed.add(newly_ticketed_seq)

    legs_pending = len(segment_seqs - ticketed)
    if not legs_pending:
        status = TravelRequestStatus.BOOKED.value
    elif segment_seqs & ticketed:
        status = TravelRequestStatus.PARTIALLY_BOOKED.value
    else:
        status = TravelRequestStatus.APPROVED.value
    return status, legs_pending


def _latest_ticket(req: TravelRequest) -> TravelRequestTicket | None:
    """Most recently uploaded ticket, if this request has any (kept for callers that only
    want a single preview ticket — `build_segments_out` is the source of truth for per-leg
    ticket status)."""
    if req.status not in _TICKETED_STATUSES:
        return None
    tickets = req.tickets or []
    return max(tickets, key=lambda t: t.uploaded_at) if tickets else None


def _ticket_for_leg(req: TravelRequest, leg_sequence: int) -> TravelRequestTicket | None:
    """The ticket on this leg (the newest, if an older upload left several)."""
    tickets = [t for t in (req.tickets or []) if t.leg_sequence == leg_sequence]
    return max(tickets, key=lambda t: (str(t.uploaded_at or ""), t.id or 0)) if tickets else None


async def list_travel_requests_for_employee(user_id: int, db: AsyncSession) -> list[tuple[TravelRequest, TravelRequestTicket | None]]:
    reqs = (
        await db.execute(
            select(TravelRequest)
            .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
            .where(TravelRequest.employee_user_id == user_id)
            .order_by(TravelRequest.requested_at.desc())
        )
    ).scalars().all()
    return [(r, _latest_ticket(r)) for r in reqs]


async def get_latest_exceptions_for_requests(request_ids: Sequence[int], db: AsyncSession) -> dict[int, dict]:
    """Latest exception chain (if any) per travel_request_id, keyed for TravelExceptionSummaryOut."""
    if not request_ids:
        return {}

    from app.models.claim_workflow import ExceptionApproval, ExceptionRequest

    exc_rows = (
        await db.execute(
            select(ExceptionRequest)
            .where(ExceptionRequest.travel_request_id.in_(list(request_ids)))
            .order_by(ExceptionRequest.created_at.desc())
        )
    ).scalars().all()
    latest_by_request: dict[int, ExceptionRequest] = {}
    for exc in exc_rows:
        latest_by_request.setdefault(exc.travel_request_id, exc)
    if not latest_by_request:
        return {}

    exc_ids = [exc.id for exc in latest_by_request.values()]
    approvals = (
        await db.execute(
            select(ExceptionApproval)
            .where(ExceptionApproval.exception_request_id.in_(exc_ids))
            .order_by(ExceptionApproval.id.asc())
        )
    ).scalars().all()
    approvals_by_exc: dict[int, list[ExceptionApproval]] = {}
    for a in approvals:
        approvals_by_exc.setdefault(a.exception_request_id, []).append(a)

    out: dict[int, dict] = {}
    for req_id, exc in latest_by_request.items():
        out[req_id] = {
            "id": exc.id,
            "exception_type": exc.exception_type,
            "exception_types": exc.exception_types or [exc.exception_type],
            "status": exc.status,
            "description": exc.description,
            "decision_comment": exc.decision_comment,
            "approvals": [
                {
                    "required_role": a.required_role,
                    "status": a.status,
                    "acted_at": a.acted_at,
                    "comment": a.comment,
                }
                for a in approvals_by_exc.get(exc.id, [])
            ],
        }
    return out


async def _employee_impact_bundle(employee_ids: Sequence[str], db: AsyncSession) -> dict[str, tuple[str, ImpactLevel | None]]:
    """Map employee_id -> (employee full_name, ImpactLevel optional)."""
    if not employee_ids:
        return {}
    emps = (await db.execute(select(Employee).where(Employee.employee_id.in_(set(employee_ids))))).scalars().all()
    impacts: dict[int, ImpactLevel] = {}
    lvl_ids = {e.impact_level_id for e in emps if e.impact_level_id}
    if lvl_ids:
        for il in (
            await db.execute(select(ImpactLevel).where(ImpactLevel.id.in_(lvl_ids)))
        ).scalars().all():
            impacts[il.id] = il

    bundle: dict[str, tuple[str, ImpactLevel | None]] = {}
    for e in emps:
        il = impacts.get(e.impact_level_id) if e.impact_level_id else None
        bundle[e.employee_id] = (e.full_name, il)
    return bundle


async def _ticket_linked_to_viewable_claim(
    ticket: TravelRequestTicket, viewer_user_id: int, db: AsyncSession
) -> bool:
    if not ticket.travel_request_id:
        return False
    trip_ids = (
        await db.execute(
            select(TravelTrip.id).where(TravelTrip.travel_request_id == ticket.travel_request_id)
        )
    ).scalars().all()
    if not trip_ids:
        return False
    from app.services.workflow_service import assert_user_can_view_claim_workflow

    for trip_id in trip_ids:
        claim_ids = (
            await db.execute(select(ClaimTrip.claim_id).where(ClaimTrip.trip_id == int(trip_id)))
        ).scalars().all()
        for cid in claim_ids:
            try:
                await assert_user_can_view_claim_workflow(int(cid), viewer_user_id, db)
                return True
            except HTTPException:
                continue
    return False


async def viewer_can_download_ticket(
    *,
    viewer_user_id: int,
    viewer_role: Role,
    ticket: TravelRequestTicket,
    db: AsyncSession,
) -> bool:
    """Owner, HRBP, reporting manager, or finance/payroll viewer of a linked claim."""
    req = (await db.execute(select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == ticket.travel_request_id))).scalar_one_or_none()
    if req is None:
        return False
    if req.employee_user_id == viewer_user_id or viewer_role == Role.HRBP_HR:
        return True

    from app.services.permission_config_service import get_effective_permission_matrix

    matrix = await get_effective_permission_matrix(db)
    allowed = matrix.get(viewer_role, set())
    if {"view_reports", "process_payments"} & allowed and await _ticket_linked_to_viewable_claim(
        ticket, viewer_user_id, db
    ):
        return True
    # The traveller's manager, whatever their role.
    return await _actor_is_reporting_manager_for(
        manager_user_id=viewer_user_id, subordinate_user_id=req.employee_user_id, db=db
    )




async def count_pending_travel_requests_for_desk(db: AsyncSession) -> int:
    """Cheap count (no employee/impact-level enrichment) for the Travel Desk nav badge."""
    result = await db.execute(
        select(func.count(TravelRequest.id)).where(
            TravelRequest.status.in_(
                [TravelRequestStatus.APPROVED.value, TravelRequestStatus.PARTIALLY_BOOKED.value]
            )
        )
    )
    return int(result.scalar_one())


async def list_pending_travel_requests_for_desk(db: AsyncSession) -> list[dict]:
    """Queue: APPROVED or PARTIALLY_BOOKED (some but not all legs ticketed) — stays actionable
    until every segment has a ticket. Manager approval happens before Travel Desk ever sees it.

    Default order surfaces PARTIALLY_BOOKED requests first (they're mid-booking and easiest to
    finish), then APPROVED ones — each group oldest-first."""
    status_priority = case(
        (TravelRequest.status == TravelRequestStatus.PARTIALLY_BOOKED.value, 0),
        else_=1,
    )
    rows = (
        await db.execute(
            select(TravelRequest)
            .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
            .where(TravelRequest.status.in_([TravelRequestStatus.APPROVED.value, TravelRequestStatus.PARTIALLY_BOOKED.value]))
            .order_by(status_priority, TravelRequest.requested_at.asc())
        )
    ).scalars().all()

    user_ids = {r.employee_user_id for r in rows}
    users_map = {}
    if user_ids:
        for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all():
            users_map[u.id] = u
    emp_ids = [u.employee_id for u in users_map.values() if u.employee_id]
    bundles = await _employee_impact_bundle([e for e in emp_ids if e], db)

    enriched: list[dict] = []
    for req in rows:
        u = users_map.get(req.employee_user_id)
        nm, impact = "", None
        if u and u.employee_id and u.employee_id in bundles:
            nm, impact = bundles[u.employee_id]
        lvl_code = _normalize_level(impact.level_code) if impact else "L5A"
        enriched.append(
            {
                "request": req,
                "employee_display_name": nm or (u.full_name if u else "") or "",
                "impact_level_code": lvl_code,
            }
        )
    return enriched


async def list_pending_travel_requests_for_approver(actor_user_id: int, db: AsyncSession) -> list[TravelRequest]:
    """Every PENDING travel request whose currently active approval stage this actor can act
    on — stage-aware (see init_travel_request_approval_chain / approve_travel_request_stage),
    so it correctly surfaces requests routed to a pooled role (HRBP, Finance, CEO, ...), not
    just ones where the actor is specifically the employee's reporting manager (or an active
    delegate of one). Replaces the old reporting-manager-only query, which silently returned
    nothing for any other stage role once the approval chain became admin-configurable.
    """
    from app.models.travel_request import TravelRequestApprovalStage
    from app.services.workflow_service import _user_matches_required_role

    actor = await db.get(User, actor_user_id)
    if actor is None:
        return []

    stmt = (
        select(TravelRequest, TravelRequestApprovalStage)
        .join(
            TravelRequestApprovalStage,
            and_(
                TravelRequestApprovalStage.travel_request_id == TravelRequest.id,
                TravelRequestApprovalStage.stage_number == TravelRequest.current_approval_stage,
            ),
        )
        .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
        .where(
            TravelRequest.status == TravelRequestStatus.PENDING.value,
            TravelRequestApprovalStage.status == "PENDING",
        )
        .order_by(TravelRequest.requested_at.desc())
    )
    candidates = (await db.execute(stmt)).all()

    rows: list[TravelRequest] = []
    passed_over: dict[int, list[str]] = {}
    for req, stage in candidates:
        subject_user = await db.get(User, req.employee_user_id)
        subject_employee_id = subject_user.employee_id if subject_user else None
        if await _user_matches_required_role(actor, stage.required_role, subject_employee_id, db):
            rows.append(req)
            # Earlier stages whose approver missed the SLA, so the request was passed on to here.
            passed_over[req.id] = list(
                (
                    await db.execute(
                        select(TravelRequestApprovalStage.stage_label)
                        .where(
                            TravelRequestApprovalStage.travel_request_id == req.id,
                            TravelRequestApprovalStage.status == "SLA_SKIPPED",
                            TravelRequestApprovalStage.stage_number < stage.stage_number,
                        )
                        .order_by(TravelRequestApprovalStage.stage_number)
                    )
                ).scalars().all()
            )

    user_ids = {r.employee_user_id for r in rows}
    users_map = {}
    if user_ids:
        for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all():
            users_map[u.id] = u
    emp_ids = [u.employee_id for u in users_map.values() if u.employee_id]
    
    from app.services.travel_request_service import _employee_impact_bundle
    bundles = await _employee_impact_bundle([e for e in emp_ids if e], db)

    enriched: list[dict] = []
    for req in rows:
        u = users_map.get(req.employee_user_id)
        nm, impact = "", None
        if u and u.employee_id and u.employee_id in bundles:
            nm, impact = bundles[u.employee_id]
        lvl_code = _normalize_level(impact.level_code) if impact else "L5A"
        enriched.append(
            {
                "request": req,
                "employee_display_name": nm or (u.full_name if u else "") or "",
                "impact_level_code": lvl_code,
                "sla_passed_over": passed_over.get(req.id, []),
            }
        )
    return enriched


def _primary_travel_date(req: TravelRequest) -> date | None:
    if req.trip_type == "MULTI_CITY" and req.legs:
        leg_dates = [leg.travel_date for leg in req.legs if leg.travel_date]
        return min(leg_dates) if leg_dates else None
    return req.travel_date


def _segments_for_request(req: TravelRequest) -> list[dict]:
    """Independently-ticketable legs of a request: 1 for ONE_WAY, 2 for ROUND_TRIP (onward +
    return — there are no persisted leg rows for round trips, so these are derived from the
    request's own from/to/travel_date/return_date), or one per TravelRequestLeg for MULTI_CITY."""
    if req.trip_type == TripType.MULTI_CITY.value and req.legs:
        return [
            {
                "seq": leg.leg_sequence,
                "label": f"Leg {leg.leg_sequence}: {leg.from_city} → {leg.to_city}",
                "mode": leg.travel_mode or req.travel_mode,
                "from_city": leg.from_city,
                "to_city": leg.to_city,
                "travel_date": leg.travel_date,
            }
            for leg in req.legs
        ]
    if req.trip_type == TripType.ROUND_TRIP.value and req.return_date:
        return [
            {
                "seq": 1,
                "label": f"Onward: {req.from_city} → {req.to_city}",
                "mode": req.travel_mode,
                "from_city": req.from_city,
                "to_city": req.to_city,
                "travel_date": req.travel_date,
            },
            {
                "seq": 2,
                "label": f"Return: {req.to_city} → {req.from_city}",
                "mode": req.travel_mode,
                "from_city": req.to_city,
                "to_city": req.from_city,
                "travel_date": req.return_date,
            },
        ]
    return [
        {
            "seq": 1,
            "label": f"{req.from_city} → {req.to_city}" if req.from_city else "Ticket",
            "mode": req.travel_mode,
            "from_city": req.from_city,
            "to_city": req.to_city,
            "travel_date": req.travel_date,
        }
    ]


async def ticket_details(ticket: TravelRequestTicket, db: AsyncSession) -> dict:
    """What the ticket preview shows beside the file: the trip leg the ticket was uploaded for
    (as booked), its booking details, and who uploaded it. Access is checked by the caller."""
    req = (
        await db.execute(
            select(TravelRequest)
            .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
            .where(TravelRequest.id == ticket.travel_request_id)
        )
    ).scalar_one_or_none()
    segment = None
    employee_name = None
    if req is not None:
        segment = next((s for s in _segments_for_request(req) if s["seq"] == ticket.leg_sequence), None)
        owner = await db.get(User, req.employee_user_id)
        employee_name = (owner.full_name or owner.email) if owner else None
    uploader = await db.get(User, ticket.uploaded_by_user_id)
    return {
        "id": ticket.id,
        "leg_sequence": ticket.leg_sequence,
        "original_filename": ticket.original_filename,
        "content_type": ticket.content_type,
        "file_size_bytes": ticket.file_size_bytes,
        "pnr_or_booking_ref": ticket.pnr_or_booking_ref,
        "ticket_amount": str(ticket.ticket_amount) if ticket.ticket_amount is not None else None,
        "ticket_travel_class": ticket.ticket_travel_class,
        "external_booking_source": ticket.external_booking_source,
        "notes_for_employee": ticket.notes_for_employee,
        "uploaded_at": ticket.uploaded_at,
        "uploaded_by_name": (uploader.full_name or uploader.email) if uploader else None,
        "request": (
            {
                "id": req.id,
                "reference": f"TR-{req.id:04d}",
                "employee_name": employee_name,
                "trip_type": req.trip_type,
                "travel_mode": req.travel_mode,
                "purpose": req.purpose,
                "segment_count": len(_segments_for_request(req)),
            }
            if req is not None
            else None
        ),
        "segment": (
            {
                "label": segment["label"],
                "mode": segment["mode"],
                "from_city": segment["from_city"],
                "to_city": segment["to_city"],
                "travel_date": segment["travel_date"],
            }
            if segment
            else None
        ),
    }


def build_segments_out(req: TravelRequest) -> list[dict]:
    """Segment descriptors merged with whichever ticket (if any) covers each one.

    Returns plain dicts (each with a raw `TravelRequestTicket | None` under "ticket") so the
    service layer stays schema-agnostic; callers convert to `TravelRequestSegmentOut` /
    `TravelRequestTicketAttachmentOut` themselves.
    """
    return [{**seg, "ticket": _ticket_for_leg(req, seg["seq"])} for seg in _segments_for_request(req)]


def desk_request_matches_text(
    req: TravelRequest, needle: str | None, *, employee_name: str | None, email: str | None
) -> bool:
    """The desk's 'All requests' search: a city on the request or any of its legs, the
    traveller's name or email. Multi-city requests keep their cities on the legs only."""
    if not needle:
        return True
    cities = [req.from_city, req.to_city]
    for leg in req.legs or []:
        cities += [leg.from_city, leg.to_city]
    return any(text and needle in text.lower() for text in (*cities, employee_name, email))


async def list_all_travel_requests_for_desk(
    *,
    db: AsyncSession,
    status_filter: str | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    impact_level: str | None = None,
    limit: int = 500,
) -> list[dict]:
    stmt = select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
    if status_filter:
        stmt = stmt.where(TravelRequest.status == status_filter)
    stmt = stmt.order_by(TravelRequest.requested_at.desc()).limit(limit)
    reqs = list((await db.execute(stmt)).scalars().all())

    user_ids = {r.employee_user_id for r in reqs}
    users_map: dict[int, User] = {}
    if user_ids:
        users_map = {
            u.id: u
            for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        }
    emp_ids = [u.employee_id for u in users_map.values() if u.employee_id]
    bundles = await _employee_impact_bundle([e for e in emp_ids if e], db)

    needle = q.strip().lower() if q and q.strip() else None
    wanted_level = impact_level.strip().upper() if impact_level and impact_level.strip() else None

    def matches_text(req: TravelRequest, u: User | None, employee_name: str) -> bool:
        return desk_request_matches_text(req, needle, employee_name=employee_name, email=u.email if u else None)

    out: list[dict] = []
    for req in reqs:
        u = users_map.get(req.employee_user_id)
        nm, impact = "", None
        if u and u.employee_id and u.employee_id in bundles:
            nm, impact = bundles[u.employee_id]
        display_name = nm or (u.full_name if u else "") or ""
        lvl_code = _normalize_level(impact.level_code) if impact else "L5A"

        if not matches_text(req, u, display_name):
            continue
        if wanted_level and lvl_code != wanted_level:
            continue

        travel_date = _primary_travel_date(req)
        if date_from and (travel_date is None or travel_date < date_from):
            continue
        if date_to and (travel_date is None or travel_date > date_to):
            continue

        out.append(
            {
                "request": req,
                "employee_display_name": display_name,
                "impact_level_code": lvl_code,
            }
        )
    return out


async def get_travel_request_for_viewer(
    request_id: int, viewer_user_id: int, viewer_role: Role, db: AsyncSession
) -> tuple[TravelRequest, TravelRequestTicket | None]:
    req = (await db.execute(select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == request_id))).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    if req.employee_user_id == viewer_user_id:
        return req, _latest_ticket(req)
    if viewer_role == Role.HRBP_HR:
        return req, _latest_ticket(req)
    # The traveller's manager, whatever their role.
    if await _actor_is_reporting_manager_for(
        manager_user_id=viewer_user_id, subordinate_user_id=req.employee_user_id, db=db
    ):
        return req, _latest_ticket(req)
    # The department head asked to approve this request may open it too.
    from app.models.travel_request import TravelRequestApprovalStage
    from app.services.workflow_service import DEPARTMENT_HEAD, is_department_head_for

    has_head_step = (
        await db.execute(
            select(TravelRequestApprovalStage.id).where(
                TravelRequestApprovalStage.travel_request_id == req.id,
                TravelRequestApprovalStage.required_role == DEPARTMENT_HEAD,
            )
        )
    ).scalars().first()
    if has_head_step:
        owner = await db.get(User, req.employee_user_id)
        if await is_department_head_for(viewer_user_id, owner.employee_id if owner else None, db):
            return req, _latest_ticket(req)
    raise HTTPException(status_code=403, detail="Not allowed to view this travel request")


async def _actor_is_reporting_manager_for(
    *, manager_user_id: int, subordinate_user_id: int, db: AsyncSession
) -> bool:
    mgr = await db.get(User, manager_user_id)
    sub_user = await db.get(User, subordinate_user_id)
    if mgr is None or sub_user is None or not mgr.employee_id or not sub_user.employee_id:
        return False
    sub_emp = await db.get(Employee, sub_user.employee_id)
    if sub_emp is None or not sub_emp.reporting_manager_id:
        return False
        
    if sub_emp.reporting_manager_id == mgr.employee_id:
        return True

    from app.services.delegation_service import is_delegation_enabled

    if not await is_delegation_enabled(db):
        return False

    now = now_ist()
    delegators_q = select(Delegation.delegator_id).where(
        Delegation.delegatee_id == manager_user_id,
        Delegation.is_active,
        Delegation.start_date <= now,
        Delegation.end_date >= now
    )
    delegator_user_ids = (await db.execute(delegators_q)).scalars().all()
    if delegator_user_ids:
        delegator_emp_ids = (await db.execute(select(User.employee_id).where(User.id.in_(delegator_user_ids)))).scalars().all()
        if sub_emp.reporting_manager_id in delegator_emp_ids:
            return True

    return False


async def approve_travel_request(
    request_id: int, actor_user_id: int, role: Role, db: AsyncSession, *, comment: str | None = None
) -> TravelRequest:
    """Approves whichever stage of the configured approval chain is currently active for this
    request — a single-stage chain (today's default) behaves identically to the old
    hardcoded "reporting manager approves" flow; a multi-stage chain just advances one step at
    a time instead of jumping straight to APPROVED. Authorization is enforced per-stage inside
    approve_travel_request_stage (via the stage's own required_role), not by this function —
    unlike the old assert_can_approve_or_reject, that correctly lets a non-reporting-manager
    role (e.g. HRBP) act on a stage actually routed to them.
    """
    from app.services.workflow_service import approve_travel_request_stage

    return await approve_travel_request_stage(request_id, actor_user_id, comment, db)


async def reject_travel_request(
    request_id: int, actor_user_id: int, role: Role, reason: str, db: AsyncSession
) -> TravelRequest:
    from app.services.workflow_service import reject_travel_request_stage

    return await reject_travel_request_stage(request_id, actor_user_id, reason, db)


async def cancel_travel_request(request_id: int, owner_user_id: int, db: AsyncSession) -> TravelRequest:
    req = (
        await db.execute(
            select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == request_id)
        )
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    if req.employee_user_id != owner_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if req.status not in (TravelRequestStatus.PENDING.value, TravelRequestStatus.PENDING_EXCEPTION.value):
        raise HTTPException(status_code=409, detail="Only PENDING requests can be cancelled")

    # Whoever's turn it was on a still-open exception: told it's been withdrawn (after commit).
    to_tell: list[tuple[int, str]] = []
    if req.status == TravelRequestStatus.PENDING_EXCEPTION.value:
        from app.models.claim_workflow import ExceptionApproval, ExceptionRequest, ExceptionRequestStatus
        from app.services.workflow_service import _exception_label, _user_ids_for_exception_role_for_travel

        pending_exceptions = (
            await db.execute(
                select(ExceptionRequest).where(
                    ExceptionRequest.travel_request_id == req.id,
                    ExceptionRequest.status == ExceptionRequestStatus.PENDING.value,
                )
            )
        ).scalars().all()
        now = now_ist()
        for exc in pending_exceptions:
            # Closed without a decision — not a rejection (the exception log lists it as Cancelled).
            exc.status = ExceptionRequestStatus.CANCELLED.value
            exc.decided_at = now
            exc.decision_comment = "Travel request cancelled by employee."
            approvals = (
                await db.execute(
                    select(ExceptionApproval).where(ExceptionApproval.exception_request_id == exc.id)
                )
            ).scalars().all()
            for a in approvals:
                if a.status == ExceptionRequestStatus.PENDING.value:
                    for uid in await _user_ids_for_exception_role_for_travel(req, a.required_role, db):
                        to_tell.append((uid, _exception_label(exc)))
                if a.status in (ExceptionRequestStatus.PENDING.value, "AWAITING"):
                    a.status = ExceptionRequestStatus.CANCELLED.value

    req.status = TravelRequestStatus.CANCELLED.value
    await db.commit()
    await db.refresh(req)

    if to_tell:
        try:
            from app.models.claim_workflow import NotificationCategory
            from app.services.notification_service import create_notification

            for uid, label in dict.fromkeys(to_tell):
                await create_notification(
                    user_id=uid,
                    title=f"Exception Cancelled: TR-{req.id:04d}",
                    body=f"The {label} exception for TR-{req.id:04d} no longer needs your review — "
                    "the traveller cancelled the travel request.",
                    link="/hr/exceptions",
                    category=NotificationCategory.EXCEPTION.value,
                    db=db,
                )
            await db.commit()
        except Exception as e:  # noqa: BLE001 — a notification failure never undoes the cancellation
            logger.exception("Failed to tell approvers TR-%s was cancelled: %s", req.id, e)
            await db.rollback()
        await db.refresh(req)
    return req


async def upload_ticket_for_request(
    *,
    request_id: int,
    uploader_user_id: int,
    file: UploadFile,
    payload: dict,
    leg_sequence: int = 1,
    db: AsyncSession,
) -> tuple[TravelRequest, TravelRequestTicket, TravelTrip]:
    """HRBP uploads a ticket PDF/image for one segment of the request (the whole trip for
    ONE_WAY, or one of the onward/return/multi-city legs). The request becomes PARTIALLY_BOOKED
    once at least one segment is ticketed, and BOOKED once every segment has one."""
    req = (
        await db.execute(
            select(TravelRequest).options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets)).where(TravelRequest.id == request_id)
        )
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")

    segments = _segments_for_request(req)
    segment = next((s for s in segments if s["seq"] == leg_sequence), None)
    # A leg that already has a ticket gets this one instead (a corrected or re-issued ticket):
    # the same ticket row and trip are updated, so each leg keeps one ticket and one trip.
    replacing = _ticket_for_leg(req, leg_sequence)
    allowed_statuses = (TravelRequestStatus.APPROVED.value, TravelRequestStatus.PARTIALLY_BOOKED.value)
    if replacing is not None:
        allowed_statuses += (TravelRequestStatus.BOOKED.value,)
    if req.status not in allowed_statuses:
        raise HTTPException(status_code=409, detail="Travel request must be APPROVED before ticket upload")
    if segment is None:
        raise HTTPException(status_code=422, detail=f"leg_sequence {leg_sequence} is not a valid segment for this request")
    ticket_amount = parse_ticket_amount(payload.get("ticket_amount"))
    # Same required fields as the ticket form (Travel Desk and the agent's page): a ticket without
    # its booking reference or who it's with can't be checked or used by the traveller.
    missing = [
        name
        for key, name in (("pnr_or_booking_ref", "PNR / booking reference"), ("provider", "provider"))
        if not str(payload.get(key) or "").strip()
    ]
    if missing:
        raise HTTPException(status_code=422, detail=f"Fill in the {' and '.join(missing)} before saving the ticket")

    owner = await db.get(User, req.employee_user_id)
    if owner is None or not owner.employee_id:
        raise HTTPException(status_code=422, detail="Request owner employee record incomplete")

    content = await file.read()
    digest, suffix = _validate_ticket_file(file.filename or "ticket.pdf", file.content_type or "application/octet-stream", content)

    storage_root = Path(settings.travel_ticket_storage_dir) / str(request_id)
    storage_root.mkdir(parents=True, exist_ok=True)
    path = storage_root / f"{digest}{suffix}"
    path.write_bytes(content)

    pnr = payload.get("pnr_or_booking_ref")
    notes_emp = payload.get("notes_for_employee")

    mode_str = segment["mode"] or req.travel_mode
    try:
        mode_enum = TravelMode[mode_str]
    except KeyError as exc:
        raise HTTPException(status_code=500, detail="Invalid travel_mode on request") from exc

    reference_id = f"DESK-{request_id}-{leg_sequence}-{uuid4().hex[:8].upper()}"
    provider = str(payload.get("provider") or "Travel Desk")

    meta = {"travel_request_id": request_id, "leg_sequence": leg_sequence, "source": "travel_desk_upload", "parsed": payload}

    boarding = str(path).replace("\\", "/") if mode_enum == TravelMode.FLIGHT else None

    trip = None
    if replacing is not None and replacing.travel_trip_id is not None:
        trip = await db.get(TravelTrip, replacing.travel_trip_id)
    was_booked = req.status == TravelRequestStatus.BOOKED.value
    if trip is None:
        trip = TravelTrip(
            employee_user_id=req.employee_user_id,
            travel_request_id=request_id,
            booked_by_travel_desk=True,
            assigned_to_employee_id=owner.employee_id,
            reference_id=str(reference_id)[:64],
            travel_class=None,
            amount=Decimal("0.00"),
            gst_invoice_requested=False,
        )
        db.add(trip)
    # (Kept on a replaced trip: its id and reference, so claims already linked to it still are.)
    trip.mode = mode_enum
    trip.from_city = segment["from_city"]
    trip.to_city = segment["to_city"]
    trip.travel_date = segment["travel_date"]
    trip.provider = provider[:64]
    trip.booking_metadata = meta
    trip.status = TripStatus.CONFIRMED
    trip.boarding_pass_path = boarding
    # The fare the desk confirmed: travel spend reports add up trip amounts.
    trip.amount = ticket_amount
    await db.flush()

    ticket_row = replacing or TravelRequestTicket(travel_request_id=request_id, leg_sequence=leg_sequence)
    ticket_row.travel_trip_id = trip.id
    ticket_row.uploaded_by_user_id = uploader_user_id
    ticket_row.file_sha256 = digest
    ticket_row.original_filename = (file.filename or "ticket.bin")[:255]
    ticket_row.storage_path = str(path)
    ticket_row.content_type = (file.content_type or "application/octet-stream")[:128]
    ticket_row.file_size_bytes = len(content)
    ticket_row.pnr_or_booking_ref = pnr.strip()[:128] if isinstance(pnr, str) and pnr.strip() else None
    ticket_row.ticket_amount = ticket_amount
    ticket_row.notes_for_employee = notes_emp if isinstance(notes_emp, str) else None
    if replacing is not None:
        ticket_row.uploaded_at = now_ist()
    else:
        db.add(ticket_row)

    req.status, legs_pending = _compute_booking_status(req, newly_ticketed_seq=leg_sequence)
    fully_booked = req.status == TravelRequestStatus.BOOKED.value

    # Create notification for employee
    try:
        from app.services.notification_service import create_notification
        if replacing is not None:
            title = "Ticket Updated"
            body = f"The Travel Desk replaced your ticket for {segment['label']}."
        elif fully_booked:
            title = "Travel Booked"
            body = (
                f"Your ticket for {req.from_city} -> {req.to_city} has been booked and uploaded by the Travel Desk."
                if len(segments) == 1
                else "All legs of your trip have been ticketed and uploaded by the Travel Desk."
            )
        else:
            title = "Travel Partially Booked"
            body = f"{segment['label']} has been ticketed. {legs_pending} leg(s) still pending."
        await create_notification(
            user_id=req.employee_user_id,
            title=title,
            body=body,
            link="/travel-requests",
            category="CLAIM_UPDATE",
            db=db
        )
    except Exception as e:
        print(f"Failed to create notification: {e}")

    await db.commit()
    await db.refresh(req)
    await db.refresh(ticket_row)
    await db.refresh(trip)
    if fully_booked and not was_booked:
        await _notify_stakeholders_once_booked(req, db)
    return req, ticket_row, trip


def _city_words(name: str | None) -> set[str]:
    """Words in a city/station name, lower-case, for loose matching ("NEW DELHI (NDLS)" ~ "Delhi")."""
    import re

    return {w for w in re.findall(r"[a-z]+", (name or "").lower()) if len(w) >= 3}


def _same_city(a: str | None, b: str | None) -> bool | None:
    """True/False when both are known, None when either is missing."""
    wa, wb = _city_words(a), _city_words(b)
    if not wa or not wb:
        return None
    return bool(wa & wb)


def ticket_leg_mismatch(read: dict, segment: dict) -> str | None:
    """A plain-words warning when a ticket's route or date doesn't look like this leg's, else None."""
    from_ok = _same_city(read.get("from_city"), segment.get("from_city"))
    to_ok = _same_city(read.get("to_city"), segment.get("to_city"))
    leg_date = segment.get("travel_date")
    leg_date_text = leg_date.isoformat() if leg_date else ""
    date_ok = None if not read.get("travel_date") or not leg_date_text else read["travel_date"] == leg_date_text
    if from_ok is not False and to_ok is not False and date_ok is not False:
        return None

    def when(value: str) -> str:
        try:
            return date.fromisoformat(value).strftime("%d %b").lstrip("0")
        except ValueError:
            return value

    says = " → ".join(x.title() if x.isupper() else x for x in (read.get("from_city"), read.get("to_city")) if x)
    says = says or "another route"
    if read.get("travel_date"):
        says += f" on {when(read['travel_date'])}"
    leg = f"{segment.get('from_city')} → {segment.get('to_city')}"
    if leg_date_text:
        leg += f" on {when(leg_date_text)}"
    return f"This ticket may be for a different leg. It says {says}, but this leg is {leg}."


async def read_ticket_for_leg(*, request_id: int, leg_sequence: int, file: UploadFile, db: AsyncSession) -> dict:
    """Reads a ticket the Travel Desk is about to upload, so its form can fill in the PNR and
    provider and warn if the ticket looks like it's for another leg. Stores nothing."""
    import asyncio

    from app.services.ticket_reader import read_ticket_sync

    req = (
        await db.execute(
            select(TravelRequest).options(selectinload(TravelRequest.legs)).where(TravelRequest.id == request_id)
        )
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    segment = next((s for s in _segments_for_request(req) if s["seq"] == leg_sequence), None)
    if segment is None:
        raise HTTPException(status_code=422, detail=f"Leg {leg_sequence} isn't part of this request")

    content = await file.read()
    content_type = file.content_type or "application/octet-stream"
    _validate_ticket_file(file.filename or "ticket.pdf", content_type, content)
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Ticket reading isn't set up — type the details in")
    try:
        read = await asyncio.to_thread(
            read_ticket_sync,
            content,
            content_type,
            api_key=settings.gemini_api_key,
            models=[settings.gemini_invoice_model_primary, settings.gemini_invoice_model_fallback],
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail="Couldn't read this ticket — type it in") from exc
    return {**read, "mismatch": ticket_leg_mismatch(read, segment)}


_SUPPORTING_DOC_STATUSES = (
    TravelRequestStatus.APPROVED.value,
    TravelRequestStatus.PARTIALLY_BOOKED.value,
    TravelRequestStatus.BOOKED.value,
)


async def upload_supporting_document(
    *,
    request_id: int,
    uploader_user_id: int,
    file: UploadFile,
    description: str | None,
    db: AsyncSession,
) -> tuple[TravelRequestSupportingDocument, str]:
    """Travel Desk attaches an optional additional document (hotel voucher, itinerary, ...) to an
    approved request. It doesn't change the request's status. Returns (document, status)."""
    req = (
        await db.execute(
            select(TravelRequest)
            .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
            .where(TravelRequest.id == request_id)
        )
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    if req.status not in _SUPPORTING_DOC_STATUSES:
        raise HTTPException(status_code=409, detail="Travel request must be APPROVED before documents can be uploaded")

    content = await file.read()
    digest, suffix = _validate_ticket_file(
        file.filename or "document.pdf", file.content_type or "application/octet-stream", content, kind="Document"
    )

    storage_root = Path(settings.travel_ticket_storage_dir) / str(request_id) / "supporting"
    storage_root.mkdir(parents=True, exist_ok=True)
    path = storage_root / f"{digest}{suffix}"
    path.write_bytes(content)

    note = description.strip()[:255] if isinstance(description, str) and description.strip() else None
    doc = TravelRequestSupportingDocument(
        travel_request_id=request_id,
        uploaded_by_user_id=uploader_user_id,
        file_sha256=digest,
        original_filename=(file.filename or "document.bin")[:255],
        storage_path=str(path),
        content_type=(file.content_type or "application/octet-stream")[:128],
        file_size_bytes=len(content),
        description=note,
    )
    db.add(doc)

    try:
        from app.services.notification_service import create_notification

        await create_notification(
            user_id=req.employee_user_id,
            title="Travel Desk Added a Document",
            body=f"The Travel Desk added “{note}” to your travel request."
            if note
            else "The Travel Desk added a document to your travel request.",
            link="/travel-requests",
            category="CLAIM_UPDATE",
            db=db,
        )
    except Exception as e:
        print(f"Failed to create notification: {e}")

    await db.commit()
    await db.refresh(doc)
    return doc, req.status


async def assert_can_download_supporting_document(
    viewer_user_id: int, viewer_role: Role, doc: TravelRequestSupportingDocument, db: AsyncSession
) -> None:
    """Owner, HRBP, anyone with Travel Desk access, or the owner's reporting manager."""
    req = await db.get(TravelRequest, doc.travel_request_id)
    if req is not None:
        if req.employee_user_id == viewer_user_id or viewer_role == Role.HRBP_HR:
            return

        from app.services.permission_config_service import get_effective_permission_matrix

        matrix = await get_effective_permission_matrix(db)
        if "view_travel_desk" in matrix.get(viewer_role, set()):
            return
        # The traveller's manager, whatever their role.
        if await _actor_is_reporting_manager_for(
            manager_user_id=viewer_user_id, subordinate_user_id=req.employee_user_id, db=db
        ):
            return
    raise HTTPException(status_code=403, detail="Not allowed to download this document")


async def assert_can_download_ticket(
    viewer_user_id: int, viewer_role: Role, ticket: TravelRequestTicket, db: AsyncSession
) -> None:
    ok = await viewer_can_download_ticket(
        viewer_user_id=viewer_user_id, viewer_role=viewer_role, ticket=ticket, db=db
    )
    if not ok:
        raise HTTPException(status_code=403, detail="Not allowed to download this ticket")


# --- Travel agent "Send to agent" booking link ------------------------------------------------
#
# A single-use, unauthenticated link the Travel Desk emails to the company's one configured travel
# agent (CompanyProfile.travel_agent_email) so they can upload tickets themselves, without a login
# of their own. Every public endpoint (app/api/v1/public_travel_booking.py) resolves its travel
# request SOLELY through resolve_agent_booking_request below — never by trusting a request id from
# the client — and that's the single gate that also rejects a stale/superseded token or a request
# that's no longer bookable, with the same generic "no longer valid" shape either way.

_AGENT_BOOKABLE_STATUSES = (TravelRequestStatus.APPROVED.value, TravelRequestStatus.PARTIALLY_BOOKED.value)


async def is_travel_agent_email_configured(db: AsyncSession) -> bool:
    """Whether Admin -> Company Profile has a travel agent email set — the Travel Desk uses this
    (not the admin-only company-profile read, which view_travel_desk alone may not be allowed to
    call) to decide whether "Send to agent" is enabled."""
    from app.models.expense_category import CompanyProfile

    profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    return bool(profile and (profile.travel_agent_email or "").strip())


def _short_leg_label(label: str) -> str:
    """'Onward: Delhi NCR → Mumbai' -> 'Onward' (the email shows the route on its own line)."""
    return label.split(":", 1)[0].strip() if ":" in label else "Journey"


# What the agent sees of the traveller's chosen service — enough to book it, nothing else.
_AGENT_PICK_OPTION_FIELDS = (
    "name", "operator", "number", "depart_time", "arrive_time",
    "from_station", "to_station", "duration", "travel_class", "fare_inr",
)


def agent_leg_pick(req: TravelRequest, seq: int) -> dict | None:
    """The traveller's choice for one leg (a searched option, their own description, or the kind
    of bus) and when they want to leave, trimmed to what the travel agent needs to book it."""
    pick = next((p for p in (req.leg_picks or []) if isinstance(p, dict) and p.get("seq") == seq), None)
    if not pick:
        return None
    option = pick.get("option") if isinstance(pick.get("option"), dict) else None
    return {
        "seq": seq,
        "choice": pick.get("choice"),
        "note": pick.get("note"),
        "time_windows": clean_time_windows(pick.get("time_windows")),
        "bus_types": clean_bus_types(pick.get("bus_types")),
        "searched_at": pick.get("searched_at"),
        "option": {k: option[k] for k in _AGENT_PICK_OPTION_FIELDS if option.get(k) is not None} if option else None,
    }


async def send_travel_request_to_agent(
    *, request_id: int, sent_by_user_id: int, db: AsyncSession
) -> TravelRequest:
    """The Travel Desk's "Resend to agent" (or "Send to agent" when the automatic send on approval
    couldn't happen): issues a fresh link — see issue_agent_booking_link. Requires the request to
    be APPROVED/PARTIALLY_BOOKED and a travel agent email to already be configured."""
    req = (
        await db.execute(
            select(TravelRequest).options(selectinload(TravelRequest.legs)).where(TravelRequest.id == request_id)
        )
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    if req.status not in _AGENT_BOOKABLE_STATUSES:
        raise HTTPException(
            status_code=409, detail="Only approved or partially booked requests can be sent to the travel agent"
        )
    if not await issue_agent_booking_link(req, sent_by_user_id=sent_by_user_id, db=db):
        raise HTTPException(status_code=422, detail="Set a travel agent email in Company Profile first")

    await db.commit()
    # Re-read with everything the response is built from: after the commit the request's
    # relationships are expired, and lazy-loading them while building the response fails.
    return (
        await db.execute(
            select(TravelRequest)
            .options(
                selectinload(TravelRequest.legs),
                selectinload(TravelRequest.tickets),
                selectinload(TravelRequest.supporting_documents),
            )
            .where(TravelRequest.id == req.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def issue_agent_booking_link(req: TravelRequest, *, sent_by_user_id: int, db: AsyncSession) -> bool:
    """Issues a fresh agent_token for `req` (overwriting any previous one — see the model's
    docstring) and emails the configured travel agent a /book/{token} link. Doesn't commit.
    Returns False, changing nothing, when no travel agent email is configured. Used both when a
    request is fully approved (it goes to the agent automatically) and by the desk's resend.
    `req.legs` must already be loaded."""
    from app.models.expense_category import CompanyProfile
    from app.services.audit_service import log_event
    from app.services.notification_service import send_email_async

    profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    agent_email = (profile.travel_agent_email or "").strip() if profile else ""
    if not agent_email:
        return False

    had_token_before = req.agent_token is not None
    token = secrets.token_urlsafe(32)
    req.agent_token = token
    req.agent_sent_at = now_ist()
    req.agent_sent_by_user_id = sent_by_user_id
    await db.flush()

    from app.services.agent_booking_email import build_agent_booking_email

    owner = await db.get(User, req.employee_user_id)
    employee_name = (owner.full_name or owner.email) if owner else "An employee"
    entitlement = await travel_entitlement(req.employee_user_id, db)
    legs = [
        {
            "label": _short_leg_label(seg["label"]),
            "mode": seg["mode"] or req.travel_mode,
            "from_city": seg["from_city"],
            "to_city": seg["to_city"],
            "travel_date": seg["travel_date"],
            "pick": agent_leg_pick(req, seg["seq"]),
        }
        for seg in _segments_for_request(req)
    ]
    subject, body, html = build_agent_booking_email(
        company_name=(profile.company_name or "").strip() or "Your client",
        reference=f"TR-{req.id:04d}",
        traveller=employee_name,
        trip_type=req.trip_type,
        legs=legs,
        eligibility=entitlement_note_text(entitlement),
        notes=req.notes,
        link=f"{settings.app_url.rstrip('/')}/book/{token}",
    )
    try:
        await send_email_async(to_email=agent_email, subject=f"[Travora] {subject}", body_text=body, body_html=html)
    except Exception as e:  # noqa: BLE001 — the token is already saved; a mail failure shouldn't undo it
        logger.exception("Failed to email travel agent for TR-%s: %s", req.id, e)

    await log_event(
        entity_type="travel_request",
        entity_id=str(req.id),
        action="travel_request_sent_to_agent",
        actor_id=sent_by_user_id,
        old={"agent_link_sent_before": had_token_before},
        new={"agent_link_sent_before": True, "agent_email": agent_email},
        db=db,
    )
    return True


async def resolve_agent_booking_request(token: str, db: AsyncSession) -> TravelRequest:
    """The single gate every public /book/{token} endpoint goes through: resolves a token to its
    travel request, loaded with legs/tickets. Raises a plain, generic 404 — same shape whether the
    token is unknown, was superseded by a resend (agent_token is overwritten, not appended, so a
    stale token simply matches no row), or the request is no longer bookable (already fully
    BOOKED, cancelled, or rejected) — so the response never reveals which case it is."""
    row = None
    if token and token.strip():
        row = (
            await db.execute(
                select(TravelRequest)
                .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
                .where(TravelRequest.agent_token == token.strip())
            )
        ).scalar_one_or_none()
    if row is None or row.status not in _AGENT_BOOKABLE_STATUSES:
        raise HTTPException(status_code=404, detail="This link is no longer valid")
    return row


async def agent_booking_summary(token: str, db: AsyncSession) -> dict:
    """Exactly what the agent's public page may show: the route/dates/notes for each leg, which
    legs are already ticketed, and the traveller's entitlement — nothing else (no employee id, no
    other requests, no claims or pay data). Reuses travel_entitlement/entitlement_note_text, the
    same policy-in-effect helpers the Travel Desk's own detail panel is built from."""
    req = await resolve_agent_booking_request(token, db)
    owner = await db.get(User, req.employee_user_id)
    employee_name = (owner.full_name or owner.email) if owner else "Traveller"
    entitlement = await travel_entitlement(req.employee_user_id, db)
    segments = build_segments_out(req)
    return {
        "reference": f"TR-{req.id:04d}",
        "employee_name": employee_name,
        "trip_type": req.trip_type,
        "notes": req.notes,
        "impact_level": entitlement["impact_level"],
        "entitlement_text": entitlement_note_text(entitlement),
        "segments": [
            {
                "seq": s["seq"],
                "label": s["label"],
                "mode": s["mode"],
                "from_city": s["from_city"],
                "to_city": s["to_city"],
                "travel_date": s["travel_date"],
                "ticketed": s["ticket"] is not None,
                "pick": agent_leg_pick(req, s["seq"]),
            }
            for s in segments
        ],
    }


async def read_ticket_via_agent(*, token: str, leg_sequence: int, file: UploadFile, db: AsyncSession) -> dict:
    """Same as read_ticket_for_leg, reached through the agent's token instead of an authenticated
    request id — see resolve_agent_booking_request for why the request id is never taken from the
    caller here."""
    req = await resolve_agent_booking_request(token, db)
    return await read_ticket_for_leg(request_id=req.id, leg_sequence=leg_sequence, file=file, db=db)


async def upload_ticket_via_agent(
    *, token: str, file: UploadFile, payload: dict, leg_sequence: int, db: AsyncSession
) -> tuple[TravelRequest, TravelRequestTicket, TravelTrip]:
    """Same upload_ticket_for_request the Travel Desk itself uses, reached through the agent's
    token. Attributed to the HRBP who sent the link (there's no account for the agent) and marked
    external_booking_source="agent" so a desk-booked ticket can later be told apart from one the
    agent booked. Notifies that HRBP afterwards, same pattern as other travel notifications."""
    req = await resolve_agent_booking_request(token, db)
    sender_id = req.agent_sent_by_user_id
    if sender_id is None:
        # Shouldn't happen (agent_token is only ever set alongside agent_sent_by_user_id), but
        # never attribute an agent upload to nobody.
        raise HTTPException(status_code=404, detail="This link is no longer valid")

    updated_req, ticket, trip = await upload_ticket_for_request(
        request_id=req.id, uploader_user_id=sender_id, file=file, payload=payload, leg_sequence=leg_sequence, db=db
    )
    ticket.external_booking_source = "agent"
    await db.commit()
    await db.refresh(ticket)

    try:
        from app.services.notification_service import create_notification

        segment = next((s for s in _segments_for_request(updated_req) if s["seq"] == leg_sequence), None)
        leg_label = segment["label"] if segment else f"leg {leg_sequence}"
        await create_notification(
            user_id=sender_id,
            title=f"Agent booked {leg_label} on TR-{updated_req.id:04d}",
            body=f"The travel agent uploaded a ticket for {leg_label} on TR-{updated_req.id:04d}.",
            link="/travel-desk",
            category="CLAIM_UPDATE",
            db=db,
        )
        await db.commit()
    except Exception as e:  # noqa: BLE001 — a notification failure must never undo the upload
        logger.exception("Failed to notify HRBP %s of agent booking on TR-%s: %s", sender_id, updated_req.id, e)

    return updated_req, ticket, trip


def read_ticket_bytes(ticket: TravelRequestTicket) -> tuple[bytes, str]:
    path = Path(ticket.storage_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Ticket file missing on server")
    return path.read_bytes(), ticket.content_type


async def list_trips_for_merged_employee_scope(user_id: int, db: AsyncSession) -> list[TravelTrip]:
    """Merged 'my trips': own employee_user_id trips OR desk-booked assigned to user's employee id."""
    user = await db.get(User, user_id)
    pred = TravelTrip.employee_user_id == user_id
    if user and user.employee_id:
        pred = or_(
            pred,
            and_(
                TravelTrip.booked_by_travel_desk.is_(True),
                TravelTrip.assigned_to_employee_id == user.employee_id,
            ),
        )
    stmt = (
        select(TravelTrip).where(pred).order_by(TravelTrip.travel_date.desc(), TravelTrip.created_at.desc())
    )
    rows = list((await db.execute(stmt)).scalars().all())
    return one_trip_per_desk_leg(rows)


def one_trip_per_desk_leg(rows: Sequence[TravelTrip]) -> list[TravelTrip]:
    """Each Travel Desk-booked leg once. A second ticket for a leg now replaces the first (same
    trip), but uploads from before that left two trips for one leg: the newest is kept (`rows`
    come newest first within a date)."""
    seen: set[tuple[int, int]] = set()
    out: list[TravelTrip] = []
    for trip in rows:
        meta = trip.booking_metadata if isinstance(trip.booking_metadata, dict) else {}
        if trip.booked_by_travel_desk and trip.travel_request_id and meta.get("leg_sequence") is not None:
            key = (int(trip.travel_request_id), int(meta["leg_sequence"]))
            if key in seen:
                continue
            seen.add(key)
        out.append(trip)
    return out


async def desk_ticket_ids_for_trips(rows: Sequence[TravelTrip], db: AsyncSession) -> dict[int, int | None]:
    """trip_id -> travel_request_ticket id for preview URLs."""
    if not rows:
        return {}
    req_ids = {t.travel_request_id for t in rows if t.travel_request_id}
    out_map: dict[int, int | None] = dict.fromkeys([t.id for t in rows], None)
    if not req_ids:
        return out_map

    tic_rows = (
        await db.execute(
            select(TravelRequestTicket).where(
                TravelRequestTicket.travel_request_id.in_(req_ids)
            )
        )
    ).scalars().all()
    # A request can now have several trips (one per ticketed leg — round trip onward/return,
    # or multiple multi-city legs), each with its own ticket, so match by travel_trip_id first.
    # Only fall back to "latest ticket for the request" when a trip has no direct ticket link
    # (legacy rows from before per-trip linkage, or trips booked outside the desk-upload flow).
    by_trip_id: dict[int, TravelRequestTicket] = {}
    by_rid: dict[int, TravelRequestTicket] = {}
    for tr in tic_rows:
        if tr.travel_trip_id is not None:
            by_trip_id[tr.travel_trip_id] = tr
        prev = by_rid.get(tr.travel_request_id)
        if prev is None or tr.uploaded_at > prev.uploaded_at:
            by_rid[tr.travel_request_id] = tr

    for t in rows:
        cand = by_trip_id.get(t.id)
        if cand is None and t.travel_request_id and t.travel_request_id in by_rid:
            cand = by_rid[t.travel_request_id]
        out_map[t.id] = cand.id if cand else None
    return out_map


async def list_team_travel_calendar(manager_user_id: int, db: AsyncSession) -> list[dict]:
    """List upcoming confirmed trips for subordinates of the given manager."""
    mgr = await db.get(User, manager_user_id)
    if not mgr or not mgr.employee_id:
        return []
        
    sub_stmt = select(Employee).where(Employee.reporting_manager_id == mgr.employee_id)
    subs = (await db.execute(sub_stmt)).scalars().all()
    if not subs:
        return []
    
    sub_emp_ids = [s.employee_id for s in subs]
    sub_names_map = {s.employee_id: s.full_name for s in subs}
    
    user_stmt = select(User.id, User.employee_id).where(User.employee_id.in_(sub_emp_ids))
    sub_user_map = {row[0]: row[1] for row in (await db.execute(user_stmt)).all()}
    
    if not sub_user_map:
        return []
        
    # Get trips for these users
    trip_stmt = (
        select(TravelTrip)
        .where(
            and_(
                or_(
                    TravelTrip.employee_user_id.in_(sub_user_map.keys()),
                    TravelTrip.assigned_to_employee_id.in_(sub_emp_ids)
                ),
                TravelTrip.status == TripStatus.CONFIRMED,
                TravelTrip.travel_date >= _today_ist()
            )
        )
        .order_by(asc(TravelTrip.travel_date))
        .limit(100)
    )
    trips = (await db.execute(trip_stmt)).scalars().all()
    
    out = []
    for t in trips:
        emp_id = t.assigned_to_employee_id or sub_user_map.get(t.employee_user_id)
        out.append({
            "id": t.id,
            "employee_name": sub_names_map.get(emp_id, "Unknown"),
            "travel_date": t.travel_date.isoformat() if t.travel_date else None,
            "mode": t.mode.value,
            "route": f"{t.from_city} -> {t.to_city}",
            "reference": t.reference_id,
        })
    return out
