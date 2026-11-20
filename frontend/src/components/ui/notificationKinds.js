import { AlertTriangle, BadgeCheck, Flag, HandCoins, IndianRupee, Info, RefreshCcw } from 'lucide-react';

import { formatDate, formatTime, formatWeekdayDate } from '../../utils/formatters';

// Label, colours and icon for each kind of notification (Notifications page and the bell panel).
export const KIND = {
  APPROVAL_REQUIRED: ['Approvals', 'bg-sky-50 text-sky-700', 'bg-sky-600', BadgeCheck],
  CLAIM_UPDATE: ['Claims & travel', 'bg-brand/10 text-brand', 'bg-brand', RefreshCcw],
  PAYMENT: ['Payments', 'bg-emerald-50 text-emerald-700', 'bg-emerald-600', IndianRupee],
  SLA_BREACH: ['Overdue', 'bg-rose-50 text-rose-700', 'bg-rose-600', AlertTriangle],
  EXCEPTION: ['Exceptions', 'bg-violet-50 text-violet-700', 'bg-violet-600', Flag],
  ADVANCE: ['Advances', 'bg-amber-50 text-amber-700', 'bg-amber-600', HandCoins],
  SYSTEM: ['System', 'bg-slate-100 text-slate-600', 'bg-slate-500', Info],
};
export const kindOf = (category) => KIND[category] || KIND.SYSTEM;

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** "Today", "Yesterday", "Thu, 15/10/2026", or "02/10/2026" once it's a week or more back. */
export function dayLabel(date, now) {
  const diff = Math.round((dayStart(now) - dayStart(date)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return diff < 7 ? formatWeekdayDate(date) : formatDate(date);
}
export const timeOf = (d) => formatTime(d);
