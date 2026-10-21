import { Check, Eye, EyeOff, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { roleAccent, roleChip } from '../components/layout/roleAccent';
import { Pill } from '../components/approvals/ApprovalQueueParts';
import { BTN_GHOST, BTN_MAIN, BTN_NO, CARD, CardHead, FIELD, LABEL } from '../components/policy/PolicyAdminParts';
import { useSetPageTitle } from '../context/PageTitleContext';
import useToast from '../hooks/useToast';
import api from '../services/api';
import { reimbursementApi } from '../services/reimbursementApi';
import { useAuthStore } from '../store/authStore';
import { formatRole } from '../utils/formatters';

const SPECIAL = /[!@#$%^&*()_+={}[\]|\\:;"'<>,.?/~`-]/;
const PASSWORD_RULES = [
  ['8+ characters', (v) => v.length >= 8, 'Password must be at least 8 characters long'],
  ['An uppercase letter', (v) => /[A-Z]/.test(v), 'Password must contain at least one uppercase letter'],
  ['A lowercase letter', (v) => /[a-z]/.test(v), 'Password must contain at least one lowercase letter'],
  ['A number', (v) => /[0-9]/.test(v), 'Password must contain at least one number'],
  ['A special character', (v) => SPECIAL.test(v), 'Password must contain at least one special character'],
];
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtDay = (v) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const errorText = (err, fallback) => err?.response?.data?.detail || fallback;
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400';

function Avatar({ name, className, size = 'h-[30px] w-[30px] text-xs' }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-extrabold text-white ${size} ${className}`}>
      {(name || 'U').trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** A password box with an eye button on the right to show or hide what's typed. */
function PasswordField({ id, value, onChange, disabled, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={visible ? 'text' : 'password'} required autoComplete={autoComplete} className={`${FIELD} pr-10`} value={value} onChange={onChange} disabled={disabled} />
      <button
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-slate-600"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function Problem({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
      {children}
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div className="border-slate-100 px-[18px] py-3 [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-t-0 sm:[&:not(:first-child)]:border-l [&:nth-child(2n)]:border-l">
      <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">{label}</dt>
      <dd className={`mt-[3px] text-[13.5px] font-bold ${value ? 'text-ink' : 'font-semibold text-slate-400'}`}>{value || 'Not set'}</dd>
    </div>
  );
}

/** Walks the org chart down to the viewer: the people above them, then them. */
function pathToViewer(node, trail = []) {
  if (node.is_viewer) return [...trail, node];
  for (const child of node.children || []) {
    const found = pathToViewer(child, [...trail, node]);
    if (found) return found;
  }
  return null;
}
const countUnder = (node) => (node.children || []).reduce((n, c) => n + 1 + countUnder(c), 0);

function ReportingLine({ roots, error, accent, roleLabel }) {
  const path = roots?.length ? pathToViewer(roots[0]) : null;
  const up = path ? path.slice(0, -1) : [];
  const you = path ? path[path.length - 1] : null;
  const reports = you?.children || [];
  return (
    <section aria-label="Reporting line" className={CARD}>
      <CardHead title="Reporting line" sub="Who you report to, and who reports to you" />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        {error ? <p className="text-[13px] text-slate-500">Couldn&apos;t load your reporting line. Try refreshing the page.</p> : null}
        {!error && roots == null ? <p className="text-[13px] text-slate-500">Loading…</p> : null}
        {!error && roots && !you ? <p className="text-[13px] text-slate-500">Your reporting line will appear once your employee record is set up.</p> : null}
        {you ? (
          <>
            <ol className="flex flex-col">
              {up.map((p, i) => (
                <li key={p.employee_id} className="relative grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 py-[7px] after:absolute after:bottom-[-7px] after:left-[14px] after:top-[37px] after:w-0.5 after:bg-slate-200">
                  <Avatar name={p.full_name} className="bg-slate-400" />
                  <span className="min-w-0">
                    <b className="block truncate text-[13px] text-ink">{p.full_name}</b>
                    <small className="block text-[11.5px] leading-snug text-slate-500">{p.department || p.designation || 'No department'}</small>
                  </span>
                  <Pill>{i === up.length - 1 ? 'Your manager' : 'Higher up'}</Pill>
                </li>
              ))}
              <li className="-mx-2 grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5 rounded-xl bg-brand/10 px-2 py-[7px]">
                <Avatar name={you.full_name} className={accent} />
                <span className="min-w-0">
                  <b className="block truncate text-[13px] text-ink">
                    {you.full_name} <span className="ml-1 text-[10px] font-extrabold uppercase tracking-[0.06em] text-brand">You</span>
                  </b>
                  <small className="block text-[11.5px] leading-snug text-slate-500">{you.department || roleLabel}</small>
                </span>
              </li>
            </ol>
            <p className={EYEBROW}>Reports to you ({reports.length})</p>
            {reports.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {reports.map((r) => {
                  const under = countUnder(r);
                  return (
                    <li key={r.employee_id} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-slate-200 px-2.5 py-2">
                      <Avatar name={r.full_name} className="bg-slate-400" />
                      <span className="min-w-0">
                        <b className="block truncate text-[12.5px] text-ink">{r.full_name}</b>
                        <small className="block text-[11.5px] leading-snug text-slate-500">
                          {r.department || r.designation || 'No department'}
                          {under ? ` · ${under} under them` : ''}
                        </small>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3.5 text-center text-[12.5px] text-slate-500">Nobody reports to you directly.</p>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

function PasswordCard({ email }) {
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [current, setCurrent] = useState('');
  const [otp, setOtp] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => {
    setStep(1);
    setCurrent('');
    setOtp('');
    setNext('');
    setAgain('');
    setError(null);
  };
  const requestCode = async (e) => {
    e.preventDefault();
    if (!current) return;
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/change-password/request-otp', { current_password: current });
      setStep(2);
      showToast('We emailed you a code', 'success');
    } catch (err) {
      setError(errorText(err, 'Failed to send OTP'));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (e) => {
    e.preventDefault();
    if (next !== again) return setError('Passwords do not match');
    const broken = PASSWORD_RULES.find(([, ok]) => !ok(next));
    if (broken) return setError(broken[2]);
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/change-password/confirm', { otp_code: otp, new_password: next });
      showToast('Password changed successfully', 'success');
      reset();
    } catch (err) {
      setError(errorText(err, 'Failed to change password. The code may be expired or invalid.'));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <section aria-label="Password" className={CARD}>
      <div className="border-b border-slate-100 px-4 py-[13px]">
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-ink">Password</h2>
          <p className="mt-0.5 text-xs text-slate-500">{step === 1 ? 'Confirm your current password and we’ll email you a code.' : `Enter the code sent to ${email || 'your email'} and your new password.`}</p>
        </div>
      </div>
      {step === 1 ? (
        <form onSubmit={requestCode} className="flex flex-col gap-3 px-4 py-3.5">
          <Problem>{error}</Problem>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className={`${LABEL} mb-0`} htmlFor="pw-current">
                Current password
              </label>
              <Link to="/forgot-password" className="text-xs font-bold text-brand hover:underline">
                Forgot your password?
              </Link>
            </div>
            <PasswordField id="pw-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={BTN_MAIN} disabled={!current || busy}>
              {busy ? 'Sending…' : 'Send OTP'}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-3 px-4 py-3.5">
          <Problem>{error}</Problem>
          <div>
            <label className={LABEL} htmlFor="pw-otp">
              Code from the email
            </label>
            <input
              id="pw-otp"
              required
              maxLength={6}
              autoComplete="one-time-code"
              className={`${FIELD} text-center font-mono text-[15px] uppercase tracking-[0.4em]`}
              value={otp}
              onChange={(e) => {
                setOtp(e.target.value.toUpperCase());
                setError(null);
              }}
              disabled={busy}
            />
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="pw-new">
                New password
              </label>
              <PasswordField id="pw-new" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setError(null); }} disabled={busy} />
            </div>
            <div>
              <label className={LABEL} htmlFor="pw-again">
                Type it again
              </label>
              <PasswordField id="pw-again" autoComplete="new-password" value={again} onChange={(e) => { setAgain(e.target.value); setError(null); }} disabled={busy} />
            </div>
          </div>
          <ul aria-label="Password rules" className="grid gap-x-3 gap-y-1 text-xs font-semibold sm:grid-cols-2">
            {PASSWORD_RULES.map(([label, ok]) => (
              <li key={label} className={`flex items-center gap-1.5 ${ok(next) ? 'text-emerald-700' : 'text-slate-400'}`}>
                {ok(next) ? <Check size={12} strokeWidth={3} /> : <span className="ml-0.5 mr-[3px] h-1.5 w-1.5 rounded-full border border-current" />}
                {label}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={BTN_MAIN} disabled={!otp || !next || !again || busy}>
              {busy ? 'Changing…' : 'Change password'}
            </button>
            <button type="button" className={BTN_GHOST} onClick={reset} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function AdvanceCard({ amount }) {
  const left = Number(amount || 0);
  return (
    <section aria-label="Advance" className={CARD}>
      <CardHead title="Advance" sub="Money Finance gave you ahead of your expenses" />
      <div className="flex flex-col gap-2 px-4 py-3.5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <b className={`font-mono text-2xl tabular-nums ${left > 0 ? 'text-ink' : 'text-slate-400'}`}>{inr(left)}</b>
          <span className="text-[13px] text-slate-500">{left > 0 ? 'left to use' : 'no advance left to use'}</span>
        </div>
        <p className="text-xs text-slate-500">
          {left > 0 ? 'When a claim of yours is paid, this is used first and the rest is paid to you.' : 'If Finance gives you an advance, it shows here. When a claim is paid, any advance is used first.'}
        </p>
      </div>
    </section>
  );
}

function AutoApproveCard({ threshold, ceiling, onSaved }) {
  const { showToast } = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const on = threshold != null && Number(threshold) > 0;
  useEffect(() => {
    setValue(threshold != null && Number(threshold) > 0 ? String(Number(threshold)) : '');
  }, [threshold]);

  const save = async (amount) => {
    setError(null);
    setBusy(true);
    try {
      const res = await reimbursementApi.updateAutoApproveThreshold(amount);
      onSaved(res.data);
      showToast(amount == null ? 'Auto-approve is off: every claim waits for your review' : 'Auto-approve amount saved', 'success');
    } catch (err) {
      setError(errorText(err, 'Failed to update the auto-approve amount'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Auto-approve" className={CARD}>
      <CardHead title="Auto-approve" sub="Claims under your amount are approved for you once they reach you">
        <Pill tone={on ? 'ok' : 'slate'}>{on ? 'On' : 'Off'}</Pill>
      </CardHead>
      <form
        className="flex flex-col gap-3 px-4 py-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (value !== '') save(Number(value));
        }}
      >
        <Problem>{error}</Problem>
        <div className={`rounded-xl px-3 py-2.5 ${on ? 'border border-emerald-200 bg-emerald-50' : 'border border-slate-200 bg-slate-50'}`}>
          <b className="block text-[13px] text-ink">{on ? `Claims under ${inr(threshold)} are approved for you` : 'Every claim waits for your review'}</b>
          <p className="mt-0.5 text-xs text-slate-500">{on ? 'Bigger ones still wait for you.' : 'Set an amount to approve smaller claims automatically.'}</p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className={`${LABEL} mb-0`} htmlFor="auto-amount">
              Approve claims under
            </label>
            <small className="text-[11px] text-slate-400">up to {inr(ceiling)}</small>
          </div>
          <div className="flex items-center overflow-hidden rounded-[10px] border border-slate-200 bg-white focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/10">
            <span className="pl-3 pr-1.5 text-slate-400">₹</span>
            <input id="auto-amount" type="number" min="0" max={Number(ceiling)} step="0.01" className="h-9 w-full bg-transparent font-mono text-[13px] outline-none" placeholder="e.g. 2000" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} disabled={busy} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={BTN_MAIN} disabled={busy || value === '' || Number(value) === Number(threshold)}>
            Save
          </button>
          {threshold != null ? (
            <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => save(null)}>
              Turn off
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function OutOfOfficeCard() {
  const { showToast } = useToast();
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [person, setPerson] = useState(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    reimbursementApi
      .getDelegations()
      .then((res) => setRows(res.data))
      .catch(() => {
        setRows([]);
        showToast('Failed to load delegations', 'error');
      });
  }, []);

  const search = async (q) => {
    setQuery(q);
    if (q.length < 2) return setResults([]);
    try {
      setResults((await api.get('/me/users-search', { params: { q } })).data);
    } catch {
      /* keep the last results */
    }
    return undefined;
  };
  const create = async (e) => {
    e.preventDefault();
    if (!person || !start || !end) return;
    setBusy(true);
    try {
      const res = await reimbursementApi.createDelegation({ delegatee_id: person.id, start_date: new Date(start).toISOString(), end_date: new Date(end).toISOString() });
      setRows((current) => [res.data, ...(current || [])]);
      showToast('Delegation created successfully', 'success');
      setPerson(null);
      setStart('');
      setEnd('');
    } catch (err) {
      showToast(errorText(err, 'Failed to create delegation'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    try {
      await reimbursementApi.deleteDelegation(id);
      setRows((current) => current.filter((d) => d.id !== id));
      showToast('Delegation removed', 'success');
    } catch {
      showToast('Failed to remove delegation', 'error');
    } finally {
      setConfirmId(null);
    }
  };
  const now = new Date();

  return (
    <section aria-label="Out of office" className={CARD}>
      <CardHead title="Out of office" sub="Hand your approvals to someone else for a set of dates" />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        {rows == null ? <p className="text-[13px] text-slate-500">Loading…</p> : null}
        {rows && rows.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3.5 text-center text-[12.5px] text-slate-500">You haven&apos;t handed off your approvals to anyone.</p> : null}
        {rows && rows.length ? (
          <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
            {rows.map((d) => {
              const live = d.is_active && new Date(d.start_date) <= now && new Date(d.end_date) >= now;
              const upcoming = d.is_active && new Date(d.start_date) > now;
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <span className="min-w-0">
                    <b className="block truncate text-[13px] text-ink">{d.delegatee_name || 'Unknown'}</b>
                    <small className="text-xs text-slate-500">
                      {fmtDay(d.start_date)} – {fmtDay(d.end_date)}
                      {d.delegatee_email ? ` · ${d.delegatee_email}` : ''}
                    </small>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Pill tone={live ? 'ok' : upcoming ? 'sky' : 'slate'}>{live ? 'Covering now' : upcoming ? 'Upcoming' : 'Ended'}</Pill>
                    {confirmId === d.id ? (
                      <>
                        <button type="button" className={`${BTN_NO} h-7 rounded-lg px-2.5 text-[11.5px]`} onClick={() => remove(d.id)}>
                          Remove
                        </button>
                        <button type="button" className={`${BTN_GHOST} h-7 rounded-lg px-2.5 text-[11.5px]`} onClick={() => setConfirmId(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button type="button" aria-label={`Remove hand-off to ${d.delegatee_name || 'this person'}`} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => setConfirmId(d.id)}>
                        <X size={14} />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        <form onSubmit={create} className="flex flex-col gap-3">
          <p className={EYEBROW}>New hand-off</p>
          <div className="relative">
            <span className={LABEL}>Hand off to</span>
            {person ? (
              <div className="flex h-9 items-center justify-between gap-2 rounded-[10px] border border-brand/30 bg-brand/5 px-3">
                <span className="min-w-0 truncate text-[13px]">
                  <b className="text-brand">{person.full_name}</b> <small className="text-brand/70">{person.email}</small>
                </span>
                <button type="button" className="text-xs font-bold text-slate-500 hover:text-rose-600" onClick={() => setPerson(null)}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <label className="relative block">
                  <span className="sr-only">Search by name or email</span>
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className={`${FIELD} pl-8`} placeholder="Search by name or email" value={query} onChange={(e) => search(e.target.value)} />
                </label>
                {results.length ? (
                  <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                    {results.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                          onClick={() => {
                            setPerson(u);
                            setQuery('');
                            setResults([]);
                          }}
                        >
                          <b className="block text-[13px] text-ink">{u.full_name}</b>
                          <small className="text-xs text-slate-500">{u.email}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={LABEL} htmlFor="ooo-from">
                From
              </label>
              <input id="ooo-from" type="date" required className={FIELD} value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className={LABEL} htmlFor="ooo-until">
                Until
              </label>
              <input id="ooo-until" type="date" required min={start || undefined} className={FIELD} value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={BTN_MAIN} disabled={!person || !start || !end || busy}>
              {busy ? 'Saving…' : 'Hand off'}
            </button>
            <span className="text-xs text-slate-500">They&apos;ll see your queue during these dates; you can cancel it any time.</span>
          </div>
        </form>
      </div>
    </section>
  );
}

export default function ProfilePage() {
  useSetPageTitle('My Profile');
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const setProfile = useAuthStore((s) => s.setProfile);
  const role = profile?.role || user?.role || 'EMPLOYEE';
  const accent = roleAccent(role);
  const roleLabel = formatRole(role);
  const name = profile?.full_name || user?.full_name || user?.email || 'User';
  const email = profile?.email || user?.email;

  const canSeeOrgChart = Boolean(profile?.role) && profile.role !== 'EMPLOYEE';
  // Shown only when turned on: delegation by the org-wide admin switch, auto-approve when the
  // organisation's auto-approve limit is above ₹0 (a manager can still have their own amount off).
  const showOutOfOffice = Boolean(profile?.can_create_delegation) && profile?.delegation_feature_enabled !== false;
  // Anyone with the Manager setting (whatever their role).
  const showAutoApprove = (profile?.is_manager || profile?.role === 'REPORTING_MANAGER') && Number(profile?.org_auto_approve_ceiling || 0) > 0;

  const [orgChart, setOrgChart] = useState(null);
  const [orgChartError, setOrgChartError] = useState(false);
  useEffect(() => {
    if (!canSeeOrgChart) return;
    api
      .get('/me/org-chart')
      .then((res) => setOrgChart(res.data?.roots || []))
      .catch(() => setOrgChartError(true));
  }, [canSeeOrgChart]);

  const left = [];
  const right = [];
  if (canSeeOrgChart) left.push(<ReportingLine key="line" roots={orgChart} error={orgChartError} accent={accent} roleLabel={roleLabel} />);
  if (showOutOfOffice) left.push(<OutOfOfficeCard key="ooo" />);
  right.push(<PasswordCard key="pw" email={email} />);
  right.push(<AdvanceCard key="adv" amount={profile?.outstanding_advance} />);
  if (showAutoApprove) right.push(<AutoApproveCard key="auto" threshold={profile.auto_approve_threshold} ceiling={profile.org_auto_approve_ceiling} onSaved={setProfile} />);
  // Nothing for the left column (employees): password on the left, the rest on the right.
  if (!left.length) left.push(right.shift());

  return (
    <section className="flex flex-col gap-3.5">
      <div>
        <h1 className="text-xl font-extrabold text-ink">My profile</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          Your details, password and advance{showOutOfOffice ? ', and who covers your approvals when you’re away' : ''}.
        </p>
      </div>

      <section aria-label="Your details" className={CARD}>
        <div className="grid grid-cols-1 items-center gap-4 px-[18px] pb-4 pt-[18px] sm:grid-cols-[auto_minmax(0,1fr)]">
          <Avatar name={name} className={accent} size="h-[60px] w-[60px] text-2xl" />
          <div className="min-w-0">
            <p className="truncate text-xl font-extrabold text-ink">{name}</p>
            <p className="truncate text-[13px] text-slate-500">{email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={`inline-flex items-center rounded-full px-[9px] py-0.5 text-[11.5px] font-bold ${roleChip(role)}`}>{roleLabel}</span>
              {profile?.impact_level_code ? (
                <Pill tone="brand">
                  {profile.impact_level_code}
                  {profile.impact_level_name ? ` · ${profile.impact_level_name}` : ''}
                </Pill>
              ) : null}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-slate-100 sm:grid-cols-4">
          {[
            ['Employee ID', profile?.employee_id],
            ['Department', profile?.department],
            ['Reports to', profile?.reporting_manager_name],
            ['Office', profile?.office_location],
          ].map(([label, value]) => (
            <Fact key={label} label={label} value={value} />
          ))}
        </dl>
        <p className="border-t border-slate-100 bg-slate-50 px-[18px] py-2.5 text-xs text-slate-500">These details come from your employee record. To change any of them, ask HR.</p>
      </section>

      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3.5">{left}</div>
        <div className="flex min-w-0 flex-col gap-3.5">{right}</div>
      </div>
    </section>
  );
}
