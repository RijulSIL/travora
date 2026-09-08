import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, PlusCircle, Receipt, Plane, Briefcase, Building2, ArrowRight } from 'lucide-react';

import ClaimApprovalStepper from '../../components/claims/ClaimApprovalStepper';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { hasPermission } from '../../services/permissions';
import { reimbursementApi } from '../../services/reimbursementApi';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';

function money(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

const STATUS_LABELS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_APPROVAL: 'In approval',
  READY_FOR_PAYMENT: 'Ready for payment',
  SENT_BACK: 'Sent back',
  REJECTED: 'Rejected',
  ON_HOLD: 'On hold',
  PAID: 'Paid',
};

export default function EmployeeDashboard() {
  useSetPageTitle('Home');
  const role = useAuthStore(selectResolvedRole);
  const canSubmit = hasPermission(role, 'submit_claim');
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const [claims, setClaims] = useState([]);
  const [chainData, setChainData] = useState(null);
  const [travelRequests, setTravelRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await reimbursementApi.claims();
        if (cancelled) return;
        const rows = res.data || [];
        setClaims(rows);
        const latest = rows[0];
        if (latest?.id && latest.status && latest.status !== 'DRAFT') {
          try {
            const ch = await reimbursementApi.approvalChain(latest.id);
            if (!cancelled) setChainData(ch.data);
          } catch {
            if (!cancelled) setChainData(null);
          }
        } else {
          setChainData(null);
        }

        // Fetch travel requests
        if (canSubmit) {
          try {
            const travelRes = await reimbursementApi.travelRequestsMy();
            if (!cancelled) setTravelRequests(travelRes.data || []);
          } catch {
            if (!cancelled) setTravelRequests([]);
          }
        }

      } catch {
        /* leave empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openCount = claims.filter((c) => !['PAID', 'REJECTED'].includes(c.status)).length;
  const latest = claims[0];
  const stages = chainData?.stages ?? [];
  const current = chainData?.current_approval_stage;
  const report = latest?.compliance_report || {};
  const total = report.total_claimed || 0;
  const net = report.net_payable ?? total;

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">
          Welcome back, {firstName}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Here&apos;s a snapshot of your claims, travel, and impact level allowances.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="stat-card">
          <div className="stat-card-icon bg-brand">
            <FileText className="h-5 w-5" />
          </div>
          <div className="stat-card-label">My Open Claims</div>
          <div className="stat-card-value">{loading ? '—' : openCount}</div>
          <Link className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/claims/my">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon bg-amber-500">
            <Briefcase className="h-5 w-5" />
          </div>
          <div className="stat-card-label">My Impact Level</div>
          <div className="stat-card-value text-xl">
            {profile?.impact_level_code || '—'}
            {profile?.impact_level_name ? (
              <span className="ml-2 text-sm font-normal text-slate-500">({profile.impact_level_name})</span>
            ) : null}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon bg-sky-500">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="stat-card-label">Hotel Cap (Group A)</div>
          <div className="stat-card-value text-xl">
            {profile?.hotel_cap_group_a ? `₹${money(profile.hotel_cap_group_a)}` : '—'}
          </div>
        </div>
      </div>

      {/* Two-column: Latest Claim + Quick Actions */}
      <div className={`grid gap-6 ${canSubmit ? 'lg:grid-cols-[1fr_320px]' : 'lg:grid-cols-1'}`}>
        {/* Latest claim */}
        <section className="panel p-6">
          <div className="mb-4 flex flex-wrap justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-bold text-ink">Latest claim</h3>
              <p className="text-xs text-slate-400">
                Mirrors the progression stepper shown on{' '}
                <Link className="text-brand hover:underline" to="/claims/my">My Claims</Link>.
              </p>
            </div>
            {latest ? (
              <Link className="btn-secondary text-xs" to={`/claims/${latest.id}`}>
                Open detail
              </Link>
            ) : null}
          </div>

          {loading ? <p className="text-sm text-slate-500">Loading latest claim…</p> : null}

          {!loading && !claims.length ? (
            <p className="text-sm text-slate-500">No claims submitted yet.</p>
          ) : null}

          {!loading && latest ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-ink">
                    {latest.claim_reference || `Claim #${latest.id}`}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {STATUS_LABELS[latest.status] || latest.status} · ₹{money(total)}{' '}
                    <span className="text-slate-300">/</span> Net ₹{money(net)}
                  </div>
                </div>
              </div>
              {latest.status !== 'DRAFT' ? (
                <div className="mt-4">
                  <ClaimApprovalStepper
                    stages={stages}
                    currentStageNumber={current}
                    claimStatus={latest.status}
                    emptyHint="Approval stages will appear once the claim is routed."
                  />
                </div>
              ) : (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-slate-500">Draft — submit when ready.</p>
                  <Link className="btn-primary text-xs" to={`/claims/new?edit=${latest.id}`}>
                    Edit Draft
                  </Link>
                </div>
              )}
            </div>
          ) : null}
        </section>

        {/* Quick Actions */}
        {canSubmit && (
          <div className="space-y-3">
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-400 px-1">Quick Actions</h3>
          <Link to="/claims/new" className="quick-action-primary">
            <PlusCircle className="h-5 w-5 shrink-0" />
            <span className="flex-1">Submit New Claim</span>
            <ArrowRight className="h-4 w-4 opacity-70" />
          </Link>
          <Link to="/travel-requests" className="quick-action">
            <Plane className="h-5 w-5 shrink-0 text-slate-400" />
            <span className="flex-1">My Travel Requests</span>
            <ArrowRight className="h-4 w-4 opacity-40" />
          </Link>
          <Link to="/invoices" className="quick-action">
            <Receipt className="h-5 w-5 shrink-0 text-slate-400" />
            <span className="flex-1">Upload Invoice</span>
            <ArrowRight className="h-4 w-4 opacity-40" />
          </Link>
        </div>
        )}
      </div>

      {/* Travel Requests */}
      {canSubmit && (
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Plane className="h-4 w-4 text-slate-400" />
            <h3 className="text-[15px] font-bold text-ink">My Travel Requests</h3>
          </div>
          <Link className="flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/travel-requests">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-5 py-3">Travel Date</th>
                <th className="px-5 py-3">Route</th>
                <th className="px-5 py-3">Mode</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : null}
              {!loading && !travelRequests.length ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">No travel requests yet.</td></tr>
              ) : null}
              {travelRequests.slice(0, 3).map(({ request }) => (
                <tr key={request.id} className="border-b border-slate-50 last:border-none hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-700">
                    {request.trip_type === 'MULTI_CITY' && request.legs?.length > 0 ? request.legs[0].travel_date : request.travel_date}
                  </td>
                  <td className="px-5 py-3.5 font-bold text-ink">
                    {request.trip_type === 'MULTI_CITY' && request.legs && request.legs.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {request.legs.map((leg, i) => (
                          <div key={i} className="flex items-center gap-1 text-[11px]">
                            <span>{leg.from_city}</span>
                            <span className="text-slate-400 font-normal">→</span>
                            <span>{leg.to_city}</span>
                          </div>
                        ))}
                        <div className="mt-0.5"><span className="inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Multi City</span></div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span>{request.from_city}</span>
                        <span className="text-slate-400 font-normal">→</span>
                        <span>{request.to_city}</span>
                        {request.trip_type === 'ROUND_TRIP' && (
                          <span className="ml-1 inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Round Trip</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">{request.travel_mode}</td>
                  <td className="px-5 py-3.5">
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      {request.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </div>
  );
}
