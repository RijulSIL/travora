import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock, Eye, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

import ClaimReviewModal from '../components/claims/ClaimReviewModal';
import { relocationRef } from '../components/claims/ClaimRelocationSteps';
import RelocationApprovalPanel from '../components/claims/RelocationApprovalPanel';
import {
  BTN_NO,
  BTN_OK,
  BTN_PLAIN,
  DateBox,
  DecidedPill,
  DetailsButton,
  FilterButtons,
  PageHead,
  PassedOverNote,
  Pill,
  QueueRow,
  RouteLine,
  RowChips,
  RowSub,
  RowTitle,
  SlaBlock,
  Tabs,
  ago,
  inr,
  shortDay,
  slaLeft,
  travelShape,
} from '../components/approvals/ApprovalQueueParts';
import { dayOf, daysBetween, today } from '../components/home/HomeParts';
import TravelApprovalPanel from '../components/travel/TravelApprovalPanel';
import { travelRef } from '../components/travel/travelRequestView';
import { useSetPageTitle } from '../context/PageTitleContext';
import { useAsyncAction } from '../hooks/useAsyncAction';
import useToast from '../hooks/useToast';
import { hasAnyPermission } from '../services/permissions';
import { reimbursementApi } from '../services/reimbursementApi';
import { formatRole } from '../utils/formatters';
import { normalizeApiError } from '../utils/apiErrors';

const REIMBURSEMENT_TYPE_OPTIONS = [
  { value: 'TRAVEL', label: 'Travel' },
  { value: 'GENERAL', label: 'General' },
  { value: 'RELOCATION', label: 'Relocation' },
];
const CATEGORY_PILL = { TRAVEL: ['Travel', 'sky'], GENERAL: ['General', 'slate'], RELOCATION: ['Relocation', 'violet'] };

const QUEUES = ['claims', 'travel', 'relocation'];
const KIND_LABEL = { claims: 'Claim', travel: 'Travel request', relocation: 'Relocation' };
// Same gate as the claims/pending-approvals endpoint — a Recruiter reaches this page for the
// Relocation tab only and holds none of these.
const CLAIM_QUEUE_PERMISSIONS = ['approve_claims', 'process_payments', 'approve_exception'];

/** "Delhi → Mumbai · 2026-10-02–2026-10-18" (the queue's trip_summary) → route + "2 Oct – 18 Oct". */
function tripParts(summary) {
  if (!summary || summary === '—') return { route: null, dates: null };
  const [route, span] = summary.split(' · ');
  const [from, to] = (span || '').split('–');
  return { route, dates: from ? `${shortDay(from)}${to ? ` – ${shortDay(to)}` : ''}` : null };
}

function Empty({ title, text }) {
  return (
    <div className="px-4 py-9 text-center text-[12.5px] text-slate-500">
      <b className="mb-0.5 block text-sm text-ink">{title}</b>
      {text}
    </div>
  );
}

export default function PendingApprovals() {
  useSetPageTitle('Pending Approvals');
  const { showToast } = useToast();
  const profile = useAuthStore((state) => state.profile);
  const [searchParams, setSearchParams] = useSearchParams();
  const canSeeClaimQueue = hasAnyPermission(profile?.permissions, CLAIM_QUEUE_PERMISSIONS);
  // Which queues this person decides on: claims by permission; travel requests and relocations by
  // the live Approval Matrix (profile.approver_scope), the same checks the loader below uses.
  const visibleQueues = useMemo(
    () =>
      QUEUES.filter((key) =>
        key === 'claims'
          ? canSeeClaimQueue
          : key === 'travel'
            ? Boolean(profile?.approver_scope?.travel_request || profile?.is_acting_delegate)
            : Boolean(profile?.approver_scope?.relocation),
      ),
    [canSeeClaimQueue, profile?.approver_scope?.travel_request, profile?.approver_scope?.relocation, profile?.is_acting_delegate],
  );
  const showAll = visibleQueues.length > 1;
  // The sidebar's Claims / Travel Requests / Relocation links set ?tab=; the in-page tabs do too.
  const paramTab = searchParams.get('tab');
  const tab = visibleQueues.includes(paramTab) || (paramTab === 'all' && showAll) ? paramTab : showAll ? 'all' : visibleQueues[0] || 'claims';
  const setTab = (key) => setSearchParams(key === 'all' ? {} : { tab: key });

  const [rows, setRows] = useState([]);
  const [travelRows, setTravelRows] = useState([]);
  const [relocationRows, setRelocationRows] = useState([]);
  const [relocationComments, setRelocationComments] = useState({});
  const [relocationActing, setRelocationActing] = useState(null);
  const [relocationRejecting, setRelocationRejecting] = useState({});
  const [relocationDecided, setRelocationDecided] = useState({});
  const [travelComments, setTravelComments] = useState({});
  const [travelActing, setTravelActing] = useState(null);
  const [travelRejecting, setTravelRejecting] = useState({});
  const [travelDecided, setTravelDecided] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState({});
  const [slaFilter, setSlaFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [allKind, setAllKind] = useState('ALL');
  const [reviewClaimId, setReviewClaimId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (canSeeClaimQueue) {
        const res = await reimbursementApi.pendingApprovals();
        setRows(res.data || []);
      }

      // Relocation requests are decided by the Relocation Approval workflow's stage roles (e.g.
      // any Recruiter) — fetched whenever the live Approval Matrix gives this user a stage there.
      if (profile?.approver_scope?.relocation) {
        const resp = await reimbursementApi.relocationPending();
        setRelocationRows(resp.data || []);
        setRelocationDecided({});
      }

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
          sla_passed_over: r.sla_passed_over || [],
          ticket: null
        })));
        setTravelDecided({});
      }
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [canSeeClaimQueue, profile?.approver_scope?.travel_request, profile?.approver_scope?.relocation, profile?.is_acting_delegate]);

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

  // Like relocations: a decided travel request stays in place with the outcome until the queue
  // is next loaded.
  const onApproveTravel = async (item) => {
    const { request } = item;
    setTravelActing(request.id);
    try {
      const comment = (travelComments[request.id] || '').trim();
      const res = await reimbursementApi.travelApprove(request.id, { comment: comment || null });
      const updated = res.data || request;
      const toDesk = updated.status === 'APPROVED';
      setTravelRows((prev) => prev.map((r) => (r.request.id === request.id ? { ...r, request: updated } : r)));
      setTravelDecided((prev) => ({
        ...prev,
        [request.id]: {
          ok: true,
          pill: toDesk ? 'Approved → Travel desk' : 'Approved → next stage',
          text: `Approved${comment ? ' with your comment' : ''}. ${
            toDesk ? 'It has gone to the travel desk for booking.' : 'It has moved on to the next approver.'
          }`,
        },
      }));
      showToast('Request approved', 'success');
    } catch (e) {
      showToast(normalizeApiError(e).message, 'error');
      if (e.response?.status === 409) {
        await load();
      }
    } finally {
      setTravelActing(null);
    }
  };

  const onRejectTravel = async (item, reason) => {
    const { request } = item;
    setTravelActing(request.id);
    try {
      const res = await reimbursementApi.travelReject(request.id, { reason });
      setTravelRows((prev) => prev.map((r) => (r.request.id === request.id ? { ...r, request: res.data || request } : r)));
      setTravelDecided((prev) => ({
        ...prev,
        [request.id]: { ok: false, pill: 'Rejected', text: `Rejected. ${item.employee_display_name || 'The employee'} has been told why.` },
      }));
      showToast('Request rejected', 'success');
    } catch (e) {
      showToast(normalizeApiError(e).message, 'error');
      if (e.response?.status === 409) {
        await load();
      }
    } finally {
      setTravelActing(null);
    }
  };

  const openTravel = (request, rejecting) => {
    setExpanded((prev) => ({ ...prev, [`travel_${request.id}`]: true }));
    setTravelRejecting((prev) => ({ ...prev, [request.id]: rejecting }));
  };

  // A decided relocation stays in place (with its updated route and the outcome) until the queue
  // is next loaded, so the approver sees what happened instead of the row just vanishing.
  const markRelocationDecided = (row, summary, decision) => {
    setRelocationRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...summary } : r)));
    setRelocationDecided((prev) => ({ ...prev, [row.id]: decision }));
  };

  const onApproveRelocation = async (row) => {
    setRelocationActing(row.id);
    try {
      const comment = (relocationComments[row.id] || '').trim();
      const res = await reimbursementApi.approveRelocation(row.id, { comment: comment || null });
      const summary = res.data || {};
      const nextStage = (summary.stages || []).find((s) => s.stage_number === summary.current_approval_stage);
      const name = row.employee_name || 'The employee';
      const text =
        summary.status === 'APPROVED'
          ? `Approved${comment ? ' with your comment' : ''}. ${relocationRef(row)} is fully approved, and ${name} has been told they can raise the claim.`
          : `Approved${comment ? ' with your comment' : ''}. ${relocationRef(row)} has moved on to ${nextStage ? formatRole(nextStage.required_role) : 'the next stage'}.`;
      markRelocationDecided(row, summary, {
        ok: true,
        text,
        pill: summary.status === 'APPROVED' ? 'Fully approved' : `Approved → ${nextStage ? formatRole(nextStage.required_role) : 'next stage'}`,
      });
      showToast(`${relocationRef(row)} approved`, 'success');
    } catch (e) {
      showToast(normalizeApiError(e).message, 'error');
      if (e.response?.status === 409 || e.response?.status === 403) await load();
    } finally {
      setRelocationActing(null);
    }
  };

  const onRejectRelocation = async (row, reason) => {
    setRelocationActing(row.id);
    try {
      const res = await reimbursementApi.rejectRelocation(row.id, { reason });
      const name = row.employee_name || 'The employee';
      markRelocationDecided(row, res.data || {}, {
        ok: false,
        text: `Rejected. ${name} has been told why.`,
        pill: 'Rejected',
      });
      showToast(`${relocationRef(row)} rejected`, 'success');
    } catch (e) {
      showToast(normalizeApiError(e).message, 'error');
      if (e.response?.status === 409 || e.response?.status === 403) await load();
    } finally {
      setRelocationActing(null);
    }
  };

  const openRelocation = (row, rejecting) => {
    setExpanded((prev) => ({ ...prev, [`relocation_${row.id}`]: true }));
    setRelocationRejecting((prev) => ({ ...prev, [row.id]: rejecting }));
  };

  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // ---- what's waiting, most urgent first ----
  const relocationDeadline = (row) =>
    (row.stages || []).find((s) => s.stage_number === row.current_approval_stage)?.sla_deadline_at || null;
  const claimOverdue = (r) => {
    const left = slaLeft(r.sla_deadline_at, now);
    return left ? left.over : r.sla_bucket === 'breached';
  };
  const sortedClaims = useMemo(
    () => [...rows].sort((a, b) => new Date(a.sla_deadline_at || 8.64e15) - new Date(b.sla_deadline_at || 8.64e15)),
    [rows],
  );
  const filteredClaims = sortedClaims.filter((row) => {
    const amount = Number(row.amount || 0);
    const min = Number(minAmount || 0);
    const max = Number(maxAmount || Number.POSITIVE_INFINITY);
    const matchSla = slaFilter === 'ALL' ? true : row.sla_bucket.toUpperCase() === slaFilter;
    const matchCategory =
      categoryFilter === 'ALL' ? true : (row.reimbursement_category || 'TRAVEL') === categoryFilter;
    return matchSla && matchCategory && amount >= min && amount <= max;
  });
  const sortedTravel = useMemo(
    () => [...travelRows].sort((a, b) => (dayOf(travelShape(a.request).first) || 0) - (dayOf(travelShape(b.request).first) || 0)),
    [travelRows],
  );
  const sortedRelocations = useMemo(
    () => [...relocationRows].sort((a, b) => new Date(relocationDeadline(a) || a.created_at) - new Date(relocationDeadline(b) || b.created_at)),
    [relocationRows],
  );

  const counts = {
    claims: rows.length,
    travel: travelRows.filter((r) => !travelDecided[r.request.id]).length,
    relocation: relocationRows.filter((r) => !relocationDecided[r.id]).length,
  };
  counts.all = visibleQueues.reduce((sum, key) => sum + counts[key], 0);
  const pastSla =
    rows.filter(claimOverdue).length +
    relocationRows.filter((r) => !relocationDecided[r.id] && slaLeft(relocationDeadline(r), now)?.over).length;
  const dueSoon = rows.filter((r) => !claimOverdue(r) && r.sla_bucket === 'warning').length;
  const claimFiltersOn = slaFilter !== 'ALL' || categoryFilter !== 'ALL' || minAmount || maxAmount;

  // ---- rows ----
  const kindPill = (kind, labelled) => (labelled ? <Pill tone="brand">{KIND_LABEL[kind]}</Pill> : null);

  const claimRow = (r, labelled = false) => {
    const quickApproveEligible = (r.exceptions_summary || []).every((x) => x === 'Compliant') && r.sla_bucket !== 'breached';
    const why = !quickApproveEligible
      ? (r.exceptions_summary || []).some((x) => x !== 'Compliant')
        ? 'Has policy flags: open Review'
        : 'Past SLA: open Review'
      : undefined;
    const { route, dates } = tripParts(r.trip_summary);
    const [catLabel, catTone] = CATEGORY_PILL[r.reimbursement_category] || CATEGORY_PILL.TRAVEL;
    const flags = (r.exceptions_summary || []).filter((x) => x !== 'Compliant');
    return (
      <QueueRow
        key={`claim-${r.claim_id}`}
        wideLead
        lead={<SlaBlock deadline={r.sla_deadline_at} bucket={r.sla_bucket} now={now} />}
        main={
          <>
            <RowTitle>
              {kindPill('claims', labelled)}
              <span>{r.claim_reference}</span>
              <Pill tone={catTone}>{catLabel}</Pill>
            </RowTitle>
            <RowSub>
              {r.employee_name || r.employee_label}
              {r.department ? ` · ${r.department}` : ''}
              {route ? ` · ${route}${dates ? `, ${dates}` : ''}` : ''}
            </RowSub>
            <RowChips>
              {flags.length ? (
                flags.map((x) => (
                  <Pill key={x} tone="rose">
                    <AlertTriangle size={11} /> {x}
                  </Pill>
                ))
              ) : (
                <Pill tone="ok">
                  <Check size={11} /> Within policy
                </Pill>
              )}
              <PassedOverNote stages={r.sla_passed_over} />
            </RowChips>
          </>
        }
        side={
          <>
            <b className="block font-mono text-sm font-semibold tabular-nums text-ink">{inr(r.amount)}</b>
            {r.submitted_at ? <span className="text-[11.5px] text-slate-500">Submitted {shortDay(r.submitted_at)}</span> : null}
          </>
        }
        actions={
          <>
            <button type="button" className={BTN_PLAIN} onClick={() => setReviewClaimId(r.claim_id)}>
              <Eye size={13} /> Review
            </button>
            <button
              type="button"
              disabled={acting || !quickApproveEligible}
              title={why}
              className={BTN_OK}
              onClick={() => approve(r.claim_id)}
            >
              <Check size={13} /> Quick approve
            </button>
          </>
        }
      />
    );
  };

  const travelRow = (item, labelled = false) => {
    const { request, employee_display_name, impact_level_code, sla_passed_over } = item;
    const shape = travelShape(request);
    const key = `travel_${request.id}`;
    const busy = travelActing === request.id;
    const decision = travelDecided[request.id];
    const startDay = dayOf(shape.first);
    const inDays = startDay ? daysBetween(today(), startDay) : null;
    return (
      <QueueRow
        key={key}
        wideLead={labelled}
        lead={<DateBox value={shape.first} />}
        main={
          <>
            <RowTitle>
              {kindPill('travel', labelled)}
              <RouteLine stops={shape.stops} modes={shape.modes} roundTrip={shape.roundTrip} />
              <Pill tone={request.trip_type === 'MULTI_CITY' ? 'violet' : 'slate'}>{shape.kind}</Pill>
              <DecidedPill decision={decision} />
            </RowTitle>
            <RowSub>
              {travelRef(request.id)} · {employee_display_name || '—'}
              {impact_level_code ? ` (${impact_level_code})` : ''}
              {request.purpose ? ` · ${request.purpose}` : ''}
              {request.travel_type === 'PROJECT' && request.project_code ? ` · ${request.project_code}` : ''}
            </RowSub>
            <RowChips>
              {inDays != null && inDays < 0 ? (
                <Pill tone="amber">Travel date passed {inDays === -1 ? 'yesterday' : `${-inDays} days ago`}</Pill>
              ) : inDays === 0 ? (
                <Pill tone="amber">Travels today</Pill>
              ) : inDays != null && inDays <= 3 ? (
                <Pill tone="sky">Travels in {inDays} day{inDays > 1 ? 's' : ''}</Pill>
              ) : null}
              {request.exception ? (
                <Pill tone="orange">
                  <AlertTriangle size={11} /> Policy exception on this trip
                </Pill>
              ) : null}
              <PassedOverNote stages={sla_passed_over} />
            </RowChips>
          </>
        }
        side={request.requested_at ? <span className="text-[11.5px] text-slate-500">Requested {ago(request.requested_at)}</span> : null}
        actions={
          <>
            <DetailsButton open={Boolean(expanded[key])} onClick={() => toggle(key)} />
            <button
              type="button"
              disabled={busy || Boolean(decision)}
              className={BTN_OK}
              onClick={() => {
                openTravel(request, false);
                onApproveTravel(item);
              }}
            >
              <Check size={13} /> Approve
            </button>
            <button type="button" disabled={busy || Boolean(decision)} className={BTN_NO} onClick={() => openTravel(request, true)}>
              <X size={13} /> Reject
            </button>
          </>
        }
        panel={
          expanded[key] ? (
            <TravelApprovalPanel
              request={request}
              employeeName={employee_display_name}
              comment={travelComments[request.id] || ''}
              onCommentChange={(value) => setTravelComments((prev) => ({ ...prev, [request.id]: value }))}
              rejecting={Boolean(travelRejecting[request.id])}
              onRejectingChange={(value) => setTravelRejecting((prev) => ({ ...prev, [request.id]: value }))}
              busy={busy}
              decided={decision}
              onApprove={() => onApproveTravel(item)}
              onReject={(reason) => onRejectTravel(item, reason)}
              now={now}
            />
          ) : null
        }
      />
    );
  };

  const relocationRow = (row, labelled = false) => {
    const key = `relocation_${row.id}`;
    const deadline = relocationDeadline(row);
    const left = slaLeft(deadline, now);
    // The panel's own SLA line, in the wording it has always had ("40h 12m" / "SLA Breached").
    const msLeft = deadline ? new Date(deadline).getTime() - now : null;
    const slaText =
      msLeft == null ? null : msLeft <= 0 ? 'SLA Breached' : `${Math.floor(msLeft / 3600000)}h ${Math.floor((msLeft % 3600000) / 60000)}m`;
    const busy = relocationActing === row.id;
    const decided = relocationDecided[row.id];
    const details = row.details || {};
    const later = (row.stages || []).filter((s) => s.stage_number > row.current_approval_stage).map((s) => s.label);
    return (
      <QueueRow
        key={key}
        wideLead={labelled}
        lead={<DateBox value={details.planned_move_date} />}
        main={
          <>
            <RowTitle>
              {kindPill('relocation', labelled)}
              <span>{relocationRef(row)}</span>
              <RouteLine stops={[row.origin_city, row.destination_city]} />
              <DecidedPill decision={decided} />
            </RowTitle>
            <RowSub>
              {row.employee_name || '—'}
              {details.planned_move_date ? ` · moving ${shortDay(details.planned_move_date)}` : ''}
              {details.family_members ? ` · ${details.family_members} family member${Number(details.family_members) === 1 ? '' : 's'}` : ''}
              {row.created_at ? ` · requested ${ago(row.created_at)}` : ''}
            </RowSub>
            {!decided ? (
              <RowChips>
                <Pill tone={left ? (left.over ? 'rose' : left.hours < 12 ? 'amber' : 'ok') : 'slate'}>
                  {left ? <Clock size={11} /> : null}
                  {left ? `${left.over ? `Past SLA by ${left.text}` : `${left.text} left`} · ` : ''}
                  {row.waiting_on_stage}
                </Pill>
                {later.length ? <Pill tone="slate">Then {later.join(' → ')}</Pill> : null}
                <PassedOverNote stages={row.sla_passed_over} />
              </RowChips>
            ) : null}
          </>
        }
        side={
          <>
            <b className="block font-mono text-sm font-semibold tabular-nums text-ink">{row.estimated_amount ? inr(row.estimated_amount) : '—'}</b>
            <span className="text-[11.5px] text-slate-500">Estimate</span>
          </>
        }
        actions={
          <>
            <DetailsButton open={Boolean(expanded[key])} onClick={() => toggle(key)} />
            <button
              type="button"
              disabled={busy || Boolean(decided)}
              className={BTN_OK}
              onClick={() => {
                openRelocation(row, false);
                onApproveRelocation(row);
              }}
            >
              <Check size={13} /> Approve
            </button>
            <button type="button" disabled={busy || Boolean(decided)} className={BTN_NO} onClick={() => openRelocation(row, true)}>
              <X size={13} /> Reject
            </button>
          </>
        }
        panel={
          expanded[key] ? (
            <RelocationApprovalPanel
              row={row}
              slaLeft={slaText}
              comment={relocationComments[row.id] || ''}
              onCommentChange={(value) => setRelocationComments((prev) => ({ ...prev, [row.id]: value }))}
              rejecting={Boolean(relocationRejecting[row.id])}
              onRejectingChange={(value) => setRelocationRejecting((prev) => ({ ...prev, [row.id]: value }))}
              busy={busy}
              decided={decided}
              onApprove={() => onApproveRelocation(row)}
              onReject={(reason) => onRejectRelocation(row, reason)}
            />
          ) : null
        }
      />
    );
  };

  // Everything in one list: claims and relocations by their SLA deadline, travel requests by
  // their travel date (they carry no SLA time).
  const allItems = [
    ...(visibleQueues.includes('claims') ? sortedClaims.map((r) => ({ kind: 'claims', at: new Date(r.sla_deadline_at || 8.64e15).getTime(), node: () => claimRow(r, true) })) : []),
    ...(visibleQueues.includes('travel')
      ? sortedTravel.map((item) => ({ kind: 'travel', at: (dayOf(travelShape(item.request).first) || new Date(8.64e15)).getTime(), node: () => travelRow(item, true) }))
      : []),
    ...(visibleQueues.includes('relocation')
      ? sortedRelocations.map((row) => ({ kind: 'relocation', at: new Date(relocationDeadline(row) || row.created_at).getTime(), node: () => relocationRow(row, true) }))
      : []),
  ]
    .filter((i) => allKind === 'ALL' || i.kind === allKind)
    .sort((a, b) => a.at - b.at);

  const loadingNote = (
    <div className="flex items-center gap-2 px-4 py-6 text-xs font-bold text-slate-500">
      <Clock className="animate-spin text-slate-400" size={15} /> Loading the queue…
    </div>
  );

  return (
    <section className="flex flex-col gap-3.5">
      <PageHead
        title="Pending approvals"
        sub="What's waiting for your decision, most urgent first."
        stats={[
          { label: 'Waiting on you', value: counts.all },
          { label: 'Past SLA', value: pastSla, tone: 'rose' },
          ...(visibleQueues.includes('claims') ? [{ label: 'Due within 12 hours', value: dueSoon, tone: 'amber' }] : []),
        ]}
      />

      <Tabs
        label="Queue"
        value={tab}
        onChange={setTab}
        tabs={[
          ...(showAll ? [{ key: 'all', label: 'All', count: counts.all, hot: pastSla > 0 }] : []),
          ...visibleQueues.map((key) => ({
            key,
            label: { claims: 'Claims', travel: 'Travel requests', relocation: 'Relocation' }[key],
            count: counts[key],
            hot: key === 'claims' && rows.some(claimOverdue),
          })),
        ]}
      />

      {error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[13px] text-amber-900">{error}</div> : null}

      {tab === 'all' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <FilterButtons
              label="Show"
              value={allKind}
              onChange={setAllKind}
              options={[['ALL', 'Everything'], ...visibleQueues.map((key) => [key, { claims: 'Claims', travel: 'Travel requests', relocation: 'Relocation' }[key]])]}
            />
          </div>
          <section aria-label="Everything waiting" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
            {loading && !allItems.length ? loadingNote : null}
            {!loading && !allItems.length ? <Empty title="Nothing waiting on you" text="You're all caught up. New requests show up here." /> : null}
            {allItems.map((i) => i.node())}
          </section>
        </>
      ) : null}

      {tab === 'claims' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <FilterButtons
              label="SLA"
              value={slaFilter}
              onChange={setSlaFilter}
              options={[['ALL', 'Any SLA'], ['BREACHED', 'Past SLA'], ['WARNING', 'Due soon'], ['OK', 'On time']]}
            />
            <FilterButtons
              label="Reimbursement type"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                ['ALL', 'All types'],
                ...REIMBURSEMENT_TYPE_OPTIONS.filter(
                  (opt) =>
                    !profile?.approver_scope?.claim_categories?.length ||
                    profile.approver_scope.claim_categories.includes(opt.value)
                ).map((opt) => [opt.value, opt.label]),
              ]}
            />
            <label className="inline-flex h-[34px] items-center gap-1 rounded-[10px] border border-slate-200 bg-white px-2 text-xs font-bold text-slate-500">
              ₹
              <input
                className="w-[70px] bg-transparent text-[12.5px] text-ink outline-none"
                type="number"
                min="0"
                placeholder="Min"
                aria-label="Minimum amount"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
              />
              –
              <input
                className="w-[70px] bg-transparent text-[12.5px] text-ink outline-none"
                type="number"
                min="0"
                placeholder="Max"
                aria-label="Maximum amount"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
              />
            </label>
            {claimFiltersOn ? (
              <button
                type="button"
                className="px-1 text-xs font-bold text-brand hover:text-brand/80"
                onClick={() => {
                  setSlaFilter('ALL');
                  setCategoryFilter('ALL');
                  setMinAmount('');
                  setMaxAmount('');
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
          <section aria-label="Claims waiting" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
            {loading && !rows.length ? loadingNote : null}
            {!loading && !rows.length ? <Empty title="No claims waiting" text="You're all caught up. New claims show up here." /> : null}
            {!loading && rows.length && !filteredClaims.length ? <Empty title="Nothing matches" text="Try clearing the filters." /> : null}
            {filteredClaims.map((r) => claimRow(r))}
          </section>
        </>
      ) : null}

      {tab === 'travel' ? (
        <section aria-label="Travel requests waiting" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
          {loading && !travelRows.length ? loadingNote : null}
          {!loading && !travelRows.length ? <Empty title="No travel requests waiting" text="You're all caught up." /> : null}
          {sortedTravel.map((item) => travelRow(item))}
        </section>
      ) : null}

      {tab === 'relocation' ? (
        <section aria-label="Relocation requests waiting" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
          {loading && !relocationRows.length ? loadingNote : null}
          {!loading && !relocationRows.length ? <Empty title="No relocation requests waiting" text="You're all caught up." /> : null}
          {sortedRelocations.map((row) => relocationRow(row))}
        </section>
      ) : null}

      {reviewClaimId ? (
        <ClaimReviewModal
          claimId={reviewClaimId}
          onClose={() => {
            setReviewClaimId(null);
            load();
          }}
        />
      ) : null}
    </section>
  );
}
