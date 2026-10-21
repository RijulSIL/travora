import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';

import { BTN_MAIN } from '../policy/PolicyAdminParts';
import { roleAccent } from '../layout/roleAccent';
import { adminApi } from '../../services/adminApi';
import { formatRole } from '../../utils/formatters';

/*
 * The Manager setting in User management. A role is someone's job; Manager says people can
 * report to them, and adds the Manager permissions (Role permissions -> Manager) on top of their
 * role. Always on for the CEO. Turning it off — or deactivating a manager — first moves the
 * people who report to them to another manager (MoveTeam), and what's waiting on them follows.
 */

// What the Manager setting gives, as listed under it.
const MANAGER_PAGES = ['Pending approvals', 'Exception requests', 'Team claims', 'Team spend', 'Team calendar'];

const initials = (name) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function ManagerSetting({ name, value, onChange, locked = false, team = [], disabled = false }) {
  const who = name || 'this person';
  return (
    <div className="col-span-full flex flex-col gap-2.5 rounded-xl border border-slate-200 px-3 py-[11px]">
      <div className="flex flex-col items-start justify-between gap-2.5 sm:flex-row">
        <div className="min-w-0">
          <b className="text-[13px] text-ink">Manager</b>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
            {locked
              ? 'The CEO is always a manager, so people can report to them.'
              : `Can people report to ${who}? A manager approves their own team's claims, travel and exceptions, on top of what their role allows.`}
          </p>
        </div>
        <div role="radiogroup" aria-label="Manager" className={`inline-flex flex-none rounded-[9px] bg-slate-100 p-[3px] ${locked ? 'opacity-90' : ''}`}>
          {[
            [true, 'Yes'],
            [false, 'No'],
          ].map(([option, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={value === option}
              disabled={disabled || (locked && !option)}
              onClick={() => onChange(option)}
              className={`rounded-[7px] px-[13px] py-[5px] text-xs font-bold disabled:cursor-not-allowed ${
                value === option ? `bg-white shadow-sm ${option ? 'text-brand' : 'text-ink'}` : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {locked ? (
        <span className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
          <Lock size={12} /> Set automatically for the CEO role
        </span>
      ) : null}
      {value ? (
        <>
          {!locked ? (
            <div className="flex flex-wrap gap-[5px]">
              {MANAGER_PAGES.map((page) => (
                <span key={page} className="rounded-md bg-brand/10 px-[7px] py-0.5 text-[11px] font-semibold text-brand">
                  {page}
                </span>
              ))}
            </div>
          ) : null}
          <TeamList team={team} />
        </>
      ) : null}
    </div>
  );
}

export function TeamList({ team }) {
  if (!team.length) {
    return (
      <p className="border-t border-slate-100 pt-2 text-xs text-slate-500">
        Nobody reports to them yet — their manager pages stay empty until someone does.
      </p>
    );
  }
  return (
    <div className="border-t border-slate-100 pt-2">
      <span className="mb-0.5 block text-xs text-slate-500">Reports to them ({team.length})</span>
      {team.map((t) => (
        <div key={t.user_id} className="flex items-center gap-2 py-1 text-[12.5px] font-semibold text-ink">
          <span className={`grid h-6 w-6 flex-none place-items-center rounded-full text-[10px] font-extrabold text-white ${roleAccent(t.role)}`}>
            {initials(t.full_name || t.email)}
          </span>
          <span className="truncate">{t.full_name || t.email}</span>
          <small className="whitespace-nowrap text-[11.5px] font-medium text-slate-500">
            {formatRole(t.role)}
            {t.is_manager ? ' · Manager' : ''}
          </small>
        </div>
      ))}
    </div>
  );
}

/** Moves everyone who reports to `user` to another manager, straight away. Approvals waiting at
 * the manager step follow, and the new manager is told. */
export function MoveTeam({ user, team, managers, onMoved, errorText }) {
  const [waiting, setWaiting] = useState(null);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = user.full_name || user.email;

  useEffect(() => {
    let cancelled = false;
    adminApi
      .userTeam(user.user_id)
      .then((res) => !cancelled && setWaiting(res.data || {}))
      .catch(() => !cancelled && setWaiting({}));
    return () => {
      cancelled = true;
    };
  }, [user.user_id]);

  const teamIds = new Set(team.map((t) => t.employee_id));
  const options = managers.filter((m) => m.employee_id !== user.employee_id && !teamIds.has(m.employee_id));
  const rows = [
    ['Claims waiting', waiting?.waiting_claims],
    ['Travel requests waiting', waiting?.waiting_travel_requests],
    ['Exception requests waiting', waiting?.waiting_exceptions],
  ];
  const totalWaiting = rows.reduce((sum, [, n]) => sum + Number(n || 0), 0);
  const people = `${team.length} ${team.length === 1 ? 'person' : 'people'}`;

  const move = async () => {
    setBusy(true);
    setError('');
    try {
      await adminApi.moveUserTeam(user.user_id, to);
      const target = options.find((m) => m.employee_id === to);
      onMoved({ name: target?.full_name || to, count: team.length, waiting: totalWaiting });
    } catch (err) {
      setError(errorText ? errorText(err, 'Could not move them.') : 'Could not move them.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col-span-full flex flex-col gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <div>
        <b className="text-[13px] text-ink">
          {people} {team.length === 1 ? 'reports' : 'report'} to {name}.
        </b>
        <p className="mt-0.5 text-xs font-medium leading-relaxed text-amber-900">
          Choose who they report to now. Anything waiting on {name} as their manager moves to that person, who gets an email.
        </p>
      </div>
      <select
        aria-label="New manager"
        className="h-[34px] w-full rounded-[9px] border border-amber-300 bg-white px-2.5 text-[12.5px] text-ink"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      >
        <option value="">Choose their new manager…</option>
        {options.map((m) => (
          <option key={m.employee_id} value={m.employee_id}>
            {m.full_name} ({m.employee_id})
          </option>
        ))}
      </select>
      <ul className="flex flex-col gap-1">
        {rows.map(([label, n]) => (
          <li key={label} className="flex justify-between gap-2 text-xs text-amber-900">
            <span>{label}</span>
            <b className="font-mono">{waiting ? Number(n || 0) : '…'}</b>
          </li>
        ))}
      </ul>
      {error ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
          {error}
        </div>
      ) : null}
      <div>
        <button type="button" className={BTN_MAIN} disabled={!to || busy} onClick={move}>
          {busy ? 'Moving…' : `Move ${people}${totalWaiting ? ` and ${totalWaiting} waiting ${totalWaiting === 1 ? 'item' : 'items'}` : ''}`}
        </button>
      </div>
    </div>
  );
}
