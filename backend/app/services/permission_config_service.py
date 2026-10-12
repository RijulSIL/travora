"""Admin-editable override of app.core.rbac's PERMISSION_MATRIX / DELEGATABLE_PERMISSIONS —
the same role workflow_service.py plays for claim-approval routing, but for role->permission
grants. See RolePermissionConfig's docstring (app/models/auth.py) for the config_json shape.

Design notes (see the approved plan for the full rationale):
- submit_claim/view_self are never stored in the editable config — an unconditional baseline
  every role always has, which is what guarantees the self-service pages and Home can never be
  configured away.
- Saving is a per-role full replace, not an additive merge (the opposite of
  workflow_service's exception_chains): a brand-new require_permission("x") added to the
  codebase after an admin has customized this config must NOT silently inherit whatever the
  code default would have been — it needs explicit admin opt-in. Fail closed, not open.
- ALL_KNOWN_PERMISSIONS is a closed allow-list, same spirit as
  workflow_service._ALLOWED_WORKFLOW_ROLES — kept in sync by hand. Adding a new
  require_permission("x")/require_any_permission("x") call anywhere in the app means adding
  "x" here too, or the admin UI can never grant it.
"""

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import DELEGATABLE_PERMISSIONS, PERMISSION_MATRIX
from app.models.auth import Role, RolePermissionConfig
from app.services.audit_service import log_event

BASELINE_PERMISSIONS = {"submit_claim", "view_self"}

# A permission may only ever be marked delegatable if it's one of these — matches
# DELEGATABLE_PERMISSIONS' existing documented intent ("the current-queue action for that
# role, never admin/config/reports/audit/user-management").
DELEGATION_ELIGIBLE_PERMISSIONS = {
    "approve_claims",
    "approve_exception",
    "process_payments",
}

ALL_KNOWN_PERMISSIONS = {
    "submit_claim",
    "view_self",
    "approve_claims",
    "approve_exception",
    "view_admin_readonly",
    "configure_policy",
    "approve_policy",
    "view_reports",
    "view_sensitive_admin",
    "process_payments",
    "export_audit",
    "manage_users",
    "view_workflow_config",
    "edit_workflow_config",
    "view_team_claims",
    "view_team_calendar",
    "view_travel_desk",
    "manage_team_budgets",
    "view_notification_templates",
    "edit_notification_templates",
    "manage_holiday_calendar",
    "process_advances",
    "view_permission_matrix",
    "edit_permission_matrix",
}

# IT_ADMIN must always retain enough to administer users and recover this very config — the
# no-lockout rule. Without this, a bad save could permanently lock every admin out of fixing it.
_IT_ADMIN_RECOVERY_PERMISSIONS = {"manage_users", "view_permission_matrix", "edit_permission_matrix"}

ROLE_VALUES = [r.value for r in Role]


def _default_config() -> dict:
    return {
        "permissions": {role.value: sorted(perms) for role, perms in PERMISSION_MATRIX.items()},
        "delegatable_permissions": {
            role.value: sorted(perms) for role, perms in DELEGATABLE_PERMISSIONS.items()
        },
    }


def _validate_permission_config(config: dict) -> None:
    if not isinstance(config, dict):
        raise HTTPException(status_code=422, detail="Permission config must be an object")

    permissions = config.get("permissions")
    delegatable = config.get("delegatable_permissions")
    if not isinstance(permissions, dict) or not isinstance(delegatable, dict):
        raise HTTPException(
            status_code=422, detail="permissions and delegatable_permissions must both be objects"
        )

    for key, section in (("permissions", permissions), ("delegatable_permissions", delegatable)):
        missing_roles = set(ROLE_VALUES) - set(section.keys())
        if missing_roles:
            raise HTTPException(
                status_code=422, detail=f"{key} is missing role(s): {', '.join(sorted(missing_roles))}"
            )

    for role_val, perms in permissions.items():
        if role_val not in ROLE_VALUES:
            raise HTTPException(status_code=422, detail=f"Unknown role '{role_val}' in permissions")
        if not isinstance(perms, list) or not all(isinstance(p, str) for p in perms):
            raise HTTPException(
                status_code=422, detail=f"permissions['{role_val}'] must be a list of strings"
            )
        unknown = set(perms) - ALL_KNOWN_PERMISSIONS
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"permissions['{role_val}'] has unsupported permission(s): {', '.join(sorted(unknown))}",
            )
        missing_baseline = BASELINE_PERMISSIONS - set(perms)
        if missing_baseline:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"permissions['{role_val}'] is missing baseline permission(s) "
                    f"{', '.join(sorted(missing_baseline))} — these can never be removed"
                ),
            )

    for role_val, perms in delegatable.items():
        if role_val not in ROLE_VALUES:
            raise HTTPException(
                status_code=422, detail=f"Unknown role '{role_val}' in delegatable_permissions"
            )
        if not isinstance(perms, list) or not all(isinstance(p, str) for p in perms):
            raise HTTPException(
                status_code=422, detail=f"delegatable_permissions['{role_val}'] must be a list of strings"
            )
        not_eligible = set(perms) - DELEGATION_ELIGIBLE_PERMISSIONS
        if not_eligible:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"delegatable_permissions['{role_val}'] contains permission(s) that can "
                    f"never be delegated: {', '.join(sorted(not_eligible))}"
                ),
            )
        not_held = set(perms) - set(permissions.get(role_val, []))
        if not_held:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"delegatable_permissions['{role_val}'] grants delegation of permission(s) "
                    f"that role doesn't even hold: {', '.join(sorted(not_held))}"
                ),
            )


def _assert_it_admin_retains_recovery_permissions(config: dict) -> None:
    it_admin_perms = set(config["permissions"].get(Role.IT_ADMIN.value, []))
    missing = _IT_ADMIN_RECOVERY_PERMISSIONS - it_admin_perms
    if missing:
        raise HTTPException(
            status_code=422,
            detail=(
                f"IT_ADMIN must always retain {', '.join(sorted(missing))} — removing it would "
                "make this config (and user management) unrecoverable."
            ),
        )


async def get_permission_config(db: AsyncSession) -> dict:
    row = await db.get(RolePermissionConfig, 1)
    if row is None or not row.config_json:
        return _default_config()
    return row.config_json


async def get_effective_permission_matrix(db: AsyncSession) -> dict[Role, set[str]]:
    config = await get_permission_config(db)
    return {
        Role(role_val): set(perms) | BASELINE_PERMISSIONS
        for role_val, perms in config["permissions"].items()
    }


async def get_effective_delegatable_permissions(db: AsyncSession) -> dict[Role, set[str]]:
    config = await get_permission_config(db)
    return {
        Role(role_val): set(perms) for role_val, perms in config["delegatable_permissions"].items()
    }


async def save_permission_config(config: dict, user_id: int | None, db: AsyncSession) -> dict:
    _validate_permission_config(config)
    _assert_it_admin_retains_recovery_permissions(config)

    row = await db.get(RolePermissionConfig, 1)
    old_config = row.config_json if row else None
    if row is None:
        row = RolePermissionConfig(id=1, config_json=config, updated_by_user_id=user_id)
        db.add(row)
    else:
        row.config_json = config
        row.updated_by_user_id = user_id

    await log_event(
        entity_type="permission_matrix_config",
        entity_id="1",
        action="update_permission_matrix_config",
        actor_id=user_id,
        old=old_config,
        new=config,
        db=db,
    )
    await db.commit()
    await db.refresh(row)
    return row.config_json


def permission_catalog() -> dict:
    """Everything the admin UI needs to render a generic grid without hardcoding its own copy
    of permission names — roles, every grantable permission, which ones are baseline
    (always-on, shown disabled) and which are eligible for the delegatable-permissions grid."""
    return {
        "roles": ROLE_VALUES,
        "permissions": sorted(ALL_KNOWN_PERMISSIONS),
        "baseline_permissions": sorted(BASELINE_PERMISSIONS),
        "delegation_eligible_permissions": sorted(DELEGATION_ELIGIBLE_PERMISSIONS),
    }
