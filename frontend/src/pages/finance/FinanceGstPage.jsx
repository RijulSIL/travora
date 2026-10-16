import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Empty, money, rupees } from '../../components/finance/FinanceParts';
import { BTN_GHOST, CARD, CardHead, Seg } from '../../components/policy/PolicyAdminParts';
import { TipBody, useFloatingTip } from '../../components/ui/FloatingTip';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthBounds = (shift = 0) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + shift + 1, 0);
  return { from_date: toISO(start), to_date: toISO(end), label: start.toLocaleString('en-IN', { month: 'short' }), long: start.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
};
// Indian financial year: 1 April to 31 March.
const financialYear = () => {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from_date: `${startYear}-04-01`, to_date: `${startYear + 1}-03-31` };
};
const PERIODS = [
  { key: 'month', label: 'This month' },
  { key: 'last', label: 'Last month' },
  { key: 'six', label: 'Last 6 months' },
  { key: 'fy', label: 'This financial year' },
  { key: 'custom', label: 'Custom' },
];
const SPLIT = [
  ['CGST', 'cgst', 'bg-sky-500'],
  ['SGST', 'sgst', 'bg-violet-500'],
  ['IGST', 'igst', 'bg-brand'],
];
const SELECT = 'h-8 rounded-[10px] border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700';
const INPUT = 'h-8 rounded-[10px] border border-slate-200 bg-white px-2.5 text-[12.5px] text-ink outline-none focus:border-brand';

function periodRange(period, custom) {
  if (period === 'last') return monthBounds(-1);
  if (period === 'six') return { from_date: monthBounds(-5).from_date, to_date: monthBounds(0).to_date };
  if (period === 'fy') return financialYear();
  if (period === 'custom') return { from_date: custom.from, to_date: custom.to };
  return monthBounds(0);
}

export default function FinanceGstPage() {
  useSetPageTitle('GST Dashboard');
  const [period, setPeriod] = useState('month');
  const [custom, setCustom] = useState({ from: monthBounds(0).from_date, to: monthBounds(0).to_date });
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  // Choices for the three dropdowns, from GET /finance/filter-options (anyone who can view reports).
  const [options, setOptions] = useState({ departments: [], expense_categories: [], impact_levels: [] });
  const [gst, setGst] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exportError, setExportError] = useState('');
  const tip = useFloatingTip();

  const range = periodRange(period, custom);
  const filters = useMemo(
    () => Object.fromEntries(Object.entries({ ...range, department, expense_category: category, impact_level: level }).filter(([k, v]) => v && k !== 'label' && k !== 'long')),
    [range.from_date, range.to_date, department, category, level],
  );
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    reimbursementApi
      .reportFilterOptions()
      .then((r) => setOptions({ departments: [], expense_categories: [], impact_levels: [], ...(r.data || {}) }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const extra = Object.fromEntries(Object.entries(filters).filter(([k]) => k !== 'from_date' && k !== 'to_date'));
    Promise.all([
      reimbursementApi.gstSummary(filters),
      Promise.all(
        Array.from({ length: 6 }).map((_, i) => {
          const b = monthBounds(-(5 - i));
          return reimbursementApi.gstSummary({ from_date: b.from_date, to_date: b.to_date, ...extra }).then((res) => ({ month: b.label, long: b.long, tax: Number(res.data?.total_tax || 0) }));
        }),
      ),
    ])
      .then(([summary, months]) => {
        if (!live) return;
        setGst(summary.data || null);
        setMonthly(months);
      })
      .catch(() => {
        if (!live) return;
        setGst(null);
        setMonthly([]);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [filtersKey]);

  const downloadTotals = async () => {
    setExportError('');
    try {
      const res = await reimbursementApi.exportGstr2b(filters);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gstr2b_export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Could not download the totals. Try again.');
    }
  };

  const total = Number(gst?.total_tax || 0);
  const max = Math.max(...monthly.map((m) => m.tax), 1);

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">GST</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">Tax on paid claims&apos; GST invoices, and how much you can claim back as input tax credit.</p>
        </div>
        <button type="button" className={BTN_GHOST} onClick={downloadTotals}>
          <Download size={14} />
          Download totals (CSV)
        </button>
      </div>
      {exportError ? (
        <p role="alert" className="text-xs text-rose-700">
          {exportError}
        </p>
      ) : null}

      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
        <Seg label="Period" options={PERIODS} value={period} onChange={setPeriod} />
        {period === 'custom' ? (
          <>
            <input aria-label="From" type="date" className={INPUT} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-xs text-slate-500">to</span>
            <input aria-label="To" type="date" className={INPUT} value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </>
        ) : null}
        <select aria-label="Department" className={SELECT} value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {options.departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select aria-label="Expense category" className={SELECT} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {options.expense_categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select aria-label="Level" className={SELECT} value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          {options.impact_levels.map((l) => (
            <option key={l.code} value={l.code}>
              {l.code}
              {l.name ? ` · ${l.name}` : ''}
            </option>
          ))}
        </select>
        {department || category || level ? (
          <button
            type="button"
            className="text-xs font-bold text-brand hover:underline"
            onClick={() => {
              setDepartment('');
              setCategory('');
              setLevel('');
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" aria-busy={loading}>
        <div className="rounded-[14px] border border-slate-200 bg-white px-[15px] py-[13px]">
          <span className="text-[11.5px] font-bold text-slate-500">Total tax</span>
          <b className="mt-1 block font-mono text-[21px] font-semibold tabular-nums text-ink">{loading ? '…' : money(total)}</b>
          <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            {total
              ? SPLIT.map(([label, key, color]) => <span key={label} className={color} style={{ width: `${(Number(gst?.[key] || 0) / total) * 100}%` }} />)
              : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11.5px] text-slate-500">
            {SPLIT.map(([label, key, color]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <i className={`inline-block h-2 w-2 rounded-[3px] ${color}`} />
                {label} {money(gst?.[key])}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-[14px] border border-slate-200 bg-white px-[15px] py-[13px]">
          <span className="text-[11.5px] font-bold text-slate-500">Taxable value</span>
          <b className="mt-1 block font-mono text-[21px] font-semibold tabular-nums text-ink">{loading ? '…' : money(gst?.taxable_value)}</b>
          <small className="mt-0.5 block text-[11.5px] text-slate-500">Before tax, on GST invoices</small>
        </div>
        <div className="rounded-[14px] border border-slate-200 bg-white px-[15px] py-[13px]">
          <span className="text-[11.5px] font-bold text-slate-500">Input tax credit you can claim</span>
          <b className="mt-1 block font-mono text-[21px] font-semibold tabular-nums text-emerald-700">{loading ? '…' : money(gst?.itc_eligible_amount)}</b>
          <small className="mt-0.5 block text-[11.5px] text-slate-500">{total ? `${Math.round((Number(gst?.itc_eligible_amount || 0) / total) * 100)}% of the tax` : 'Nothing yet'}</small>
        </div>
      </div>

      {!loading && !total && !Number(gst?.taxable_value || 0) ? (
        <section className={CARD}>
          <Empty title="No GST invoices on claims paid in this period">Try a longer period, like This financial year, or clear the filters.</Empty>
        </section>
      ) : null}

      <section aria-label="Tax by month" className={CARD}>
        <CardHead title="Tax by month" sub="Last 6 months" />
        <div className="px-4 pb-2.5 pt-3.5">
          <div className="grid h-[170px] grid-cols-6 items-end gap-3 border-b border-slate-200">
            {monthly.map((m) => (
              <div
                key={m.month}
                className="flex h-full flex-col items-center justify-end gap-1.5"
                {...tip.bind(<TipBody title={m.long} amount={money(m.tax)} line="total tax" />)}
              >
                {m.tax ? <span className="font-mono text-[11px] font-bold text-ink">{rupees(m.tax)}</span> : null}
                <div className={`w-3/5 max-w-[46px] rounded-t-md ${m.tax ? 'bg-brand' : 'bg-slate-200'}`} style={{ height: m.tax ? `${Math.max((m.tax / max) * 140, 4)}px` : '2px' }} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-6 gap-3 pt-1.5 text-center text-[11.5px] font-bold text-slate-500">
            {monthly.map((m) => (
              <span key={m.month}>{m.month}</span>
            ))}
          </div>
        </div>
      </section>
      {tip.node}
    </section>
  );
}
