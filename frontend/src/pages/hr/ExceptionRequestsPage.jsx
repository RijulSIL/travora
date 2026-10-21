import { Clock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import ExceptionApprovalPanel from '../../components/approvals/ExceptionApprovalPanel';
import {
  ApprovalChain,
  DecidedPill,
  ExceptionSubject,
  PageHead,
  Pill,
  Tabs,
  ago,
  shortType,
  slaLeft,
} from '../../components/approvals/ApprovalQueueParts';
import Pagination from '../../components/ui/Pagination';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { usePagination } from '../../hooks/usePagination';
import { reimbursementApi } from '../../services/reimbursementApi';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';
import { EXCEPTION_TYPE_LABELS, formatExceptionType, formatRole } from '../../utils/formatters';

const STATUS_TABS = [
  ['mine', 'Waiting on you'],
  ['PENDING', 'In progress'],
  ['APPROVED', 'Approved'],
  ['REJECTED', 'Rejected'],
  ['CANCELLED', 'Cancelled'],
  ['all', 'All'],
];

const roleMatches = (requiredRole, role) => requiredRole === role || (requiredRole === 'HRBP_HR' && (role === 'HRBP' || role === 'HRBP_HR'));

export default function ExceptionRequestsPage() {
  useSetPageTitle('Exception Requests');
  const role = useAuthStore(selectResolvedRole);
  const approverScopeExceptions = useAuthStore((state) => state.profile?.approver_scope?.exceptions);
  const [filters, setFilters] = useState({ exception_type: '', from_date: '', to_date: '' });
  const [tab, setTab] = useState('mine');
  // The whole log (every status) for the status tabs, and separately the requests waiting on
  // this approver — the log's status=PENDING view only returns those the caller can act on.
  const [rows, setRows] = useState([]);
  const [mineIds, setMineIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [actionState, setActionState] = useState({});
  const [rejecting, setRejecting] = useState({});
  const [decided, setDecided] = useState({});
  const [now, setNow] = useState(Date.now());
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setLoading(true);
      const params = {};
      if (filters.exception_type) params.exception_type = filters.exception_type;
      if (filters.from_date) params.from_date = filters.from_date;
      if (filters.to_date) params.to_date = filters.to_date;
      const [all, mine] = await Promise.all([
        reimbursementApi.exceptionRequestsLog(params),
        reimbursementApi.exceptionRequestsLog({ ...params, status: 'PENDING' }),
      ]);
      const mineRows = mine.data || [];
      const logRows = all.data || [];
      const known = new Set(logRows.map((r) => r.exception_id));
      setRows([...logRows, ...mineRows.filter((r) => !known.has(r.exception_id))]);
      setMineIds(new Set(mineRows.map((r) => r.exception_id)));
      setDecided({});
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Filters apply as they change.
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // The decided row stays open with the outcome (and its route updated here) until the list is
  // next loaded — on the Waiting on you tab it would otherwise vanish the moment you act.
  const decideAction = useAsyncAction(async (row, approve, reason) => {
    const id = row.exception_id;
    const comment = approve ? (actionState[id]?.comment || '').trim() : reason;
    await reimbursementApi.decideException(id, { approve, comment: comment || null });
    const actedAt = new Date().toISOString();
    setRows((prev) =>
      prev.map((r) => {
        if (r.exception_id !== id) return r;
        let activatedNext = false;
        let current = true;
        const decisions = (r.decisions || []).map((d) => {
          if (current && d.status === 'PENDING') {
            current = false;
            return { ...d, status: approve ? 'APPROVED' : 'REJECTED', acted_at: actedAt, acted_by_name: 'you', comment: comment || null };
          }
          if (approve && !current && !activatedNext && d.status === 'AWAITING') {
            activatedNext = true;
            return { ...d, status: 'PENDING' };
          }
          return d;
        });
        const status = !approve ? 'REJECTED' : activatedNext ? 'PENDING' : 'APPROVED';
        return { ...r, decisions, status, decided_by: status === 'PENDING' ? r.decided_by : 'you', decision_comment: approve ? r.decision_comment : comment };
      }),
    );
    const name = row.employee || 'The employee';
    const next = (row.decisions || []).find((d, i, list) => i > list.findIndex((x) => x.status === 'PENDING') && d.status === 'AWAITING');
    setDecided((prev) => ({
      ...prev,
      [id]: approve
        ? {
            ok: true,
            pill: next ? `Approved → ${formatRole(next.required_role)}` : 'Approved',
            text: `Approved${comment ? ' with your comment' : ''}. ${row.claim_id ? 'The claim moves on once every exception on it is approved.' : row.travel_request ? 'The travel request moves on to the next step.' : ''}`,
          }
        : { ok: false, pill: 'Rejected', text: `Rejected. ${name} has been told why.` },
    }));
  });

  const groups = {
    mine: rows.filter((r) => mineIds.has(r.exception_id)),
    PENDING: rows.filter((r) => r.status === 'PENDING'),
    APPROVED: rows.filter((r) => r.status === 'APPROVED'),
    REJECTED: rows.filter((r) => r.status === 'REJECTED'),
    CANCELLED: rows.filter((r) => r.status === 'CANCELLED'),
    all: rows,
  };
  const shown = [...groups[tab]].sort((a, b) => new Date(b.requested_on) - new Date(a.requested_on));
  const yourTurnCount = groups.mine.filter((r) => !decided[r.exception_id]).length;
  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(shown);
  const filtersOn = filters.exception_type || filters.from_date || filters.to_date;
  const field = 'inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-500';

  return (
    <section className="flex flex-col gap-3.5">
      <PageHead
        title="Exception requests"
        sub="Asks to go outside the travel policy. Each goes through its approvers in order."
        stats={[
          { label: 'Your turn', value: yourTurnCount },
          { label: 'In progress', value: groups.PENDING.length, tone: 'amber' },
        ]}
      />

      <Tabs
        label="Status"
        value={tab}
        onChange={(key) => {
          setTab(key);
          setExpandedId(null);
        }}
        tabs={STATUS_TABS.map(([key, label]) => ({
          key,
          label,
          count: key === 'mine' ? yourTurnCount : groups[key].length,
          hot: key === 'mine' && yourTurnCount > 0,
        }))}
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className={field}>
          Type
          <select
            className="max-w-[240px] bg-transparent text-[12.5px] font-semibold text-ink outline-none"
            value={filters.exception_type}
            onChange={(e) => setFilters({ ...filters, exception_type: e.target.value })}
          >
            <option value="">All types</option>
            {Object.keys(EXCEPTION_TYPE_LABELS)
              .filter((type) => !approverScopeExceptions?.length || approverScopeExceptions.includes(type))
              .map((type) => (
                <option key={type} value={type}>{shortType(type)}</option>
              ))}
          </select>
        </label>
        <label className={field}>
          From
          <input
            className="bg-transparent text-[12.5px] text-ink outline-none"
            type="date"
            aria-label="Requested from"
            value={filters.from_date}
            onChange={(e) => setFilters({ ...filters, from_date: e.target.value })}
          />
        </label>
        <label className={field}>
          To
          <input
            className="bg-transparent text-[12.5px] text-ink outline-none"
            type="date"
            aria-label="Requested to"
            value={filters.to_date}
            onChange={(e) => setFilters({ ...filters, to_date: e.target.value })}
          />
        </label>
        {filtersOn ? (
          <button
            type="button"
            className="px-1 text-xs font-bold text-brand hover:text-brand/80"
            onClick={() => setFilters({ exception_type: '', from_date: '', to_date: '' })}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {loadError || decideAction.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-[13px] text-red-700">
          {(loadError || decideAction.error)?.response?.data?.detail || (loadError || decideAction.error)?.message}
        </div>
      ) : null}

      <section aria-label="Exception requests" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
        {loading && !rows.length ? (
          <div className="flex items-center gap-2 px-4 py-6 text-xs font-bold text-slate-500">
            <Clock className="animate-spin text-slate-400" size={15} /> Loading exception requests…
          </div>
        ) : null}
        {!loading && !shown.length ? (
          <div className="px-4 py-9 text-center text-[12.5px] text-slate-500">
            <b className="mb-0.5 block text-sm text-ink">{tab === 'mine' ? "Nothing's waiting on you" : 'Nothing here'}</b>
            {tab === 'mine' ? 'When an exception reaches your step, it shows up here.' : 'Try another tab or clear the filters.'}
          </div>
        ) : null}
        {pageItems.map((row) => {
          const id = row.exception_id;
          const activeDecision = (row.decisions || []).find((d) => d.status === 'PENDING' || d.status === 'AWAITING');
          const isPendingActive = activeDecision && activeDecision.status === 'PENDING';
          // A Department head step isn't a role: the server already lists it under "Waiting on
          // you" only for the head of that person's department (and still checks on decide).
          const canUserDecide = Boolean(
            isPendingActive &&
              (roleMatches(activeDecision.required_role, role) || (activeDecision.required_role === 'DEPARTMENT_HEAD' && mineIds.has(id))),
          );
          const hasUserAlreadyActed = (row.decisions || []).some(
            (d) => roleMatches(d.required_role, role) && (d.status === 'APPROVED' || d.status === 'REJECTED'),
          );
          const yourTurn = canUserDecide && mineIds.has(id) && !decided[id];
          const current = (row.decisions || []).find((d) => d.status === 'PENDING');
          const left = row.status === 'PENDING' ? slaLeft(current?.sla_deadline_at, now) : null;
          const open = expandedId === id;
          const types = row.exception_types?.length ? row.exception_types : [row.exception_type];
          return (
            <div key={id} className={`relative border-t border-slate-100 first:border-t-0 ${yourTurn ? 'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand' : ''}`}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={(e) => {
                  if (e.target.closest('a, button')) return;
                  setExpandedId(open ? null : id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedId(open ? null : id);
                  }
                }}
                className="grid cursor-pointer gap-x-3.5 gap-y-2.5 px-4 py-3 hover:bg-[#fbfdfc] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_140px] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-[7px] text-[13.5px] font-bold text-ink">
                    <span>{row.exception_ref || `EXC-${String(id).padStart(4, '0')}`}</span>
                    {types.map((t) => (
                      <Pill key={t} title={formatExceptionType(t)}>{shortType(t)}</Pill>
                    ))}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {row.employee || '—'}
                    {row.requested_on ? ` · requested ${ago(row.requested_on)}` : ''}
                  </div>
                  {row.description ? <div className="mt-1 break-words text-xs italic text-slate-700">“{row.description}”</div> : null}
                </div>
                <div className="min-w-0">
                  <ExceptionSubject row={row} />
                  <div className="mt-1.5">
                    <ApprovalChain decisions={row.decisions || []} yourTurn={yourTurn} />
                  </div>
                </div>
                <div className="lg:text-right">
                  {decided[id] ? (
                    <DecidedPill decision={decided[id]} />
                  ) : row.status === 'PENDING' ? (
                    yourTurn ? (
                      <Pill tone="brand">Your turn</Pill>
                    ) : (
                      <Pill tone="amber">With {current ? formatRole(current.required_role) : 'an approver'}</Pill>
                    )
                  ) : row.status === 'APPROVED' ? (
                    <Pill tone="ok">Approved</Pill>
                  ) : row.status === 'REJECTED' ? (
                    <Pill tone="rose">Rejected</Pill>
                  ) : (
                    <Pill title={row.decision_comment || undefined}>Cancelled</Pill>
                  )}
                  {left && !decided[id] ? (
                    <span className={`mt-1 block text-[11.5px] ${left.over ? 'font-bold text-rose-700' : 'text-slate-500'}`}>
                      {left.over ? `Past SLA by ${left.text}` : `${left.text} left`}
                    </span>
                  ) : row.decided_by && row.status !== 'PENDING' ? (
                    <span className="mt-1 block text-[11.5px] text-slate-500">by {row.decided_by}</span>
                  ) : null}
                </div>
              </div>
              {open ? (
                <div className="bg-[#fbfdfc] px-4 pb-[18px]">
                  <ExceptionApprovalPanel
                    row={row}
                    canDecide={canUserDecide}
                    hasActed={hasUserAlreadyActed}
                    comment={actionState[id]?.comment || ''}
                    onCommentChange={(value) => setActionState((prev) => ({ ...prev, [id]: { comment: value } }))}
                    rejecting={Boolean(rejecting[id])}
                    onRejectingChange={(value) => setRejecting((prev) => ({ ...prev, [id]: value }))}
                    busy={decideAction.loading}
                    decided={decided[id]}
                    onApprove={() => decideAction.run(row, true).catch(() => {})}
                    onReject={(reason) => decideAction.run(row, false, reason).catch(() => {})}
                    now={now}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
        {shown.length ? (
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
        ) : null}
      </section>
    </section>
  );
}
