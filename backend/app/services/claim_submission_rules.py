"""Claim submission business rules (Phase 3 spec §1)."""

from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException, status

from app.models.reimbursement import ClaimDraft


def _add_working_days(start: date, days: int) -> date:
    """Add N working days (Mon–Fri only; no holiday calendar in Phase 3 MVP)."""
    d = start
    added = 0
    while added < days:
        d += timedelta(days=1)
        if d.weekday() < 5:
            added += 1
    return d


def assert_submission_deadline(claim: ClaimDraft, submission_config: dict) -> tuple[bool, int]:
    if not claim.return_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Return date is mandatory for claim submission to validate the 5-day deadline.",
        )
    max_days = int(submission_config.get("max_working_days_after_return", 5))
    deadline = _add_working_days(claim.return_date, max_days)
    mode = submission_config.get("deadline_mode", "hard_block")
    today = date.today()
    if today > deadline:
        late_days = (today - deadline).days
        if mode == "hard_block":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Claim must be submitted within {max_days} working days of return "
                    f"(deadline {deadline.isoformat()}). Configure workflow for soft warning if needed."
                ),
            )
        return True, late_days
    return False, 0


def validate_claim_submission(claim: ClaimDraft, workflow_config: dict) -> tuple[bool, int]:
    submission = workflow_config.get("submission") or {}
    return assert_submission_deadline(claim, submission)


def parse_auto_approve_threshold(workflow_config: dict) -> Decimal:
    raw = workflow_config.get("auto_approve_below_amount", "0")
    try:
        return Decimal(str(raw))
    except Exception:
        return Decimal("0")


def total_claimed_from_report(claim: ClaimDraft) -> Decimal:
    report = claim.compliance_report or {}
    try:
        return Decimal(str(report.get("total_claimed", "0")))
    except Exception:
        return Decimal("0")
