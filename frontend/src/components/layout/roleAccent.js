// Avatar colour per role — shared by the top bar and the sidebar so both profile chips match.
export const ROLE_ACCENT = {
  EMPLOYEE: 'bg-blue-500',
  REPORTING_MANAGER: 'bg-amber-500',
  HRBP_HR: 'bg-purple-500',
  PAYROLL: 'bg-orange-500',
  FINANCE: 'bg-green-500',
  IT_ADMIN: 'bg-red-500',
  CEO: 'bg-indigo-500',
  GROUP_HEAD_HR: 'bg-purple-500',
  RECRUITER: 'bg-teal-500',
  ADMIN: 'bg-rose-500',
};

export const roleAccent = (role) => ROLE_ACCENT[role] || 'bg-slate-400';

// Light tint + matching text, for a role label chip.
const ROLE_CHIP = {
  EMPLOYEE: 'bg-blue-50 text-blue-700',
  REPORTING_MANAGER: 'bg-amber-50 text-amber-700',
  HRBP_HR: 'bg-purple-50 text-purple-700',
  PAYROLL: 'bg-orange-50 text-orange-700',
  FINANCE: 'bg-green-50 text-green-700',
  IT_ADMIN: 'bg-red-50 text-red-700',
  CEO: 'bg-indigo-50 text-indigo-700',
  GROUP_HEAD_HR: 'bg-purple-50 text-purple-700',
  RECRUITER: 'bg-teal-50 text-teal-700',
  ADMIN: 'bg-rose-50 text-rose-700',
};

export const roleChip = (role) => ROLE_CHIP[role] || 'bg-slate-100 text-slate-600';
