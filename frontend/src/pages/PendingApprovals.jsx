import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  Armchair,
  Bus,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Eye,
  FileText,
  Filter,
  GitBranch,
  Layers,
  MessageSquare,
  Plane,
  RotateCcw,
  TrainFront,
  X,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

import ClaimReviewModal from '../components/claims/ClaimReviewModal';
import TravelRequestProgress from '../components/travel/TravelRequestProgress';
import EmptyState from '../components/ui/EmptyState';
import ReimbursementCategoryBadge from '../components/ui/ReimbursementCategoryBadge';
import Skeleton from '../components/ui/Skeleton';
import { useSetPageTitle } from '../context/PageTitleContext';
import { useAsyncAction } from '../hooks/useAsyncAction';
import useToast from '../hooks/useToast';
import { reimbursementApi } from '../services/reimbursementApi';
import { formatCurrency } from '../utils/formatters';
import { normalizeApiError } from '../utils/apiErrors';

const TRAVEL_MODE_ICONS = { BUS: Bus, TRAIN: TrainFront, FLIGHT: Plane };

const REIMBURSEMENT_TYPE_OPTIONS = [
  { value: 'TRAVEL', label: 'Travel' },
  { value: 'GENERAL', label: 'General' },
  { value: 'REALLOCATION', label: 'Reallocation' },
];

const titleCase = (value) =>
  String(value || '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');

const formatRequestedAt = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

export default function PendingApprovals() {
  useSetPageTitle('Pending Approvals');
  const { showToast } = useToast();
  const profile = useAuthStore((state) => state.profile);
  const [searchParams] = useSearchParams();
  // Which tab shows is now driven entirely by the sidebar's Claims/Travel Requests submenu
  // (see navConfig.js's PENDING_APPROVALS_SUBMENU) rather than an in-page switcher — this just
  // reads whatever `?tab=` the sidebar link navigated to.
  const [tab, setTabState] = useState(searchParams.get('tab') === 'travel' ? 'travel' : 'claims');

  useEffect(() => {
    setTabState(searchParams.get('tab') === 'travel' ? 'travel' : 'claims');
  }, [searchParams]);
  const [rows, setRows] = useState([]);
  const [travelRows, setTravelRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState({});
  const [slaFilter, setSlaFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [reviewClaimId, setReviewClaimId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await reimbursementApi.pendingApprovals();
      setRows(res.data || []);

      // Whether the travel-request queue is fetched at all is driven by the live Approval
      // Matrix (profile.approver_scope.travel_request, computed server-side by
      // get_approver_scope) instead of a hardcoded role allowlist — that list kept going stale
      // every time an admin changed which role a travel-request stage routes to. The backend
      // route's own require_role(...) gate stays a coarser allowlist of roles that *could* ever
      // be configured — this is the finer, live check of whether this role actually is right now.
      if (profile?.approver_scope?.travel_request || profile?.is_acting_delegate) {
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
  }, [profile?.approver_scope?.travel_request, profile?.is_acting_delegate]);

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
      showToast(normalizeApiError(e).message, 'error');
      if (e.response?.status === 409) {
        await load();
      }
    }
  };

  const onRejectTravel = async (id) => {
    const reason = window.prompt('Enter reason for rejection:');
    if (reason === null) return;
    if (!reason.trim()) {
      showToast('A rejection reason is required', 'error');
      return;
    }
    try {
      await reimbursementApi.travelReject(id, { reason: reason.trim() });
      showToast('Request rejected', 'success');
      await load();
    } catch (e) {
      showToast(normalizeApiError(e).message, 'error');
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
    const matchCategory =
      categoryFilter === 'ALL' ? true : (row.reimbursement_category || 'TRAVEL') === categoryFilter;
    return matchSla && matchCategory && amount >= min && amount <= max;
  });

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-slate-600">
          Claims awaiting your review. SLA is driven from workflow configuration (default 48h per
          stage).
        </p>
      </div>
      {tab === 'claims' && (
        <div className="panel mb-6 p-4">
          <div className="mb-3.5 flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
            <Filter size={14} />
            <span>Filter Claims</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-5">
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
              Reimbursement type
              <select className="field mt-0.5" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="ALL">All</option>
                {REIMBURSEMENT_TYPE_OPTIONS.filter(
                  (opt) =>
                    !profile?.approver_scope?.claim_categories?.length ||
                    profile.approver_scope.claim_categories.includes(opt.value)
                ).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
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
                onClick={() => { setSlaFilter('ALL'); setCategoryFilter('ALL'); setMinAmount(''); setMaxAmount(''); }}
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
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line/60 bg-slate-50/70 text-center text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-5 py-3.5 whitespace-nowrap">S. No</th>
                <th className="px-5 py-3.5 whitespace-nowrap">Reference</th>
                <th className="px-5 py-3.5 whitespace-nowrap">Employee</th>
                <th className="px-5 py-3.5 whitespace-nowrap">Trip</th>
                <th className="px-5 py-3.5 whitespace-nowrap">Amount</th>
                <th className="px-5 py-3.5">Exceptions</th>
                <th className="px-5 py-3.5 whitespace-nowrap">SLA</th>
                <th className="px-5 py-3.5 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length ? (
                <tr>
                  <td colSpan={8} className="px-5 py-6 text-center text-slate-500">
                    <Skeleton variant="table" rows={4} columns={8} />
                  </td>
                </tr>
              ) : null}
              {!loading && !rows.length ? (
                <tr>
                  <td colSpan={8} className="px-5 py-5">
                    <EmptyState
                      title="No pending approvals"
                      description="You're all caught up! New claims will appear here."
                    />
                  </td>
                </tr>
              ) : null}
              {filteredRows.map((r, index) => {
                const quickApproveEligible = (r.exceptions_summary || []).every((x) => x === 'Compliant') && r.sla_bucket !== 'breached';
                const slaBadge =
                  r.sla_bucket === 'breached'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : r.sla_bucket === 'warning'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
                return (
                  <tr key={r.claim_id} className="border-b border-slate-100 align-middle hover:bg-slate-50/50 transition-colors duration-150">
                    <td className="px-5 py-4 text-center text-slate-500">{index + 1}</td>
                    <td className="px-5 py-4 text-center font-bold text-slate-900">
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <span className="whitespace-nowrap">{r.claim_reference}</span>
                        <ReimbursementCategoryBadge category={r.reimbursement_category} />
                      </div>
                    </td>
                    <td className="px-5 py-4 text-center font-medium text-slate-800 whitespace-nowrap">{r.employee_label}</td>
                    <td className="px-5 py-4 text-center text-slate-600 whitespace-nowrap">
                      {(() => {
                        const [route, dates] = (r.trip_summary || '—').split(' · ');
                        return (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-medium text-slate-800">{route}</span>
                            {dates ? <span className="text-xs text-slate-500">{dates}</span> : null}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-4 text-center font-bold tabular-nums text-slate-900 whitespace-nowrap">
                      {formatCurrency(r.amount)}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {(r.exceptions_summary || []).map((x) => {
                          const isCompliant = x === 'Compliant';
                          return (
                            <span
                              key={x}
                              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium shadow-sm transition-all duration-150 ${
                                isCompliant
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-red-50 text-red-700 border-red-200'
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isCompliant ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
                              {x}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-center whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm ${slaBadge}`}>
                        <Clock size={12} className={`shrink-0 ${r.sla_bucket === 'breached' ? 'animate-pulse' : ''}`} />
                        {liveSla(r)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          className="inline-flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
                          onClick={() => setReviewClaimId(r.claim_id)}
                        >
                          <Eye size={13} />
                          <span>Review</span>
                        </button>
                        <button
                          type="button"
                          disabled={acting || !quickApproveEligible}
                          className="inline-flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-50 border border-emerald-200/60 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 shadow-sm"
                          onClick={() => approve(r.claim_id)}
                        >
                          <Check size={13} />
                          <span>Quick Approve</span>
                        </button>
                      </div>
                    </td>
                  </tr>
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
                <th className="px-5 py-3.5 whitespace-nowrap">S. No</th>
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
                  <td colSpan={7} className="px-5 py-6 text-center text-slate-500">
                    <Skeleton variant="table" rows={4} columns={7} />
                  </td>
                </tr>
              ) : null}
              {!loading && !travelRows.length ? (
                <tr>
                  <td colSpan={7} className="px-5 py-5">
                    <EmptyState
                      icon={Plane}
                      title="No pending travel requests"
                      description="You're all caught up!"
                    />
                  </td>
                </tr>
              ) : null}
              {travelRows.map(({ request, employee_display_name, impact_level_code }, index) => {
                const isMultiCity = request.trip_type === 'MULTI_CITY' && request.legs?.length > 0;
                const modeLabel = isMultiCity
                  ? [...new Set(request.legs.map((leg) => leg.travel_mode || request.travel_mode))].join(', ')
                  : request.travel_mode;
                const ModeIcon = !isMultiCity ? TRAVEL_MODE_ICONS[request.travel_mode] : null;
                const detailFields = [
                  { icon: FileText, label: 'Purpose', value: request.purpose },
                  {
                    icon: Layers,
                    label: 'Trip Type',
                    value: request.trip_type ? titleCase(request.trip_type) : null,
                  },
                  { icon: Armchair, label: 'Preferred Class', value: request.preferred_class },
                  { icon: Calendar, label: 'Return Date', value: request.return_date },
                  { icon: MessageSquare, label: 'Notes', value: request.notes },
                  { icon: Clock, label: 'Requested On', value: formatRequestedAt(request.requested_at) },
                ].filter((f) => f.value);

                return (
                <Fragment key={request.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors duration-150">
                    <td className="px-5 py-4 text-center text-slate-500">{index + 1}</td>
                    <td className="px-5 py-4 font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        <span>{employee_display_name || '—'}</span>
                        {impact_level_code ? (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                            {impact_level_code}
                          </span>
                        ) : null}
                        {request.exception ? (
                          <GitBranch size={12} className="text-orange-500" aria-label="Has policy exception" />
                        ) : null}
                      </div>
                    </td>
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
                    <td className="px-5 py-4 text-slate-600">
                      <div className="flex items-center gap-1.5">
                        {ModeIcon ? <ModeIcon size={14} className="shrink-0 text-slate-400" /> : null}
                        <span>{modeLabel}</span>
                      </div>
                    </td>
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
                    <tr className="border-b border-slate-100 bg-slate-50/40">
                      <td colSpan={7} className="px-5 py-4">
                        <div className={`flex flex-col gap-4 ${request.exception ? 'lg:flex-row' : ''}`}>
                          <div
                            className={`rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm ${
                              request.exception ? 'flex-1' : 'w-full max-w-2xl'
                            }`}
                          >
                            <div className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                              <FileText size={13} className="text-slate-400" />
                              Trip Details
                            </div>
                            {detailFields.length ? (
                              <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
                                {detailFields.map((f) => (
                                  <div key={f.label} className="flex items-start gap-2">
                                    <f.icon size={14} className="mt-0.5 shrink-0 text-slate-400" />
                                    <div>
                                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                        {f.label}
                                      </div>
                                      <div className="text-xs font-medium text-slate-700">{f.value}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400">No additional trip details provided.</p>
                            )}
                          </div>
                          {request.exception ? (
                            <div className="flex-1 rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm">
                              <div className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                                <GitBranch size={13} className="text-slate-400" />
                                Approval Progress
                              </div>
                              <TravelRequestProgress request={request} />
                            </div>
                          ) : null}
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

      {reviewClaimId ? (
        <ClaimReviewModal
          claimId={reviewClaimId}
          onClose={() => {
            setReviewClaimId(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

