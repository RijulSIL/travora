import { formatDatetime, formatRole } from '../../utils/formatters';

/*
 * The policy exceptions on a claim (approval-chain `exceptions`), one row each: claimed vs cap,
 * the employee's reason, where it stands, and each approver's decision on it — accepted (by whom),
 * sent back with their comment, or rejected with the reason. Used on the claim page and in the
 * claim review window.
 */

const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const DECISION = {
  ACCEPTED: ['Accepted', 'bg-emerald-50 text-emerald-700'],
  REJECTED: ['Rejected', 'bg-rose-50 text-rose-700'],
  SENT_BACK: ['Sent back', 'bg-orange-50 text-orange-700'],
};

export function ExceptionStatusPill({ exception }) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset';
  if (exception.status === 'APPROVED') return <span className={`${base} bg-emerald-50 text-emerald-700 ring-emerald-200`}>Approved</span>;
  if (exception.status === 'REJECTED') return <span className={`${base} bg-rose-50 text-rose-700 ring-rose-200`}>Rejected</span>;
  if (exception.status === 'SENT_BACK') return <span className={`${base} bg-orange-50 text-orange-700 ring-orange-200`}>Sent back</span>;
  if (exception.status === 'CANCELLED') return <span className={`${base} bg-slate-100 text-slate-500 ring-slate-200`}>Closed</span>;
  const who = exception.waiting_on_names?.length ? exception.waiting_on_names.join(', ') : formatRole(exception.waiting_on_role || '');
  const acceptedSoFar = (exception.decisions || []).some((d) => d.decision === 'ACCEPTED');
  return (
    <span className={`${base} bg-amber-50 text-amber-800 ring-amber-200`}>
      {who ? `Pending · ${who}` : acceptedSoFar ? 'Accepted so far' : 'Pending'}
    </span>
  );
}

export function ExceptionDecisions({ exception }) {
  const decisions = (exception.decisions || []).filter((d) => DECISION[d.decision]);
  if (!decisions.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {decisions.map((d, i) => {
        const [word, cls] = DECISION[d.decision];
        return (
          <li key={`${d.exception_approval_id}-${i}`} className="text-[11.5px] leading-snug text-slate-600">
            <span className={`mr-1.5 inline-flex rounded-full px-1.5 py-px text-[10px] font-bold ${cls}`}>{word}</span>
            by {d.decided_by_name || formatRole(d.required_role)}
            {d.required_role ? ` (${formatRole(d.required_role)})` : ''}
            {d.decided_at ? ` · ${formatDatetime(d.decided_at)}` : ''}
            {d.comment ? <span className="mt-0.5 block break-words italic text-slate-500">&ldquo;{d.comment}&rdquo;</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function ClaimExceptionList({ exceptions }) {
  return (
    <div className="divide-y divide-slate-100 bg-white">
      {exceptions.map((exc) => {
        const over = exc.cap_amount != null ? Number(exc.claimed_amount || 0) - Number(exc.cap_amount) : null;
        return (
          <div key={exc.item_id ?? `req-${exc.exception_request_id}`} className="space-y-1.5 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700">
                {exc.category_name || exc.exception_type_label}
                {exc.claimed_amount != null ? (
                  <span className="ml-1.5 font-mono text-xs font-medium text-slate-500">{inr(exc.claimed_amount)}</span>
                ) : null}
                {exc.cap_amount != null ? (
                  <span className="ml-1.5 text-[11px] font-medium text-slate-500">
                    cap {inr(exc.cap_amount)}
                    {over > 0 ? <span className="ml-1 font-bold text-rose-700">{inr(over)} over</span> : null}
                  </span>
                ) : null}
              </span>
              <ExceptionStatusPill exception={exc} />
            </div>
            {exc.category_name ? <p className="m-0 text-[11px] font-medium text-slate-500">{exc.exception_type_label}</p> : null}
            {exc.reason ? (
              <p className="m-0 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs leading-relaxed text-slate-700">
                <span className="font-semibold text-slate-500">Reason: </span>
                {exc.reason}
              </p>
            ) : null}
            <ExceptionDecisions exception={exc} />
            {!exc.decisions?.length && exc.status === 'REJECTED' && exc.decision_comment ? (
              <p className="m-0 text-[11px] font-medium text-rose-700">Rejected: {exc.decision_comment}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
