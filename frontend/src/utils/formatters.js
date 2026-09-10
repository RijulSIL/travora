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
  AIR_TRAVEL_UNLOCK: 'Air Travel Unlock',
  AIR_TRAVEL_L5_L6: 'Air Travel (Level 5A–6D)',
  TRAIN_TATKAL: 'Tatkal Train Booking',
  FLIGHT_ADVANCE_BOOKING_OVERRIDE: 'Flight Advance Booking Override',
  FLIGHT_COST_DELTA: 'Flight Cost Delta',
  ROOM_RENT_DEVIATION: 'Room Rent Deviation',
  'HOTEL/ACCOMMODATION_DEVIATION': 'Hotel / Accommodation Deviation',
  HOTEL_DEVIATION: 'Hotel Deviation',
  ACCOMMODATION_DEVIATION: 'Accommodation Deviation',
  HIRED_TAXI_UNAUTHORIZED: 'Hired Taxi (Unauthorized)',
  MODE_DEVIATION: 'Mode of Travel Deviation',
  DAY_VISIT_EXTERNAL_MEETING: 'Day Visit External Meeting',
  POLICY_EXCEPTION_GENERAL: 'Policy Exception (General)',
};

export const formatExceptionType = (type) =>
  EXCEPTION_TYPE_LABELS[type] ||
  (type || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const formatRelative = (dateString) => {
  const diff = Date.now() - new Date(dateString).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} minutes ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
  return `${Math.floor(sec / 86400)} days ago`;
};
