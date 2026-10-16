import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Car, ChevronDown, Coins, Hotel, Lock, MapPin, Plane, Search, Sun, TrainFront, Users, UtensilsCrossed, X } from 'lucide-react';

import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { reimbursementApi } from '../../services/reimbursementApi';

const CAP_ROWS = [
  { key: 'hotel', label: 'Hotel', icon: Hotel },
  { key: 'food', label: 'Food', icon: UtensilsCrossed },
  { key: 'incidental', label: 'Incidentals', icon: Coins },
  { key: 'day_visit', label: 'Day visit', icon: Sun },
];
const EYEBROW = 'mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400';

function rupees(value) {
  if (value === null || value === undefined) return null;
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function flightInfo(limits) {
  const cls = limits.air_class_allowed ? limits.air_class_allowed.replace('_', ' ').toLowerCase() : null;
  if (limits.air_eligibility === 'YES') return { ok: true, text: cls ? `Eligible · ${cls}` : 'Eligible', sub: null };
  if (limits.air_eligibility === 'CONDITIONAL') return { ok: true, text: cls ? `Only with approval · ${cls}` : 'Only with approval', sub: 'Needs approval before booking' };
  return { ok: false, text: 'Not eligible', sub: "Your level doesn't allow air travel" };
}

function Chips({ items }) {
  if (!items?.length) return <span className="text-[13px] font-semibold text-slate-400">None</span>;
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-bold text-slate-700">
          {item}
        </span>
      ))}
    </span>
  );
}

/** One "how you can travel" tile. `muted` = not allowed. */
function Way({ icon: Icon, label, muted = false, children }) {
  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)] items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-[11px]">
      <span className={`flex h-[34px] w-[34px] items-center justify-center rounded-[10px] ${muted ? 'bg-slate-100 text-slate-400' : 'bg-brand/10 text-brand'}`}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-[11.5px] font-bold text-slate-500">{label}</div>
        {children}
      </div>
    </div>
  );
}

function CapTag({ strict }) {
  return strict ? (
    <span className="inline-flex items-center gap-1 self-start rounded-md bg-rose-50 px-1.5 py-px text-[10.5px] font-extrabold text-rose-700">
      <Lock size={10} /> Strict
    </span>
  ) : (
    <span className="self-start rounded-md bg-amber-50 px-1.5 py-px text-[10.5px] font-extrabold text-amber-700">Flagged</span>
  );
}

/** Everything the travel policy in force today allows the signed-in employee at their impact level. */
export default function MyLimitsModal({ open, onClose }) {
  const [state, setState] = useState({ status: 'idle', data: null });
  const [group, setGroup] = useState(null);
  const [cityQuery, setCityQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [lookup, setLookup] = useState({ status: 'idle', city: '', group: null });
  const lookupSeq = useRef(0);
  useBodyScrollLock(open);

  const load = useCallback(async () => {
    setState({ status: 'loading', data: null });
    try {
      const { data } = await reimbursementApi.myPolicyLimits();
      setState({ status: 'ready', data });
      setGroup(data?.city_limits?.[0]?.city_group ?? null);
    } catch {
      setState({ status: 'error', data: null });
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setCityQuery('');
      setSuggestions([]);
      setLookup({ status: 'idle', city: '', group: null });
    }
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // City names as you type (the same lookup the travel request form uses).
  useEffect(() => {
    const q = cityQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      reimbursementApi
        .travelCitySuggestions(q, 8)
        .then((r) => !cancelled && setSuggestions(r.data || []))
        .catch(() => !cancelled && setSuggestions([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cityQuery]);

  /** Which city group a city is in — then show that group's caps. */
  const findCity = async (name) => {
    const city = name.trim();
    if (!city) return;
    const seq = ++lookupSeq.current;
    setLookup({ status: 'loading', city, group: null });
    setSuggestions([]);
    try {
      const { data } = await reimbursementApi.travelCityExpenseLimits(city);
      if (seq !== lookupSeq.current) return;
      setLookup({ status: 'found', city: data.city || city, group: data.city_group, groupName: data.city_group_name });
      if (data.city_group) setGroup(data.city_group);
    } catch {
      if (seq === lookupSeq.current) setLookup({ status: 'error', city, group: null });
    }
  };

  if (!open) return null;
  const limits = state.data;
  const from = formatDate(limits?.effective_from);
  const to = formatDate(limits?.effective_to);
  const tiers = limits?.city_limits || [];
  const tier = tiers.find((t) => t.city_group === group) || tiers[0];
  const flight = limits ? flightInfo(limits) : null;

  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/45 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="my-limits-title"
        className="flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_30px_70px_rgba(15,23,42,.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 pb-3.5 pt-[18px] sm:px-[22px]">
          <div className="min-w-0">
            <h3 id="my-limits-title" className="text-[17px] font-extrabold text-ink">
              Know your limits
            </h3>
            {limits?.impact_level_code ? (
              <div className="mt-[7px] flex flex-wrap gap-1.5 text-[11.5px] font-bold">
                <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-brand">
                  {limits.impact_level_code}
                  {limits.impact_level_name ? ` · ${limits.impact_level_name}` : ''}
                </span>
                {limits.policy_version ? <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-700">Policy v{limits.policy_version}</span> : null}
                {from ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-700">
                    {from}
                    {to ? ` – ${to}` : ' onwards'}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-[18px] overflow-y-auto px-4 pb-5 pt-4 sm:px-[22px]">
          {state.status === 'loading' || state.status === 'idle' ? (
            <div className="space-y-3" aria-label="Loading your limits">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
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
            <>
              <section>
                <p className={EYEBROW}>How you can travel</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Way icon={Plane} label="Flights" muted={!flight.ok}>
                    <div className={`text-[13.5px] font-extrabold ${flight.ok ? 'text-ink' : 'text-slate-500'}`}>{flight.text}</div>
                    {flight.sub ? <div className="mt-0.5 text-[11.5px] text-slate-500">{flight.sub}</div> : null}
                  </Way>
                  <Way icon={TrainFront} label="Train classes" muted={!limits.train_classes_allowed?.length}>
                    <Chips items={limits.train_classes_allowed} />
                  </Way>
                  <Way icon={Car} label="Local travel" muted={!limits.local_conveyance_modes?.length}>
                    <Chips items={limits.local_conveyance_modes} />
                    {limits.vehicle_rate_4w || limits.vehicle_rate_2w ? (
                      <div className="mt-1 text-[11.5px] text-slate-500">
                        {[
                          limits.vehicle_rate_4w ? `Own car ${rupees(limits.vehicle_rate_4w)}/km` : null,
                          limits.vehicle_rate_2w ? `two-wheeler ${rupees(limits.vehicle_rate_2w)}/km` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    ) : null}
                  </Way>
                  <Way icon={limits.twin_sharing_mandatory ? Users : Hotel} label="Hotel room">
                    <div className="text-[13.5px] font-extrabold text-ink">
                      {limits.twin_sharing_mandatory ? 'Twin sharing required' : 'Twin sharing not required'}
                    </div>
                  </Way>
                </div>
              </section>

              <section>
                <p className={EYEBROW}>Spending caps</p>
                {tiers.length ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <form
                        className="relative min-w-[220px] flex-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          findCity(cityQuery);
                        }}
                      >
                        <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          value={cityQuery}
                          onChange={(e) => setCityQuery(e.target.value)}
                          placeholder="Where are you going? e.g. Mumbai"
                          aria-label="Look up a city"
                          autoComplete="off"
                          className="h-9 w-full rounded-[10px] border border-slate-200 pl-8 pr-2.5 text-[13px] text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                        />
                        {suggestions.length ? (
                          <ul className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-56 overflow-y-auto rounded-[10px] border border-slate-200 bg-white py-1 shadow-lg">
                            {suggestions.map((name) => (
                              <li key={name}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCityQuery(name);
                                    findCity(name);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  <MapPin size={13} className="text-slate-400" /> {name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </form>
                      <div className="inline-flex flex-wrap rounded-[10px] bg-slate-100 p-[3px]" role="group" aria-label="City group">
                        {tiers.map((t) => (
                          <button
                            key={t.city_group}
                            type="button"
                            aria-pressed={t.city_group === tier?.city_group}
                            onClick={() => {
                              setGroup(t.city_group);
                              setLookup({ status: 'idle', city: '', group: null });
                              setCityQuery('');
                            }}
                            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold ${
                              t.city_group === tier?.city_group ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {t.city_group_name}
                            {t.is_default ? ' · other cities' : ''}
                          </button>
                        ))}
                      </div>
                    </div>

                    <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-slate-700">
                      {lookup.status === 'found' ? (
                        <>
                          <MapPin size={14} className="text-brand" />
                          <span>
                            <b className="text-ink">{lookup.city}</b> is in <b className="text-ink">{lookup.groupName || tier?.city_group_name}</b>. Your caps there:
                          </span>
                        </>
                      ) : lookup.status === 'loading' ? (
                        <span className="text-slate-500">Looking up {lookup.city}…</span>
                      ) : lookup.status === 'error' ? (
                        <span className="text-slate-500">Couldn&apos;t look up {lookup.city}. Pick its group below instead.</span>
                      ) : (
                        <span>
                          Showing <b className="text-ink">{tier?.city_group_name}</b>
                          {tier?.is_default ? ' (any city not in another group)' : ''}.
                        </span>
                      )}
                    </p>

                    <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {CAP_ROWS.map(({ key, label, icon: Icon }) => {
                        const cap = tier?.[key];
                        const amount = rupees(cap?.amount);
                        return (
                          <div key={key} className="flex flex-col gap-1 rounded-xl border border-slate-200 px-3 py-[11px]">
                            <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-slate-500">
                              <Icon size={13} /> {label}
                            </span>
                            {amount ? (
                              <>
                                <span className="font-mono text-lg font-semibold tabular-nums text-ink">{amount}</span>
                                <CapTag strict={cap.is_hard_block} />
                              </>
                            ) : (
                              <span className="text-[13px] font-semibold text-slate-400">No cap</span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-2.5 grid gap-2 text-[11.5px] text-slate-500 sm:grid-cols-2">
                      <div className="flex items-start gap-1.5">
                        <CapTag strict />
                        Going over stops the claim until an exception is approved.
                      </div>
                      <div className="flex items-start gap-1.5">
                        <CapTag strict={false} />
                        You can go over, but your approver sees it on the claim.
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">No expense caps are set for your impact level.</p>
                )}
              </section>

              {tiers.length > 1 ? (
                <details className="group rounded-xl border border-slate-200">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[12.5px] font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
                    Compare all groups
                    <ChevronDown size={16} className="text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="overflow-x-auto border-t border-slate-100">
                    <table className="w-full min-w-[420px] text-[12.5px]">
                      <thead>
                        <tr>
                          <th className="bg-slate-50 px-3 py-2 text-left" scope="col">
                            <span className="sr-only">Expense</span>
                          </th>
                          {tiers.map((t) => (
                            <th
                              key={t.city_group}
                              scope="col"
                              className={`px-3 py-2 text-right text-[11px] font-extrabold ${t.city_group === tier?.city_group ? 'bg-brand/10 text-brand' : 'bg-slate-50 text-slate-500'}`}
                            >
                              {t.city_group_name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {CAP_ROWS.map((row) => (
                          <tr key={row.key} className="border-t border-slate-100">
                            <th scope="row" className="px-3 py-2 text-left font-semibold text-slate-700">
                              {row.label}
                            </th>
                            {tiers.map((t) => {
                              const cap = t[row.key];
                              const amount = rupees(cap?.amount);
                              return (
                                <td
                                  key={t.city_group}
                                  className={`px-3 py-2 text-right font-mono font-semibold tabular-nums text-ink ${t.city_group === tier?.city_group ? 'bg-emerald-50/40' : ''}`}
                                >
                                  {amount ? (
                                    <span className="inline-flex items-center justify-end gap-1">
                                      {cap.is_hard_block ? <Lock size={10} className="text-rose-600" aria-label="Strict" /> : null}
                                      {amount}
                                    </span>
                                  ) : (
                                    <span className="font-sans font-normal text-slate-400">No cap</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
