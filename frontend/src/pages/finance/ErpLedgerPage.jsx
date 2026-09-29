import { Fragment, useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';

import EmptyState from '../../components/ui/EmptyState';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { usePagination } from '../../hooks/usePagination';
import { reimbursementApi } from '../../services/reimbursementApi';

const money = (v) =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ERP_STATUS_BADGE = {
  POSTED: 'badge-paid',
  FAILED: 'badge-rejected',
  PENDING: 'badge-in-approval',
};

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

  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(rows);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-ink">ERP ledger</h2>
      </div>

      <div className="panel grid gap-3 rounded-2xl p-4 md:grid-cols-5">
        <input type="date" className="field" value={filters.from_date} onChange={(e) => setFilters((p) => ({ ...p, from_date: e.target.value }))} />
        <input type="date" className="field" value={filters.to_date} onChange={(e) => setFilters((p) => ({ ...p, to_date: e.target.value }))} />
        <input className="field" placeholder="Employee" value={filters.employee} onChange={(e) => setFilters((p) => ({ ...p, employee: e.target.value }))} />
        <input className="field" placeholder="Cost centre" value={filters.cost_centre} onChange={(e) => setFilters((p) => ({ ...p, cost_centre: e.target.value }))} />
        <select className="field" value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">All status</option>
          <option value="POSTED">POSTED</option>
          <option value="FAILED">FAILED</option>
          <option value="PENDING">PENDING</option>
        </select>
        <button className="btn-primary md:col-span-5 md:w-fit" onClick={() => load(filters)}>
          Apply
        </button>
      </div>

      <div className="panel overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/70 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3.5 whitespace-nowrap">S. No</th>
                <th className="px-5 py-3.5">ERP Entry ID</th>
                <th className="px-5 py-3.5">Claim Ref</th>
                <th className="px-5 py-3.5">Employee</th>
                <th className="px-5 py-3.5">Cost Centre</th>
                <th className="px-5 py-3.5">Taxable</th>
                <th className="px-5 py-3.5">CGST</th>
                <th className="px-5 py-3.5">SGST</th>
                <th className="px-5 py-3.5">IGST</th>
                <th className="px-5 py-3.5">Payment Ref</th>
                <th className="px-5 py-3.5">Date</th>
                <th className="px-5 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-5 py-6" colSpan={12}>
                    <Skeleton variant="table" rows={4} columns={12} />
                  </td>
                </tr>
              ) : rows.length ? (
                pageItems.map((row, index) => (
                  <Fragment key={row.id}>
                    <tr
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/50 transition-colors duration-150"
                      onClick={() => setExpanded((p) => (p === row.id ? null : row.id))}
                    >
                      <td className="px-5 py-4 text-center text-slate-500">{startIndex + index + 1}</td>
                      <td className="px-5 py-4 text-center font-semibold text-slate-900">{row.erp_entry_id || `ERP-${row.id}`}</td>
                      <td className="px-5 py-4 text-center text-slate-700">{row.claim_id}</td>
                      <td className="px-5 py-4 text-center text-slate-700">{row.employee_id || '—'}</td>
                      <td className="px-5 py-4 text-center text-slate-600">{row.cost_centre || '—'}</td>
                      <td className="px-5 py-4 text-center text-slate-700">₹{money(row.taxable_value)}</td>
                      <td className="px-5 py-4 text-center text-slate-700">₹{money(row.cgst)}</td>
                      <td className="px-5 py-4 text-center text-slate-700">₹{money(row.sgst)}</td>
                      <td className="px-5 py-4 text-center text-slate-700">₹{money(row.igst)}</td>
                      <td className="px-5 py-4 text-center text-slate-600">{row.payment_reference}</td>
                      <td className="px-5 py-4 text-center text-slate-600">{new Date(row.payment_date).toLocaleDateString()}</td>
                      <td className="px-5 py-4 text-center">
                        <span className={`badge ${ERP_STATUS_BADGE[row.status] || 'badge-draft'}`}>{row.status}</span>
                      </td>
                    </tr>
                    {expanded === row.id ? (
                      <tr className="border-t border-slate-100 bg-slate-50/50">
                        <td className="px-5 py-4" colSpan={12}>
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Expense category breakdown</div>
                          <table className="mt-2 text-xs">
                            <tbody>
                              {Object.entries(row.expense_category_breakdown || {}).map(([k, v]) => (
                                <tr key={k}>
                                  <td className="pr-4 py-0.5 text-center text-slate-600">{k}</td>
                                  <td className="py-0.5 text-center font-semibold text-slate-800">₹{money(v)}</td>
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
                <tr>
                  <td className="px-5 py-5" colSpan={12}>
                    <EmptyState icon={Landmark} title="No ledger entries found" description="Posted claims will appear here." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
      </div>
    </div>
  );
}
