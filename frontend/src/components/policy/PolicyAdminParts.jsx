import { Lock, PencilLine, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Pill } from '../approvals/ApprovalQueueParts';
import { adminApi } from '../../services/adminApi';
import { hasPermission } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

export const FIELD =
  'h-9 w-full rounded-[10px] border border-slate-200 bg-white px-2.5 text-[13px] text-ink outline-none focus:border-brand focus:ring-[3px] focus:ring-brand/10 read-only:bg-slate-50 disabled:bg-slate-50';
export const LABEL = 'mb-1 block text-xs font-bold text-slate-700';
export const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400';
export const CARD = 'overflow-hidden rounded-[14px] border border-slate-200 bg-white';
const BTN = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border font-bold disabled:cursor-not-allowed disabled:opacity-45';
export const BTN_MAIN = `${BTN} h-[34px] border-brand bg-brand px-[13px] text-[12.5px] text-white hover:bg-brand/90`;
export const BTN_DARK = `${BTN} h-[34px] border-ink bg-ink px-[13px] text-[12.5px] text-white hover:bg-ink/90`;
export const BTN_GHOST = `${BTN} h-[34px] border-slate-200 bg-white px-[13px] text-[12.5px] text-slate-700 hover:bg-slate-50`;
export const BTN_NO = `${BTN} h-[34px] border-rose-200 bg-white px-[13px] text-[12.5px] text-rose-700 hover:bg-rose-50`;
export const BTN_SM = `${BTN} h-7 rounded-lg border-slate-200 bg-white px-2.5 text-[11.5px] text-slate-700 hover:bg-slate-50`;

/** Today as YYYY-MM-DD in the viewer's own time zone (the app's users are in IST). */
export const todayIso = () => new Date().toLocaleDateString('en-CA');

export const fmtDate = (iso) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

const approved = (v) => v.status !== 'DRAFT' && v.status !== 'PENDING_HRBP';

/** The next approved version to start after this one, if any. */
const successorOf = (version, versions) =>
  versions
    .filter((v) => v.id !== version.id && approved(v) && v.effective_from && v.effective_from > version.effective_from)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];

/**
 * What a version is doing today, worked out from its dates rather than its stored status: a
 * version stays "In effect" from its start date until a newer version's start date arrives,
 * and only then is it "Archived" (same rule the policy engine uses to pick a version).
 */
export function versionPhase(version, versions, today = todayIso()) {
  if (!version) return null;
  if (version.status === 'DRAFT') return { key: 'draft', label: 'Draft', tone: 'amber', step: 0 };
  if (version.status === 'PENDING_HRBP') return { key: 'review', label: 'In review', tone: 'amber', step: 1 };
  if (!version.effective_from) return { key: 'approved', label: 'Awaiting start date', tone: 'violet', step: 2 };
  if (version.effective_from > today) return { key: 'scheduled', label: `Starts ${fmtDate(version.effective_from)}`, tone: 'sky', step: 3 };
  const next = successorOf(version, versions);
  if (next && next.effective_from <= today) return { key: 'archived', label: 'Archived', tone: 'slate', step: 5, next };
  return { key: 'live', label: 'In effect', tone: 'ok', step: 4, next };
}

const READ_ONLY_WHY = {
  live: "it's the policy in effect",
  archived: 'a newer version has replaced it',
  scheduled: "it's approved and scheduled",
  approved: "it's approved",
  review: "it's waiting for approval",
};

export const useCanConfigurePolicy = () => hasPermission(useAuthStore((state) => state.profile?.permissions), 'configure_policy');

/**
 * Loads the policy versions for a page that edits one version's data. Picks ?versionId=,
 * else the draft, else the version in effect — and keeps ?versionId= in step with the pick.
 */
export function usePolicyVersions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [versions, setVersions] = useState([]);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const fromUrl = searchParams.get('versionId');
  const [versionId, setVersionIdState] = useState(fromUrl ? Number(fromUrl) : null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const list = (await adminApi.policyVersions()).data;
      setVersions(list);
      setVersionIdState((current) => {
        if (current && list.some((v) => v.id === current)) return current;
        const pick = list.find((v) => v.status === 'DRAFT') || list.find((v) => versionPhase(v, list).key === 'live') || list[list.length - 1];
        return pick ? pick.id : null;
      });
    } catch (err) {
      setError(err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!versionId || String(versionId) === fromUrl) return;
    const next = new URLSearchParams(searchParams);
    next.set('versionId', String(versionId));
    setSearchParams(next, { replace: true });
  }, [versionId, fromUrl, searchParams, setSearchParams]);

  const version = versions.find((v) => v.id === versionId) || null;
  return { versions, version, versionId, setVersionId: setVersionIdState, reload, error, loaded };
}

export function PolicyHead({ title, sub, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-extrabold text-ink">{title}</h1>
        <p className="mt-0.5 max-w-[70ch] text-[13px] text-slate-500">{sub}</p>
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  const detail = error.response?.data?.detail;
  const text = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : error.message;
  return (
    <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
      {text}
    </div>
  );
}

/** Version chips plus why the page is (or isn't) editable. */
export function VersionBar({ versions, versionId, onSelect, canConfigure }) {
  const version = versions.find((v) => v.id === versionId);
  const phase = versionPhase(version, versions);
  const hasDraft = versions.some((v) => v.status === 'DRAFT');
  let note;
  if (!version) note = 'No policy versions yet.';
  else if (!canConfigure) note = "View only: you can't change policy.";
  else if (phase.key === 'draft') note = `You're editing draft ${version.version_number}. Changes apply once it's approved and its start date arrives.`;
  else note = `${version.version_number} is read-only because ${READ_ONLY_WHY[phase.key]}. ${hasDraft ? 'Edit the draft instead.' : 'Start a new draft on Policy versions to make changes.'}`;
  const editing = canConfigure && phase?.key === 'draft';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
      <div role="group" aria-label="Policy version" className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-bold text-slate-700">Policy version</span>
        {versions.map((v) => {
          const p = versionPhase(v, versions);
          const on = v.id === versionId;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(v.id)}
              className={`inline-flex items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-[12.5px] font-bold text-ink ${on ? 'border-brand bg-[#f4faf7] ring-1 ring-inset ring-brand' :'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              {v.version_number}
              <Pill tone={p.tone}>{p.label}</Pill>
            </button>
          );
        })}
      </div>
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
        {editing ? <PencilLine size={13} className="shrink-0" /> : <Lock size={13} className="shrink-0" />}
        {note}
      </span>
    </div>
  );
}

export function CardHead({ title, sub, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 px-4 py-[13px]">
      <div className="min-w-0">
        <h2 className="text-sm font-extrabold text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** The side panel used for editing one row of a list. */
export function Sheet({ title, sub, onClose, children, footer, label }) {
  return (
    <aside aria-label={label || title} className={`${CARD} lg:sticky lg:top-4`}>
      <CardHead title={title} sub={sub}>
        {onClose ? (
          <button type="button" aria-label="Close" onClick={onClose} className={BTN_SM}>
            <X size={13} />
          </button>
        ) : null}
      </CardHead>
      <div className="flex flex-col gap-3 px-4 py-3.5">{children}</div>
      {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">{footer}</div> : null}
    </aside>
  );
}

export function Seg({ label, options, value, onChange, disabled = false }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-[10px] bg-slate-100 p-[3px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={`rounded-[7px] px-2.5 py-[5px] text-xs font-bold disabled:cursor-not-allowed ${value === o.key ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onClick, disabled, children, title }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded-lg border px-[9px] py-1 text-xs font-bold disabled:cursor-not-allowed ${on ? 'border-brand/30 bg-brand/10 text-brand' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
    >
      {children}
    </button>
  );
}

export function Check({ checked, onChange, disabled, title, hint }) {
  return (
    <label className={`flex items-start gap-2 text-[12.5px] ${disabled ? '' : 'cursor-pointer'}`}>
      <input type="checkbox" className="mt-px h-4 w-4 accent-brand" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b className="text-ink">{title}</b>
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Removable chips plus a box that adds one on Enter. */
export function ChipInput({ items, onChange, placeholder, disabled, label }) {
  const [text, setText] = useState('');
  const add = () => {
    const value = text.trim();
    if (value && !items.includes(value)) onChange([...items, value]);
    setText('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item) => (
        <span key={item} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-[11.5px] font-semibold text-slate-700">
          {item}
          {!disabled ? (
            <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((x) => x !== item))} className="grid h-[18px] w-[18px] place-items-center rounded-full bg-white text-slate-500 hover:text-rose-600">
              <X size={10} />
            </button>
          ) : null}
        </span>
      ))}
      {!disabled ? (
        <input
          aria-label={label}
          className={`${FIELD} h-7 w-[180px] text-xs`}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
      ) : null}
      {disabled && items.length === 0 ? <span className="text-xs text-slate-400">None</span> : null}
    </div>
  );
}
