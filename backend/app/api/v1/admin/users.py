import csv
import io
import json
import re

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, func, insert, or_, select, update
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
    AdminReactivateIn,
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
from app.services.office_service import clean_office_name, match_office, office_key
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
        rows.append(_admin_user_out(user, employee))
    return rows


def _admin_user_out(user: User, employee: Employee | None) -> AdminUserOut:
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


async def _company_offices(db: AsyncSession) -> list[str]:
    profile = (await db.execute(select(CompanyProfile))).scalars().first()
    return list(profile.office_locations or []) if profile else []


async def _listed_office(value: str | None, current: str | None, db: AsyncSession) -> str | None:
    """An office from the company's list (Company profile), matched like departments. Someone
    already in an office that has since been taken off the list keeps it. While the company has
    no offices listed, any office is kept as typed."""
    if not value or not value.strip():
        return current
    offices = await _company_offices(db)
    if not offices:
        return clean_office_name(value)
    listed = match_office(value, offices)
    if listed:
        return listed
    if current and office_key(current) == office_key(value):
        return current
    raise HTTPException(
        status_code=422,
        detail=f"{clean_office_name(value)} isn't an office — add it on the Company profile page first",
    )


# Something@something.something, no spaces. Deliberately loose: it only catches typos like a
# missing @ or a space, not every address a mail server would refuse.
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email_problem(email: str) -> str | None:
    """Why this (already trimmed, lowercased) email can't be used, or None."""
    if not email:
        return "Email is required"
    if len(email) > 255 or not _EMAIL_PATTERN.match(email):
        return f"{email} isn't a valid email address"
    return None


async def _assert_email_free(email: str, exclude_user_id: int, db: AsyncSession) -> None:
    taken = (
        await db.execute(select(User.id).where(User.email == email, User.id != exclude_user_id))
    ).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(status_code=409, detail="A user with this email already exists")


async def _rename_employee_id(old_id: str, new_id: str, db: AsyncSession) -> None:
    """Changes the employee's own ID (their record's primary key), without ever disabling foreign
    key enforcement: employees.employee_id is referenced by users, claim_drafts, travel_trips and
    (self-referencing) employees.reporting_manager_id, and InnoDB can't cascade an UPDATE back
    into the same table the statement itself runs against, so a single UPDATE can't do this.

    Instead: insert a twin employee row under the new id, repoint every dependent row at it (now
    valid, since the new row already exists), then delete the old row — by which point nothing
    references it any more.

    erp_ledger_entries.employee_id is a historical snapshot and deliberately does not follow."""
    from app.models.reimbursement import ClaimDraft
    from app.models.travel_booking import TravelTrip

    taken = (
        await db.execute(select(Employee.employee_id).where(Employee.employee_id == new_id))
    ).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(status_code=409, detail="An employee with this ID already exists")

    employee = await db.get(Employee, old_id)
    columns = {
        column.name: getattr(employee, column.name)
        for column in Employee.__table__.columns
        if column.name != "employee_id"
    }
    db.expunge(employee)

    await db.execute(insert(Employee).values(employee_id=new_id, **columns))
    await db.execute(
        update(Employee).where(Employee.reporting_manager_id == old_id).values(reporting_manager_id=new_id)
    )
    await db.execute(update(User).where(User.employee_id == old_id).values(employee_id=new_id))
    await db.execute(update(ClaimDraft).where(ClaimDraft.employee_id == old_id).values(employee_id=new_id))
    await db.execute(
        update(TravelTrip)
        .where(TravelTrip.assigned_to_employee_id == old_id)
        .values(assigned_to_employee_id=new_id)
    )
    await db.execute(delete(Employee).where(Employee.employee_id == old_id))


async def _assert_impact_level(level_id: int | None, db: AsyncSession) -> None:
    if level_id and await db.get(ImpactLevel, level_id) is None:
        raise HTTPException(status_code=422, detail=f"Impact level {level_id} doesn't exist — pick one from the list")


async def _keeps_an_admin(
    user: User, actor_id: int, db: AsyncSession, *, new_role: Role | None = None, deactivating: bool = False
) -> None:
    """Someone must always be able to manage users: an admin can't change their own role or
    deactivate themselves, and the last active IT admin can't lose that role."""
    if not deactivating and (new_role is None or new_role == user.role):
        return
    if user.id == actor_id:
        raise HTTPException(
            status_code=422,
            detail=(
                "You can't deactivate your own account — ask another admin to do it"
                if deactivating
                else "You can't change your own role — ask another admin to do it"
            ),
        )
    if user.role == Role.IT_ADMIN and user.is_active:
        others = (
            await db.execute(
                select(func.count(User.id)).where(
                    User.role == Role.IT_ADMIN, User.is_active.is_(True), User.id != user.id
                )
            )
        ).scalar_one()
        if not others:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"{user.full_name or user.email} is the only active IT admin — "
                    "make someone else an IT admin first"
                ),
            )


async def _reporting_loop(manager_employee_id: str | None, people: set[str], db: AsyncSession) -> str | None:
    """Which of `people` this manager already reports to, directly or further up (their manager,
    that manager's manager, ...) — making them that person's report would close a loop. None if
    there's no loop."""
    seen: set[str] = set()
    current = manager_employee_id
    while current and current not in seen and len(seen) < 1000:
        if current in people:
            return current
        seen.add(current)
        employee = await db.get(Employee, current)
        current = employee.reporting_manager_id if employee else None
    return None


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
    if own_employee_id and await _reporting_loop(manager_employee_id, {own_employee_id}, db):
        raise HTTPException(
            status_code=422,
            detail=(
                f"{manager.full_name or manager.email} reports to this person (directly or through someone "
                "else), so they can't also be their manager"
            ),
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
    # Further up too: none of them can be someone this person reports to.
    looped = await _reporting_loop(own.reporting_manager_id if own else None, set(ids), db)
    if looped:
        raise HTTPException(
            status_code=422,
            detail=f"{name} reports to {looped} (directly or through someone else), so {looped} can't report to them",
        )

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
    looped = await _reporting_loop(new_id, {e.employee_id for e in team}, db)
    if looped:
        raise HTTPException(
            status_code=422,
            detail=f"The new manager reports to {looped}, who's in this team — pick a manager outside it",
        )
    new_manager =(await db.execute(select(User).where(User.employee_id == new_id))).scalars().first()

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
    email_problem = _email_problem(normalized_email)
    if email_problem:
        raise HTTPException(status_code=422, detail=email_problem)
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
    await _assert_impact_level(payload.impact_level_id, db)
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
    await _keeps_an_admin(user, int(claims["sub"]), db, new_role=role)
    if payload.impact_level_id is not None:
        await _assert_impact_level(payload.impact_level_id, db)
    # Turning Manager off: their people have to be moved to another manager first.
    if was_manager and not manager:
        team = await _team_of(user, db)
        if team:
            raise _team_still_reports(user, team)
    if payload.reporting_manager_id is not None:
        await _assert_can_report_to(payload.reporting_manager_id.strip() or None, user.employee_id, db)

    new_email = None
    if payload.email is not None:
        new_email = payload.email.strip().lower()
        problem = _email_problem(new_email)
        if problem:
            raise HTTPException(status_code=422, detail=problem)
        if new_email != user.email:
            await _assert_email_free(new_email, user.id, db)

    new_employee_id = None
    if payload.employee_id is not None:
        new_employee_id = payload.employee_id.strip()
        if not new_employee_id:
            raise HTTPException(status_code=422, detail="Employee ID can't be blank")
        if not user.employee_id:
            raise HTTPException(status_code=422, detail="This user has no employee record to rename")

    if payload.full_name is not None:
        user.full_name = payload.full_name
    if new_email is not None:
        user.email = new_email
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
                employee.office_location = await _listed_office(
                    payload.office_location, employee.office_location, db
                )
            if payload.reporting_manager_id is not None:
                # Blank clears it (no manager).
                employee.reporting_manager_id = payload.reporting_manager_id.strip() or None

    # Last: renaming the employee's own id. Everything above is keyed by the OLD id and must be
    # written first — see _rename_employee_id's docstring for why this one statement is enough.
    if new_employee_id and new_employee_id != user.employee_id:
        old_employee_id = user.employee_id
        await _rename_employee_id(old_employee_id, new_employee_id, db)
        await log_event(
            entity_type="user",
            entity_id=str(user.id),
            action="employee_id_renamed",
            actor_id=int(claims["sub"]),
            old={"employee_id": old_employee_id},
            new={"employee_id": new_employee_id},
            db=db,
        )

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
    await _keeps_an_admin(user, int(claims["sub"]), db, new_role=role)
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
async def deactivate_user(
    user_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_active:
        await _keeps_an_admin(user, int(claims["sub"]), db, deactivating=True)
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


async def _manager_problem(manager_employee_id: str | None, own_employee_id: str | None, db) -> str | None:
    """Why this person can't report to their recorded manager any more, or None if they can."""
    try:
        await _assert_can_report_to(manager_employee_id, own_employee_id, db)
    except HTTPException as exc:
        return str(exc.detail)
    return None


@router.post(
    "/users/{user_id}/reactivate",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=AdminUserOut,
)
async def reactivate_user(
    user_id: int,
    payload: AdminReactivateIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> AdminUserOut:
    """Lets a deactivated person sign in again with their old password. If their manager can't
    have them any more (deactivated, or no longer a manager), a new manager has to be picked."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_active:
        raise HTTPException(status_code=409, detail="This account is already active")
    employee = await db.get(Employee, user.employee_id) if user.employee_id else None
    old_manager = employee.reporting_manager_id if employee else None

    new_manager = (payload.reporting_manager_id or "").strip() or None
    if new_manager:
        await _assert_can_report_to(new_manager, user.employee_id, db)
    elif old_manager:
        problem = await _manager_problem(old_manager, user.employee_id, db)
        if problem:
            raise HTTPException(status_code=409, detail=f"Pick a new manager for them first — {problem}")

    user.is_active = True
    if employee:
        employee.is_active = True
        if new_manager:
            employee.reporting_manager_id = new_manager
    await log_event(
        entity_type="user",
        entity_id=str(user.id),
        action="user_reactivated",
        actor_id=int(claims["sub"]) if isinstance(claims, dict) and claims.get("sub") else None,
        old={"is_active": False, "reporting_manager_id": old_manager},
        new={"is_active": True, "reporting_manager_id": new_manager or old_manager},
        db=db,
    )
    await db.commit()
    return _admin_user_out(user, employee)


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
    offices = await _company_offices(db)
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
        if _email_problem(email):
            errors.append({"row": idx, "employee_id": employee_id, "email": email, "error": "invalid email address"})
            continue
        # Offices must be on the company's list, when it has one (same rule as editing someone).
        if office_location and offices:
            listed_office = match_office(office_location, offices)
            if listed_office is None:
                errors.append(
                    {
                        "row": idx,
                        "employee_id": employee_id,
                        "email": email,
                        "error": f'office "{clean_office_name(office_location)}" isn\'t on the Company profile list',
                    }
                )
                continue
            office_location = listed_office
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
            # Same as a user added one at a time (AdminUserCreateIn.mfa_verified defaults to True):
            # token refreshes copy this flag, so False locked imported admins out of admin pages.
            mfa_verified=True,
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
            elif await _reporting_loop(manager_id, {employee_id}, db):
                problem = (
                    f"{manager_user.full_name or manager_id} reports to them (directly or through someone else), "
                    "so they can't also be their manager"
                )
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
