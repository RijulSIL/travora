import calendar
import logging
from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.timezone import now_ist
from app.models.auth import Delegation, Role, User

logger = logging.getLogger(__name__)

PERMISSION_MATRIX: dict[Role, set[str]] = {
    Role.EMPLOYEE: {"submit_claim", "view_self"},
    Role.REPORTING_MANAGER: {
        "submit_claim",
        "view_self",
        "approve_claims",
        "view_admin_readonly",
        "approve_exception",
        "view_team_claims",
        "view_team_calendar",
    },
    Role.HRBP_HR: {
        "submit_claim",
        "view_self",
        "configure_policy",
        "approve_policy",
        "view_reports",
        "approve_claims",
        "view_sensitive_admin",
        "view_travel_desk",
        "view_notification_templates",
    },
    Role.PAYROLL: {
        "submit_claim",
        "view_self",
        "view_reports",
        "process_payments",
        "approve_claims",
        "view_admin_readonly",
    },
    Role.FINANCE: {
        "submit_claim",
        "view_self",
        "configure_policy",
        "approve_policy",
        "view_reports",
        "export_audit",
        "process_payments",
        "approve_claims",
        "view_sensitive_admin",
        "process_advances",
    },
    Role.IT_ADMIN: {
        "submit_claim",
        "view_self",
        "manage_users",
        "configure_policy",
        # Decoupled from configure_policy on purpose — the same read/edit split
        # REPORTING_MANAGER and PAYROLL already have. Losing configure_policy (e.g. an admin
        # toggling it off in the Permission Matrix editor) must not also take down read-only
        # visibility like the dashboard's KPI widget; that's a view concern, not an edit one.
        "view_admin_readonly",
        "view_reports",
        "export_audit",
        "view_sensitive_admin",
        "view_workflow_config",
        "edit_workflow_config",
        "manage_team_budgets",
        "view_notification_templates",
        "edit_notification_templates",
        "manage_holiday_calendar",
        "view_permission_matrix",
        "edit_permission_matrix",
    },
    Role.CEO: {
        "submit_claim",
        "view_self",
        "view_reports",
        "approve_exception",
        "approve_claims",
    },
    Role.GROUP_HEAD_HR: {
        "submit_claim",
        "view_self",
        "view_reports",
        "approve_exception",
        "configure_policy",
    },
    # Relocation approval isn't a permission — it comes from being a stage in the Relocation
    # Approval workflow (Approval Matrix), like travel-request approval.
    Role.RECRUITER: {"submit_claim", "view_self"},
}

SENSITIVE_MFA_ROLES = {Role.HRBP_HR, Role.FINANCE, Role.IT_ADMIN}

# What a delegate temporarily inherits from each role they're covering for — deliberately
# just the "act on what's currently pending" permissions (the approval-stage/exception gate
# for that role), never admin/config, reports, audit, or user-management permissions. A
# delegate should be able to clear the delegator's current queue, not everything the
# delegator could otherwise see or change.
DELEGATABLE_PERMISSIONS: dict[Role, set[str]] = {
    Role.EMPLOYEE: set(),
    Role.REPORTING_MANAGER: {"approve_claims", "approve_exception"},
    Role.HRBP_HR: {"approve_claims"},
    Role.PAYROLL: {"approve_claims"},
    Role.FINANCE: {"approve_claims"},
    Role.IT_ADMIN: set(),
    Role.CEO: {"approve_claims", "approve_exception"},
    Role.GROUP_HEAD_HR: {"approve_exception"},
    Role.RECRUITER: set(),
}


async def _active_delegator_user_ids(user_id: int, db: AsyncSession) -> list[int]:
    """Everyone currently delegating to `user_id` (an active, in-window Delegation row with
    them as delegatee)."""
    if not user_id:
        return []

    from app.services.delegation_service import is_delegation_enabled

    if not await is_delegation_enabled(db):
        return []

    now = now_ist()
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
        )
        .scalars()
        .all()
    )


async def _active_delegator_roles(user_id: int, db: AsyncSession) -> set[Role]:
    """Roles of everyone currently delegating to `user_id`. Used to compute both delegated
    permissions and delegated role-gated access — never to grant broader access than the
    delegator actually has."""
    delegator_ids = await _active_delegator_user_ids(user_id, db)
    if not delegator_ids:
        return set()
    roles = (await db.execute(select(User.role).where(User.id.in_(delegator_ids)))).scalars().all()
    return set(roles)


# Being a manager is the Manager setting (User.is_manager), on top of any role: a role is the
# person's job, the setting says people can report to them. A manager gets the Manager row of
# Role permissions (stored under the REPORTING_MANAGER key) added to their role's own. The CEO is
# always a manager, and a legacy Reporting Manager user/token still counts as one. Approvals for
# each person go to whoever they report to (Employee.reporting_manager_id), and team pages are
# scoped to their own reports where they're used (is_direct_report, /claims/team, ...).
MANAGER_ROLES = {Role.CEO, Role.REPORTING_MANAGER}


def is_manager(user: User | None) -> bool:
    return bool(user is not None and (user.is_manager or user.role in MANAGER_ROLES))


async def user_is_manager(user_id: int, db: AsyncSession) -> bool:
    return is_manager(await db.get(User, user_id) if user_id else None)


async def has_direct_reports(user_id: int, db: AsyncSession) -> bool:
    """True when at least one active employee reports to this user."""
    from app.models.employee import Employee

    user = await db.get(User, user_id) if user_id else None
    if user is None or not user.employee_id:
        return False
    found = (
        await db.execute(
            select(Employee.employee_id)
            .where(Employee.reporting_manager_id == user.employee_id, Employee.is_active.is_(True))
            .limit(1)
        )
    ).scalar_one_or_none()
    return found is not None


async def acts_as_manager(user_id: int, db: AsyncSession) -> bool:
    """A manager, or covering (delegation) for one."""
    if await user_is_manager(user_id, db):
        return True
    for delegator_id in await _active_delegator_user_ids(user_id, db):
        if await user_is_manager(delegator_id, db):
            return True
    return False


async def get_manager_permissions(user_id: int, db: AsyncSession) -> set[str]:
    """The Manager row of Role permissions, for anyone with the Manager setting."""
    if not await user_is_manager(user_id, db):
        return set()
    from app.services.permission_config_service import get_effective_permission_matrix

    matrix = await get_effective_permission_matrix(db)
    return set(matrix.get(Role.REPORTING_MANAGER, set()))


async def get_delegated_permissions(user_id: int, db: AsyncSession) -> set[str]:
    delegator_ids = await _active_delegator_user_ids(user_id, db)
    if not delegator_ids:
        return set()

    from app.services.permission_config_service import get_effective_delegatable_permissions

    delegatable = await get_effective_delegatable_permissions(db)
    delegator_roles = set((await db.execute(select(User.role).where(User.id.in_(delegator_ids)))).scalars().all())
    allowed: set[str] = set()
    for role in delegator_roles:
        allowed |= delegatable.get(role, set())
    # Covering for a manager (whatever their role) covers their manager queue too.
    for delegator_id in delegator_ids:
        if await user_is_manager(delegator_id, db):
            allowed |= delegatable.get(Role.REPORTING_MANAGER, set())
            break
    return allowed


async def get_extra_permissions(user_id: int, db: AsyncSession) -> set[str]:
    """Permissions on top of the user's own role: from managing people, and from delegation."""
    return await get_manager_permissions(user_id, db) | await get_delegated_permissions(user_id, db)


async def is_direct_report(*, manager_user_id: int, target_user_id: int, db: AsyncSession) -> bool:
    """True iff `target_user_id` is literally one of `manager_user_id`'s direct reports
    (Employee.reporting_manager_id == the manager's own employee_id).

    This is the one check that decides whether a REPORTING_MANAGER — the only role with no
    blanket "view_reports"/"process_payments" permission — may view a specific employee's data
    cross-user. It existed inline, independently, in two different call sites
    (claims.py's /claims/team, workflow_service.assert_user_can_view_claim_workflow) while two
    others (claims.py's employee_claims, exceptions_api.py's get_exception) granted
    REPORTING_MANAGER blanket cross-user access with no check at all — an IDOR. Centralizing it
    here means there's exactly one place left to get this right.

    Does not consider delegation: a manager temporarily covering someone's *approvals* already
    goes through its own delegation-aware check (_user_matches_required_role /
    _active_delegator_ids) at the point of action, which is a different question from "is this
    literally my report" and shouldn't be conflated with it here.
    """
    if manager_user_id == target_user_id:
        return True
    from app.models.employee import Employee

    manager = await db.get(User, manager_user_id)
    if manager is None or not manager.employee_id:
        return False
    target = await db.get(User, target_user_id)
    if target is None or not target.employee_id:
        return False
    target_employee = await db.get(Employee, target.employee_id)
    return target_employee is not None and target_employee.reporting_manager_id == manager.employee_id


def decode_bearer_token(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token"
        ) from exc


# What someone still on the temporary password may do: read their profile (the app reads it to
# show the set-password screen) and set their own password. Refreshing and signing out don't take
# an access token, so they keep working too.
TEMPORARY_PASSWORD_ALLOWED = {("GET", "/me"), ("POST", "/auth/set-initial-password")}


def _api_path(request: Request) -> str:
    path = request.scope.get("path") or request.url.path
    if path.startswith(settings.api_v1_prefix):
        path = path[len(settings.api_v1_prefix):]
    return path.rstrip("/") or "/"


def _issued_before(claims: dict, moment) -> bool:
    issued = claims.get("iat")
    if not isinstance(issued, int | float):
        return True
    return issued < calendar.timegm(moment.utctimetuple())


async def get_current_claims(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """The signed-in person's token, checked against their account as it is now — so a
    deactivated account, a changed role or a changed password takes effect at once instead of
    when the token runs out. "role" is replaced with their current role, which every permission
    and role check below reads. One user lookup per request (FastAPI shares this dependency)."""
    claims = decode_bearer_token(request)
    # The sign-in step's short "mfa" token isn't a session.
    if claims.get("type"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token")
    try:
        user_id = int(claims.get("sub"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token") from exc

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This account is no longer active")
    # Signed in before the password was reset or changed: that session has ended.
    if user.password_changed_at is not None and _issued_before(claims, user.password_changed_at):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Your password was changed — please sign in again"
        )
    if user.must_change_password and (request.method, _api_path(request)) not in TEMPORARY_PASSWORD_ALLOWED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Set your own password first — you're still signed in with the temporary one",
        )
    return {**claims, "role": user.role.value}


def _log_admin_users_access_denied(request: Request, claims: dict, reason: str) -> None:
    if "/admin/users" not in request.url.path:
        return
    logger.warning(
        "Access denied for admin users endpoint: path=%s reason=%s role_claim=%s mfa_claim=%s sub=%s",
        request.url.path,
        reason,
        claims.get("role"),
        claims.get("mfa_verified"),
        claims.get("sub"),
    )


def require_permission(action: str) -> Callable:
    async def dependency(
        request: Request, claims: dict = Depends(get_current_claims), db: AsyncSession = Depends(get_db)
    ) -> dict:
        try:
            role = Role(claims.get("role"))
        except ValueError as exc:
            _log_admin_users_access_denied(request, claims, f"invalid_role_for_action:{action}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden") from exc

        from app.services.permission_config_service import get_effective_permission_matrix

        matrix = await get_effective_permission_matrix(db)
        allowed = matrix.get(role, set())
        if action not in allowed:
            user_id = int(claims.get("sub", 0))
            if action not in await get_extra_permissions(user_id, db):
                _log_admin_users_access_denied(request, claims, f"missing_permission:{action}")
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return claims

    return dependency


def require_any_permission(*actions: str) -> Callable:
    async def dependency(claims: dict = Depends(get_current_claims), db: AsyncSession = Depends(get_db)) -> dict:
        try:
            role = Role(claims.get("role"))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden") from exc

        from app.services.permission_config_service import get_effective_permission_matrix

        matrix = await get_effective_permission_matrix(db)
        allowed = matrix.get(role, set())
        if not any(action in allowed for action in actions):
            user_id = int(claims.get("sub", 0))
            allowed = allowed | await get_extra_permissions(user_id, db)
            if not any(action in allowed for action in actions):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return claims

    return dependency


def require_role(*allowed_roles: Role, allow_delegate: bool = True, allow_managers: bool = False) -> Callable:
    """`allow_delegate=False` is for role checks that are NOT "clear the current queue"
    actions — delegation should never extend to those. `allow_managers=True` also lets in
    anyone with the Manager setting (see is_manager), for the manager-step queue and actions;
    what they can act on is still decided per item."""

    async def dependency(claims: dict = Depends(get_current_claims), db: AsyncSession = Depends(get_db)) -> dict:
        try:
            role = Role(claims.get("role"))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden") from exc

        if role not in allowed_roles:
            if allow_delegate:
                user_id = int(claims.get("sub", 0))
                delegator_roles = await _active_delegator_roles(user_id, db)
                if delegator_roles & set(allowed_roles):
                    return claims
            if allow_managers and await acts_as_manager(int(claims.get("sub", 0)), db):
                return claims
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return claims

    return dependency


async def require_mfa(request: Request, claims: dict = Depends(get_current_claims)) -> dict:
    if not claims.get("mfa_verified"):
        _log_admin_users_access_denied(request, claims, "mfa_required")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="MFA verification required"
        )
    return claims
