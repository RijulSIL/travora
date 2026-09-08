import logging
from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt

from app.core.config import settings
from app.core.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from app.models.auth import Role, Delegation

logger = logging.getLogger(__name__)

PERMISSION_MATRIX: dict[Role, set[str]] = {
    Role.EMPLOYEE: {"submit_claim", "view_self"},
    Role.REPORTING_MANAGER: {
        "submit_claim",
        "view_self",
        "approve_stage_1",
        "view_admin_readonly",
        "view_workflow_config",
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
        "edit_workflow_config",
    },
    Role.PAYROLL: {
        "view_reports",
        "process_payments",
        "approve_stage_3",
        "view_admin_readonly",
        "view_workflow_config",
    },
    Role.FINANCE: {
        "configure_policy",
        "approve_policy",
        "view_reports",
        "export_audit",
        "process_payments",
        "approve_stage_4",
        "view_sensitive_admin",
    },
    Role.IT_ADMIN: {
        "manage_users",
        "configure_policy",
        "view_reports",
        "export_audit",
        "view_sensitive_admin",
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
        "view_self",
        "view_reports",
        "approve_exception",
        "configure_policy",
    },
}

SENSITIVE_MFA_ROLES = {Role.HRBP_HR, Role.FINANCE, Role.IT_ADMIN}


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
    async def dependency(request: Request, claims: dict = Depends(get_current_claims)) -> dict:
        try:
            role = Role(claims.get("role"))
        except ValueError as exc:
            _log_admin_users_access_denied(request, claims, f"invalid_role_for_action:{action}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden") from exc
        if action not in PERMISSION_MATRIX.get(role, set()):
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
        
        # Check active delegations to grant REPORTING_MANAGER permissions
        user_id = int(claims.get("sub", 0))
        if user_id:
            now = datetime.utcnow()
            delegation_q = select(Delegation.id).where(
                Delegation.delegatee_id == user_id,
                Delegation.is_active == True,
                Delegation.start_date <= now,
                Delegation.end_date >= now
            )
            is_delegate = (await db.execute(delegation_q)).first() is not None
            if is_delegate:
                allowed = allowed.union(PERMISSION_MATRIX.get(Role.REPORTING_MANAGER, set()))
                
        if not any(action in allowed for action in actions):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return claims

    return dependency


def require_role(*allowed_roles: Role) -> Callable:
    async def dependency(claims: dict = Depends(get_current_claims), db: AsyncSession = Depends(get_db)) -> dict:
        try:
            role = Role(claims.get("role"))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden") from exc
            
        if role not in allowed_roles:
            if Role.REPORTING_MANAGER in allowed_roles:
                user_id = int(claims.get("sub", 0))
                if user_id:
                    now = datetime.utcnow()
                    delegation_q = select(Delegation.id).where(
                        Delegation.delegatee_id == user_id,
                        Delegation.is_active == True,
                        Delegation.start_date <= now,
                        Delegation.end_date >= now
                    )
                    is_delegate = (await db.execute(delegation_q)).first() is not None
                    if is_delegate:
                        return claims
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return claims

    return dependency


def require_hrbp_role() -> Callable:
    return require_role(Role.HRBP_HR)


async def require_mfa(request: Request, claims: dict = Depends(get_current_claims)) -> dict:
    if not claims.get("mfa_verified"):
        _log_admin_users_access_denied(request, claims, "mfa_required")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="MFA verification required"
        )
    return claims
