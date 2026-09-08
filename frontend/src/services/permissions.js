export const PERMISSION_MATRIX = {
  EMPLOYEE: ['submit_claim', 'view_self'],
  REPORTING_MANAGER: [
    'submit_claim',
    'view_self',
    'approve_stage_1',
    'view_admin_readonly',
    'view_workflow_config',
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
    'edit_workflow_config',
  ],
  PAYROLL: [
    'view_reports',
    'process_payments',
    'approve_stage_3',
    'view_admin_readonly',
    'view_workflow_config',
  ],
  FINANCE: [
    'configure_policy',
    'approve_policy',
    'view_reports',
    'export_audit',
    'process_payments',
    'approve_stage_4',
    'view_sensitive_admin',
  ],
  IT_ADMIN: [
    'manage_users',
    'configure_policy',
    'view_reports',
    'export_audit',
    'view_sensitive_admin',
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
    'view_self',
    'view_reports',
    'approve_exception',
    'configure_policy',
  ],
};

PERMISSION_MATRIX.HRBP = PERMISSION_MATRIX.HRBP_HR;

export function hasPermission(role, permission) {
  return Boolean(PERMISSION_MATRIX[role]?.includes(permission));
}

export function hasAnyPermission(role, permissions) {
  if (!permissions?.length) return false;
  return permissions.some((p) => hasPermission(role, p));
}

const POLICY_EDIT_ROLES = new Set(['HRBP_HR', 'IT_ADMIN', 'FINANCE']);

export function canEditPolicy(role) {
  return POLICY_EDIT_ROLES.has(role);
}

/** Matches PUT /workflow/config (edit_workflow_config + MFA on backend). */
export function canEditWorkflowConfig(role) {
  return hasPermission(role, 'edit_workflow_config');
}
