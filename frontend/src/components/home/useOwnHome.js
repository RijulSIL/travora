import { useEffect, useState } from 'react';

import { claimStanding } from '../claims/ClaimListRow';
import { RELOCATION_PURPOSE } from '../claims/ClaimRelocationSteps';
import { reimbursementApi } from '../../services/reimbursementApi';
import { claimWindow, claimWindowDays } from '../travel/travelRequestView';
import { dayOf, shortDate, today, weekdayDate } from './HomeParts';

/*
 * Everything Home shows about the viewer's *own* claims and travel — the part every role gets:
 * recent claims (with where each stands), upcoming trips, booked trips still to claim, drafts and
 * sent-back claims, and the money figures. One load on mount; nothing here writes.
 */

const IN_REVIEW = ['SUBMITTED', 'IN_APPROVAL', 'PENDING_EXCEPTION'];
const RECENT = 4;
const UPCOMING = 5;

export const travelRef = (id) => `TR-${String(id).padStart(4, '0')}`;

/** First and last travel dates of a travel request (multi-city requests keep them on the legs). */
export function requestSpan(request) {
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
  if (request.trip_type === 'MULTI_CITY' && legs.length) return [legs[0].from_city, ...legs.map((l) => l.to_city)];
  return [request.from_city, request.to_city].filter(Boolean);
}

const TRIP_STATUS = {
  PENDING: { pill: 'Awaiting approval', tone: 'amber' },
  PENDING_EXCEPTION: { pill: 'Exception review', tone: 'amber' },
  APPROVED: { pill: 'Approved · booking next', tone: 'sky' },
  PARTIALLY_BOOKED: { pill: 'Partly booked', tone: 'sky' },
  BOOKED: { pill: 'Booked', tone: 'ok' },
};

const MODE_NAME = { FLIGHT: 'Flight', TRAIN: 'Train', BUS: 'Bus' };

function claimTotal(claim) {
  return Number(claim.compliance_report?.total_claimed || 0);
}

/** Start of the Indian financial year (1 April) that `d` falls in. */
function financialYearStart(d) {
  return new Date(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1, 3, 1);
}

/** Booked trips with no claim yet (archived ones are left out), one entry per travel request, with where its claim window stands. */
function tripsToClaim(bookingTrips, windowDays) {
  const groups = new Map();
  for (const trip of bookingTrips) {
    if (['CANCELLED', 'REFUNDED'].includes(trip.status)) continue;
    const key = trip.travel_request_id ? `r${trip.travel_request_id}` : `t${trip.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trip);
  }
  const now = today();
  const out = [];
  for (const [key, trips] of groups) {
    trips.sort((a, b) => String(a.travel_date).localeCompare(String(b.travel_date)));
    const first = trips[0];
    const last = trips[trips.length - 1];
    const start = dayOf(first.travel_date);
    const end = [...trips.map((t) => dayOf(t.return_date)), ...trips.map((t) => dayOf(t.travel_date))]
      .filter(Boolean)
      .sort((a, b) => b - a)[0];
    if (!start || !end || end >= now) continue; // not travelled yet — nothing to claim
    const claimState = claimWindow(end, windowDays, now);
    if (claimState.state === 'archived') continue; // too late to claim (the server leaves these out too)
    const roundTrip = first.trip_type === 'ROUND_TRIP';
    const route = roundTrip ? `${first.from_city} ⇄ ${first.to_city}` : `${first.from_city} → ${last.to_city}`;
    const by = trips.every((t) => t.booked_by_travel_desk) ? 'booked by the travel desk' : 'booked';
    const modeName = (MODE_NAME[first.mode] || 'trip').toLowerCase();
    const ref = first.travel_request_id ? `${travelRef(first.travel_request_id)} · ` : '';
    const sub =
      trips.length === 1
        ? `${ref}${MODE_NAME[first.mode] || 'Trip'} on ${weekdayDate(start)} · ${first.provider || ''} ₹${Number(first.amount || 0).toLocaleString('en-IN')} ${by}`
        : `${ref}${roundTrip ? 'Round trip' : 'Trip'} ${shortDate(start)}–${shortDate(end)} · ${trips.length} ${modeName}s ${by}`;
    out.push({
      key,
      ids: trips.map((t) => t.id),
      route,
      sub: sub.replace(/\s+/g, ' '),
      deadline: claimState.deadline || claimState.lastDay,
      closed: false,
      late: claimState.state === 'late',
      when: claimState.text,
      soon: claimState.state === 'on_time' && claimState.left <= 1,
    });
  }
  // On time first (soonest deadline first), then late ones (soonest to be archived first).
  const onTime = out.filter((t) => !t.late).sort((a, b) => a.deadline - b.deadline);
  const late = out.filter((t) => t.late).sort((a, b) => a.deadline - b.deadline);
  return [...onTime, ...late];
}

export function useOwnHome(profile) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [claimsRes, travelRes, tripsRes, invoicesRes] = await Promise.allSettled([
        reimbursementApi.claims(),
        reimbursementApi.travelRequestsMy(),
        reimbursementApi.bookingTripsMy({ unlinked_only: true }),
        reimbursementApi.invoices({ unlinked: true }),
      ]);
      const claims = claimsRes.status === 'fulfilled' ? claimsRes.value.data || [] : [];
      const requests = travelRes.status === 'fulfilled' ? travelRes.value.data || [] : [];
      const booking = tripsRes.status === 'fulfilled' ? tripsRes.value.data || [] : [];
      const invoices = invoicesRes.status === 'fulfilled' ? (invoicesRes.value.data || []).filter((i) => !i.is_archived) : [];

      const recent = claims.slice(0, RECENT);
      const sentBack = claims.filter((c) => c.status === 'SENT_BACK');
      const needChain = [...new Map([...recent, ...sentBack].filter((c) => c.status !== 'DRAFT').map((c) => [c.id, c])).values()];
      const [chainEntries, noteEntries] = await Promise.all([
        Promise.all(
          needChain.map(async (c) => {
            try {
              return [c.id, (await reimbursementApi.approvalChain(c.id)).data];
            } catch {
              return [c.id, null];
            }
          }),
        ),
        // Who sent a claim back, and what they said (same lookup as My Claims).
        Promise.all(
          sentBack.map(async (c) => {
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
      const chains = Object.fromEntries(chainEntries);
      const notes = Object.fromEntries(noteEntries);

      // Money
      const inReview = claims.filter((c) => IN_REVIEW.includes(c.status));
      const toPay = claims.filter((c) => c.status === 'READY_FOR_PAYMENT');
      const fyStart = financialYearStart(today());
      const paid = claims
        .filter((c) => c.status === 'PAID' && c.payment_recorded_at && dayOf(c.payment_recorded_at) >= fyStart)
        .sort((a, b) => String(b.payment_recorded_at).localeCompare(String(a.payment_recorded_at)));

      // Upcoming trips: not cancelled/rejected, not relocation requests, ending today or later.
      const now = today();
      const upcoming = requests
        .map((row) => row.request || row)
        .filter((r) => TRIP_STATUS[r.status] && r.purpose !== RELOCATION_PURPOSE)
        .map((r) => ({ request: r, ...requestSpan(r) }))
        .filter((t) => t.start && t.end >= now)
        .sort((a, b) => a.start - b.start);

      setState({
        loading: false,
        claims,
        recent: recent.map((c) => ({ claim: c, standing: claimStanding(c, chains[c.id], notes[c.id]) })),
        sentBack: sentBack.map((c) => ({ claim: c, note: notes[c.id] })),
        drafts: claims.filter((c) => c.status === 'DRAFT'),
        toClaim: tripsToClaim(booking, claimWindowDays(profile)),
        upcoming: upcoming.slice(0, UPCOMING).map((t) => ({ ...t, status: TRIP_STATUS[t.request.status] })),
        moreUpcoming: Math.max(0, upcoming.length - UPCOMING),
        upcomingCount: upcoming.length,
        inReview,
        money: {
          waiting: inReview.reduce((a, c) => a + claimTotal(c), 0),
          waitingCount: inReview.length,
          waitingOnlyException: inReview.length > 0 && inReview.every((c) => c.status === 'PENDING_EXCEPTION'),
          toPay: toPay.reduce((a, c) => a + claimTotal(c), 0),
          toPayCount: toPay.length,
          paid: paid.reduce((a, c) => a + Number(c.payment_amount || 0), 0),
          paidCount: paid.length,
          lastPaid: paid[0] ? dayOf(paid[0].payment_recorded_at) : null,
          fyLabel: `FY ${fyStart.getFullYear()}–${String(fyStart.getFullYear() + 1).slice(2)}`,
          invoices: invoices.length,
          invoiceTotal: invoices.reduce((a, i) => a + Number(i.total_amount || 0), 0),
        },
      });
    })();
    return () => {
      cancelled = true;
    };
    // Loads once per visit; the profile only supplies the claim-deadline settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
