// The role->permission matrix itself now lives server-side (admin-editable — see
// permission_config_service.py on the backend) and is never duplicated here. `/me` returns
// this viewer's own already-resolved, delegation-merged permission list as `profile.permissions`
// — every check below is a plain membership test against that list, not a role lookup.

export function hasPermission(permissions, permission) {
  return Array.isArray(permissions) && permissions.includes(permission);
}

export function hasAnyPermission(permissions, wanted) {
  if (!wanted?.length) return false;
  return wanted.some((p) => hasPermission(permissions, p));
}

/** Matches PUT /workflow/config (edit_workflow_config + MFA on backend). */
export function canEditWorkflowConfig(permissions) {
  return hasPermission(permissions, 'edit_workflow_config');
}
