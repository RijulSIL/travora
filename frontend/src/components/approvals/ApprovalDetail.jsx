import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/*
 * Shared building blocks for every approval detail view (Pending Approvals rows, Exception
 * Requests, the claim review window): three columns — what's being asked, the approval route as
 * a timeline, and the approver's decision. First built for relocation requests; the same look is
 * used everywhere an approver opens a request.
 */

export const EYEBROW = 'text-[10.5px] font-bold uppercase tracking-[0.07em] text-slate-400';

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'The employee';
}

/** "in 7 days" / "tomorrow" / "today" / "3 days ago". */
export function daysFromToday(isoDate) {
  if (!isoDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const days = Math.round((target - today) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** The three-column frame. Pass `columns` to override the grid template (e.g. a wider first column). */
export function ApprovalDetailGrid({ children, columns = 'grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]', className = '' }) {
  return (
    <div className={`grid ${columns} overflow-hidden rounded-[14px] border border-slate-200 bg-white ${className}`}>
      {children}
    </div>
  );
}

export function DetailColumn({ title, label, first = false, children, className = '' }) {
  return (
    <section
      className={`flex min-w-0 flex-col gap-3.5 px-5 py-[18px] ${first ? '' : 'border-l border-slate-100'} ${className}`}
      aria-label={label || title}
    >
      {title ? <div className={EYEBROW}>{title}</div> : null}
      {children}
    </section>
  );
}

export function Fact({ label, value, hint }) {
  return (
    <div className="min-w-0 rounded-[10px] bg-slate-50 px-3 py-2.5">
      <div className="text-[10.5px] font-semibold text-slate-500">{label}</div>
      <div className="mt-0.5 break-words text-[13.5px] font-extrabold tabular-nums text-ink">{value}</div>
      {hint ? <div className="text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function FactGrid({ facts, cols = 3 }) {
  const shown = facts.filter((f) => f && f.value != null && f.value !== '');
  if (!shown.length) return null;
  return (
    <div className={`grid gap-2 ${cols === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
      {shown.map((f) => (
        <Fact key={f.label} label={f.label} value={f.value} hint={f.hint} />
      ))}
    </div>
  );
}

/** From → To drawn once, with an icon on a dashed track. */
export function Journey({ from, to, icon: Icon }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
      <div className="min-w-0">
        <div className={EYEBROW}>From</div>
        <div className="mt-0.5 text-[17px] font-extrabold text-ink">{from || '—'}</div>
      </div>
      <div className="relative h-[26px]" aria-hidden="true">
        <span className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-brand/30" />
        {Icon ? (
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-1.5 text-brand">
            <Icon size={20} />
          </span>
        ) : null}
      </div>
      <div className="min-w-0 text-right">
        <div className={EYEBROW}>To</div>
        <div className="mt-0.5 text-[17px] font-extrabold text-ink">{to || '—'}</div>
      </div>
    </div>
  );
}

/** A quoted note (the employee's notes / reason); "No notes" when empty. */
export function Quote({ title, text, empty = 'No notes' }) {
  return (
    <div>
      {title ? <div className={`${EYEBROW} mb-1.5`}>{title}</div> : null}
      {text ? (
        <p className="m-0 whitespace-pre-wrap break-words border-l-[3px] border-brand/30 py-0.5 pl-3 text-[13px] leading-relaxed text-slate-700">
          {text}
        </p>
      ) : (
        <p className="m-0 border-l-[3px] border-slate-200 py-0.5 pl-3 text-[13px] italic text-slate-400">{empty}</p>
      )}
    </div>
  );
}

function StepDot({ state }) {
  if (state === 'done') {
    return (
      <span className="z-[1] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-emerald-700">
        <Check size={12} strokeWidth={4} className="text-white" />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className="z-[1] flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-amber-600 bg-white ring-4 ring-amber-50">
        <span className="h-2 w-2 rounded-full bg-amber-600" />
      </span>
    );
  }
  if (state === 'rejected') {
    return <span className="z-[1] h-[22px] w-[22px] rounded-full border-2 border-rose-600 bg-rose-50" />;
  }
  return (
    <span
      className={`z-[1] h-[22px] w-[22px] rounded-full border-2 bg-slate-100 ${
        state === 'skipped' || state === 'cancelled' ? 'border-dashed border-slate-300' : 'border-slate-200'
      }`}
    />
  );
}

/**
 * Vertical route timeline. items: [{ key, state: 'done'|'current'|'skipped'|'rejected'|'cancelled'|'todo',
 * title, sub, detail }] — `detail` is an approver's comment, shown quoted.
 */
export function RouteTimeline({ items }) {
  return (
    <ol className="m-0 list-none p-0">
      {items.map((item, i) => (
        <li key={item.key} className={`relative grid grid-cols-[22px_1fr] gap-2.5 ${i < items.length - 1 ? 'pb-3.5' : ''}`}>
          {i < items.length - 1 ? (
            <span
              className={`absolute bottom-0 left-[10px] top-[22px] w-0.5 ${item.state === 'done' ? 'bg-emerald-200' : 'bg-slate-200'}`}
              aria-hidden="true"
            />
          ) : null}
          <StepDot state={item.state} />
          <div className="min-w-0">
            <div
              className={`text-[12.5px] font-bold ${
                item.state === 'skipped' || item.state === 'cancelled' ? 'text-slate-500 line-through' : 'text-ink'
              }`}
            >
              {item.title}
            </div>
            {item.sub ? <div className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{item.sub}</div> : null}
            {item.detail ? (
              <div className="mt-0.5 break-words text-[11.5px] italic leading-snug text-slate-500">&ldquo;{item.detail}&rdquo;</div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** "Waiting on you · 42h 26m left on the SLA" — the sub-line for the stage this viewer decides. */
export function waitingOnYou(slaLeft) {
  if (!slaLeft) return 'Waiting on you';
  return (
    <>
      Waiting on you ·{' '}
      <b className="text-amber-700">{slaLeft === 'SLA Breached' ? 'SLA breached' : `${slaLeft} left on the SLA`}</b>
    </>
  );
}

/** Live "Xh Ym" until a deadline (or "SLA Breached"). */
export function slaRemaining(deadline, now = Date.now()) {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - now;
  if (Number.isNaN(diff)) return null;
  if (diff <= 0) return 'SLA Breached';
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hrs}h ${mins}m`;
}

export function OutcomeBox({ ok, children }) {
  return (
    <div
      className={`rounded-[10px] border px-3.5 py-3 text-[12.5px] font-semibold leading-relaxed ${
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
      }`}
    >
      {children}
    </div>
  );
}

export function NoticeBox({ tone = 'slate', title, children }) {
  const tones = {
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    orange: 'border-orange-200 bg-orange-50 text-orange-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
  return (
    <div className={`rounded-[10px] border px-3.5 py-3 text-[12px] leading-relaxed ${tones[tone] || tones.slate}`}>
      {title ? <p className="m-0 mb-0.5 font-bold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

const BTN_BASE = 'inline-flex h-[38px] items-center gap-1.5 rounded-[9px] border px-4 text-[12.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The decision column body: a comment box right next to a solid Approve; "Reject…" turns the
 * box into a required reason (Reject request / Cancel) — never a browser pop-up. Once decided,
 * `decided` ({ ok, text }) replaces it with the outcome.
 *
 * `extraAction` ({ label, icon, onClick, needsComment, title }) adds a secondary button such as
 * Send Back. `rejectMode`/`onRejectModeChange` may be controlled by the parent (so a row's own
 * Reject button can open the box straight in reject mode); otherwise it's kept here.
 */
export function DecisionBox({
  idPrefix,
  name,
  comment,
  onCommentChange,
  rejectMode: rejectModeProp,
  onRejectModeChange,
  busy = false,
  decided = null,
  onApprove,
  onReject,
  approveLabel = 'Approve',
  rejectLabel = 'Reject request',
  hint,
  extraAction,
  commentPlaceholder = 'e.g. Checked with the hiring manager',
  reasonPlaceholder = 'Explain why, so they can act on it',
}) {
  const textareaRef = useRef(null);
  const [rejectModeLocal, setRejectModeLocal] = useState(false);
  const [showReasonError, setShowReasonError] = useState(false);
  const rejecting = rejectModeProp ?? rejectModeLocal;
  const setRejecting = (value) => {
    if (onRejectModeChange) onRejectModeChange(value);
    else setRejectModeLocal(value);
  };
  const who = firstName(name);

  useEffect(() => {
    setShowReasonError(false);
    if (rejecting) textareaRef.current?.focus();
  }, [rejecting]);

  if (decided) return <OutcomeBox ok={decided.ok}>{decided.text}</OutcomeBox>;

  const confirmReject = () => {
    if (!comment.trim()) {
      setShowReasonError(true);
      textareaRef.current?.focus();
      return;
    }
    onReject(comment.trim());
  };

  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-comment`} className="mb-1.5 block text-[11.5px] font-bold text-ink">
          {rejecting ? 'Reason for rejecting ' : 'Comment '}
          <span className="font-medium text-slate-500">
            {rejecting ? `(required, sent to ${who})` : '(optional, kept in the audit trail)'}
          </span>
        </label>
        <textarea
          id={`${idPrefix}-comment`}
          ref={textareaRef}
          className={`min-h-[84px] w-full resize-y rounded-[10px] border bg-white px-3 py-2 text-[13px] text-ink outline-none transition-shadow ${
            rejecting
              ? 'border-rose-200 focus:border-rose-600 focus:ring-[3px] focus:ring-rose-600/10'
              : 'border-slate-200 focus:border-brand focus:ring-[3px] focus:ring-brand/10'
          }`}
          maxLength={2000}
          placeholder={rejecting ? reasonPlaceholder : commentPlaceholder}
          value={comment}
          onChange={(e) => {
            onCommentChange(e.target.value);
            if (showReasonError && e.target.value.trim()) setShowReasonError(false);
          }}
        />
        {showReasonError ? (
          <p className="mt-1 text-[11.5px] font-semibold text-rose-700">Give a reason so {who} knows why it was rejected.</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {rejecting ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={confirmReject}
              className={`${BTN_BASE} border-rose-700 bg-rose-700 text-white hover:bg-rose-800`}
            >
              {busy ? 'Rejecting…' : rejectLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(false)}
              className={`${BTN_BASE} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onApprove}
              className={`${BTN_BASE} border-brand bg-brand text-white hover:bg-brand/90`}
            >
              <Check size={14} /> {busy ? 'Working…' : approveLabel}
            </button>
            {extraAction ? (
              <button
                type="button"
                disabled={busy || (extraAction.needsComment && !comment.trim())}
                title={extraAction.needsComment && !comment.trim() ? extraAction.title : undefined}
                onClick={extraAction.onClick}
                className={`${BTN_BASE} border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}
              >
                {extraAction.icon ? <extraAction.icon size={14} /> : null}
                {extraAction.label}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(true)}
              className={`${BTN_BASE} border-rose-200 bg-white text-rose-700 hover:bg-rose-50`}
            >
              Reject…
            </button>
          </>
        )}
      </div>
      {hint ? <p className="m-0 text-[11.5px] leading-relaxed text-slate-500">{hint}</p> : null}
    </>
  );
}
