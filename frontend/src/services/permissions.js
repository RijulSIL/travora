export const PERMISSION_MATRIX = {
  EMPLOYEE: ['submit_claim', 'view_self'],
  REPORTING_MANAGER: [
    'submit_claim',
    'view_self',
    'approve_stage_1',
    'view_admin_readonly',
    'approve_exception',
  ],
  HRBP_HR: [
    'submit_claim',
    'view_self',
    'configure_policy',
    'approve_policy',
    'view_reports',
    'approve_stage_2',
    'view_sensitive_admin',
  ],
  PAYROLL: [
    'submit_claim',
    'view_self',
    'view_reports',
    'process_payments',
    'approve_stage_3',
    'view_admin_readonly',
  ],
  FINANCE: [
    'submit_claim',
    'view_self',
    'configure_policy',
    'approve_policy',
    'view_reports',
    'export_audit',
    'process_payments',
    'approve_stage_4',
    'view_sensitive_admin',
  ],
  IT_ADMIN: [
    'submit_claim',
    'view_self',
    'manage_users',
    'configure_policy',
    'view_reports',
    'export_audit',
    'view_sensitive_admin',
    'view_workflow_config',
    'edit_workflow_config',
  ],
  CEO: [
    'submit_claim',
    'view_self',
    'view_reports',
    'approve_exception',
    'approve_stage_4',
  ],
  GROUP_HEAD_HR: [
    'submit_claim',
    'view_self',
    'view_reports',
    'approve_exception',
    'configure_policy',
  ],
};

PERMISSION_MATRIX.HRBP = PERMISSION_MATRIX.HRBP_HR;

// What a delegate temporarily inherits from each role they're covering for — must match
// backend's app/core/rbac.py DELEGATABLE_PERMISSIONS exactly. Deliberately just the
// "act on what's currently pending" permission for that role, never admin/config/reports.
export const DELEGATABLE_PERMISSIONS = {
  EMPLOYEE: [],
  REPORTING_MANAGER: ['approve_stage_1', 'approve_exception'],
  HRBP_HR: ['approve_stage_2'],
  PAYROLL: ['approve_stage_3'],
  FINANCE: ['approve_stage_4'],
  IT_ADMIN: [],
  CEO: ['approve_stage_4', 'approve_exception'],
  GROUP_HEAD_HR: ['approve_exception'],
};

export function delegatedPermissionsFor(delegatedRoles) {
  const set = new Set();
  for (const role of delegatedRoles || []) {
    for (const perm of DELEGATABLE_PERMISSIONS[role] || []) set.add(perm);
  }
  return set;
}

export function hasPermission(role, permission, delegatedRoles) {
  if (PERMISSION_MATRIX[role]?.includes(permission)) return true;
  return delegatedPermissionsFor(delegatedRoles).has(permission);
}

export function hasAnyPermission(role, permissions, delegatedRoles) {
  if (!permissions?.length) return false;
  return permissions.some((p) => hasPermission(role, p, delegatedRoles));
}

const POLICY_EDIT_ROLES = new Set(['HRBP_HR', 'IT_ADMIN', 'FINANCE']);

export function canEditPolicy(role) {
  return POLICY_EDIT_ROLES.has(role);
}

/** Matches PUT /workflow/config (edit_workflow_config + MFA on backend). */
export function canEditWorkflowConfig(role) {
  return hasPermission(role, 'edit_workflow_config');
}
