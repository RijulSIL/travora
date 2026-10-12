import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthBounds = (shift = 0) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + shift + 1, 0);
  return { from_date: toISO(start), to_date: toISO(end), label: start.toLocaleString('en-IN', { month: 'short' }) };
};

const fmtMoney = (v) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function FinanceGstPage() {
  useSetPageTitle('GST Dashboard');
  const [gst, setGst] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ ...monthBounds(0), department: '', expense_category: '', impact_level: '' });

  const run = async (payload) => {
    setLoading(true);
    try {
      const [summaryRes, monthlyRes] = await Promise.all([
        reimbursementApi.gstSummary(payload),
        Promise.all(
          Array.from({ length: 6 }).map((_, i) => {
            const bounds = monthBounds(-(5 - i));
            return reimbursementApi.gstSummary(bounds).then((res) => ({
              month: bounds.label,
              totalTax: Number(res.data?.total_tax || 0),
            }));
          }),
        ),
      ]);
      setGst(summaryRes.data || null);
      setMonthly(monthlyRes || []);
    } catch {
      setGst(null);
      setMonthly([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run(filters);
  }, []);

  const onFilterChange = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const cards = useMemo(
    () => [
      ['Total Taxable', gst?.taxable_value],
      ['CGST', gst?.cgst],
      ['SGST', gst?.sgst],
      ['IGST', gst?.igst],
      ['Total Tax', gst?.total_tax],
      ['ITC Eligible', gst?.itc_eligible_amount],
    ],
    [gst],
  );

  const downloadGstr2b = async () => {
    const res = await reimbursementApi.exportGstr2b(filters);
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gstr2b_export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-ink">GST dashboard</h2>
          <p className="mt-1 text-sm text-slate-600">Summary, monthly breakdown, and GSTR-2B export.</p>
        </div>
        <button className="btn-secondary" onClick={downloadGstr2b}>
          Export GSTR-2B
        </button>
      </div>

      <div className="panel grid gap-3 rounded-2xl p-4 md:grid-cols-5">
        <input className="field" type="date" value={filters.from_date} onChange={(e) => onFilterChange('from_date', e.target.value)} />
        <input className="field" type="date" value={filters.to_date} onChange={(e) => onFilterChange('to_date', e.target.value)} />
        <input className="field" placeholder="Department" value={filters.department} onChange={(e) => onFilterChange('department', e.target.value)} />
        <input className="field" placeholder="Expense category" value={filters.expense_category} onChange={(e) => onFilterChange('expense_category', e.target.value)} />
        <input className="field" placeholder="Impact level" value={filters.impact_level} onChange={(e) => onFilterChange('impact_level', e.target.value)} />
        <button className="btn-primary md:col-span-5 md:w-fit" onClick={() => run(filters)}>
          Apply Filters
        </button>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {loading ? (
          <p className="text-sm text-slate-600">Loading GST summary…</p>
        ) : gst ? (
          cards.map(([label, value]) => (
            <div key={label} className="stat-card">
              <div className="stat-card-label">{label}</div>
              <div className="stat-card-value text-lg">₹{fmtMoney(value)}</div>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-600">GST summary unavailable for this slice.</p>
        )}
      </section>

      <section className="panel rounded-2xl p-5">
        <h3 className="mb-4 text-[15px] font-bold text-ink">Monthly GST breakdown (last 6 months)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthly} layout="vertical" margin={{ top: 5, right: 24, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
            <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis type="category" dataKey="month" axisLine={false} tickLine={false} width={48} tick={{ fontSize: 12, fill: '#475569', fontWeight: 600 }} />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
              formatter={(value) => [`₹${fmtMoney(value)}`, 'Total Tax']}
            />
            <Bar dataKey="totalTax" name="Total Tax" fill="#116149" radius={[0, 4, 4, 0]} barSize={18} animationDuration={600} />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}
