import { Eye, Ticket } from 'lucide-react';
import { useState } from 'react';

import { reimbursementApi } from '../../services/reimbursementApi';
import { showToast } from '../../store/toastStore';
import { formatWeekdayDate } from '../../utils/formatters';
import { MODE_ICON } from './TravelRequestFormParts';

const inr = (v) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const CARD_EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400';

/**
 * A travel request's tickets, each leg's to open, for approvers and the Travel Desk. A trip the
 * employee booked themselves (booked_by SELF) says so, and says where its tickets are before
 * they're uploaded (after approval); any other request shows nothing until it has one.
 *
 * `onView(ticket, title)` opens a ticket (the desk's preview); without it, a new tab.
 */
export default function RequestTickets({ request, name = 'the employee', onView }) {
  const [opening, setOpening] = useState(null);
  const selfBooked = request?.booked_by === 'SELF';
  const segments = request?.segments || [];
  const ticketed = segments.filter((s) => s.ticket);
  if (!request || (!selfBooked && !ticketed.length)) return null;
  const total = ticketed.reduce((sum, s) => sum + Number(s.ticket.ticket_amount || 0), 0);

  const open = async (seg) => {
    if (onView) {
      onView(seg.ticket, `Ticket · ${seg.label}`);
      return;
    }
    setOpening(seg.ticket.id);
    try {
      const res = await reimbursementApi.travelTicketFileBlob(seg.ticket.id);
      window.open(URL.createObjectURL(res.data), '_blank', 'noopener');
    } catch {
      showToast('Could not open the ticket', 'error');
    } finally {
      setOpening(null);
    }
  };

  const waiting = ['PENDING', 'PENDING_EXCEPTION'].includes(request.status)
    ? 'They upload the tickets once this is approved.'
    : request.status === 'APPROVED'
      ? `Approved. Waiting for ${name} to upload the tickets.`
      : 'No tickets were uploaded.';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={CARD_EYEBROW}>
            Tickets{segments.length > 1 && ticketed.length ? ` · ${ticketed.length} of ${segments.length}` : ''}
          </h3>
          {selfBooked ? (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10.5px] font-bold text-sky-700">Booked by {name}</span>
          ) : null}
        </div>
        {total > 0 ? (
          <span className="text-[12px] font-semibold text-slate-500">
            Fares <b className="tabular-nums text-ink">{inr(total)}</b>
          </span>
        ) : null}
      </div>

      {ticketed.length ? (
        <ul className="mt-3 space-y-2">
          {segments.map((s) => {
            const Icon = MODE_ICON[s.mode || request.travel_mode] || Ticket;
            const meta = s.ticket
              ? [
                  s.travel_date ? formatWeekdayDate(s.travel_date) : null,
                  s.ticket.external_booking_source,
                  s.ticket.pnr_or_booking_ref ? `PNR ${s.ticket.pnr_or_booking_ref}` : null,
                  s.ticket.ticket_amount ? inr(s.ticket.ticket_amount) : null,
                ]
              : [s.travel_date ? formatWeekdayDate(s.travel_date) : null, 'No ticket uploaded yet'];
            return (
              <li key={s.seq} className="flex items-center gap-3 rounded-[10px] border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500">
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[12.5px] text-ink">
                    {s.from_city} → {s.to_city}
                  </b>
                  <span className="block truncate text-[11.5px] text-slate-500">{meta.filter(Boolean).join(' · ')}</span>
                </span>
                {s.ticket ? (
                  <button
                    type="button"
                    onClick={() => open(s)}
                    disabled={opening === s.ticket.id}
                    aria-label={`View ticket: ${s.from_city} → ${s.to_city}`}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-bold text-ink hover:bg-slate-50 disabled:opacity-60"
                  >
                    <Eye size={14} /> <span className="hidden sm:inline">{opening === s.ticket.id ? 'Opening…' : 'View ticket'}</span>
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Pending</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-slate-600">{waiting}</p>
      )}
    </section>
  );
}
