// Definitions shared by the Approval matrix page: which flows exist, their plain names, the
// approver roles a step can use, built-in defaults, and the same input clean-up the page has
// always applied before saving.

export const DEADLINE_MODES = ['hard_block', 'soft_warning'];
export const DEFAULT_MAX_DAYS = 5;
export const MAX_STEPS = 6;

// Claim exception types, in plain words. Keys are the server's exception types.
export const CLAIM_EXCEPTIONS = {
  ROOM_RENT_DEVIATION: 'Room rent over the limit',
  FOOD_DEVIATION: 'Food & meals over the limit',
  INCIDENTAL_DEVIATION: 'Incidentals over the limit',
  DAY_VISIT_EXTERNAL_MEETING: 'Day visit, external meeting',
  // The one route for any expense category without its own rule (Office supplies, Telecom, ...).
  POLICY_EXCEPTION_GENERAL: 'Other category over the limit',
  TRAIN_TATKAL: 'Train Tatkal',
  AIR_TRAVEL_L5_L6: 'Air travel at L5/L6',
  HIRED_TAXI_UNAUTHORIZED: 'Hired taxi not allowed',
  FLIGHT_COST_DELTA: 'Flight cost difference',
  MODE_DEVIATION: 'Different travel mode',
};

// Exception types raised against a travel request rather than a claim.
export const TRAVEL_EXCEPTIONS = {
  AIR_TRAVEL_UNLOCK: 'Air travel unlock',
  FLIGHT_ADVANCE_BOOKING_OVERRIDE: 'Flight booked too late',
  TRAIN_ADVANCE_BOOKING_OVERRIDE: 'Train booked too late',
  TRAVEL_REQUEST_LEAD_TIME_OVERRIDE: 'Request raised too late (other modes)',
};

export const EXCEPTION_KEYS = [...Object.keys(CLAIM_EXCEPTIONS), ...Object.keys(TRAVEL_EXCEPTIONS)];

// Exception types a claim expense can be flagged with at submission — the ones the
// "When it's on a claim" Allow/Block setting applies to (workflow_service.DEFAULT_EXCEPTION_SUBMISSION_MODE).
export const CLAIM_SUBMIT_EXCEPTIONS = new Set([
  'ROOM_RENT_DEVIATION',
  'FOOD_DEVIATION',
  'INCIDENTAL_DEVIATION',
  'DAY_VISIT_EXTERNAL_MEETING',
  'POLICY_EXCEPTION_GENERAL',
  'TRAIN_TATKAL',
  'AIR_TRAVEL_L5_L6',
  'HIRED_TAXI_UNAUTHORIZED',
]);

export const CLAIM_CATEGORIES = [
  ['DEFAULT', 'All categories'],
  ['TRAVEL', 'Travel'],
  ['GENERAL', 'General'],
  ['RELOCATION', 'Relocation'],
];

// Travel and relocation requests have their own approval steps (no payment, so no Finance step);
// these are what they use until someone sets their own (workflow_service defaults).
export const STANDALONE_DEFAULTS = {
  TRAVEL_REQUEST: [{ number: 1, label: 'Manager Review', route_role: 'REPORTING_MANAGER', sla_hours: 48 }],
  RELOCATION_REQUEST: [
    { number: 1, label: 'Recruiter Review', route_role: 'RECRUITER', sla_hours: 48 },
    { number: 2, label: 'CEO Approval', route_role: 'CEO', sla_hours: 48 },
    { number: 3, label: 'HRBP Review', route_role: 'HRBP_HR', sla_hours: 48 },
    { number: 4, label: 'Payroll Review', route_role: 'PAYROLL', sla_hours: 48 },
  ],
};

export const FLOW_NAMES = {
  CLAIMS: 'Claims',
  TRAVEL_REQUEST: 'Travel requests',
  RELOCATION_REQUEST: 'Relocation requests',
  POLICY_APPROVAL: 'Policy versions',
  ...CLAIM_EXCEPTIONS,
  ...TRAVEL_EXCEPTIONS,
};

// "Department head" is resolved per person (the head of their department, set in the
// Department heads card), like Reporting manager.
export const DEPARTMENT_HEAD = 'DEPARTMENT_HEAD';
export const STEP_ROLES = ['REPORTING_MANAGER', DEPARTMENT_HEAD, 'HRBP_HR', 'PAYROLL', 'FINANCE', 'CEO', 'GROUP_HEAD_HR', 'IT_ADMIN', 'RECRUITER'];
export const ROLE_NAMES = {
  REPORTING_MANAGER: 'Reporting manager',
  DEPARTMENT_HEAD: 'Department head',
  HRBP_HR: 'HRBP / HR',
  PAYROLL: 'Payroll',
  FINANCE: 'Finance',
  CEO: 'CEO',
  GROUP_HEAD_HR: 'Group head HR',
  IT_ADMIN: 'IT admin',
  RECRUITER: 'Recruiter',
};
export const ROLE_SHORT = {
  REPORTING_MANAGER: 'Manager',
  DEPARTMENT_HEAD: 'Dept head',
  HRBP_HR: 'HR',
  PAYROLL: 'Payroll',
  FINANCE: 'Finance',
  CEO: 'CEO',
  GROUP_HEAD_HR: 'Group HR',
  IT_ADMIN: 'IT',
  RECRUITER: 'Recruiter',
};

// Every role a "this role is about to lose its approval queue" warning is worth raising for.
export const ROLES_WORTH_WARNING_ABOUT = ['REPORTING_MANAGER', 'HRBP_HR', 'PAYROLL', 'FINANCE', 'CEO', 'GROUP_HEAD_HR', 'RECRUITER'];

// The three things a department head can be asked to approve, and which flows each one covers.
export const HEAD_FLOWS = [
  ['claims', 'Claims'],
  ['travel_requests', 'Travel requests'],
  ['exceptions', 'Exceptions'],
];

export function sanitizeMaxDays(raw) {
  if (raw === '' || raw === undefined || raw === null) return DEFAULT_MAX_DAYS;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_DAYS;
  return Math.floor(n);
}

export function sanitizeSlaHours(raw) {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 1) return 48;
  return n;
}

export function sanitizeAutoApprove(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return '0.00';
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return '0.00';
  return n.toFixed(2);
}

/** Every role token present anywhere in a config — diffed on save to warn before a role drops out entirely. */
export function rolesCoveredByConfig(config) {
  const roles = new Set();
  const addStages = (list) => (list || []).forEach((s) => s?.route_role && roles.add(s.route_role));
  addStages(config.stages);
  Object.values(config.category_overrides || {}).forEach((o) => addStages(o?.stages));
  Object.values(config.exception_chains || {}).forEach((chain) => (chain || []).forEach((r) => roles.add(r)));
  return roles;
}

export function errorMessage(err) {
  if (!err) return '';
  const d = err.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join('; ') || err.message;
  return err.message;
}
