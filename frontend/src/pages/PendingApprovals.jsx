import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Clock, Eye, Filter, RotateCcw, X } from 'lucide-react';
import { useAuthStore, selectResolvedRole } from '../store/authStore';

import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import { useSetPageTitle } from '../context/PageTitleContext';
import { useAsyncAction } from '../hooks/useAsyncAction';
import useToast from '../hooks/useToast';
import { reimbursementApi } from '../services/reimbursementApi';
import { formatCurrency } from '../utils/formatters';

function slaClass(bucket) {
  if (bucket === 'breached') return 'sla-breached';
  if (bucket === 'warning') return 'sla-warning';
  return 'sla-ok';
}

export default function PendingApprovals() {
  useSetPageTitle('Pending Approvals');
  const { showToast } = useToast();
  const role = useAuthStore(selectResolvedRole);
  const profile = useAuthStore((state) => state.profile);
  const [tab, setTab] = useState('claims');
  const [rows, setRows] = useState([]);
  const [travelRows, setTravelRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState({});
  const [slaFilter, setSlaFilter] = useState('ALL');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await reimbursementApi.pendingApprovals();
      setRows(res.data || []);
      
      if (role === 'REPORTING_MANAGER' || profile?.is_acting_delegate) {
        const resp = await reimbursementApi.travelRequestsManagerPending();
        setTravelRows((resp.data || []).map(r => ({ 
          request: r.request, 
          employee_display_name: r.employee_display_name,
          impact_level_code: r.impact_level_code,
          ticket: null 
        })));
      }
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [role, profile?.is_acting_delegate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const { run: approve, loading: acting } = useAsyncAction(async (claimId) => {
    await reimbursementApi.approveClaim(claimId, { comment: '' });
    showToast('Claim approved', 'success');
    await load();
  });

  const onApproveTravel = async (id) => {
    try {
      await reimbursementApi.travelApprove(id);
      showToast('Request approved', 'success');
      await load();
    } catch (e) {
      showToast(e.response?.data?.detail || e.message || 'Approval failed', 'error');
      if (e.response?.status === 409) {
        await load();
      }
    }
  };

  const onRejectTravel = async (id) => {
    const reason = window.prompt('Enter reason for rejection:');
    if (reason === null) return;
    try {
      await reimbursementApi.travelReject(id, { reason });
      showToast('Request rejected', 'success');
      await load();
    } catch (e) {
      showToast(e.response?.data?.detail || e.message || 'Rejection failed', 'error');
      if (e.response?.status === 409) {
        await load();
      }
    }
  };

  const liveSla = (row) => {
    if (!row.sla_deadline_at) return row.sla_remaining_label || '—';
    const diff = new Date(row.sla_deadline_at).getTime() - now;
    if (diff <= 0) return 'SLA Breached';
    const hrs = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hrs}h ${mins}m`;
  };

  const filteredRows = rows.filter((row) => {
    const amount = Number(row.amount || 0);
    const min = Number(minAmount || 0);
    const max = Number(maxAmount || Number.POSITIVE_INFINITY);
    const matchSla = slaFilter === 'ALL' ? true : row.sla_bucket.toUpperCase() === slaFilter;
    return matchSla && amount >= min && amount <= max;
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <p className="text-sm text-slate-600">
          Claims awaiting your review. SLA is driven from workflow configuration (default 48h per
          stage).
        </p>
      </div>
      {(role === 'REPORTING_MANAGER' || profile?.is_acting_delegate) && (
        <div className="mb-6 inline-flex rounded-xl bg-slate-200/60 p-1 shadow-inner">
          <button
            type="button"
            className={`rounded-lg px-5 py-2 text-xs font-bold transition-all duration-200 ${
              tab === 'claims'
                ? 'bg-white text-brand shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => setTab('claims')}
          >
            Claims ({rows.length})
          </button>
          <button
            type="button"
            className={`rounded-lg px-5 py-2 text-xs font-bold transition-all duration-200 ${
              tab === 'travel'
                ? 'bg-white text-brand shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => setTab('travel')}
          >
            Travel Requests ({travelRows.length})
          </button>
        </div>
      )}
      {tab === 'claims' && (
        <div className="panel mb-6 p-4">
          <div className="mb-3.5 flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
            <Filter size={14} />
            <span>Filter Claims</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
              SLA status
              <select className="field mt-0.5" value={slaFilter} onChange={(e) => setSlaFilter(e.target.value)}>
                <option value="ALL">All</option>
                <option value="OK">OK</option>
                <option value="WARNING">Warning</option>
                <option value="BREACHED">Breached</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
              Min Amount
              <input className="field mt-0.5" type="number" min="0" placeholder="Min" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
              Max Amount
              <input className="field mt-0.5" type="number" min="0" placeholder="Max" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                className="btn-secondary w-full gap-2 font-bold"
                onClick={() => { setSlaFilter('ALL'); setMinAmount(''); setMaxAmount(''); }}
              >
                <RotateCcw size={14} />
                <span>Reset</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {error ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
          {error}
        </div>
      ) : null}

      {tab === 'claims' && (
        <div className="panel overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line/60 bg-slate-50/70 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-5 py-3.5">Reference</th>
                <th className="px-5 py-3.5">Employee</th>
                <th className="px-5 py-3.5">Trip</th>
                <th className="px-5 py-3.5">Amount</th>
                <th className="px-5 py-3.5">Exceptions</th>
                <th className="px-5 py-3.5">SLA</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-slate-500">
                    <Skeleton variant="table" rows={4} columns={7} />
                  </td>
                </tr>
              ) : null}
              {!loading && !rows.length ? (
                <tr>
                  <td colSpan={7} className="px-5 py-5">
                    <EmptyState
                      icon="📋"
                      title="No pending approvals"
                      description="You're all caught up! New claims will appear here."
                    />
                  </td>
                </tr>
              ) : null}
              {filteredRows.map((r) => {
                const quickApproveEligible = (r.exceptions_summary || []).every((x) => x === 'Compliant') && r.sla_bucket !== 'breached';
                return (
                  <Fragment key={r.claim_id}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors duration-150">
                      <td className="px-5 py-4 font-bold text-slate-900">{r.claim_reference}</td>
                      <td className="px-5 py-4 font-medium text-slate-800">{r.employee_label}</td>
                      <td className="px-5 py-4 text-slate-600">{r.trip_summary}</td>
                      <td className="px-5 py-4 font-bold text-slate-900">{formatCurrency(r.amount)}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {(r.exceptions_summary || []).map((x) => {
                            const isCompliant = x === 'Compliant';
                            return (
                              <span
                                key={x}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium shadow-sm transition-all duration-150 ${
                                  isCompliant
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-red-50 text-red-700 border-red-200'
                                }`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${isCompliant ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
                                {x}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold ${slaClass(r.sla_bucket)}`}>
                          <Clock size={13} className="shrink-0" />
                          <span>{liveSla(r)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2.5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors duration-150"
                            onClick={() => setExpanded((prev) => ({ ...prev, [r.claim_id]: !prev[r.claim_id] }))}
                          >
                            <span>{expanded[r.claim_id] ? 'Hide' : 'Details'}</span>
                            <ChevronDown
                              size={14}
                              className={`transform transition-transform duration-200 ${
                                expanded[r.claim_id] ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                          <Link
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
                            to={`/claims/${r.claim_id}/review`}
                          >
                            <Eye size={13} />
                            <span>Review</span>
                          </Link>
                          <button
                            type="button"
                            disabled={acting || !quickApproveEligible}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200/60 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 shadow-sm"
                            onClick={() => approve(r.claim_id)}
                          >
                            <Check size={13} />
                            <span>Quick Approve</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded[r.claim_id] ? (
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <td colSpan={7} className="px-5 py-3 text-xs text-slate-600">
                          <div className="flex items-center gap-4 pl-4">
                            <div><strong>Summary:</strong> Total {formatCurrency(r.amount)}</div>
                            <div className="text-slate-300">|</div>
                            <div><strong>Exceptions:</strong> {(r.exceptions_summary || []).length}</div>
                            <div className="text-slate-300">|</div>
                            <div><strong>Destination:</strong> {r.trip_summary}</div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'travel' && (
        <div className="panel overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line/60 bg-slate-50/70 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-5 py-3.5">Employee</th>
                <th className="px-5 py-3.5">When</th>
                <th className="px-5 py-3.5">Route</th>
                <th className="px-5 py-3.5">Mode</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !travelRows.length ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                    <Skeleton variant="table" rows={4} columns={6} />
                  </td>
                </tr>
              ) : null}
              {!loading && !travelRows.length ? (
                <tr>
                  <td colSpan={6} className="px-5 py-5">
                    <EmptyState
                      icon="✈️"
                      title="No pending travel requests"
                      description="You're all caught up!"
                    />
                  </td>
                </tr>
              ) : null}
              {travelRows.map(({ request, employee_display_name }) => (
                <Fragment key={request.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors duration-150">
                    <td className="px-5 py-4 font-medium text-slate-800">{employee_display_name || '—'}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                      {request.trip_type === 'MULTI_CITY' && request.legs?.length > 0 ? request.legs[0].travel_date : request.travel_date}
                    </td>
                    <td className="px-5 py-4 text-slate-800">
                      {request.trip_type === 'MULTI_CITY' && request.legs && request.legs.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {request.legs.map((leg, i) => (
                            <div key={i} className="flex items-center gap-1 text-[11px]">
                              <span>{leg.from_city}</span>
                              <span className="text-slate-400">→</span>
                              <span>{leg.to_city}</span>
                              <span className="text-slate-400 ml-1">({leg.travel_date})</span>
                            </div>
                          ))}
                          <div className="mt-0.5"><span className="inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Multi City</span></div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span>{request.from_city}</span>
                          <span className="text-slate-400">→</span>
                          <span>{request.to_city}</span>
                          {request.trip_type === 'ROUND_TRIP' && (
                            <span className="ml-1 inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Round Trip</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{request.travel_mode}</td>
                    <td className="px-5 py-4">
                      <span className="badge badge-in-approval">{request.status}</span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors duration-150"
                          onClick={() => setExpanded((prev) => ({ ...prev, [`travel_${request.id}`]: !prev[`travel_${request.id}`] }))}
                        >
                          <span>{expanded[`travel_${request.id}`] ? 'Hide' : 'Details'}</span>
                          <ChevronDown
                            size={14}
                            className={`transform transition-transform duration-200 ${
                              expanded[`travel_${request.id}`] ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 active:scale-[0.98] transition-all shadow-sm"
                          onClick={() => onApproveTravel(request.id)}
                        >
                          <Check size={13} />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 active:scale-[0.98] transition-all shadow-sm"
                          onClick={() => onRejectTravel(request.id)}
                        >
                          <X size={13} />
                          <span>Reject</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded[`travel_${request.id}`] ? (
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      <td colSpan={6} className="px-5 py-3 text-xs text-slate-600">
                        <div className="grid grid-cols-2 gap-4 pl-4 max-w-xl">
                          <div><strong>Purpose:</strong> {request.purpose || '—'}</div>
                          <div><strong>Notes:</strong> {request.notes || '—'}</div>
                          <div><strong>Class:</strong> {request.preferred_class || '—'}</div>
                          {request.return_date && <div><strong>Return Date:</strong> {request.return_date}</div>}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

