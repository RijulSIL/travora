import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Pill } from '../../components/approvals/ApprovalQueueParts';
import { BTN_GHOST, BTN_MAIN, BTN_SM, CARD, CardHead, ErrorNote, FIELD, PolicyHead } from '../../components/policy/PolicyAdminParts';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { adminApi } from '../../services/adminApi';
import { hasPermission } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

/*
 * Team budgets: a monthly spend budget per manager's team, shown on their Home next to what the
 * team has claimed (only while "Show budgets to managers" is on). A manager's budget is their own
 * override if they have one, otherwise their department's, otherwise none — the Managers list
 * shows exactly that for everyone, the same rule as the backend's get_effective_budget.
 */

const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const errorText = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : fallback;
};
const FILTER = FIELD.replace('w-full', '');

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-brand' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

/** Amount box with Save / Cancel, used on a row while it's being set or changed. */
function AmountEditor({ initial, saveLabel, busy, onSave, onCancel }) {
  const [value, setValue] = useState(initial ? String(Number(initial)) : '');
  const valid = Number(value) > 0;
  return (
    <form
      className="flex flex-wrap items-center justify-end gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(value);
      }}
    >
      <span className="inline-flex h-[30px] items-center rounded-[9px] border border-brand bg-white px-2">
        <span className="mr-0.5 text-xs font-bold text-slate-400">₹</span>
        <input
          autoFocus
          aria-label="Monthly amount"
          inputMode="decimal"
          className="w-[92px] border-0 bg-transparent p-0 font-mono text-[12.5px] text-ink outline-none focus:ring-0"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        />
      </span>
      <button type="submit" className={`${BTN_MAIN} h-[30px] px-2.5 text-xs`} disabled={!valid || busy}>
        {busy ? 'Saving…' : saveLabel}
      </button>
      <button type="button" className={`${BTN_GHOST} h-[30px] border-transparent px-2 text-xs`} onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}

export default function TeamBudgets() {
  useSetPageTitle('Team Budgets');
  const { showToast } = useToast();
  // manage_team_budgets gates both reading and changing this page (backend budgets.py).
  const permissions = useAuthStore((state) => state.profile?.permissions);
  const canEdit = hasPermission(permissions, 'manage_team_budgets');

  const [enabled, setEnabled] = useState(false);
  const [deptBudgets, setDeptBudgets] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [options, setOptions] = useState({ departments: [], managers: [] });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [toggling, setToggling] = useState(false);
  // The row being set or changed: 'd:<department>' or 'm:<manager user id>'.
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState('');

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [configRes, deptRes, mgrRes, optRes] = await Promise.all([
        adminApi.budgetConfig(),
        adminApi.departmentBudgets(),
        adminApi.managerBudgets(),
        adminApi.budgetOptions(),
      ]);
      setEnabled(Boolean(configRes.data?.enabled));
      setDeptBudgets(deptRes.data || []);
      setOverrides(mgrRes.data || []);
      setOptions(optRes.data || { departments: [], managers: [] });
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const deptBudgetOf = useMemo(() => Object.fromEntries(deptBudgets.map((b) => [b.department, b])), [deptBudgets]);
  const overrideOf = useMemo(() => Object.fromEntries(overrides.map((o) => [o.manager_user_id, o])), [overrides]);
  const managers = options.managers || [];
  // Own override, else their department's budget, else none (backend get_effective_budget).
  const effective = (m) => {
    if (overrideOf[m.user_id]) return { amount: overrideOf[m.user_id].monthly_amount, from: 'override' };
    if (m.department && deptBudgetOf[m.department]) return { amount: deptBudgetOf[m.department].monthly_amount, from: 'department' };
    return { amount: null, from: 'none' };
  };
  // Departments: the company's list, plus any that still has a budget set.
  const departments = [...new Set([...(options.departments || []), ...deptBudgets.map((b) => b.department)])];
  const covered = managers.filter((m) => effective(m).from !== 'none').length;
  const shownManagers = managers.filter(
    (m) =>
      (!query.trim() || `${m.full_name} ${m.email}`.toLowerCase().includes(query.trim().toLowerCase())) &&
      (!show || (show === 'none' ? effective(m).from === 'none' : Boolean(overrideOf[m.user_id]))),
  );

  const run = async (key, action, done) => {
    setBusy(key);
    try {
      await action();
      await load();
      setEditing(null);
      showToast(done, 'success');
    } catch (err) {
      showToast(errorText(err, 'That didn’t save. Please try again.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (next) => {
    setToggling(true);
    try {
      const res = await adminApi.updateBudgetConfig({ enabled: next });
      setEnabled(Boolean(res.data?.enabled));
      showToast(next ? 'Managers can now see their team budgets.' : 'Budgets are hidden from managers.', 'success');
    } catch (err) {
      showToast(errorText(err, 'Could not change this.'), 'error');
    } finally {
      setToggling(false);
    }
  };

  return (
    <section className="flex flex-col gap-3.5">
      <PolicyHead title="Team budgets" sub="A monthly spend budget for each manager's team, shown on their Home next to what the team has claimed.">
        {[
          ['Departments with a budget', `${departments.filter((d) => deptBudgetOf[d]).length} / ${departments.length}`, ''],
          ['Managers covered', `${covered} / ${managers.length}`, ''],
          ['No budget', managers.length - covered, managers.length - covered ? 'text-amber-700' : ''],
        ].map(([label, value, tone]) => (
          <div key={label} className="min-w-[110px] rounded-xl border border-slate-200 bg-white px-3 py-[7px]">
            <b className={`block text-[17px] ${tone || 'text-ink'}`}>{loaded ? value : '—'}</b>
            <span className="text-[11.5px] font-semibold text-slate-500">{label}</span>
          </div>
        ))}
      </PolicyHead>

      <ErrorNote error={loadError} />

      <div
        className={`flex flex-wrap items-center justify-between gap-3.5 rounded-[14px] border px-4 py-[11px] ${enabled ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50'}`}
      >
        <div>
          <b className="text-[13.5px] text-ink">Show budgets to managers</b>
          <p className={`mt-0.5 max-w-[84ch] text-xs ${enabled ? 'text-slate-500' : 'text-amber-900'}`}>
            {enabled
              ? 'Managers see their team’s spend against their budget on Home.'
              : 'Off — managers don’t see any budgets. What you set below is kept and shows up as soon as you turn this on.'}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-500">
          {enabled ? 'On' : 'Off'}
          <Switch checked={enabled} onChange={toggle} disabled={!canEdit || toggling || !loaded} label="Show budgets to managers" />
        </span>
      </div>

      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section aria-label="Department budgets" className={CARD}>
          <CardHead title="Department budgets" sub="The default for every manager in that department, unless they have their own override." />
          {!loaded ? (
            <div className="p-4">
              <Skeleton variant="table" rows={5} columns={1} />
            </div>
          ) : (
            departments.map((dept, i) => {
              const budget = deptBudgetOf[dept];
              const count = managers.filter((m) => m.department === dept).length;
              const key = `d:${dept}`;
              return (
                <div key={dept} className={`grid min-h-[52px] grid-cols-1 items-center gap-2.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] ${i ? 'border-t border-slate-100' : ''}`}>
                  <div className="min-w-0">
                    <b className="block truncate text-[13px] text-ink">{dept}</b>
                    <span className="text-[11.5px] text-slate-500">{count ? `${count} ${count === 1 ? 'manager' : 'managers'}` : 'No managers'}</span>
                  </div>
                  {editing === key ? (
                    <AmountEditor
                      initial={budget?.monthly_amount}
                      saveLabel="Save"
                      busy={busy === key}
                      onCancel={() => setEditing(null)}
                      onSave={(amount) =>
                        run(key, () => adminApi.upsertDepartmentBudget({ department: dept, monthly_amount: amount }), `${dept}: budget saved.`)
                      }
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                      {budget ? (
                        <>
                          <span className="text-right font-mono text-[13px] font-semibold text-ink">
                            {inr(budget.monthly_amount)}
                            <small className="block font-sans text-[11px] font-semibold text-slate-400">a month</small>
                          </span>
                          {canEdit ? (
                            <>
                              <button type="button" className={BTN_SM} onClick={() => setEditing(key)}>
                                Change
                              </button>
                              <button
                                type="button"
                                aria-label={`Clear ${dept}'s budget`}
                                title="Clear"
                                className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                                disabled={busy === key}
                                onClick={() => run(key, () => adminApi.deleteDepartmentBudget(budget.id), `${dept}: budget cleared.`)}
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <span className="text-xs font-semibold text-slate-400">No budget</span>
                          {canEdit ? (
                            <button type="button" className={BTN_SM} onClick={() => setEditing(key)}>
                              Set budget
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        <section aria-label="Managers" className={CARD}>
          <CardHead title="Managers" sub="What each manager gets. An override replaces their department's budget for them only." />
          <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
            <label className="relative min-w-[160px] flex-1">
              <span className="sr-only">Search managers</span>
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${FILTER} w-full pl-8`} placeholder="Search managers" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <select aria-label="Show" className={FILTER} value={show} onChange={(e) => setShow(e.target.value)}>
              <option value="">All managers</option>
              <option value="none">No budget</option>
              <option value="override">Has an override</option>
            </select>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {!loaded ? (
              <div className="p-4">
                <Skeleton variant="table" rows={6} columns={1} />
              </div>
            ) : shownManagers.length ? (
              shownManagers.map((m, i) => {
                const e = effective(m);
                const own = overrideOf[m.user_id];
                const key = `m:${m.user_id}`;
                return (
                  <div key={m.user_id} className={`grid min-h-[52px] grid-cols-1 items-center gap-2.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] ${i ? 'border-t border-slate-100' : ''}`}>
                    <div className="min-w-0">
                      <b className="block truncate text-[13px] text-ink">{m.full_name || m.email}</b>
                      <span className="block truncate text-[11.5px] text-slate-500">
                        {m.email}
                        {m.department ? ` · ${m.department}` : ' · No department'}
                      </span>
                    </div>
                    {editing === key ? (
                      <AmountEditor
                        initial={own?.monthly_amount}
                        saveLabel="Save override"
                        busy={busy === key}
                        onCancel={() => setEditing(null)}
                        onSave={(amount) =>
                          run(
                            key,
                            () => adminApi.upsertManagerBudget({ manager_user_id: m.user_id, monthly_amount: amount }),
                            `${m.full_name || m.email}: override saved.`,
                          )
                        }
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                        {e.amount != null ? <span className="font-mono text-[13px] font-semibold text-ink">{inr(e.amount)}</span> : null}
                        {e.from === 'override' ? (
                          <Pill tone="violet">Own override</Pill>
                        ) : e.from === 'department' ? (
                          <Pill tone="ok">From {m.department}</Pill>
                        ) : (
                          <Pill tone="amber">No budget</Pill>
                        )}
                        {canEdit ? (
                          own ? (
                            <>
                              <button type="button" className={BTN_SM} onClick={() => setEditing(key)}>
                                Change
                              </button>
                              <button
                                type="button"
                                className={`${BTN_SM} border-transparent text-slate-500`}
                                disabled={busy === key}
                                onClick={() =>
                                  run(key, () => adminApi.deleteManagerBudget(own.id), `${m.full_name || m.email}: override removed.`)
                                }
                              >
                                Remove override
                              </button>
                            </>
                          ) : (
                            <button type="button" className={BTN_SM} onClick={() => setEditing(key)}>
                              Set override
                            </button>
                          )
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="px-4 py-6 text-center text-[12.5px] text-slate-500">{managers.length ? 'Nobody matches.' : 'No managers yet.'}</p>
            )}
          </div>
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-[9px] text-[11.5px] text-slate-500">
            {shownManagers.length} of {managers.length} managers · overrides: {overrides.length}
          </div>
        </section>
      </div>

      <p className="rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-500">
        <b className="text-ink">How a manager&apos;s budget is worked out:</b> their own override if they have one, otherwise their department&apos;s budget,
        otherwise none. Their Home shows this month&apos;s team claims against it — only while <b className="text-ink">Show budgets to managers</b> is on.
      </p>
    </section>
  );
}
