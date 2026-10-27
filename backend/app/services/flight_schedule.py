"""Flights from one city to another on a date, from airline schedules (the AeroDataBox API on
RapidAPI: an airport's departures, "FIDS", for a local time range of up to 12 hours). Used by
travel_request_service.search_travel_options instead of a Gemini web search whenever RAPIDAPI_KEY
is set, because a schedule is complete and exact where a web search isn't. No fares: schedules
have none.

One request lists every departure from the airport in that half-day (all destinations), so it's
saved and reused for any route from that airport and date. The reply carries codeshares (the same
plane under other airlines' numbers), cargo, charter and cancelled flights: only passenger flights
under their operating airline's number are kept.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 25

# A day is searched in two halves (the API allows 12 hours at a time); each time window is in one.
HALVES = {"AM": ("00:00", "11:59"), "PM": ("12:00", "23:59")}
HALF_OF_WINDOW = {"NIGHT": "AM", "MORNING": "AM", "AFTERNOON": "PM", "EVENING": "PM"}

# City names people type (lower case) → (airport searched for departures, airports counted as arriving
# in that city).
_AIRPORTS: dict[str, tuple[str, tuple[str, ...]]] = {}


def _city(names: list[str], origin: str, *others: str) -> None:
    for name in names:
        _AIRPORTS[name] = (origin, (origin, *others))


_city(["delhi", "new delhi", "delhi ncr", "ncr", "gurgaon", "gurugram", "noida", "ghaziabad", "faridabad"], "DEL")
_city(["mumbai", "bombay", "navi mumbai", "thane"], "BOM", "NMI")
_city(["bengaluru", "bangalore"], "BLR")
_city(["chennai", "madras"], "MAA")
_city(["kolkata", "calcutta", "howrah"], "CCU")
_city(["hyderabad", "secunderabad"], "HYD")
_city(["pune"], "PNQ")
_city(["ahmedabad"], "AMD")
_city(["jaipur"], "JAI")
_city(["lucknow"], "LKO")
_city(["chandigarh"], "IXC")
_city(["kochi", "cochin", "ernakulam"], "COK")
_city(["coimbatore"], "CJB")
_city(["indore"], "IDR")
_city(["bhopal"], "BHO")
_city(["patna"], "PAT")
_city(["varanasi", "banaras"], "VNS")
_city(["agra"], "AGR")
_city(["nagpur"], "NAG")
_city(["surat"], "STV")
_city(["vadodara", "baroda"], "BDQ")
_city(["amritsar"], "ATQ")
_city(["dehradun"], "DED")
_city(["bhubaneswar"], "BBI")
_city(["guwahati"], "GAU")
_city(["visakhapatnam", "vizag"], "VTZ")
_city(["vijayawada"], "VGA")
_city(["thiruvananthapuram", "trivandrum"], "TRV")
_city(["mysuru", "mysore"], "MYQ")
_city(["mangaluru", "mangalore"], "IXE")
_city(["madurai"], "IXM")
_city(["goa", "panaji", "madgaon", "margao"], "GOI", "GOX")
_city(["raipur"], "RPR")
_city(["ranchi"], "IXR")
_city(["jodhpur"], "JDH")
_city(["udaipur"], "UDR")
_city(["jammu"], "IXJ")
_city(["srinagar"], "SXR")
_city(["leh"], "IXL")
_city(["prayagraj", "allahabad"], "IXD")
_city(["gorakhpur"], "GOP")
_city(["rajkot"], "HSR")
_city(["kozhikode", "calicut"], "CCJ")
_city(["tiruchirappalli", "trichy"], "TRZ")
_city(["bagdogra", "siliguri"], "IXB")
_city(["port blair"], "IXZ")
_city(["moscow"], "SVO", "DME", "VKO")


class FlightSearchError(Exception):
    """A failed schedule search. `pause` means asking again soon won't help (the month's requests
    are used up, or the key isn't accepted)."""

    def __init__(self, message: str, *, pause: bool = False):
        super().__init__(message)
        self.pause = pause


def _lookup(city: str) -> tuple[str, tuple[str, ...]] | None:
    text = re.sub(r"\s+", " ", (city or "").strip())
    typed = re.search(r"\(([A-Za-z]{3})\)\s*$", text)  # "Mumbai (BOM)"
    if typed:
        code = typed.group(1).upper()
        return code, (code,)
    key = text.lower()
    if key in _AIRPORTS:
        return _AIRPORTS[key]
    for known in sorted(_AIRPORTS, key=len, reverse=True):  # "Delhi Airport", "Mumbai T2"
        if key.startswith(f"{known} "):
            return _AIRPORTS[known]
    if re.fullmatch(r"[A-Z]{3}", text):  # an airport code typed on its own
        return text, (text,)
    return None


def origin_airport(city: str) -> str | None:
    found = _lookup(city)
    return found[0] if found else None


def destination_airports(city: str) -> tuple[str, ...]:
    found = _lookup(city)
    return found[1] if found else ()


async def fetch_departures(airport: str, day: date, half: str, *, api_key: str, host: str) -> dict:
    """The airport's departures in that half of the day (local time). Raises FlightSearchError."""
    first, last = HALVES[half]
    url = f"https://{host}/flights/airports/iata/{airport}/{day.isoformat()}T{first}/{day.isoformat()}T{last}"
    params = {
        "direction": "Departure",
        "withLeg": "true",  # arrival times at the destination
        "withCancelled": "false",
        "withCodeshared": "false",
        "withCargo": "false",
        "withPrivate": "false",
        "withLocation": "false",
    }
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.get(
                url, params=params, headers={"x-rapidapi-key": api_key, "x-rapidapi-host": host}
            )
    except httpx.HTTPError as e:
        logger.warning("Flight schedule request failed: %s", e)
        raise FlightSearchError("Couldn't reach the flight schedules right now") from e
    if response.status_code == 204:
        return {"departures": []}  # no flights in that time range
    if response.status_code == 429:
        logger.warning("Flight schedules: this month's requests are used up")
        raise FlightSearchError("Flight search has reached this month's limit", pause=True)
    if response.status_code in (401, 403):
        logger.error("Flight schedules refused the RapidAPI key (%s): %s", response.status_code, response.text[:200])
        raise FlightSearchError("Flight search isn't set up correctly yet", pause=True)
    if response.status_code != 200:
        # e.g. 400 for a date further ahead than schedules are published
        logger.warning("Flight schedules answered %s: %s", response.status_code, response.text[:200])
        raise FlightSearchError("Couldn't search flights right now")
    try:
        payload = response.json()
    except ValueError as e:
        raise FlightSearchError("Couldn't search flights right now") from e
    if not isinstance(payload, dict):
        raise FlightSearchError("Couldn't search flights right now")
    return payload


def _local_time(movement: dict) -> datetime | None:
    """A movement's scheduled local time; both reply shapes ("scheduledTimeLocal": "2021-10-04
    20:35+02:00", or "scheduledTime": {"local": ...})."""
    value = movement.get("scheduledTimeLocal")
    if not value and isinstance(movement.get("scheduledTime"), dict):
        value = movement["scheduledTime"].get("local")
    try:
        return datetime.fromisoformat(str(value).strip()) if value else None
    except ValueError:
        return None


def _duration(start: datetime, end: datetime) -> str:
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        return ""
    minutes = int((end - start).total_seconds() // 60)
    return f"{minutes // 60}h {minutes % 60:02d}m"


def parse_departures(payload: dict, origin: str) -> list[dict[str, Any]]:
    """Every passenger flight in the reply (all destinations), under its operating airline's number."""
    flights = []
    for item in payload.get("departures") or []:
        if not isinstance(item, dict) or item.get("isCargo"):
            continue
        if item.get("codeshareStatus") == "IsCodeshared":
            continue  # the same plane listed under another airline's number
        if str(item.get("status") or "").startswith("Canceled"):
            continue
        departure, arrival = item.get("departure") or {}, item.get("arrival") or {}
        number = str(item.get("number") or "").strip()
        to = str((arrival.get("airport") or {}).get("iata") or "").upper()
        leaves = _local_time(departure)
        if not number or not to or leaves is None:
            continue
        lands = _local_time(arrival)
        arrive = ""
        if lands is not None:
            days_later = (lands.date() - leaves.date()).days
            arrive = lands.strftime("%H:%M") + (f" +{days_later}" if days_later > 0 else "")
        airline = str((item.get("airline") or {}).get("name") or "").strip()
        terminal = str(departure.get("terminal") or "").strip()
        to_terminal = str(arrival.get("terminal") or "").strip()
        flights.append(
            {
                "name": airline[:80] or number,
                "number": number[:24],
                "operator": airline[:80],
                "depart_time": leaves.strftime("%H:%M"),
                "arrive_time": arrive,
                "from_station": f"{origin} T{terminal}" if terminal else origin,
                "to_station": f"{to} T{to_terminal}" if to_terminal else to,
                "to_airport": to,
                "duration": _duration(leaves, lands) if lands is not None else "",
                "travel_class": "",
                "fare_inr": None,
                "source": "schedule",
            }
        )
    return flights
