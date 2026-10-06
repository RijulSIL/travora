import { Fragment, useEffect, useState } from 'react';
import { AlertTriangle, Calendar, Hash, Landmark, ReceiptText, UserCheck, Wallet } from 'lucide-react';

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
  const [filters, setFilters] = useState({ from_date: '', to_date: '', employee: '', status: '' });
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

      <div className="panel grid gap-3 rounded-2xl p-4 md:grid-cols-4">
        <input type="date" className="field" value={filters.from_date} onChange={(e) => setFilters((p) => ({ ...p, from_date: e.target.value }))} />
        <input type="date" className="field" value={filters.to_date} onChange={(e) => setFilters((p) => ({ ...p, to_date: e.target.value }))} />
        <input className="field" placeholder="Employee" value={filters.employee} onChange={(e) => setFilters((p) => ({ ...p, employee: e.target.value }))} />
        <select className="field" value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">All status</option>
          <option value="POSTED">POSTED</option>
          <option value="FAILED">FAILED</option>
          <option value="PENDING">PENDING</option>
        </select>
        <button className="btn-primary md:col-span-4 md:w-fit" onClick={() => load(filters)}>
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
                  <td className="px-5 py-6" colSpan={11}>
                    <Skeleton variant="table" rows={4} columns={11} />
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
                      <td className="px-5 py-4 text-center text-slate-700">{row.claim_reference || `CLM-${row.claim_id}`}</td>
                      <td className="px-5 py-4 text-center text-slate-700">
                        {row.employee_name || '—'}
                        <div className="text-xs font-normal text-slate-400">{row.employee_id}</div>
                      </td>
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
                        <td className="px-5 py-5" colSpan={11}>
                          {row.status === 'FAILED' && row.failure_reason ? (
                            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left">
                              <AlertTriangle size={16} className="mt-0.5 flex-none text-red-500" />
                              <div>
                                <p className="text-xs font-bold text-red-800">Posting failed</p>
                                <p className="text-xs text-red-700">{row.failure_reason}</p>
                              </div>
                            </div>
                          ) : null}
                          <div className="grid gap-4 text-left sm:grid-cols-3">
                            <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm">
                              <div className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                                <ReceiptText size={13} className="text-slate-400" />
                                Expense Breakdown
                              </div>
                              <div className="space-y-1.5">
                                {Object.entries(row.expense_category_breakdown || {}).map(([k, v]) => (
                                  <div key={k} className="flex items-center justify-between gap-3 text-xs">
                                    <span className="text-slate-600">{k}</span>
                                    <span className="font-mono font-semibold text-slate-800">₹{money(v)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm">
                              <div className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                                <Wallet size={13} className="text-slate-400" />
                                Payment Breakdown
                              </div>
                              <div className="space-y-1.5 text-xs">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-slate-600">Total Claimed</span>
                                  <span className="font-mono font-semibold text-slate-800">₹{money(row.total_claimed)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-slate-600">TDS &amp; Other Deductions</span>
                                  <span className="font-mono font-semibold text-amber-700">− ₹{money(row.tds_deduction)}</span>
                                </div>
                                {Number(row.advance_deducted) > 0 ? (
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-600">Advance Deducted</span>
                                    <span className="font-mono font-semibold text-amber-700">− ₹{money(row.advance_deducted)}</span>
                                  </div>
                                ) : null}
                              </div>
                              <div className="mt-3 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold uppercase tracking-wide text-brand/70">Paid via UTR</span>
                                  <span className="font-mono text-base font-bold text-brand">₹{money(row.payment_amount)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm">
                              <div className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                                <Hash size={13} className="text-slate-400" />
                                Reference Info
                              </div>
                              <div className="space-y-2.5 text-xs">
                                <div className="flex items-start gap-2">
                                  <Hash size={13} className="mt-0.5 flex-none text-slate-400" />
                                  <div>
                                    <div className="text-slate-400">Payment Reference</div>
                                    <div className="font-semibold text-slate-800">{row.payment_reference || '—'}</div>
                                  </div>
                                </div>
                                <div className="flex items-start gap-2">
                                  <Calendar size={13} className="mt-0.5 flex-none text-slate-400" />
                                  <div>
                                    <div className="text-slate-400">Payment Date</div>
                                    <div className="font-semibold text-slate-800">
                                      {new Date(row.payment_date).toLocaleString()}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-start gap-2">
                                  <UserCheck size={13} className="mt-0.5 flex-none text-slate-400" />
                                  <div>
                                    <div className="text-slate-400">Posted By</div>
                                    <div className="font-semibold text-slate-800">{row.posted_by_name || '—'}</div>
                                  </div>
                                </div>
                                <div className="flex items-start gap-2">
                                  <Landmark size={13} className="mt-0.5 flex-none text-slate-400" />
                                  <div>
                                    <div className="text-slate-400">ERP Entry / System</div>
                                    <div className="font-semibold text-slate-800">
                                      {row.erp_entry_id || `ERP-${row.id}`}
                                      {row.erp_system ? ` (${row.erp_system})` : ''}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              ) : (
                <tr>
                  <td className="px-5 py-5" colSpan={11}>
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
