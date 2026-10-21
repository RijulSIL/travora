import { Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHead, Tabs } from '../../components/approvals/ApprovalQueueParts';
import { ClaimListRow, claimStanding } from '../../components/claims/ClaimListRow';
import EmptyState from '../../components/ui/EmptyState';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { usePagination } from '../../hooks/usePagination';
import { reimbursementApi } from '../../services/reimbursementApi';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'progress', label: 'In progress' },
  { key: 'action', label: 'Sent back' },
  { key: 'paid', label: 'Paid' },
  { key: 'done', label: 'Rejected' },
];
const GROUP_ORDER = { progress: 0, action: 1, draft: 2, paid: 3, done: 4 };
const INPUT = 'h-[34px] rounded-[10px] border border-slate-200 bg-white px-2.5 text-[12.5px] text-ink outline-none focus:border-brand';
const rupees = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function TeamClaims() {
  useSetPageTitle('My Team Claims');
  const navigate = useNavigate();
  const [claims, setClaims] = useState([]);
  const [chains, setChains] = useState({});
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState('');
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
  const nameOf = (claim) => claim.employee_name || `Employee #${claim.employee_user_id}`;
  const people = useMemo(() => [...new Set(claims.map(nameOf))].sort(), [claims]);
  // Search and person narrow the list first; the tabs then count within that.
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      ({ claim }) =>
        (!person || nameOf(claim) === person) &&
        (!q || [claim.claim_reference, nameOf(claim), claim.destination_city, claim.office_location, claim.from_city, claim.trip_purpose].some((v) => String(v || '').toLowerCase().includes(q))),
    );
  }, [rows, query, person]);
  const counts = useMemo(() => {
    const c = { all: matched.length };
    matched.forEach((r) => {
      c[r.standing.group] = (c[r.standing.group] || 0) + 1;
    });
    return c;
  }, [matched]);
  const shown = tab === 'all' ? matched : matched.filter((r) => r.standing.group === tab);
  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(shown);
  const inProgress = rows.filter((r) => r.standing.group === 'progress').length;
  const claimed = claims.reduce((n, c) => n + Number(c.compliance_report?.total_claimed || 0), 0);

  return (
    <section className="flex flex-col gap-3.5">
      <PageHead
        title="Team claims"
        sub="Claims your team has submitted, and where each one stands."
        stats={[
          { label: 'Claims', value: claims.length },
          { label: 'In progress', value: inProgress },
          { label: 'Claimed', value: rupees(claimed) },
        ]}
      />

      {error ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div> : null}
      {loading ? <Skeleton variant="table" rows={5} columns={1} /> : null}

      {!loading && !claims.length && !error ? (
        <EmptyState icon={Users} title="No team claims yet" description="Claims submitted by your team will appear here." />
      ) : null}

      {!loading && claims.length ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-2.5 border-b border-slate-200">
            <div className="-mb-px min-w-0 flex-1 [&>div]:border-b-0">
              <Tabs label="Filter team claims" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] || 0 }))} />
            </div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              {people.length > 1 ? (
                <select aria-label="Person" className={`${INPUT} font-semibold text-slate-700`} value={person} onChange={(e) => setPerson(e.target.value)}>
                  <option value="">Everyone</option>
                  {people.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : null}
              <label className="relative">
                <span className="sr-only">Search claim, person, city or purpose</span>
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className={`${INPUT} w-[260px] max-w-full pl-8`} placeholder="Search claim, person, city or purpose" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            </div>
          </div>

          <div className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
            {pageItems.map(({ claim, standing }) => (
              <ClaimListRow
                key={claim.id}
                claim={claim}
                standing={standing}
                prefix={nameOf(claim)}
                onOpen={() => navigate(`/claims/${claim.id}`)}
              />
            ))}
            {!shown.length ? <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing here. Try another tab or search.</p> : null}
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
          </div>
        </>
      ) : null}
    </section>
  );
}
