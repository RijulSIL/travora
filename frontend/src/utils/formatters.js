export const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));

export const formatDate = (dateString) =>
  new Date(dateString).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

export const formatDatetime = (dateString) =>
  new Date(dateString).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const ROLE_LABELS = {
  EMPLOYEE: 'Employee',
  REPORTING_MANAGER: 'Reporting Manager',
  HRBP_HR: 'HRBP / HR',
  PAYROLL: 'Payroll',
  FINANCE: 'Finance',
  IT_ADMIN: 'IT Admin',
  CEO: 'CEO',
  GROUP_HEAD_HR: 'Group Head HR',
};

export const formatRole = (role) => ROLE_LABELS[role] || (role || '').replace(/_/g, ' ');

export const EXCEPTION_TYPE_LABELS = {
  // These are the only exception types ever actually raised against a travel request
  // rather than a claim.
  AIR_TRAVEL_UNLOCK: 'Air Travel Unlock (Travel Request)',
  AIR_TRAVEL_L5_L6: 'Air Travel (Level 5A–6D)',
  TRAIN_TATKAL: 'Tatkal Train Booking',
  FLIGHT_ADVANCE_BOOKING_OVERRIDE: 'Flight Advance Booking Override (Travel Request)',
  TRAIN_ADVANCE_BOOKING_OVERRIDE: 'Train Advance Booking Override (Travel Request)',
  TRAVEL_REQUEST_LEAD_TIME_OVERRIDE: 'Travel Request Lead Time Override (Travel Request)',
  FLIGHT_COST_DELTA: 'Flight Cost Delta',
  ROOM_RENT_DEVIATION: 'Room Rent Deviation',
  FOOD_DEVIATION: 'Food & Meals Deviation',
  INCIDENTAL_DEVIATION: 'Incidental Expenses Deviation',
  HIRED_TAXI_UNAUTHORIZED: 'Hired Taxi (Unauthorized)',
  MODE_DEVIATION: 'Mode of Travel Deviation',
  DAY_VISIT_EXTERNAL_MEETING: 'Day Visit External Meeting',
  // Catch-all for any expense category with no dedicated exception rule — see
  // workflow_service._chain_for_type on the backend, which routes every generic
  // f"{category}_DEVIATION" type through this same chain.
  POLICY_EXCEPTION_GENERAL: 'Other Category Deviation',
};

export const formatExceptionType = (type) =>
  EXCEPTION_TYPE_LABELS[type] ||
  (type || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** One ExceptionRequest can cover several exception types at once — render all of them. */
export const formatExceptionTypes = (types, fallbackType) =>
  Array.isArray(types) && types.length
    ? types.map(formatExceptionType).join(' + ')
    : formatExceptionType(fallbackType);

export const EXCEPTION_TYPE_DESCRIPTIONS = {
  AIR_TRAVEL_UNLOCK:
    "This employee's level does not normally permit air travel. Approving this unlocks air travel for this request only.",
  AIR_TRAVEL_L5_L6:
    'Air travel for Level 5A–6D employees requires case-by-case approval before it can be booked.',
  TRAIN_TATKAL:
    'The train ticket is being booked via Tatkal (premium/emergency booking) instead of standard advance booking.',
  FLIGHT_ADVANCE_BOOKING_OVERRIDE:
    'The flight is being booked with fewer than the minimum required advance-notice days.',
  TRAIN_ADVANCE_BOOKING_OVERRIDE:
    'The train departure falls within the minimum required advance-notice window.',
  TRAVEL_REQUEST_LEAD_TIME_OVERRIDE:
    'This travel request is being submitted with fewer than the minimum required advance-notice working days.',
  FLIGHT_COST_DELTA:
    'The selected flight fare exceeds the policy-permitted amount for this route/class.',
  ROOM_RENT_DEVIATION:
    "The hotel room rent exceeds the policy cap for this employee's level/city.",
  FOOD_DEVIATION:
    "Food & Meals spend exceeds the policy cap for this employee's level/city.",
  INCIDENTAL_DEVIATION:
    "Incidental expenses exceed the policy cap for this employee's level/city.",
  HIRED_TAXI_UNAUTHORIZED:
    'A hired taxi is being used without the prior authorization normally required for this mode of travel.',
  MODE_DEVIATION:
    'The mode of travel selected deviates from what policy permits for this employee/route.',
  DAY_VISIT_EXTERNAL_MEETING:
    'Expense is being claimed for a day visit / external meeting outside standard travel policy parameters.',
  POLICY_EXCEPTION_GENERAL:
    'An expense category with no dedicated policy rule exceeded its cap — this is the default approval route for any such deviation.',
};

export const describeExceptionType = (type) =>
  EXCEPTION_TYPE_DESCRIPTIONS[type] || 'No further detail is available for this exception type.';

export const formatRelative = (dateString) => {
  const diff = Date.now() - new Date(dateString).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} minutes ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
  return `${Math.floor(sec / 86400)} days ago`;
};
