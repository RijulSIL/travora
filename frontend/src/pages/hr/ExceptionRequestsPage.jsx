import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { reimbursementApi } from '../../services/reimbursementApi';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';
import { EXCEPTION_TYPE_LABELS, formatExceptionType, formatRole } from '../../utils/formatters';

export default function ExceptionRequestsPage() {
  useSetPageTitle('Exception Requests');
  const role = useAuthStore(selectResolvedRole);
  const [filters, setFilters] = useState({
    status: 'PENDING',
    exception_type: '',
    from_date: '',
    to_date: '',
  });
  const [rows, setRows] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [actionState, setActionState] = useState({});
  const [loadError, setLoadError] = useState(null);
  const didInitialLoad = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.exception_type) params.exception_type = filters.exception_type;
      if (filters.from_date) params.from_date = filters.from_date;
      if (filters.to_date) params.to_date = filters.to_date;
      const res = await reimbursementApi.exceptionRequestsLog(params);
      setRows(res.data || []);
    } catch (err) {
      setLoadError(err);
    }
  }, [filters]);

  useEffect(() => {
    if (didInitialLoad.current) return;
    didInitialLoad.current = true;
    load();
  }, [load]);

  const decideAction = useAsyncAction(async (id, approve) => {
    const comment = actionState[id]?.comment || '';
    await reimbursementApi.decideException(id, { approve, comment });
    setExpandedId(null);
    await load();
  });

  return (
    <>
      <PageHeader title="" />
      
      {/* Sleek Modern Filter Panel */}
      <section className="panel rounded-lg p-5 border border-line/60 shadow-sm bg-white mb-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <span>🔍</span> Filter Exception Requests
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-5">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Status</label>
            <select
              className="field"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All status</option>
              <option value="PENDING">PENDING</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Exception Type</label>
            <select
              className="field"
              value={filters.exception_type}
              onChange={(e) => setFilters({ ...filters, exception_type: e.target.value })}
            >
              <option value="">All types</option>
              {Object.entries(EXCEPTION_TYPE_LABELS).map(([type, label]) => (
                <option key={type} value={type}>{label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">From Date</label>
            <input
              className="field"
              type="date"
              value={filters.from_date}
              onChange={(e) => setFilters({ ...filters, from_date: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">To Date</label>
            <input
              className="field"
              type="date"
              value={filters.to_date}
              onChange={(e) => setFilters({ ...filters, to_date: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full h-10 font-semibold" type="button" onClick={load}>
              Apply Filters
            </button>
          </div>
        </div>
      </section>

      {loadError || decideAction.error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm">
          {(loadError || decideAction.error)?.response?.data?.detail ||
            (loadError || decideAction.error)?.message}
        </div>
      ) : null}

      {/* Premium Card Table */}
      <section className="panel mt-4 rounded-lg overflow-hidden border border-line/60 shadow-sm bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-line">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Exception ID</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Claim Ref</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Employee</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Requested On</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Decided By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60 bg-white">
              {rows.map((row) => {
                const activeDecision = (row.decisions || []).find(
                  (d) => d.status === 'PENDING' || d.status === 'AWAITING'
                );
                const isPendingActive = activeDecision && activeDecision.status === 'PENDING';
                const roleMatches = activeDecision && (
                  activeDecision.required_role === role ||
                  (activeDecision.required_role === 'HRBP_HR' && (role === 'HRBP' || role === 'HRBP_HR'))
                );
                const canUserDecide = isPendingActive && roleMatches;

                const userDecisions = (row.decisions || []).filter(
                  (d) =>
                    d.required_role === role ||
                    (d.required_role === 'HRBP_HR' && (role === 'HRBP' || role === 'HRBP_HR'))
                );
                const hasUserAlreadyActed = userDecisions.some(
                  (d) => d.status === 'APPROVED' || d.status === 'REJECTED'
                );

                return (
                  <Fragment key={row.exception_id}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50/80 transition-colors"
                      onClick={() =>
                        setExpandedId(expandedId === row.exception_id ? null : row.exception_id)
                      }
                    >
                    <td className="px-4 py-3 font-semibold text-slate-800">#{row.exception_id}</td>
                    <td className="px-4 py-3 font-medium text-slate-600" onClick={(e) => e.stopPropagation()}>
                      {row.claim_id ? (
                        <Link
                          to={`/claims/${row.claim_id}`}
                          className="text-brand hover:underline font-semibold flex items-center gap-1"
                        >
                          {row.claim_ref || `CLM-${row.claim_id}`} ↗
                        </Link>
                      ) : (
                        row.claim_ref || '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.employee || '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-semibold bg-slate-100 px-2 py-1 rounded text-slate-700"
                        title={row.exception_type}
                      >
                        {formatExceptionType(row.exception_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.status === 'PENDING' && <span className="badge badge-in-approval">PENDING</span>}
                      {row.status === 'APPROVED' && <span className="badge badge-paid">APPROVED</span>}
                      {row.status === 'REJECTED' && <span className="badge badge-rejected">REJECTED</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(row.requested_on).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-slate-700">{row.decided_by || '—'}</td>
                  </tr>
                  {expandedId === row.exception_id ? (
                    <tr className="bg-slate-50/50">
                      <td colSpan={7} className="px-6 py-5">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                          Exception Request Details
                        </div>
                        
                        <div className="grid gap-5 md:grid-cols-2 p-4 bg-white rounded-lg border border-slate-200/80 shadow-sm">
                          <div className="space-y-3">
                            <div>
                              <span className="font-semibold text-slate-700 text-xs block mb-1">Reason for Exception</span>
                              <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 italic">
                                &quot;{row.description || 'No description provided'}&quot;
                              </p>
                            </div>
                            <div>
                              <span className="font-semibold text-slate-700 text-xs block mb-1">Required Approvers</span>
                              <div className="flex flex-wrap gap-1.5">
                                {(row.required_approvers || []).map((appr) => (
                                  <span key={appr} className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800 border border-slate-200">
                                    {formatRole(appr)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                          
                          <div className="space-y-3">
                            <div>
                              <span className="font-semibold text-slate-700 text-xs block mb-1">Approval Chain Status</span>
                              <div className="space-y-1.5">
                                {(row.decisions || []).map((d, idx) => {
                                  let badgeClass = "bg-slate-100 text-slate-700";
                                  if (d.status === "APPROVED") badgeClass = "bg-green-100 text-green-800 border border-green-200";
                                  if (d.status === "REJECTED") badgeClass = "bg-red-100 text-red-800 border border-red-200";
                                  if (d.status === "PENDING") badgeClass = "bg-amber-100 text-amber-800 border border-amber-200";
                                  return (
                                    <div key={idx} className="flex items-center justify-between text-xs p-2 bg-slate-50 rounded-lg border border-slate-100">
                                      <span className="font-semibold text-slate-600">{formatRole(d.required_role)}</span>
                                      <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded-full font-semibold ${badgeClass}`}>
                                          {d.status}
                                        </span>
                                        {d.comment && (
                                          <span className="text-slate-500 italic max-w-[12rem] truncate" title={d.comment}>
                                            &quot;{d.comment}&quot;
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                                {(!row.decisions || row.decisions.length === 0) && (
                                  <p className="text-xs text-slate-400 italic">No decisions recorded yet.</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {row.status === 'PENDING' && canUserDecide ? (
                          <div className="mt-4 border-t border-slate-200 pt-4 max-w-xl">
                            <span className="font-semibold text-slate-700 text-xs block mb-1.5">Your Decision</span>
                            <textarea
                              className="field min-h-[4.5rem] w-full p-2.5 text-sm rounded-lg border border-line focus:border-brand focus:ring-2 focus:ring-brand/10 transition-shadow bg-white"
                              placeholder="Add an optional comment / reason for your decision..."
                              value={actionState[row.exception_id]?.comment || ''}
                              onChange={(e) =>
                                setActionState((prev) => ({
                                  ...prev,
                                  [row.exception_id]: { comment: e.target.value },
                                }))
                              }
                            />
                            <div className="flex gap-3 mt-3">
                              <button
                                className="btn-primary px-5 py-2 text-sm font-semibold transition-transform hover:scale-[1.01] active:scale-[0.99]"
                                disabled={decideAction.loading}
                                type="button"
                                onClick={() => decideAction.run(row.exception_id, true)}
                              >
                                Approve Exception
                              </button>
                              <button
                                className="btn-secondary border-red-200 hover:bg-red-50 text-red-700 px-5 py-2 text-sm font-semibold transition-transform hover:scale-[1.01] active:scale-[0.99]"
                                disabled={decideAction.loading}
                                type="button"
                                onClick={() => decideAction.run(row.exception_id, false)}
                              >
                                Reject Exception
                              </button>
                            </div>
                          </div>
                        ) : row.status === 'PENDING' ? (
                          <div className="mt-4 border-t border-slate-200 pt-4 max-w-xl">
                            {hasUserAlreadyActed ? (
                              <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 flex items-center gap-2.5 text-xs text-emerald-800 font-bold">
                                <span className="text-sm">✓</span>
                                You have already approved this exception stage. It is now awaiting subsequent approval steps.
                              </div>
                            ) : (
                              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 flex items-center gap-2.5 text-xs text-slate-600 font-semibold">
                                <span className="text-sm">ℹ</span>
                                This exception request is pending approval from: {activeDecision ? formatRole(activeDecision.required_role) : 'next stage'}.
                              </div>
                            )}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 italic bg-slate-50/30">
                    No exception requests found matching the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}