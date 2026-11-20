import { FileCheck2, UploadCloud } from 'lucide-react';
import { useState } from 'react';

import { reimbursementApi } from '../../services/reimbursementApi';
import { showToast } from '../../store/toastStore';
import { formatWeekdayDate } from '../../utils/formatters';
import { EYEBROW, FIELD, LABEL } from './TravelRequestFormParts';

/*
 * A trip the employee booked themselves (booked_by SELF): a ticket for every leg of the journey,
 * attached with the request — the file, its booking reference, who it's with and the fare
 * (self_booked_travel_service on the server). Approvers see them before deciding.
 */

const EMPTY = { ref: '', filename: '', pnr: '', provider: '', amount: '' };

/** What's missing on a leg's ticket, or null when it's complete. */
export function selfTicketError(t) {
  if (!t?.ref) return 'Attach the ticket';
  if (!String(t.pnr || '').trim()) return 'Enter the booking reference (PNR)';
  if (!String(t.provider || '').trim()) return 'Enter the airline, railway or operator';
  const amount = Number(String(t.amount || '').replace(/[,₹\s]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter the fare in rupees';
  return null;
}

/** The tickets as the request sends them: one per leg, `seq` matching the leg's order. */
export function selfTicketsPayload(segments, tickets) {
  return segments.map((seg, i) => {
    const t = tickets[seg.key] || EMPTY;
    return {
      seq: i + 1,
      ref: t.ref,
      filename: t.filename || null,
      pnr_or_booking_ref: String(t.pnr || '').trim(),
      provider: String(t.provider || '').trim(),
      ticket_amount: String(t.amount || '').replace(/[,₹\s]/g, ''),
    };
  });
}

function FieldError({ children }) {
  return children ? <p className="mt-1 text-[11px] font-bold text-rose-600">{children}</p> : null;
}

const inr = (v) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Approvers' view of a self-booked request: "Booked by …", then each leg's ticket to open. */
export function SelfBookedTickets({ request, name = 'the employee' }) {
  const [opening, setOpening] = useState(null);
  if (request?.booked_by !== 'SELF') return null;
  const segments = request.segments || [];
  const total = segments.reduce((sum, s) => sum + Number(s.ticket?.ticket_amount || 0), 0);
  const open = async (ticketId) => {
    setOpening(ticketId);
    try {
      const res = await reimbursementApi.travelTicketFileBlob(ticketId);
      window.open(URL.createObjectURL(res.data), '_blank', 'noopener');
    } catch {
      showToast('Could not open the ticket', 'error');
    } finally {
      setOpening(null);
    }
  };
  return (
    <div className="rounded-[10px] border border-sky-100 bg-sky-50/50 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <b className="text-[12.5px] text-ink">Booked by {name}</b>
        {total > 0 ? <span className="text-[11.5px] font-semibold text-slate-600">Fares {inr(total)}</span> : null}
      </div>
      <ul className="mt-1.5 divide-y divide-sky-100">
        {segments.map((s) => (
          <li key={s.seq} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[12px]">
            <span className="min-w-0">
              <span className="font-semibold text-ink">{s.label}</span>
              <span className="block text-[11px] text-slate-500">
                {s.ticket
                  ? [s.ticket.external_booking_source, s.ticket.pnr_or_booking_ref ? `PNR ${s.ticket.pnr_or_booking_ref}` : null, s.ticket.ticket_amount ? inr(s.ticket.ticket_amount) : null]
                      .filter(Boolean)
                      .join(' · ')
                  : 'No ticket attached'}
              </span>
            </span>
            {s.ticket ? (
              <button
                type="button"
                onClick={() => open(s.ticket.id)}
                disabled={opening === s.ticket.id}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] font-bold text-ink hover:bg-slate-50 disabled:opacity-60"
              >
                {opening === s.ticket.id ? 'Opening…' : 'View ticket'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SelfTicketSlots({ segments, tickets, onChange, showErrors = false, onUploadingChange }) {
  const [uploadingKey, setUploadingKey] = useState(null);
  const set = (key, patch) => onChange({ ...tickets, [key]: { ...EMPTY, ...tickets[key], ...patch } });

  const pickFile = (key) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.heic';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        showToast('The ticket file can be up to 10 MB', 'error');
        return;
      }
      const fd = new FormData();
      fd.append('file', file);
      setUploadingKey(key);
      onUploadingChange?.(true);
      try {
        const r = await reimbursementApi.uploadSelfTicket(fd);
        set(key, { ref: r.data.ref, filename: r.data.filename });
      } catch (err) {
        const detail = err?.response?.data?.detail;
        showToast(typeof detail === 'string' ? detail : 'Could not upload the ticket', 'error');
      } finally {
        setUploadingKey(null);
        onUploadingChange?.(false);
      }
    };
    input.click();
  };

  return (
    <section className="space-y-3">
      <div>
        <p className={EYEBROW}>Your tickets</p>
        <p className="mt-0.5 text-[11.5px] text-slate-500">
          You&apos;ve booked this trip yourself, so attach the ticket for each part of the journey. Your approvers see them, and you claim the fares on
          your travel claim after you travel.
        </p>
      </div>
      {segments.map((seg, i) => {
        const t = { ...EMPTY, ...tickets[seg.key] };
        const err = showErrors ? selfTicketError(t) : null;
        // Each leg is named by where it goes and when, never "onward" / "return".
        const route = seg.from || seg.to ? `${seg.from || '…'} → ${seg.to || '…'}` : `Leg ${i + 1}`;
        const id = `self-ticket-${i}`;
        return (
          <div key={seg.key} className={`space-y-2.5 rounded-xl border p-3 ${err ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <b className="text-[12.5px] text-ink">{route}</b>
              <span className="text-[11px] font-semibold text-slate-500">{seg.date ? formatWeekdayDate(seg.date) : 'Date not set yet'}</span>
            </div>
            <button
              type="button"
              onClick={() => pickFile(seg.key)}
              disabled={uploadingKey !== null}
              className={`w-full rounded-[10px] border-2 px-3 py-2.5 text-center text-xs font-semibold transition-colors ${
                t.ref
                  ? 'border-solid border-emerald-200 bg-emerald-50 text-emerald-800'
                  : err === 'Attach the ticket'
                    ? 'border-dashed border-rose-300 bg-rose-50/40 text-rose-700'
                    : 'border-dashed border-slate-200 bg-slate-50/60 text-slate-500 hover:border-brand/40'
              }`}
            >
              {uploadingKey === seg.key ? (
                'Uploading…'
              ) : t.ref ? (
                <span className="inline-flex items-center gap-1.5">
                  <FileCheck2 size={15} className="shrink-0" /> <span className="break-all">{t.filename || 'Ticket attached'}</span> (click to replace)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <UploadCloud size={15} className="shrink-0" /> Attach the ticket: PDF, JPG, PNG or HEIC, up to 10 MB
                </span>
              )}
            </button>
            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
              <div>
                <label htmlFor={`${id}-pnr`} className={LABEL}>
                  Booking reference (PNR)
                </label>
                <input id={`${id}-pnr`} className={`${FIELD} font-mono uppercase`} maxLength={128} value={t.pnr} onChange={(e) => set(seg.key, { pnr: e.target.value })} placeholder="e.g. X7K2QP" />
              </div>
              <div>
                <label htmlFor={`${id}-provider`} className={LABEL}>
                  Airline / railway / operator
                </label>
                <input id={`${id}-provider`} className={FIELD} maxLength={64} value={t.provider} onChange={(e) => set(seg.key, { provider: e.target.value })} placeholder="e.g. IndiGo" />
              </div>
              <div>
                <label htmlFor={`${id}-fare`} className={LABEL}>
                  Fare (₹)
                </label>
                <input
                  id={`${id}-fare`}
                  className={`${FIELD} text-right tabular-nums`}
                  inputMode="decimal"
                  value={t.amount}
                  onChange={(e) => set(seg.key, { amount: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <FieldError>{err}</FieldError>
          </div>
        );
      })}
    </section>
  );
}
