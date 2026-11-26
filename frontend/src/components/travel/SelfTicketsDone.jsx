import { AlertTriangle, ArrowRight, Info, Receipt, Ticket, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import AnimatedCheck from '../ui/AnimatedCheck';
import { formatCurrency, formatWeekdayDate } from '../../utils/formatters';
import { claimEditPath } from '../../utils/claimRoutes';
import { MODE_ICON } from './TravelRequestFormParts';
import { plainAmount } from './selfTickets';

/*
 * Shown in the ticket upload dialog once the tickets are submitted: the tick, what was booked
 * (each leg with its booking reference and fare), and — when they ticked "Submit these fares for
 * reimbursement" — what happened to that claim: sent for approval, kept as a draft (and why), or
 * not made. Done (or ✕ / Escape) closes it and refreshes the list behind.
 */

// The text after the tick rises in just behind it.
const CSS = `
@keyframes st-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.st-rise { animation: st-rise .38s cubic-bezier(.16,1,.3,1) both; }
@media (prefers-reduced-motion: reduce) { .st-rise { animation: none; } }
`;
const rise = (ms) => ({ animationDelay: `${ms}ms` });

const rupees = (value) => {
  const n = Number(plainAmount(value));
  return Number.isFinite(n) ? formatCurrency(n) : '—';
};

const CLAIM_LOOK = {
  submitted: { tone: 'border-emerald-200 bg-emerald-50/70', icon: 'bg-white text-emerald-700', Icon: Receipt, title: 'Fares claimed' },
  draft: { tone: 'border-amber-200 bg-amber-50', icon: 'bg-white text-amber-700', Icon: AlertTriangle, title: 'Claim saved as a draft' },
  not_created: { tone: 'border-slate-200 bg-slate-50', icon: 'bg-white text-slate-500', Icon: Info, title: 'No claim was created' },
};

function ClaimOutcome({ claim, onLeave }) {
  const look = CLAIM_LOOK[claim.status] || CLAIM_LOOK.not_created;
  const link =
    claim.claim_id && claim.status === 'submitted'
      ? { to: `/claims/${claim.claim_id}`, text: 'View claim' }
      : claim.claim_id && claim.status === 'draft'
        ? { to: claimEditPath({ id: claim.claim_id, reimbursement_category: 'TRAVEL' }), text: 'Finish the draft' }
        : null;
  return (
    <div className={`flex items-start gap-3 rounded-[14px] border p-3.5 ${look.tone}`}>
      <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg ${look.icon}`}>
        <look.Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <b className="block text-[13px] text-ink">{look.title}</b>
        <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600">{claim.message}</p>
        {link ? (
          <Link
            to={link.to}
            onClick={onLeave}
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-brand hover:underline"
          >
            {link.text} <ArrowRight size={13} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default function SelfTicketsDone({ request, segments, tickets, claim, onDone }) {
  const doneRef = useRef(null);
  useEffect(() => {
    doneRef.current?.focus();
  }, []);

  return (
    <>
      <style>{CSS}</style>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-8 sm:px-[22px]">
        <button
          type="button"
          aria-label="Close"
          onClick={onDone}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={18} />
        </button>

        <div className="flex flex-col items-center text-center" role="status">
          <AnimatedCheck size={68} className="text-brand" />
          <h2 id="self-ticket-done-title" className="st-rise mt-4 text-[19px] font-extrabold leading-tight text-ink" style={rise(650)}>
            Your trip is booked
          </h2>
          <p className="st-rise mt-1.5 max-w-[420px] text-[12.5px] leading-relaxed text-slate-500" style={rise(720)}>
            Your tickets are saved and HR has been told they&apos;re in.
            {claim ? null : ' Claim the fares on a travel claim after you travel.'}
          </p>
        </div>

        <ul className="st-rise mt-5 divide-y divide-slate-100 rounded-[14px] border border-slate-200 bg-white" style={rise(800)} aria-label="Booked legs">
          {segments.map((seg) => {
            const t = tickets[seg.seq] || {};
            const mode = seg.mode || request.travel_mode;
            const Icon = MODE_ICON[mode] || Ticket;
            return (
              <li key={seg.seq} className="flex items-center gap-3 px-3.5 py-3">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-sky-50 text-sky-700">
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[13px] font-extrabold text-ink">
                    {seg.from_city} → {seg.to_city}
                  </b>
                  <span className="mt-0.5 flex flex-wrap gap-x-1 text-[11.5px] text-slate-500">
                    {[seg.travel_date ? formatWeekdayDate(seg.travel_date) : null, t.provider || null]
                      .filter(Boolean)
                      .map((part, i, all) => (
                        <span key={part} className="whitespace-nowrap">
                          {part}
                          {i < all.length - 1 ? ' ·' : ''}
                        </span>
                      ))}
                  </span>
                </div>
                <div className="flex-none text-right">
                  <b className="block text-[13px] font-extrabold tabular-nums text-ink">{rupees(t.amount)}</b>
                  <span className="font-mono text-[11px] uppercase tracking-wide text-slate-500">{t.pnr}</span>
                </div>
              </li>
            );
          })}
        </ul>

        {claim ? (
          <div className="st-rise mt-3" style={rise(880)}>
            <ClaimOutcome claim={claim} onLeave={onDone} />
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 justify-end border-t border-slate-100 bg-white px-4 py-3 sm:px-[22px]">
        <button ref={doneRef} type="button" className="btn-primary w-full sm:w-auto sm:min-w-[120px]" onClick={onDone}>
          Done
        </button>
      </div>
    </>
  );
}
