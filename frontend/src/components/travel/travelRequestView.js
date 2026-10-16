import { addWorkingDays, dayOf, daysBetween, shortDate, today, weekdayDate } from '../home/HomeParts';
import { formatRole } from '../../utils/formatters';

/*
 * How a travel request reads on the employee's Travel Requests page: which tab it belongs in
 * (upcoming / past / cancelled), where it stands in plain words (who it's waiting on, SLA passed,
 * trip date passed), its tickets, and whether its booked trips can still be claimed.
 */

export const MODE_NAME = { FLIGHT: 'Flight', TRAIN: 'Train', BUS: 'Bus' };
export const travelRef = (id) => `TR-${String(id).padStart(4, '0')}`;

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** First and last travel dates (multi-city requests keep them on the legs / segments). */
export function requestDates(request) {
  const dates = [request.travel_date, ...(request.legs || []).map((l) => l.travel_date), ...(request.segments || []).map((s) => s.travel_date)]
    .map(dayOf)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const start = dates[0] || null;
  const end = dayOf(request.return_date) || dates[dates.length - 1] || start;
  return { start, end };
}

export function requestRoute(request) {
  const legs = request.legs || [];
  if (request.trip_type === 'MULTI_CITY' && legs.length) return [legs[0].from_city, ...legs.map((l) => l.to_city)].map(cap);
  return [request.from_city, request.to_city].filter(Boolean).map(cap);
}

export function requestModes(request) {
  const segs = request.segments || [];
  return [...new Set(segs.length ? segs.map((s) => s.mode || request.travel_mode) : [request.travel_mode])].filter(Boolean);
}

/**
 * Everything the row and its opened view need. `chain` is the request's approval chain (may be
 * null while loading); `trips` = the employee's booked trips; `unclaimedIds` = ids of those not
 * on a claim yet; `claimDays` / `claimMode` = the claim deadline settings from the profile.
 */
export function describeRequest(request, chain, { trips = [], unclaimedIds = new Set(), claimDays = 5, claimMode = 'hard_block' } = {}) {
  const now = today();
  const { start, end } = requestDates(request);
  const status = request.status;
  const segs = request.segments || [];
  const ticketed = segs.filter((s) => s.ticket);
  const exc = request.exception;
  const excStages = (chain?.exception_stages || []).filter((s) => !exc || s.exception_request_id === exc.id);
  const stages = chain?.stages || [];
  const past = Boolean(end && end < now);
  const bucket = status === 'CANCELLED' || status === 'REJECTED' ? 'cancelled' : past ? 'past' : 'upcoming';

  let pill = cap(String(status || '').replace(/_/g, ' ').toLowerCase());
  let tone = 'slate';
  let note = '';
  if (status === 'PENDING_EXCEPTION') {
    pill = 'Exception review';
    tone = 'amber';
    const cur = excStages.find((s) => s.status === 'PENDING');
    const after = excStages.filter((s) => s.status === 'AWAITING').length;
    note = cur
      ? `Waiting on ${(cur.pending_approver_names || []).join(', ') || 'a decision'} (${formatRole(cur.required_role)})${after ? `, then ${after} more` : ''}`
      : chain
        ? 'Waiting on a decision'
        : '';
  } else if (status === 'PENDING') {
    pill = 'Awaiting approval';
    tone = 'amber';
    const cur = stages.find((s) => s.status === 'PENDING');
    if (cur) {
      note = `Waiting on ${(cur.pending_approver_names || []).join(', ') || 'approval'}`;
      const sla = dayOf(cur.sla_deadline_at);
      if (sla && sla < now) note += ` · SLA passed ${shortDate(sla)}`;
    }
  } else if (status === 'APPROVED') {
    pill = 'Approved';
    tone = 'sky';
    note = 'Waiting for the travel desk to book';
  } else if (status === 'PARTIALLY_BOOKED') {
    pill = 'Partly booked';
    tone = 'sky';
    const items = (request.booking_items || []).length;
    note = `${ticketed.length} of ${segs.length} ticket${segs.length === 1 ? '' : 's'}${items ? ` · ${items} extra booking${items === 1 ? '' : 's'}` : ''}`;
  } else if (status === 'BOOKED') {
    pill = 'Booked';
    tone = 'ok';
    note = ticketed.length === 1 && ticketed[0].ticket?.pnr_or_booking_ref ? `PNR ${ticketed[0].ticket.pnr_or_booking_ref}` : `${ticketed.length} of ${segs.length} tickets`;
  } else if (status === 'REJECTED') {
    pill = 'Rejected';
    tone = 'rose';
    const rej = excStages.find((s) => s.status === 'REJECTED') || stages.find((s) => s.status === 'REJECTED');
    note = rej ? `At the ${rej.required_role ? formatRole(rej.required_role) : rej.label} step` : request.rejection_reason || '';
  } else if (status === 'CANCELLED') {
    pill = 'Cancelled';
  }
  const stale = past && ['PENDING', 'PENDING_EXCEPTION', 'APPROVED', 'PARTIALLY_BOOKED'].includes(status);

  // Booked trips from this request that aren't on a claim yet, with the claim deadline.
  let claim = null;
  const mine = trips.filter((t) => t.travel_request_id === request.id && !['CANCELLED', 'REFUNDED'].includes(t.status));
  const open = mine.filter((t) => unclaimedIds.has(t.id));
  if (past && open.length) {
    const deadline = addWorkingDays(end, claimDays);
    const left = daysBetween(now, deadline);
    const closed = now > deadline;
    claim = {
      ids: open.map((t) => t.id),
      closed: closed && claimMode === 'hard_block',
      text: closed
        ? `Claim window closed ${shortDate(deadline)}`
        : `Claim by ${weekdayDate(deadline)} · ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `${left} days left`}`,
    };
  }

  return {
    bucket,
    start,
    end,
    route: requestRoute(request),
    modes: requestModes(request),
    pill,
    tone,
    note,
    stale,
    claim,
    ticketed,
    onNow: Boolean(start && end && start <= now && end >= now),
    cancellable: status === 'PENDING' || status === 'PENDING_EXCEPTION',
  };
}

/** The opened request's status banner: tone, title and one line of text. */
export function requestBanner(request, view) {
  if (view.stale && (request.status === 'PENDING' || request.status === 'PENDING_EXCEPTION')) {
    return {
      tone: 'amber',
      title: `The trip date has passed and it's still ${view.pill.toLowerCase()}`,
      text: `${view.note ? `${view.note}. ` : ''}If you didn't travel, cancel it so it stops waiting in someone's queue.`,
    };
  }
  if (view.stale) return { tone: 'amber', title: 'The trip date has passed', text: `${view.pill}: ${view.note.toLowerCase()}. Check with the travel desk.` };
  if (request.status === 'BOOKED') {
    if (view.claim) return { tone: 'ok', title: view.claim.closed ? 'Booked. The claim window has closed' : 'Booked. Now claim it', text: view.claim.text };
    return { tone: 'ok', title: 'Booked', text: `${view.ticketed.length} ticket${view.ticketed.length === 1 ? '' : 's'} uploaded by the travel desk.` };
  }
  if (request.status === 'REJECTED') return { tone: 'rose', title: 'Rejected', text: view.note || request.rejection_reason || '' };
  if (request.status === 'CANCELLED') return { tone: 'slate', title: 'Cancelled', text: 'This request was cancelled before it was decided.' };
  if (request.status === 'APPROVED' || request.status === 'PARTIALLY_BOOKED') return { tone: 'sky', title: view.pill, text: view.note };
  return { tone: 'amber', title: view.pill, text: view.note || 'Waiting on a decision' };
}
