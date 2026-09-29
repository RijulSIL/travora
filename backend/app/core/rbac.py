import logging
from collections.abc import Callable
from datetime import datetime

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.auth import Delegation, Role, User

logger = logging.getLogger(__name__)

PERMISSION_MATRIX: dict[Role, set[str]] = {
    Role.EMPLOYEE: {"submit_claim", "view_self"},
    Role.REPORTING_MANAGER: {
        "submit_claim",
        "view_self",
        "approve_stage_1",
        "view_admin_readonly",
        "approve_exception",
    },
    Role.HRBP_HR: {
        "submit_claim",
        "view_self",
        "configure_policy",
        "approve_policy",
        "view_reports",
        "approve_stage_2",
        "view_sensitive_admin",
    },
    Role.PAYROLL: {
        "submit_claim",
        "view_self",
        "view_reports",
        "process_payments",
        "approve_stage_3",
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
        "approve_stage_4",
        "view_sensitive_admin",
    },
    Role.IT_ADMIN: {
        "submit_claim",
        "view_self",
        "manage_users",
        "configure_policy",
        "view_reports",
        "export_audit",
        "view_sensitive_admin",
        "view_workflow_config",
        "edit_workflow_config",
    },
    Role.CEO: {
        "submit_claim",
        "view_self",
        "view_reports",
        "approve_exception",
        "approve_stage_4",
    },
    Role.GROUP_HEAD_HR: {
        "submit_claim",
        "view_self",
        "view_reports",
        "approve_exception",
        "configure_policy",
    },
}

SENSITIVE_MFA_ROLES = {Role.HRBP_HR, Role.FINANCE, Role.IT_ADMIN}

# What a delegate temporarily inherits from each role they're covering for — deliberately
# just the "act on what's currently pending" permissions (the approval-stage/exception gate
# for that role), never admin/config, reports, audit, or user-management permissions. A
# delegate should be able to clear the delegator's current queue, not everything the
# delegator could otherwise see or change.
DELEGATABLE_PERMISSIONS: dict[Role, set[str]] = {
    Role.EMPLOYEE: set(),
    Role.REPORTING_MANAGER: {"approve_stage_1", "approve_exception"},
    Role.HRBP_HR: {"approve_stage_2"},
    Role.PAYROLL: {"approve_stage_3"},
    Role.FINANCE: {"approve_stage_4"},
    Role.IT_ADMIN: set(),
    Role.CEO: {"approve_stage_4", "approve_exception"},
    Role.GROUP_HEAD_HR: {"approve_exception"},
}


async def _active_delegator_roles(user_id: int, db: AsyncSession) -> set[Role]:
    """Roles of everyone currently delegating to `user_id` (an active, in-window Delegation
    row with them as delegatee). Used to compute both delegated permissions and delegated
    role-gated access — never to grant broader access than the delegator actually has."""
    if not user_id:
        return set()

    from app.services.delegation_service import is_delegation_enabled

    if not await is_delegation_enabled(db):
        return set()

    now = datetime.utcnow()
    delegator_ids = (
        await db.execute(
            select(Delegation.delegator_id).where(
                Delegation.delegatee_id == user_id,
                Delegation.is_active,
                Delegation.start_date <= now,
                Delegation.end_date >= now,
            )
        )
    ).scalars().all()
    if not delegator_ids:
        return set()
    roles = (await db.execute(select(User.role).where(User.id.in_(delegator_ids)))).scalars().all()
    return set(roles)


async def get_delegated_permissions(user_id: int, db: AsyncSession) -> set[str]:
    delegator_roles = await _active_delegator_roles(user_id, db)
    allowed: set[str] = set()
    for role in delegator_roles:
        allowed |= DELEGATABLE_PERMISSIONS.get(role, set())
    return allowed


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


def get_current_claims(request: Request) -> dict:
    return decode_bearer_token(request)


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
        allowed = PERMISSION_MATRIX.get(role, set())
        if action not in allowed:
            user_id = int(claims.get("sub", 0))
            if action not in await get_delegated_permissions(user_id, db):
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

        allowed = PERMISSION_MATRIX.get(role, set())
        if not any(action in allowed for action in actions):
            user_id = int(claims.get("sub", 0))
            allowed = allowed | await get_delegated_permissions(user_id, db)
            if not any(action in allowed for action in actions):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return claims

    return dependency


def require_role(*allowed_roles: Role, allow_delegate: bool = True) -> Callable:
    """`allow_delegate=False` is for role checks that are NOT "clear the current queue"
    actions (e.g. approving a policy version) — delegation should never extend to those."""

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
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return claims

    return dependency


def require_hrbp_role() -> Callable:
    # Policy-version approval is admin/config work, not a "current queue" action — never
    # delegable, unlike the travel-desk / approval-queue uses of require_role(HRBP_HR).
    return require_role(Role.HRBP_HR, allow_delegate=False)


async def require_mfa(request: Request, claims: dict = Depends(get_current_claims)) -> dict:
    if not claims.get("mfa_verified"):
        _log_admin_users_access_denied(request, claims, "mfa_required")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="MFA verification required"
        )
    return claims
