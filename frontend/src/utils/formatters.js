export const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));

/*
 * Dates are shown as DD/MM/YYYY everywhere (04/11/2026), with the time as "04/11/2026, 2:05 pm".
 * Always format through these helpers — never toLocaleDateString / toLocaleString, whose output
 * depends on the viewer's browser language (a US browser shows 11/04/2026).
 */
const pad2 = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A Date from an API value (or a Date). A plain 'YYYY-MM-DD' is a calendar day, so it's read as
 * that day locally — new Date('2026-11-04') is UTC midnight, which is the 3rd west of Greenwich.
 * null when there's no valid date.
 */
export const toDate = (value) => {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** DD/MM/YYYY. '' when there's no date. */
export const formatDate = (value) => {
  const d = toDate(value);
  return d ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : '';
};

/** 12-hour time: "2:05 pm". */
export const formatTime = (value) => {
  const d = toDate(value);
  if (!d) return '';
  const h = d.getHours();
  return `${h % 12 || 12}:${pad2(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
};

/** DD/MM/YYYY, h:mm am|pm — "04/11/2026, 2:05 pm". */
export const formatDatetime = (value) => {
  const d = toDate(value);
  return d ? `${formatDate(d)}, ${formatTime(d)}` : '';
};

/** "Wed, 04/11/2026" — where the day of the week helps (travel legs, trips). */
export const formatWeekdayDate = (value) => {
  const d = toDate(value);
  return d ? `${WEEKDAYS[d.getDay()]}, ${formatDate(d)}` : '';
};

/** Text from the API with ISO days in it ("Delhi → Mumbai · 2026-10-02–2026-10-18") with each shown as DD/MM/YYYY. */
export const formatDatesInText = (text) =>
  text == null ? text : String(text).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${d}/${m}/${y}`);

/** 'YYYY-MM-DD' for a Date in local time: what date fields and the API take. */
export const toIsoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const ROLE_LABELS = {
  EMPLOYEE: 'Employee',
  REPORTING_MANAGER: 'Reporting Manager',
  HRBP_HR: 'HRBP / HR',
  PAYROLL: 'Payroll',
  FINANCE: 'Finance',
  IT_ADMIN: 'IT Admin',
  CEO: 'CEO',
  GROUP_HEAD_HR: 'Group Head HR',
  RECRUITER: 'Recruiter',
  ADMIN: 'Admin',
  // Not a user role: an approval step that goes to the head of the person's department.
  DEPARTMENT_HEAD: 'Department Head',
};

export const formatRole = (role) => ROLE_LABELS[role] || (role || '').replace(/_/g, ' ');

// Being a manager is a separate setting on top of the role (profile.is_manager), so it's shown
// next to the role — except where the role already says so (CEO, the old Reporting Manager role).
export const showsManager = (role, isManager) => Boolean(isManager) && role !== 'CEO' && role !== 'REPORTING_MANAGER';

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
  HIRED_TAXI_UNAUTHORIZED: 'Local Conveyance Mode (Not Eligible)',
  MODE_DEVIATION: 'Mode of Travel Deviation',
  LATE_CLAIM: 'Late Claim',
  DAY_VISIT_EXTERNAL_MEETING: 'Day Visit External Meeting',
  // Catch-all for any expense category with no dedicated exception rule (every generic
  // f"{category}_DEVIATION" type on the backend follows its on/off and Allow/Block settings).
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
  LATE_CLAIM: "The claim was raised later than policy allows after the trip's to date (Approval Matrix: late claim after).",
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
    "A local conveyance mode this employee's impact level isn't eligible for (for example a hired taxi or a premium cab).",
  MODE_DEVIATION:
    'The mode of travel selected deviates from what policy permits for this employee/route.',
  DAY_VISIT_EXTERNAL_MEETING:
    'Expense is being claimed for a day visit / external meeting outside standard travel policy parameters.',
  POLICY_EXCEPTION_GENERAL:
    'An expense category with no dedicated policy rule exceeded its cap.',
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
