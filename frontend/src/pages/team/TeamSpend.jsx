import { Clock, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { TipBody, useFloatingTip } from '../../components/ui/FloatingTip';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';

/*
 * Team Spend: what a manager's team has claimed and where it goes. Everything is worked out from
 * the team's claims (GET claims/team), so the period / person / type / category filters can apply
 * to every figure. "Approved spend" counts claims that are ready for payment or paid — the same
 * rule as GET claims/team/spend; claims still in approval are shown beside it, never inside it.
 */

const COLORS = ['#0F6B52', '#2563eb', '#f59e0b', '#7c3aed', '#dc2626', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#64748b'];
const OTHER_COLOR = '#94a3b8';
const APPROVED = ['READY_FOR_PAYMENT', 'PAID'];
const IN_APPROVAL = ['SUBMITTED', 'IN_APPROVAL', 'PENDING_EXCEPTION', 'ON_HOLD'];
const TYPES = {
  TRAVEL: { label: 'Travel', pill: 'bg-sky-50 text-sky-700', color: '#2563eb' },
  GENERAL: { label: 'General', pill: 'bg-slate-100 text-slate-600', color: '#64748b' },
  RELOCATION: { label: 'Relocation', pill: 'bg-violet-50 text-violet-700', color: '#7c3aed' },
};
const STATUS_PILL = {
  PAID: ['Paid', 'bg-emerald-50 text-emerald-700'],
  READY_FOR_PAYMENT: ['Waiting for payment', 'bg-amber-50 text-amber-700'],
};
const PERIODS = [
  ['month', 'This month'],
  ['3m', 'Last 3 months'],
  ['6m', 'Last 6 months'],
  ['year', 'This year'],
  ['all', 'All time'],
  ['custom', 'Custom'],
];
const NO_FILTERS = { period: 'all', from: '', to: '', person: '', type: '', category: '' };

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (v) => (v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `₹${(v / 1e3).toFixed(1)}k` : `₹${Math.round(v).toLocaleString('en-IN')}`);
const share = (v, total) => `${(total ? (v / total) * 100 : 0).toFixed(1)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const initials = (name) =>
  String(name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** [start, end] of the chosen period (either may be null = open). */
function periodRange(filters, now) {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (filters.period) {
    case 'month':
      return [new Date(y, m, 1), null];
    case '3m':
      return [new Date(y, m - 2, 1), null];
    case '6m':
      return [new Date(y, m - 5, 1), null];
    case 'year':
      return [new Date(y, 0, 1), null];
    case 'custom':
      return [filters.from ? new Date(`${filters.from}T00:00:00`) : null, filters.to ? new Date(`${filters.to}T23:59:59`) : null];
    default:
      return [null, null];
  }
}

const card = 'overflow-hidden rounded-[14px] border border-slate-200 bg-white';

function CardHead({ title, sub, action }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2.5 border-b border-slate-100 px-4 py-[13px]">
      <div>
        <h2 className="text-sm font-extrabold text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

function Empty({ title, children }) {
  return (
    <div className="px-4 py-8 text-center text-[12.5px] text-slate-500">
      <b className="mb-0.5 block text-[13.5px] text-ink">{title}</b>
      {children}
    </div>
  );
}

/** Ring slice path (viewBox 0 0 210 210, outer radius 105, inner 69). */
function slicePath(from, to) {
  const R = 105;
  const r = 69;
  const p = (rad, ang) => `${105 + rad * Math.cos(ang)} ${105 + rad * Math.sin(ang)}`;
  if (to - from >= Math.PI * 2 - 1e-4) {
    const a = -Math.PI / 2;
    const b = a + Math.PI * 2 - 1e-4;
    return `M ${p(R, a)} A ${R} ${R} 0 1 1 ${p(R, b)} L ${p(r, b)} A ${r} ${r} 0 1 0 ${p(r, a)} Z`;
  }
  const big = to - from > Math.PI ? 1 : 0;
  return `M ${p(R, from)} A ${R} ${R} 0 ${big} 1 ${p(R, to)} L ${p(r, to)} A ${r} ${r} 0 ${big} 0 ${p(r, from)} Z`;
}

function CategoryDonut({ slices, total, centerLabel, selected, onPick, tooltip }) {
  const [hover, setHover] = useState(null);
  let angle = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const from = angle;
    angle += total ? (s.value / total) * Math.PI * 2 : 0;
    return slicePath(from, angle);
  });
  const tipFor = (s) => (
    <TipBody
      title={s.label}
      amount={inr(s.value)}
      line={`${share(s.value, total)} of approved spend`}
      note={`From ${plural(s.claims, 'claim')}${s.others ? ` · ${s.others.join(', ')}` : ''}${s.category && !selected ? ' · click to filter' : ''}`}
    />
  );
  const handlers = (s, i) => ({
    ...tooltip.bind(tipFor(s)),
    onMouseEnter: (e) => {
      setHover(i);
      tooltip.show(tipFor(s), e);
    },
    onMouseLeave: (e) => {
      setHover(null);
      tooltip.bind(null).onMouseLeave(e);
    },
    onClick: (e) => (s.category && !selected ? onPick(s.category) : tooltip.show(tipFor(s), e)),
  });
  return (
    <div className="grid flex-1 items-center justify-items-center gap-5 p-4 sm:grid-cols-[210px_minmax(0,1fr)] sm:justify-items-stretch">
      <div className="relative grid h-[180px] w-[180px] place-items-center sm:h-[210px] sm:w-[210px]">
        <svg viewBox="0 0 210 210" className="h-full w-full overflow-visible" role="img" aria-label="Approved spend by expense category">
          {slices.map((s, i) => (
            <path
              key={s.label}
              d={arcs[i]}
              fill={s.color}
              className="cursor-pointer transition-[opacity,transform] duration-150"
              style={{ transformOrigin: '105px 105px', transform: hover === i ? 'scale(1.04)' : undefined, opacity: hover != null && hover !== i ? 0.35 : 1 }}
              {...handlers(s, i)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute text-center text-[10.5px] font-bold uppercase tracking-[0.05em] text-slate-500">
          {centerLabel}
          <b className="mt-0.5 block font-mono text-[13px] normal-case tracking-normal text-ink">{inr(total)}</b>
        </div>
      </div>
      <div className="flex w-full flex-col gap-2.5 text-[12.5px]">
        {slices.map((s, i) => (
          <button
            key={s.label}
            type="button"
            className={`-mx-1 grid grid-cols-[10px_minmax(0,1fr)_auto_46px] items-center gap-2 rounded-md px-1 py-0.5 text-left ${
              selected && s.category === selected ? 'bg-brand/10' : hover === i ? 'bg-slate-50' : ''
            }`}
            {...handlers(s, i)}
          >
            <i className="block h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
            <span className="truncate text-slate-700">{s.label}</span>
            <span className="font-mono font-semibold tabular-nums text-ink">{inr(s.value)}</span>
            <span className="text-right text-[11px] text-slate-500">{share(s.value, total)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TeamSpend() {
  useSetPageTitle('Team Spend');
  const [claims, setClaims] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(NO_FILTERS);
  const tooltip = useFloatingTip();
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await reimbursementApi.teamClaims();
        if (!cancelled) setClaims(res.data || []);
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.detail || e.message || 'Failed to load spend data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const now = useMemo(() => new Date(), []);
  const team = useMemo(
    () =>
      claims.map((c) => ({
        id: c.id,
        ref: c.claim_reference || `CLM-${c.id}`,
        person: c.employee_name || 'Unknown',
        status: c.status,
        type: c.reimbursement_category || 'TRAVEL',
        submitted: c.submitted_at ? new Date(c.submitted_at) : null,
        from: c.office_location || c.from_city,
        to: c.destination_city,
        expenses: (c.expenses || []).map((e) => ({ category: e.category_name || 'Other', amount: Number(e.amount || 0) })),
      })),
    [claims],
  );
  const peopleOptions = useMemo(() => [...new Set(team.map((c) => c.person))].sort(), [team]);
  const categoryOptions = useMemo(() => [...new Set(team.flatMap((c) => c.expenses.map((e) => e.category)))].sort(), [team]);

  const [start, end] = periodRange(filters, now);
  const inPeriod = (c) => (!start || (c.submitted && c.submitted >= start)) && (!end || (c.submitted && c.submitted <= end));
  const otherFilters = (c) =>
    (!filters.person || c.person === filters.person) &&
    (!filters.type || c.type === filters.type) &&
    (!filters.category || c.expenses.some((e) => e.category === filters.category));
  // With a category picked, a claim counts only that category's expenses.
  const amountOf = (c) => c.expenses.reduce((sum, e) => sum + (!filters.category || e.category === filters.category ? e.amount : 0), 0);
  const sum = (list) => list.reduce((s, c) => s + amountOf(c), 0);

  const scoped = team.filter((c) => inPeriod(c) && otherFilters(c));
  const approved = scoped.filter((c) => APPROVED.includes(c.status));
  const inApproval = scoped.filter((c) => IN_APPROVAL.includes(c.status));
  const paid = approved.filter((c) => c.status === 'PAID');
  const ready = approved.filter((c) => c.status === 'READY_FOR_PAYMENT');
  const total = sum(approved);

  // Where it goes: up to eight categories by name; past that the smallest share one "Other".
  const byCategory = {};
  approved.forEach((c) =>
    c.expenses.forEach((e) => {
      if (filters.category && e.category !== filters.category) return;
      byCategory[e.category] = byCategory[e.category] || { value: 0, claims: new Set() };
      byCategory[e.category].value += e.amount;
      byCategory[e.category].claims.add(c.id);
    }),
  );
  const ranked = Object.entries(byCategory).sort((a, b) => b[1].value - a[1].value);
  const named = ranked.length <= 8 ? ranked : ranked.slice(0, 7);
  const rest = ranked.length <= 8 ? [] : ranked.slice(7);
  const slices = [
    ...named.map(([label, o], i) => ({ label, category: label, value: o.value, claims: o.claims.size, color: COLORS[i % COLORS.length] })),
    ...(rest.length
      ? [
          {
            label: 'Other',
            category: null,
            value: rest.reduce((s, [, o]) => s + o.value, 0),
            claims: new Set(rest.flatMap(([, o]) => [...o.claims])).size,
            others: rest.map(([label]) => label),
            color: OTHER_COLOR,
          },
        ]
      : []),
  ];

  const byType = Object.keys(TYPES).map((key) => {
    const list = approved.filter((c) => c.type === key);
    return { key, value: sum(list), count: list.length };
  });
  const maxType = Math.max(...byType.map((t) => t.value), 1);

  // Always the last 12 months (the trend), with the chosen period's months highlighted.
  const months = Array.from({ length: 12 }, (_, i) => {
    const first = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 23, 59, 59);
    const list = team.filter((c) => otherFilters(c) && APPROVED.includes(c.status) && c.submitted && c.submitted >= first && c.submitted <= last);
    return {
      key: `${first.getFullYear()}-${first.getMonth()}`,
      label: first.toLocaleDateString('en-IN', { month: 'short' }),
      name: first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      value: sum(list),
      count: list.length,
      inPeriod: (!start || last >= start) && (!end || first <= end),
    };
  });
  const maxMonth = Math.max(...months.map((m) => m.value), 1);

  const people = [...new Set(scoped.map((c) => c.person))]
    .map((name) => {
      const a = approved.filter((c) => c.person === name);
      const f = inApproval.filter((c) => c.person === name);
      return { name, approved: a, inApproval: f, approvedValue: sum(a), inApprovalValue: sum(f) };
    })
    .sort((a, b) => b.approvedValue - a.approvedValue);

  const biggest = [...approved].sort((a, b) => amountOf(b) - amountOf(a)).slice(0, 5);
  const claimSub = (c) =>
    c.type === 'TRAVEL' && c.to
      ? `${c.from || '…'} → ${c.to}`
      : `${c.expenses
          .map((e) => e.category)
          .slice(0, 2)
          .join(', ')}${c.expenses.length > 2 ? ` +${c.expenses.length - 2} more` : ''}`;

  const periodLabel =
    filters.period === 'custom'
      ? filters.from || filters.to
        ? `${filters.from || '…'} to ${filters.to || 'today'}`
        : 'Custom dates'
      : PERIODS.find(([k]) => k === filters.period)?.[1];
  const chips = [
    filters.period !== 'all' ? ['period', periodLabel] : null,
    filters.person ? ['person', filters.person] : null,
    filters.type ? ['type', TYPES[filters.type].label] : null,
    filters.category ? ['category', filters.category] : null,
  ].filter(Boolean);
  const nothingApproved = (title) => (
    <Empty title={title}>
      {inApproval.length ? `${inr(sum(inApproval))} is still in approval for these filters.` : 'Try a longer period or clear the filters.'}
    </Empty>
  );
  const selectBox = (on) =>
    `inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-bold text-slate-500 ${on ? 'border-brand bg-brand/[0.04]' : 'border-slate-200 bg-white'}`;
  const selectInput = 'max-w-[200px] bg-transparent text-[12.5px] font-semibold text-ink outline-none';

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Team spend</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">What your team has claimed, and where it goes.</p>
        </div>
        <Link to="/team/claims" className="text-[12.5px] font-bold text-brand hover:text-brand/80">
          See team claims →
        </Link>
      </div>

      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
        <div role="group" aria-label="Period" className="inline-flex flex-wrap gap-0.5 rounded-[10px] bg-slate-100 p-[3px]">
          {PERIODS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters.period === key}
              onClick={() => setFilter('period', key)}
              className={`rounded-[7px] px-2.5 py-[5px] text-xs font-bold ${filters.period === key ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {filters.period === 'custom' ? (
          <>
            <label className={selectBox(true)}>
              From
              <input type="date" className={selectInput} value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
            </label>
            <label className={selectBox(true)}>
              To
              <input type="date" className={selectInput} value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
            </label>
          </>
        ) : null}
        <label className={selectBox(filters.person)}>
          Person
          <select className={selectInput} value={filters.person} onChange={(e) => setFilter('person', e.target.value)}>
            <option value="">Everyone</option>
            {peopleOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className={selectBox(filters.type)}>
          Type
          <select className={selectInput} value={filters.type} onChange={(e) => setFilter('type', e.target.value)}>
            <option value="">All types</option>
            {Object.entries(TYPES).map(([key, t]) => (
              <option key={key} value={key}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className={selectBox(filters.category)}>
          Category
          <select className={selectInput} value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
            <option value="">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 py-[3px] pl-2.5 pr-1 text-[11.5px] font-bold text-brand">
              {label}
              <button
                type="button"
                aria-label={`Remove ${label}`}
                className="grid h-[18px] w-[18px] place-items-center rounded-full bg-white"
                onClick={() =>
                  key === 'period' ? setFilters((prev) => ({ ...prev, period: 'all', from: '', to: '' })) : setFilter(key, '')
                }
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <button type="button" className="px-1 text-xs font-bold text-brand" onClick={() => setFilters(NO_FILTERS)}>
            Clear all
          </button>
        </div>
      ) : null}

      {error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[13px] text-amber-900">{error}</div> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
          <Clock className="animate-spin text-slate-400" size={15} /> Loading team spend…
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {[
              { label: 'Approved spend', value: total, sub: `${plural(approved.length, 'claim')}, approved or paid`, main: true },
              { label: 'Paid out', value: sum(paid), sub: plural(paid.length, 'claim') },
              { label: 'Waiting for payment', value: sum(ready), sub: `${plural(ready.length, 'claim')} approved, not paid yet` },
              { label: 'Still in approval', value: sum(inApproval), sub: `${plural(inApproval.length, 'claim')} · not in spend yet` },
            ].map((t) => (
              <div
                key={t.label}
                className={`rounded-[14px] border px-3.5 py-3 ${t.main ? 'border-brand bg-gradient-to-b from-[#f4faf7] to-white' : 'border-slate-200 bg-white'}`}
              >
                <div className="text-[11.5px] font-bold text-slate-500">{t.label}</div>
                <div className={`mt-[3px] font-mono text-lg font-semibold tabular-nums sm:text-xl ${t.main ? 'text-brand' : 'text-ink'}`}>{inr(t.value)}</div>
                <div className="mt-0.5 text-[11.5px] text-slate-500">{t.sub}</div>
              </div>
            ))}
          </div>

          <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <section className={`${card} flex flex-col`} aria-label="Where it goes">
              <CardHead title="Where it goes" sub={`Approved spend by expense category${filters.category ? '' : ' · click one to filter'}`} />
              {total ? (
                <CategoryDonut
                  slices={slices}
                  total={total}
                  centerLabel={filters.category ? 'In category' : 'Approved'}
                  selected={filters.category}
                  onPick={(category) => setFilter('category', category)}
                  tooltip={tooltip}
                />
              ) : (
                nothingApproved('No approved spend for these filters')
              )}
            </section>
            <div className="flex flex-col gap-3">
              <section className={card} aria-label="By claim type">
                <CardHead title="By claim type" />
                <div className="flex flex-col gap-[9px] px-4 pb-4 pt-3.5">
                  {byType.map((t) => (
                    <div
                      key={t.key}
                      className="grid cursor-pointer grid-cols-[84px_minmax(0,1fr)_96px] items-center gap-2.5 text-xs sm:grid-cols-[96px_minmax(0,1fr)_110px]"
                      {...tooltip.bind(
                        <TipBody title={TYPES[t.key].label} amount={inr(t.value)} line={`${share(t.value, total)} of approved spend`} note={plural(t.count, 'claim')} />,
                      )}
                    >
                      <span className="text-slate-700">
                        {TYPES[t.key].label} <small className="text-slate-400">({t.count})</small>
                      </span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <i className="block h-full rounded-full" style={{ width: `${t.value ? Math.max(2, (t.value / maxType) * 100) : 0}%`, background: TYPES[t.key].color }} />
                      </span>
                      <span className="text-right font-mono font-semibold tabular-nums text-ink">{inr(t.value)}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className={card} aria-label="By month">
                <CardHead title="By month" sub="Approved spend, last 12 months · green = in the chosen period" />
                <div className="px-4 pb-3.5 pt-4">
                  <div className="grid h-[140px] grid-cols-12 items-end gap-1.5">
                    {months.map((m) => (
                      <div
                        key={m.key}
                        className="flex h-full cursor-pointer flex-col items-center justify-end gap-1"
                        {...tooltip.bind(
                          <TipBody title={m.name} amount={inr(m.value)} line="approved" note={`${plural(m.count, 'claim')}${m.inPeriod ? '' : ' · outside the chosen period'}`} />,
                        )}
                      >
                        <small className="whitespace-nowrap font-mono text-[10px] text-slate-500">{m.value ? compact(m.value) : ''}</small>
                        <i
                          className={`block w-full max-w-[38px] rounded-t-md rounded-b-sm ${m.value ? 'bg-brand' : 'bg-slate-200'} ${m.inPeriod ? '' : 'opacity-35'}`}
                          style={{ height: m.value ? `${Math.max(4, (m.value / maxMonth) * 110)}px` : '2px' }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 grid grid-cols-12 gap-1.5 text-center text-[11px] font-bold text-slate-500">
                    {months.map((m) => (
                      <span key={m.key} className={m.inPeriod ? '' : 'opacity-45'}>
                        {m.label.slice(0, 3)}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>

          <section className={card} aria-label="By person">
            <CardHead title="By person" sub={`${plural(people.length, 'team member')} with claims${chips.length ? ' for these filters' : ''}`} />
            {people.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold text-slate-500">
                      <th className="px-4 py-[9px]">Person</th>
                      <th className="px-4 py-[9px] text-right">Approved spend</th>
                      <th className="px-4 py-[9px] text-right">Still in approval</th>
                      <th className="w-[28%] px-4 py-[9px]">Share of approved spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.name} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-4 py-[11px]">
                          <div className="flex items-center gap-2.5">
                            <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-brand/10 text-xs font-extrabold text-brand">{initials(p.name)}</span>
                            <div>
                              <b className="block text-ink">{p.name}</b>
                              <span className="text-[11.5px] text-slate-500">
                                {p.approved.length} approved · {p.inApproval.length} in approval
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-[11px] text-right font-mono font-semibold tabular-nums text-ink">{inr(p.approvedValue)}</td>
                        <td className="px-4 py-[11px] text-right font-mono tabular-nums">{p.inApprovalValue ? inr(p.inApprovalValue) : '—'}</td>
                        <td className="px-4 py-[11px]">
                          <div
                            className="flex cursor-pointer items-center gap-2"
                            {...tooltip.bind(
                              <TipBody
                                title={p.name}
                                amount={inr(p.approvedValue)}
                                line={`${share(p.approvedValue, total)} of approved spend`}
                                note={`${plural(p.approved.length, 'approved claim')} · ${inr(p.inApprovalValue)} still in approval`}
                              />,
                            )}
                          >
                            <span className="h-2 min-w-[60px] flex-1 overflow-hidden rounded-full bg-slate-100">
                              <i className="block h-full rounded-full bg-brand" style={{ width: `${total ? (p.approvedValue / total) * 100 : 0}%` }} />
                            </span>
                            <span className="font-mono text-[11.5px]">{total ? ((p.approvedValue / total) * 100).toFixed(0) : 0}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No one matches">Try clearing the filters.</Empty>
            )}
          </section>

          <section className={card} aria-label="Biggest claims">
            <CardHead
              title="Biggest claims"
              sub={`Top five approved claims${filters.category ? ` · ${filters.category} part only` : ''}`}
              action={
                <Link to="/team/claims" className="text-[12.5px] font-bold text-brand hover:text-brand/80">
                  All team claims →
                </Link>
              }
            />
            {biggest.length ? (
              biggest.map((c) => {
                const [statusLabel, statusPill] = STATUS_PILL[c.status] || [c.status, 'bg-slate-100 text-slate-600'];
                return (
                  <Link
                    key={c.id}
                    to={`/claims/${c.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-slate-100 px-4 py-[11px] first:border-t-0 hover:bg-[#fbfdfc] sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                  >
                    <div className="col-start-1 row-start-1 min-w-0">
                      <b className="text-[13px] text-ink">{c.ref}</b>{' '}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TYPES[c.type]?.pill || TYPES.TRAVEL.pill}`}>{TYPES[c.type]?.label || c.type}</span>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {c.person} · {claimSub(c)}
                        {c.submitted ? ` · submitted ${c.submitted.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                      </div>
                    </div>
                    <span className={`col-start-1 row-start-2 justify-self-start whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold sm:col-start-2 sm:row-start-1 ${statusPill}`}>
                      {statusLabel}
                    </span>
                    <b className="col-start-2 row-start-1 self-start text-right font-mono text-[13px] tabular-nums text-ink sm:col-start-3 sm:self-center">{inr(amountOf(c))}</b>
                  </Link>
                );
              })
            ) : (
              nothingApproved('No approved claims for these filters')
            )}
          </section>

          <p className="text-[11.5px] text-slate-400">
            Approved spend counts claims that are ready for payment or paid. Claims still in approval are shown separately and aren&apos;t counted. The
            period goes by the date each claim was submitted.
          </p>
        </>
      ) : null}

      {tooltip.node}
    </section>
  );
}
