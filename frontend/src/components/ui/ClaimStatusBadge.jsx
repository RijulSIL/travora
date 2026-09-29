export const CLAIM_STATUS_LABELS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_APPROVAL: 'In Approval',
  PENDING_EXCEPTION: 'Pending Exception',
  SENT_BACK: 'Sent Back',
  READY_FOR_PAYMENT: 'Ready for Payment',
  PAID: 'Paid',
  REJECTED: 'Rejected',
  ON_HOLD: 'On Hold',
};

const CLAIM_STATUS_STYLES = {
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  SUBMITTED: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  IN_APPROVAL: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  PENDING_EXCEPTION: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  SENT_BACK: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  READY_FOR_PAYMENT: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  PAID: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  REJECTED: 'bg-red-50 text-red-700 ring-red-600/20',
  ON_HOLD: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

/** Single source of truth for how a ClaimStatus value renders — reused across every
 * claims list/detail view so the same status always looks the same everywhere. */
export default function ClaimStatusBadge({ status, className = '' }) {
  const style = CLAIM_STATUS_STYLES[status] || CLAIM_STATUS_STYLES.DRAFT;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${style} ${className}`}
    >
      {CLAIM_STATUS_LABELS[status] || status}
    </span>
  );
}
