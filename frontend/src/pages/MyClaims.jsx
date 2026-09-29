import { AlertTriangle, ArrowRight, FileText, Plus, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import ClaimApprovalStepper from '../components/claims/ClaimApprovalStepper';
import ClaimStatusBadge from '../components/ui/ClaimStatusBadge';
import ReimbursementCategoryBadge from '../components/ui/ReimbursementCategoryBadge';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import { useSetPageTitle } from '../context/PageTitleContext';
import { reimbursementApi } from '../services/reimbursementApi';
import { claimEditPath, claimNewPath } from '../utils/claimRoutes';
import { formatCurrency, formatDate } from '../utils/formatters';

export default function MyClaims() {
  useSetPageTitle('My Claims');
  const navigate = useNavigate();
  const [claims, setClaims] = useState([]);
  const [chains, setChains] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await reimbursementApi.claims();
        if (cancelled) return;
        const rows = res.data || [];
        setClaims(rows);
        const chainEntries = await Promise.all(
          rows
            .filter((c) => c.status && c.status !== 'DRAFT')
            .map(async (c) => {
              try {
                const ch = await reimbursementApi.approvalChain(c.id);
                return [c.id, ch.data];
              } catch {
                return [c.id, null];
              }
            }),
        );
        if (cancelled) return;
        setChains(Object.fromEntries(chainEntries));
      } catch (e) {
        setError(e?.response?.data?.detail || e.message || 'Failed to load claims');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sentBackClaims = claims.filter((claim) => claim.status === 'SENT_BACK');

  return (
    <div>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-ink">My Claims</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Track reimbursement claims and approval progress.
            </p>
          </div>
          <Link className="btn-primary inline-flex items-center gap-1.5" to={claimNewPath('TRAVEL')}>
            <Plus size={16} />
            New reimbursement
          </Link>
        </div>

        {loading ? <Skeleton variant="table" rows={4} columns={1} /> : null}
        {sentBackClaims.length ? (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600">
              <AlertTriangle size={16} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-red-800">Action required</p>
              {sentBackClaims.map((claim) => (
                <div key={claim.id} className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-sm text-red-700">
                  <span>
                    Claim {claim.claim_reference || `CLM-${claim.id}`} was sent back. Please review and resubmit.
                  </span>
                  <Link className="font-semibold underline whitespace-nowrap" to={claimEditPath(claim)}>
                    Edit & Resubmit →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="panel rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        {!loading && !claims.length ? (
          <EmptyState
            title="No claims yet"
            description="Start from a draft or upload invoices to create your first reimbursement."
            action={{
              label: 'New reimbursement',
              className: 'btn-primary mt-6',
              onClick: () => navigate(claimNewPath('TRAVEL')),
            }}
          />
        ) : null}

        {claims.map((claim) => {
          const report = claim.compliance_report || {};
          const total = report.total_claimed || 0;
          const net = report.net_payable ?? total;
          const chain = chains[claim.id];
          const stages = chain?.stages || [];
          const current = chain?.current_approval_stage;

          return (
            <div
              key={claim.id}
              className="panel mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="p-5">
                <div className="mb-4 flex flex-wrap justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                      <Wallet size={18} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-ink">
                        {claim.claim_reference || `Claim #${claim.id}`}
                      </div>
                      {claim.reimbursement_category !== 'GENERAL' && claim.reimbursement_category !== 'REALLOCATION' ? (
                        <div className="mt-1 text-xs text-slate-500">
                          {[claim.office_location, claim.destination_city].filter(Boolean).join(' → ') ||
                            'Trip details pending'}
                          {claim.departure_date && claim.return_date
                            ? ` · ${formatDate(claim.departure_date)}–${formatDate(claim.return_date)}`
                            : ''}
                          {claim.trip_purpose ? ` · ${claim.trip_purpose}` : ''}
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <ClaimStatusBadge status={claim.status} />
                        <ReimbursementCategoryBadge category={claim.reimbursement_category} />
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg font-bold text-ink">{formatCurrency(total)}</div>
                    <div className="text-xs text-slate-500">Net payable: {formatCurrency(net)}</div>
                  </div>
                </div>

                {stages.length ? (
                  <ClaimApprovalStepper
                    stages={stages}
                    currentStageNumber={current}
                    claimStatus={claim.status}
                  />
                ) : claim.status === 'PENDING_EXCEPTION' ? (
                  <ClaimApprovalStepper
                    stages={[]}
                    emptyHint="Awaiting policy exception review before approval can begin."
                  />
                ) : claim.status !== 'DRAFT' ? (
                  <ClaimApprovalStepper stages={[]} emptyHint="Approval details unavailable." />
                ) : null}
              </div>
              {claim.status === 'DRAFT' ? (
                <Link
                  className="flex items-center justify-between gap-1 border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 text-sm font-semibold text-brand transition-colors hover:bg-slate-50"
                  to={claimEditPath(claim)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <FileText size={14} />
                    Edit Draft
                  </span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <Link
                  className="flex items-center justify-between gap-1 border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 text-sm font-semibold text-brand transition-colors hover:bg-slate-50"
                  to={`/claims/${claim.id}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <FileText size={14} />
                    Open details
                  </span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          );
        })}
    </div>
  );
}
