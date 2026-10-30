// Definitions shared by the Approval matrix page: which flows exist, their plain names, the
// approver roles a step can use, built-in defaults, and the same input clean-up the page has
// always applied before saving.

// A trip's claim window, in calendar days after its to date (claim_submission_rules on the server):
// a claim after the first needs a late-claim exception; after the second the trip is archived.
export const DEFAULT_LATE_DAYS = 7;
export const DEFAULT_ARCHIVE_DAYS = 15;
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
  LATE_CLAIM: 'Claim raised late',
};

// Exception types raised against a travel request rather than a claim.
export const TRAVEL_EXCEPTIONS = {
  AIR_TRAVEL_UNLOCK: 'Air travel unlock',
  FLIGHT_ADVANCE_BOOKING_OVERRIDE: 'Flight booked too late',
  TRAIN_ADVANCE_BOOKING_OVERRIDE: 'Train booked too late',
  TRAVEL_REQUEST_LEAD_TIME_OVERRIDE: 'Request raised too late (other modes)',
};

export const EXCEPTION_KEYS = [...Object.keys(CLAIM_EXCEPTIONS), ...Object.keys(TRAVEL_EXCEPTIONS)];

// The two shared exception routes (workflow_service.CLAIM_EXCEPTIONS_ROUTE / TRAVEL_EXCEPTIONS_ROUTE):
// every claim exception type goes through the first, every travel request one through the second.
// Each type still has its own on/off switch (and Allow/Block on claims). Stored in exception_chains /
// exception_sla_hours under these keys.
export const CLAIM_EXCEPTION_FLOW = 'CLAIM_EXCEPTIONS';
export const TRAVEL_EXCEPTION_FLOW = 'TRAVEL_EXCEPTIONS';
export const EXCEPTION_FLOWS = {
  [CLAIM_EXCEPTION_FLOW]: { name: 'Claim exceptions', types: CLAIM_EXCEPTIONS },
  [TRAVEL_EXCEPTION_FLOW]: { name: 'Travel request exceptions', types: TRAVEL_EXCEPTIONS },
};
export const EXCEPTION_FLOW_KEYS = Object.keys(EXCEPTION_FLOWS);

// What each shared route uses until someone sets their own (workflow_service.EXCEPTION_APPROVAL_CHAINS).
export const EXCEPTION_FLOW_DEFAULTS = {
  [CLAIM_EXCEPTION_FLOW]: ['REPORTING_MANAGER', 'HRBP_HR', 'CEO'],
  [TRAVEL_EXCEPTION_FLOW]: ['REPORTING_MANAGER'],
};

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
  TRAVEL_REQUEST: [
    { number: 1, label: 'Manager Review', route_role: 'REPORTING_MANAGER', sla_hours: 48 },
    { number: 2, label: 'HRBP Review', route_role: 'HRBP_HR', sla_hours: 48 },
    { number: 3, label: 'CEO Approval', route_role: 'CEO', sla_hours: 48 },
    { number: 4, label: 'Admin Approval', route_role: 'ADMIN', sla_hours: 48 },
  ],
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
  [CLAIM_EXCEPTION_FLOW]: EXCEPTION_FLOWS[CLAIM_EXCEPTION_FLOW].name,
  [TRAVEL_EXCEPTION_FLOW]: EXCEPTION_FLOWS[TRAVEL_EXCEPTION_FLOW].name,
};

// "Department head" is resolved per person (the head of their department, set in the
// Department heads card), like Reporting manager.
export const DEPARTMENT_HEAD = 'DEPARTMENT_HEAD';
export const STEP_ROLES = ['REPORTING_MANAGER', DEPARTMENT_HEAD, 'HRBP_HR', 'PAYROLL', 'FINANCE', 'CEO', 'GROUP_HEAD_HR', 'IT_ADMIN', 'RECRUITER', 'ADMIN'];
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
  ADMIN: 'Admin',
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
  ADMIN: 'Admin',
};

// Every role a "this role is about to lose its approval queue" warning is worth raising for.
export const ROLES_WORTH_WARNING_ABOUT = ['REPORTING_MANAGER', 'HRBP_HR', 'PAYROLL', 'FINANCE', 'CEO', 'GROUP_HEAD_HR', 'RECRUITER', 'ADMIN'];

// The three things a department head can be asked to approve, and which flows each one covers.
export const HEAD_FLOWS = [
  ['claims', 'Claims'],
  ['travel_requests', 'Travel requests'],
  ['exceptions', 'Exceptions'],
];

/** A whole number of days from 1 to 365, or `fallback`. */
export function sanitizeDays(raw, fallback) {
  if (raw === '' || raw === undefined || raw === null) return fallback;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 365);
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

/** Whether any exception type that goes through this shared route is switched on. */
export function exceptionFlowInUse(config, flow) {
  return Object.keys(EXCEPTION_FLOWS[flow].types).some((type) => (config.exception_enabled || {})[type] !== false);
}

/** Every role a request could wait on in a config — diffed on save to warn before a role drops out
 * entirely. A shared exception route counts while any one of its exception types is on (the
 * server's "role with no active users" check does the same). */
export function rolesCoveredByConfig(config) {
  const roles = new Set();
  const addStages = (list) => (list || []).forEach((s) => s?.route_role && roles.add(s.route_role));
  addStages(config.stages);
  Object.values(config.category_overrides || {}).forEach((o) => addStages(o?.stages));
  EXCEPTION_FLOW_KEYS.forEach((flow) => {
    if (!exceptionFlowInUse(config, flow)) return;
    const route = config.exception_chains?.[flow]?.length ? config.exception_chains[flow] : EXCEPTION_FLOW_DEFAULTS[flow];
    route.forEach((r) => roles.add(r));
  });
  (config.exception_chains?.POLICY_APPROVAL || []).forEach((r) => roles.add(r));
  return roles;
}

export function errorMessage(err) {
  if (!err) return '';
  const d = err.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join('; ') || err.message;
  return err.message;
}
