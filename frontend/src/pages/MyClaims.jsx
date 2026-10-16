import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ClaimListRow, claimStanding } from '../components/claims/ClaimListRow';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import { useSetPageTitle } from '../context/PageTitleContext';
import { reimbursementApi } from '../services/reimbursementApi';
import { claimEditPath, claimNewPath } from '../utils/claimRoutes';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'action', label: 'Needs your action' },
  { key: 'progress', label: 'In progress' },
  { key: 'paid', label: 'Paid' },
  { key: 'draft', label: 'Drafts' },
];
// Claims that need the employee come first, then drafts, then those moving, then finished ones.
const GROUP_ORDER = { action: 0, draft: 1, progress: 2, paid: 3, done: 4 };

export default function MyClaims() {
  useSetPageTitle('My Claims');
  const navigate = useNavigate();
  const [claims, setClaims] = useState([]);
  const [chains, setChains] = useState({});
  const [sentBackNotes, setSentBackNotes] = useState({});
  // ?tab=paid (etc.) opens on that tab — Home's "See paid" link uses it.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => (TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'all'));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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
        const [chainEntries, sentBackEntries] = await Promise.all([
          Promise.all(
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
          ),
          // Who sent a claim back, and what they said, for the row's note.
          Promise.all(
            rows
              .filter((c) => c.status === 'SENT_BACK')
              .map(async (c) => {
                try {
                  const t = await reimbursementApi.claimTimeline(c.id);
                  return [c.id, [...(t.data || [])].reverse().find((item) => item.event === 'sent_back') || null];
                } catch {
                  return [c.id, null];
                }
              }),
          ),
        ]);
        if (cancelled) return;
        setChains(Object.fromEntries(chainEntries));
        setSentBackNotes(Object.fromEntries(sentBackEntries));
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

  const rows = useMemo(
    () =>
      claims
        .map((claim) => ({ claim, standing: claimStanding(claim, chains[claim.id], sentBackNotes[claim.id]) }))
        .sort((a, b) => GROUP_ORDER[a.standing.group] - GROUP_ORDER[b.standing.group] || b.claim.id - a.claim.id),
    [claims, chains, sentBackNotes],
  );
  const counts = useMemo(() => {
    const c = { all: rows.length };
    rows.forEach((r) => {
      c[r.standing.group] = (c[r.standing.group] || 0) + 1;
    });
    return c;
  }, [rows]);
  const shown = tab === 'all' ? rows : rows.filter((r) => r.standing.group === tab);

  const confirmDeleteDraft = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await reimbursementApi.deleteClaim(deleteTarget.id);
      setClaims((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err?.response?.data?.detail || 'Could not delete this draft.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink">My Claims</h1>
          <p className="mt-0.5 text-sm text-slate-500">Your reimbursement claims and where each one stands.</p>
        </div>
        <Link className="btn-primary inline-flex items-center gap-1.5" to={claimNewPath('TRAVEL')}>
          <Plus size={16} />
          New claim
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>
      ) : null}
      {deleteError ? (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertTriangle size={15} className="flex-none" /> {deleteError}
        </div>
      ) : null}

      {loading ? <Skeleton variant="table" rows={5} columns={1} /> : null}

      {!loading && !claims.length && !error ? (
        <EmptyState
          title="No claims yet"
          description="Start from a draft or upload invoices to create your first reimbursement."
          action={{
            label: 'New claim',
            className: 'btn-primary mt-6',
            onClick: () => navigate(claimNewPath('TRAVEL')),
          }}
        />
      ) : null}

      {!loading && claims.length ? (
        <>
          <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist" aria-label="Filter claims">
            {TABS.map((t) => {
              const n = counts[t.key] || 0;
              const selected = tab === t.key;
              const alert = t.key === 'action' && n > 0;
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
                  <span
                    className={`rounded-full px-1.5 text-[10.5px] ${
                      alert ? 'bg-rose-50 text-rose-700' : selected ? 'bg-brand/10 text-brand' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
            {shown.map(({ claim, standing }) => {
              const ref = claim.claim_reference || `Claim #${claim.id}`;
              const target = claim.status === 'DRAFT' ? claimEditPath(claim) : `/claims/${claim.id}`;
              let actions = null;
              if (claim.status === 'SENT_BACK') {
                actions = (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(claimEditPath(claim));
                    }}
                    className="inline-flex h-7 items-center whitespace-nowrap rounded-lg bg-rose-700 px-2.5 text-[11.5px] font-bold text-white hover:bg-rose-800"
                  >
                    Fix &amp; resubmit
                  </button>
                );
              } else if (claim.status === 'DRAFT') {
                actions = (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(claimEditPath(claim));
                      }}
                      className="inline-flex h-7 items-center rounded-lg bg-brand px-2.5 text-[11.5px] font-bold text-white hover:bg-brand/90"
                    >
                      Continue
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteError('');
                        setDeleteTarget(claim);
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Delete draft ${ref}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                );
              }
              return (
                <ClaimListRow
                  key={claim.id}
                  claim={claim}
                  standing={standing}
                  onOpen={() => navigate(target)}
                  actions={actions}
                />
              );
            })}
            {!shown.length ? <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing here.</p> : null}
          </div>
          <div className="flex justify-between px-1 text-xs text-slate-500">
            <span>
              {shown.length} of {rows.length} claim{rows.length === 1 ? '' : 's'}
            </span>
            <span>{counts.paid || 0} paid</span>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this draft claim?"
        description={
          deleteTarget
            ? `"${deleteTarget.claim_reference || `Claim #${deleteTarget.id}`}" will be permanently removed, along with any pending exception request on it. Its invoices and trips will become available to attach to a different claim. This can't be undone.`
            : ''
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        confirmVariant="danger"
        onConfirm={confirmDeleteDraft}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
