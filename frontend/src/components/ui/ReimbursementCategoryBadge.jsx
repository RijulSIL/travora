export const REIMBURSEMENT_CATEGORY_LABELS = {
  TRAVEL: 'Travel',
  GENERAL: 'General',
  REALLOCATION: 'Reallocation',
};

const REIMBURSEMENT_CATEGORY_STYLES = {
  TRAVEL: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  GENERAL: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  REALLOCATION: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20',
};

/** Single source of truth for how a ReimbursementCategory value renders — mirrors
 * ClaimStatusBadge so category and status read consistently everywhere a claim or
 * invoice shows up. Defaults to Travel for anything unset/unrecognized, matching the
 * backend's default for pre-existing rows. */
export default function ReimbursementCategoryBadge({ category, className = '' }) {
  const key = category || 'TRAVEL';
  const style = REIMBURSEMENT_CATEGORY_STYLES[key] || REIMBURSEMENT_CATEGORY_STYLES.TRAVEL;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${style} ${className}`}
    >
      {REIMBURSEMENT_CATEGORY_LABELS[key] || key}
    </span>
  );
}
