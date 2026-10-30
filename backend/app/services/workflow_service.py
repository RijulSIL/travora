"""Phase 3 claim approval chain, advances, exceptions, and workflow config."""

from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.rbac import MANAGER_ROLES, acts_as_manager, is_direct_report, is_manager
from app.core.timezone import now_ist
from app.models.auth import Delegation, Role, User
from app.models.claim_workflow import (
    AdvanceRequest,
    AdvanceRequestStatus,
    ClaimApprovalStage,
    ClaimApprovalStageStatus,
    ExceptionApproval,
    ExceptionItemDecision,
    ExceptionItemDecisionValue,
    ExceptionRequest,
    ExceptionRequestItem,
    ExceptionRequestStatus,
    NotificationCategory,
    WorkflowConfigRow,
)
from app.models.employee import AuditLog, Employee
from app.models.reimbursement import ClaimDraft, ClaimStatus, ReimbursementCategory
from app.services.advance_service import get_outstanding_advance
from app.services.audit_service import log_event
from app.services.claim_submission_rules import (
    DEFAULT_ARCHIVE_AFTER_DAYS,
    DEFAULT_LATE_AFTER_DAYS,
    parse_auto_approve_threshold,
    total_claimed_from_report,
)
from app.services.finance_reporting_service import post_ledger_entry_to_erp
from app.services.notification_service import create_notification
from app.services.working_time import sla_deadline

STAGE_STATUS_NOT_STARTED = "NOT_STARTED"
# An approval step whose approver didn't act within its SLA and was passed over — the request
# moved on to the next approver (see app.workers.sla_monitor). Used for claim stages, travel
# request stages and exception approval steps alike.
STAGE_STATUS_SLA_SKIPPED = "SLA_SKIPPED"
# A pooled-role stage whose only possible approver was the claimant themselves (see
# _activate_stage_rows) — passed over, not missed.
STAGE_STATUS_SKIPPED_OWN = "SKIPPED_OWN"
# A step passed on by an admin override without a decision (override_service.skip_step).
STAGE_STATUS_OVERRIDE_SKIPPED = "OVERRIDE_SKIPPED"
DEFAULT_SLA_HOURS = 48

# The two shared exception routes (Approval Matrix -> Exception flows). Every claim exception type
# goes through CLAIM_EXCEPTIONS and every travel request exception type through TRAVEL_EXCEPTIONS,
# stored under these keys in exception_chains / exception_sla_hours. Each type still has its own
# on/off switch (exception_enabled) and, on claims, its Allow/Block setting
# (exception_submission_mode). A claim with exceptions gets one request listing all of them, and
# every approver on the route decides each one (see decide_claim_exception_items); a travel
# request's exceptions get one request with one decision for the whole request.
CLAIM_EXCEPTIONS_ROUTE = "CLAIM_EXCEPTIONS"
TRAVEL_EXCEPTIONS_ROUTE = "TRAVEL_EXCEPTIONS"
SHARED_EXCEPTION_ROUTE_LABELS = {
    CLAIM_EXCEPTIONS_ROUTE: "Claim exceptions",
    TRAVEL_EXCEPTIONS_ROUTE: "Travel request exceptions",
}
MAX_EXCEPTION_ROUTE_STEPS = 6
# Which exception types belong to which route — the same lists the Approval Matrix shows under
# each flow (frontend approvalMatrix.js). A generic f"{category}_DEVIATION" raised for a category
# without its own rule is a claim exception too.
CLAIM_EXCEPTION_TYPES = (
    "ROOM_RENT_DEVIATION",
    "FOOD_DEVIATION",
    "INCIDENTAL_DEVIATION",
    "DAY_VISIT_EXTERNAL_MEETING",
    "POLICY_EXCEPTION_GENERAL",
    "TRAIN_TATKAL",
    "AIR_TRAVEL_L5_L6",
    "HIRED_TAXI_UNAUTHORIZED",
    "FLIGHT_COST_DELTA",
    "MODE_DEVIATION",
    # The whole claim, not one expense: raised more than submission.late_after_days after the
    # trip's to date (claim_submission_rules.claim_lateness).
    "LATE_CLAIM",
)
TRAVEL_EXCEPTION_TYPES = (
    "AIR_TRAVEL_UNLOCK",
    "FLIGHT_ADVANCE_BOOKING_OVERRIDE",
    "TRAIN_ADVANCE_BOOKING_OVERRIDE",
    "TRAVEL_REQUEST_LEAD_TIME_OVERRIDE",
)
EXCEPTION_TYPES_BY_ROUTE = {
    CLAIM_EXCEPTIONS_ROUTE: CLAIM_EXCEPTION_TYPES,
    TRAVEL_EXCEPTIONS_ROUTE: TRAVEL_EXCEPTION_TYPES,
}

EXCEPTION_APPROVAL_CHAINS: dict[str, list[str]] = {
    # "Function Head" per the PRD is this employee's own Reporting Manager (no separate role) —
    # the REPORTING_MANAGER entry already resolves to that specific person.
    CLAIM_EXCEPTIONS_ROUTE: ["REPORTING_MANAGER", "HRBP_HR", "CEO"],
    TRAVEL_EXCEPTIONS_ROUTE: ["REPORTING_MANAGER"],
    # Not an exception — reuses this same configurable-chain storage (and the Approval Matrix's
    # "Policy versions" flow) for who approves a submitted PolicyVersion (see admin/policy.py's
    # submit/approve/reject endpoints and app.models.policy.PolicyApproval). Single-role by
    # default (HRBP_HR holds approve_policy), but can be a multi-stage sequential chain.
    "POLICY_APPROVAL": ["HRBP_HR"],
}


def shared_exception_route(cfg: dict, route_key: str) -> list[str]:
    """The approver roles of a shared exception route, in order — the Approval Matrix's setting,
    or the built-in default when there's none (every config saved before the shared routes). A
    role listed twice is asked once."""
    route = (cfg.get("exception_chains") or {}).get(route_key)
    if not isinstance(route, list) or not route:
        route = EXCEPTION_APPROVAL_CHAINS[route_key]
    return list(dict.fromkeys(route))


def exception_route_key(exception_type: str) -> str:
    """Which shared route an exception of this type goes through."""
    return TRAVEL_EXCEPTIONS_ROUTE if exception_type in TRAVEL_EXCEPTION_TYPES else CLAIM_EXCEPTIONS_ROUTE


def _resolve_exception_chain(cfg: dict, exception_type: str) -> list[str]:
    """The route a new exception of this type goes through: its group's shared route."""
    return shared_exception_route(cfg, exception_route_key(exception_type))


# The per-type chains every exception had before the shared routes. Only requests raised before
# then (route_key NULL) still read them, so they finish on the chain they were created with.
LEGACY_EXCEPTION_APPROVAL_CHAINS: dict[str, list[str]] = {
    "AIR_TRAVEL_UNLOCK": ["REPORTING_MANAGER", "GROUP_HEAD_HR", "CEO"],
    "TRAIN_TATKAL": ["REPORTING_MANAGER", "HRBP_HR"],
    "FLIGHT_ADVANCE_BOOKING_OVERRIDE": ["REPORTING_MANAGER"],
    # Distinct from TRAIN_TATKAL (self-declared/invoice-detected, claims side): this is the
    # train equivalent of FLIGHT_ADVANCE_BOOKING_OVERRIDE — auto-raised against a travel
    # request whenever a train leg's departure falls inside the minimum advance-booking window.
    "TRAIN_ADVANCE_BOOKING_OVERRIDE": ["REPORTING_MANAGER"],
    # Generic minimum-notice floor for any travel request mode with no dedicated advance-booking
    # rule of its own (currently just BUS — flight and train are covered by their own entries
    # above instead of this one).
    "TRAVEL_REQUEST_LEAD_TIME_OVERRIDE": ["REPORTING_MANAGER"],
    "FLIGHT_COST_DELTA": ["REPORTING_MANAGER", "HRBP_HR"],
    "ROOM_RENT_DEVIATION": ["REPORTING_MANAGER", "HRBP_HR", "CEO"],
    "AIR_TRAVEL_L5_L6": ["REPORTING_MANAGER", "GROUP_HEAD_HR", "CEO"],
    "HIRED_TAXI_UNAUTHORIZED": ["REPORTING_MANAGER", "HRBP_HR", "CEO"],
    "MODE_DEVIATION": ["REPORTING_MANAGER", "HRBP_HR", "CEO"],
    "DAY_VISIT_EXTERNAL_MEETING": ["CEO"],
    # Food and Incidental are both capped, admin-configurable dimensions on the Expense Limits
    # page, same as Hotel — they previously had no dedicated chain and fell through to the
    # generic POLICY_EXCEPTION_GENERAL bucket alongside every uncapped category (Telecom,
    # Courier, ...). Giving them their own entries (currently equal to what they already got
    # via the generic fallback, so this changes no current approver — just makes them
    # independently configurable) matches Hotel's ROOM_RENT_DEVIATION pattern.
    "FOOD_DEVIATION": ["REPORTING_MANAGER", "HRBP_HR"],
    "INCIDENTAL_DEVIATION": ["REPORTING_MANAGER", "HRBP_HR"],
    # The catch-all for any expense category with no dedicated rule above (e.g.
    # Office Supplies, Telecom...) — _resolve_exception_chain falls back to this whenever an
    # exception_type isn't one of the named keys here, so it's the one editable control over
    # what happens to every "my claim breached a cap and there's no specific rule" case.
    "POLICY_EXCEPTION_GENERAL": ["REPORTING_MANAGER", "HRBP_HR"],
}


def _chain_for_type(chains: dict, exception_type: str) -> list[str]:
    """Legacy per-type chain for an exception type out of an exception_chains dict. A type with
    no dedicated entry — every generic f"{category}_DEVIATION" — fell back to the
    POLICY_EXCEPTION_GENERAL chain."""
    return chains.get(exception_type) or chains.get("POLICY_EXCEPTION_GENERAL") or ["HRBP_HR"]


def _legacy_exception_chain(cfg: dict, exception_type: str) -> list[str]:
    """The per-type chain an exception request raised before the shared routes was created with:
    what's still stored for that type, else the old built-in default."""
    chains = {**LEGACY_EXCEPTION_APPROVAL_CHAINS, **(cfg.get("exception_chains") or {})}
    return _chain_for_type(chains, exception_type)


# What a flagged claim expense does at submit, per exception type (the Approval Matrix's
# "When flagged" setting): ALLOW lets the employee submit with a reason, raising an exception
# request; BLOCK refuses the submission until that expense is removed. Defaults keep the
# pre-existing behavior — Tatkal, restricted air class and unauthorised taxi were already
# hard-blocked at submit, every capped category already went to exception instead.
EXCEPTION_SUBMISSION_ALLOW = "ALLOW"
EXCEPTION_SUBMISSION_BLOCK = "BLOCK"
DEFAULT_EXCEPTION_SUBMISSION_MODE: dict[str, str] = {
    "ROOM_RENT_DEVIATION": EXCEPTION_SUBMISSION_ALLOW,
    "FOOD_DEVIATION": EXCEPTION_SUBMISSION_ALLOW,
    "INCIDENTAL_DEVIATION": EXCEPTION_SUBMISSION_ALLOW,
    "DAY_VISIT_EXTERNAL_MEETING": EXCEPTION_SUBMISSION_ALLOW,
    "POLICY_EXCEPTION_GENERAL": EXCEPTION_SUBMISSION_ALLOW,
    "TRAIN_TATKAL": EXCEPTION_SUBMISSION_BLOCK,
    "AIR_TRAVEL_L5_L6": EXCEPTION_SUBMISSION_BLOCK,
    "HIRED_TAXI_UNAUTHORIZED": EXCEPTION_SUBMISSION_BLOCK,
    "LATE_CLAIM": EXCEPTION_SUBMISSION_ALLOW,
}


def exception_submission_mode(cfg: dict, exception_type: str) -> str:
    """ALLOW or BLOCK for a flagged claim expense of `exception_type`. A generic
    f"{category}_DEVIATION" type has no entry of its own and follows POLICY_EXCEPTION_GENERAL."""
    modes = {**DEFAULT_EXCEPTION_SUBMISSION_MODE, **(cfg.get("exception_submission_mode") or {})}
    mode = modes.get(exception_type) or modes.get("POLICY_EXCEPTION_GENERAL")
    return EXCEPTION_SUBMISSION_BLOCK if mode == EXCEPTION_SUBMISSION_BLOCK else EXCEPTION_SUBMISSION_ALLOW


def exception_step_sla_hours(cfg: dict, exception_types: list[str], role: str, route_key: str | None = None) -> int:
    """SLA (working hours) for `role`'s step in an exception route; 48 when unset.

    A request on a shared route (`route_key`) takes that route's per-step `exception_sla_hours`.
    A request raised before the shared routes (no route_key) keeps the per-type SLAs it was
    created with — a combined travel request takes the longest SLA any of its types gives that
    role, matching how its merged chain asked each role once."""
    sla_cfg = cfg.get("exception_sla_hours") or {}
    if route_key:
        route = shared_exception_route(cfg, route_key)
        if role not in route:
            return DEFAULT_SLA_HOURS
        configured = (cfg.get("exception_chains") or {}).get(route_key)
        # SLAs line up with the route as the admin saved it (before any repeated role was dropped).
        pos = configured.index(role) if isinstance(configured, list) and role in configured else route.index(role)
        hours_list = sla_cfg.get(route_key) or []
        try:
            return int(hours_list[pos]) if pos < len(hours_list) else DEFAULT_SLA_HOURS
        except (TypeError, ValueError):
            return DEFAULT_SLA_HOURS
    chains = {**LEGACY_EXCEPTION_APPROVAL_CHAINS, **(cfg.get("exception_chains") or {})}
    best = 0
    for exc_type in exception_types:
        key = exc_type if chains.get(exc_type) else "POLICY_EXCEPTION_GENERAL"
        chain = _chain_for_type(chains, exc_type)
        if role not in chain:
            continue
        hours_list = sla_cfg.get(key) or []
        pos = chain.index(role)
        try:
            hours = int(hours_list[pos]) if pos < len(hours_list) else DEFAULT_SLA_HOURS
        except (TypeError, ValueError):
            hours = DEFAULT_SLA_HOURS
        best = max(best, hours)
    return best or DEFAULT_SLA_HOURS


async def start_exception_step(approval: ExceptionApproval, req: ExceptionRequest, cfg: dict, db: AsyncSession) -> None:
    """Make `approval` the active step of its exception route, with its SLA clock started."""
    now = _now()
    approval.status = ExceptionRequestStatus.PENDING.value
    hours = exception_step_sla_hours(
        cfg, req.exception_types or [req.exception_type], approval.required_role, _route_key(req)
    )
    approval.sla_deadline_at = await sla_deadline(db, hours, now)
    approval.last_notified_at = now
    approval.sla_breached_at = None


def is_exception_enabled(cfg: dict, exception_type: str) -> bool:
    """False only when an admin has explicitly switched this exception type off in the Approval
    Matrix (the "Flag this exception" toggle) — every check that would otherwise flag/block on
    this type should instead treat the request/claim as if the condition never happened. Absent
    from the map (the default for every type, and the only state possible before this toggle
    existed) means enabled, so existing configs keep behaving exactly as before."""
    enabled_map = cfg.get("exception_enabled") or {}
    return enabled_map.get(exception_type, True) is not False


def is_exception_route_in_use(cfg: dict, route_key: str) -> bool:
    """Whether any exception type that goes through this shared route is switched on."""
    return any(is_exception_enabled(cfg, t) for t in EXCEPTION_TYPES_BY_ROUTE[route_key])


def _humanize_token(value: str) -> str:
    """UPPER_SNAKE_CASE role/exception codes read poorly in emails ("REPORTING_MANAGER");
    render them as plain title case ("Reporting Manager") wherever they reach a notification body."""
    return value.replace("_", " ").replace("/", " / ").title()


def _exception_label(row: ExceptionRequest) -> str:
    """Human-readable label for an exception request, covering every type it was raised for."""
    types = list(dict.fromkeys(row.exception_types or [row.exception_type]))
    return " + ".join(_humanize_token(t) for t in types)


def _route_key(req) -> str | None:
    """The shared route a request follows; None for one raised before the shared routes."""
    return getattr(req, "route_key", None)


def is_itemized_claim_request(req) -> bool:
    """A claim's one exception request listing each exception, decided one by one. Claim requests
    raised before the shared routes (one per flagged expense) are single-decision, like travel."""
    return getattr(req, "claim_id", None) is not None and _route_key(req) == CLAIM_EXCEPTIONS_ROUTE


async def _load_exception_items(request_id: int, db: AsyncSession) -> list[ExceptionRequestItem]:
    return list(
        (
            await db.execute(
                select(ExceptionRequestItem)
                .where(ExceptionRequestItem.exception_request_id == request_id)
                .order_by(ExceptionRequestItem.position, ExceptionRequestItem.id)
            )
        ).scalars().all()
    )


async def _load_exception_steps(request_id: int, db: AsyncSession) -> list[ExceptionApproval]:
    return list(
        (
            await db.execute(
                select(ExceptionApproval)
                .where(ExceptionApproval.exception_request_id == request_id)
                .order_by(ExceptionApproval.id)
            )
        ).scalars().all()
    )


async def _load_item_decisions(item_ids: list[int], db: AsyncSession) -> list[ExceptionItemDecision]:
    """Every decision on these exceptions, oldest first."""
    if not item_ids:
        return []
    return list(
        (
            await db.execute(
                select(ExceptionItemDecision)
                .where(ExceptionItemDecision.item_id.in_(item_ids))
                .order_by(ExceptionItemDecision.decided_at, ExceptionItemDecision.id)
            )
        ).scalars().all()
    )


def _latest_decisions_at_step(decisions: list[ExceptionItemDecision], step_id: int) -> dict[int, ExceptionItemDecision]:
    """{item_id: that step's latest decision on it}."""
    latest: dict[int, ExceptionItemDecision] = {}
    for d in decisions:
        if d.exception_approval_id == step_id:
            latest[d.item_id] = d
    return latest


def items_awaiting_step(
    items: list[ExceptionRequestItem], decisions: list[ExceptionItemDecision], step_id: int
) -> list[ExceptionRequestItem]:
    """The exceptions this step still has to decide: every one still on the route, except those
    it already accepted — after a send-back and resubmission, the step that sent them back only
    decides the sent-back ones again."""
    latest = _latest_decisions_at_step(decisions, step_id)
    return [
        i
        for i in items
        if i.status == ExceptionRequestStatus.PENDING.value
        and getattr(latest.get(i.id), "decision", None) != ExceptionItemDecisionValue.ACCEPTED.value
    ]


def _money_str(value) -> str | None:
    return str(value) if value is not None else None


async def describe_exception_items(
    req: ExceptionRequest, approvals: list[ExceptionApproval], db: AsyncSession
) -> list[dict]:
    """Each exception on an itemized claim request, with every step's decision on it (who, when,
    what, why) and whether the step now waiting still has to decide it — what the approver's
    panel, the claim's route and the exception log show."""
    items = await _load_exception_items(req.id, db)
    decisions = await _load_item_decisions([i.id for i in items], db)
    ordered = sorted(approvals, key=lambda a: a.id)
    step_number = {a.id: n for n, a in enumerate(ordered, start=1)}
    step_role = {a.id: a.required_role for a in approvals}
    current = next((a for a in ordered if a.status == ExceptionRequestStatus.PENDING.value), None)
    awaiting = (
        {i.id for i in items_awaiting_step(items, decisions, current.id)}
        if current is not None and req.status == ExceptionRequestStatus.PENDING.value
        else set()
    )
    names: dict[int, str | None] = {}
    for d in decisions:
        if d.decided_by_user_id and d.decided_by_user_id not in names:
            names[d.decided_by_user_id] = (await _user_identity(d.decided_by_user_id, db))[0]
    out = []
    for item in items:
        mine = [d for d in decisions if d.item_id == item.id]
        last_note = next(
            (d.comment for d in reversed(mine) if d.decision != ExceptionItemDecisionValue.ACCEPTED.value), None
        )
        out.append(
            {
                "item_id": item.id,
                "exception_type": item.exception_type,
                "exception_type_label": _humanize_token(item.exception_type),
                "category_name": item.expense_category_name,
                "claimed_amount": _money_str(item.claimed_amount),
                "cap_amount": _money_str(item.cap_amount),
                "reason": item.reason,
                "status": item.status,
                "decision_comment": last_note,
                "awaiting_current_step": item.id in awaiting,
                "decisions": [
                    {
                        "exception_approval_id": d.exception_approval_id,
                        "step": step_number.get(d.exception_approval_id),
                        "required_role": step_role.get(d.exception_approval_id),
                        "decision": d.decision,
                        "comment": d.comment,
                        "decided_by_user_id": d.decided_by_user_id,
                        "decided_by_name": names.get(d.decided_by_user_id),
                        "decided_at": d.decided_at.isoformat() if d.decided_at else None,
                    }
                    for d in mine
                ],
            }
        )
    return out


async def _reporting_manager_user_for_claim(claim: ClaimDraft, db: AsyncSession) -> User | None:
    """The specific User row for the claim owner's reporting manager, if any."""
    owner_stmt = (
        select(Employee.reporting_manager_id)
        .join(User, User.employee_id == Employee.employee_id)
        .where(User.id == claim.employee_user_id)
    )
    mgr_emp_id = (await db.execute(owner_stmt)).scalar_one_or_none()
    if not mgr_emp_id:
        return None
    return (
        await db.execute(select(User).where(User.employee_id == mgr_emp_id))
    ).scalar_one_or_none()


async def _get_function_head(employee_id: str, db: AsyncSession) -> Employee | None:
    """Walk up the reporting chain until we find someone at Level 3A or above."""
    from app.models.policy import ImpactLevel
    curr_id = employee_id
    while curr_id:
        emp = await db.get(Employee, curr_id)
        if not emp or not emp.reporting_manager_id:
            return None
        mgr = await db.get(Employee, emp.reporting_manager_id)
        if not mgr:
            return None
        impact = await db.get(ImpactLevel, mgr.impact_level_id)
        if impact and impact.level_code in {"L1", "L2", "L3A"}:
            return mgr
        curr_id = mgr.employee_id
    return None


def _now() -> datetime:
    return now_ist()


# --- Department heads ---------------------------------------------------------------------
# An admin can name a head per department (Approval Matrix -> Department heads) and tick which
# flows they must also approve: claims, travel requests, exceptions. A ticked flow gets a
# DEPARTMENT_HEAD step (placed by the admin like any other step); it resolves to the head of the
# subject employee's department, and is left out entirely for anyone whose department isn't
# ticked for that flow, who is the head themselves, or whose reporting manager is the head.
DEPARTMENT_HEAD = "DEPARTMENT_HEAD"
DEPARTMENT_HEAD_FLOWS = ("claims", "travel_requests", "exceptions")


def _department_head_entry(cfg: dict, department: str | None) -> dict | None:
    """The configured entry for `department`, matched case-insensitively."""
    if not department:
        return None
    heads = cfg.get("department_heads") or {}
    wanted = department.strip().lower()
    for name, entry in heads.items():
        if isinstance(entry, dict) and str(name).strip().lower() == wanted:
            return entry
    return None


async def _department_head_user(employee_id: str | None, db: AsyncSession, cfg: dict | None = None) -> User | None:
    """The active head of this employee's department, whatever flows are ticked — who a
    DEPARTMENT_HEAD step that already exists on a request belongs to."""
    if not employee_id:
        return None
    emp = await db.get(Employee, employee_id)
    if emp is None:
        return None
    entry = _department_head_entry(cfg if cfg is not None else await get_workflow_config(db), emp.department)
    head_id = entry.get("head_user_id") if entry else None
    if not head_id:
        return None
    head = await db.get(User, int(head_id))
    return head if head is not None and head.is_active else None


async def department_head_applies(employee_id: str | None, flow: str, cfg: dict, db: AsyncSession) -> bool:
    """Whether a new request from this employee in `flow` gets its DEPARTMENT_HEAD step."""
    if not employee_id:
        return False
    emp = await db.get(Employee, employee_id)
    if emp is None:
        return False
    entry = _department_head_entry(cfg, emp.department)
    if not entry or not entry.get(flow):
        return False
    head = await _department_head_user(employee_id, db, cfg)
    if head is None:
        return False
    # Nobody approves their own request, and a head who is already the reporting manager isn't asked twice.
    if head.employee_id and head.employee_id in (employee_id, emp.reporting_manager_id):
        return False
    return True


async def is_department_head_for(user_id: int, subject_employee_id: str | None, db: AsyncSession) -> bool:
    """Is `user_id` (directly, or covering for them on an active delegation) the head of this
    employee's department? Lets a head open the requests they're asked to approve."""
    user = await db.get(User, user_id)
    if user is None:
        return False
    return await _user_matches_required_role(user, DEPARTMENT_HEAD, subject_employee_id, db)


async def _without_inapplicable_head(
    roles: list[str], employee_id: str | None, flow: str, cfg: dict, db: AsyncSession
) -> list[str]:
    """An exception route for this subject: DEPARTMENT_HEAD dropped when it doesn't apply. Never
    returns an empty route (that would leave the request with no approver) — HR is the last
    resort."""
    if DEPARTMENT_HEAD not in roles or await department_head_applies(employee_id, flow, cfg, db):
        return roles
    return [r for r in roles if r != DEPARTMENT_HEAD] or ["HRBP_HR"]


async def department_head_scope(user: User, db: AsyncSession) -> dict:
    """What a user who is a department head approves because of it — merged into their approver
    scope so Pending approvals / Exception requests show up even when their own role isn't
    otherwise on those routes."""
    cfg = await get_workflow_config(db)
    flows = set()
    for entry in (cfg.get("department_heads") or {}).values():
        if isinstance(entry, dict) and entry.get("head_user_id") and int(entry["head_user_id"]) == user.id:
            flows |= {f for f in DEPARTMENT_HEAD_FLOWS if entry.get(f)}
    scope = {"claim_categories": [], "travel_request": False, "exceptions": []}
    if not flows:
        return scope
    if "claims" in flows:
        for category in _APPROVER_SCOPE_CATEGORIES:
            cat_cfg = await get_workflow_config(db, category=category)
            if any(s.get("route_role") == DEPARTMENT_HEAD for s in cat_cfg.get("stages") or []):
                scope["claim_categories"].append(category)
    if "travel_requests" in flows:
        scope["travel_request"] = any(s["route_role"] == DEPARTMENT_HEAD for s in _travel_request_stage_defs(cfg))
    if "exceptions" in flows:
        for route_key, types in EXCEPTION_TYPES_BY_ROUTE.items():
            if DEPARTMENT_HEAD in shared_exception_route(cfg, route_key):
                scope["exceptions"] += list(types)
    return scope


async def _active_delegator_ids(user_id: int, db: AsyncSession) -> list[int]:
    """User ids of everyone currently delegating to `user_id` (active, in-window Delegation
    row with them as delegatee). Shared by every claim/exception authorization check below —
    previously several of them omitted this, which silently made delegation a view-only
    feature (a delegate could see a claim/exception in their queue but not act on it)."""
    if not user_id:
        return []

    from app.services.delegation_service import is_delegation_enabled

    if not await is_delegation_enabled(db):
        return []

    now = _now()
    return list(
        (
            await db.execute(
                select(Delegation.delegator_id).where(
                    Delegation.delegatee_id == user_id,
                    Delegation.is_active,
                    Delegation.start_date <= now,
                    Delegation.end_date >= now,
                )
            )
        ).scalars().all()
    )


async def _user_ids_for_role(route_role: str, employee_id: str | None, db: AsyncSession) -> list[int]:
    """Resolves the user(s) who can act for a given route role, for the subject employee
    of the claim/exception in question. REPORTING_MANAGER and FUNCTION_HEAD resolve to a
    single specific person; the other roles are pools — anyone holding that system role."""
    if route_role == Role.REPORTING_MANAGER.value:
        if not employee_id:
            return []
        employee = await db.get(Employee, employee_id)
        if employee is None or not employee.reporting_manager_id:
            return []
        result = await db.execute(
            # Whoever this person reports to, whatever their own role (see rbac.MANAGER_PERMISSIONS).
            select(User.id).where(User.employee_id == employee.reporting_manager_id)
        )
        return [int(user_id) for user_id in result.scalars().all()]
    if route_role == "FUNCTION_HEAD":
        if not employee_id:
            return []
        fh = await _get_function_head(employee_id, db)
        if not fh:
            return []
        result = await db.execute(
            select(User.id).where(User.employee_id == fh.employee_id)
        )
        return [int(user_id) for user_id in result.scalars().all()]
    if route_role == DEPARTMENT_HEAD:
        head = await _department_head_user(employee_id, db)
        return [head.id] if head else []
    if route_role in {
        Role.HRBP_HR.value,
        Role.PAYROLL.value,
        Role.FINANCE.value,
        Role.IT_ADMIN.value,
        Role.CEO.value,
        Role.GROUP_HEAD_HR.value,
        Role.RECRUITER.value,
        Role.ADMIN.value,
    }:
        result = await db.execute(select(User.id).where(User.role == Role(route_role)))
        return [int(user_id) for user_id in result.scalars().all()]
    return []


async def _user_ids_for_stage(claim: ClaimDraft, stage_def: dict, db: AsyncSession) -> list[int]:
    route_role = str(stage_def.get("route_role") or "")
    return await _user_ids_for_role(route_role, claim.employee_id, db)


async def _notify_stage_approver(
    claim: ClaimDraft, stage_def: dict, db: AsyncSession, note: str | None = None
) -> None:
    """`note` is appended to the message — e.g. that the previous approver missed their SLA."""
    stage_number = int(stage_def.get("number", 0))
    recipients = await _user_ids_for_stage(claim, stage_def, db)
    if not recipients:
        return
    claim_ref = claim.claim_reference or f"CLM-{claim.id}"
    body = f"Claim is awaiting action at stage {stage_number}."
    if note:
        body += f" {note}"
    for user_id in recipients:
        await create_notification(
            user_id=user_id,
            title=f"Approval required: {claim_ref}",
            body=body,
            link=f"/claims/{claim.id}/review",
            category=NotificationCategory.APPROVAL_REQUIRED.value,
            db=db,
        )


async def _notify_exception_approver(
    claim: ClaimDraft, req: ExceptionRequest, role: str, db: AsyncSession, note: str | None = None
) -> None:
    recipients = await _user_ids_for_exception_role(claim, role, db)
    claim_ref = claim.claim_reference or f"CLM-{claim.id}"
    body = f"Exception '{_humanize_token(req.exception_type)}' requires your review."
    if _route_key(req) == CLAIM_EXCEPTIONS_ROUTE:
        # One request listing every exception on the claim — decided one by one.
        items = [i for i in await _load_exception_items(req.id, db) if i.status == ExceptionRequestStatus.PENDING.value]
        listed = ", ".join(
            f"{i.expense_category_name or _humanize_token(i.exception_type)}"
            f"{f' (₹{i.claimed_amount:,.2f})' if i.claimed_amount is not None else ''}"
            for i in items
        )
        count = len(items)
        body = f"{count} policy exception{'s' if count != 1 else ''} on this claim need your decision: {listed}."
    elif req.expense_category_name:
        body = (
            f"Exception '{_humanize_token(req.exception_type)}' on {req.expense_category_name}"
            f"{f' (₹{req.claimed_amount:,.2f})' if req.claimed_amount is not None else ''} requires your review."
        )
    if req.description and _route_key(req) != CLAIM_EXCEPTIONS_ROUTE:
        body += f" Reason: {req.description}"
    if note:
        body += f" {note}"
    for user_id in recipients:
        await create_notification(
            user_id=user_id,
            title=f"Exception Approval Required: {claim_ref}",
            body=body,
            # The exceptions queue is where approvers act on these — there's no per-claim
            # exceptions page (the old /claims/{id}/exceptions link had no route).
            link="/hr/exceptions",
            category=NotificationCategory.EXCEPTION.value,
            db=db,
        )


async def _notify_employee_update(
    claim: ClaimDraft,
    title: str,
    body: str,
    category: NotificationCategory,
    db: AsyncSession,
) -> None:
    if not claim.employee_user_id:
        return
    await create_notification(
        user_id=int(claim.employee_user_id),
        title=title,
        body=body,
        link=f"/claims/{claim.id}",
        category=category.value,
        db=db,
    )


DEFAULT_WORKFLOW_CONFIG: dict = {
    "stages": [
        {"number": 1, "label": "Manager Review", "sla_hours": 48, "route_role": Role.REPORTING_MANAGER.value},
        {"number": 2, "label": "HR/HRBP Review", "sla_hours": 48, "route_role": Role.HRBP_HR.value},
        {"number": 3, "label": "Payroll Review", "sla_hours": 48, "route_role": Role.PAYROLL.value},
        {"number": 4, "label": "Finance / Payment", "sla_hours": 240, "route_role": Role.FINANCE.value},
    ],
    "exception_chains": dict(EXCEPTION_APPROVAL_CHAINS),
    "exception_submission_mode": dict(DEFAULT_EXCEPTION_SUBMISSION_MODE),
    "submission": {"late_after_days": DEFAULT_LATE_AFTER_DAYS, "archive_after_days": DEFAULT_ARCHIVE_AFTER_DAYS},
    "auto_approve_below_amount": "2000.00",
}


_ALLOWED_WORKFLOW_ROLES = {
    Role.REPORTING_MANAGER.value,
    Role.HRBP_HR.value,
    Role.PAYROLL.value,
    Role.FINANCE.value,
    Role.CEO.value,
    Role.GROUP_HEAD_HR.value,
    Role.IT_ADMIN.value,
    Role.RECRUITER.value,
    Role.ADMIN.value,
    "FUNCTION_HEAD",
    DEPARTMENT_HEAD,
}

# Non-claim approval workflows stored alongside the claim category overrides (same stage shape,
# no Finance stage): travel requests, and relocation approval requests.
_NON_CLAIM_WORKFLOWS = {"TRAVEL_REQUEST", "RELOCATION_REQUEST"}
_CATEGORY_OVERRIDE_KEYS = {c.value for c in ReimbursementCategory} | _NON_CLAIM_WORKFLOWS


def _validate_stage_list(stages: Any, *, label_prefix: str = "Stage", require_finance_stage: bool = True) -> None:
    if not isinstance(stages, list):
        raise HTTPException(status_code=422, detail=f"{label_prefix} list must be a list")
    if not 1 <= len(stages) <= 6:
        raise HTTPException(status_code=422, detail=f"{label_prefix} list must contain between 1 and 6 stages")

    finance_count = 0
    for idx, stage in enumerate(stages, start=1):
        if not isinstance(stage, dict):
            raise HTTPException(status_code=422, detail=f"{label_prefix} {idx} must be an object")
        if not isinstance(stage.get("label"), str) or not str(stage.get("label")).strip():
            raise HTTPException(status_code=422, detail=f"{label_prefix} {idx} label is required")
        if stage.get("route_role") not in _ALLOWED_WORKFLOW_ROLES:
            raise HTTPException(
                status_code=422,
                detail=f"{label_prefix} {idx} route_role '{stage.get('route_role')}' is unsupported",
            )
        if not isinstance(stage.get("sla_hours"), int) or int(stage["sla_hours"]) <= 0:
            raise HTTPException(status_code=422, detail=f"{label_prefix} {idx} sla_hours must be a positive integer")
        if stage.get("route_role") == Role.FINANCE.value:
            finance_count += 1

    if require_finance_stage and finance_count < 1:
        raise HTTPException(
            status_code=422,
            detail=f"{label_prefix} list must include at least one finance stage",
        )


def _validate_workflow_config(config: dict) -> None:
    if not isinstance(config, dict):
        raise HTTPException(status_code=422, detail="Workflow config must be an object")
    _validate_stage_list(config.get("stages"), label_prefix="Stage")
    allowed_roles = _ALLOWED_WORKFLOW_ROLES

    category_overrides = config.get("category_overrides")
    if category_overrides is not None:
        if not isinstance(category_overrides, dict):
            raise HTTPException(status_code=422, detail="category_overrides must be an object")
        for category, override in category_overrides.items():
            if category not in _CATEGORY_OVERRIDE_KEYS:
                raise HTTPException(status_code=422, detail=f"Unknown category override '{category}'")
            if not isinstance(override, dict):
                raise HTTPException(status_code=422, detail=f"category_overrides['{category}'] must be an object")
            if "stages" in override:
                _validate_stage_list(
                    override["stages"],
                    label_prefix=f"{category} override stage",
                    require_finance_stage=category not in _NON_CLAIM_WORKFLOWS,
                )
                # Department heads cover claims, travel requests and exceptions only.
                if category == "RELOCATION_REQUEST" and any(
                    isinstance(s, dict) and s.get("route_role") == DEPARTMENT_HEAD for s in override["stages"]
                ):
                    raise HTTPException(
                        status_code=422, detail="Relocation approvals can't have a Department head step"
                    )

    if DEPARTMENT_HEAD in ((config.get("exception_chains") or {}).get("POLICY_APPROVAL") or []):
        raise HTTPException(status_code=422, detail="Policy approval can't have a Department head step")

    department_heads = config.get("department_heads")
    if department_heads is not None:
        if not isinstance(department_heads, dict):
            raise HTTPException(status_code=422, detail="department_heads must be an object")
        for dept, entry in department_heads.items():
            if not isinstance(dept, str) or not dept.strip():
                raise HTTPException(status_code=422, detail="department_heads needs a department name for every entry")
            if not isinstance(entry, dict):
                raise HTTPException(status_code=422, detail=f"department_heads['{dept}'] must be an object")
            head_id = entry.get("head_user_id")
            if isinstance(head_id, bool) or not isinstance(head_id, int) or head_id <= 0:
                raise HTTPException(status_code=422, detail=f"department_heads['{dept}'] needs a head")
            for flow in DEPARTMENT_HEAD_FLOWS:
                if not isinstance(entry.get(flow, False), bool):
                    raise HTTPException(
                        status_code=422, detail=f"department_heads['{dept}'].{flow} must be true or false"
                    )

    submission = config.get("submission")
    if submission is None or not isinstance(submission, dict):
        raise HTTPException(status_code=422, detail="submission must be an object")

    # How long after a trip ends it can be claimed (claim_submission_rules.claim_windows). A config
    # saved before these settings existed has neither; the defaults apply.
    windows = {}
    for key, label in (("late_after_days", "Late claim after"), ("archive_after_days", "Archive after")):
        raw = submission.get(key)
        if raw is None:
            continue
        if isinstance(raw, bool) or not isinstance(raw, int) or not 1 <= raw <= 365:
            raise HTTPException(status_code=422, detail=f"{label} must be a whole number of days from 1 to 365")
        windows[key] = raw
    if windows.get("archive_after_days", DEFAULT_ARCHIVE_AFTER_DAYS) <= windows.get(
        "late_after_days", DEFAULT_LATE_AFTER_DAYS
    ):
        raise HTTPException(
            status_code=422, detail="Trips must be archived later than a claim becomes late"
        )

    raw_auto = config.get("auto_approve_below_amount")
    if raw_auto is None:
        raise HTTPException(status_code=422, detail="auto_approve_below_amount is required")
    try:
        auto_amt = Decimal(str(raw_auto))
    except InvalidOperation as exc:
        raise HTTPException(
            status_code=422,
            detail="auto_approve_below_amount must be a valid decimal amount",
        ) from exc
    if auto_amt < 0:
        raise HTTPException(
            status_code=422,
            detail="auto_approve_below_amount must be zero or greater",
        )
        
    exception_chains = config.get("exception_chains")
    if exception_chains is not None:
        if not isinstance(exception_chains, dict):
            raise HTTPException(status_code=422, detail="exception_chains must be a dictionary")
        for key, chain in exception_chains.items():
            if not isinstance(chain, list):
                raise HTTPException(status_code=422, detail=f"exception_chain '{key}' must be a list")
            # An empty chain creates zero ExceptionApproval rows (see init_claim_approval_chain),
            # so the request would never get an approver and would be stuck forever.
            if not chain:
                raise HTTPException(
                    status_code=422, detail=f"exception_chain '{key}' must have at least one approver role"
                )
            for role in chain:
                if role not in allowed_roles:
                    raise HTTPException(
                        status_code=422, detail=f"exception_chain '{key}' contains unsupported role '{role}'"
                    )
        # The shared exception routes. Older per-type keys may still be in a stored config; they're
        # checked as above but nothing new uses them.
        for route_key, label in SHARED_EXCEPTION_ROUTE_LABELS.items():
            route = exception_chains.get(route_key)
            if route is not None and len(route) > MAX_EXCEPTION_ROUTE_STEPS:
                raise HTTPException(
                    status_code=422,
                    detail=f"The {label} route can have at most {MAX_EXCEPTION_ROUTE_STEPS} steps",
                )

    exception_enabled = config.get("exception_enabled")
    if exception_enabled is not None:
        if not isinstance(exception_enabled, dict):
            raise HTTPException(status_code=422, detail="exception_enabled must be a dictionary")
        for key, val in exception_enabled.items():
            if not isinstance(val, bool):
                raise HTTPException(
                    status_code=422, detail=f"exception_enabled '{key}' must be true or false"
                )

    exception_sla = config.get("exception_sla_hours")
    if exception_sla is not None:
        if not isinstance(exception_sla, dict):
            raise HTTPException(status_code=422, detail="exception_sla_hours must be a dictionary")
        for key, hours_list in exception_sla.items():
            if not isinstance(hours_list, list):
                raise HTTPException(status_code=422, detail=f"exception_sla_hours '{key}' must be a list")
            for hours in hours_list:
                if isinstance(hours, bool) or not isinstance(hours, int) or not 1 <= hours <= 2000:
                    raise HTTPException(
                        status_code=422,
                        detail=f"exception_sla_hours '{key}' must be whole hours between 1 and 2000",
                    )

    submission_modes = config.get("exception_submission_mode")
    if submission_modes is not None:
        if not isinstance(submission_modes, dict):
            raise HTTPException(status_code=422, detail="exception_submission_mode must be a dictionary")
        for key, val in submission_modes.items():
            if val not in (EXCEPTION_SUBMISSION_ALLOW, EXCEPTION_SUBMISSION_BLOCK):
                raise HTTPException(
                    status_code=422,
                    detail=f"exception_submission_mode '{key}' must be {EXCEPTION_SUBMISSION_ALLOW} or "
                    f"{EXCEPTION_SUBMISSION_BLOCK}",
                )


def _normalize_stage_defs(config: dict) -> list[dict]:
    raw_stages = config.get("stages")
    if not isinstance(raw_stages, list) or not raw_stages:
        raw_stages = DEFAULT_WORKFLOW_CONFIG["stages"]
    ordered = sorted(raw_stages, key=lambda s: int(s.get("order", s.get("number", 9999))))
    stage_defs: list[dict] = []
    for idx, row in enumerate(ordered, start=1):
        num = int(row.get("number") or row.get("order") or idx)
        stage_defs.append(
            {
                "number": num,
                "label": str(row.get("label") or f"Stage {num}"),
                "sla_hours": int(row.get("sla_hours", 48)),
                "route_role": str(row.get("route_role") or ""),
                "parallel": bool(row.get("parallel")),
                "conditional": row.get("conditional"),  # Dictionary or None
            }
        )
    return stage_defs


async def get_workflow_config(db: AsyncSession, category: str | None = None) -> dict:
    """`category` (TRAVEL/GENERAL/RELOCATION) selects that category's stage override from
    config_json.category_overrides, if an admin has configured one — everything else
    (exception_chains, submission, auto_approve_below_amount) stays shared. With no
    override configured for that category, this returns exactly the same stages as
    category=None, so existing behavior is unchanged until an admin opts in."""
    row = await db.get(WorkflowConfigRow, 1)
    if row is None or not row.config_json:
        return dict(DEFAULT_WORKFLOW_CONFIG)
    merged = dict(DEFAULT_WORKFLOW_CONFIG)
    merged.update(row.config_json)
    if "stages" in row.config_json:
        merged["stages"] = row.config_json["stages"]
    if "exception_chains" in row.config_json:
        # Per-key merge, not a wholesale replace: a config saved before the shared exception
        # routes existed (it has the old per-type chains instead) gets their defaults, rather than
        # anything derived from those old chains.
        merged["exception_chains"] = {**EXCEPTION_APPROVAL_CHAINS, **row.config_json["exception_chains"]}
    # Same per-key merge, so a config saved before this setting existed still shows (and
    # applies) the defaults for every type.
    merged["exception_submission_mode"] = {
        **DEFAULT_EXCEPTION_SUBMISSION_MODE,
        **(row.config_json.get("exception_submission_mode") or {}),
    }
    if category:
        override = (row.config_json.get("category_overrides") or {}).get(category)
        if isinstance(override, dict) and override.get("stages"):
            merged["stages"] = override["stages"]
    return merged


_APPROVER_SCOPE_CATEGORIES = [c.value for c in ReimbursementCategory]


async def get_approver_scope(role: Role, db: AsyncSession) -> dict:
    """Which parts of the live Approval Matrix `role` currently appears in — claim categories,
    the travel-request chain, and exception chains. Used to decide whether approval-queue nav
    items / pages should be visible at all for this role, instead of a hardcoded per-role
    assumption that goes stale the moment an admin reconfigures routing (the recurring bug
    class this replaces — see navConfig.js / PendingApprovals.jsx / ExceptionRequestsPage.jsx).

    REPORTING_MANAGER/FUNCTION_HEAD route_role tokens are relative to each claim's employee,
    but checking the literal token against a stage's route_role is still the right question
    here: every user holding Role.REPORTING_MANAGER is exactly the kind of user that token
    routes to for *some* employee, so "is this token configured anywhere" answers "could a nav
    item ever be useful to this role," not "can I act on this specific claim" (that's
    _can_user_act_on_claim_stage's job, unchanged)."""
    role_val = role.value if isinstance(role, Role) else str(role)

    claim_categories: list[str] = []
    for category in _APPROVER_SCOPE_CATEGORIES:
        cfg = await get_workflow_config(db, category=category)
        stage_roles = {str(s.get("route_role") or "") for s in (cfg.get("stages") or [])}
        if role_val in stage_roles:
            claim_categories.append(category)

    # Deliberately NOT get_workflow_config(db, category="TRAVEL_REQUEST") — with no
    # category_overrides.TRAVEL_REQUEST configured, that call falls back to the *claim* default
    # stages (Manager/HRBP/Payroll/Finance), not the travel-request-specific single-stage
    # default. _travel_request_stage_defs is the one real source of truth for what a travel
    # request's chain actually resolves to (see init_travel_request_approval_chain) — reusing
    # it here instead of re-deriving the same fallback independently.
    base_cfg_for_travel = await get_workflow_config(db)
    travel_roles = {str(s.get("route_role") or "") for s in _travel_request_stage_defs(base_cfg_for_travel)}
    travel_request = role_val in travel_roles

    base_cfg = await get_workflow_config(db)
    exceptions: list[str] = []
    for route_key, types in EXCEPTION_TYPES_BY_ROUTE.items():
        if role_val in shared_exception_route(base_cfg, route_key):
            exceptions += list(types)
    if role_val in ((base_cfg.get("exception_chains") or {}).get("POLICY_APPROVAL") or []):
        exceptions.append("POLICY_APPROVAL")
    # Requests raised before the shared routes finish on their old per-type chain, so whoever
    # one of those is still waiting on keeps the Exception requests page until it's decided.
    legacy_waiting = (
        await db.execute(
            select(ExceptionRequest.exception_types)
            .join(ExceptionApproval, ExceptionApproval.exception_request_id == ExceptionRequest.id)
            .where(
                ExceptionRequest.route_key.is_(None),
                ExceptionRequest.status == ExceptionRequestStatus.PENDING.value,
                ExceptionApproval.status.in_([ExceptionRequestStatus.PENDING.value, "AWAITING"]),
                ExceptionApproval.required_role == role_val,
            )
        )
    ).scalars().all()
    for types in legacy_waiting:
        exceptions += [t for t in (types or []) if t not in exceptions]
    relocation_roles = {str(s.get("route_role") or "") for s in relocation_request_stage_defs(base_cfg)}

    return {
        "claims": bool(claim_categories),
        "claim_categories": claim_categories,
        "travel_request": travel_request,
        "exceptions": exceptions,
        "relocation": role_val in relocation_roles,
    }


# REPORTING_MANAGER and FUNCTION_HEAD are resolved relative to each claim's employee
# (see _user_ids_for_role / _get_function_head), so an org-wide "any user has this role"
# count doesn't reflect real routing capability for them — only check the absolute roles.
_ROLES_REQUIRING_COVERAGE = _ALLOWED_WORKFLOW_ROLES - {Role.REPORTING_MANAGER.value, "FUNCTION_HEAD", DEPARTMENT_HEAD}


async def department_head_candidates(db: AsyncSession) -> list[dict]:
    """Active people who can be named a department head: those whose role can approve claims
    (Role permissions -> approve_claims). The approve endpoints check that permission, so anyone
    else picked as head would be shown items they could never act on."""
    from app.services.permission_config_service import get_effective_permission_matrix

    matrix = await get_effective_permission_matrix(db)
    roles = [role for role, perms in matrix.items() if "approve_claims" in perms]
    can_approve = User.role.in_(roles)
    # Managers get the Manager row (REPORTING_MANAGER key) on top of their role.
    if "approve_claims" in matrix.get(Role.REPORTING_MANAGER, set()):
        can_approve = or_(can_approve, User.is_manager.is_(True), User.role.in_(MANAGER_ROLES))
    rows = (
        await db.execute(
            select(User, Employee)
            .outerjoin(Employee, Employee.employee_id == User.employee_id)
            .where(User.is_active.is_(True), can_approve)
            .order_by(User.full_name, User.email)
        )
    ).all()
    return [
        {
            "user_id": user.id,
            "name": user.full_name or (employee.full_name if employee else None) or user.email,
            "email": user.email,
            "role": user.role.value,
            "department": employee.department if employee else None,
        }
        for user, employee in rows
    ]


async def _assert_department_heads_valid(config: dict, db: AsyncSession) -> None:
    """Every named head must be an active person who can approve (see department_head_candidates)."""
    heads = config.get("department_heads") or {}
    if not heads:
        return
    allowed = {p["user_id"] for p in await department_head_candidates(db)}
    for dept, entry in heads.items():
        if int(entry["head_user_id"]) not in allowed:
            raise HTTPException(
                status_code=422,
                detail=f"The head picked for {dept} isn't an active person who can approve claims",
            )


async def _assert_roles_have_active_users(config: dict, db: AsyncSession) -> None:
    """Every absolute role a request could wait on — in a stage list (claims, travel and
    relocation requests), in a shared exception route
    while at least one of its exception types is switched on, or in Policy approval — needs at
    least one active person holding it."""
    route_roles: set[str] = {s.get("route_role") for s in config.get("stages") or [] if isinstance(s, dict)}
    for override in (config.get("category_overrides") or {}).values():
        if not isinstance(override, dict):
            continue
        route_roles |= {s.get("route_role") for s in override.get("stages") or [] if isinstance(s, dict)}
    chain_roles: dict[str, str] = {}
    for route_key, label in SHARED_EXCEPTION_ROUTE_LABELS.items():
        if not is_exception_route_in_use(config, route_key):
            continue
        for role in shared_exception_route(config, route_key):
            chain_roles.setdefault(role, f"the {label} route")
    policy_chain = (config.get("exception_chains") or {}).get("POLICY_APPROVAL")
    for role in policy_chain if isinstance(policy_chain, list) else []:
        chain_roles.setdefault(role, "the Policy approval route")
    route_roles &= _ROLES_REQUIRING_COVERAGE

    for role in sorted(route_roles | (set(chain_roles) & _ROLES_REQUIRING_COVERAGE)):
        count = (
            await db.execute(
                select(func.count()).select_from(User).where(User.role == role, User.is_active.is_(True))
            )
        ).scalar_one()
        if not count:
            where = "a stage" if role in route_roles else chain_roles[role]
            raise HTTPException(
                status_code=422,
                detail=f"Role '{role}' is used in {where} but no active user currently has that role",
            )


def _effective_claim_stage_defs_from_raw(cfg: dict, category: str) -> list[dict]:
    """Same category-override-with-fallback resolution as get_workflow_config(db, category=...),
    but operating on a plain config dict already in hand — used to diff an old config against a
    new one at save time without a second DB round-trip (see _migrate_inflight_approvals)."""
    merged = dict(DEFAULT_WORKFLOW_CONFIG)
    merged.update(cfg or {})
    if cfg and "stages" in cfg:
        merged["stages"] = cfg["stages"]
    override = ((cfg or {}).get("category_overrides") or {}).get(category)
    if isinstance(override, dict) and override.get("stages"):
        merged["stages"] = override["stages"]
    return _normalize_stage_defs(merged)


def _single_role_stage_swaps(old_defs: list[dict], new_defs: list[dict]) -> dict[int, tuple[str, str, dict]]:
    """Stage numbers where exactly one role served before and exactly one, different, role
    serves now — {stage_number: (old_role, new_role, new_stage_def)}. A stage number that's
    parallel (more than one role sharing that number) on either side, or that doesn't exist on
    both sides, is left out entirely: those are structural chain edits (branch added/removed,
    stage added/removed/reordered), not a plain reassignment, and are out of scope for the
    automatic in-flight migration below — see save_workflow_config's note."""
    # A step added or removed shifts every later step's number, so "stage 4 used to be Finance,
    # now it's the new step" would wrongly re-route everything waiting at Finance. Different
    # lengths are a structural edit: leave in-flight requests alone, as described above.
    if len(old_defs) != len(new_defs):
        return {}
    old_by_number: dict[int, list[dict]] = {}
    for d in old_defs:
        old_by_number.setdefault(int(d["number"]), []).append(d)
    new_by_number: dict[int, list[dict]] = {}
    for d in new_defs:
        new_by_number.setdefault(int(d["number"]), []).append(d)

    swaps: dict[int, tuple[str, str, dict]] = {}
    for number, old_group in old_by_number.items():
        if len(old_group) != 1:
            continue
        new_group = new_by_number.get(number)
        if not new_group or len(new_group) != 1:
            continue
        old_role = str(old_group[0].get("route_role") or "")
        new_def = new_group[0]
        new_role = str(new_def.get("route_role") or "")
        if old_role and new_role and old_role != new_role:
            swaps[number] = (old_role, new_role, new_def)
    return swaps


async def _reassign_pending_claim_stages(
    category: str, swaps: dict[int, tuple[str, str, dict]], db: AsyncSession
) -> int:
    if not swaps:
        return 0
    rows = (
        await db.execute(
            select(ClaimApprovalStage, ClaimDraft)
            .join(ClaimDraft, ClaimDraft.id == ClaimApprovalStage.claim_id)
            .where(
                ClaimApprovalStage.status == ClaimApprovalStageStatus.PENDING.value,
                ClaimDraft.reimbursement_category == ReimbursementCategory(category),
            )
        )
    ).all()
    now = _now()
    count = 0
    for stage, claim in rows:
        swap = swaps.get(stage.stage_number)
        if not swap:
            continue
        old_role, new_role, new_def = swap
        if stage.required_role != old_role:
            continue
        stage.required_role = new_role
        stage.stage_label = str(new_def.get("label") or stage.stage_label)
        stage.sla_deadline_at = await sla_deadline(db, int(new_def.get("sla_hours", DEFAULT_SLA_HOURS)), now)
        stage.last_notified_at = now
        stage.sla_breached_at = None
        await _notify_stage_approver(claim, new_def, db)
        count += 1
    return count


async def _reassign_pending_travel_stages(swaps: dict[int, tuple[str, str, dict]], db: AsyncSession) -> int:
    if not swaps:
        return 0
    from app.models.travel_request import TravelRequest, TravelRequestApprovalStage

    rows = (
        await db.execute(
            select(TravelRequestApprovalStage, TravelRequest)
            .join(TravelRequest, TravelRequest.id == TravelRequestApprovalStage.travel_request_id)
            .where(TravelRequestApprovalStage.status == ClaimApprovalStageStatus.PENDING.value)
        )
    ).all()
    now = _now()
    count = 0
    for stage, travel_request in rows:
        swap = swaps.get(stage.stage_number)
        if not swap:
            continue
        old_role, new_role, new_def = swap
        if stage.required_role != old_role:
            continue
        stage.required_role = new_role
        stage.stage_label = str(new_def.get("label") or stage.stage_label)
        stage.sla_deadline_at = await sla_deadline(db, int(new_def.get("sla_hours", DEFAULT_SLA_HOURS)), now)
        stage.last_notified_at = now
        stage.sla_breached_at = None
        await _notify_travel_stage_approver(travel_request, new_def, db)
        count += 1
    return count


async def _reassign_pending_exception_approvals(old_cfg: dict, new_cfg: dict, db: AsyncSession) -> int:
    """A shared exception route is a flat ordered role list (not stage-numbered), so the 1-for-1
    comparison is by position in that list instead of by stage number — same unchanged-length-only
    scope as the stage migration above. A request whose Department head step was left out (see
    _without_inapplicable_head) is compared without that step on both sides. Requests raised
    before the shared routes (no route_key) finish on the chain they were created with, so they're
    never moved."""
    open_reqs = (
        await db.execute(
            select(ExceptionRequest).where(
                ExceptionRequest.route_key.isnot(None),
                ExceptionRequest.status.in_(
                    [ExceptionRequestStatus.PENDING.value, ExceptionRequestStatus.SENT_BACK.value]
                ),
            )
        )
    ).scalars().all()

    count = 0
    for req in open_reqs:
        if req.route_key not in SHARED_EXCEPTION_ROUTE_LABELS:
            continue
        approvals = (
            await db.execute(
                select(ExceptionApproval)
                .where(ExceptionApproval.exception_request_id == req.id)
                .order_by(ExceptionApproval.id)
            )
        ).scalars().all()
        old_chain = shared_exception_route(old_cfg, req.route_key)
        new_chain = shared_exception_route(new_cfg, req.route_key)
        if DEPARTMENT_HEAD not in {a.required_role for a in approvals}:
            old_chain = [r for r in old_chain if r != DEPARTMENT_HEAD]
            new_chain = [r for r in new_chain if r != DEPARTMENT_HEAD]
        if len(old_chain) != len(new_chain) or len(old_chain) != len(approvals):
            continue
        swaps = {i: (o, n) for i, (o, n) in enumerate(zip(old_chain, new_chain, strict=True)) if o != n}
        if not swaps:
            continue

        subject_claim = await db.get(ClaimDraft, req.claim_id) if req.claim_id is not None else None
        subject_travel = None
        if req.travel_request_id is not None:
            from app.models.travel_request import TravelRequest

            subject_travel = await db.get(TravelRequest, req.travel_request_id)

        for idx, approval in enumerate(approvals):
            # A step that sent exceptions back keeps its approver: the claim returns to them.
            if approval.status not in (ExceptionRequestStatus.PENDING.value, "AWAITING"):
                continue
            swap = swaps.get(idx)
            if not swap:
                continue
            old_role, new_role = swap
            if approval.required_role != old_role:
                continue
            approval.required_role = new_role
            count += 1
            if approval.status == ExceptionRequestStatus.PENDING.value:
                await start_exception_step(approval, req, new_cfg, db)
                if subject_claim is not None:
                    await _notify_exception_approver(subject_claim, req, new_role, db)
                elif subject_travel is not None:
                    await _notify_travel_exception_approver(subject_travel, req, new_role, db)
    return count


async def _migrate_inflight_approvals(old_config: dict | None, new_config: dict, db: AsyncSession) -> dict[str, int]:
    """Called from save_workflow_config on every save: when a stage/route's role changed for an
    unchanged step count, requests already sitting at that exact step move to the new role
    immediately (SLA clock reset, new approver notified) instead of staying frozen on whoever
    used to own it. Structural edits (step added/removed/reordered, a parallel branch
    added/removed) are deliberately left alone — see _single_role_stage_swaps' docstring."""
    old_cfg = old_config or dict(DEFAULT_WORKFLOW_CONFIG)
    migrated = {"claims": 0, "travel_request": 0, "exceptions": 0}

    for category in [c.value for c in ReimbursementCategory]:
        old_defs = _effective_claim_stage_defs_from_raw(old_cfg, category)
        new_defs = _effective_claim_stage_defs_from_raw(new_config, category)
        swaps = _single_role_stage_swaps(old_defs, new_defs)
        migrated["claims"] += await _reassign_pending_claim_stages(category, swaps, db)

    travel_swaps = _single_role_stage_swaps(_travel_request_stage_defs(old_cfg), _travel_request_stage_defs(new_config))
    migrated["travel_request"] = await _reassign_pending_travel_stages(travel_swaps, db)

    migrated["exceptions"] = await _reassign_pending_exception_approvals(old_cfg, new_config, db)

    return migrated


async def save_workflow_config(config: dict, user_id: int | None, db: AsyncSession) -> tuple[dict, dict[str, int]]:
    _validate_workflow_config(config)
    await _assert_roles_have_active_users(config, db)
    await _assert_department_heads_valid(config, db)
    row = await db.get(WorkflowConfigRow, 1)
    old_config = row.config_json if row is not None else None
    if row is None:
        row = WorkflowConfigRow(id=1, config_json=config, updated_by_user_id=user_id)
        db.add(row)
    else:
        row.config_json = config
        row.updated_by_user_id = user_id
    await log_event(
        entity_type="workflow_config",
        entity_id="1",
        action="update_workflow_config",
        actor_id=user_id,
        old=old_config,
        new=config,
        db=db,
    )
    migrated = await _migrate_inflight_approvals(old_config, config, db)
    await db.commit()
    await db.refresh(row)
    return row.config_json, migrated


def _stage_hours(stage_defs: list[dict], stage_number: int) -> int:
    for s in stage_defs:
        if int(s["number"]) == stage_number:
            return int(s["sla_hours"])
    return 48


def _authoritative_payable_amount(claim: ClaimDraft) -> Decimal:
    if claim.approved_amount is not None:
        return claim.approved_amount.quantize(Decimal("0.01"))
    report = claim.compliance_report or {}
    try:
        return Decimal(str(report.get("net_payable", "0"))).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0.00")


async def _load_stages(claim_id: int, db: AsyncSession) -> list[ClaimApprovalStage]:
    result = await db.execute(
        select(ClaimApprovalStage)
        .where(ClaimApprovalStage.claim_id == claim_id)
        .order_by(ClaimApprovalStage.stage_number)
    )
    return list(result.scalars().all())


def _active_pending_stage(claim: ClaimDraft, stages: list[ClaimApprovalStage]) -> ClaimApprovalStage | None:
    if claim.current_approval_stage is None:
        return None
    row = next((s for s in stages if s.stage_number == claim.current_approval_stage), None)
    if row is None or row.status != ClaimApprovalStageStatus.PENDING.value:
        return None
    return row


def already_decided_by(stages: list[ClaimApprovalStage], user_id: int, before_stage_number: int) -> bool:
    """True when this user approved an earlier stage of the claim — a repeat click (or a second
    tab) arriving after their decision already moved the claim on."""
    return any(
        s.stage_number < before_stage_number
        and s.decided_by_user_id == user_id
        and s.status == ClaimApprovalStageStatus.APPROVED.value
        for s in stages
    )


# Roles shared by a pool of people. A claimant who is the only active person in one of these
# pools can't approve their own claim there, so that stage is skipped (see _activate_stage_rows).
# Not FINANCE: Finance records the payment, so its stage is never skipped. The manager and
# department-head steps never land on the claimant themselves.
_SELF_SKIPPABLE_ROLES = {
    Role.HRBP_HR.value, Role.PAYROLL.value, Role.CEO.value, Role.GROUP_HEAD_HR.value,
    Role.RECRUITER.value, Role.IT_ADMIN.value, Role.ADMIN.value,
}
SELF_SKIP_NOTE = "Skipped — the claimant can't approve their own claim and is the only approver for this step."


def override_note(user: User, reason: str) -> str:
    """What an admin override records as the step's comment (see override_service)."""
    return f"Admin override by {user.full_name or user.email}: {reason.strip()}"


def _assert_can_override(user: User, subject_user_id: int | None) -> None:
    if is_own_item(user, subject_user_id):
        raise HTTPException(status_code=403, detail="You can't override your own item")


def is_own_item(user: User, subject_user_id: int | None) -> bool:
    """Nobody approves, rejects or sends back their own claim, exception or request — directly or
    as anyone's delegate."""
    return subject_user_id is not None and user.id == subject_user_id


async def _claimant_is_only_approver(claim: ClaimDraft, row: ClaimApprovalStage, db: AsyncSession) -> bool:
    """True when this pooled-role stage could only ever be acted on by the claimant: they hold
    the role, nobody else active does, and they haven't delegated it to anyone."""
    if row.required_role not in _SELF_SKIPPABLE_ROLES:
        return False
    claimant = await db.get(User, claim.employee_user_id)
    if claimant is None or claimant.role.value != row.required_role:
        return False
    others = (
        await db.execute(
            select(func.count(User.id)).where(
                User.role == Role(row.required_role), User.is_active.is_(True), User.id != claimant.id
            )
        )
    ).scalar_one()
    if others:
        return False
    from app.services.delegation_service import is_delegation_enabled

    if await is_delegation_enabled(db):
        now = _now()
        delegated = (
            await db.execute(
                select(func.count(Delegation.id)).where(
                    Delegation.delegator_id == claimant.id,
                    Delegation.delegatee_id != claimant.id,
                    Delegation.is_active,
                    Delegation.start_date <= now,
                    Delegation.end_date >= now,
                )
            )
        ).scalar_one()
        if delegated:
            return False
    return True


async def _activate_stage_rows(
    claim: ClaimDraft,
    rows: list[ClaimApprovalStage],
    row_defs: list[dict],
    stage_defs: list[dict],
    stage_number: int,
    now: datetime,
    db: AsyncSession,
    note: str | None = None,
) -> None:
    """Open the given stage's row(s) (one per parallel branch): PENDING, SLA clock started in
    working hours, approver(s) notified (with `note` appended, if any).

    A stage only the claimant could act on (see _claimant_is_only_approver) is skipped instead:
    marked SKIPPED_OWN and the next stage opened the same way. The last stage is never skipped."""
    if rows and all([await _claimant_is_only_approver(claim, row, db) for row in rows]):
        all_stages = await _load_stages(claim.id, db)
        next_number = min((s.stage_number for s in all_stages if s.stage_number > stage_number), default=None)
        if next_number is not None:
            for row in rows:
                row.status = STAGE_STATUS_SKIPPED_OWN
                row.decided_at = now
                row.comment = SELF_SKIP_NOTE
                row.sla_deadline_at = None
            await log_event(
                entity_type="claim_draft",
                entity_id=str(claim.id),
                action="stage_skipped_own",
                actor_id=None,
                old={"current_approval_stage": stage_number},
                new={"stage_number": stage_number, "current_approval_stage": next_number, "comment": SELF_SKIP_NOTE},
                db=db,
            )
            next_rows = [s for s in all_stages if s.stage_number == next_number]
            next_defs = [sd for sd in stage_defs if int(sd["number"]) == next_number]
            claim.current_approval_stage = next_number
            is_finance = any(str(sd.get("route_role")) == Role.FINANCE.value for sd in next_defs)
            if is_finance and await has_pending_claim_exceptions(claim.id, db):
                return  # held from Finance until its exceptions are decided (see release_claim_to_finance)
            if is_finance:
                claim.status = ClaimStatus.READY_FOR_PAYMENT
            await _activate_stage_rows(claim, next_rows, next_defs, stage_defs, next_number, now, db, note)
            return
    deadline = await sla_deadline(db, _stage_hours(stage_defs, stage_number), now)
    for row in rows:
        row.status = ClaimApprovalStageStatus.PENDING.value
        row.sla_deadline_at = deadline
        row.last_notified_at = now
        row.sla_breached_at = None
        row_def = next((sd for sd in row_defs if sd["route_role"] == row.required_role), None)
        if row_def:
            await _notify_stage_approver(claim, row_def, db, note)


async def release_claim_to_finance(claim: ClaimDraft, db: AsyncSession) -> bool:
    """A claim with exceptions waits at its finance stage with that stage NOT_STARTED, hidden
    from Finance (see init_claim_exception_route; also approve_claim_stage's hold for any claim
    still on the older parallel route). Once its last exception is approved this opens the
    finance stage — READY_FOR_PAYMENT, same as an ordinary claim reaching Finance. Returns False
    (no-op) for any claim not waiting there."""
    if (
        claim.status not in (ClaimStatus.IN_APPROVAL, ClaimStatus.PENDING_EXCEPTION)
        or claim.current_approval_stage is None
    ):
        return False
    stages = await _load_stages(claim.id, db)
    rows = [s for s in stages if s.stage_number == claim.current_approval_stage]
    if not rows or any(s.status != STAGE_STATUS_NOT_STARTED for s in rows):
        return False
    cfg = await get_workflow_config(db, category=claim.reimbursement_category.value)
    stage_defs = _normalize_stage_defs(cfg)
    row_defs = [sd for sd in stage_defs if int(sd["number"]) == claim.current_approval_stage]
    if not any(str(sd.get("route_role")) == Role.FINANCE.value for sd in row_defs):
        return False
    previous_status = claim.status.value
    claim.status = ClaimStatus.READY_FOR_PAYMENT
    await _activate_stage_rows(claim, rows, row_defs, stage_defs, claim.current_approval_stage, _now(), db)
    await log_event(
        entity_type="claim_draft",
        entity_id=str(claim.id),
        action="release_to_finance",
        actor_id=None,
        old={"status": previous_status},
        new={"status": claim.status.value, "current_approval_stage": claim.current_approval_stage},
        db=db,
    )
    return True


async def init_claim_exception_route(claim: ClaimDraft, db: AsyncSession, *, exceptions_pending: bool) -> None:
    """Route for a claim with policy exceptions: its exception approvers ARE its approval — it
    skips the normal approval stages entirely and goes to Finance for payment once every
    exception is approved (a claim with no exceptions uses init_claim_approval_chain instead).

    Only the finance stage row(s) are created. While exceptions are pending the claim sits in
    PENDING_EXCEPTION with that stage NOT_STARTED (hidden from Finance); the last exception
    approval opens it via release_claim_to_finance. With nothing pending (every exception was
    already approved, e.g. a resubmission with unchanged amounts) it goes to Finance right away."""
    cfg = await get_workflow_config(db, category=claim.reimbursement_category.value)
    stage_defs = _normalize_stage_defs(cfg)
    finance_defs = [s for s in stage_defs if str(s.get("route_role")) == Role.FINANCE.value]
    # Saving the config requires a finance stage, so this fallback is only defensive.
    finance_number = int((finance_defs or stage_defs)[-1]["number"])
    row_defs = [s for s in stage_defs if int(s["number"]) == finance_number]
    now = _now()

    await db.execute(delete(ClaimApprovalStage).where(ClaimApprovalStage.claim_id == claim.id))
    claim.claim_reference = claim.claim_reference or f"CLM-{now.year}-{claim.id:04d}"
    rows = []
    for row_def in row_defs:
        row = ClaimApprovalStage(
            claim_id=claim.id,
            stage_number=finance_number,
            stage_label=str(row_def["label"]),
            required_role=row_def["route_role"],
            status=STAGE_STATUS_NOT_STARTED,
        )
        db.add(row)
        rows.append(row)
    await db.flush()

    claim.current_approval_stage = finance_number
    if exceptions_pending:
        claim.status = ClaimStatus.PENDING_EXCEPTION
    else:
        claim.status = ClaimStatus.READY_FOR_PAYMENT
        await _activate_stage_rows(claim, rows, row_defs, stage_defs, finance_number, now, db)


async def _can_user_act_on_exception(
    user: User, exc: ExceptionRequest, approvals: list[ExceptionApproval], db: AsyncSession
) -> bool:
    if exc.status != ExceptionRequestStatus.PENDING.value:
        return False
    sorted_apprs = sorted(approvals, key=lambda x: x.id)
    active_stage = None
    for a in sorted_apprs:
        if a.status in (ExceptionRequestStatus.PENDING.value, "AWAITING"):
            active_stage = a
            break
    if active_stage is None or active_stage.status != ExceptionRequestStatus.PENDING.value:
        return False

    subject_employee_id = None
    if exc.claim_id is not None:
        claim = await db.get(ClaimDraft, exc.claim_id)
        if claim is None or is_own_item(user, claim.employee_user_id):
            return False
        subject_employee_id = claim.employee_id
    else:
        from app.models.travel_request import TravelRequest

        travel_request = await db.get(TravelRequest, exc.travel_request_id)
        if travel_request is None or is_own_item(user, travel_request.employee_user_id):
            return False
        subject_user = await db.get(User, travel_request.employee_user_id)
        subject_employee_id = subject_user.employee_id if subject_user else None

    return await _user_matches_required_role(user, active_stage.required_role, subject_employee_id, db)


async def _user_matches_required_role(
    user: User, required_role: str, subject_employee_id: str | None, db: AsyncSession
) -> bool:
    """Does `user` satisfy `required_role` for this subject employee — directly, or via an
    active delegation from whoever actually holds (or would hold) that role? Shared by
    exception decision-making (decide_exception_request) and the read-side check above, so
    the two can never drift out of sync the way they used to (one supported delegation for
    pooled roles, the other didn't; one had a query bug that crashed, the other didn't)."""
    active_delegator_ids = await _active_delegator_ids(user.id, db)
    delegator_emp_ids: list[str] = []
    delegator_roles: set[Role] = set()
    if active_delegator_ids:
        delegator_emp_ids = (
            await db.execute(select(User.employee_id).where(User.id.in_(active_delegator_ids)))
        ).scalars().all()
        delegator_roles = set(
            (await db.execute(select(User.role).where(User.id.in_(active_delegator_ids)))).scalars().all()
        )

    if required_role == Role.REPORTING_MANAGER.value:
        if not subject_employee_id:
            return True
        emp = await db.get(Employee, subject_employee_id)
        if emp is None:
            return True
        if emp.reporting_manager_id == user.employee_id:
            return True
        return bool(delegator_emp_ids) and emp.reporting_manager_id in delegator_emp_ids
    if required_role == "FUNCTION_HEAD":
        if not subject_employee_id:
            return False
        fh = await _get_function_head(subject_employee_id, db)
        if not fh:
            return False
        if fh.employee_id == user.employee_id:
            return True
        return bool(delegator_emp_ids) and fh.employee_id in delegator_emp_ids
    if required_role == DEPARTMENT_HEAD:
        head = await _department_head_user(subject_employee_id, db)
        return head is not None and (head.id == user.id or head.id in active_delegator_ids)
    try:
        role_enum = Role(required_role)
    except ValueError:
        return False
    return user.role == role_enum or role_enum in delegator_roles


async def _can_user_act_on_claim_stage(
    user: User, claim: ClaimDraft, stage_def: dict, db: AsyncSession, *, stage_row: ClaimApprovalStage | None = None, active_delegator_ids: list[int] | None = None
) -> bool:
    if active_delegator_ids is None:
        active_delegator_ids = []
    if is_own_item(user, claim.employee_user_id):
        return False  # never on your own claim, whatever your role or whoever you're covering for

    route_role = stage_row.required_role if stage_row and stage_row.required_role else str(stage_def.get("route_role") or "")
    if route_role == Role.REPORTING_MANAGER.value:
        # The claimant's own manager (or someone covering for them) acts here, whatever their
        # role. Only a claim with no employee record falls back to any manager.
        has_role = is_manager(user)
        if not claim.employee_id:
            return has_role
        emp = await db.get(Employee, claim.employee_id)
        if emp is None:
            return has_role

        # Check if user is the manager
        if user.employee_id and emp.reporting_manager_id == user.employee_id:
            return True
            
        # Check if any active delegator is the manager
        if active_delegator_ids:
            delegators_q = select(User.employee_id).where(User.id.in_(active_delegator_ids))
            delegator_emp_ids = (await db.execute(delegators_q)).scalars().all()
            if emp.reporting_manager_id in delegator_emp_ids:
                return True
            
        # Check skip-level if breached
        stages = await db.execute(
            select(ClaimApprovalStage).where(ClaimApprovalStage.claim_id == claim.id)
        )
        stages = stages.scalars().all()
        pending = next((s for s in stages if s.stage_number == claim.current_approval_stage), None)
        if pending and pending.sla_deadline_at and pending.sla_deadline_at < _now():
            manager_emp = await db.get(Employee, emp.reporting_manager_id)
            if manager_emp and manager_emp.reporting_manager_id:
                if user.employee_id and manager_emp.reporting_manager_id == user.employee_id:
                    return True
                if active_delegator_ids and manager_emp.reporting_manager_id in delegator_emp_ids:
                    return True
        return False
        
    # Generic role check with delegations
    def has_required_role(r: str):
        if user.role.value == r:
            return True
        return False

    has_role = has_required_role(route_role)
    if not has_role and active_delegator_ids:
        # Check if any delegator has this role
        delegator_roles_q = select(User.role).where(User.id.in_(active_delegator_ids))
        roles = (await db.execute(delegator_roles_q)).scalars().all()
        if any(r.value == route_role for r in roles):
            has_role = True

    if route_role == Role.HRBP_HR.value:
        return has_role
    if route_role == Role.PAYROLL.value:
        return has_role
    if route_role == Role.FINANCE.value:
        return has_role
    if route_role == Role.CEO.value:
        return has_role
    if route_role == Role.GROUP_HEAD_HR.value:
        return has_role
    if route_role == Role.RECRUITER.value:
        return has_role
    if route_role == Role.IT_ADMIN.value:
        return has_role
    if route_role == Role.ADMIN.value:
        return has_role
    if route_role == "FUNCTION_HEAD":
        if not claim.employee_id:
            return False
        fh = await _get_function_head(claim.employee_id, db)
        if fh and user.employee_id and fh.employee_id == user.employee_id:
            return True
        if fh and active_delegator_ids:
            delegators_q = select(User.employee_id).where(User.id.in_(active_delegator_ids))
            delegator_emp_ids = (await db.execute(delegators_q)).scalars().all()
            if fh.employee_id in delegator_emp_ids:
                return True
        return False
    if route_role == DEPARTMENT_HEAD:
        head = await _department_head_user(claim.employee_id, db)
        return head is not None and (head.id == user.id or head.id in active_delegator_ids)
    return False


async def init_claim_approval_chain(claim: ClaimDraft, db: AsyncSession) -> None:
    cfg = await get_workflow_config(db, category=claim.reimbursement_category.value)
    stage_defs = _normalize_stage_defs(cfg)
    now = _now()
    total = total_claimed_from_report(claim)

    await db.execute(delete(ClaimApprovalStage).where(ClaimApprovalStage.claim_id == claim.id))
    claim.claim_reference = claim.claim_reference or f"CLM-{now.year}-{claim.id:04d}"

    if claim.status == ClaimStatus.PENDING_EXCEPTION:
        # Initialize exception approval stages
        result = await db.execute(
            select(ExceptionRequest).where(
                ExceptionRequest.claim_id == claim.id,
                ExceptionRequest.status == ExceptionRequestStatus.PENDING.value
            )
        )
        requests = result.scalars().all()
        chains_by_req: dict[int, list[str]] = {}
        for req in requests:
            chains_by_req[req.id] = await _without_inapplicable_head(
                _legacy_exception_chain(cfg, req.exception_type), claim.employee_id, "exceptions", cfg, db
            )
        for req in requests:
            # Check if stages already exist to prevent duplicate creation
            existing = (await db.execute(
                select(ExceptionApproval).where(ExceptionApproval.exception_request_id == req.id)
            )).scalars().all()
            if existing:
                continue

            chain = chains_by_req[req.id]
            for i, role in enumerate(chain):
                status_val = ExceptionRequestStatus.PENDING.value if i == 0 else "AWAITING"
                db.add(
                    ExceptionApproval(
                        exception_request_id=req.id,
                        required_role=role,
                        status=status_val
                    )
                )
        await db.flush()
        # Notify first approvers of exceptions
        for req in requests:
            chain = chains_by_req[req.id]
            if chain:
                await _notify_exception_approver(claim, req, chain[0], db)
        return

    claim.status = ClaimStatus.IN_APPROVAL
    claim.current_approval_stage = int(stage_defs[0]["number"])

    total = total_claimed_from_report(claim)
    employee = await db.get(Employee, claim.employee_id) if claim.employee_id else None

    def _eval_cond(cond: Any) -> bool:
        if not cond or not isinstance(cond, dict):
            return True
        field = cond.get("field")
        op = cond.get("operator", "==")
        val = cond.get("value")
        
        target = None
        if field == "amount":
            target = total
        elif field == "department" and employee:
            target = employee.department
            
        if target is None:
            return True
            
        try:
            if op == ">":
                return target > Decimal(str(val))
            if op == "<":
                return target < Decimal(str(val))
            if op == "==":
                return str(target).lower() == str(val).lower()
        except Exception:
            return True
        return True

    head_applies = await department_head_applies(claim.employee_id, "claims", cfg, db)
    filtered_defs = [
        s
        for s in stage_defs
        if _eval_cond(s.get("conditional")) and (s["route_role"] != DEPARTMENT_HEAD or head_applies)
    ]
    if not filtered_defs:
        filtered_defs = stage_defs[:1]

    min_n = min(int(s["number"]) for s in filtered_defs)
    claim.current_approval_stage = min_n

    active_stages = []
    for stage in filtered_defs:
        n = int(stage["number"])
        row = ClaimApprovalStage(
            claim_id=claim.id,
            stage_number=n,
            stage_label=str(stage["label"]),
            required_role=stage["route_role"],
            status=STAGE_STATUS_NOT_STARTED,
        )
        db.add(row)
        if n == min_n:
            active_stages.append(row)

    await db.flush()
    # Opened like every later stage: SLA clock, approver notified — or skipped if only the
    # claimant could approve it.
    first_defs = [s for s in filtered_defs if int(s["number"]) == min_n]
    await _activate_stage_rows(claim, active_stages, first_defs, filtered_defs, min_n, now, db)


async def assert_user_can_view_claim_workflow(claim_id: int, user_id: int, db: AsyncSession) -> ClaimDraft:
    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.employee_user_id == user_id:
        return claim
    
    if claim.status == ClaimStatus.DRAFT.value:
        raise HTTPException(status_code=403, detail="Cannot view another employee's draft claim")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=403, detail="Forbidden")
        
    if await is_direct_report(manager_user_id=user_id, target_user_id=claim.employee_user_id, db=db):
        return claim

    from app.services.permission_config_service import get_effective_permission_matrix

    matrix = await get_effective_permission_matrix(db)
    viewer_ok = matrix.get(user.role, set()) & {"view_reports", "process_payments"}
    if viewer_ok:
        return claim
    stages = await _load_stages(claim_id, db)
    pending = _active_pending_stage(claim, stages)
    if pending:
        cfg = await get_workflow_config(db, category=claim.reimbursement_category.value)
        stage_defs = _normalize_stage_defs(cfg)
        stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
        active_delegator_ids = await _active_delegator_ids(user_id, db)
        if stage_def and await _can_user_act_on_claim_stage(
            user, claim, stage_def, db, stage_row=pending, active_delegator_ids=active_delegator_ids
        ):
            return claim
    raise HTTPException(status_code=403, detail="Cannot view this claim")


async def _pending_approver_names(route_role: str, employee_id: str | None, db: AsyncSession) -> list[str]:
    user_ids = await _user_ids_for_role(route_role, employee_id, db)
    names = []
    for uid in user_ids:
        name, _ = await _user_identity(uid, db)
        if name:
            names.append(name)
    return names


async def get_approval_chain(claim: ClaimDraft, db: AsyncSession) -> dict:
    stages = await _load_stages(claim.id, db)

    # A PENDING_EXCEPTION claim has no ClaimApprovalStage rows yet — init_claim_approval_chain
    # deliberately skips creating them until the exception is resolved (see that function).
    # Surface the exception's own approval chain instead, so the stepper shows *something*
    # rather than "unavailable" while a real approval is genuinely in progress.
    exception_stages: list[dict] = []
    exceptions: list[dict] = []
    exc_requests = (
        await db.execute(
            select(ExceptionRequest)
            .where(
                ExceptionRequest.claim_id == claim.id,
                # Closed without a decision (send-back / claim rejected) — nothing to show.
                ExceptionRequest.status != ExceptionRequestStatus.CANCELLED.value,
            )
            .order_by(ExceptionRequest.id)
        )
    ).scalars().all()
    for req in exc_requests:
        approvals = (
            await db.execute(
                select(ExceptionApproval)
                .where(ExceptionApproval.exception_request_id == req.id)
                .order_by(ExceptionApproval.id)
            )
        ).scalars().all()
        waiting_on = next((a for a in approvals if a.status == ExceptionRequestStatus.PENDING.value), None)
        waiting_on_names = (
            await _pending_approver_names(waiting_on.required_role, claim.employee_id, db) if waiting_on else []
        )
        itemized = is_itemized_claim_request(req)
        step_decisions: dict[int, list[dict]] = {}
        if itemized:
            # One entry per exception on the claim's one request, with every step's decision on it.
            for item in await describe_exception_items(req, approvals, db):
                for d in item["decisions"]:
                    step_decisions.setdefault(d["exception_approval_id"], []).append(
                        {**d, "item_id": item["item_id"], "category_name": item["category_name"]}
                    )
                if item["status"] == "DROPPED":
                    continue
                exceptions.append(
                    {
                        **item,
                        "exception_request_id": req.id,
                        "waiting_on_role": (
                            waiting_on.required_role if waiting_on and item["awaiting_current_step"] else None
                        ),
                        "waiting_on_names": waiting_on_names if item["awaiting_current_step"] else [],
                    }
                )
        else:
            exceptions.append(
                {
                    "exception_request_id": req.id,
                    "item_id": None,
                    "exception_type": req.exception_type,
                    "exception_type_label": _humanize_token(req.exception_type),
                    "category_name": req.expense_category_name,
                    "claimed_amount": str(req.claimed_amount) if req.claimed_amount is not None else None,
                    "cap_amount": None,
                    "reason": req.description,
                    "status": req.status,
                    "decision_comment": req.decision_comment,
                    "decisions": [],
                    "waiting_on_role": waiting_on.required_role if waiting_on else None,
                    "waiting_on_names": waiting_on_names,
                }
            )
        for approval in approvals:
            acted_by_name, _ = await _user_identity(approval.acted_by_user_id, db)
            pending_names: list[str] = []
            if approval.status in (ExceptionRequestStatus.PENDING.value, "AWAITING"):
                pending_names = await _pending_approver_names(approval.required_role, claim.employee_id, db)
            exception_stages.append(
                {
                    "exception_request_id": req.id,
                    "exception_type": req.exception_type,
                    "exception_type_label": "Policy exceptions" if itemized else _humanize_token(req.exception_type),
                    "itemized": itemized,
                    "required_role": approval.required_role,
                    "status": approval.status,
                    "acted_at": approval.acted_at.isoformat() if approval.acted_at else None,
                    "acted_by_user_id": approval.acted_by_user_id,
                    "acted_by_name": acted_by_name,
                    "pending_approver_names": pending_names,
                    "comment": approval.comment,
                    # Itemized requests: this step's decision on each exception (latest per exception).
                    "item_decisions": list(
                        {d["item_id"]: d for d in step_decisions.get(approval.id, [])}.values()
                    ),
                }
            )

    # Only for legacy PENDING_EXCEPTION claims that have no stage rows yet: preview where they go
    # once the exceptions clear — straight to Finance (claims with exceptions skip the normal
    # approval stages; newer ones already carry their finance stage row above).
    upcoming_stages: list[dict] = []
    if claim.status == ClaimStatus.PENDING_EXCEPTION and not stages:
        cfg = await get_workflow_config(db, category=claim.reimbursement_category.value)
        for s in _normalize_stage_defs(cfg):
            if str(s.get("route_role")) != Role.FINANCE.value:
                continue
            names = await _pending_approver_names(str(s.get("route_role") or ""), claim.employee_id, db)
            upcoming_stages.append(
                {"stage_number": s["number"], "label": s["label"], "pending_approver_names": names}
            )

    stage_dicts = []
    for s in stages:
        decided_by_name, _ = await _user_identity(s.decided_by_user_id, db)
        pending_names: list[str] = []
        if s.status in (ClaimApprovalStageStatus.PENDING.value, STAGE_STATUS_NOT_STARTED) and s.required_role:
            pending_names = await _pending_approver_names(s.required_role, claim.employee_id, db)
        stage_dicts.append(
            {
                "stage_number": s.stage_number,
                "label": s.stage_label,
                "status": s.status,
                "sla_deadline_at": s.sla_deadline_at.isoformat() if s.sla_deadline_at else None,
                "decided_at": s.decided_at.isoformat() if s.decided_at else None,
                "decided_by_user_id": s.decided_by_user_id,
                "decided_by_name": decided_by_name,
                "pending_approver_names": pending_names,
                "comment": s.comment,
            }
        )

    return {
        "claim_id": claim.id,
        "claim_reference": claim.claim_reference,
        "status": claim.status.value,
        "current_approval_stage": claim.current_approval_stage,
        "approved_amount": str(claim.approved_amount) if claim.approved_amount is not None else None,
        "payment_utr": claim.payment_utr,
        "payment_amount": str(claim.payment_amount) if claim.payment_amount is not None else None,
        "reject_reason": claim.reject_reason,
        "authoritative_payable_amount": str(_authoritative_payable_amount(claim)),
        "stages": stage_dicts,
        "exception_stages": exception_stages,
        "upcoming_stages": upcoming_stages,
        "exceptions": exceptions,
        # Held from Finance until every exception is decided.
        "awaiting_exceptions": (
            claim.status in (ClaimStatus.IN_APPROVAL, ClaimStatus.PENDING_EXCEPTION)
            and any(e["status"] == ExceptionRequestStatus.PENDING.value for e in exceptions)
            and _active_pending_stage(claim, stages) is None
        ),
    }


async def _user_identity(user_id: int | None, db: AsyncSession) -> tuple[str | None, str | None]:
    if user_id is None:
        return None, None
    user = await db.get(User, user_id)
    if user is None:
        return None, None
    return user.full_name or user.email, user.role.value


def _event_rank(event: str) -> int:
    order = {
        "created": 1,
        "submitted": 2,
        "resubmitted": 3,
        "stage_approved": 4,
        "sent_back": 5,
        "rejected": 6,
        "payment_processed": 7,
        "sla_breached": 8,
        "sla_passed_on": 8,
    }
    return order.get(event, 99)


async def get_claim_timeline(claim: ClaimDraft, db: AsyncSession) -> list[dict]:
    events: list[dict] = []
    actor_name, actor_role = await _user_identity(claim.employee_user_id, db)

    # AuditLog is the only source read here for decision history (approve/send-back/reject/
    # payment): it's append-only, whereas ClaimApprovalStage rows for this claim get wiped and
    # recreated from scratch by init_claim_approval_chain on every resubmission. Deriving the
    # same events from both sources used to produce duplicate timeline entries for the current
    # cycle (each source computes its own timestamp independently) and silently dropped a prior
    # cycle's approval/send-back history the moment the claim was resubmitted.
    logs = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.entity_type == "claim_draft", AuditLog.entity_id == str(claim.id))
            .order_by(AuditLog.timestamp.asc())
        )
    ).scalars().all()

    sent_back_at = max(
        (log.timestamp for log in logs if log.action in ("send_back", "send_back_via_exception")),
        default=None,
    )

    if claim.created_at:
        events.append(
            {
                "event": "created",
                "actor": actor_name,
                "role": actor_role,
                "timestamp": claim.created_at,
                "comment": None,
                "stage": None,
                "utr": None,
            }
        )
    if claim.submitted_at:
        submitted_action = "resubmitted" if sent_back_at and claim.submitted_at > sent_back_at else "submitted"
        events.append(
            {
                "event": submitted_action,
                "actor": actor_name,
                "role": actor_role,
                "timestamp": claim.submitted_at,
                "comment": None,
                "stage": None,
                "utr": None,
            }
        )
    event_by_action = {
        "approve_stage": "stage_approved",
        "approve_stage_partial": "stage_approved",
        "approve_stage_auto": "stage_approved",
        "send_back": "sent_back",
        "send_back_via_exception": "sent_back",
        "reject_claim": "rejected",
        "reject_claim_via_exception": "rejected",
        "record_payment": "payment_processed",
        "sla_passed_on": "sla_passed_on",
        "sla_breached": "sla_breached",
    }
    for log in logs:
        event_name = event_by_action.get(log.action)
        if event_name is None:
            continue
        actor, role = await _user_identity(log.actor_id, db)
        new_value = log.new_value or {}
        if log.action in ("approve_stage", "approve_stage_partial", "approve_stage_auto"):
            stage = new_value.get("approved_stage_number")
            comment = new_value.get("comment")
        elif log.action in ("reject_claim", "reject_claim_via_exception"):
            stage = new_value.get("stage_number")
            comment = new_value.get("reject_reason")
        else:
            stage = new_value.get("stage_number")
            comment = new_value.get("comment")
        events.append(
            {
                "event": event_name,
                "actor": actor,
                "role": role,
                "timestamp": log.timestamp,
                "comment": comment,
                "stage": stage,
                "utr": new_value.get("payment_utr"),
                "is_auto": log.action == "approve_stage_auto",
            }
        )

    unique: dict[tuple, dict] = {}
    for item in events:
        key = (
            item["event"],
            item["timestamp"],
            item.get("stage"),
            item.get("actor"),
            item.get("comment"),
            item.get("utr"),
        )
        unique[key] = item
    ordered = sorted(
        unique.values(),
        key=lambda ev: (ev["timestamp"], _event_rank(ev["event"]), ev.get("stage") or 0),
    )
    return ordered


async def approve_claim_stage(
    claim_id: int, user_id: int, comment: str | None, db: AsyncSession, *, override_reason: str | None = None
) -> ClaimDraft:
    """`override_reason`: an admin override (override_service) — decides the current step in place
    of whoever it's waiting on, every parallel branch of it at once; never the Finance step."""
    # Locked (SELECT ... FOR UPDATE) so parallel clicks queue up: the first one decides the stage
    # and opens the next; the rest re-read the committed result below and are refused, instead of
    # each opening (and notifying) the next stage again. Stages are locked too — a locking read
    # always sees the latest committed rows, whatever snapshot this transaction already holds.
    claim = (
        await db.execute(
            select(ClaimDraft)
            .where(ClaimDraft.id == claim_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status not in (ClaimStatus.IN_APPROVAL, ClaimStatus.READY_FOR_PAYMENT):
        raise HTTPException(status_code=409, detail="Claim is not awaiting approval")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    stages = list(
        (
            await db.execute(
                select(ClaimApprovalStage)
                .where(ClaimApprovalStage.claim_id == claim_id)
                .order_by(ClaimApprovalStage.stage_number)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
    )
    pending = _active_pending_stage(claim, stages)
    if pending is None:
        raise HTTPException(status_code=409, detail="No pending approval stage")

    cfg = await get_workflow_config(db, category=claim.reimbursement_category.value)
    stage_defs = _normalize_stage_defs(cfg)
    stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
    if stage_def is None:
        raise HTTPException(status_code=500, detail="Approval chain is misconfigured")
    if str(stage_def["route_role"]) == Role.FINANCE.value:
        raise HTTPException(
            status_code=400,
            detail="Finance stage is completed via payment initiation endpoint",
        )

    if override_reason:
        _assert_can_override(user, claim.employee_user_id)
        comment = override_note(user, override_reason)
    else:
        active_delegator_ids = await _active_delegator_ids(user_id, db)
        if not await _can_user_act_on_claim_stage(
            user, claim, stage_def, db, stage_row=pending, active_delegator_ids=active_delegator_ids
        ):
            if already_decided_by(stages, user_id, pending.stage_number):
                raise HTTPException(
                    status_code=409,
                    detail="Already decided — you've approved this claim and it has moved to the next approver.",
                )
            raise HTTPException(status_code=403, detail="Not allowed to approve this stage")
    now = _now()
    previous_status = claim.status.value
    previous_stage = claim.current_approval_stage

    decided_rows = [pending]
    if override_reason:
        decided_rows += [
            s for s in stages
            if s.stage_number == pending.stage_number and s.status == ClaimApprovalStageStatus.PENDING.value
            and s.id != pending.id
        ]
    for decided in decided_rows:
        decided.status = ClaimApprovalStageStatus.APPROVED.value
        decided.decided_at = now
        decided.decided_by_user_id = user_id
        if comment:
            decided.comment = (decided.comment or "") + ("\n" if decided.comment else "") + comment

    # Check if other parallel branches are still pending for THIS stage number
    still_pending = any(
        s for s in stages 
        if s.stage_number == pending.stage_number 
        and s.status == ClaimApprovalStageStatus.PENDING.value 
        and s.id != pending.id
    )

    if still_pending:
        # Keep current stage number, wait for other branches
        await log_event(
            entity_type="claim_draft",
            entity_id=str(claim.id),
            action="approve_stage_partial",
            actor_id=user_id,
            old={"status": previous_status, "current_approval_stage": previous_stage},
            new={
                "status": claim.status.value,
                "current_approval_stage": claim.current_approval_stage,
                "approved_stage_number": pending.stage_number,
                "comment": comment,
                "note": "Parallel branch approved, waiting for others"
            },
            db=db,
        )
    else:
        # Move to next stage number
        next_stage_number = min((s.stage_number for s in stages if s.stage_number > pending.stage_number), default=None)
        if next_stage_number is None:
             # Logic for no more stages? Usually finance is final.
             pass
        else:
            next_stages = [s for s in stages if s.stage_number == next_stage_number]
            next_stage_defs = [s for s in stage_defs if int(s["number"]) == next_stage_number]
            
            is_finance = any(str(sd.get("route_role")) == Role.FINANCE.value for sd in next_stage_defs)

            claim.current_approval_stage = next_stage_number
            if is_finance and await has_pending_claim_exceptions(claim.id, db):
                # Approvers are done but an exception is still undecided: the claim waits here,
                # hidden from Finance (its finance stage stays NOT_STARTED), until the last
                # exception is approved — see release_claim_to_finance.
                pass
            else:
                if is_finance:
                    claim.status = ClaimStatus.READY_FOR_PAYMENT
                await _activate_stage_rows(claim, next_stages, next_stage_defs, stage_defs, next_stage_number, now, db)

    if not still_pending:
        # The still_pending branch above already logged "approve_stage_partial" for this same
        # click — logging "approve_stage" here too would double-count it in the claim timeline.
        await log_event(
            entity_type="claim_draft",
            entity_id=str(claim.id),
            action="approve_stage",
            actor_id=user_id,
            old={"status": previous_status, "current_approval_stage": previous_stage},
            new={
                "status": claim.status.value,
                "current_approval_stage": claim.current_approval_stage,
                "approved_stage_number": pending.stage_number,
                "comment": comment,
                "override_reason": override_reason,
            },
            db=db,
        )
    await db.commit()
    await db.refresh(claim)
    return claim


async def send_back_claim(
    claim_id: int, user_id: int, comment: str, db: AsyncSession, *, override_reason: str | None = None
) -> ClaimDraft:
    if override_reason:
        comment = override_reason
    if not comment or not comment.strip():
        raise HTTPException(status_code=422, detail="Comment is required when sending back a claim")

    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status != ClaimStatus.IN_APPROVAL:
        raise HTTPException(status_code=409, detail="Claim cannot be sent back in its current state")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    stages = await _load_stages(claim_id, db)
    pending = _active_pending_stage(claim, stages)
    if pending is None:
        raise HTTPException(status_code=409, detail="No send-back allowed at this stage")

    cfg = await get_workflow_config(db, category=claim.reimbursement_category.value)
    stage_defs = _normalize_stage_defs(cfg)
    stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
    if stage_def is None:
        raise HTTPException(status_code=500, detail="Approval chain is misconfigured")
    if str(stage_def["route_role"]) == Role.FINANCE.value:
        raise HTTPException(status_code=409, detail="No send-back allowed at finance stage")
    if override_reason:
        _assert_can_override(user, claim.employee_user_id)
        comment = override_note(user, override_reason)
    else:
        active_delegator_ids = await _active_delegator_ids(user_id, db)
        if not await _can_user_act_on_claim_stage(
            user, claim, stage_def, db, stage_row=pending, active_delegator_ids=active_delegator_ids
        ):
            raise HTTPException(status_code=403, detail="Not allowed to send back this claim")

    now = _now()
    previous_status = claim.status.value
    previous_stage = claim.current_approval_stage
    pending.status = ClaimApprovalStageStatus.SENT_BACK.value
    pending.decided_at = now
    pending.decided_by_user_id = user_id
    pending.comment = comment.strip()

    claim.status = ClaimStatus.SENT_BACK
    claim.current_approval_stage = None
    # Undecided exceptions are closed — the employee may change those expenses, so they give
    # fresh reasons on resubmit. Already-approved ones are kept and reused on resubmit as long
    # as that expense's amount is unchanged (see reimbursement_service.submit_claim).
    await cancel_pending_claim_exceptions(claim.id, "Claim was sent back to the employee.", db)

    await log_event(
        entity_type="claim_draft",
        entity_id=str(claim.id),
        action="send_back",
        actor_id=user_id,
        old={"status": previous_status, "current_approval_stage": previous_stage},
        new={
            "status": claim.status.value,
            "current_approval_stage": claim.current_approval_stage,
            "comment": comment,
            "stage_number": previous_stage,
            "override_reason": override_reason,
        },
        db=db,
    )
    await _notify_employee_update(
        claim,
        title=f"Claim sent back: {claim.claim_reference or f'CLM-{claim.id}'}",
        body=comment.strip(),
        category=NotificationCategory.CLAIM_UPDATE,
        db=db,
    )
    await db.commit()
    await db.refresh(claim)
    return claim


async def reject_claim(
    claim_id: int, user_id: int, reason: str, db: AsyncSession, *, override_reason: str | None = None
) -> ClaimDraft:
    if override_reason:
        reason = override_reason
    if not reason or not reason.strip():
        raise HTTPException(status_code=422, detail="Rejection reason is mandatory")

    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status not in (ClaimStatus.IN_APPROVAL, ClaimStatus.READY_FOR_PAYMENT):
        raise HTTPException(status_code=409, detail="Claim cannot be rejected in its current state")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    stages = await _load_stages(claim_id, db)
    pending = _active_pending_stage(claim, stages)
    if pending is None:
        raise HTTPException(status_code=409, detail="No pending stage to reject")

    cfg = await get_workflow_config(db, category=claim.reimbursement_category.value)
    stage_defs = _normalize_stage_defs(cfg)
    stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
    if stage_def is None:
        raise HTTPException(status_code=500, detail="Approval chain is misconfigured")
    if override_reason:
        if str(stage_def["route_role"]) == Role.FINANCE.value:
            raise HTTPException(status_code=409, detail="This claim is with Finance — only Finance can act on it")
        _assert_can_override(user, claim.employee_user_id)
        reason = override_note(user, override_reason)
    else:
        active_delegator_ids = await _active_delegator_ids(user_id, db)
        if not await _can_user_act_on_claim_stage(
            user, claim, stage_def, db, stage_row=pending, active_delegator_ids=active_delegator_ids
        ):
            raise HTTPException(status_code=403, detail="Not allowed to reject at this stage")

    now = _now()
    previous_status = claim.status.value
    pending.status = ClaimApprovalStageStatus.REJECTED.value
    pending.decided_at = now
    pending.decided_by_user_id = user_id
    pending.comment = reason.strip()

    claim.status = ClaimStatus.REJECTED
    claim.reject_reason = reason.strip()
    await cancel_pending_claim_exceptions(claim.id, "Claim was rejected by an approver.", db)

    await log_event(
        entity_type="claim_draft",
        entity_id=str(claim.id),
        action="reject_claim",
        actor_id=user_id,
        old={"status": previous_status, "reject_reason": None},
        new={
            "status": claim.status.value,
            "reject_reason": claim.reject_reason,
            "stage_number": pending.stage_number,
            "override_reason": override_reason,
        },
        db=db,
    )
    await _notify_employee_update(
        claim,
        title=f"Claim rejected: {claim.claim_reference or f'CLM-{claim.id}'}",
        body=reason.strip(),
        category=NotificationCategory.CLAIM_UPDATE,
        db=db,
    )
    await db.commit()
    await db.refresh(claim)
    return claim


async def modify_claim_amount(
    claim_id: int, user_id: int, new_amount: Decimal, comment: str | None, db: AsyncSession
) -> ClaimDraft:
    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status != ClaimStatus.IN_APPROVAL:
        raise HTTPException(status_code=409, detail="Amount can only be modified during approval")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    stages = await _load_stages(claim_id, db)
    pending = _active_pending_stage(claim, stages)
    if pending is None:
        raise HTTPException(status_code=409, detail="Modify amount is not allowed at this stage")

    cfg = await get_workflow_config(db, category=claim.reimbursement_category.value)
    stage_defs = _normalize_stage_defs(cfg)
    stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
    if stage_def is None:
        raise HTTPException(status_code=500, detail="Approval chain is misconfigured")
    if str(stage_def["route_role"]) == Role.FINANCE.value:
        raise HTTPException(status_code=409, detail="Modify amount is not allowed at finance stage")
    active_delegator_ids = await _active_delegator_ids(user_id, db)
    if not await _can_user_act_on_claim_stage(
        user, claim, stage_def, db, stage_row=pending, active_delegator_ids=active_delegator_ids
    ):
        raise HTTPException(status_code=403, detail="Not allowed to modify amount for this claim")

    # An approver can only lower what's paid, never raise it above what the claim allows.
    report = claim.compliance_report or {}
    try:
        ceiling = Decimal(str(report.get("net_payable", report.get("total_claimed", "0")))).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        ceiling = Decimal("0.00")
    if new_amount > ceiling:
        raise HTTPException(
            status_code=422,
            detail=f"The approved amount can't be more than the claimed amount (₹{ceiling:,.2f})",
        )

    old = str(claim.approved_amount) if claim.approved_amount is not None else None
    claim.approved_amount = new_amount
    await log_event(
        entity_type="claim_draft",
        entity_id=str(claim.id),
        action="modify_amount",
        actor_id=user_id,
        old={"approved_amount": old},
        new={"approved_amount": str(new_amount), "comment": comment},
        db=db,
    )
    await db.commit()
    await db.refresh(claim)
    return claim


async def record_claim_payment(
    claim_id: int,
    user_id: int,
    utr: str,
    amount: Decimal,
    db: AsyncSession,
    tds_deduction: Decimal = Decimal("0"),
    advance_deducted: Decimal = Decimal("0"),
) -> ClaimDraft:
    if not utr or not utr.strip():
        raise HTTPException(status_code=422, detail="UTR reference is required")

    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status != ClaimStatus.READY_FOR_PAYMENT:
        raise HTTPException(status_code=409, detail="Claim is not ready for payment")
    # Backstop for the finance hold in approve_claim_stage: never pay while an exception on the
    # claim is undecided (it could still reject the whole claim).
    if await has_pending_claim_exceptions(claim.id, db):
        raise HTTPException(
            status_code=409, detail="This claim has policy exceptions still awaiting a decision"
        )

    user = await db.get(User, user_id)
    if user is None or user.role != Role.FINANCE:
        raise HTTPException(status_code=403, detail="Only finance can record payment")

    cfg = await get_workflow_config(db, category=claim.reimbursement_category.value)
    stage_defs = _normalize_stage_defs(cfg)
    finance_stage_number = int(
        next(s["number"] for s in stage_defs if str(s["route_role"]) == Role.FINANCE.value)
    )
    stages = await _load_stages(claim_id, db)
    stage4 = next((s for s in stages if s.stage_number == finance_stage_number), None)
    if stage4 is None or stage4.status != ClaimApprovalStageStatus.PENDING.value:
        raise HTTPException(status_code=409, detail="Finance stage is not pending")
    if claim.current_approval_stage != stage4.stage_number:
        raise HTTPException(status_code=409, detail="Finance stage is not active")

    expected = _authoritative_payable_amount(claim)
    provided = amount.quantize(Decimal("0.01"))
    deduction = tds_deduction.quantize(Decimal("0.01"))
    advance = advance_deducted.quantize(Decimal("0.01"))
    if deduction < 0 or deduction > expected:
        raise HTTPException(
            status_code=422,
            detail=f"TDS/other deductions must be between 0 and the approved amount {expected}.",
        )
    if advance < 0:
        raise HTTPException(status_code=422, detail="Advance deducted cannot be negative")
    outstanding = await get_outstanding_advance(claim.employee_user_id, db)
    if advance > outstanding:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot deduct more than the employee's outstanding advance ({outstanding})",
        )
    # provided is what actually gets transferred to the employee — deduction (TDS) is
    # withheld and advance is netted off against what they already drew down, so all three
    # together must still add up to the full approved amount.
    if provided + deduction + advance != expected:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Payment amount plus TDS/other deductions plus advance deducted must equal the "
                f"authoritative payable amount {expected}."
            ),
        )

    now = _now()
    previous_status = claim.status.value
    stage4.status = ClaimApprovalStageStatus.APPROVED.value
    stage4.decided_at = now
    stage4.decided_by_user_id = user_id
    stage4.comment = f"UTR {utr.strip()}" + (f" (TDS/deductions {deduction})" if deduction else "")

    claim.status = ClaimStatus.PAID
    claim.payment_utr = utr.strip()
    claim.payment_amount = provided
    claim.tds_deduction = deduction
    claim.advance_received = advance
    claim.payment_recorded_at = now
    claim.payment_recorded_by = user_id

    # Actually draws the advance down on the grant itself, not just in this claim's own
    # record — otherwise the grant would still look untouched (see _draw_down_advance).
    await _draw_down_advance(claim.employee_user_id, advance, "claims", db)

    # Posting to the ERP ledger used to be a second, separate API call the frontend made
    # right after this one (see PaymentQueuePage.jsx) — if that second call ever failed for
    # any reason (dropped connection, a server restart mid-request, ...) the claim was left
    # PAID with no ledger entry and no way to tell from the UI. Folding it into this same
    # transaction makes the two atomic: either both land or neither does.
    await post_ledger_entry_to_erp(claim_id, user_id, None, db)

    await log_event(
        entity_type="claim_draft",
        entity_id=str(claim.id),
        action="record_payment",
        actor_id=user_id,
        old={
            "status": previous_status,
            "payment_utr": None,
            "payment_amount": None,
        },
        new={
            "status": claim.status.value,
            "payment_utr": claim.payment_utr,
            "payment_amount": str(claim.payment_amount),
            "tds_deduction": str(claim.tds_deduction),
            "advance_deducted": str(claim.advance_received),
            "stage_number": stage4.stage_number,
        },
        db=db,
    )
    await _notify_employee_update(
        claim,
        title=f"Payment recorded: {claim.claim_reference or f'CLM-{claim.id}'}",
        body=(
            f"UTR {claim.payment_utr} was recorded for INR {claim.payment_amount}"
            + (f" (INR {claim.tds_deduction} withheld as TDS/other deductions)." if claim.tds_deduction else ".")
        ),
        category=NotificationCategory.PAYMENT,
        db=db,
    )
    await db.commit()
    await db.refresh(claim)
    return claim


def passed_over_stage_labels(stages: list, before_stage_number: int) -> list[str]:
    """Labels of earlier stages (claim or travel) whose approver missed the SLA, so the request
    was passed on — shown to the approver it reached so they know why it's with them."""
    return [
        s.stage_label
        for s in stages
        if s.status == STAGE_STATUS_SLA_SKIPPED and s.stage_number < before_stage_number
    ]


def _sla_remaining_hours(deadline: datetime | None) -> tuple[str | None, str]:
    if deadline is None:
        return None, "pending"
    now = _now()
    if now > deadline:
        return None, "breached"
    delta = deadline - now
    hours, remainder = divmod(int(delta.total_seconds()), 3600)
    minutes = remainder // 60
    return f"{hours}h {minutes}m", "ok" if delta.total_seconds() > 3600 * 12 else "warning"


async def list_pending_approvals(user_id: int, db: AsyncSession) -> list[dict]:
    user = await db.get(User, user_id)
    if user is None:
        return []
        
    active_delegator_ids = await _active_delegator_ids(user_id, db)

    delegator_roles = []
    if active_delegator_ids:
        roles_q = select(User.role).where(User.id.in_(active_delegator_ids))
        delegator_roles = [r.value for r in (await db.execute(roles_q)).scalars().all()]
        
    user_roles = [user.role.value] + delegator_roles
    # Anyone with people reporting to them gets those people's manager step, whatever their role.
    if Role.REPORTING_MANAGER.value not in user_roles and await acts_as_manager(user.id, db):
        user_roles.append(Role.REPORTING_MANAGER.value)

    # Each claim's own category can have its own configured stage roles (see
    # get_workflow_config's category param), so stage-number -> route_role isn't a single
    # global mapping any more — it has to be resolved per claim, not filtered in the query.
    q = select(ClaimDraft).where(
        ClaimDraft.current_approval_stage.isnot(None),
        ClaimDraft.status.in_([ClaimStatus.IN_APPROVAL, ClaimStatus.READY_FOR_PAYMENT]),
        ClaimDraft.is_exception_shell.is_(False),
    )

    rows = (await db.execute(q)).scalars().unique().all()
    stage_by_number_by_category: dict[str, dict[int, dict]] = {}
    out: list[dict] = []
    for claim in rows:
        category = claim.reimbursement_category.value
        if category not in stage_by_number_by_category:
            cfg = await get_workflow_config(db, category=category)
            stage_by_number_by_category[category] = {
                int(s["number"]): s for s in _normalize_stage_defs(cfg)
            }
        stage_by_number = stage_by_number_by_category[category]

        active_stage_number = int(claim.current_approval_stage or 0)
        stage_def = stage_by_number.get(active_stage_number)
        # A Department head step isn't tied to anyone's system role — it belongs to whoever heads
        # this claimant's department, which _can_user_act_on_claim_stage below decides.
        if stage_def is None or (
            str(stage_def["route_role"]) not in user_roles and stage_def["route_role"] != DEPARTMENT_HEAD
        ):
            continue

        stages = await _load_stages(claim.id, db)
        pending = _active_pending_stage(claim, stages)
        if pending is None:
            continue

        if not await _can_user_act_on_claim_stage(user, claim, stage_def, db, stage_row=pending, active_delegator_ids=active_delegator_ids):
            continue
        # Reminders and breach emails come from app.workers.sla_monitor, not from viewing the queue.
        sla_label, sla_bucket = _sla_remaining_hours(pending.sla_deadline_at if pending else None)

        emp = await db.get(Employee, claim.employee_id) if claim.employee_id else None
        exceptions = (claim.compliance_report or {}).get("exceptions") or []
        exc_labels = [f"{e.get('category_name', '')} cap" for e in exceptions[:3]]
        trip = "—"
        if claim.office_location and claim.destination_city:
            trip = f"{claim.office_location} → {claim.destination_city}"
        if claim.departure_date and claim.return_date:
            trip += f" · {claim.departure_date}–{claim.return_date}"

        total = total_claimed_from_report(claim)
        advance_deducted = claim.advance_received.quantize(Decimal("0.01"))
        net_payable = _authoritative_payable_amount(claim)
        out.append(
            {
                "claim_id": claim.id,
                "claim_reference": claim.claim_reference or f"CLM-{claim.id}",
                # Just an id, not advance data — lets a Finance-only caller separately look up
                # this employee's outstanding advance via GET /advances/outstanding/{id}, without
                # this shared queue (also read by managers/HRBP/payroll) ever carrying that figure.
                "employee_user_id": claim.employee_user_id,
                "employee_label": f"{emp.full_name if emp else 'Unknown'} ({claim.employee_id or '—'})",
                "employee_name": emp.full_name if emp else "Unknown",
                "department": emp.department if emp else None,
                "reimbursement_category": claim.reimbursement_category.value,
                "trip_summary": trip,
                "amount": str(total),
                "advance_deducted": str(advance_deducted),
                "net_payable": str(net_payable),
                "submitted_at": claim.submitted_at.isoformat() if claim.submitted_at else None,
                "exceptions_summary": exc_labels or ["Compliant"],
                "sla_remaining_label": sla_label or ("SLA Breached" if sla_bucket == "breached" else "—"),
                "sla_bucket": sla_bucket,
                "sla_deadline_at": pending.sla_deadline_at.isoformat() if pending and pending.sla_deadline_at else None,
                # Earlier stages whose approver missed their SLA, so the claim was passed on to here.
                "sla_passed_over": passed_over_stage_labels(stages, pending.stage_number),
            }
        )
    return out


async def _user_ids_for_exception_role(claim: ClaimDraft, role: str, db: AsyncSession) -> list[int]:
    if role == "REPORTING_MANAGER":
        if not claim.employee_id:
            return []
        employee = await db.get(Employee, claim.employee_id)
        if employee is None or not employee.reporting_manager_id:
            return []
        result = await db.execute(
            # Whoever this person reports to, whatever their own role (see rbac.MANAGER_PERMISSIONS).
            select(User.id).where(User.employee_id == employee.reporting_manager_id)
        )
        return [int(user_id) for user_id in result.scalars().all()]
    if role == "FUNCTION_HEAD":
        if not claim.employee_id:
            return []
        fh = await _get_function_head(claim.employee_id, db)
        if not fh:
            return []
        result = await db.execute(
            select(User.id).where(User.employee_id == fh.employee_id)
        )
        return [int(user_id) for user_id in result.scalars().all()]
    if role == DEPARTMENT_HEAD:
        head = await _department_head_user(claim.employee_id, db)
        return [head.id] if head else []

    try:
        r_enum = Role(role)
        result = await db.execute(select(User.id).where(User.role == r_enum))
        return [int(user_id) for user_id in result.scalars().all()]
    except ValueError:
        return []


async def _user_ids_for_exception_role_for_travel(travel_request, role: str, db: AsyncSession) -> list[int]:
    subject = await db.get(User, travel_request.employee_user_id)
    employee_id = subject.employee_id if subject else None

    if role == "REPORTING_MANAGER":
        if not employee_id:
            return []
        employee = await db.get(Employee, employee_id)
        if employee is None or not employee.reporting_manager_id:
            return []
        result = await db.execute(
            # Whoever this person reports to, whatever their own role (see rbac.MANAGER_PERMISSIONS).
            select(User.id).where(User.employee_id == employee.reporting_manager_id)
        )
        return [int(user_id) for user_id in result.scalars().all()]
    if role == "FUNCTION_HEAD":
        if not employee_id:
            return []
        fh = await _get_function_head(employee_id, db)
        if not fh:
            return []
        result = await db.execute(select(User.id).where(User.employee_id == fh.employee_id))
        return [int(user_id) for user_id in result.scalars().all()]
    if role == DEPARTMENT_HEAD:
        head = await _department_head_user(employee_id, db)
        return [head.id] if head else []

    try:
        r_enum = Role(role)
        result = await db.execute(select(User.id).where(User.role == r_enum))
        return [int(user_id) for user_id in result.scalars().all()]
    except ValueError:
        return []


async def _notify_travel_exception_approver(
    travel_request, req: ExceptionRequest, role: str, db: AsyncSession, note: str | None = None
) -> None:
    recipients = await _user_ids_for_exception_role_for_travel(travel_request, role, db)
    body = f"Exception '{_exception_label(req)}' requires your review."
    if note:
        body += f" {note}"
    for user_id in recipients:
        await create_notification(
            user_id=user_id,
            title=f"Exception Approval Required: TR-{travel_request.id:04d}",
            body=body,
            link="/hr/exceptions",
            category=NotificationCategory.EXCEPTION.value,
            db=db,
        )


# Travel requests have no finance stage and no conditional/parallel stage support (unlike
# claims) — this is deliberately the simple sequential subset of the claim-stage machinery.
TRAVEL_REQUEST_DEFAULT_STAGES: list[dict] = [
    {"number": 1, "label": "Manager Review", "sla_hours": 48, "route_role": Role.REPORTING_MANAGER.value},
    {"number": 2, "label": "HRBP Review", "sla_hours": 48, "route_role": Role.HRBP_HR.value},
    {"number": 3, "label": "CEO Approval", "sla_hours": 48, "route_role": Role.CEO.value},
    {"number": 4, "label": "Admin Approval", "sla_hours": 48, "route_role": Role.ADMIN.value},
]


# Default route for relocation approval requests (Approval Matrix -> "Relocation Approval",
# stored as category_overrides.RELOCATION_REQUEST). Like travel requests: no Finance stage.
RELOCATION_REQUEST_DEFAULT_STAGES: list[dict] = [
    {"number": 1, "label": "Recruiter Review", "sla_hours": 48, "route_role": Role.RECRUITER.value},
    {"number": 2, "label": "CEO Approval", "sla_hours": 48, "route_role": Role.CEO.value},
    {"number": 3, "label": "HRBP Review", "sla_hours": 48, "route_role": Role.HRBP_HR.value},
    {"number": 4, "label": "Payroll Review", "sla_hours": 48, "route_role": Role.PAYROLL.value},
]


def relocation_request_stage_defs(config: dict) -> list[dict]:
    override = (config.get("category_overrides") or {}).get("RELOCATION_REQUEST")
    raw_stages = override.get("stages") if isinstance(override, dict) else None
    return _normalize_stage_defs({"stages": raw_stages or RELOCATION_REQUEST_DEFAULT_STAGES})


def _travel_request_stage_defs(config: dict) -> list[dict]:
    override = (config.get("category_overrides") or {}).get("TRAVEL_REQUEST")
    raw_stages = override.get("stages") if isinstance(override, dict) else None
    return _normalize_stage_defs({"stages": raw_stages or TRAVEL_REQUEST_DEFAULT_STAGES})


async def _notify_travel_stage_approver(
    travel_request, stage_def: dict, db: AsyncSession, note: str | None = None
) -> None:
    route_role = str(stage_def.get("route_role") or "")
    recipients = await _user_ids_for_exception_role_for_travel(travel_request, route_role, db)
    if not recipients:
        return
    ref = f"TR-{travel_request.id:04d}"
    stage_number = int(stage_def.get("number", 0))
    body = f"Travel request is awaiting action at stage {stage_number}."
    if note:
        body += f" {note}"
    for user_id in recipients:
        await create_notification(
            user_id=user_id,
            title=f"Approval required: {ref}",
            body=body,
            link="/claims/pending?tab=travel",
            category=NotificationCategory.APPROVAL_REQUIRED.value,
            db=db,
        )


async def init_travel_request_approval_chain(travel_request, db: AsyncSession) -> None:
    """Creates this request's TravelRequestApprovalStage rows and notifies the first stage's
    approver(s) — called once a travel request is actually ready to enter the normal approval
    flow (on creation with no exception, or once every exception on it clears)."""
    from app.models.travel_request import TravelRequestApprovalStage

    cfg = await get_workflow_config(db)
    stage_defs = _travel_request_stage_defs(cfg)
    if any(s["route_role"] == DEPARTMENT_HEAD for s in stage_defs):
        subject = await db.get(User, travel_request.employee_user_id)
        if not await department_head_applies(subject.employee_id if subject else None, "travel_requests", cfg, db):
            stage_defs = [s for s in stage_defs if s["route_role"] != DEPARTMENT_HEAD] or _normalize_stage_defs(
                {"stages": TRAVEL_REQUEST_DEFAULT_STAGES}
            )
    now = _now()

    await db.execute(
        delete(TravelRequestApprovalStage).where(
            TravelRequestApprovalStage.travel_request_id == travel_request.id
        )
    )

    min_n = min(int(s["number"]) for s in stage_defs)
    travel_request.current_approval_stage = min_n
    first_deadline = await sla_deadline(db, _stage_hours(stage_defs, min_n), now)

    active_stage_def = None
    for stage in stage_defs:
        n = int(stage["number"])
        is_active = n == min_n
        row = TravelRequestApprovalStage(
            travel_request_id=travel_request.id,
            stage_number=n,
            stage_label=str(stage["label"]),
            required_role=stage["route_role"],
            status=ClaimApprovalStageStatus.PENDING.value if is_active else STAGE_STATUS_NOT_STARTED,
            sla_deadline_at=first_deadline if is_active else None,
            last_notified_at=now if is_active else None,
        )
        db.add(row)
        if is_active:
            active_stage_def = stage
    await db.flush()

    if active_stage_def:
        await _notify_travel_stage_approver(travel_request, active_stage_def, db)


async def _load_travel_stages(request_id: int, db: AsyncSession) -> list:
    from app.models.travel_request import TravelRequestApprovalStage

    result = await db.execute(
        select(TravelRequestApprovalStage)
        .where(TravelRequestApprovalStage.travel_request_id == request_id)
        .order_by(TravelRequestApprovalStage.stage_number)
    )
    return list(result.scalars().all())


async def _activate_travel_stage_rows(
    travel_request,
    stages: list,
    stage_defs: list[dict],
    stage_number: int,
    now: datetime,
    db: AsyncSession,
    note: str | None = None,
) -> None:
    """Travel-request twin of _activate_stage_rows: open `stage_number`'s row(s) with the SLA
    clock started in working hours, and notify the approver(s) (with `note`, if any)."""
    deadline = await sla_deadline(db, _stage_hours(stage_defs, stage_number), now)
    row_defs = [sd for sd in stage_defs if int(sd["number"]) == stage_number]
    for row in [s for s in stages if s.stage_number == stage_number]:
        row.status = ClaimApprovalStageStatus.PENDING.value
        row.sla_deadline_at = deadline
        row.last_notified_at = now
        row.sla_breached_at = None
        row_def = next((sd for sd in row_defs if sd["route_role"] == row.required_role), None)
        if row_def:
            await _notify_travel_stage_approver(travel_request, row_def, db, note)


def _active_pending_travel_stage(travel_request, stages: list):
    if travel_request.current_approval_stage is None:
        return None
    row = next((s for s in stages if s.stage_number == travel_request.current_approval_stage), None)
    if row is None or row.status != ClaimApprovalStageStatus.PENDING.value:
        return None
    return row


async def _finalize_travel_request_approval(
    travel_request, approver_id: int, db: AsyncSession, stages: list | None = None
) -> None:
    """A fully approved request goes straight to the travel agent for booking. The link is sent
    in the name of the HRBP who approved it (they're told when the agent books), or the final
    approver when no HRBP stage was involved. With no agent email configured it waits on the
    Travel Desk for a manual send instead."""
    from app.services.travel_request_service import issue_agent_booking_link

    await create_notification(
        user_id=travel_request.employee_user_id,
        title="Travel Request Approved",
        body=f"Your travel request for {travel_request.from_city} -> {travel_request.to_city} has been approved.",
        link="/travel-requests",
        category=NotificationCategory.CLAIM_UPDATE.value,
        db=db,
    )
    hrbp_stage = next(
        (s for s in stages or [] if s.required_role == Role.HRBP_HR.value and s.decided_by_user_id),
        None,
    )
    sender_id = hrbp_stage.decided_by_user_id if hrbp_stage else approver_id
    await db.refresh(travel_request, ["legs"])
    sent = await issue_agent_booking_link(travel_request, sent_by_user_id=sender_id, db=db)

    hrbps = (await db.execute(select(User).where(User.role == Role.HRBP_HR))).scalars().all()
    for hrbp in hrbps:
        await create_notification(
            user_id=hrbp.id,
            title="Sent to travel agent" if sent else "Pending Travel Booking",
            body=(
                f"A travel request from {travel_request.from_city} -> {travel_request.to_city} "
                + (
                    "was approved and sent to the travel agent for booking."
                    if sent
                    else "was approved, but no travel agent email is set — send it from the Travel Desk."
                )
            ),
            link="/travel-desk",
            category=NotificationCategory.CLAIM_UPDATE.value if sent else "ACTION_REQUIRED",
            db=db,
        )
    # Project stakeholders (site visit email) are told later, once the Travel Desk has actually
    # booked the trip — see travel_request_service._notify_stakeholders_once_booked.


async def approve_travel_request_stage(
    request_id: int, user_id: int, comment: str | None, db: AsyncSession, *, override_reason: str | None = None
):
    from app.models.travel_request import TravelRequest, TravelRequestStatus

    stmt = (
        select(TravelRequest)
        .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
        .where(TravelRequest.id == request_id)
    )
    req = (await db.execute(stmt)).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    if req.status != TravelRequestStatus.PENDING.value:
        raise HTTPException(status_code=409, detail="Only PENDING requests can be approved")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    stages = await _load_travel_stages(request_id, db)
    pending = _active_pending_travel_stage(req, stages)
    if pending is None:
        raise HTTPException(status_code=409, detail="No pending approval stage")

    cfg = await get_workflow_config(db)
    stage_defs = _travel_request_stage_defs(cfg)
    stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
    if stage_def is None:
        raise HTTPException(status_code=500, detail="Approval chain is misconfigured")

    if is_own_item(user, req.employee_user_id):
        raise HTTPException(status_code=403, detail="You can't approve your own travel request")
    subject_user = await db.get(User, req.employee_user_id)
    subject_employee_id = subject_user.employee_id if subject_user else None
    if override_reason:
        comment = override_note(user, override_reason)
    elif not await _user_matches_required_role(user, pending.required_role, subject_employee_id, db):
        raise HTTPException(status_code=403, detail="Not allowed to approve this stage")

    now = _now()
    previous_stage = req.current_approval_stage
    pending.status = ClaimApprovalStageStatus.APPROVED.value
    pending.decided_at = now
    pending.decided_by_user_id = user_id
    if comment:
        pending.comment = comment

    next_stage_number = min(
        (s.stage_number for s in stages if s.stage_number > pending.stage_number), default=None
    )
    if next_stage_number is None:
        req.status = TravelRequestStatus.APPROVED.value
        req.current_approval_stage = None
        await _finalize_travel_request_approval(req, user_id, db, stages)
    else:
        req.current_approval_stage = next_stage_number
        await _activate_travel_stage_rows(req, stages, stage_defs, next_stage_number, now, db)

    await log_event(
        entity_type="travel_request",
        entity_id=str(req.id),
        action="approve_stage",
        actor_id=user_id,
        old={"status": TravelRequestStatus.PENDING.value, "current_approval_stage": previous_stage},
        new={
            "status": req.status,
            "current_approval_stage": req.current_approval_stage,
            "approved_stage_number": pending.stage_number,
            "comment": comment,
            "override_reason": override_reason,
        },
        db=db,
    )
    await db.commit()
    await db.refresh(req)
    return req


async def reject_travel_request_stage(
    request_id: int, user_id: int, reason: str, db: AsyncSession, *, override_reason: str | None = None
):
    from app.models.travel_request import TravelRequest, TravelRequestStatus

    stmt = (
        select(TravelRequest)
        .options(selectinload(TravelRequest.legs), selectinload(TravelRequest.tickets))
        .where(TravelRequest.id == request_id)
    )
    req = (await db.execute(stmt)).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Travel request not found")
    if req.status != TravelRequestStatus.PENDING.value:
        raise HTTPException(status_code=409, detail="Only PENDING requests can be rejected")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    stages = await _load_travel_stages(request_id, db)
    pending = _active_pending_travel_stage(req, stages)
    if pending is None:
        raise HTTPException(status_code=409, detail="No pending approval stage")

    if is_own_item(user, req.employee_user_id):
        raise HTTPException(status_code=403, detail="You can't reject your own travel request")
    subject_user = await db.get(User, req.employee_user_id)
    subject_employee_id = subject_user.employee_id if subject_user else None
    if override_reason:
        reason = override_note(user, override_reason)
    elif not await _user_matches_required_role(user, pending.required_role, subject_employee_id, db):
        raise HTTPException(status_code=403, detail="Not allowed to reject this stage")

    now = _now()
    previous_stage = req.current_approval_stage
    pending.status = ClaimApprovalStageStatus.REJECTED.value
    pending.decided_at = now
    pending.decided_by_user_id = user_id
    if reason:
        pending.comment = reason

    req.status = TravelRequestStatus.REJECTED.value
    req.rejection_reason = reason.strip()
    req.current_approval_stage = None

    await create_notification(
        user_id=req.employee_user_id,
        title="Travel Request Rejected",
        body=f"Your travel request for {req.from_city} -> {req.to_city} has been rejected. Reason: {reason}",
        link="/travel-requests",
        category=NotificationCategory.CLAIM_UPDATE.value,
        db=db,
    )

    await log_event(
        entity_type="travel_request",
        entity_id=str(req.id),
        action="reject_stage",
        actor_id=user_id,
        old={"status": TravelRequestStatus.PENDING.value, "current_approval_stage": previous_stage},
        new={"status": req.status, "reason": reason, "override_reason": override_reason},
        db=db,
    )
    await db.commit()
    await db.refresh(req)
    return req


async def get_travel_request_approval_chain(travel_request, db: AsyncSession) -> dict:
    stages =await _load_travel_stages(travel_request.id, db)
    subject_user = await db.get(User, travel_request.employee_user_id)
    subject_employee_id = subject_user.employee_id if subject_user else None

    exception_stages: list[dict] = []
    exc_requests = (
        await db.execute(
            select(ExceptionRequest)
            .where(ExceptionRequest.travel_request_id == travel_request.id)
            .order_by(ExceptionRequest.id)
        )
    ).scalars().all()
    for req_exc in exc_requests:
        approvals = (
            await db.execute(
                select(ExceptionApproval)
                .where(ExceptionApproval.exception_request_id == req_exc.id)
                .order_by(ExceptionApproval.id)
            )
        ).scalars().all()
        for approval in approvals:
            acted_by_name, _ = await _user_identity(approval.acted_by_user_id, db)
            pending_names: list[str] = []
            if approval.status in (ExceptionRequestStatus.PENDING.value, "AWAITING"):
                pending_names = await _pending_approver_names(approval.required_role, subject_employee_id, db)
            exception_stages.append(
                {
                    "exception_request_id": req_exc.id,
                    "exception_type": req_exc.exception_type,
                    "exception_type_label": _humanize_token(req_exc.exception_type),
                    "required_role": approval.required_role,
                    "status": approval.status,
                    "acted_at": approval.acted_at.isoformat() if approval.acted_at else None,
                    "acted_by_user_id": approval.acted_by_user_id,
                    "acted_by_name": acted_by_name,
                    "pending_approver_names": pending_names,
                    "comment": approval.comment,
                }
            )

    # Always empty for travel requests now: a request with an exception never enters the normal
    # approval stages (its exception chain is its whole approval — see decide_exception_request),
    # so there's nothing "upcoming" to preview. Kept in the response for shape compatibility.
    upcoming_stages: list[dict] = []

    stage_dicts = []
    for s in stages:
        decided_by_name, _ = await _user_identity(s.decided_by_user_id, db)
        pending_names = []
        if s.status in (ClaimApprovalStageStatus.PENDING.value, STAGE_STATUS_NOT_STARTED) and s.required_role:
            pending_names = await _pending_approver_names(s.required_role, subject_employee_id, db)
        stage_dicts.append(
            {
                "stage_number": s.stage_number,
                "label": s.stage_label,
                "status": s.status,
                "sla_deadline_at": s.sla_deadline_at.isoformat() if s.sla_deadline_at else None,
                "decided_at": s.decided_at.isoformat() if s.decided_at else None,
                "decided_by_user_id": s.decided_by_user_id,
                "decided_by_name": decided_by_name,
                "pending_approver_names": pending_names,
                "comment": s.comment,
            }
        )

    return {
        "travel_request_id": travel_request.id,
        "status": travel_request.status,
        "current_approval_stage": travel_request.current_approval_stage,
        "stages": stage_dicts,
        "exception_stages": exception_stages,
        "upcoming_stages": upcoming_stages,
    }


async def create_travel_exception_request(
    travel_request_id: int, user_id: int, exception_types: list[str], description: str | None, db: AsyncSession
) -> ExceptionRequest:
    """Raises exactly one ExceptionRequest covering every type in `exception_types` (only the
    switched-on ones are ever raised — see travel_request_service._determine_blocking_exceptions).
    It goes through the shared travel request exception route (Approval Matrix -> Exception
    flows), with one approve/reject decision for the whole request at each step."""
    from app.models.travel_request import TravelRequest

    travel_request = await db.get(TravelRequest, travel_request_id)
    if travel_request is None:
        raise HTTPException(status_code=404, detail="Travel request not found")

    row = ExceptionRequest(
        claim_id=None,
        travel_request_id=travel_request_id,
        requested_by_user_id=user_id,
        exception_type=exception_types[0],
        exception_types=list(exception_types),
        description=description,
        status=ExceptionRequestStatus.PENDING.value,
        route_key=TRAVEL_EXCEPTIONS_ROUTE,
    )
    db.add(row)
    await db.flush()

    cfg = await get_workflow_config(db)
    subject = await db.get(User, travel_request.employee_user_id)
    required_roles = await _without_inapplicable_head(
        shared_exception_route(cfg, TRAVEL_EXCEPTIONS_ROUTE),
        subject.employee_id if subject else None,
        "exceptions",
        cfg,
        db,
    )
    steps = [
        ExceptionApproval(exception_request_id=row.id, required_role=role, status="AWAITING")
        for role in required_roles
    ]
    db.add_all(steps)
    if steps:
        await start_exception_step(steps[0], row, cfg, db)
    await db.commit()
    await db.refresh(row)

    exception_label = _exception_label(row)
    if required_roles:
        first_role = required_roles[0]
        target_uids = await _user_ids_for_exception_role_for_travel(travel_request, first_role, db)
        for target_uid in target_uids:
            await create_notification(
                user_id=target_uid,
                title=f"Exception Approval Required: TR-{travel_request.id:04d}",
                body=f"Exception Type: {exception_label}. Justification: {description}",
                link="/hr/exceptions",
                category=NotificationCategory.EXCEPTION.value,
                db=db,
            )

    await create_notification(
        user_id=user_id,
        title=f"Exception Request Submitted: TR-{travel_request.id:04d}",
        body=f"Your {exception_label} exception request has been sent for approval.",
        link="/travel-requests",
        category=NotificationCategory.EXCEPTION.value,
        db=db,
    )
    await db.commit()

    return row


CLAIM_EXCEPTION_REASON_MIN_CHARS = 20
# What an exception item ends as when it isn't decided one by one: its request closed another way
# (CANCELLED), or the employee's changes mean it's no longer flagged (DROPPED).
ITEM_STATUS_DROPPED = "DROPPED"
ALREADY_DECIDED_DETAIL = (
    "Already decided — these exceptions have moved on since you opened them. Refresh to see where they are."
)


async def has_pending_claim_exceptions(claim_id: int, db: AsyncSession) -> bool:
    found = (
        await db.execute(
            select(ExceptionRequest.id).where(
                ExceptionRequest.claim_id == claim_id,
                ExceptionRequest.status == ExceptionRequestStatus.PENDING.value,
            )
        )
    ).scalars().first()
    return found is not None


async def _close_open_items(request_ids: list[int], db: AsyncSession) -> None:
    """Exceptions still on the route (or with the employee) on closed requests are cancelled too."""
    if not request_ids:
        return
    open_items = (
        await db.execute(
            select(ExceptionRequestItem).where(
                ExceptionRequestItem.exception_request_id.in_(request_ids),
                ExceptionRequestItem.status.in_(
                    [ExceptionRequestStatus.PENDING.value, ExceptionRequestStatus.SENT_BACK.value]
                ),
            )
        )
    ).scalars().all()
    for item in open_items:
        item.status = ExceptionRequestStatus.CANCELLED.value


async def cancel_pending_claim_exceptions(
    claim_id: int, reason: str, db: AsyncSession, *, exclude_id: int | None = None
) -> int:
    """Close every still-pending exception request on a claim (and its open approval steps)
    without a decision — used when the claim itself stops moving (sent back, rejected, or
    rejected via another of its exceptions), so nothing stale is left in approvers' queues."""
    stmt = select(ExceptionRequest).where(
        ExceptionRequest.claim_id == claim_id,
        ExceptionRequest.status == ExceptionRequestStatus.PENDING.value,
    )
    if exclude_id is not None:
        stmt = stmt.where(ExceptionRequest.id != exclude_id)
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return 0
    now = _now()
    open_approvals = (
        await db.execute(
            select(ExceptionApproval).where(
                ExceptionApproval.exception_request_id.in_([row.id for row in rows]),
                ExceptionApproval.status.in_([ExceptionRequestStatus.PENDING.value, "AWAITING"]),
            )
        )
    ).scalars().all()
    for approval in open_approvals:
        approval.status = ExceptionRequestStatus.CANCELLED.value
    for row in rows:
        row.status = ExceptionRequestStatus.CANCELLED.value
        row.decided_at = now
        row.decision_comment = reason
    await _close_open_items([row.id for row in rows if is_itemized_claim_request(row)], db)
    return len(rows)


def _item_name(item) -> str:
    return item.expense_category_name or _humanize_token(item.exception_type)


def _summarize_items(items) -> tuple[list[str], str | None, Decimal | None]:
    """What a claim exception request carries for older readers (reports, the exception log,
    emails) besides its items: its types, the expenses it covers, and their total."""
    types = list(dict.fromkeys(i.exception_type for i in items))
    names = ", ".join(_item_name(i) for i in items)
    amounts = [Decimal(str(i.claimed_amount)) for i in items if i.claimed_amount is not None]
    return types, (names[:128] or None), (sum(amounts, Decimal("0")) if amounts else None)


def _reasons_text(items) -> str:
    return "\n".join(f"{_item_name(i)}: {i.reason}" for i in items if i.reason)


async def raise_claim_exception_request(
    claim: ClaimDraft, *, items: list[dict], cfg: dict, db: AsyncSession
) -> ExceptionRequest:
    """The one exception request for a claim's flagged expenses, raised as part of submitting it
    (see reimbursement_service.submit_claim) — one item per exception ({exception_type,
    category_name, amount, cap_amount, reason}). It goes through the shared claim exception
    route instead of the claim's normal approval: every approver on the route decides each item
    (decide_claim_exception_items), the claim goes to Finance once the last one accepts them all,
    and any rejection rejects the whole claim."""
    rows = [
        ExceptionRequestItem(
            exception_type=item["exception_type"],
            expense_category_name=item.get("category_name"),
            claimed_amount=item.get("amount"),
            cap_amount=item.get("cap_amount"),
            reason=item.get("reason"),
            status=ExceptionRequestStatus.PENDING.value,
            position=pos,
        )
        for pos, item in enumerate(items)
    ]
    types, names, total = _summarize_items(rows)
    req = ExceptionRequest(
        claim_id=claim.id,
        requested_by_user_id=claim.employee_user_id,
        exception_type=types[0],
        exception_types=types,
        description=_reasons_text(rows),
        expense_category_name=names,
        claimed_amount=total,
        status=ExceptionRequestStatus.PENDING.value,
        route_key=CLAIM_EXCEPTIONS_ROUTE,
    )
    db.add(req)
    await db.flush()
    for row in rows:
        row.exception_request_id = req.id
    db.add_all(rows)

    route = await _without_inapplicable_head(
        shared_exception_route(cfg, CLAIM_EXCEPTIONS_ROUTE), claim.employee_id, "exceptions", cfg, db
    )
    steps = [ExceptionApproval(exception_request_id=req.id, required_role=role, status="AWAITING") for role in route]
    db.add_all(steps)
    await start_exception_step(steps[0], req, cfg, db)
    await db.flush()
    await log_event(
        entity_type="exception_request",
        entity_id=str(req.id),
        action="raise_claim_exceptions",
        actor_id=claim.employee_user_id,
        old=None,
        new={
            "claim_id": claim.id,
            "route": route,
            "items": [
                {
                    "item_id": r.id,
                    "exception_type": r.exception_type,
                    "category_name": r.expense_category_name,
                    "amount": _money_str(r.claimed_amount),
                    "cap_amount": _money_str(r.cap_amount),
                    "reason": r.reason,
                }
                for r in rows
            ],
        },
        db=db,
    )
    await _notify_exception_approver(claim, req, route[0], db)
    return req


async def claim_exception_request_awaiting_resubmit(claim_id: int, db: AsyncSession) -> ExceptionRequest | None:
    """The claim's exception request whose approver sent exceptions back, waiting on the employee."""
    return (
        await db.execute(
            select(ExceptionRequest)
            .where(
                ExceptionRequest.claim_id == claim_id,
                ExceptionRequest.route_key == CLAIM_EXCEPTIONS_ROUTE,
                ExceptionRequest.status == ExceptionRequestStatus.SENT_BACK.value,
            )
            .order_by(ExceptionRequest.id.desc())
        )
    ).scalars().first()


def plan_claim_exception_resume(items: list, expenses: list) -> dict | None:
    """How a sent-back exception request picks up again from the claim's expenses as resubmitted:
    each sent-back exception still flagged is updated (amount, cap) and goes back to the step that
    sent it back; one no longer flagged is dropped. None when it can't simply pick up — a new
    exception appeared, or an exception already accepted changed amount — so the caller starts a
    fresh request from the first step instead."""
    open_items = {
        (i.exception_type, i.expense_category_name): i
        for i in items
        if i.status in (ExceptionRequestStatus.PENDING.value, ExceptionRequestStatus.SENT_BACK.value)
    }
    update: list[tuple] = []
    matched: set[int] = set()
    for expense in expenses:
        if not expense.exception_type:
            continue
        item = open_items.get((expense.exception_type, expense.category_name))
        if item is None:
            if getattr(expense, "exception_reason_required", True):
                return None
            continue  # covered by an exception approved before (older request)
        if item.status == ExceptionRequestStatus.PENDING.value and Decimal(str(item.claimed_amount or 0)) != Decimal(
            str(expense.amount)
        ):
            return None
        update.append((item, expense))
        matched.add(item.id)
    drop = [i for i in open_items.values() if i.id not in matched]
    return {"update": update, "drop": drop, "remaining": len(update)}


async def close_claim_exception_request(req: ExceptionRequest, reason: str, db: AsyncSession) -> None:
    """Close a claim exception request (and its open steps and exceptions) without a decision."""
    req.status = ExceptionRequestStatus.CANCELLED.value
    req.decided_at = _now()
    req.decision_comment = reason
    for step in await _load_exception_steps(req.id, db):
        if step.status in (ExceptionRequestStatus.PENDING.value, "AWAITING", ExceptionRequestStatus.SENT_BACK.value):
            step.status = ExceptionRequestStatus.CANCELLED.value
    for item in await _load_exception_items(req.id, db):
        if item.status in (ExceptionRequestStatus.PENDING.value, ExceptionRequestStatus.SENT_BACK.value):
            item.status = ExceptionRequestStatus.CANCELLED.value


async def resume_claim_exception_request(
    claim: ClaimDraft, req: ExceptionRequest, plan: dict, reasons: dict, cfg: dict, db: AsyncSession
) -> None:
    """The employee resubmitted a claim whose exceptions were sent back: the request picks up at
    the step that sent them back, which decides only those again (what it accepted stays
    accepted); then the route carries on as normal. `reasons` holds any new reason per
    (exception_type, category_name). The claim's own route must already be set up (see
    init_claim_exception_route) — if everything left was already accepted there, it moves on
    straight away, possibly to Finance."""
    now = _now()
    for item, expense in plan["update"]:
        if item.status == ExceptionRequestStatus.SENT_BACK.value:
            item.claimed_amount = expense.amount
            item.cap_amount = getattr(expense, "cap_amount", item.cap_amount)
            new_reason = (reasons.get((item.exception_type, item.expense_category_name)) or "").strip()
            if new_reason:
                item.reason = new_reason
            item.status = ExceptionRequestStatus.PENDING.value
    for item in plan["drop"]:
        item.status = ITEM_STATUS_DROPPED
    live = [item for item, _ in plan["update"]]
    await log_event(
        entity_type="exception_request",
        entity_id=str(req.id),
        action="resubmitted",
        actor_id=claim.employee_user_id,
        old={"status": req.status},
        new={
            "items": [
                {"item_id": i.id, "amount": _money_str(i.claimed_amount), "reason": i.reason} for i in live
            ],
            "dropped": [i.id for i in plan["drop"]],
        },
        db=db,
    )
    if not live:
        await close_claim_exception_request(req, "No exceptions left after the employee changed the claim.", db)
        return

    types, names, total = _summarize_items(live)
    req.exception_types = types
    req.exception_type = types[0]
    req.expense_category_name = names
    req.claimed_amount = total
    req.description = _reasons_text(live)
    req.status = ExceptionRequestStatus.PENDING.value

    approvals = await _load_exception_steps(req.id, db)
    step = next((a for a in approvals if a.status == ExceptionRequestStatus.SENT_BACK.value), None)
    if step is None:  # defensive: carry on from the first step not yet done
        open_steps = [a for a in approvals if a.status in ("AWAITING", ExceptionRequestStatus.PENDING.value)]
        step = open_steps[0] if open_steps else approvals[0]
    items = await _load_exception_items(req.id, db)
    decisions = await _load_item_decisions([i.id for i in items], db)
    if items_awaiting_step(items, decisions, step.id):
        step.acted_at = None
        step.comment = None
        await start_exception_step(step, req, cfg, db)
        await _notify_exception_approver(
            claim,
            req,
            step.required_role,
            db,
            "The employee resubmitted the claim after your send-back — only the exceptions you sent back need "
            "your decision again.",
        )
        return
    # Everything left was already accepted at this step (what it sent back no longer applies).
    step.status = ExceptionRequestStatus.APPROVED.value
    step.acted_at = now
    await _advance_claim_exception_route(req, approvals, step, claim, cfg, db)


async def _advance_claim_exception_route(
    req: ExceptionRequest,
    approvals: list[ExceptionApproval],
    step: ExceptionApproval,
    claim: ClaimDraft,
    cfg: dict,
    db: AsyncSession,
    actor_id: int | None = None,
) -> str:
    """After `step` accepted every exception: open the next step, or — after the last — approve
    the request and send the claim on to Finance. Returns "next" or "approved"."""
    ordered = sorted(approvals, key=lambda a: a.id)
    nxt = next((a for a in ordered if a.id > step.id and a.status == "AWAITING"), None)
    if nxt is not None:
        await start_exception_step(nxt, req, cfg, db)
        await _notify_exception_approver(claim, req, nxt.required_role, db)
        return "next"
    now = _now()
    req.status = ExceptionRequestStatus.APPROVED.value
    req.decided_at = now
    req.decided_by_user_id = actor_id
    req.decision_comment = "Every exception was accepted by every approver."
    for item in await _load_exception_items(req.id, db):
        if item.status == ExceptionRequestStatus.PENDING.value:
            item.status = ExceptionRequestStatus.APPROVED.value
    await db.flush()
    if not await has_pending_claim_exceptions(claim.id, db):
        released = await release_claim_to_finance(claim, db)
        if not released and claim.status == ClaimStatus.PENDING_EXCEPTION:
            await init_claim_exception_route(claim, db, exceptions_pending=False)
    return "approved"


# Decisions an approver can give one exception, as sent by the approver's screen.
_ITEM_DECISION_INPUT = {
    "ACCEPT": ExceptionItemDecisionValue.ACCEPTED.value,
    "ACCEPTED": ExceptionItemDecisionValue.ACCEPTED.value,
    "REJECT": ExceptionItemDecisionValue.REJECTED.value,
    "REJECTED": ExceptionItemDecisionValue.REJECTED.value,
    "SEND_BACK": ExceptionItemDecisionValue.SENT_BACK.value,
    "SENT_BACK": ExceptionItemDecisionValue.SENT_BACK.value,
}


def _parse_item_decisions(decisions: list[dict], all_items: list, needing: list) -> dict[int, tuple[str, str | None]]:
    """{item_id: (decision, comment)} for exactly the exceptions this step has to decide — every
    one of them, each Reject / Send back with its reason. Refuses anything else, in plain words."""
    by_id = {i.id: i for i in all_items}
    needing_ids = {i.id for i in needing}
    parsed: dict[int, tuple[str, str | None]] = {}
    for entry in decisions or []:
        try:
            item_id = int(entry.get("item_id"))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Each decision needs the exception it's for") from exc
        item = by_id.get(item_id)
        if item is None:
            raise HTTPException(
                status_code=422, detail="One of these decisions is for an exception that isn't on this claim"
            )
        if item_id not in needing_ids:
            raise HTTPException(status_code=422, detail=f"{_item_name(item)} isn't waiting on your decision")
        value = _ITEM_DECISION_INPUT.get(str(entry.get("decision") or "").strip().upper())
        if value is None:
            raise HTTPException(status_code=422, detail=f"Choose Accept, Reject or Send back for {_item_name(item)}")
        comment = (entry.get("comment") or "").strip() or None
        if value == ExceptionItemDecisionValue.REJECTED.value and not comment:
            raise HTTPException(status_code=422, detail=f"Give a reason for rejecting {_item_name(item)}")
        if value == ExceptionItemDecisionValue.SENT_BACK.value and not comment:
            raise HTTPException(
                status_code=422, detail=f"Add a comment for {_item_name(item)} saying what needs to change"
            )
        parsed[item_id] = (value, comment)
    left = [i for i in needing if i.id not in parsed]
    if left:
        raise HTTPException(
            status_code=422,
            detail=f"Decide every exception before submitting — {len(left)} still "
            f"need{'s' if len(left) == 1 else ''} a decision ({', '.join(_item_name(i) for i in left)}).",
        )
    return parsed


async def _locked_exception_request(exc_id: int, db: AsyncSession) -> ExceptionRequest:
    """The request row locked (SELECT ... FOR UPDATE) so parallel clicks queue up: the first one
    decides, the rest re-read the committed result and are refused (same as approve_claim_stage)."""
    row = (
        await db.execute(
            select(ExceptionRequest)
            .where(ExceptionRequest.id == exc_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Exception request not found")
    return row


async def _locked_exception_steps(request_id: int, db: AsyncSession) -> list[ExceptionApproval]:
    return list(
        (
            await db.execute(
                select(ExceptionApproval)
                .where(ExceptionApproval.exception_request_id == request_id)
                .order_by(ExceptionApproval.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
    )


async def decide_claim_exception_items(
    exc_id: int,
    approver_id: int,
    decisions: list[dict] | None,
    db: AsyncSession,
    *,
    same_for_all: tuple[str, str | None] | None = None,
    override_reason: str | None = None,
) -> ExceptionRequest:
    """One approver's decisions on every exception their step of a claim's exception request
    still has to decide — Accept, Reject (reason required) or Send back (comment required) each,
    submitted together. `same_for_all` (decision, comment) applies one decision to all of them
    (the older single approve/reject endpoint).

    Any rejection rejects the whole claim. Otherwise any send-back returns the claim to the
    employee (SENT_BACK); on resubmission it comes back to this same step, which only decides the
    sent-back exceptions again (see resume_claim_exception_request). All accepted: on to the
    next step, or after the last one, to Finance."""
    row = await _locked_exception_request(exc_id, db)
    if not is_itemized_claim_request(row):
        raise HTTPException(
            status_code=422,
            detail="This exception request has one decision for the whole request — approve or reject it",
        )
    if row.status != ExceptionRequestStatus.PENDING.value:
        raise HTTPException(status_code=409, detail=ALREADY_DECIDED_DETAIL)
    approver = await db.get(User, approver_id)
    if approver is None:
        raise HTTPException(status_code=404, detail="User not found")
    claim = await db.get(ClaimDraft, row.claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")

    approvals = await _locked_exception_steps(row.id, db)
    step = next((a for a in approvals if a.status in (ExceptionRequestStatus.PENDING.value, "AWAITING")), None)
    if step is None or step.status != ExceptionRequestStatus.PENDING.value:
        raise HTTPException(status_code=409, detail=ALREADY_DECIDED_DETAIL)
    if is_own_item(approver, claim.employee_user_id):
        raise HTTPException(status_code=403, detail="You can't decide the exceptions on your own claim")
    if override_reason:
        # An admin override decides every exception at this step the same way (override_service).
        same_for_all = (same_for_all[0] if same_for_all else ExceptionItemDecisionValue.ACCEPTED.value,
                        override_note(approver, override_reason))
    elif not await _user_matches_required_role(approver, step.required_role, claim.employee_id, db):
        if any(a.acted_by_user_id == approver_id and a.id < step.id for a in approvals):
            raise HTTPException(status_code=409, detail=ALREADY_DECIDED_DETAIL)
        raise HTTPException(status_code=403, detail="This step of the exception route isn't yours to decide")

    items = await _load_exception_items(row.id, db)
    past = await _load_item_decisions([i.id for i in items], db)
    needing = items_awaiting_step(items, past, step.id)
    if same_for_all is not None:
        decisions = [{"item_id": i.id, "decision": same_for_all[0], "comment": same_for_all[1]} for i in needing]
    parsed = _parse_item_decisions(decisions or [], items, needing)

    cfg = await get_workflow_config(db)
    now = _now()
    for item in needing:
        value, comment = parsed[item.id]
        db.add(
            ExceptionItemDecision(
                item_id=item.id,
                exception_approval_id=step.id,
                decision=value,
                comment=comment,
                decided_by_user_id=approver_id,
                decided_at=now,
            )
        )
    rejected = [i for i in needing if parsed[i.id][0] == ExceptionItemDecisionValue.REJECTED.value]
    sent_back = [i for i in needing if parsed[i.id][0] == ExceptionItemDecisionValue.SENT_BACK.value]
    accepted = [i for i in needing if parsed[i.id][0] == ExceptionItemDecisionValue.ACCEPTED.value]
    def lines(chosen) -> str:
        return "; ".join(f"{_item_name(i)}: {parsed[i.id][1]}" for i in chosen)

    step.acted_by_user_id = approver_id
    step.acted_at = now
    previous_status = claim.status.value
    claim_ref = claim.claim_reference or f"CLM-{claim.id}"
    approver_name = approver.full_name or approver.email

    if rejected:
        outcome = "rejected"
        step.status = ExceptionRequestStatus.REJECTED.value
        step.comment = lines(rejected)
        for a in approvals:
            if a.status in (ExceptionRequestStatus.PENDING.value, "AWAITING"):
                a.status = ExceptionRequestStatus.REJECTED.value
        row.status = ExceptionRequestStatus.REJECTED.value
        row.decided_at = now
        row.decided_by_user_id = approver_id
        row.decision_comment = lines(rejected)
        for item in items:
            if item in rejected:
                item.status = ExceptionRequestStatus.REJECTED.value
            elif item.status in (ExceptionRequestStatus.PENDING.value, ExceptionRequestStatus.SENT_BACK.value):
                item.status = ExceptionRequestStatus.CANCELLED.value
        if claim.status in (ClaimStatus.IN_APPROVAL, ClaimStatus.READY_FOR_PAYMENT, ClaimStatus.PENDING_EXCEPTION):
            # Same end state as reject_claim, so its invoices go back to Archived/reusable.
            claim.status = ClaimStatus.REJECTED
            claim.reject_reason = "Policy exception rejected — " + "; ".join(
                f"{_item_name(i)} ({_humanize_token(i.exception_type)}): {parsed[i.id][1]}" for i in rejected
            )
            for stage_row in await _load_stages(claim.id, db):
                if stage_row.status == ClaimApprovalStageStatus.PENDING.value:
                    stage_row.status = ClaimApprovalStageStatus.REJECTED.value
                    stage_row.decided_at = now
                    stage_row.comment = "Closed: a policy exception was rejected."
            await cancel_pending_claim_exceptions(
                claim.id, "Claim rejected: one of its policy exceptions was rejected.", db, exclude_id=row.id
            )
            await log_event(
                entity_type="claim_draft",
                entity_id=str(claim.id),
                action="reject_claim_via_exception",
                actor_id=approver_id,
                old={"status": previous_status, "reject_reason": None},
                new={
                    "status": claim.status.value,
                    "reject_reason": claim.reject_reason,
                    "exception_request_id": row.id,
                    "rejected_items": [i.id for i in rejected],
                },
                db=db,
            )
        title = f"Claim rejected: {claim_ref}"
        body = (
            f"{approver_name} rejected "
            + "; ".join(f"{_item_name(i)} ({_humanize_token(i.exception_type)}) — {parsed[i.id][1]}" for i in rejected)
            + ". Because of this, the whole claim has been rejected."
        )
        send_email = True
    elif sent_back:
        outcome = "sent_back"
        step.status = ExceptionRequestStatus.SENT_BACK.value
        step.comment = lines(sent_back)
        row.status = ExceptionRequestStatus.SENT_BACK.value
        for item in sent_back:
            item.status = ExceptionRequestStatus.SENT_BACK.value
        claim.status = ClaimStatus.SENT_BACK
        claim.current_approval_stage = None
        await log_event(
            entity_type="claim_draft",
            entity_id=str(claim.id),
            action="send_back_via_exception",
            actor_id=approver_id,
            old={"status": previous_status},
            new={
                "status": claim.status.value,
                "comment": lines(sent_back),
                "stage_number": None,
                "exception_request_id": row.id,
                "sent_back_items": [i.id for i in sent_back],
            },
            db=db,
        )
        title = f"Claim sent back: {claim_ref}"
        body = f"{approver_name} sent back {lines(sent_back)}."
        if accepted:
            body += f" Accepted: {', '.join(_item_name(i) for i in accepted)}."
        body += (
            " Change the reason or the bill for each one sent back and resubmit — it comes back to "
            f"{approver_name}."
        )
        send_email = True
    else:
        step.status = ExceptionRequestStatus.APPROVED.value
        outcome = await _advance_claim_exception_route(row, approvals, step, claim, cfg, db, approver_id)
        if outcome == "approved":
            title = f"Exceptions approved: {claim_ref}"
            body = "Every policy exception on your claim was approved. It now goes to Finance for payment."
            send_email = True
        else:
            nxt = next(a for a in approvals if a.status == ExceptionRequestStatus.PENDING.value)
            title = f"Exceptions accepted: {claim_ref}"
            body = (
                f"{approver_name} accepted the policy exceptions on your claim. They're now with "
                f"{_humanize_token(nxt.required_role)}."
            )
            send_email = False

    await log_event(
        entity_type="exception_request",
        entity_id=str(row.id),
        action="decide_items",
        actor_id=approver_id,
        old={"status": ExceptionRequestStatus.PENDING.value, "step_role": step.required_role},
        new={
            "status": row.status,
            "outcome": outcome,
            "decisions": [
                {"item_id": i.id, "decision": parsed[i.id][0], "comment": parsed[i.id][1]} for i in needing
            ],
            "override_reason": override_reason,
        },
        db=db,
    )
    await db.commit()
    await db.refresh(row)

    await create_notification(
        user_id=row.requested_by_user_id,
        title=title,
        body=body,
        link=f"/claims/{claim.id}",
        category=NotificationCategory.EXCEPTION.value,
        db=db,
        send_email=send_email,
    )
    await db.commit()
    return row


async def get_exception_request(exc_id: int, db: AsyncSession) -> ExceptionRequest:
    row = await db.get(ExceptionRequest, exc_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Exception request not found")
    return row


async def decide_exception_request(
    exc_id: int, approver_id: int, approve: bool, comment: str | None, db: AsyncSession,
    *, override_reason: str | None = None,
) -> ExceptionRequest:
    if override_reason:
        comment = override_reason
    # Same rule as rejecting a claim: the employee is always told why.
    if not approve and not (comment or "").strip():
        raise HTTPException(status_code=422, detail="Rejection reason is mandatory")
    # Locked so a double click (or two tabs) can't decide the same step twice.
    row = await _locked_exception_request(exc_id, db)
    if is_itemized_claim_request(row):
        # A claim's exceptions are decided one by one; one approve/reject here applies to every
        # exception this step still has to decide.
        decision = ExceptionItemDecisionValue.ACCEPTED.value if approve else ExceptionItemDecisionValue.REJECTED.value
        return await decide_claim_exception_items(
            exc_id, approver_id, None, db, same_for_all=(decision, (comment or "").strip() or None),
            override_reason=override_reason,
        )
    if row.status != ExceptionRequestStatus.PENDING.value:
        raise HTTPException(status_code=409, detail=ALREADY_DECIDED_DETAIL)

    approver = await db.get(User, approver_id)
    if approver is None:
        raise HTTPException(status_code=404, detail="User not found")

    claim = None
    travel_request = None
    subject_employee_id = None
    if row.claim_id is not None:
        claim = await db.get(ClaimDraft, row.claim_id)
        if claim is None:
            raise HTTPException(status_code=404, detail="Claim not found")
        subject_employee_id = claim.employee_id
    else:
        from app.models.travel_request import TravelRequest

        travel_request = await db.get(TravelRequest, row.travel_request_id)
        if travel_request is None:
            raise HTTPException(status_code=404, detail="Travel request not found")
        subject_user = await db.get(User, travel_request.employee_user_id)
        subject_employee_id = subject_user.employee_id if subject_user else None

    approvals = await _locked_exception_steps(row.id, db)

    sorted_approvals = sorted(approvals, key=lambda x: x.id)

    active_stage = None
    for a in sorted_approvals:
        if a.status in (ExceptionRequestStatus.PENDING.value, "AWAITING"):
            active_stage = a
            break

    if active_stage is None or active_stage.status != ExceptionRequestStatus.PENDING.value:
        raise HTTPException(
            status_code=403,
            detail="There is no active pending stage for this exception request"
        )

    subject_user_id = claim.employee_user_id if claim is not None else travel_request.employee_user_id
    if is_own_item(approver, subject_user_id):
        raise HTTPException(status_code=403, detail="You can't decide your own exception request")

    # Check if approver matches active_stage — directly, or via an active delegation from
    # whoever holds that role (see _user_matches_required_role). An admin override skips this.
    if override_reason:
        is_match = True
        comment = override_note(approver, override_reason)
    else:
        is_match = await _user_matches_required_role(approver, active_stage.required_role, subject_employee_id, db)

    if not is_match:
        # A repeat click arriving after this approver's own decision moved it to the next step.
        if any(a.acted_by_user_id == approver_id and a.id < active_stage.id for a in sorted_approvals):
            raise HTTPException(status_code=409, detail=ALREADY_DECIDED_DETAIL)
        raise HTTPException(
            status_code=403,
            detail="Your role is not in the active pending stage of this exception approval chain"
        )

    stage = active_stage

    now = _now()
    stage.status = ExceptionRequestStatus.APPROVED.value if approve else ExceptionRequestStatus.REJECTED.value
    stage.acted_by_user_id = approver_id
    stage.acted_at = now
    stage.comment = comment

    if not approve:
        row.status = ExceptionRequestStatus.REJECTED.value
        row.decided_at = now
        row.decided_by_user_id = approver_id
        row.decision_comment = comment

        # Mark all subsequent stages as REJECTED/CANCELLED
        for a in sorted_approvals:
            if a.status in (ExceptionRequestStatus.PENDING.value, "AWAITING"):
                a.status = ExceptionRequestStatus.REJECTED.value

        if travel_request is not None:
            from app.models.travel_request import TravelRequestStatus

            travel_request.status = TravelRequestStatus.REJECTED.value
            travel_request.rejection_reason = comment or f"Exception '{_exception_label(row)}' was rejected."
        elif claim is not None and claim.status in (
            ClaimStatus.IN_APPROVAL,
            ClaimStatus.READY_FOR_PAYMENT,
            ClaimStatus.PENDING_EXCEPTION,
        ):
            # Any rejected exception rejects the whole claim (same end state as reject_claim, so
            # its invoices go back to Archived/reusable via the normal rejected-claim flow). The
            # claim's normal approval runs in parallel with its exceptions, so also close its
            # open approval step(s) — otherwise they'd sit in approvers' queues and keep tripping
            # SLA escalations — and its other still-pending exceptions.
            previous_status = claim.status.value
            claim.status = ClaimStatus.REJECTED
            claim.reject_reason = comment or f"Exception '{_exception_label(row)}' was rejected."
            for stage_row in await _load_stages(claim.id, db):
                if stage_row.status == ClaimApprovalStageStatus.PENDING.value:
                    stage_row.status = ClaimApprovalStageStatus.REJECTED.value
                    stage_row.decided_at = now
                    stage_row.comment = f"Closed: exception '{_exception_label(row)}' was rejected."
            await cancel_pending_claim_exceptions(
                claim.id,
                f"Claim rejected: exception '{_exception_label(row)}' was rejected.",
                db,
                exclude_id=row.id,
            )
            await log_event(
                entity_type="claim_draft",
                entity_id=str(claim.id),
                action="reject_claim_via_exception",
                actor_id=approver_id,
                old={"status": previous_status, "reject_reason": None},
                new={
                    "status": claim.status.value,
                    "reject_reason": claim.reject_reason,
                    "exception_request_id": row.id,
                },
                db=db,
            )
    else:
        # Check if there is a next stage in "AWAITING" state
        next_stage = None
        current_idx = sorted_approvals.index(stage)
        if current_idx + 1 < len(sorted_approvals):
            next_stage = sorted_approvals[current_idx + 1]

        if next_stage and next_stage.status == "AWAITING":
            await start_exception_step(next_stage, row, await get_workflow_config(db), db)
            row.status = ExceptionRequestStatus.PENDING.value
            # Notify the next stage approver
            if claim is not None:
                await _notify_exception_approver(claim, row, next_stage.required_role, db)
            else:
                await _notify_travel_exception_approver(travel_request, row, next_stage.required_role, db)
        else:
            row.status = ExceptionRequestStatus.APPROVED.value
            row.decided_at = now
            row.decided_by_user_id = approver_id
            row.decision_comment = "Exception approved by all required approver roles."

            if claim is not None:
                await db.flush()
                # A shell claim exists only to carry this exception request — it has no
                # expenses to review or pay, so it never enters the claim approval workflow.
                if not claim.is_exception_shell and not await has_pending_claim_exceptions(claim.id, db):
                    # Every exception approved — the claim goes to Finance for payment.
                    released = await release_claim_to_finance(claim, db)
                    if not released and claim.status == ClaimStatus.PENDING_EXCEPTION:
                        # Legacy: claims held in PENDING_EXCEPTION before the finance-only route
                        # existed have no stage rows at all — build it and release in one go.
                        await init_claim_exception_route(claim, db, exceptions_pending=False)
            else:
                from app.models.travel_request import TravelRequestStatus

                active_exceptions_stmt = select(ExceptionRequest).where(
                    ExceptionRequest.travel_request_id == travel_request.id,
                    ExceptionRequest.status != ExceptionRequestStatus.APPROVED.value
                )
                other_active = (await db.execute(active_exceptions_stmt)).scalars().first()
                if not other_active:
                    # The exception chain IS this request's approval: once every exception
                    # approver has signed off it goes straight to the travel agent, without also
                    # going back through the normal approval stages (which only apply to
                    # requests that never needed an exception).
                    travel_request.status = TravelRequestStatus.APPROVED.value
                    travel_request.current_approval_stage = None
                    await _finalize_travel_request_approval(travel_request, approver_id, db)
                    await log_event(
                        entity_type="travel_request",
                        entity_id=str(travel_request.id),
                        action="approve_via_exception",
                        actor_id=approver_id,
                        old={"status": TravelRequestStatus.PENDING_EXCEPTION.value},
                        new={"status": travel_request.status, "exception_request_id": row.id},
                        db=db,
                    )

    await db.commit()
    await db.refresh(row)

    # Notify employee of the decision update
    if row.claim_id is not None:
        claim = await db.get(ClaimDraft, row.claim_id)
        claim_ref = claim.claim_reference or f"CLM-{claim.id:04d}" if claim else f"CLM-{row.claim_id:04d}"
        link = f"/claims/{row.claim_id}" if claim else "/claims/my"
    else:
        claim_ref = f"TR-{row.travel_request_id:04d}"
        link = "/travel-requests"

    # Only the final decision (approved or rejected) is emailed to the employee — an
    # intermediate stage pass-through still creates the in-app notification below but
    # is sent with send_email=False, so approvers earlier in the chain don't each trigger
    # a separate email to the employee.
    send_email = True
    exception_label = _exception_label(row)
    if row.status == ExceptionRequestStatus.REJECTED.value:
        title = f"Exception Request Rejected: {claim_ref}"
        body = f"Your exception request for {exception_label} was rejected by {_humanize_token(approver.role.value)}."
        if comment:
            body += f" Comment: {comment}"
        if claim is not None and claim.status == ClaimStatus.REJECTED:
            body += " Because of this, the whole claim has been rejected."
    elif row.status == ExceptionRequestStatus.APPROVED.value:
        title = f"Exception Request Approved: {claim_ref}"
        body = f"Your exception request for {exception_label} has been fully approved!"
    else:
        send_email = False
        title = f"Exception Stage Approved: {claim_ref}"
        body = f"Your exception request was approved by {_humanize_token(approver.role.value)} and is pending remaining roles."
        if comment:
            body += f" Comment: {comment}"

    await create_notification(
        user_id=row.requested_by_user_id,
        title=title,
        body=body,
        link=link,
        category=NotificationCategory.EXCEPTION.value,
        db=db,
        send_email=send_email,
    )
    await db.commit()

    return row


async def create_advance_grant(
    finance_user_id: int,
    employee_identifier: str,
    amount: Decimal,
    purpose: str | None,
    db: AsyncSession,
    *,
    confirm_merge: bool = False,
) -> AdvanceRequest:
    """Finance grants an advance directly to an employee — no request, no approval chain.
    It's active the moment it's created; drawdown happens later, at payment time, against
    the employee's outstanding balance (see get_outstanding_advance).

    An employee only ever has one *active* grant at a time — otherwise a grant that's already
    been fully drawn down could reappear as if it were still open the moment the employee gets
    a new one (each grant's own remaining amount would look unrelated to the others). If they
    already have one, this tops it up instead of creating a second row, but only once Finance
    has explicitly confirmed that (see the 409 raised below, and AdvanceGrantIn.confirm_merge).

    There's no employee picker/search UI (that would need a new broad "list users" endpoint
    Finance doesn't otherwise have access to), so Finance identifies the employee by their
    employee ID or email, resolved to a user here."""
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Advance amount must be positive")

    identifier = employee_identifier.strip()
    employee = (
        await db.execute(
            select(User).where((User.employee_id == identifier) | (User.email.ilike(identifier)))
        )
    ).scalars().first()
    if employee is None:
        raise HTTPException(status_code=404, detail=f"No employee found matching '{identifier}'")

    existing = (
        await db.execute(
            select(AdvanceRequest)
            .where(
                AdvanceRequest.employee_user_id == employee.id,
                AdvanceRequest.status == AdvanceRequestStatus.APPROVED.value,
                AdvanceRequest.amount > 0,
            )
            .order_by(AdvanceRequest.created_at.asc())
        )
    ).scalars().first()

    if existing is not None:
        if not confirm_merge:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "existing_active_advance",
                    "existing_amount": str(existing.amount),
                    "message": (
                        f"{employee.full_name or employee.email} already has an active advance of "
                        f"₹{existing.amount}. Add ₹{amount} to it instead of creating a new one?"
                    ),
                },
            )
        old = {"amount": str(existing.amount), "granted_amount": str(existing.granted_amount)}
        existing.amount += amount
        existing.granted_amount += amount
        await log_event(
            entity_type="advance_request",
            entity_id=str(existing.id),
            action="advance_topped_up",
            actor_id=finance_user_id,
            old=old,
            new={"added_amount": str(amount), "added_purpose": purpose, "amount": str(existing.amount)},
            db=db,
        )
        await db.commit()
        await db.refresh(existing)
        return existing

    adv = AdvanceRequest(
        employee_user_id=employee.id,
        amount=amount,
        granted_amount=amount,
        purpose=purpose,
        status=AdvanceRequestStatus.APPROVED.value,
        created_by_user_id=finance_user_id,
    )
    db.add(adv)
    await db.flush()
    await log_event(
        entity_type="advance_request",
        entity_id=str(adv.id),
        action="advance_granted",
        actor_id=finance_user_id,
        old=None,
        new={"employee_user_id": employee.id, "amount": str(amount), "purpose": purpose},
        db=db,
    )
    await db.commit()
    await db.refresh(adv)
    return adv


async def update_advance_grant(
    finance_user_id: int, advance_id: int, granted_amount: Decimal, purpose: str | None, db: AsyncSession
) -> AdvanceRequest:
    """Corrects the amount/purpose of a grant already made — e.g. Finance typed the wrong
    figure. Which employee it was granted to is not editable here (see AdvanceUpdateIn).

    `amount` (the current remaining allocation) shifts by the same delta rather than being
    overwritten outright — otherwise correcting a grant that's already been partly settled
    would silently wipe out that settlement (the remaining balance would jump back up to the
    full new figure instead of staying reduced by whatever was already settled off it)."""
    if granted_amount <= 0:
        raise HTTPException(status_code=422, detail="Advance amount must be positive")

    adv = await db.get(AdvanceRequest, advance_id)
    if adv is None:
        raise HTTPException(status_code=404, detail="Advance not found")

    old = {"granted_amount": str(adv.granted_amount), "amount": str(adv.amount), "purpose": adv.purpose}
    previous_granted = adv.granted_amount if adv.granted_amount is not None else adv.amount
    settled = max(previous_granted - adv.amount, Decimal("0"))
    if granted_amount < settled:
        # Clamping the remainder to zero would hide the shortfall — refuse instead.
        raise HTTPException(
            status_code=422,
            detail=(
                f"₹{settled.quantize(Decimal('0.01'))} of this advance has already been settled, "
                "so the granted amount can't be less than that."
            ),
        )
    delta = granted_amount - previous_granted
    adv.granted_amount = granted_amount
    adv.amount = adv.amount + delta
    adv.purpose = purpose
    await log_event(
        entity_type="advance_request",
        entity_id=str(adv.id),
        action="advance_updated",
        actor_id=finance_user_id,
        old=old,
        new={"granted_amount": str(granted_amount), "amount": str(adv.amount), "purpose": purpose},
        db=db,
    )
    await db.commit()
    await db.refresh(adv)
    return adv


async def _draw_down_advance(
    employee_user_id: int,
    amount: Decimal,
    via: str,
    db: AsyncSession,
    *,
    actor_id: int | None = None,
    note: str | None = None,
) -> None:
    """Reduces the employee's active grant(s) by `amount`, oldest first, crediting whichever
    channel (claims vs settlement) actually drew it down — shared by record_claim_payment and
    settle_advance so a grant's own remaining amount is always accurate regardless of which
    channel touched it, and can never look "still open" once it's genuinely been drawn dry.
    Employees normally have at most one active grant (see create_advance_grant's merge-on-top-up
    behavior), but this still loops in case older data ever has more than one."""
    if amount <= 0:
        return
    grants = (
        await db.execute(
            select(AdvanceRequest)
            .where(
                AdvanceRequest.employee_user_id == employee_user_id,
                AdvanceRequest.status == AdvanceRequestStatus.APPROVED.value,
                AdvanceRequest.amount > 0,
            )
            .order_by(AdvanceRequest.created_at.asc())
        )
    ).scalars().all()

    remaining = amount
    for grant in grants:
        if remaining <= 0:
            break
        reduced_by = min(grant.amount, remaining)
        old_amount = grant.amount
        grant.amount -= reduced_by
        remaining -= reduced_by
        if via == "settlement":
            grant.consumed_via_settlement += reduced_by
            await log_event(
                entity_type="advance_request",
                entity_id=str(grant.id),
                action="advance_settled",
                actor_id=actor_id,
                old={"amount": str(old_amount)},
                new={"amount": str(grant.amount), "settled": str(reduced_by), "note": note},
                db=db,
            )
        else:
            grant.consumed_via_claims += reduced_by


async def settle_advance(
    finance_user_id: int, employee_user_id: int, amount: Decimal, note: str | None, db: AsyncSession
) -> Decimal:
    """Clears some or all of an employee's outstanding advance directly — e.g. they paid it
    back in cash, or it's being written off — without a claim payment to net it against."""
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Settlement amount must be positive")

    outstanding = await get_outstanding_advance(employee_user_id, db)
    if amount > outstanding:
        raise HTTPException(
            status_code=422, detail=f"Cannot settle more than the outstanding advance ({outstanding})"
        )

    await _draw_down_advance(employee_user_id, amount, "settlement", db, actor_id=finance_user_id, note=note)
    await db.commit()
    return await get_outstanding_advance(employee_user_id, db)


async def list_all_advances(db: AsyncSession, employee_user_id: int | None = None) -> list[dict]:
    """Finance's active view — grants that still have a remaining balance of their own. A
    grant that's been fully drawn down (`amount` <= 0) never shows here again, even if the
    same employee later gets a brand new one (see list_archived_advances)."""
    query = (
        select(AdvanceRequest, User, Employee)
        .outerjoin(User, User.id == AdvanceRequest.employee_user_id)
        .outerjoin(Employee, Employee.employee_id == User.employee_id)
        .where(AdvanceRequest.amount > 0)
        .order_by(AdvanceRequest.created_at.desc())
    )
    if employee_user_id is not None:
        query = query.where(AdvanceRequest.employee_user_id == employee_user_id)
    rows = list((await db.execute(query)).all())

    creator_ids = {adv.created_by_user_id for adv, _, _ in rows if adv.created_by_user_id}
    creators: dict[int, str] = {}
    if creator_ids:
        creator_rows = (await db.execute(select(User).where(User.id.in_(creator_ids)))).scalars().all()
        creators = {u.id: (u.full_name or u.email) for u in creator_rows}

    now = _now()
    outstanding_by_employee: dict[int, Decimal] = {}
    out: list[dict] = []
    for adv, user, employee in rows:
        if adv.employee_user_id not in outstanding_by_employee:
            outstanding_by_employee[adv.employee_user_id] = await get_outstanding_advance(adv.employee_user_id, db)
        age_days = (now - adv.created_at).days if adv.created_at else 0
        settled_amount = adv.consumed_via_claims + adv.consumed_via_settlement
        out.append(
            {
                "id": adv.id,
                "employee_user_id": adv.employee_user_id,
                "employee_id": user.employee_id if user else None,
                "employee_name": user.full_name if user else None,
                "department": employee.department if employee else None,
                "granted_amount": str(adv.granted_amount),
                "amount": str(adv.amount),
                "settled_amount": str(settled_amount),
                "purpose": adv.purpose,
                "status": adv.status,
                "created_by_name": creators.get(adv.created_by_user_id),
                "created_at": adv.created_at.isoformat() if adv.created_at else None,
                "age_days": age_days,
                "employee_outstanding_total": str(outstanding_by_employee[adv.employee_user_id]),
            }
        )
    return out


async def list_archived_advances(db: AsyncSession) -> list[dict]:
    """Grants that have been fully drawn down (`amount` <= 0) — settled, either by claim
    payments netting them off, by a direct Settle Up, or a mix of both. Grouped by employee
    for display, but scoped to *these specific settled grants* only — an employee's separate,
    still-active grant (if they have a new one) stays in the active list, never mixed in here."""
    rows = list(
        (
            await db.execute(
                select(AdvanceRequest, User, Employee)
                .outerjoin(User, User.id == AdvanceRequest.employee_user_id)
                .outerjoin(Employee, Employee.employee_id == User.employee_id)
                .where(AdvanceRequest.amount <= 0, AdvanceRequest.granted_amount > 0)
                .order_by(AdvanceRequest.employee_user_id, AdvanceRequest.created_at.asc())
            )
        ).all()
    )

    by_employee: dict[int, list[tuple[AdvanceRequest, User | None, Employee | None]]] = {}
    for adv, user, employee in rows:
        by_employee.setdefault(adv.employee_user_id, []).append((adv, user, employee))

    creator_ids = {
        adv.created_by_user_id for group in by_employee.values() for adv, _, _ in group if adv.created_by_user_id
    }
    creators: dict[int, str] = {}
    if creator_ids:
        creator_rows = (await db.execute(select(User).where(User.id.in_(creator_ids)))).scalars().all()
        creators = {u.id: (u.full_name or u.email) for u in creator_rows}

    out: list[dict] = []
    for employee_user_id, group in by_employee.items():
        total_granted = sum((adv.granted_amount for adv, _, _ in group), Decimal("0"))
        consumed_via_claims = sum((adv.consumed_via_claims for adv, _, _ in group), Decimal("0"))
        consumed_via_settlement = sum((adv.consumed_via_settlement for adv, _, _ in group), Decimal("0"))

        _, user, employee = group[0]
        # A grant's `updated_at` bumps every time a drawdown touches it, so the latest one
        # marks the moment this specific group actually hit zero — used both as "Settled On"
        # and as the cutoff for which claims below could plausibly have drawn from it (as
        # opposed to a separate, still-active grant the same employee has since been given).
        settled_at = max((adv.updated_at for adv, _, _ in group), default=None)

        claim_rows = []
        if consumed_via_claims > 0:
            claim_query = select(
                ClaimDraft.claim_reference, ClaimDraft.id, ClaimDraft.payment_recorded_at, ClaimDraft.advance_received
            ).where(
                ClaimDraft.employee_user_id == employee_user_id,
                ClaimDraft.status == ClaimStatus.PAID,
                ClaimDraft.advance_received > 0,
            )
            if settled_at is not None:
                claim_query = claim_query.where(ClaimDraft.payment_recorded_at <= settled_at)
            claim_rows = (await db.execute(claim_query.order_by(ClaimDraft.payment_recorded_at.asc()))).all()

        out.append(
            {
                "employee_user_id": employee_user_id,
                "employee_id": user.employee_id if user else None,
                "employee_name": user.full_name if user else None,
                "department": employee.department if employee else None,
                "total_granted": str(total_granted),
                "consumed_via_claims": str(consumed_via_claims),
                "consumed_via_settlement": str(consumed_via_settlement),
                "settled_at": settled_at.isoformat() if settled_at else None,
                "grants": [
                    {
                        "id": adv.id,
                        "granted_amount": str(adv.granted_amount),
                        "purpose": adv.purpose,
                        "created_at": adv.created_at.isoformat() if adv.created_at else None,
                        "created_by_name": creators.get(adv.created_by_user_id),
                    }
                    for adv, _, _ in group
                ],
                "claims_used": [
                    {
                        "claim_reference": c.claim_reference or f"CLM-{c.id}",
                        "payment_recorded_at": c.payment_recorded_at.isoformat() if c.payment_recorded_at else None,
                        "amount_deducted": str(c.advance_received),
                    }
                    for c in claim_rows
                ],
            }
        )

    out.sort(key=lambda r: r["settled_at"] or "", reverse=True)
    return out


async def process_auto_approvals(db: AsyncSession) -> None:
    """
    Check for pending claim stages whose claim total is at or under the auto-approve threshold
    (up to and including it — the settings say "₹X or less"),
    and auto-approve them if they have been pending for at least 5 minutes.
    """
    now = _now()
    # threshold/exception_chains/submission are shared across categories, but stage_defs
    # (route_role per stage number) can differ per category override — resolved per claim below.
    cfg = await get_workflow_config(db)
    threshold = parse_auto_approve_threshold(cfg)
    stage_defs_by_category: dict[str, list[dict]] = {}

    # Fetch all claims in IN_APPROVAL status
    result = await db.execute(
        select(ClaimDraft).where(ClaimDraft.status == ClaimStatus.IN_APPROVAL)
    )
    claims = result.scalars().all()

    for claim in claims:
        total = total_claimed_from_report(claim)
        if total <= Decimal("0"):
            continue
        # A claim with an exception still undecided always gets a human look, however small.
        if await has_pending_claim_exceptions(claim.id, db):
            continue

        stages = await _load_stages(claim.id, db)
        pending = _active_pending_stage(claim, stages)
        if not pending:
            continue

        category = claim.reimbursement_category.value
        if category not in stage_defs_by_category:
            category_cfg = await get_workflow_config(db, category=category)
            stage_defs_by_category[category] = _normalize_stage_defs(category_cfg)
        stage_defs = stage_defs_by_category[category]

        # Finance stage is never auto-approved
        stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
        if not stage_def or str(stage_def.get("route_role")) == Role.FINANCE.value:
            continue

        # The reporting manager's personal threshold can only tighten (never loosen) the
        # org-wide ceiling for their own stage — see the profile "auto-approve threshold" setting.
        effective_threshold = threshold
        if str(stage_def.get("route_role")) == Role.REPORTING_MANAGER.value:
            manager = await _reporting_manager_user_for_claim(claim, db)
            if manager is not None and manager.auto_approve_threshold is not None:
                effective_threshold = min(threshold, manager.auto_approve_threshold)

        if total > effective_threshold:
            continue

        # Determine when this stage became pending
        pending_since = claim.submitted_at
        if pending.stage_number > 1:
            prev_decided_stages = [
                s for s in stages
                if s.stage_number < pending.stage_number
                and s.status == ClaimApprovalStageStatus.APPROVED.value
            ]
            if prev_decided_stages:
                prev_decided_stages.sort(key=lambda x: x.stage_number, reverse=True)
                pending_since = prev_decided_stages[0].decided_at or claim.submitted_at

        if not pending_since:
            pending_since = claim.submitted_at or now

        # If 5 minutes have elapsed since it became pending, auto-approve it
        if (now - pending_since) >= timedelta(minutes=5):
            print(f"[AUTO-APPROVE] Stage {pending.stage_number} of Claim {claim.id} ({claim.claim_reference}) has been pending since {pending_since}. Auto-approving now.")

            previous_status = claim.status.value
            previous_stage = claim.current_approval_stage

            # Attribute the auto-approval to whoever was actually assigned to this stage
            # (the claim owner's manager for REPORTING_MANAGER, or the first user holding
            # the stage's role for a role-pool stage) so the timeline can show their name
            # with an "(Auto Approved)" label instead of an unattributed "System" entry.
            eligible_user_ids = await _user_ids_for_stage(claim, stage_def, db)
            attributed_user_id = eligible_user_ids[0] if eligible_user_ids else None

            pending.status = ClaimApprovalStageStatus.APPROVED.value
            pending.decided_at = now
            pending.decided_by_user_id = attributed_user_id
            pending.comment = None

            # Transition to the next stage
            next_stage_number = min((s.stage_number for s in stages if s.stage_number > pending.stage_number), default=None)
            if next_stage_number is not None:
                next_stages = [s for s in stages if s.stage_number == next_stage_number]
                next_stage_defs = [s for s in stage_defs if int(s["number"]) == next_stage_number]

                is_finance = any(str(sd.get("route_role")) == Role.FINANCE.value for sd in next_stage_defs)

                claim.current_approval_stage = next_stage_number
                if is_finance:
                    claim.status = ClaimStatus.READY_FOR_PAYMENT
                await _activate_stage_rows(claim, next_stages, next_stage_defs, stage_defs, next_stage_number, now, db)

            await log_event(
                entity_type="claim_draft",
                entity_id=str(claim.id),
                action="approve_stage_auto",
                actor_id=attributed_user_id,
                old={"status": previous_status, "current_approval_stage": previous_stage},
                new={
                    "status": claim.status.value,
                    "current_approval_stage": claim.current_approval_stage,
                    "approved_stage_number": pending.stage_number,
                    "comment": None,
                },
                db=db,
            )
            await db.commit()

