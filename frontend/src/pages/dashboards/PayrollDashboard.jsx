import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Clock, ClipboardList, Eye, FileText, TrendingUp } from 'lucide-react';

import ClaimReviewModal from '../../components/claims/ClaimReviewModal';
import ReimbursementCategoryBadge from '../../components/ui/ReimbursementCategoryBadge';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';
import { useAuthStore } from '../../store/authStore';

function slaClass(bucket) {
  if (bucket === 'breached') return 'sla-breached';
  if (bucket === 'warning') return 'sla-warning';
  return 'sla-ok';
}

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export default function PayrollDashboard() {
  useSetPageTitle('Home');
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const stage3 = profile?.pending_approvals_count ?? 0;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewClaimId, setReviewClaimId] = useState(null);

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reimbursementApi.pendingApprovals();
      setRows(res.data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const topFive = rows.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">
          Welcome back, {firstName}
        </h2>
        <p className="mt-1 text-sm text-slate-500">Stage 3 compliance for payroll payouts.</p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="stat-card">
          <div className="stat-card-icon bg-brand">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="stat-card-label">Claims at Payroll Stage</div>
          <div className="stat-card-value">{stage3}</div>
          <Link className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/claims/pending">
            Payroll queue <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-sky-500">
            <FileText className="h-5 w-5" />
          </div>
          <div className="stat-card-label">All Claims</div>
          <div className="stat-card-value text-base text-slate-500 font-medium">View-only roster of claims</div>
          <Link className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/claims/all">
            Open all claims <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-violet-500">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="stat-card-label">Reports</div>
          <div className="stat-card-value text-base text-slate-500 font-medium">Claim aging &amp; approval TAT</div>
          <Link className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/reports">
            Open reports <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Claims awaiting review preview */}
      <div className="panel overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-sm font-bold text-ink">Claims awaiting your review</h3>
          <Link className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/claims/pending">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Loading…</div>
        ) : topFive.length ? (
          <div className="divide-y divide-line">
            {topFive.map((row) => (
              <div key={row.claim_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="font-semibold text-slate-800">{row.claim_reference}</span>
                  <ReimbursementCategoryBadge category={row.reimbursement_category} />
                </div>
                <span className="text-sm text-slate-600">{row.employee_name || row.employee_label}</span>
                <span className="font-mono text-sm font-bold text-ink">{money(row.net_payable ?? row.amount)}</span>
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${slaClass(row.sla_bucket)}`}>
                  <Clock size={12} className="shrink-0" />
                  {row.sla_remaining_label}
                </span>
                <button
                  type="button"
                  className="btn-secondary h-8 whitespace-nowrap px-3 text-xs"
                  onClick={() => setReviewClaimId(row.claim_id)}
                >
                  <Eye size={13} />
                  Review
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-5 text-sm text-slate-500">Nothing waiting at the Payroll stage right now.</p>
        )}
      </div>

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
