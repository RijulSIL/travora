import { Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ClaimListRow, claimStanding } from '../../components/claims/ClaimListRow';
import EmptyState from '../../components/ui/EmptyState';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'progress', label: 'In progress' },
  { key: 'action', label: 'Sent back' },
  { key: 'paid', label: 'Paid' },
  { key: 'done', label: 'Rejected' },
];
const GROUP_ORDER = { progress: 0, action: 1, draft: 2, paid: 3, done: 4 };

export default function TeamClaims() {
  useSetPageTitle('My Team Claims');
  const navigate = useNavigate();
  const [claims, setClaims] = useState([]);
  const [chains, setChains] = useState({});
  const [tab, setTab] = useState('all');
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

  const rows = useMemo(
    () =>
      claims
        .map((claim) => ({ claim, standing: claimStanding(claim, chains[claim.id], null, 'approver') }))
        .sort((a, b) => GROUP_ORDER[a.standing.group] - GROUP_ORDER[b.standing.group] || b.claim.id - a.claim.id),
    [claims, chains],
  );
  const counts = useMemo(() => {
    const c = { all: rows.length };
    rows.forEach((r) => {
      c[r.standing.group] = (c[r.standing.group] || 0) + 1;
    });
    return c;
  }, [rows]);
  const shown = tab === 'all' ? rows : rows.filter((r) => r.standing.group === tab);

  return (
    <div className="space-y-3.5">
      <p className="text-sm text-slate-500">Claims your team members have submitted, and where each one stands.</p>

      {error ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div> : null}
      {loading ? <Skeleton variant="table" rows={5} columns={1} /> : null}

      {!loading && !claims.length && !error ? (
        <EmptyState icon={Users} title="No team claims yet" description="Claims submitted by your team will appear here." />
      ) : null}

      {!loading && claims.length ? (
        <>
          <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist" aria-label="Filter team claims">
            {TABS.map((t) => {
              const selected = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(t.key)}
                  className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] font-bold transition-colors ${
                    selected ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.label}
                  <span className={`rounded-full px-1.5 text-[10.5px] ${selected ? 'bg-brand/10 text-brand' : 'bg-slate-100 text-slate-500'}`}>
                    {counts[t.key] || 0}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
            {shown.map(({ claim, standing }) => (
              <ClaimListRow
                key={claim.id}
                claim={claim}
                standing={standing}
                prefix={claim.employee_name || `Employee #${claim.employee_user_id}`}
                onOpen={() => navigate(`/claims/${claim.id}`)}
              />
            ))}
            {!shown.length ? <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing here.</p> : null}
          </div>
          <div className="flex justify-between px-1 text-xs text-slate-500">
            <span>
              {shown.length} of {rows.length} claim{rows.length === 1 ? '' : 's'}
            </span>
            <span>{counts.progress || 0} in progress</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
