import { ChevronDown, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import OverridePanel, { KIND_LABEL, waitingFor } from '../../components/admin/OverridePanel';
import { CARD, FIELD } from '../../components/policy/PolicyAdminParts';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { adminApi } from '../../services/adminApi';
import { formatRole } from '../../utils/formatters';

const KIND_PILL = {
  claim: 'bg-sky-50 text-sky-700',
  travel: 'bg-violet-50 text-violet-700',
  relocation: 'bg-orange-50 text-orange-700',
};
const FILTERS = [
  ['all', 'Everything'],
  ['overdue', 'Past SLA'],
  ['claim', 'Claims'],
  ['travel', 'Travel requests'],
  ['relocation', 'Relocation'],
];

/**
 * Admin → Stuck items: every claim, travel request and relocation request waiting on an approver,
 * past their SLA first, then the longest waiting. Open one to override it (OverridePanel).
 */
export default function StuckItems() {
  useSetPageTitle('Stuck Items');
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState(null);
  // Rows overridden while open: their panel stays, showing the outcome, until the row is closed.
  const [overriddenNow, setOverriddenNow] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      const res = await adminApi.overrideItems();
      setRows(res.data || []);
      setLoadError('');
    } catch {
      setLoadError('Could not load the waiting items. Try again in a moment.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const keyOf = (r) => `${r.kind}-${r.item_id}`;
  const overdue = (rows || []).filter((r) => r.overdue).length;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (filter === 'overdue' && !r.overdue) return false;
      if (['claim', 'travel', 'relocation'].includes(filter) && r.kind !== filter) return false;
      if (!q) return true;
      return [r.reference, r.employee_name, r.summary, r.step_label].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  // After an override: keep the row open (its outcome shows there) and refresh its line in the list.
  const onDone = (row, now) => {
    setRows((prev) =>
      (prev || []).map((r) => (keyOf(r) === keyOf(row) ? { ...(now || r), resolved: !now } : r)),
    );
  };

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Stuck items</h1>
          <p className="mt-0.5 max-w-[64ch] text-[13px] text-slate-500">
            Everything waiting on an approver. Open one to act for its approver: decide the step, skip it, or approve all remaining steps.
            Every override needs a reason and is recorded in the audit log.
          </p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          <div className="min-w-[110px] rounded-xl border border-slate-200 bg-white px-3 py-[7px]">
            <b className="block text-[17px] text-ink">{rows ? rows.length : '—'}</b>
            <span className="text-[11.5px] font-semibold text-slate-500">Waiting</span>
          </div>
          <div className="min-w-[110px] rounded-xl border border-slate-200 bg-white px-3 py-[7px]">
            <b className={`block text-[17px] ${overdue ? 'text-rose-700' : 'text-ink'}`}>{rows ? overdue : '—'}</b>
            <span className="text-[11.5px] font-semibold text-slate-500">Past their SLA</span>
          </div>
        </div>
      </div>

      {loadError ? (
        <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
          {loadError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="inline-flex flex-wrap gap-0.5 rounded-[10px] border border-slate-200 bg-white p-[3px]" role="group" aria-label="Show">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-[7px] px-3 py-[5px] text-xs font-bold ${filter === key ? 'bg-ink text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative w-full max-w-[280px]">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={`${FIELD} pl-8`}
            placeholder="Search reference, employee, step"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search waiting items"
          />
        </label>
      </div>

      <section aria-label="Waiting items" className={CARD}>
        {rows === null ? (
          <div className="p-4">
            <Skeleton variant="table" rows={5} columns={1} />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-slate-500">
            {rows.length ? 'Nothing matches.' : 'Nothing is waiting on an approver right now.'}
          </p>
        ) : (
          <ul className="m-0 list-none divide-y divide-slate-100 p-0">
            {visible.map((r) => {
              const key = keyOf(r);
              const open = openKey === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => {
                      setOpenKey(open ? null : key);
                      setOverriddenNow(new Set());
                    }}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left ${open ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${KIND_PILL[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                        <b className="text-[13px] text-ink">{r.reference}</b>
                        <span className="truncate text-[12.5px] text-slate-600">{r.employee_name || '—'}</span>
                        {r.resolved ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">No longer waiting</span>
                        ) : r.overdue ? (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10.5px] font-bold text-rose-700">Past SLA</span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-slate-500">
                        {r.summary} · waiting on <b className="font-semibold text-slate-700">{r.step_label}</b>
                        {r.step_role ? ` (${formatRole(r.step_role)})` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-right">
                      <span className="text-[12px] font-bold tabular-nums text-slate-600">{waitingFor(r.waiting_since)}</span>
                      <ChevronDown size={15} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  {open ? (
                    <div className="border-t border-slate-100 bg-slate-50/60 p-3">
                      {/* Kept mounted after an override so its outcome stays in view; reopen to act on the next step. */}
                      {r.resolved && !overriddenNow.has(key) ? (
                        <p className="m-0 px-1 py-2 text-[12.5px] text-slate-500">Overridden: it&apos;s no longer waiting on an approver.</p>
                      ) : (
                        <OverridePanel
                          key={key}
                          item={r}
                          onDone={(now) => {
                            setOverriddenNow((prev) => new Set(prev).add(key));
                            onDone(r, now);
                          }}
                        />
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
