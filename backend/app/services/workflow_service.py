"""Phase 3 claim approval chain, advances, exceptions, and workflow config."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import PERMISSION_MATRIX
from app.models.auth import Delegation, Role, User
from app.models.claim_workflow import (
    AdvanceApprovalStage,
    AdvanceRequest,
    AdvanceRequestStatus,
    ClaimApprovalStage,
    ClaimApprovalStageStatus,
    ExceptionApproval,
    ExceptionRequest,
    ExceptionRequestStatus,
    NotificationCategory,
    WorkflowConfigRow,
)
from app.models.employee import AuditLog, Employee
from app.models.reimbursement import ClaimDraft, ClaimStatus
from app.services.audit_service import log_event
from app.services.claim_submission_rules import (
    parse_auto_approve_threshold,
    total_claimed_from_report,
)
from app.services.notification_service import create_notification

STAGE_STATUS_NOT_STARTED = "NOT_STARTED"
EXCEPTION_APPROVAL_CHAINS: dict[str, list[str]] = {
    "AIR_TRAVEL_UNLOCK": ["REPORTING_MANAGER", "HRBP_HR", "IT_ADMIN"],
    "TRAIN_TATKAL": ["REPORTING_MANAGER", "HRBP_HR"],
    "FLIGHT_ADVANCE_BOOKING_OVERRIDE": ["REPORTING_MANAGER"],
    "FLIGHT_COST_DELTA": ["REPORTING_MANAGER", "HRBP_HR"],
    "ROOM_RENT_DEVIATION": ["REPORTING_MANAGER", "HRBP_HR", "CEO"],
    "HOTEL/ACCOMMODATION_DEVIATION": ["REPORTING_MANAGER", "HRBP_HR", "CEO"],
    "HOTEL_DEVIATION": ["REPORTING_MANAGER", "HRBP_HR", "CEO"],
    "ACCOMMODATION_DEVIATION": ["REPORTING_MANAGER", "HRBP_HR", "CEO"],
    "AIR_TRAVEL_L5_L6": ["REPORTING_MANAGER", "GROUP_HEAD_HR", "CEO"],
    "HIRED_TAXI_UNAUTHORIZED": ["REPORTING_MANAGER", "HRBP_HR", "CEO"],
    "MODE_DEVIATION": ["REPORTING_MANAGER", "HRBP_HR", "CEO"],
}


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
    return datetime.now(UTC).replace(tzinfo=None)


async def _user_ids_for_stage(claim: ClaimDraft, stage_def: dict, db: AsyncSession) -> list[int]:
    route_role = str(stage_def.get("route_role") or "")
    if route_role == Role.REPORTING_MANAGER.value:
        if not claim.employee_id:
            return []
        employee = await db.get(Employee, claim.employee_id)
        if employee is None or not employee.reporting_manager_id:
            return []
        result = await db.execute(
            select(User.id).where(
                User.employee_id == employee.reporting_manager_id,
                User.role == Role.REPORTING_MANAGER,
            )
        )
        return [int(user_id) for user_id in result.scalars().all()]
    if route_role == "FUNCTION_HEAD":
        if not claim.employee_id:
            return []
        fh = await _get_function_head(claim.employee_id, db)
        if not fh:
            return []
        result = await db.execute(
            select(User.id).where(User.employee_id == fh.employee_id)
        )
        return [int(user_id) for user_id in result.scalars().all()]
    if route_role in {
        Role.HRBP_HR.value,
        Role.PAYROLL.value,
        Role.FINANCE.value,
        Role.IT_ADMIN.value,
        Role.CEO.value,
        Role.GROUP_HEAD_HR.value,
    }:
        result = await db.execute(select(User.id).where(User.role == Role(route_role)))
        return [int(user_id) for user_id in result.scalars().all()]
    return []


async def _notify_stage_approver(claim: ClaimDraft, stage_def: dict, db: AsyncSession) -> None:
    stage_number = int(stage_def.get("number", 0))
    recipients = await _user_ids_for_stage(claim, stage_def, db)
    if not recipients:
        return
    claim_ref = claim.claim_reference or f"CLM-{claim.id}"
    for user_id in recipients:
        await create_notification(
            user_id=user_id,
            title=f"Approval required: {claim_ref}",
            body=f"Claim is awaiting action at stage {stage_number}.",
            link=f"/claims/{claim.id}/review",
            category=NotificationCategory.APPROVAL_REQUIRED.value,
            db=db,
        )


async def _notify_exception_approver(
    claim: ClaimDraft, req: ExceptionRequest, role: str, db: AsyncSession
) -> None:
    recipients = await _user_ids_for_stage(claim, {"route_role": role}, db)
    for user_id in recipients:
        await create_notification(
            user_id=user_id,
            title=f"Exception Approval Required: {claim.claim_reference}",
            body=f"Exception '{req.exception_type}' requires your review.",
            link=f"/claims/{claim.id}/exceptions",
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
    "submission": {"max_working_days_after_return": 5, "deadline_mode": "hard_block"},
    "auto_approve_below_amount": "2000.00",
}


def _validate_workflow_config(config: dict) -> None:
    if not isinstance(config, dict):
        raise HTTPException(status_code=422, detail="Workflow config must be an object")
    stages = config.get("stages")
    if not isinstance(stages, list):
        raise HTTPException(status_code=422, detail="Workflow config must include a stages list")
    if not 1 <= len(stages) <= 6:
        raise HTTPException(status_code=422, detail="Workflow stages must be between 1 and 6")

    allowed_roles = {
        Role.REPORTING_MANAGER.value,
        Role.HRBP_HR.value,
        Role.PAYROLL.value,
        Role.FINANCE.value,
        Role.CEO.value,
        Role.GROUP_HEAD_HR.value,
        Role.IT_ADMIN.value,
        "FUNCTION_HEAD",
    }
    finance_count = 0
    for idx, stage in enumerate(stages, start=1):
        if not isinstance(stage, dict):
            raise HTTPException(status_code=422, detail=f"Stage {idx} must be an object")
        if not isinstance(stage.get("label"), str) or not str(stage.get("label")).strip():
            raise HTTPException(status_code=422, detail=f"Stage {idx} label is required")
        if stage.get("route_role") not in allowed_roles:
            raise HTTPException(status_code=422, detail=f"Stage {idx} route_role '{stage.get('route_role')}' is unsupported")
        if not isinstance(stage.get("sla_hours"), int) or int(stage["sla_hours"]) <= 0:
            raise HTTPException(status_code=422, detail=f"Stage {idx} sla_hours must be a positive integer")
        if stage.get("route_role") == Role.FINANCE.value:
            finance_count += 1

    if finance_count < 1:
        raise HTTPException(
            status_code=422,
            detail="Workflow must include at least one finance stage",
        )

    submission = config.get("submission")
    if submission is None or not isinstance(submission, dict):
        raise HTTPException(status_code=422, detail="submission must be an object")

    raw_max = submission.get("max_working_days_after_return")
    if isinstance(raw_max, bool):
        raise HTTPException(
            status_code=422,
            detail="max_working_days_after_return must be an integer >= 1",
        )
    try:
        max_days_val = int(raw_max)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=422,
            detail="max_working_days_after_return must be an integer >= 1",
        )
    if max_days_val < 1:
        raise HTTPException(
            status_code=422,
            detail="max_working_days_after_return must be an integer >= 1",
        )

    deadline_mode = submission.get("deadline_mode", "hard_block")
    if deadline_mode not in ("hard_block", "soft_warning"):
        raise HTTPException(
            status_code=422,
            detail="deadline_mode must be one of: hard_block, soft_warning",
        )

    raw_auto = config.get("auto_approve_below_amount")
    if raw_auto is None:
        raise HTTPException(status_code=422, detail="auto_approve_below_amount is required")
    try:
        auto_amt = Decimal(str(raw_auto))
    except InvalidOperation:
        raise HTTPException(
            status_code=422,
            detail="auto_approve_below_amount must be a valid decimal amount",
        )
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
            for role in chain:
                if role not in allowed_roles:
                    raise HTTPException(status_code=422, detail=f"exception_chain '{key}' contains unsupported role '{role}'")


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


async def get_workflow_config(db: AsyncSession) -> dict:
    row = await db.get(WorkflowConfigRow, 1)
    if row is None or not row.config_json:
        return dict(DEFAULT_WORKFLOW_CONFIG)
    merged = dict(DEFAULT_WORKFLOW_CONFIG)
    merged.update(row.config_json)
    if "stages" in row.config_json:
        merged["stages"] = row.config_json["stages"]
    if "exception_chains" in row.config_json:
        merged["exception_chains"] = row.config_json["exception_chains"]
    return merged


async def save_workflow_config(config: dict, user_id: int | None, db: AsyncSession) -> dict:
    _validate_workflow_config(config)
    row = await db.get(WorkflowConfigRow, 1)
    if row is None:
        row = WorkflowConfigRow(id=1, config_json=config, updated_by_user_id=user_id)
        db.add(row)
    else:
        row.config_json = config
        row.updated_by_user_id = user_id
    await db.commit()
    await db.refresh(row)
    return row.config_json


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

    claim = await db.get(ClaimDraft, exc.claim_id)
    if claim is None:
        return False

    route_role = active_stage.required_role
    if route_role == Role.REPORTING_MANAGER.value:
        if not claim.employee_id:
            return True
        emp = await db.get(Employee, claim.employee_id)
        if emp is None:
            return True
        if emp.reporting_manager_id == user.employee_id:
            return True
            
        now = _now()
        delegators_q = select(Delegation.delegator_id).where(
            Delegation.delegatee_id == user.id,
            Delegation.is_active == True,
            Delegation.start_date <= now,
            Delegation.end_date >= now
        )
        delegator_ids = (await db.execute(delegators_q)).scalars().all()
        if delegator_ids:
            managers_q = select(Employee.employee_id).where(Employee.user_id.in_(delegator_ids))
            manager_emp_ids = (await db.execute(managers_q)).scalars().all()
            if emp.reporting_manager_id in manager_emp_ids:
                return True
        return False
    if route_role == Role.HRBP_HR.value:
        return user.role == Role.HRBP_HR
    if route_role == Role.PAYROLL.value:
        return user.role == Role.PAYROLL
    if route_role == Role.FINANCE.value:
        return user.role == Role.FINANCE
    if route_role == Role.CEO.value:
        return user.role == Role.CEO
    if route_role == Role.GROUP_HEAD_HR.value:
        return user.role == Role.GROUP_HEAD_HR
    if route_role == Role.IT_ADMIN.value:
        return user.role == Role.IT_ADMIN
    if route_role == "FUNCTION_HEAD":
        if not claim.employee_id:
            return False
        fh = await _get_function_head(claim.employee_id, db)
        return fh and fh.employee_id == user.employee_id
    return False


async def _can_user_act_on_claim_stage(
    user: User, claim: ClaimDraft, stage_def: dict, db: AsyncSession, *, stage_row: ClaimApprovalStage | None = None, active_delegator_ids: list[int] | None = None
) -> bool:
    if active_delegator_ids is None:
        active_delegator_ids = []
        
    route_role = stage_row.required_role if stage_row and stage_row.required_role else str(stage_def.get("route_role") or "")
    if route_role == Role.REPORTING_MANAGER.value:
        # User OR their delegators must have REPORTING_MANAGER role
        has_role = user.role == Role.REPORTING_MANAGER
        if not has_role and not active_delegator_ids:
            return False
            
        if not claim.employee_id:
            return True
        emp = await db.get(Employee, claim.employee_id)
        if emp is None:
            return True
            
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
    if route_role == Role.IT_ADMIN.value:
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
    return False


async def init_claim_approval_chain(claim: ClaimDraft, db: AsyncSession) -> None:
    cfg = await get_workflow_config(db)
    stage_defs = _normalize_stage_defs(cfg)
    now = _now()
    threshold = parse_auto_approve_threshold(cfg)
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
        for req in requests:
            # Check if stages already exist to prevent duplicate creation
            existing = (await db.execute(
                select(ExceptionApproval).where(ExceptionApproval.exception_request_id == req.id)
            )).scalars().all()
            if existing:
                continue

            chain = cfg.get("exception_chains", EXCEPTION_APPROVAL_CHAINS).get(req.exception_type, [])
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
            chain = cfg.get("exception_chains", EXCEPTION_APPROVAL_CHAINS).get(req.exception_type, [])
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
            if op == ">": return target > Decimal(str(val))
            if op == "<": return target < Decimal(str(val))
            if op == "==": return str(target).lower() == str(val).lower()
        except:
            return True
        return True

    filtered_defs = [s for s in stage_defs if _eval_cond(s.get("conditional"))]
    if not filtered_defs:
        filtered_defs = stage_defs[:1]

    min_n = min(int(s["number"]) for s in filtered_defs)
    claim.current_approval_stage = min_n

    active_stages = []
    for stage in filtered_defs:
        n = int(stage["number"])
        is_active = n == min_n
        row = ClaimApprovalStage(
            claim_id=claim.id,
            stage_number=n,
            stage_label=str(stage["label"]),
            required_role=stage["route_role"],
            status=ClaimApprovalStageStatus.PENDING.value if is_active else STAGE_STATUS_NOT_STARTED,
            sla_deadline_at=(
                now + timedelta(hours=int(stage.get("sla_hours", 48)))
                if is_active
                else None
            ),
        )
        db.add(row)
        if is_active:
            active_stages.append(row)
            
    await db.flush()

    for stage_row in active_stages:
        stage_def = next((s for s in stage_defs if int(s["number"]) == stage_row.stage_number), None)
        if stage_def:
            await _notify_stage_approver(claim, stage_def, db)


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
        
    # Check if user is the reporting manager of the claim's owner
    from app.models.employee import Employee
    owner_stmt = select(Employee.reporting_manager_id).join(User, User.employee_id == Employee.employee_id).where(User.id == claim.employee_user_id)
    owner_mgr_id = (await db.execute(owner_stmt)).scalar_one_or_none()
    if owner_mgr_id and user.employee_id and owner_mgr_id == user.employee_id:
        return claim
        
    viewer_ok = PERMISSION_MATRIX.get(user.role, set()) & {"view_reports", "process_payments"}
    if viewer_ok:
        return claim
    stages = await _load_stages(claim_id, db)
    pending = _active_pending_stage(claim, stages)
    if pending:
        cfg = await get_workflow_config(db)
        stage_defs = _normalize_stage_defs(cfg)
        stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
        if stage_def and await _can_user_act_on_claim_stage(user, claim, stage_def, db):
            return claim
    raise HTTPException(status_code=403, detail="Cannot view this claim")


async def get_approval_chain(claim: ClaimDraft, db: AsyncSession) -> dict:
    stages = await _load_stages(claim.id, db)
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
        "stages": [
            {
                "stage_number": s.stage_number,
                "label": s.stage_label,
                "status": s.status,
                "sla_deadline_at": s.sla_deadline_at.isoformat() if s.sla_deadline_at else None,
                "decided_at": s.decided_at.isoformat() if s.decided_at else None,
                "decided_by_user_id": s.decided_by_user_id,
                "comment": s.comment,
            }
            for s in stages
        ],
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
    }
    return order.get(event, 99)


async def get_claim_timeline(claim: ClaimDraft, db: AsyncSession) -> list[dict]:
    events: list[dict] = []
    actor_name, actor_role = await _user_identity(claim.employee_user_id, db)
    stages = await _load_stages(claim.id, db)
    sent_back_at = max(
        (stage.decided_at for stage in stages if stage.status == ClaimApprovalStageStatus.SENT_BACK.value and stage.decided_at),
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
    if claim.payment_recorded_at:
        finance_actor, finance_role = await _user_identity(claim.payment_recorded_by, db)
        events.append(
            {
                "event": "payment_processed",
                "actor": finance_actor,
                "role": finance_role,
                "timestamp": claim.payment_recorded_at,
                "comment": None,
                "stage": 4,
                "utr": claim.payment_utr,
            }
        )

    for stage in stages:
        if stage.decided_at is None:
            continue
        actor, role = await _user_identity(stage.decided_by_user_id, db)
        event_name = "stage_approved"
        if stage.status == ClaimApprovalStageStatus.SENT_BACK.value:
            event_name = "sent_back"
        elif stage.status == ClaimApprovalStageStatus.REJECTED.value:
            event_name = "rejected"
        events.append(
            {
                "event": event_name,
                "actor": actor,
                "role": role,
                "timestamp": stage.decided_at,
                "comment": stage.comment,
                "stage": stage.stage_number,
                "utr": None,
            }
        )

    logs = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.entity_type == "claim_draft", AuditLog.entity_id == str(claim.id))
            .order_by(AuditLog.timestamp.asc())
        )
    ).scalars().all()
    for log in logs:
        if log.action not in {"send_back", "record_payment", "reject_claim"}:
            continue
        actor, role = await _user_identity(log.actor_id, db)
        event = {
            "send_back": "sent_back",
            "record_payment": "payment_processed",
            "reject_claim": "rejected",
        }[log.action]
        events.append(
            {
                "event": event,
                "actor": actor,
                "role": role,
                "timestamp": log.timestamp,
                "comment": (log.new_value or {}).get("comment") or (log.new_value or {}).get("reject_reason"),
                "stage": (log.new_value or {}).get("current_approval_stage"),
                "utr": (log.new_value or {}).get("payment_utr"),
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


async def approve_claim_stage(claim_id: int, user_id: int, comment: str | None, db: AsyncSession) -> ClaimDraft:
    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status not in (ClaimStatus.IN_APPROVAL, ClaimStatus.READY_FOR_PAYMENT):
        raise HTTPException(status_code=409, detail="Claim is not awaiting approval")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    stages = await _load_stages(claim_id, db)
    pending = _active_pending_stage(claim, stages)
    if pending is None:
        raise HTTPException(status_code=409, detail="No pending approval stage")

    cfg = await get_workflow_config(db)
    stage_defs = _normalize_stage_defs(cfg)
    stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
    if stage_def is None:
        raise HTTPException(status_code=500, detail="Approval chain is misconfigured")
    if str(stage_def["route_role"]) == Role.FINANCE.value:
        raise HTTPException(
            status_code=400,
            detail="Finance stage is completed via payment initiation endpoint",
        )

    if not await _can_user_act_on_claim_stage(user, claim, stage_def, db, stage_row=pending):
        raise HTTPException(status_code=403, detail="Not allowed to approve this stage")
    now = _now()
    previous_status = claim.status.value
    previous_stage = claim.current_approval_stage

    pending.status = ClaimApprovalStageStatus.APPROVED.value
    pending.decided_at = now
    pending.decided_by_user_id = user_id
    if comment:
        pending.comment = (pending.comment or "") + ("\n" if pending.comment else "") + comment

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
            if is_finance:
                claim.status = ClaimStatus.READY_FOR_PAYMENT
            
            for ns in next_stages:
                ns.status = ClaimApprovalStageStatus.PENDING.value
                ns.sla_deadline_at = now + timedelta(hours=_stage_hours(stage_defs, next_stage_number))
                
                ns_def = next((sd for sd in next_stage_defs if sd["route_role"] == ns.required_role), None)
                if ns_def:
                    await _notify_stage_approver(claim, ns_def, db)

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
        },
        db=db,
    )
    await db.commit()
    await db.refresh(claim)
    return claim


async def send_back_claim(claim_id: int, user_id: int, comment: str, db: AsyncSession) -> ClaimDraft:
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

    cfg = await get_workflow_config(db)
    stage_defs = _normalize_stage_defs(cfg)
    stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
    if stage_def is None:
        raise HTTPException(status_code=500, detail="Approval chain is misconfigured")
    if str(stage_def["route_role"]) == Role.FINANCE.value:
        raise HTTPException(status_code=409, detail="No send-back allowed at finance stage")
    if not await _can_user_act_on_claim_stage(user, claim, stage_def, db):
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

    await log_event(
        entity_type="claim_draft",
        entity_id=str(claim.id),
        action="send_back",
        actor_id=user_id,
        old={"status": previous_status, "current_approval_stage": previous_stage},
        new={"status": claim.status.value, "current_approval_stage": claim.current_approval_stage, "comment": comment},
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


async def reject_claim(claim_id: int, user_id: int, reason: str, db: AsyncSession) -> ClaimDraft:
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

    cfg = await get_workflow_config(db)
    stage_defs = _normalize_stage_defs(cfg)
    stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
    if stage_def is None:
        raise HTTPException(status_code=500, detail="Approval chain is misconfigured")
    if not await _can_user_act_on_claim_stage(user, claim, stage_def, db):
        raise HTTPException(status_code=403, detail="Not allowed to reject at this stage")

    now = _now()
    previous_status = claim.status.value
    pending.status = ClaimApprovalStageStatus.REJECTED.value
    pending.decided_at = now
    pending.decided_by_user_id = user_id
    pending.comment = reason.strip()

    claim.status = ClaimStatus.REJECTED
    claim.reject_reason = reason.strip()

    await log_event(
        entity_type="claim_draft",
        entity_id=str(claim.id),
        action="reject_claim",
        actor_id=user_id,
        old={"status": previous_status, "reject_reason": None},
        new={"status": claim.status.value, "reject_reason": claim.reject_reason},
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

    cfg = await get_workflow_config(db)
    stage_defs = _normalize_stage_defs(cfg)
    stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
    if stage_def is None:
        raise HTTPException(status_code=500, detail="Approval chain is misconfigured")
    if str(stage_def["route_role"]) == Role.FINANCE.value:
        raise HTTPException(status_code=409, detail="Modify amount is not allowed at finance stage")
    if not await _can_user_act_on_claim_stage(user, claim, stage_def, db):
        raise HTTPException(status_code=403, detail="Not allowed to modify amount for this claim")

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
    claim_id: int, user_id: int, utr: str, amount: Decimal, db: AsyncSession
) -> ClaimDraft:
    if not utr or not utr.strip():
        raise HTTPException(status_code=422, detail="UTR reference is required")

    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status != ClaimStatus.READY_FOR_PAYMENT:
        raise HTTPException(status_code=409, detail="Claim is not ready for payment")

    user = await db.get(User, user_id)
    if user is None or user.role != Role.FINANCE:
        raise HTTPException(status_code=403, detail="Only finance can record payment")

    cfg = await get_workflow_config(db)
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
    if provided != expected:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Payment amount must match authoritative payable amount {expected}. "
                "Use approved amount when set, otherwise net payable after advances."
            ),
        )

    now = _now()
    previous_status = claim.status.value
    stage4.status = ClaimApprovalStageStatus.APPROVED.value
    stage4.decided_at = now
    stage4.decided_by_user_id = user_id
    stage4.comment = f"UTR {utr.strip()}"

    claim.status = ClaimStatus.PAID
    claim.payment_utr = utr.strip()
    claim.payment_amount = provided
    claim.payment_recorded_at = now
    claim.payment_recorded_by = user_id

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
        },
        db=db,
    )
    await _notify_employee_update(
        claim,
        title=f"Payment recorded: {claim.claim_reference or f'CLM-{claim.id}'}",
        body=f"UTR {claim.payment_utr} was recorded for INR {claim.payment_amount}.",
        category=NotificationCategory.PAYMENT,
        db=db,
    )
    await db.commit()
    await db.refresh(claim)
    return claim


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
        
    now = _now()
    active_delegators_q = select(Delegation.delegator_id).where(
        Delegation.delegatee_id == user_id,
        Delegation.is_active == True,
        Delegation.start_date <= now,
        Delegation.end_date >= now
    )
    active_delegator_ids = (await db.execute(active_delegators_q)).scalars().all()
    
    delegator_roles = []
    if active_delegator_ids:
        roles_q = select(User.role).where(User.id.in_(active_delegator_ids))
        delegator_roles = [r.value for r in (await db.execute(roles_q)).scalars().all()]
        
    user_roles = [user.role.value] + delegator_roles

    cfg = await get_workflow_config(db)
    stage_defs = _normalize_stage_defs(cfg)
    stage_by_number = {int(s["number"]): s for s in stage_defs}
    allowed_stage_numbers = [
        int(s["number"]) for s in stage_defs if str(s["route_role"]) in user_roles
    ]
    if not allowed_stage_numbers:
        return []

    q = select(ClaimDraft).where(
        ClaimDraft.current_approval_stage.in_(allowed_stage_numbers),
        ClaimDraft.status.in_([ClaimStatus.IN_APPROVAL, ClaimStatus.READY_FOR_PAYMENT]),
    )

    rows = (await db.execute(q)).scalars().unique().all()
    out: list[dict] = []
    for claim in rows:
        active_stage_number = int(claim.current_approval_stage or 0)
        stage_def = stage_by_number.get(active_stage_number)
        if stage_def is None:
            continue

        stages = await _load_stages(claim.id, db)
        pending = _active_pending_stage(claim, stages)
        if pending is None:
            continue

        if not await _can_user_act_on_claim_stage(user, claim, stage_def, db, stage_row=pending, active_delegator_ids=active_delegator_ids):
            continue
        sla_label, sla_bucket = _sla_remaining_hours(pending.sla_deadline_at if pending else None)
        if sla_bucket == "breached":
            link = f"/claims/{claim.id}/review"
            dedupe_cutoff = _now() - timedelta(hours=6)
            existing = await db.execute(
                select(AuditLog.id)
                .where(
                    AuditLog.entity_type == "notification",
                    AuditLog.entity_id == str(claim.id),
                    AuditLog.action == f"sla_breach_notified:{user_id}:{pending.stage_number}",
                    AuditLog.timestamp >= dedupe_cutoff,
                )
                .limit(1)
            )
            if existing.scalar_one_or_none() is None:
                await create_notification(
                    user_id=user_id,
                    title=f"SLA breach: {claim.claim_reference or f'CLM-{claim.id}'}",
                    body=f"Stage {pending.stage_number} approval is overdue.",
                    link=link,
                    category=NotificationCategory.SLA_BREACH.value,
                    db=db,
                )
                await log_event(
                    entity_type="notification",
                    entity_id=str(claim.id),
                    action=f"sla_breach_notified:{user_id}:{pending.stage_number}",
                    actor_id=None,
                    old=None,
                    new={"claim_id": claim.id, "stage_number": pending.stage_number, "user_id": user_id},
                    db=db,
                )

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
                "employee_label": f"{emp.full_name if emp else 'Unknown'} ({claim.employee_id or '—'})",
                "employee_name": emp.full_name if emp else "Unknown",
                "department": emp.department if emp else None,
                "trip_summary": trip,
                "amount": str(total),
                "advance_deducted": str(advance_deducted),
                "net_payable": str(net_payable),
                "submitted_at": claim.submitted_at.isoformat() if claim.submitted_at else None,
                "exceptions_summary": exc_labels or ["Compliant"],
                "sla_remaining_label": sla_label or ("SLA Breached" if sla_bucket == "breached" else "—"),
                "sla_bucket": sla_bucket,
                "sla_deadline_at": pending.sla_deadline_at.isoformat() if pending and pending.sla_deadline_at else None,
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
            select(User.id).where(
                User.employee_id == employee.reporting_manager_id,
                User.role == Role.REPORTING_MANAGER,
            )
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
    
    try:
        r_enum = Role(role)
        result = await db.execute(select(User.id).where(User.role == r_enum))
        return [int(user_id) for user_id in result.scalars().all()]
    except ValueError:
        return []


async def create_exception_request(
    claim_id: int, user_id: int, exception_type: str, description: str | None, db: AsyncSession
) -> ExceptionRequest:
    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.employee_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot raise exception for another user's claim")

    row = ExceptionRequest(
        claim_id=claim_id,
        requested_by_user_id=user_id,
        exception_type=exception_type,
        description=description,
        status=ExceptionRequestStatus.PENDING.value,
    )
    db.add(row)
    await db.flush()
    
    # Map exception type to expense category name keyword and update corresponding ClaimExpense
    category_keyword = None
    if exception_type == "ROOM_RENT_DEVIATION":
        category_keyword = "hotel"
    elif exception_type == "AIR_TRAVEL_L5_L6":
        category_keyword = "air"
    elif exception_type == "HIRED_TAXI_UNAUTHORIZED":
        category_keyword = "taxi"
    elif exception_type == "TRAIN_TATKAL":
        category_keyword = "train"

    if category_keyword:
        from app.models.reimbursement import ClaimExpense
        stmt = select(ClaimExpense).where(
            ClaimExpense.claim_id == claim_id,
            func.lower(ClaimExpense.category_name).contains(category_keyword)
        )
        expense_rows = (await db.execute(stmt)).scalars().all()
        for exp in expense_rows:
            exp.exception_requested = True

    required_roles = EXCEPTION_APPROVAL_CHAINS.get(exception_type, ["HRBP_HR"])
    for i, role in enumerate(required_roles):
        status_val = ExceptionRequestStatus.PENDING.value if i == 0 else "AWAITING"
        db.add(
            ExceptionApproval(
                exception_request_id=row.id,
                required_role=role,
                status=status_val,
            )
        )
    await db.commit()
    await db.refresh(row)

    # Notify only the first stage approver(s)
    claim_ref = claim.claim_reference or f"CLM-{claim.id}"
    if required_roles:
        first_role = required_roles[0]
        target_uids = await _user_ids_for_exception_role(claim, first_role, db)
        for target_uid in target_uids:
            await create_notification(
                user_id=target_uid,
                title=f"Exception Approval Required: {claim_ref}",
                body=f"Exception Type: {exception_type}. Justification: {description}",
                link="/hr/exceptions",
                category=NotificationCategory.EXCEPTION.value,
                db=db,
            )
    await db.commit()

    return row


async def get_exception_request(exc_id: int, db: AsyncSession) -> ExceptionRequest:
    row = await db.get(ExceptionRequest, exc_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Exception request not found")
    return row


async def decide_exception_request(
    exc_id: int, approver_id: int, approve: bool, comment: str | None, db: AsyncSession
) -> ExceptionRequest:
    row = await get_exception_request(exc_id, db)
    if row.status not in (ExceptionRequestStatus.PENDING.value, ExceptionRequestStatus.APPROVED.value):
        raise HTTPException(status_code=409, detail="Exception request is no longer pending")

    approver = await db.get(User, approver_id)
    if approver is None:
        raise HTTPException(status_code=404, detail="User not found")

    claim = await db.get(ClaimDraft, row.claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")

    approvals = (
        await db.execute(
            select(ExceptionApproval).where(ExceptionApproval.exception_request_id == row.id)
        )
    ).scalars().all()

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

    # Check if approver matches active_stage
    is_match = False
    if approver.role.value == active_stage.required_role:
        is_match = True
    elif active_stage.required_role == "REPORTING_MANAGER" and claim.employee_id:
        employee = await db.get(Employee, claim.employee_id)
        if employee and employee.reporting_manager_id == approver.employee_id:
            is_match = True
    elif active_stage.required_role == "FUNCTION_HEAD" and claim.employee_id:
        fh = await _get_function_head(claim.employee_id, db)
        if fh and fh.employee_id == approver.employee_id:
            is_match = True

    if not is_match:
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
    else:
        # Check if there is a next stage in "AWAITING" state
        next_stage = None
        current_idx = sorted_approvals.index(stage)
        if current_idx + 1 < len(sorted_approvals):
            next_stage = sorted_approvals[current_idx + 1]

        if next_stage and next_stage.status == "AWAITING":
            next_stage.status = ExceptionRequestStatus.PENDING.value
            row.status = ExceptionRequestStatus.PENDING.value
            # Notify the next stage approver
            await _notify_exception_approver(claim, row, next_stage.required_role, db)
        else:
            row.status = ExceptionRequestStatus.APPROVED.value
            row.decided_at = now
            row.decided_by_user_id = approver_id
            row.decision_comment = "Exception approved by all required approver roles."

            # Check if all exceptions on this claim are now approved
            active_exceptions_stmt = select(ExceptionRequest).where(
                ExceptionRequest.claim_id == claim.id,
                ExceptionRequest.status != ExceptionRequestStatus.APPROVED.value
            )
            other_active = (await db.execute(active_exceptions_stmt)).scalars().first()
            if not other_active:
                claim.status = ClaimStatus.IN_APPROVAL
                await init_claim_approval_chain(claim, db)

    await db.commit()
    await db.refresh(row)

    # Notify employee of the decision update
    claim = await db.get(ClaimDraft, row.claim_id)
    claim_ref = claim.claim_reference or f"CLM-{claim.id}" if claim else f"Claim #{row.claim_id}"
    link = f"/claims/{row.claim_id}" if claim else "/claims/my"
    
    if row.status == ExceptionRequestStatus.REJECTED.value:
        title = f"Exception Request Rejected: {claim_ref}"
        body = f"Your exception request for {row.exception_type} was rejected by {approver.role.value}."
        if comment:
            body += f" Comment: {comment}"
    elif row.status == ExceptionRequestStatus.APPROVED.value:
        title = f"Exception Request Approved: {claim_ref}"
        body = f"Your exception request for {row.exception_type} has been fully approved!"
    else:
        title = f"Exception Stage Approved: {claim_ref}"
        body = f"Your exception request was approved by {approver.role.value} and is pending remaining roles."
        if comment:
            body += f" Comment: {comment}"

    await create_notification(
        user_id=row.requested_by_user_id,
        title=title,
        body=body,
        link=link,
        category=NotificationCategory.EXCEPTION.value,
        db=db,
    )
    await db.commit()

    return row


async def create_advance_request(user_id: int, amount: Decimal, purpose: str | None, db: AsyncSession) -> AdvanceRequest:
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Advance amount must be positive")

    adv = AdvanceRequest(employee_user_id=user_id, amount=amount, purpose=purpose, status=AdvanceRequestStatus.IN_APPROVAL.value)
    db.add(adv)
    await db.flush()

    cfg = await get_workflow_config(db)
    stage_defs = _normalize_stage_defs(cfg)
    now = _now()
    first_stage = int(stage_defs[0]["number"])
    for stage in stage_defs:
        i = int(stage["number"])
        is_active = i == first_stage
        sla = now + timedelta(hours=_stage_hours(stage_defs, i)) if is_active else None
        db.add(
            AdvanceApprovalStage(
                advance_id=adv.id,
                stage_number=i,
                stage_label=str(stage["label"]),
                required_role=stage["route_role"],
                status=ClaimApprovalStageStatus.PENDING.value if is_active else STAGE_STATUS_NOT_STARTED,
                sla_deadline_at=sla,
            )
        )
    await db.commit()
    await db.refresh(adv)
    return adv


async def list_advance_requests(user_id: int, db: AsyncSession) -> list[AdvanceRequest]:
    result = await db.execute(
        select(AdvanceRequest)
        .where(AdvanceRequest.employee_user_id == user_id)
        .order_by(AdvanceRequest.created_at.desc())
    )
    return list(result.scalars().all())


async def list_outstanding_advances(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(AdvanceRequest, User, Employee)
        .outerjoin(User, User.id == AdvanceRequest.employee_user_id)
        .outerjoin(Employee, Employee.employee_id == User.employee_id)
        .order_by(AdvanceRequest.created_at.desc())
    )
    rows = list(result.all())
    now = _now()
    out = []
    for adv, user, employee in rows:
        if adv.status not in (AdvanceRequestStatus.DISBURSED.value, AdvanceRequestStatus.APPROVED.value):
            continue
        age_days = (now - adv.created_at).days if adv.created_at else 0
        out.append(
            {
                "id": adv.id,
                "employee_user_id": adv.employee_user_id,
                "employee_id": user.employee_id if user else None,
                "employee_name": user.full_name if user else None,
                "department": employee.department if employee else None,
                "amount": str(adv.amount),
                "status": adv.status,
                "created_at": adv.created_at.isoformat() if adv.created_at else None,
                "age_days": age_days,
                "days_outstanding": age_days,
                "aging_flag": age_days >= 21,
                "reminder_due": age_days >= 15,
            }
        )
    return out


async def _user_may_approve_advance_stage(user: User, adv: AdvanceRequest, stage_number: int, db: AsyncSession) -> bool:
    cfg = await get_workflow_config(db)
    stage_defs = _normalize_stage_defs(cfg)
    stage_def = next((s for s in stage_defs if int(s["number"]) == stage_number), None)
    if stage_def is None:
        return False
    route_role = str(stage_def["route_role"])

    if route_role == Role.REPORTING_MANAGER.value:
        if user.role != Role.REPORTING_MANAGER:
            return False
        sub_user = await db.get(User, adv.employee_user_id)
        if not sub_user or not sub_user.employee_id or not user.employee_id:
            return True
        sub_emp = await db.get(Employee, sub_user.employee_id)
        if not sub_emp or not sub_emp.reporting_manager_id:
            return True
        return sub_emp.reporting_manager_id == user.employee_id
    if route_role == Role.HRBP_HR.value:
        return user.role == Role.HRBP_HR
    if route_role == Role.PAYROLL.value:
        return user.role == Role.PAYROLL
    if route_role == Role.FINANCE.value:
        return user.role == Role.FINANCE
    return False


async def approve_advance_stage(advance_id: int, user_id: int, db: AsyncSession) -> AdvanceRequest:
    adv = await db.get(AdvanceRequest, advance_id)
    if adv is None:
        raise HTTPException(status_code=404, detail="Advance request not found")
    if adv.status != AdvanceRequestStatus.IN_APPROVAL.value:
        raise HTTPException(status_code=409, detail="Advance is not pending approval")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    result = await db.execute(
        select(AdvanceApprovalStage)
        .where(AdvanceApprovalStage.advance_id == advance_id)
        .order_by(AdvanceApprovalStage.stage_number)
    )
    stages = list(result.scalars().all())
    pending = next((s for s in stages if s.status == ClaimApprovalStageStatus.PENDING.value), None)
    if pending is None:
        raise HTTPException(status_code=409, detail="No pending advance stage")

    if not await _user_may_approve_advance_stage(user, adv, pending.stage_number, db):
        raise HTTPException(status_code=403, detail="Not allowed to approve this advance stage")

    cfg = await get_workflow_config(db)
    stage_defs = _normalize_stage_defs(cfg)
    now = _now()

    pending.status = ClaimApprovalStageStatus.APPROVED.value
    pending.decided_at = now
    pending.decided_by_user_id = user_id

    nxt = next((s for s in stages if s.stage_number == pending.stage_number + 1), None)
    if nxt:
        nxt.status = ClaimApprovalStageStatus.PENDING.value
        nxt.sla_deadline_at = now + timedelta(hours=_stage_hours(stage_defs, nxt.stage_number))
    else:
        adv.status = AdvanceRequestStatus.APPROVED.value

    await db.commit()
    await db.refresh(adv)
    return adv


async def process_auto_approvals(db: AsyncSession) -> None:
    """
    Check for pending claim stages that are below the auto-approve threshold,
    and auto-approve them if they have been pending for at least 5 minutes.
    """
    now = _now()
    cfg = await get_workflow_config(db)
    threshold = parse_auto_approve_threshold(cfg)
    stage_defs = _normalize_stage_defs(cfg)

    # Fetch all claims in IN_APPROVAL status
    result = await db.execute(
        select(ClaimDraft).where(ClaimDraft.status == ClaimStatus.IN_APPROVAL)
    )
    claims = result.scalars().all()

    for claim in claims:
        total = total_claimed_from_report(claim)
        if total <= Decimal("0") or total > threshold:
            continue

        stages = await _load_stages(claim.id, db)
        pending = _active_pending_stage(claim, stages)
        if not pending:
            continue

        # Finance stage is never auto-approved
        stage_def = next((s for s in stage_defs if int(s["number"]) == pending.stage_number), None)
        if not stage_def or str(stage_def.get("route_role")) == Role.FINANCE.value:
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

            pending.status = ClaimApprovalStageStatus.APPROVED.value
            pending.decided_at = now
            pending.decided_by_user_id = None
            pending.comment = None  # User requested: "dont make it say that it is auto approved"

            # Transition to the next stage
            next_stage_number = min((s.stage_number for s in stages if s.stage_number > pending.stage_number), default=None)
            if next_stage_number is not None:
                next_stages = [s for s in stages if s.stage_number == next_stage_number]
                next_stage_defs = [s for s in stage_defs if int(s["number"]) == next_stage_number]

                is_finance = any(str(sd.get("route_role")) == Role.FINANCE.value for sd in next_stage_defs)

                claim.current_approval_stage = next_stage_number
                if is_finance:
                    claim.status = ClaimStatus.READY_FOR_PAYMENT

                for ns in next_stages:
                    ns.status = ClaimApprovalStageStatus.PENDING.value
                    ns.sla_deadline_at = now + timedelta(hours=_stage_hours(stage_defs, next_stage_number))

                    ns_def = next((sd for sd in next_stage_defs if sd["route_role"] == ns.required_role), None)
                    if ns_def:
                        await _notify_stage_approver(claim, ns_def, db)

            await log_event(
                entity_type="claim_draft",
                entity_id=str(claim.id),
                action="approve_stage",
                actor_id=None,
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

