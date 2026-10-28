import { ArrowLeftRight, Clock, Info, ListOrdered, Pause, Plane, Play, Plus, Timer, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { CLAIM_STAGE, TRAVEL_MODES, TRAVEL_STATUS, allRows } from '../../components/reports/statusPalette';
import { TipBody, useFloatingTip } from '../../components/ui/FloatingTip';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';

/*
 * Compliance reports: run one of the four server reports (GET reports/{type}), download it, or
 * have it emailed on a schedule. The page offers the period (each report by its own date) and the
 * employee level; the server refuses a filter a report can't apply (expense category, for these).
 */

const REPORTS = {
  'claim-aging': {
    name: 'Claims by stage',
    what: 'How many submitted claims are at each stage, up to paid. Drafts are left out.',
    icon: ListOrdered,
    dateField: 'claim created',
  },
  'approval-tat': {
    name: 'Claim approval speed',
    what: 'How long each claim approval stage takes, against its SLA.',
    icon: Timer,
    dateField: 'claim submitted',
  },
  'travel-spend-summary': {
    name: 'Travel spend by mode',
    what: 'What booked trips cost, by flight, train and bus.',
    icon: Plane,
    dateField: 'of travel',
  },
  'travel-requests-summary': {
    name: 'Travel requests by status',
    what: 'How many travel requests are in each status.',
    icon: ArrowLeftRight,
    dateField: 'requested',
  },
};
const PERIODS = [
  ['all', 'All time'],
  ['month', 'This month'],
  ['3m', 'Last 3 months'],
  ['year', 'This year'],
  ['custom', 'Custom'],
];
const FREQUENCY = { DAILY: 'Every day', WEEKLY: 'Every week', MONTHLY: 'Every month' };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const inr0 = (v) => `₹${Math.round(Number(v || 0)).toLocaleString('en-IN')}`;
const share = (v, total) => `${(total ? (v / total) * 100 : 0).toFixed(1)}%`;
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "4 min", "10.5 h", "2.1 days" */
function duration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return 'under a minute';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 48 * 3600) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} days`;
}
/** An SLA length: whole days when it is whole days ("2 days"), else hours. */
function slaLength(seconds) {
  if (seconds == null) return '—';
  if (seconds % 86400 === 0) return plural(seconds / 86400, 'day');
  return `${Math.round(seconds / 3600)} h`;
}

/** The server filters for a report: its dates (only if it takes dates) and the level. */
function reportParams(reportKey, period, from, to, level) {
  const params = {};
  if (REPORTS[reportKey].dateField) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const start = { month: new Date(y, m, 1), '3m': new Date(y, m - 2, 1), year: new Date(y, 0, 1) }[period];
    if (start) params.from_date = isoDay(start);
    if (period === 'custom') {
      if (from) params.from_date = from;
      if (to) params.to_date = to;
    }
  }
  if (level) params.employee_level = level;
  return params;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const card = 'overflow-hidden rounded-[14px] border border-slate-200 bg-white';
const selectBox = (on) =>
  `inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-bold text-slate-500 ${on ? 'border-brand bg-brand/[0.04]' : 'border-slate-200 bg-white'}`;
const selectInput = 'max-w-[200px] bg-transparent text-[12.5px] font-semibold text-ink outline-none';

function Tiles({ tiles }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-[14px] border border-slate-200 bg-white px-3.5 py-3">
          <div className="text-[11.5px] font-bold text-slate-500">{t.label}</div>
          <div className={`mt-[3px] text-xl font-semibold ${t.mono ? 'font-mono tabular-nums' : ''} ${t.tone === 'ok' ? 'text-emerald-700' : t.tone === 'rose' ? 'text-rose-700' : 'text-ink'}`}>
            {t.value}
          </div>
          <div className="mt-0.5 text-[11.5px] text-slate-500">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function CardHead({ title, sub, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 px-4 py-[13px]">
      <div>
        <h2 className="text-sm font-extrabold text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** One card: colour · name · bar · figure · share, every row listed, total at the bottom. */
function BreakdownCard({ title, nameHead, valueHead, rows, money, noun, tip }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(...rows.map((r) => r.value), 1);
  const fmt = (v) => (money ? inr0(v) : String(v));
  const grid = 'grid grid-cols-[minmax(0,1fr)_72px_56px] items-center gap-x-3.5 gap-y-1.5 px-4 sm:grid-cols-[180px_minmax(0,1fr)_96px_70px]';
  return (
    <section className={card} aria-label={title}>
      <CardHead title={title} sub={`Every ${nameHead.toLowerCase()}, 0 when empty · hover a row`} />
      <div className={`${grid} border-b border-slate-200 bg-slate-50 py-[9px] text-[11px] font-bold text-slate-500`}>
        <span>{nameHead}</span>
        <span className="hidden sm:block" />
        <span className="text-right">{valueHead}</span>
        <span className="text-right">Share</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.key}
          className={`${grid} cursor-default border-t border-slate-100 py-2.5 text-[12.5px] first-of-type:border-t-0 hover:bg-[#fbfdfc]`}
          {...tip.bind(
            <TipBody title={r.label} amount={money ? inr0(r.value) : plural(r.value, noun)} line={`${share(r.value, total)} of ${money ? 'travel spend' : 'all'}`} />,
          )}
        >
          <span className="flex min-w-0 items-center gap-2 text-slate-700">
            <i className="inline-block h-[9px] w-[9px] flex-none rounded-[3px]" style={{ background: r.color }} />
            <span className="truncate">{r.label}</span>
          </span>
          <span className="order-last col-span-3 h-2.5 overflow-hidden rounded-full bg-slate-100 sm:order-none sm:col-span-1">
            {r.value ? <i className="block h-full rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color }} /> : null}
          </span>
          <span className={`text-right font-mono tabular-nums ${r.value ? 'font-semibold text-ink' : 'text-slate-400'}`}>{fmt(r.value)}</span>
          <span className={`text-right ${r.value ? 'text-slate-700' : 'text-slate-400'}`}>{share(r.value, total)}</span>
        </div>
      ))}
      <div className={`${grid} border-t border-slate-200 bg-slate-50 py-2.5 text-[12.5px] font-extrabold text-ink`}>
        <span>Total</span>
        <span className="hidden sm:block" />
        <span className="text-right font-mono tabular-nums">{fmt(total)}</span>
        <span className="text-right">100%</span>
      </div>
    </section>
  );
}

function ApprovalSpeed({ rows, tip }) {
  const decisions = rows.reduce((s, r) => s + (r.decisions || 0), 0);
  const onTime = rows.reduce((s, r) => s + (r.within_sla || 0), 0);
  const passedOn = rows.reduce((s, r) => s + (r.passed_on_after_sla || 0), 0);
  const timed = rows.filter((r) => r.average_taken_seconds != null);
  const slowest = timed.length ? timed.reduce((a, b) => (b.average_taken_seconds > a.average_taken_seconds ? b : a)) : null;
  const grid =
    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 px-4 lg:grid-cols-[170px_minmax(0,1fr)_84px_96px_76px_84px]';
  return (
    <>
      <Tiles
        tiles={[
          { label: 'Decisions', value: decisions, sub: `across ${plural(rows.length, 'stage')}` },
          {
            label: 'Slowest stage',
            value: slowest ? slowest.stage : '—',
            sub: slowest ? `${duration(slowest.average_taken_seconds)} on average · SLA ${slaLength(slowest.sla_seconds)}` : 'no decisions yet',
          },
          {
            label: 'Decided within the SLA',
            value: `${onTime} of ${decisions}`,
            tone: decisions && onTime === decisions && !passedOn ? 'ok' : onTime < decisions || passedOn ? 'rose' : undefined,
            sub: passedOn ? `${plural(passedOn, 'stage')} passed on after missing the SLA` : 'none passed on after missing the SLA',
          },
        ]}
      />
      <section className={card} aria-label="Claim approval speed">
        <CardHead title="Claim approval speed" sub="Average time each stage takes to decide · the bar shows how much of its SLA that uses" />
        <div className={`${grid} hidden border-b border-slate-200 bg-slate-50 py-[9px] text-[11px] font-bold text-slate-500 lg:grid`}>
          <span>Stage</span>
          <span>Time taken, against the SLA</span>
          <span className="text-right">Decisions</span>
          <span className="text-right">Average time</span>
          <span className="text-right">SLA</span>
          <span className="text-right">On time</span>
        </div>
        {rows.length ? (
          rows.map((r) => {
            const used = r.sla_seconds ? (r.average_taken_seconds || 0) / r.sla_seconds : 0;
            const late = used > 1 || (r.decisions && r.within_sla < r.decisions);
            return (
              <div
                key={r.stage}
                className={`${grid} cursor-default border-t border-slate-100 py-2.5 text-[12.5px] first-of-type:border-t-0 hover:bg-[#fbfdfc]`}
                {...tip.bind(
                  <TipBody
                    title={r.stage}
                    amount={duration(r.average_taken_seconds)}
                    line={`on average · ${(used * 100).toFixed(1)}% of its ${slaLength(r.sla_seconds)} SLA`}
                    note={`${r.within_sla} of ${plural(r.decisions, 'decision')} on time${r.passed_on_after_sla ? ` · ${r.passed_on_after_sla} passed on after the SLA` : ''}`}
                  />,
                )}
              >
                <span className="font-semibold text-ink">{r.stage}</span>
                <span className="text-right font-mono text-[12px] tabular-nums text-slate-700 lg:hidden">
                  {duration(r.average_taken_seconds)} · SLA {slaLength(r.sla_seconds)}
                </span>
                <span className="relative col-span-2 h-2.5 rounded-full bg-slate-100 lg:col-span-1">
                  <i
                    className={`absolute inset-y-0 left-0 rounded-full ${late ? 'bg-rose-600' : 'bg-emerald-600'}`}
                    style={{ width: `${Math.max(used ? 1.5 : 0, Math.min(used, 1) * 100)}%` }}
                  />
                </span>
                <span className="hidden text-right font-mono tabular-nums text-slate-700 lg:block">{r.decisions}</span>
                <span className="hidden text-right font-mono font-semibold tabular-nums text-ink lg:block">{duration(r.average_taken_seconds)}</span>
                <span className="hidden text-right text-slate-700 lg:block">{slaLength(r.sla_seconds)}</span>
                <span className="col-span-2 text-left lg:col-span-1 lg:text-right">
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      late ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {r.within_sla} of {r.decisions}
                  </span>
                  {r.passed_on_after_sla ? <span className="ml-1.5 text-[11px] font-semibold text-orange-700">+{r.passed_on_after_sla} passed on</span> : null}
                </span>
              </div>
            );
          })
        ) : (
          <p className="px-4 py-8 text-center text-[12.5px] text-slate-500">No claim approval decisions yet.</p>
        )}
      </section>
    </>
  );
}

/** The server's message — a plain string, or the first field error of a 422. */
function apiError(e, fallback) {
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '');
  return fallback;
}

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null);

/** One schedule: pause / resume it, or delete it (asks first, right in the row). */
function ScheduleRow({ schedule: s, onChanged }) {
  const { showToast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (call, done) => {
    setBusy(true);
    try {
      await call();
      showToast(done, 'success');
      onChanged();
    } catch (e) {
      showToast(apiError(e, 'Could not change the schedule'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const btn = 'inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[11.5px] font-bold disabled:opacity-50';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 border-t border-slate-100 px-4 py-[13px] first-of-type:border-t-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <b className="text-[13.5px] text-ink">{REPORTS[s.report_type]?.name || s.report_type}</b>
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700">{FREQUENCY[s.frequency] || s.frequency}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{s.report_format}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {s.is_active ? 'Active' : 'Paused'}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          Last sent {when(s.last_run_at) || 'never'} · {s.is_active ? `next ${when(s.next_run_at) || '—'}` : 'not sending while paused'}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(s.recipients || []).map((r) => (
            <span key={r} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11.5px] font-semibold text-slate-700">
              {r}
            </span>
          ))}
        </div>
      </div>
      {confirmDelete ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5" role="group" aria-label="Confirm delete">
          <span className="text-xs font-semibold text-slate-600">Delete this schedule?</span>
          <button type="button" disabled={busy} className={`${btn} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`} onClick={() => run(() => reimbursementApi.deleteReportSchedule(s.id), 'Schedule deleted')}>
            <Trash2 size={13} /> Delete
          </button>
          <button type="button" disabled={busy} className={`${btn} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`} onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={busy}
            className={`${btn} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
            onClick={() => run(() => reimbursementApi.setReportScheduleActive(s.id, !s.is_active), s.is_active ? 'Schedule paused' : 'Schedule resumed')}
          >
            {s.is_active ? <Pause size={13} /> : <Play size={13} />}
            {s.is_active ? 'Pause' : 'Resume'}
          </button>
          <button type="button" disabled={busy} aria-label="Delete schedule" className={`${btn} border-slate-200 bg-white text-rose-700 hover:bg-rose-50`} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

function ScheduleModal({ open, defaults, levelLabel, onClose, onSaved }) {
  const { showToast } = useToast();
  const [form, setForm] = useState(defaults);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  useBodyScrollLock(open);
  useEffect(() => {
    if (open) {
      setForm(defaults);
      setDraft('');
    }
  }, [open, defaults]);
  if (!open) return null;
  const addEmail = () => {
    const value = draft.trim().replace(/,$/, '');
    if (!value) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      showToast(`"${value}" doesn't look like an email address`, 'error');
      return;
    }
    if (!form.recipients.includes(value)) setForm((f) => ({ ...f, recipients: [...f.recipients, value] }));
    setDraft('');
  };
  const save = async () => {
    const recipients = [...form.recipients];
    const pending = draft.trim();
    if (pending) recipients.push(pending);
    if (!recipients.length) {
      showToast('Add at least one email to send it to', 'error');
      return;
    }
    setSaving(true);
    try {
      await reimbursementApi.createReportSchedule({
        report_type: form.report,
        report_format: 'CSV',
        frequency: form.frequency,
        recipients,
        filters: form.filtersFor(form.report),
      });
      showToast('Schedule saved', 'success');
      onSaved();
    } catch (e) {
      showToast(apiError(e, 'Could not save the schedule'), 'error');
    } finally {
      setSaving(false);
    }
  };
  const chosen = REPORTS[form.report];
  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/45 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="New schedule" className="w-full max-w-[560px] overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-[13px]">
          <div>
            <h3 className="text-sm font-extrabold text-ink">New schedule</h3>
            <p className="mt-0.5 text-xs text-slate-500">We&apos;ll email the report as a CSV attachment.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-3.5 px-4 py-3.5">
          <div>
            <span className="mb-1.5 block text-xs font-bold text-slate-700">Which report</span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {Object.entries(REPORTS).map(([key, r]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={form.report === key}
                  onClick={() => setForm((f) => ({ ...f, report: key }))}
                  className={`rounded-[10px] border px-2.5 py-2 text-left text-[12.5px] font-bold text-ink ${
                    form.report === key ? 'border-brand bg-brand/[0.05] ring-1 ring-brand' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-xs font-bold text-slate-700">How often</span>
            <div role="group" aria-label="How often" className="inline-flex flex-wrap gap-0.5 rounded-[10px] bg-slate-100 p-[3px]">
              {Object.entries(FREQUENCY).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={form.frequency === key}
                  onClick={() => setForm((f) => ({ ...f, frequency: key }))}
                  className={`rounded-[7px] px-2.5 py-[5px] text-xs font-bold ${form.frequency === key ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="schedule-email" className="mb-1.5 block text-xs font-bold text-slate-700">
              Send to
            </label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-slate-200 px-2 py-1.5 focus-within:border-brand">
              {form.recipients.map((email) => (
                <span key={email} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-[11.5px] font-semibold text-slate-700">
                  {email}
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    onClick={() => setForm((f) => ({ ...f, recipients: f.recipients.filter((x) => x !== email) }))}
                    className="grid h-4 w-4 place-items-center rounded-full text-slate-400 hover:text-rose-600"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                id="schedule-email"
                className="min-w-[180px] flex-1 bg-transparent text-[13px] text-ink outline-none"
                placeholder="Add an email, then Enter"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addEmail();
                  }
                }}
                onBlur={addEmail}
              />
            </div>
          </div>
          <p className="text-[11.5px] text-slate-500">
            Uses the filters set now: {chosen.dateField ? form.periodLabel : 'all time'} · {levelLabel}.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <button type="button" onClick={onClose} className="h-[34px] rounded-[10px] border border-slate-200 bg-white px-3.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className="h-[34px] rounded-[10px] bg-brand px-3.5 text-[12.5px] font-bold text-white hover:bg-brand/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function ReportsPage() {
  useSetPageTitle('Reports');
  const { showToast } = useToast();
  const tip = useFloatingTip();
  const [tab, setTab] = useState('run');
  const [reportKey, setReportKey] = useState('claim-aging');
  const [period, setPeriod] = useState('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [level, setLevel] = useState('');
  const [levels, setLevels] = useState(null);
  const [result, setResult] = useState({ loading: true, rows: [], error: null });
  const [schedules, setSchedules] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);

  const params = useMemo(() => reportParams(reportKey, period, custom.from, custom.to, level), [reportKey, period, custom.from, custom.to, level]);
  const paramsKey = JSON.stringify(params);

  // Level choices come from the report filter options (anyone who can view reports); if that
  // ever fails, the level is typed instead.
  useEffect(() => {
    reimbursementApi
      .reportFilterOptions()
      .then((r) => setLevels((r.data?.impact_levels || []).map((l) => [l.code, l.name])))
      .catch(() => setLevels([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResult((r) => ({ ...r, loading: true, error: null }));
    reimbursementApi
      .reportRun(reportKey, params)
      .then((res) => !cancelled && setResult({ loading: false, rows: res.data?.rows || [], error: null }))
      .catch((e) => !cancelled && setResult({ loading: false, rows: [], error: e?.response?.data?.detail || 'Could not run the report' }));
    return () => {
      cancelled = true;
    };
    // paramsKey stands for params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey, paramsKey]);

  const loadSchedules = useCallback(() => {
    reimbursementApi
      .reportSchedules()
      .then((r) => setSchedules(r.data || []))
      .catch(() => setSchedules([]));
  }, []);
  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const exportAs = async (format) => {
    const call = { csv: reimbursementApi.reportExportCsv, xlsx: reimbursementApi.reportExportXlsx, pdf: reimbursementApi.reportExportPdf }[format];
    const type = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' }[format];
    try {
      const res = await call(reportKey, params);
      download(new Blob([res.data], { type }), `${reportKey}.${format}`);
    } catch {
      showToast('Could not download the report', 'error');
    }
  };

  const report = REPORTS[reportKey];
  const periodLabel =
    period === 'custom' ? (custom.from || custom.to ? `${custom.from || '…'} to ${custom.to || 'today'}` : 'all time') : PERIODS.find(([k]) => k === period)?.[1];
  const levelLabel = level ? `level ${level}` : 'all levels';
  const scheduleDefaults = useMemo(
    () => ({
      report: reportKey,
      frequency: 'WEEKLY',
      recipients: [],
      periodLabel: periodLabel.toLowerCase(),
      filtersFor: (key) => reportParams(key, period, custom.from, custom.to, level),
    }),
    [reportKey, periodLabel, period, custom.from, custom.to, level],
  );

  const rows = result.rows;
  let body = null;
  if (reportKey === 'approval-tat') {
    body = <ApprovalSpeed rows={rows} tip={tip} />;
  } else {
    const config = {
      'claim-aging': { data: allRows(rows, 'stage', 'count', CLAIM_STAGE, ['DRAFT']), nameHead: 'Stage', valueHead: 'Count', noun: 'claim' },
      'travel-requests-summary': { data: allRows(rows, 'status', 'count', TRAVEL_STATUS), nameHead: 'Status', valueHead: 'Count', noun: 'request' },
      'travel-spend-summary': { data: allRows(rows, 'travel_mode', 'spend', TRAVEL_MODES), nameHead: 'Mode', valueHead: 'Spend', noun: 'mode', money: true },
    }[reportKey];
    const data = config.data;
    const total = data.reduce((s, r) => s + r.value, 0);
    const top = data[0];
    const sumOf = (keys) => data.filter((r) => keys.includes(r.key)).reduce((s, r) => s + r.value, 0);
    const tiles =
      reportKey === 'travel-spend-summary'
        ? [
            { label: 'Travel spend', value: inr0(total), sub: 'on booked trips', mono: true },
            { label: 'Biggest mode', value: top?.value ? top.label : '—', sub: top?.value ? `${inr0(top.value)} · ${share(top.value, total)}` : 'nothing booked' },
            {
              label: 'Modes used',
              value: `${data.filter((r) => r.value).length} of ${data.length}`,
              sub: data.some((r) => !r.value) ? `${data.filter((r) => !r.value).map((r) => r.label).join(', ')} not used` : 'every mode used',
            },
          ]
        : [
            { label: reportKey === 'claim-aging' ? 'Claims' : 'Travel requests', value: total, sub: periodLabel.toLowerCase() },
            { label: 'Most are', value: top?.value ? top.label : '—', sub: top?.value ? `${plural(top.value, config.noun)} · ${share(top.value, total)}` : '—' },
            reportKey === 'claim-aging'
              ? { label: 'Still open', value: total - sumOf(['PAID', 'REJECTED']), sub: 'not paid or rejected yet' }
              : { label: 'Waiting', value: sumOf(['PENDING', 'PENDING_EXCEPTION']), sub: 'awaiting approval or exception review' },
          ];
    body = (
      <>
        <Tiles tiles={tiles} />
        <BreakdownCard title={report.name} nameHead={config.nameHead} valueHead={config.valueHead} rows={data} money={config.money} noun={config.noun} tip={tip} />
      </>
    );
  }

  return (
    <section className="flex flex-col gap-3.5">
      <div>
        <h1 className="text-xl font-extrabold text-ink">Compliance reports</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">Run a report, download it, or have it emailed on a schedule.</p>
      </div>

      <div role="tablist" aria-label="Reports" className="flex gap-0.5 border-b border-slate-200">
        {[
          ['run', 'Run a report', null],
          ['scheduled', 'Scheduled', schedules.length],
        ].map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-[9px] text-[12.5px] font-bold ${tab === key ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {label}
            {count != null ? (
              <span className={`rounded-full px-[7px] py-px text-[10.5px] ${tab === key ? 'bg-brand/10 text-brand' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'run' ? (
        <>
          <div role="group" aria-label="Report" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(REPORTS).map(([key, r]) => {
              const Icon = r.icon;
              const on = reportKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setReportKey(key)}
                  className={`flex flex-col gap-1 rounded-[14px] border px-3.5 py-3 text-left ${on ? 'border-brand bg-[#f4faf7] ring-1 ring-brand' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <span className="mb-1 grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-brand/10 text-brand">
                    <Icon size={15} />
                  </span>
                  <b className="text-[13.5px] text-ink">{r.name}</b>
                  <span className="text-xs leading-snug text-slate-500">{r.what}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {report.dateField ? (
                <>
                  <div role="group" aria-label="Period" className="inline-flex flex-wrap gap-0.5 rounded-[10px] bg-slate-100 p-[3px]">
                    {PERIODS.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={period === key}
                        onClick={() => setPeriod(key)}
                        className={`rounded-[7px] px-2.5 py-[5px] text-xs font-bold ${period === key ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {period === 'custom' ? (
                    <>
                      <label className={selectBox(true)}>
                        From
                        <input type="date" className={selectInput} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                      </label>
                      <label className={selectBox(true)}>
                        To
                        <input type="date" className={selectInput} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                      </label>
                    </>
                  ) : null}
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <Info size={13} /> This report always covers all time.
                </span>
              )}
              <label className={selectBox(level)}>
                Employee level
                {levels && levels.length ? (
                  <select className={selectInput} value={level} onChange={(e) => setLevel(e.target.value)}>
                    <option value="">All levels</option>
                    {levels.map(([code, name]) => (
                      <option key={code} value={code}>
                        {code}
                        {name && name !== code ? ` · ${name}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={`${selectInput} w-[90px]`}
                    placeholder="e.g. L6C"
                    defaultValue={level}
                    onBlur={(e) => setLevel(e.target.value.trim())}
                    onKeyDown={(e) => e.key === 'Enter' && setLevel(e.currentTarget.value.trim())}
                  />
                )}
              </label>
              {report.dateField ? <span className="text-xs text-slate-500">by date {report.dateField}</span> : null}
            </div>
            <div className="inline-flex overflow-hidden rounded-[10px] border border-slate-200">
              <span className="grid place-items-center border-r border-slate-200 bg-slate-50 px-2.5 text-[11.5px] font-bold text-slate-500">Download</span>
              {[
                ['csv', 'CSV'],
                ['xlsx', 'Excel'],
                ['pdf', 'PDF'],
              ].map(([format, label]) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => exportAs(format)}
                  className="border-r border-slate-200 bg-white px-2.5 py-[7px] text-xs font-bold text-slate-700 last:border-r-0 hover:bg-slate-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {result.error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[13px] text-amber-900">{result.error}</div> : null}
          {result.loading && !rows.length ? (
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <Clock className="animate-spin text-slate-400" size={15} /> Running the report…
            </div>
          ) : (
            body
          )}
        </>
      ) : (
        <section className={card} aria-label="Scheduled reports">
          <CardHead
            title="Reports emailed on a schedule"
            sub="Each one goes out as a CSV attachment"
            action={
              <button type="button" onClick={() => setModalOpen(true)} className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] bg-brand px-3.5 text-[12.5px] font-bold text-white hover:bg-brand/90">
                <Plus size={14} /> New schedule
              </button>
            }
          />
          {schedules.length ? (
            schedules.map((s) => <ScheduleRow key={s.id} schedule={s} onChanged={loadSchedules} />)
          ) : (
            <p className="px-4 py-8 text-center text-[12.5px] text-slate-500">No scheduled reports yet.</p>
          )}
        </section>
      )}

      <ScheduleModal
        open={modalOpen}
        defaults={scheduleDefaults}
        levelLabel={levelLabel}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          loadSchedules();
        }}
      />
      {tip.node}
    </section>
  );
}
