import { ChevronRight, ClipboardList, Plane, Truck } from 'lucide-react';

import { slaRemaining } from '../approvals/ApprovalDetail';
import { formatDate } from '../../utils/formatters';

/*
 * One compact line per claim — type icon, reference and what it is, where it stands in plain
 * words with a slim progress bar, and the amount. Used by My Claims, Team Claims and the employee
 * dashboard so a claim reads the same everywhere.
 */

const inr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CATEGORY = {
  TRAVEL: { icon: Plane, cls: 'bg-sky-50 text-sky-700' },
  GENERAL: { icon: ClipboardList, cls: 'bg-indigo-50 text-indigo-700' },
  RELOCATION: { icon: Truck, cls: 'bg-fuchsia-50 text-fuchsia-700' },
};

const PILL = {
  ok: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  slate: 'bg-slate-100 text-slate-500',
};

export function describeClaim(claim) {
  if (claim.reimbursement_category === 'GENERAL') {
    const n = claim.invoice_ids?.length || 0;
    return `General reimbursement${n ? ` · ${n} invoice${n > 1 ? 's' : ''}` : ''}`;
  }
  if (claim.reimbursement_category === 'RELOCATION') {
    const route = [claim.from_city, claim.destination_city].filter(Boolean).join(' → ');
    return route ? `Relocation · ${route}` : 'Relocation';
  }
  const route = [claim.office_location || claim.from_city, claim.destination_city].filter(Boolean).join(' → ');
  const dates =
    claim.departure_date && claim.return_date ? `${formatDate(claim.departure_date)} – ${formatDate(claim.return_date)}` : null;
  return [route || 'Trip details pending', dates, claim.trip_purpose].filter(Boolean).join(' · ');
}

/** Where a claim stands: `group` (action / draft / progress / paid / done, for tabs and
 * sorting), a pill tone + label, a short note, and the progress bar ([stages, done]).
 * `viewer` = 'employee' (their own claim) or 'approver' (someone else's — e.g. a manager's team). */
export function claimStanding(claim, chain, sentBack, viewer = 'employee') {
  const stages = chain?.stages || [];
  const total = stages.length;
  const done = stages.filter((s) => ['APPROVED', 'SLA_SKIPPED', 'SKIPPED_OWN'].includes(s.status)).length;
  const pending = stages.find((s) => s.status === 'PENDING');
  switch (claim.status) {
    case 'DRAFT':
      return { group: 'draft', tone: 'slate', pill: 'Draft', note: `Started ${formatDate(claim.created_at)}`, bar: null };
    case 'SENT_BACK':
      return {
        group: 'action',
        tone: 'rose',
        pill: 'Sent back',
        note: sentBack?.comment
          ? `“${sentBack.comment}”${sentBack.actor ? ` · ${sentBack.actor}` : ''}`
          : viewer === 'employee'
            ? 'Fix it and resubmit'
            : 'Waiting for the employee to resubmit',
        bar: total ? [total, done] : null,
      };
    case 'PENDING_EXCEPTION':
      return { group: 'progress', tone: 'amber', pill: 'Exception review', note: 'Waiting on policy exception approval', bar: null };
    case 'IN_APPROVAL': {
      const left = pending ? slaRemaining(pending.sla_deadline_at) : null;
      return {
        group: 'progress',
        tone: 'amber',
        pill: 'In approval',
        note: pending
          ? `${pending.label}${left ? ` · ${left === 'SLA Breached' ? 'SLA passed' : `${left} left`}` : ''}`
          : 'Waiting on approval',
        bar: total ? [total, done] : null,
      };
    }
    case 'READY_FOR_PAYMENT':
      return {
        group: 'progress',
        tone: 'amber',
        pill: 'Approved',
        note: 'Waiting for payment',
        bar: total ? [total, Math.max(done, total - 1)] : null,
      };
    case 'PAID':
      return {
        group: 'paid',
        tone: 'ok',
        pill: 'Paid',
        note: claim.payment_recorded_at ? formatDate(claim.payment_recorded_at) : '',
        bar: total ? [total, total] : null,
      };
    case 'REJECTED':
      return { group: 'done', tone: 'rose', pill: 'Rejected', note: claim.reject_reason || '', bar: null };
    default: {
      const label = String(claim.status || '').replace(/_/g, ' ').toLowerCase();
      return { group: 'progress', tone: 'slate', pill: label.charAt(0).toUpperCase() + label.slice(1), note: '', bar: null };
    }
  }
}

export function ClaimProgressBar({ bar }) {
  if (!bar) return null;
  const [total, done] = bar;
  return (
    <div
      className="grid max-w-[180px] grid-flow-col gap-[3px]"
      style={{ gridAutoColumns: '1fr' }}
      aria-label={`${done} of ${total} stages done`}
    >
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={`h-1 rounded-full ${i < done ? 'bg-emerald-400' : i === done ? 'bg-amber-400' : 'bg-slate-200'}`} />
      ))}
    </div>
  );
}

/**
 * The row itself. `standing` comes from claimStanding; `onOpen` runs when the row is clicked or
 * Enter is pressed; `actions` (optional) replaces the chevron with row buttons (they should stop
 * click propagation); `prefix` goes before the description (e.g. the employee's name).
 * `compact` keeps the stacked two-line layout at every width, for narrow spots like a dashboard card.
 */
export function ClaimListRow({ claim, standing, onOpen, actions = null, prefix = null, compact = false }) {
  const wide = (cls) => (compact ? '' : cls);
  const { tone, pill, note, bar, group } = standing;
  const cat = CATEGORY[claim.reimbursement_category] || CATEGORY.TRAVEL;
  const Icon = cat.icon;
  const report = claim.compliance_report || {};
  const total = Number(report.total_claimed || 0);
  const net = report.net_payable != null ? Number(report.net_payable) : total;
  const ref = claim.claim_reference || `Claim #${claim.id}`;
  const description = [prefix, describeClaim(claim)].filter(Boolean).join(' · ');

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      aria-label={`${ref}: ${pill}`}
      className={`grid cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 border-t border-slate-100 px-4 py-3 transition-colors first:border-t-0 hover:bg-[#fbfdfc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${wide('md:grid-cols-[36px_minmax(0,1.5fr)_minmax(0,1.25fr)_130px_124px]')} ${
        group === 'action' ? 'bg-rose-50/30' : ''
      }`}
    >
      <div className={`row-span-2 flex h-9 w-9 items-center justify-center self-start rounded-[10px] ${wide('md:row-span-1 md:self-center')} ${cat.cls}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className="text-[13.5px] font-extrabold text-ink">{ref}</div>
        <div className="truncate text-xs text-slate-500" title={description}>
          {description}
        </div>
      </div>
      <div className={`order-last col-span-2 flex min-w-0 flex-col gap-1.5 ${wide('md:order-none md:col-span-1')}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${PILL[tone]}`}>{pill}</span>
          {note ? (
            <span className="truncate text-xs text-slate-500" title={note}>
              {note}
            </span>
          ) : null}
        </div>
        <ClaimProgressBar bar={bar} />
      </div>
      <div className="text-right">
        <div className="font-mono text-[13.5px] font-semibold text-ink">{inr(total)}</div>
        {Math.abs(net - total) > 0.004 ? <div className="text-[11px] font-semibold text-slate-500">Net {inr(net)}</div> : null}
      </div>
      {actions ? (
        <div className={`order-last col-span-2 flex justify-start gap-1.5 ${wide('md:order-none md:col-span-1 md:justify-end')}`}>{actions}</div>
      ) : (
        <ChevronRight size={16} className={`hidden justify-self-end text-slate-300 ${wide('md:block')}`} aria-hidden="true" />
      )}
    </div>
  );
}
