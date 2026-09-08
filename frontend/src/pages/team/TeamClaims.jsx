import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import ClaimApprovalStepper from '../../components/claims/ClaimApprovalStepper';
import EmptyState from '../../components/ui/EmptyState';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';
import { formatCurrency, formatDate } from '../../utils/formatters';

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

export default function TeamClaims() {
  useSetPageTitle('My Team Claims');
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
        const res = await reimbursementApi.teamClaims();
        if (cancelled) return;
        const rows = res.data || [];
        setClaims(rows);
        
        // Fetch approval chains for claims
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
        setError(e?.response?.data?.detail || e.message || 'Failed to load team claims');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <p className="text-sm text-slate-600">
          Track reimbursement claims submitted by your team members.
        </p>
      </div>

      {loading ? <Skeleton variant="table" rows={4} columns={1} /> : null}
      
      {error ? (
        <div className="panel rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      {!loading && !claims.length ? (
        <EmptyState
          icon="👥"
          title="No team claims yet"
          description="Claims submitted by your team will appear here."
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
                  <span className="font-semibold text-slate-700">Employee ID: {claim.employee_user_id}</span>
                  {claim.office_location || claim.destination_city ? ' · ' : ''}
                  {[claim.office_location, claim.destination_city].filter(Boolean).join(' → ')}
                  {claim.departure_date && claim.return_date
                    ? ` · ${formatDate(claim.departure_date)}–${formatDate(claim.return_date)}`
                    : ''}
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
            
            <div className="mt-3 border-t border-slate-100 pt-3">
              <Link className="text-sm font-semibold text-blue-700" to={`/claims/${claim.id}`}>
                View details
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
