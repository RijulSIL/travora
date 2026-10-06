"""Canonical "now" for every business-facing timestamp: approvals, submissions, audit logs,
SLA deadlines, delegation windows, scheduled reports, and anything else a person reads as a
real-world date/time.

The company operates in IST, and several columns across the schema are populated by the
database server itself via `server_default=func.now()` (e.g. TravelRequest.requested_at,
AdvanceRequest.created_at) — MySQL's own `NOW()`, which on this deployment returns IST
wall-clock time with no timezone marker attached. Every timestamp set from *Python* has to
match that exact convention (naive datetime, already in IST), or the two will silently
disagree by the UTC+5:30 offset wherever they're compared or displayed side by side — which is
exactly the bug that motivated this module: an exception-approval timestamp set via
`datetime.now(UTC)` rendered as if it were 5.5 hours *before* the submission timestamp it
actually followed.

IST has no DST, so a fixed +5:30 offset is always exact. A fixed offset is used instead of
`zoneinfo.ZoneInfo("Asia/Kolkata")` because that requires the `tzdata` package, which isn't
preinstalled on Windows (where this project is developed) and would add a new runtime
dependency just to express a constant that never changes.

Security-sensitive expiry timestamps (JWT/session/OTP/trusted-device expiry in
auth_service.py) are deliberately NOT routed through this — those are self-consistent,
internal-only comparisons that are set and checked by the same code, and should stay in true
UTC regardless of the business's own timezone.
"""

from datetime import UTC, date, datetime, timedelta

IST_OFFSET = timedelta(hours=5, minutes=30)


def now_ist() -> datetime:
    """Current wall-clock time in IST, naive (no tzinfo) — matches how every
    `server_default=func.now()` column is actually stored, so naive-datetime comparisons and
    JSON serialization stay consistent with those columns everywhere in the app."""
    return datetime.now(UTC).replace(tzinfo=None) + IST_OFFSET


def today_ist() -> date:
    """Current calendar date in IST. Use this for any "today" business-date check (lead-time /
    advance-booking policy windows, etc.) instead of a UTC-derived date, since the calendar day
    can already have rolled over in IST while it's still "yesterday" in UTC (anytime from
    18:30 UTC onward)."""
    return now_ist().date()
