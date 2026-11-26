/*
 * A trip the employee booked themselves (booked_by SELF): once it's fully approved they upload a
 * ticket for every leg. Each ticket is read as it's attached (booking reference, who it's with,
 * fare) and they check every field before submitting (self_booked_travel_service on the server).
 */

export const TICKET_FIELDS = ['pnr', 'provider', 'amount'];

/** A fare as typed ("₹4,500") as the server takes it ("4500"). */
export const plainAmount = (value) => String(value ?? '').replace(/[,₹\s]/g, '');

/** What's missing on a leg's ticket, or null when it's complete. */
export function selfTicketError(t) {
  if (!t?.ref) return 'Attach the ticket';
  if (!String(t.pnr || '').trim()) return 'Enter the booking reference (PNR)';
  if (!String(t.provider || '').trim()) return 'Enter who it’s with';
  const amount = Number(plainAmount(t.amount));
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter the fare in rupees';
  return null;
}

/** The checked tickets as they're submitted: one per leg, by the leg's `seq`. */
export function selfTicketsPayload(segments, tickets) {
  return segments.map((seg) => {
    const t = tickets[seg.seq] || {};
    return {
      seq: seg.seq,
      ref: t.ref,
      filename: t.filename || null,
      pnr_or_booking_ref: String(t.pnr || '').trim(),
      provider: String(t.provider || '').trim(),
      ticket_amount: plainAmount(t.amount),
    };
  });
}

/**
 * Fills a leg's fields from what reading its ticket found. A field is filled when it's empty or
 * still holds what reading the previous ticket put there; anything typed by hand is kept.
 * Returns the new fields and which ones were filled from this ticket.
 */
export function fillFromRead(current, previousRead, read) {
  const next = { ...current };
  const filled = [];
  for (const field of TICKET_FIELDS) {
    const value = read?.[field];
    if (!value) {
      // The previous ticket's value no longer applies when this one doesn't show it.
      if (previousRead?.[field] && current[field] === previousRead[field]) next[field] = '';
      continue;
    }
    const untouched = !String(current[field] || '').trim() || current[field] === previousRead?.[field];
    if (untouched) {
      next[field] = value;
      filled.push(field);
    }
  }
  return { fields: next, filled };
}

/** "Airline" for a flight, and so on: who the ticket is with. */
export function providerLabel(mode) {
  return { FLIGHT: 'Airline', TRAIN: 'Railway', BUS: 'Bus operator' }[mode] || 'Airline / railway / operator';
}

/** Whether this request is approved and waiting on the employee's own tickets. */
export function awaitingSelfTickets(request) {
  return request?.booked_by === 'SELF' && request.status === 'APPROVED' && !(request.segments || []).some((s) => s.ticket);
}
