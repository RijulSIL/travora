import { Fragment, useEffect, useState } from 'react';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';

const money = (v) =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ErpLedgerPage() {
  useSetPageTitle('ERP Ledger');
  const [rows, setRows] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [filters, setFilters] = useState({ from_date: '', to_date: '', employee: '', cost_centre: '', status: '' });
  const [loading, setLoading] = useState(true);

  const load = async (next = filters) => {
    setLoading(true);
    try {
      const cleanParams = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== ''));
      const res = await reimbursementApi.erpLedger(cleanParams);
      setRows(res.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-ink">ERP ledger</h2>
      </div>
      <div className="grid gap-2 rounded border border-line bg-white p-3 md:grid-cols-5">
        <input type="date" className="rounded border border-line px-2 py-1 text-sm" value={filters.from_date} onChange={(e) => setFilters((p) => ({ ...p, from_date: e.target.value }))} />
        <input type="date" className="rounded border border-line px-2 py-1 text-sm" value={filters.to_date} onChange={(e) => setFilters((p) => ({ ...p, to_date: e.target.value }))} />
        <input className="rounded border border-line px-2 py-1 text-sm" placeholder="Employee" value={filters.employee} onChange={(e) => setFilters((p) => ({ ...p, employee: e.target.value }))} />
        <input className="rounded border border-line px-2 py-1 text-sm" placeholder="Cost centre" value={filters.cost_centre} onChange={(e) => setFilters((p) => ({ ...p, cost_centre: e.target.value }))} />
        <select className="rounded border border-line px-2 py-1 text-sm" value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">All status</option>
          <option value="POSTED">POSTED</option>
          <option value="FAILED">FAILED</option>
          <option value="PENDING">PENDING</option>
        </select>
        <button className="btn-primary text-sm md:col-span-1" onClick={() => load(filters)}>
          Apply
        </button>
      </div>

      <div className="overflow-x-auto rounded border border-line bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">ERP Entry ID</th>
              <th className="px-3 py-2 text-left">Claim Ref</th>
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">Cost Centre</th>
              <th className="px-3 py-2 text-right">Taxable</th>
              <th className="px-3 py-2 text-right">CGST</th>
              <th className="px-3 py-2 text-right">SGST</th>
              <th className="px-3 py-2 text-right">IGST</th>
              <th className="px-3 py-2 text-left">Payment Ref</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-3 text-slate-500" colSpan={11}>Loading...</td></tr>
            ) : rows.length ? (
              rows.map((row) => (
                <Fragment key={row.id}>
                  <tr className="border-t border-line cursor-pointer" onClick={() => setExpanded((p) => (p === row.id ? null : row.id))}>
                    <td className="px-3 py-2">{row.erp_entry_id || `ERP-${row.id}`}</td>
                    <td className="px-3 py-2">{row.claim_id}</td>
                    <td className="px-3 py-2">{row.employee_id || '—'}</td>
                    <td className="px-3 py-2">{row.cost_centre || '—'}</td>
                    <td className="px-3 py-2 text-right">₹{money(row.taxable_value)}</td>
                    <td className="px-3 py-2 text-right">₹{money(row.cgst)}</td>
                    <td className="px-3 py-2 text-right">₹{money(row.sgst)}</td>
                    <td className="px-3 py-2 text-right">₹{money(row.igst)}</td>
                    <td className="px-3 py-2">{row.payment_reference}</td>
                    <td className="px-3 py-2">{new Date(row.payment_date).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{row.status}</td>
                  </tr>
                  {expanded === row.id ? (
                    <tr className="border-t border-line bg-slate-50">
                      <td className="px-3 py-3" colSpan={11}>
                        <div className="text-xs font-semibold text-slate-600">Expense category breakdown</div>
                        <table className="mt-2 text-xs">
                          <tbody>
                            {Object.entries(row.expense_category_breakdown || {}).map(([k, v]) => (
                              <tr key={k}>
                                <td className="pr-4">{k}</td>
                                <td>₹{money(v)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            ) : (
              <tr><td className="px-3 py-3 text-slate-500" colSpan={11}>No ledger entries found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
