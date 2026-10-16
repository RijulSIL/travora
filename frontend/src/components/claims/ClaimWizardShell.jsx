import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Info, MapPin } from 'lucide-react';

/** ₹12,345.67 */
export function inr(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "GBP 453.6" — the original currency, kept in the extraction note when an invoice was converted to ₹. */
export function foreignAmount(invoice) {
  const match = /\(([A-Z]{3}) ([\d.,]+)\)/.exec(invoice?.extraction_error || '');
  if (!match) return null;
  return `${match[1]} ${Number(match[2].replace(/,/g, '')).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** "14 Oct" */
export function dayMonth(value) {
  return value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
}

/** "14 – 16 Oct 2026" style span, or one date. */
export function dateSpan(start, end) {
  if (!start) return '';
  const fmt = (v, withYear) =>
    new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  if (!end || String(end).slice(0, 10) === String(start).slice(0, 10)) return fmt(start, true);
  return `${fmt(start, false)} – ${fmt(end, true)}`;
}

export const FIELD =
  'h-[38px] w-full rounded-[10px] border bg-white px-[11px] text-[13px] text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15';
export const fieldClass = (hasError) => `${FIELD} ${hasError ? 'border-rose-300' : 'border-slate-200'}`;
export const LABEL = 'mb-[5px] block text-xs font-bold text-slate-700';
export const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400';

const NOTE_TONES = {
  amber: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: AlertTriangle, iconClass: 'text-amber-700' },
  rose: { box: 'border-rose-200 bg-rose-50 text-rose-900', icon: AlertTriangle, iconClass: 'text-rose-600' },
  ok: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: CheckCircle2, iconClass: 'text-emerald-700' },
  sky: { box: 'border-sky-200 bg-sky-50 text-sky-900', icon: MapPin, iconClass: 'text-sky-700' },
  slate: { box: 'border-slate-200 bg-slate-50 text-slate-700', icon: Info, iconClass: 'text-slate-500' },
};

/** A coloured one- or two-line message: bold title, plain text under it. */
export function Note({ tone = 'slate', title, children, icon }) {
  const t = NOTE_TONES[tone] || NOTE_TONES.slate;
  const Icon = icon || t.icon;
  return (
    <div className={`flex items-start gap-2 rounded-[10px] border px-[11px] py-[9px] text-xs ${t.box}`}>
      <Icon size={15} className={`mt-px shrink-0 ${t.iconClass}`} />
      <div className="min-w-0">
        {title ? <b className="block text-[12.5px]">{title}</b> : null}
        {children}
      </div>
    </div>
  );
}

export function Card({ title, sub, action, children, bodyClass = 'space-y-3.5' }) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 px-4 py-[13px]">
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-ink">{title}</h2>
            {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={`px-4 py-3.5 ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** Back / Next bar under a step. */
export function StepActions({ onBack, onNext, nextLabel, nextIcon, nextDisabled = false, busy = false, busyLabel = 'Saving…', title }) {
  return (
    <div className="flex items-center justify-between gap-2.5 rounded-[14px] border border-slate-200 bg-white px-4 py-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-3.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={14} /> Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || busy}
        title={title}
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-brand px-3.5 text-[12.5px] font-bold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {nextIcon || null}
        {busy ? busyLabel : nextLabel}
        {!nextIcon && !busy ? <ArrowRight size={14} /> : null}
      </button>
    </div>
  );
}

/** Title, step pills (done steps can be clicked to go back), then the step beside the claim summary. */
export default function ClaimWizardShell({ title, sub, steps, current, onStepClick, aside, children }) {
  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">{title}</h1>
          {sub ? <p className="mt-0.5 text-[13px] text-slate-500">{sub}</p> : null}
        </div>
        <ol className="flex flex-wrap gap-1.5" aria-label="Steps">
          {steps.map((label, i) => {
            const n = i + 1;
            const done = n < current;
            const on = n === current;
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={!done}
                  aria-current={on ? 'step' : undefined}
                  onClick={() => done && onStepClick?.(n)}
                  className={`inline-flex items-center gap-[7px] rounded-full border py-[5px] pl-1.5 pr-3 text-xs font-bold ${
                    on
                      ? 'border-brand bg-brand/10 text-brand'
                      : done
                        ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        : 'cursor-default border-slate-200 bg-white text-slate-400'
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 place-items-center rounded-full text-[10.5px] font-extrabold ${
                      on ? 'bg-brand text-white' : done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {done ? <Check size={11} strokeWidth={3} /> : n}
                  </span>
                  {label}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className={aside ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]' : ''}>
        <div className="flex min-w-0 flex-col gap-3">{children}</div>
        {aside ? <aside className="flex flex-col gap-3 lg:sticky lg:top-20">{aside}</aside> : null}
      </div>
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-2.5 text-[12.5px]">
      <span className="shrink-0 text-slate-500">{label}</span>
      <b className="min-w-0 text-right text-ink">{children}</b>
    </div>
  );
}

/**
 * "Your claim" — what's on the claim so far.
 * policy: null (not checked yet) or { over, blocked, approved } counts.
 */
export function ClaimSummaryCard({ trip, bookings, invoiceCount, invoiceTotal, policyStep, policy, advance, payable }) {
  const checked = policy != null;
  return (
    <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white" aria-label="Your claim">
      <div className="border-b border-slate-100 px-4 py-[13px]">
        <h2 className="text-sm font-extrabold text-ink">Your claim</h2>
        <p className="mt-0.5 text-xs text-slate-500">Updates as you go</p>
      </div>
      <div className="space-y-2.5 px-4 py-3.5">
        {trip !== undefined ? (
          <Row label="Trip">
            {trip ? (
              <>
                {trip.route}
                {trip.dates ? <span className="block font-medium text-slate-500">{trip.dates}</span> : null}
              </>
            ) : (
              <span className="font-medium text-slate-400">Not filled in yet</span>
            )}
          </Row>
        ) : null}
        {bookings !== undefined ? <Row label="Bookings">{bookings || <span className="font-medium text-slate-400">None</span>}</Row> : null}
        <Row label="Invoices">
          {invoiceCount} · <span className="font-mono tabular-nums">{inr(invoiceTotal)}</span>
        </Row>
        <Row label="Policy">
          {!checked ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Checked at step {policyStep}</span>
          ) : policy.blocked ? (
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">{policy.blocked} not allowed</span>
          ) : policy.over ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
              {policy.over} need{policy.over === 1 ? 's' : ''} an exception
            </span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
              {policy.approved ? 'Exceptions in place' : 'All within policy'}
            </span>
          )}
        </Row>
        {Number(advance) > 0 ? (
          <Row label="Advance received">
            <span className="font-mono tabular-nums">− {inr(advance)}</span>
          </Row>
        ) : null}
        <div className="flex items-baseline justify-between gap-2.5 border-t border-dashed border-slate-200 pt-2.5">
          <span className="text-[12.5px] font-bold text-ink">{checked ? "You'll be paid" : 'Bills total'}</span>
          <b className="font-mono text-lg tabular-nums text-brand">{inr(checked ? payable : invoiceTotal)}</b>
        </div>
      </div>
    </section>
  );
}

/** Policy counts for the summary, from the policy-checked claim's expenses. */
export function policyCounts(claim) {
  const expenses = claim?.expenses || [];
  const needing = expenses.filter((e) => e.exception_reason_required);
  return {
    blocked: needing.filter((e) => e.exception_mode === 'BLOCK').length,
    over: needing.filter((e) => e.exception_mode !== 'BLOCK').length,
    approved: expenses.some((e) => e.exception_type && !e.exception_reason_required),
  };
}

/** Net payable from a policy-checked claim — the policy-check response's own figure first (it's
 * merged over the saved draft), then the draft's stored compliance report. */
export function netPayable(claim) {
  return claim?.net_payable ?? claim?.compliance_report?.net_payable ?? 0;
}
