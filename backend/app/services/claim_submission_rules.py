"""Claim submission business rules (Phase 3 spec §1)."""

from datetime import date
from decimal import Decimal

# How long after a trip ends it can be claimed, in calendar days from its to date (the last leg,
# or the return date). Up to LATE_AFTER days it's an ordinary claim; after that the claim needs a
# late-claim exception (LATE_CLAIM); after ARCHIVE_AFTER days the trip is archived and can't be
# claimed at all. Admin-editable as workflow config submission.late_after_days /
# submission.archive_after_days (Approval Matrix).
DEFAULT_LATE_AFTER_DAYS = 7
DEFAULT_ARCHIVE_AFTER_DAYS = 15

CLAIM_ON_TIME = "ON_TIME"
CLAIM_LATE = "LATE"
CLAIM_ARCHIVED = "ARCHIVED"


def _days(value, default: int) -> int:
    try:
        days = int(value)
    except (TypeError, ValueError):
        return default
    return days if days >= 1 else default


def claim_windows(workflow_config: dict) -> tuple[int, int]:
    """(late after, archived after) in days — the archive window is never shorter than the late one."""
    submission = workflow_config.get("submission") or {}
    late = _days(submission.get("late_after_days"), DEFAULT_LATE_AFTER_DAYS)
    archive = _days(submission.get("archive_after_days"), DEFAULT_ARCHIVE_AFTER_DAYS)
    return late, max(archive, late)


def claim_lateness(trip_end: date | None, workflow_config: dict, today: date) -> tuple[str, int]:
    """Where a claim for a trip that ended on `trip_end` stands today — ON_TIME, LATE (needs a
    late-claim exception) or ARCHIVED (can't be claimed) — and how many days ago the trip ended.
    No end date (a claim without a trip yet) is on time."""
    if trip_end is None:
        return CLAIM_ON_TIME, 0
    days_since = (today - trip_end).days
    late_after, archive_after = claim_windows(workflow_config)
    if days_since > archive_after:
        return CLAIM_ARCHIVED, days_since
    if days_since > late_after:
        return CLAIM_LATE, days_since
    return CLAIM_ON_TIME, max(days_since, 0)


def parse_auto_approve_threshold(workflow_config: dict) -> Decimal:
    raw = workflow_config.get("auto_approve_below_amount", "0")
    try:
        return Decimal(str(raw))
    except Exception:
        return Decimal("0")


def total_claimed_from_report(claim) -> Decimal:
    report = claim.compliance_report or {}
    try:
        return Decimal(str(report.get("total_claimed", "0")))
    except Exception:
        return Decimal("0")
