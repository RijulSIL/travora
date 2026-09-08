import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import ClaimApprovalStepper from '../components/claims/ClaimApprovalStepper';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import { useSetPageTitle } from '../context/PageTitleContext';
import { reimbursementApi } from '../services/reimbursementApi';
import { formatCurrency, formatDate } from '../utils/formatters';

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
    <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-600">
              Track reimbursement claims and approval progress.
            </p>
          </div>
          <Link className="btn-secondary" to="/claims/new">
            New reimbursement
          </Link>
        </div>

        {loading ? <Skeleton variant="table" rows={4} columns={1} /> : null}
        {sentBackClaims.length ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">Action Required</p>
            {sentBackClaims.map((claim) => (
              <div key={claim.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-red-700">
                <span>
                  Claim {claim.claim_reference || `CLM-${claim.id}`} was sent back. Please review and resubmit.
                </span>
                <Link className="font-semibold underline" to={`/claims/new?edit=${claim.id}`}>
                  Edit & Resubmit →
                </Link>
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <div className="panel rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        {!loading && !claims.length ? (
          <EmptyState
            icon="📋"
            title="No claims yet"
            description="Start from a draft or upload invoices to create your first reimbursement."
            action={{
              label: 'New reimbursement',
              className: 'btn-primary mt-6',
              onClick: () => navigate('/claims/new'),
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
            <div key={claim.id} className="panel mb-4 rounded-lg border border-slate-200 bg-white p-5">
              <div className="mb-4 flex flex-wrap justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-ink">
                    {claim.claim_reference || `Claim #${claim.id}`}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    {[claim.office_location, claim.destination_city].filter(Boolean).join(' → ') ||
                      'Trip details pending'}
                    {claim.departure_date && claim.return_date
                      ? ` · ${formatDate(claim.departure_date)}–${formatDate(claim.return_date)}`
                      : ''}
                    {claim.trip_purpose ? ` · ${claim.trip_purpose}` : ''}
                  </div>
                  <div className="mt-2 text-xs font-medium text-slate-500">
                    {STATUS_LABELS[claim.status] || claim.status}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-ink">{formatCurrency(total)}</div>
                  <div className="text-xs text-slate-600">Net payable: {formatCurrency(net)}</div>
                </div>
              </div>

              {stages.length ? (
                <ClaimApprovalStepper
                  stages={stages}
                  currentStageNumber={current}
                  claimStatus={claim.status}
                />
              ) : claim.status !== 'DRAFT' ? (
                <ClaimApprovalStepper stages={[]} emptyHint="Approval details unavailable." />
              ) : null}
              {claim.status === 'DRAFT' ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Link className="text-sm font-semibold text-brand" to={`/claims/new?edit=${claim.id}`}>
                    Edit Draft →
                  </Link>
                </div>
              ) : (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Link className="text-sm font-semibold text-blue-700" to={`/claims/${claim.id}`}>
                    Open details
                  </Link>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
