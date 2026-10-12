import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Car, Hotel, Lock, Plane, TrainFront, Users, X } from 'lucide-react';

import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { reimbursementApi } from '../../services/reimbursementApi';

const CAP_ROWS = [
  { key: 'hotel', label: 'Hotel' },
  { key: 'food', label: 'Food' },
  { key: 'incidental', label: 'Incidentals' },
  { key: 'day_visit', label: 'Day visit' },
];

function rupees(value) {
  if (value === null || value === undefined) return null;
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function flightText(limits) {
  const cls = limits.air_class_allowed ? limits.air_class_allowed.replace('_', ' ').toLowerCase() : null;
  if (limits.air_eligibility === 'YES') return cls ? `Eligible · ${cls}` : 'Eligible';
  if (limits.air_eligibility === 'CONDITIONAL') return cls ? `Only with approval · ${cls}` : 'Only with approval';
  return 'Not eligible';
}

function Chips({ items }) {
  if (!items?.length) return <span className="text-slate-400">None</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
          {item}
        </span>
      ))}
    </span>
  );
}

function EntitlementRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" />
      <div className="w-32 shrink-0 text-sm font-medium text-slate-500">{label}</div>
      <div className="min-w-0 flex-1 text-sm font-semibold text-ink">{children}</div>
    </div>
  );
}

/** Everything the travel policy in force today allows the signed-in employee at their impact level. */
export default function MyLimitsModal({ open, onClose }) {
  const [state, setState] = useState({ status: 'idle', data: null });
  useBodyScrollLock(open);

  const load = useCallback(async () => {
    setState({ status: 'loading', data: null });
    try {
      const { data } = await reimbursementApi.myPolicyLimits();
      setState({ status: 'ready', data });
    } catch {
      setState({ status: 'error', data: null });
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const limits = state.data;
  const from = formatDate(limits?.effective_from);
  const to = formatDate(limits?.effective_to);

  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="my-limits-title"
        className="panel flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h3 id="my-limits-title" className="text-base font-bold text-ink">Know your limits</h3>
            {limits?.impact_level_code ? (
              <p className="mt-0.5 text-xs text-slate-500">
                {limits.impact_level_code}
                {limits.impact_level_name ? ` (${limits.impact_level_name})` : ''}
                {limits.policy_version ? ` · Policy v${limits.policy_version}` : ''}
                {from ? ` · in force ${from}${to ? ` – ${to}` : ' onwards'}` : ''}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {state.status === 'loading' || state.status === 'idle' ? (
            <div className="space-y-3" aria-label="Loading your limits">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : state.status === 'error' ? (
            <div className="py-6 text-center">
              <p className="text-sm text-slate-600">Couldn&apos;t load your limits.</p>
              <button type="button" className="btn-secondary mt-3" onClick={load}>
                Try again
              </button>
            </div>
          ) : !limits.has_policy ? (
            <p className="py-6 text-center text-sm text-slate-600">
              No travel policy is in force today for your impact level, so there are no limits to show.
            </p>
          ) : (
            <div className="space-y-6">
              <section>
                <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Expense caps by city group</h4>
                {limits.city_limits.length ? (
                  <>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[420px] text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-left">
                            <th className="px-4 py-2.5 text-xs font-semibold text-slate-500" scope="col">
                              <span className="sr-only">Expense</span>
                            </th>
                            {limits.city_limits.map((tier) => (
                              <th key={tier.city_group} className="px-4 py-2.5 text-right text-xs font-bold text-ink" scope="col">
                                {tier.city_group_name}
                                {tier.is_default ? (
                                  <span className="block text-[10px] font-medium text-slate-400">Other cities</span>
                                ) : null}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {CAP_ROWS.map((row) => (
                            <tr key={row.key} className="border-t border-slate-100">
                              <th className="px-4 py-2.5 text-left font-medium text-slate-600" scope="row">{row.label}</th>
                              {limits.city_limits.map((tier) => {
                                const cap = tier[row.key];
                                const amount = rupees(cap?.amount);
                                return (
                                  <td key={tier.city_group} className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                                    {amount ? (
                                      <span className="inline-flex items-center justify-end gap-1">
                                        {cap.is_hard_block ? (
                                          <Lock size={11} className="text-slate-400" aria-label="Strict cap" />
                                        ) : null}
                                        {amount}
                                      </span>
                                    ) : (
                                      <span className="font-normal text-slate-400">No cap</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
                      <Lock size={11} className="mt-0.5 shrink-0 text-slate-400" />
                      <span>
                        Strict cap: going over blocks your claim until you request an exception. Going over any other cap
                        flags the expense for your approver.
                      </span>
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">No expense caps are set for your impact level.</p>
                )}
              </section>

              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Travel</h4>
                <div className="divide-y divide-slate-100">
                  <EntitlementRow icon={Plane} label="Flights">{flightText(limits)}</EntitlementRow>
                  <EntitlementRow icon={TrainFront} label="Train classes">
                    <Chips items={limits.train_classes_allowed} />
                  </EntitlementRow>
                  <EntitlementRow icon={Car} label="Local travel">
                    <Chips items={limits.local_conveyance_modes} />
                    {limits.vehicle_rate_4w || limits.vehicle_rate_2w ? (
                      <span className="mt-1.5 block text-xs font-medium text-slate-500">
                        Own vehicle:{' '}
                        {[
                          limits.vehicle_rate_4w ? `4-wheeler ${rupees(limits.vehicle_rate_4w)}/km` : null,
                          limits.vehicle_rate_2w ? `2-wheeler ${rupees(limits.vehicle_rate_2w)}/km` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </EntitlementRow>
                  <EntitlementRow icon={limits.twin_sharing_mandatory ? Users : Hotel} label="Hotel room">
                    {limits.twin_sharing_mandatory ? 'Twin sharing required' : 'Twin sharing not required'}
                  </EntitlementRow>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
