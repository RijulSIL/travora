import csv
import io
import json

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import MANAGER_ROLES, get_current_claims, is_manager, require_mfa, require_permission
from app.core.timezone import today_ist
from app.models.auth import Role, User
from app.models.claim_workflow import NotificationCategory
from app.models.employee import Employee
from app.models.expense_category import CompanyProfile
from app.models.policy import ImpactLevel
from app.schemas.common import (
    AdminBulkImportSummaryOut,
    AdminTeamAddIn,
    AdminTeamMoveIn,
    AdminTeamSummaryOut,
    AdminUserCreateIn,
    AdminUserOut,
    AdminUserUpdateIn,
    DelegationConfigIn,
    DelegationConfigOut,
    UserOut,
    UserRoleUpdateIn,
)
from app.services.audit_service import log_event
from app.services.auth_service import hash_password
from app.services.delegation_service import is_delegation_enabled, set_delegation_enabled
from app.services.department_service import clean_department_name, department_key, get_departments, match_department
from app.services.notification_service import create_notification
from app.services.policy_engine import get_active_policy_version
from app.services.welcome_service import TEMPORARY_PASSWORD, send_welcome_email, send_welcome_emails_later

router = APIRouter(prefix="/admin", tags=["admin-users"])


@router.get(
    "/delegation-config",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=DelegationConfigOut,
)
async def get_delegation_config(db: AsyncSession = Depends(get_db)) -> dict:
    return {"enabled": await is_delegation_enabled(db)}


@router.put(
    "/delegation-config",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=DelegationConfigOut,
)
async def update_delegation_config(
    payload: DelegationConfigIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    enabled = await set_delegation_enabled(payload.enabled, int(claims["sub"]), db)
    return {"enabled": enabled}


@router.get(
    "/users",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=list[AdminUserOut],
)
async def list_users(
    role: Role | None = Query(default=None),
    department: str | None = Query(default=None),
    impact_level_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[AdminUserOut]:
    statement = select(User, Employee).outerjoin(Employee, Employee.employee_id == User.employee_id)


    if role:
        statement = statement.where(User.role == role)
    if department:
        statement = statement.where(Employee.department == department)
    if impact_level_id:
        statement = statement.where(Employee.impact_level_id == impact_level_id)
    statement = statement.order_by(User.id.desc()).offset(offset).limit(limit)

    result = await db.execute(statement)
    all_rows = result.all()
    rows: list[AdminUserOut] = []
    for user, employee in all_rows:



        rows.append(
            AdminUserOut(
                user_id=user.id,
                email=user.email,
                full_name=user.full_name or (employee.full_name if employee else None),
                role=user.role,
                mfa_verified=user.mfa_verified,
                is_active=user.is_active,
                employee_id=user.employee_id,
                department=employee.department if employee else None,
                impact_level_id=employee.impact_level_id if employee else None,
                office_location=employee.office_location if employee else None,
                reporting_manager_id=employee.reporting_manager_id if employee else None,
                is_manager=is_manager(user),
                must_change_password=user.must_change_password,
                welcome_email_sent_at=user.welcome_email_sent_at,
            )
        )
    return rows


@router.get(
    "/reporting-managers",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=list[dict],
)
async def list_reporting_managers(db: AsyncSession = Depends(get_db)):
    # Everyone with the Manager setting (always on for the CEO), whatever their role.
    result = await db.execute(
        select(User)
        .where(User.employee_id.isnot(None), or_(User.is_manager.is_(True), User.role.in_(MANAGER_ROLES)))
        .order_by(User.full_name)
    )
    users = result.scalars().all()
    return [{"employee_id": u.employee_id, "full_name": u.full_name or u.email} for u in users if u.employee_id]


async def _listed_department(value: str | None, current: str | None, db: AsyncSession) -> str | None:
    """A department from the company's list (Company profile), matched ignoring capitals and
    spaces. Someone already in a department that has since been taken off the list keeps it."""
    if not value or not value.strip():
        return current
    listed = match_department(value, await get_departments(db))
    if listed:
        return listed
    if current and department_key(current) == department_key(value):
        return current
    raise HTTPException(
        status_code=422,
        detail=f"{clean_department_name(value)} isn't a department — add it on the Company profile page first",
    )


def _yes(value: str) -> bool:
    return value.strip().lower() in {"yes", "y", "true", "1"}


def _role_and_manager(role: Role, manager: bool) -> tuple[Role, bool]:
    """Reporting Manager is no longer a role: it's read as Employee + Manager. The CEO is always a
    manager."""
    if role == Role.REPORTING_MANAGER:
        return Role.EMPLOYEE, True
    if role == Role.CEO:
        return role, True
    return role, manager


async def _assert_can_report_to(manager_employee_id: str | None, own_employee_id: str | None, db: AsyncSession) -> None:
    """A reporting manager must be an active person with the Manager setting, and not themselves."""
    if not manager_employee_id:
        return
    if manager_employee_id == own_employee_id:
        raise HTTPException(status_code=422, detail="Someone can't be their own manager")
    manager = (await db.execute(select(User).where(User.employee_id == manager_employee_id))).scalars().first()
    if manager is None:
        raise HTTPException(status_code=422, detail=f"Manager {manager_employee_id} not found")
    if not manager.is_active:
        raise HTTPException(status_code=422, detail=f"{manager.full_name or manager.email} is deactivated")
    if not is_manager(manager):
        raise HTTPException(
            status_code=422,
            detail=f"{manager.full_name or manager.email} isn't a manager — turn on Manager for them first",
        )


async def _team_of(user: User, db: AsyncSession) -> list[Employee]:
    """Active people who report to this user."""
    if not user.employee_id:
        return []
    return list(
        (
            await db.execute(
                select(Employee).where(
                    Employee.reporting_manager_id == user.employee_id, Employee.is_active.is_(True)
                )
            )
        )
        .scalars()
        .all()
    )


def _team_still_reports(user: User, team: list[Employee]) -> HTTPException:
    count = len(team)
    return HTTPException(
        status_code=409,
        detail=(
            f"{count} {'person reports' if count == 1 else 'people report'} to {user.full_name or user.email}. "
            "Move them to another manager first."
        ),
    )


async def _waiting_on_manager_step(team_employee_ids: list[str], db: AsyncSession) -> dict[str, int]:
    """How many of these people's claims, travel requests and exceptions are waiting at the
    manager step right now (they follow whoever the person reports to)."""
    from app.models.claim_workflow import ClaimApprovalStage, ExceptionApproval, ExceptionRequest
    from app.models.reimbursement import ClaimDraft
    from app.models.travel_request import TravelRequest, TravelRequestApprovalStage

    manager_step = Role.REPORTING_MANAGER.value
    if not team_employee_ids:
        return {"claims": 0, "travel_requests": 0, "exceptions": 0}
    team_user_ids = list(
        (await db.execute(select(User.id).where(User.employee_id.in_(team_employee_ids)))).scalars().all()
    )
    claims = (
        await db.execute(
            select(func.count(ClaimDraft.id))
            .join(
                ClaimApprovalStage,
                (ClaimApprovalStage.claim_id == ClaimDraft.id)
                & (ClaimApprovalStage.stage_number == ClaimDraft.current_approval_stage),
            )
            .where(
                ClaimDraft.employee_id.in_(team_employee_ids),
                ClaimDraft.is_exception_shell.is_(False),
                ClaimApprovalStage.status == "PENDING",
                ClaimApprovalStage.required_role == manager_step,
            )
        )
    ).scalar_one()
    travel = 0
    exceptions = 0
    if team_user_ids:
        travel = (
            await db.execute(
                select(func.count(TravelRequest.id))
                .join(
                    TravelRequestApprovalStage,
                    (TravelRequestApprovalStage.travel_request_id == TravelRequest.id)
                    & (TravelRequestApprovalStage.stage_number == TravelRequest.current_approval_stage),
                )
                .where(
                    TravelRequest.employee_user_id.in_(team_user_ids),
                    TravelRequest.status == "PENDING",
                    TravelRequestApprovalStage.status == "PENDING",
                    TravelRequestApprovalStage.required_role == manager_step,
                )
            )
        ).scalar_one()
        exceptions = (
            await db.execute(
                select(func.count(func.distinct(ExceptionRequest.id)))
                .join(ExceptionApproval, ExceptionApproval.exception_request_id == ExceptionRequest.id)
                .where(
                    ExceptionRequest.requested_by_user_id.in_(team_user_ids),
                    ExceptionRequest.status == "PENDING",
                    ExceptionApproval.status == "PENDING",
                    ExceptionApproval.required_role == manager_step,
                )
            )
        ).scalar_one()
    return {"claims": int(claims or 0), "travel_requests": int(travel or 0), "exceptions": int(exceptions or 0)}


@router.get(
    "/users/{user_id}/team",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=AdminTeamSummaryOut,
)
async def team_summary(user_id: int, db: AsyncSession = Depends(get_db)) -> AdminTeamSummaryOut:
    """Who reports to this person, and what's waiting on them as those people's manager."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    team = await _team_of(user, db)
    waiting = await _waiting_on_manager_step([e.employee_id for e in team], db)
    return AdminTeamSummaryOut(
        reports=[{"employee_id": e.employee_id, "full_name": e.full_name} for e in team],
        waiting_claims=waiting["claims"],
        waiting_travel_requests=waiting["travel_requests"],
        waiting_exceptions=waiting["exceptions"],
    )


@router.post(
    "/users/{user_id}/team/add",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=AdminTeamSummaryOut,
)
async def add_to_team(
    user_id: int,
    payload: AdminTeamAddIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> AdminTeamSummaryOut:
    """Turns this person's Manager setting on and puts these people under them — the CSV
    import's one-click fix when the manager named in the file wasn't a manager yet."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    name = user.full_name or user.email
    if not user.is_active:
        raise HTTPException(status_code=422, detail=f"{name} is deactivated")
    if not user.employee_id:
        raise HTTPException(status_code=422, detail=f"{name} has no employee ID, so nobody can report to them")
    own = await db.get(Employee, user.employee_id)
    ids = list(dict.fromkeys(i.strip() for i in payload.employee_ids if i and i.strip()))
    people: list[Employee] = []
    for employee_id in ids:
        if employee_id == user.employee_id:
            raise HTTPException(status_code=422, detail="Someone can't be their own manager")
        if own is not None and own.reporting_manager_id == employee_id:
            raise HTTPException(
                status_code=422, detail=f"{name} reports to {employee_id}, so {employee_id} can't report to them"
            )
        employee = await db.get(Employee, employee_id)
        if employee is None:
            raise HTTPException(status_code=422, detail=f"Employee {employee_id} not found")
        people.append(employee)

    was_manager = user.is_manager
    user.is_manager = True
    for employee in people:
        employee.reporting_manager_id = user.employee_id
    await log_event(
        entity_type="user",
        entity_id=str(user.id),
        action="made_manager_and_linked",
        actor_id=int(claims["sub"]),
        old={"is_manager": was_manager},
        new={"is_manager": True, "reports_added": [e.employee_id for e in people]},
        db=db,
    )
    await db.commit()
    return AdminTeamSummaryOut(reports=[{"employee_id": e.employee_id, "full_name": e.full_name} for e in people])


@router.post(
    "/users/{user_id}/team/move",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=AdminTeamSummaryOut,
)
async def move_team(
    user_id: int,
    payload: AdminTeamMoveIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> AdminTeamSummaryOut:
    """Moves everyone who reports to this person to another manager — needed before turning
    their Manager setting off or deactivating them. Approvals waiting at the manager step follow
    automatically (they always go to whoever the person reports to now); the new manager is told."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    team = await _team_of(user, db)
    if not team:
        return AdminTeamSummaryOut()
    new_id = payload.new_manager_employee_id.strip()
    if new_id == user.employee_id:
        raise HTTPException(status_code=422, detail="Pick someone else as their new manager")
    if new_id in {e.employee_id for e in team}:
        raise HTTPException(
            status_code=422,
            detail="Pick a manager outside this team — someone in it can't be their own manager",
        )
    await _assert_can_report_to(new_id, None, db)
    new_manager = (await db.execute(select(User).where(User.employee_id == new_id))).scalars().first()

    waiting = await _waiting_on_manager_step([e.employee_id for e in team], db)
    for employee in team:
        employee.reporting_manager_id = new_id
    await log_event(
        entity_type="user",
        entity_id=str(user.id),
        action="team_moved",
        actor_id=int(claims["sub"]),
        old={"manager": user.employee_id, "reports": [e.employee_id for e in team]},
        new={"manager": new_id},
        db=db,
    )

    names = ", ".join(e.full_name for e in team[:4]) + (f" and {len(team) - 4} more" if len(team) > 4 else "")
    parts = [
        f"{n} {label}{'' if n == 1 else 's'}"
        for n, label in (
            (waiting["claims"], "claim"),
            (waiting["travel_requests"], "travel request"),
            (waiting["exceptions"], "exception request"),
        )
        if n
    ]
    body = f"{names} now report{'s' if len(team) == 1 else ''} to you (moved from {user.full_name or user.email})."
    if parts:
        body += f" Waiting for your approval: {', '.join(parts)}."
    await create_notification(
        user_id=new_manager.id,
        title=f"{len(team)} {'person' if len(team) == 1 else 'people'} now report to you",
        body=body,
        link="/claims/pending",
        category=NotificationCategory.APPROVAL_REQUIRED.value,
        db=db,
    )
    await db.commit()
    return AdminTeamSummaryOut(
        reports=[{"employee_id": e.employee_id, "full_name": e.full_name} for e in team],
        waiting_claims=waiting["claims"],
        waiting_travel_requests=waiting["travel_requests"],
        waiting_exceptions=waiting["exceptions"],
    )


@router.post(
    "/users/{user_id}/welcome-email",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=AdminUserOut,
)
async def resend_welcome_email(
    user_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> AdminUserOut:
    """Sends the welcome email again — only while they're still on the temporary password (after
    that they use Forgot password)."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=409, detail="This account is deactivated")
    if not user.must_change_password:
        raise HTTPException(
            status_code=409,
            detail="They've already set their own password — they can use Forgot password on the sign-in page",
        )
    if not await send_welcome_email(user, db):
        raise HTTPException(status_code=502, detail="The welcome email couldn't be sent. Try again in a moment.")
    await log_event(
        entity_type="user",
        entity_id=str(user.id),
        action="welcome_email_resent",
        actor_id=int(claims["sub"]),
        old=None,
        new={"email": user.email},
        db=db,
    )
    await db.commit()
    employee = await db.get(Employee, user.employee_id) if user.employee_id else None
    return AdminUserOut(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name or (employee.full_name if employee else None),
        role=user.role,
        mfa_verified=user.mfa_verified,
        is_active=user.is_active,
        employee_id=user.employee_id,
        department=employee.department if employee else None,
        impact_level_id=employee.impact_level_id if employee else None,
        office_location=employee.office_location if employee else None,
        reporting_manager_id=employee.reporting_manager_id if employee else None,
        is_manager=is_manager(user),
        must_change_password=user.must_change_password,
        welcome_email_sent_at=user.welcome_email_sent_at,
    )


@router.post(
    "/users/create",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
)
async def admin_create_user(
    payload: AdminUserCreateIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> User:
    normalized_email = payload.email.strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=422, detail="Email is required")
    # Everyone starts with the temporary password unless one is given, and sets their own at their
    # first sign-in either way.
    password = payload.password or TEMPORARY_PASSWORD
    if len(password) < 8:
        raise HTTPException(
            status_code=422, detail="Password must be at least 8 characters long"
        )

    existing = await db.execute(select(User).where(User.email == normalized_email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    employee_id = payload.employee_id.strip() if payload.employee_id else None
    role, manager = _role_and_manager(payload.role, payload.is_manager)
    payload.reporting_manager_id = (payload.reporting_manager_id or "").strip() or None
    await _assert_can_report_to(payload.reporting_manager_id, employee_id, db)
    payload.department = await _listed_department(payload.department, None, db)
    if employee_id:
        existing_employee_user = await db.execute(
            select(User).where(User.employee_id == employee_id)
        )
        if existing_employee_user.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=409, detail="A user with this employee ID already exists"
            )

        employee = await db.get(Employee, employee_id)
        if employee is None:
            employee = Employee(
                employee_id=employee_id,
                full_name=payload.full_name or normalized_email,
                is_active=True,
                impact_level_id=payload.impact_level_id,
                reporting_manager_id=payload.reporting_manager_id,
                department=payload.department,
            )
            db.add(employee)
        else:
            if payload.full_name:
                employee.full_name = payload.full_name
            if payload.impact_level_id:
                employee.impact_level_id = payload.impact_level_id
            if payload.reporting_manager_id:
                employee.reporting_manager_id = payload.reporting_manager_id
            if payload.department:
                employee.department = payload.department
            employee.is_active = True
        
        await db.flush()

    user = User(
        email=normalized_email,
        full_name=payload.full_name,
        hashed_password=hash_password(password),
        role=role,
        is_manager=manager,
        must_change_password=True,
        mfa_verified=payload.mfa_verified,
        is_active=True,
        employee_id=employee_id,
    )
    db.add(user)
    await db.flush()

    await log_event(
        entity_type="user",
        entity_id=str(user.id),
        action="user_created_by_admin",
        actor_id=int(claims["sub"]),
        old=None,
        new={
            "email": user.email,
            "role": user.role.value,
            "is_manager": user.is_manager,
            "employee_id": user.employee_id,
        },
        db=db,
    )
    await db.commit()
    # Sent after the person is saved: a failed email never undoes adding them (Resend from their profile).
    if payload.send_welcome_email and await send_welcome_email(user, db):
        await db.commit()
    await db.refresh(user)
    return user

@router.put(
    "/users/{user_id}",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=UserOut,
)
async def admin_update_user(
    user_id: int,
    payload: AdminUserUpdateIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    was_manager = is_manager(user)
    role, manager = _role_and_manager(
        payload.role if payload.role is not None else user.role,
        payload.is_manager if payload.is_manager is not None else user.is_manager,
    )
    # Turning Manager off: their people have to be moved to another manager first.
    if was_manager and not manager:
        team = await _team_of(user, db)
        if team:
            raise _team_still_reports(user, team)
    if payload.reporting_manager_id is not None:
        await _assert_can_report_to(payload.reporting_manager_id.strip() or None, user.employee_id, db)

    if payload.full_name is not None:
        user.full_name = payload.full_name
    user.role = role
    user.is_manager = manager

    if user.employee_id:
        employee = await db.get(Employee, user.employee_id)
        if employee:
            if payload.full_name is not None:
                employee.full_name = payload.full_name
            if payload.impact_level_id is not None:
                employee.impact_level_id = payload.impact_level_id
            if payload.department is not None:
                employee.department = await _listed_department(payload.department, employee.department, db)
            if payload.office_location is not None:
                employee.office_location = payload.office_location
            if payload.reporting_manager_id is not None:
                # Blank clears it (no manager).
                employee.reporting_manager_id = payload.reporting_manager_id.strip() or None

    await db.commit()
    await db.refresh(user)
    return user


@router.put(
    "/users/{user_id}/role",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
)
async def change_user_role(
    user_id: int,
    payload: UserRoleUpdateIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    old_role = user.role
    old_manager = user.is_manager
    # Reporting Manager is read as Employee + Manager; the CEO is always a manager. Changing role
    # never turns the Manager setting off (that's its own step, after moving their people).
    role, manager = _role_and_manager(payload.role, user.is_manager)
    user.role = role
    user.is_manager = manager or old_manager
    await log_event(
        entity_type="user",
        entity_id=str(user_id),
        action="role_changed",
        actor_id=int(claims["sub"]),
        old={"role": old_role.value, "is_manager": old_manager},
        new={"role": role.value, "is_manager": user.is_manager},
        db=db,
    )
    await db.commit()
    return {"status": "updated"}


@router.delete(
    "/users/{user_id}",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
)
async def deactivate_user(user_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    # A manager's people have to be moved to another manager first.
    team = await _team_of(user, db)
    if team:
        raise _team_still_reports(user, team)

    user.is_active = False
    if user.employee_id:
        employee = await db.get(Employee, user.employee_id)
        if employee:
            employee.is_active = False
    await db.commit()
    return {"status": "inactive"}


@router.post(
    "/users/bulk-import",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=AdminBulkImportSummaryOut,
    status_code=status.HTTP_201_CREATED,
)
async def bulk_import_users(
    file: UploadFile = File(...),
    # What to do with each department in the file that isn't on the company's list, keyed by its
    # name ignoring capitals/spaces: {"mode": "add", "name": ...} adds it to the list,
    # {"mode": "use", "department": ...} puts those people in a listed one, {"mode": "blank"}.
    department_choices: str | None = Form(default=None),
    # Email each person added their sign-in details (welcome_service).
    send_welcome_emails: bool = Form(default=True),
    background_tasks: BackgroundTasks = None,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Only CSV files are supported")

    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="CSV must be UTF-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(text))
    required = {"employee_id", "full_name", "email", "role", "department", "office_location"}
    if not reader.fieldnames or not required.issubset({h.strip() for h in reader.fieldnames if h}):
        raise HTTPException(status_code=422, detail=f"CSV must include columns: {', '.join(sorted(required))}")

    errors: list[dict] = []
    created = 0
    actor_id = int(claims["sub"])

    existing_users = (await db.execute(select(User))).scalars().all()
    existing_emails = {u.email.lower() for u in existing_users}
    existing_emp_ids = {u.employee_id for u in existing_users if u.employee_id}
    # (row number, employee, employee_id, email, manager's employee_id) for the optional
    # reporting_manager_id column, linked once every row is in (see below).
    pending_managers: list[tuple[int, Employee | None, str | None, str, str]] = []
    # employee_id -> its row in this file, to point at the row when a manager there isn't one.
    row_of_employee: dict[str, int] = {}
    created_user_ids: list[int] = []
    # Everyone starts with the same temporary password; hashing it once keeps big files quick.
    temporary_hash = hash_password(TEMPORARY_PASSWORD)
    # People not linked only because the manager named for them isn't one (yet), by that manager.
    unlinked: dict[str, dict] = {}
    # A detail that doesn't work never blocks the person: they're added with it left blank, and
    # the reason comes back as a warning.
    warnings: list[dict] = []

    # impact_level_id takes either the level's ID number or its code (e.g. L5B). A code means that
    # level in the policy version in force today (same rule as the Add user form).
    all_levels = (await db.execute(select(ImpactLevel))).scalars().all()
    level_ids = {level.id for level in all_levels}
    try:
        policy_in_force = await get_active_policy_version(today_ist(), db)
    except HTTPException:
        policy_in_force = None
    level_id_by_code = {
        level.level_code.upper(): level.id
        for level in all_levels
        if policy_in_force and level.policy_version_id == policy_in_force.id and not level.is_deprecated
    }

    # Departments must be on the company's list; for the ones that aren't, the choices made on the
    # check screen apply (add to the list / use a listed one / leave blank).
    departments = await get_departments(db)
    try:
        choices = json.loads(department_choices) if isinstance(department_choices, str) and department_choices else {}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="department_choices must be JSON") from exc
    if not isinstance(choices, dict):
        raise HTTPException(status_code=422, detail="department_choices must be an object")
    added_departments: list[str] = []

    def resolve_department(raw: str | None) -> tuple[str | None, str | None]:
        """(department to store, warning) for a department cell."""
        if not raw:
            return None, None
        listed = match_department(raw, departments)
        if listed:
            return listed, None
        choice = choices.get(department_key(raw)) or {}
        mode = choice.get("mode") if isinstance(choice, dict) else None
        if mode == "add":
            name = clean_department_name(str(choice.get("name") or raw))
            existing = match_department(name, departments)
            if existing:
                return existing, None
            if name and len(name) <= 255:
                departments.append(name)
                added_departments.append(name)
                return name, None
        if mode == "use":
            listed = match_department(str(choice.get("department") or ""), departments)
            if listed:
                return listed, None
        if mode == "blank":
            return None, f'department "{clean_department_name(raw)}" left blank'
        return None, f'department "{clean_department_name(raw)}" isn\'t on the list'

    for idx, row in enumerate(reader, start=2):
        employee_id = (row.get("employee_id") or "").strip() or None
        full_name = (row.get("full_name") or "").strip() or None
        email = (row.get("email") or "").strip().lower()
        role_raw = (row.get("role") or "").strip().upper()
        department_raw = (row.get("department") or "").strip() or None
        office_location = (row.get("office_location") or "").strip() or None
        level_raw = (row.get("impact_level_id") or "").strip()
        if level_raw.isdigit():
            impact_level_id = int(level_raw) if int(level_raw) in level_ids else None
        else:
            impact_level_id = level_id_by_code.get(level_raw.upper()) if level_raw else None
        if not email:
            errors.append({"row": idx, "employee_id": employee_id, "email": None, "error": "email is required"})
            continue
        if role_raw not in {r.value for r in Role}:
            errors.append(
                {"row": idx, "employee_id": employee_id, "email": email, "error": f"invalid role: {role_raw}"}
            )
            continue
        if email in existing_emails:
            errors.append({"row": idx, "employee_id": employee_id, "email": email, "error": "email already exists"})
            continue
        if employee_id and employee_id in existing_emp_ids:
            errors.append(
                {"row": idx, "employee_id": employee_id, "email": email, "error": "employee_id already exists"}
            )
            continue

        department, department_warning = resolve_department(department_raw)
        employee = await db.get(Employee, employee_id) if employee_id else None
        if employee_id and employee is None:
            employee = Employee(
                employee_id=employee_id,
                full_name=full_name or email,
                department=department,
                office_location=office_location,
                is_active=True,
                impact_level_id=impact_level_id,
            )
            db.add(employee)
            # The new user row points at this employee, so it has to exist in the database first
            # (otherwise the users -> employees foreign key rejects the insert).
            await db.flush()
        elif employee:
            employee.full_name = full_name or employee.full_name
            employee.department = department or employee.department
            employee.office_location = office_location or employee.office_location
            if impact_level_id:
                employee.impact_level_id = impact_level_id
            employee.is_active = True

        # is_manager: yes / no (blank = no). REPORTING_MANAGER in the role column (older files) is
        # read as Employee + Manager, and the CEO is always a manager.
        role, manager = _role_and_manager(Role(role_raw), _yes(row.get("is_manager") or ""))
        user = User(
            email=email,
            full_name=full_name,
            role=role,
            is_manager=manager,
            mfa_verified=False,
            is_active=True,
            employee_id=employee_id,
            hashed_password=temporary_hash,
            # They start with the temporary password and set their own at their first sign-in.
            must_change_password=True,
        )
        db.add(user)
        await db.flush()
        created_user_ids.append(user.id)
        await log_event(
            entity_type="user",
            entity_id=str(user.id),
            action="user_bulk_imported",
            actor_id=actor_id,
            old=None,
            new={"email": email, "role": role.value, "is_manager": manager, "employee_id": employee_id},
            db=db,
        )
        created += 1
        existing_emails.add(email)
        if employee_id:
            existing_emp_ids.add(employee_id)
            row_of_employee[employee_id] = idx
        if level_raw and impact_level_id is None:
            warnings.append(
                {"row": idx, "employee_id": employee_id, "email": email, "error": f"impact level {level_raw} not found"}
            )
        if department_warning:
            warnings.append({"row": idx, "employee_id": employee_id, "email": email, "error": department_warning})
        manager_id = (row.get("reporting_manager_id") or "").strip()
        if manager_id:
            pending_managers.append((idx, employee, employee_id, email, manager_id))

    # Departments added from the check screen go on the company's list.
    if added_departments:
        profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
        if profile is None:
            profile = CompanyProfile(company_name="")
            db.add(profile)
        profile.departments = departments

    # Managers are linked after every row is in, so a manager added further down the same file
    # still counts. A manager ID that doesn't work leaves the person without a manager (warning).
    if pending_managers:
        await db.flush()
        # Same people the manager dropdown in User management offers: the Manager setting is on
        # (whether they were already in Travora or added by this file).
        people = {
            u.employee_id: u
            for u in (await db.execute(select(User).where(User.employee_id.isnot(None)))).scalars().all()
        }
        for idx, employee, employee_id, email, manager_id in pending_managers:
            problem = None
            manager_user = people.get(manager_id)
            if employee is None:
                problem = "no employee_id, so a manager can't be set"
            elif manager_id == employee_id:
                problem = "can't be their own manager"
            elif manager_user is None:
                known = await db.get(Employee, manager_id)
                problem = f"manager {manager_id} has no Travora login" if known else f"manager {manager_id} not found"
            elif not manager_user.is_active:
                problem = f"{manager_user.full_name or manager_id} is deactivated"
            elif not is_manager(manager_user):
                name = manager_user.full_name or manager_id
                if manager_id in row_of_employee:
                    problem = f"{name} isn't a manager — set is_manager to yes on row {row_of_employee[manager_id]}"
                else:
                    problem = f"{name} isn't a manager — turn on Manager for them in User management"
                # Offered as a one-click fix on the result screen.
                group = unlinked.setdefault(
                    manager_id,
                    {
                        "manager_user_id": manager_user.id,
                        "manager_employee_id": manager_id,
                        "manager_name": name,
                        "people": [],
                    },
                )
                group["people"].append({"employee_id": employee_id, "full_name": employee.full_name, "row": idx})
            if problem:
                warnings.append({"row": idx, "employee_id": employee_id, "email": email, "error": problem})
            else:
                employee.reporting_manager_id = manager_id

    await db.commit()
    # Welcome emails go out after the import has finished (a big file would take minutes to email
    # one by one). Anyone whose email fails shows "Welcome email not sent" on their profile.
    queue_emails = send_welcome_emails is True and isinstance(background_tasks, BackgroundTasks)
    if queue_emails and created_user_ids:
        background_tasks.add_task(send_welcome_emails_later, list(created_user_ids))
    return {
        "created": created,
        "failed": len(errors),
        "errors": errors,
        "warnings": warnings,
        "unlinked_managers": list(unlinked.values()),
        "added_departments": added_departments,
        "welcome_emails_queued": len(created_user_ids) if queue_emails else 0,
    }
