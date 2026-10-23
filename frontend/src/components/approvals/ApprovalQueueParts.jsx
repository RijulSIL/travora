import { ArrowLeftRight, ArrowRight, Bus, Check, ChevronDown, Plane, SkipForward, TrainFront, X } from 'lucide-react';

import { Link } from 'react-router-dom';

import { formatExceptionType, formatRole } from '../../utils/formatters';
import { dayOf, daysBetween, today } from '../home/HomeParts';
import { travelRef } from '../travel/travelRequestView';

/*
 * Pieces shared by the approver queues (Pending approvals, Exception requests): the page header
 * with its counters, the tab strip, button-group filters, and one row per waiting item.
 */

const MODE_ICON = { FLIGHT: Plane, TRAIN: TrainFront, BUS: Bus };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const PILL = {
  ok: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  slate: 'bg-slate-100 text-slate-500',
  sky: 'bg-sky-50 text-sky-700',
  violet: 'bg-violet-50 text-violet-700',
  orange: 'bg-orange-50 text-orange-700',
  brand: 'bg-brand/10 text-brand',
};

export function Pill({ tone = 'slate', children, title, wrap = false }) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${wrap ? 'rounded-lg' : 'whitespace-nowrap'} ${PILL[tone] || PILL.slate}`}
    >
      {children}
    </span>
  );
}

export const inr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const shortDay = (value) => {
  const d = dayOf(value);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : '';
};

/** "today", "yesterday", "3 days ago" for a timestamp. */
export function ago(value) {
  const d = dayOf(value);
  if (!d) return '';
  const n = daysBetween(d, today());
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

/** Time to an SLA deadline: { over, text, hours } ("3h 20m", "1d 4h"), or null with no deadline. */
export function slaLeft(deadline, now = Date.now()) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / 3600000);
  const text = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${Math.floor((abs % 3600000) / 60000)}m`;
  return { over: ms <= 0, text, hours };
}

/** The coloured SLA block a claim row starts with. bucket: breached | warning | ok | pending (server's). */
export function SlaBlock({ deadline, bucket, now }) {
  const left = slaLeft(deadline, now);
  const over = left ? left.over : bucket === 'breached';
  const tone = over ? 'rose' : bucket === 'warning' ? 'amber' : left ? 'ok' : 'slate';
  const cls = { rose: 'bg-rose-50 text-rose-700', amber: 'bg-amber-50 text-amber-700', ok: 'bg-emerald-50 text-emerald-700', slate: 'bg-slate-100 text-slate-500' }[tone];
  return (
    <div className={`rounded-[10px] px-[9px] py-[7px] ${cls}`}>
      <b className="block text-[12.5px]">{over ? 'Past SLA' : left ? `${left.text} left` : 'No SLA'}</b>
      <span className="text-[11px] font-semibold">{over ? (left ? `by ${left.text}` : 'Overdue') : tone === 'amber' ? 'Due soon' : left ? 'On time' : '—'}</span>
    </div>
  );
}

/** Calendar box for a date; amber when it has already passed. */
export function DateBox({ value }) {
  const d = dayOf(value);
  if (!d) return <span />;
  const past = d < today();
  return (
    <div className={`w-[52px] flex-none overflow-hidden rounded-[10px] border bg-white text-center ${past ? 'border-amber-200' : 'border-slate-200'}`}>
      <div className={`py-0.5 text-[10px] font-extrabold uppercase tracking-[0.05em] ${past ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
        {MONTHS[d.getMonth()]}
      </div>
      <div className="pt-0.5 text-[17px] font-extrabold leading-tight text-ink">{d.getDate()}</div>
      <div className="pb-[3px] text-[10px] font-bold text-slate-500">{WEEKDAYS[d.getDay()]}</div>
    </div>
  );
}

/** Cities joined by arrows, each arrow carrying the mode of the leg it stands for. */
export function RouteLine({ stops, modes = [], roundTrip = false }) {
  if (roundTrip) {
    const Icon = MODE_ICON[modes[0]] || Plane;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span>{stops[0]}</span>
        <span className="inline-flex items-center gap-0.5 text-slate-400">
          <ArrowLeftRight size={11} />
          <Icon size={12} />
        </span>
        <span>{stops[1]}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {stops.map((city, i) => {
        const Icon = MODE_ICON[modes[i - 1]];
        return (
          <span key={`${city}-${i}`} className="inline-flex items-center gap-1.5">
            {i ? (
              <span className="inline-flex items-center gap-0.5 text-slate-400">
                <ArrowRight size={11} />
                {Icon ? <Icon size={12} /> : null}
              </span>
            ) : null}
            <span>{city || '…'}</span>
          </span>
        );
      })}
    </span>
  );
}

/** Route, kind label and first/last date of a travel request (or the travel_request on an exception). */
export function travelShape(request) {
  const legs = (request?.legs?.length ? request.legs : request?.segments) || [];
  if (request?.trip_type === 'MULTI_CITY' && legs.length) {
    const sorted = [...legs].sort((a, b) => String(a.travel_date || '').localeCompare(String(b.travel_date || '')));
    return {
      stops: [sorted[0].from_city, ...sorted.map((l) => l.to_city)],
      modes: sorted.map((l) => l.travel_mode || request.travel_mode),
      roundTrip: false,
      kind: `Multi-city · ${legs.length} legs`,
      first: sorted[0].travel_date,
      last: sorted[sorted.length - 1].travel_date,
    };
  }
  const roundTrip = request?.trip_type === 'ROUND_TRIP';
  return {
    stops: [request?.from_city, request?.to_city],
    modes: [request?.travel_mode],
    roundTrip,
    kind: roundTrip ? 'Round trip' : 'One way',
    first: request?.travel_date,
    last: request?.return_date || request?.travel_date,
  };
}

const CHAIN_STEP = {
  APPROVED: ['bg-emerald-50 text-emerald-700', 'bg-emerald-600', '✓'],
  REJECTED: ['bg-rose-50 text-rose-700', 'bg-rose-600', '✕'],
  SLA_SKIPPED: ['bg-orange-50 text-orange-700', 'bg-orange-600', 'skip'],
  PENDING: ['bg-amber-50 text-amber-700', 'bg-amber-600', '●'],
  YOU: ['bg-brand text-white', 'bg-white text-brand', '●'],
  AWAITING: ['bg-slate-100 text-slate-500', 'bg-slate-400', ''],
};

/** The mark inside a step's circle. "●" and "skip" are drawn (a dot, the skip icon) rather than
 * typed characters, which sit off-centre on the text baseline at this size. */
export function ChainMark({ mark, size = 7 }) {
  if (mark === '●') return <span className="block rounded-full bg-current" style={{ width: size, height: size }} />;
  if (mark === 'skip') return <SkipForward size={size + 2} strokeWidth={3} aria-hidden="true" />;
  return mark;
}

/** An exception's approvers in order: done, skipped on SLA, deciding now (you, when it's your step), still to come. */
export function ApprovalChain({ decisions, yourTurn = false }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {decisions.map((d, i) => {
        const you = yourTurn && d.status === 'PENDING';
        const [pill, dot, mark] = CHAIN_STEP[you ? 'YOU' : d.status] || CHAIN_STEP.AWAITING;
        const title =
          d.status === 'APPROVED'
            ? `Approved${d.acted_by_name ? ` by ${d.acted_by_name}` : ''}`
            : d.status === 'REJECTED'
              ? `Rejected${d.acted_by_name ? ` by ${d.acted_by_name}` : ''}`
              : d.status === 'SLA_SKIPPED'
                ? 'Missed its SLA, passed on'
                : d.status === 'PENDING'
                  ? 'Deciding now'
                  : 'Still to come';
        return (
          <span key={`${d.required_role}-${i}`} className="inline-flex items-center gap-1">
            {i ? <span className="text-[11px] text-slate-400">›</span> : null}
            <span title={title} className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-1 pr-2 text-[11.5px] font-bold ${pill}`}>
              <i className={`grid h-[15px] w-[15px] place-items-center rounded-full text-[9px] not-italic leading-none ${dot} ${you ? '' : 'text-white'}`}>
                <ChainMark mark={mark} />
              </i>
              {/* A step passed over on its SLA is crossed out — just the name, not the mark. */}
              <span className={d.status === 'SLA_SKIPPED' ? 'line-through' : ''}>{you ? 'You' : formatRole(d.required_role)}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** "Air Travel Unlock (Travel Request)" → "Air Travel Unlock": the row already says what it's for. */
export const shortType = (type) => formatExceptionType(type).replace(/\s*\(Travel Request\)$/, '');

/** What an exception is for: a claim expense (linked), or a travel request with its route. */
export function ExceptionSubject({ row }) {
  const tr = row.travel_request;
  if (tr) {
    const shape = travelShape(tr);
    const hasRoute = shape.stops.some(Boolean);
    return (
      <>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold text-ink">
          <span>{row.claim_ref || travelRef(tr.id)}</span>
          {hasRoute ? (
            <>
              <span className="text-slate-400">·</span>
              <RouteLine stops={shape.stops} modes={shape.modes} roundTrip={shape.roundTrip} />
            </>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          Travel request · {shape.kind}
          {shape.first ? ` · ${shortDay(shape.first)}` : ''}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="text-[13px] font-bold">
        {row.claim_id ? (
          <Link to={`/claims/${row.claim_id}`} className="text-brand hover:underline">
            {row.claim_ref} ↗
          </Link>
        ) : (
          <span className="text-ink">{row.claim_ref || '—'}</span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-slate-500">
        {row.expense_category_name || 'Claim expense'}
        {row.claimed_amount ? (
          <>
            {' · '}
            <b className="font-mono font-semibold tabular-nums text-ink">{inr(row.claimed_amount)}</b>
          </>
        ) : null}
      </div>
    </>
  );
}

export function PassedOverNote({ stages }) {
  if (!stages?.length) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-700">
      <SkipForward size={11} className="shrink-0" /> {stages.join(', ')} missed SLA: passed to you
    </span>
  );
}

export function DecidedPill({ decision }) {
  if (!decision) return null;
  return (
    <Pill tone={decision.ok ? 'ok' : 'rose'}>
      {decision.ok ? <Check size={11} /> : <X size={11} />} {decision.pill}
    </Pill>
  );
}

export function PageHead({ title, sub, stats }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-extrabold text-ink">{title}</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">{sub}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {stats.map((s) => (
          <div key={s.label} className="min-w-[96px] rounded-xl border border-slate-200 bg-white px-3 py-[7px]">
            <b className={`block text-[17px] ${s.tone === 'rose' ? 'text-rose-700' : s.tone === 'amber' ? 'text-amber-700' : 'text-ink'}`}>{s.value}</b>
            <span className="text-[11.5px] font-semibold text-slate-500">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Underlined tabs with counts. tabs: [{ key, label, count, hot }] */
export function Tabs({ label, tabs, value, onChange }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-0.5 overflow-x-auto border-b border-slate-200 [scrollbar-width:none]">
      {tabs.map((t) => {
        const on = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-[9px] text-[12.5px] font-bold ${
              on ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-[7px] py-px text-[10.5px] ${
                t.hot ? 'bg-rose-50 text-rose-700' : on ? 'bg-brand/10 text-brand' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** White button group used as a filter. options: [[value, label]] */
export function FilterButtons({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-[10px] border border-slate-200 bg-white p-[3px]">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-[7px] px-2.5 py-[5px] text-xs font-bold ${value === v ? 'bg-ink text-white' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export const BTN = 'inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-lg border px-[11px] text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45';
export const BTN_PLAIN = `${BTN} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
export const BTN_OK = `${BTN} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`;
export const BTN_NO = `${BTN} border-rose-200 bg-white text-rose-700 hover:bg-rose-50`;

/** Row grid: lead (SLA / date box) · what it is · amount or age · actions; `panel` spans the row. */
export function QueueRow({ lead, main, side, actions, panel, wideLead = false }) {
  return (
    <div className="border-t border-slate-100 px-4 py-3 first:border-t-0">
      <div
        className={`grid items-center gap-x-3.5 gap-y-2.5 ${
          wideLead
            ? 'grid-cols-[92px_minmax(0,1fr)] lg:grid-cols-[104px_minmax(0,1fr)_150px_auto]'
            : 'grid-cols-[52px_minmax(0,1fr)] lg:grid-cols-[52px_minmax(0,1fr)_150px_auto]'
        }`}
      >
        {lead}
        <div className="min-w-0">{main}</div>
        <div className="col-start-2 lg:col-start-auto lg:text-right">{side}</div>
        <div className="col-span-2 flex flex-wrap gap-1.5 lg:col-span-1 lg:justify-end">{actions}</div>
      </div>
      {panel ? <div className="mt-2.5">{panel}</div> : null}
    </div>
  );
}

export function RowTitle({ children }) {
  return <div className="flex flex-wrap items-center gap-[7px] text-[13.5px] font-bold text-ink">{children}</div>;
}

export function RowSub({ children }) {
  return <div className="mt-0.5 text-xs text-slate-500">{children}</div>;
}

export function RowChips({ children }) {
  return <div className="mt-1.5 flex flex-wrap gap-[5px]">{children}</div>;
}

export function DetailsButton({ open, onClick }) {
  return (
    <button type="button" className={BTN_PLAIN} onClick={onClick} aria-expanded={open}>
      {open ? 'Hide' : 'Details'}
      <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}
