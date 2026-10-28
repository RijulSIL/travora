import { CheckCircle2, Clock, Plane, Train, Bus, FileText } from 'lucide-react';

import { busTypesText, leaveWindowsText } from './travelRequestView';

/**
 * The per-leg ticket upload form shared by the Travel Desk's own page (TravelDeskPage.jsx) and
 * the travel agent's public /book/:token page (AgentBookingPage.jsx) — same fields, same
 * auto-fill-from-file behaviour, same "auto-filled" tags. Extracted here so both pages render the
 * exact same JSX instead of keeping two copies in sync.
 */

export function ModeIcon({ mode, className }) {
  if (mode === 'FLIGHT') return <Plane className={className} size={16} />;
  if (mode === 'TRAIN') return <Train className={className} size={16} />;
  if (mode === 'BUS') return <Bus className={className} size={16} />;
  return <FileText className={className} size={16} />;
}

export const EMPTY_UPLOAD_FIELDS = {
  file: null,
  pnr_or_booking_ref: '',
  provider: '',
  ticket_amount: '',
  notes_for_employee: '',
};

/** What the traveler chose for this leg when requesting: an option found with Google by Gemini,
 * or their own description. A suggestion — whoever books checks fare and seats first. */
export function TravelerPick({ pick }) {
  if (!pick || (pick.choice !== 'own' && pick.choice !== 'bus' && !pick.option)) return null;
  const o = pick.option;
  const found = pick.searched_at ? new Date(pick.searched_at) : null;
  const foundOn = found && !Number.isNaN(found.getTime()) ? found.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null;
  const own = pick.choice === 'own';
  const when = leaveWindowsText(pick.time_windows);
  if (pick.choice === 'bus') {
    // Buses aren't searched: the traveler said what kind of bus and when; whoever books finds one.
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
          <span className="text-[10px] font-bold text-brand uppercase tracking-wide">Traveler’s request</span>
        </div>
        <div className="px-3 py-2.5 text-xs leading-relaxed">
          <span className="font-semibold text-slate-800">{busTypesText(pick.bus_types) || 'Any bus'}</span>
          {when ? <span className="block text-[11px] text-slate-500">Wanted to leave {when}</span> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <span className="text-[10px] font-bold text-brand uppercase tracking-wide">{own ? 'Traveler’s request' : 'Traveler’s pick'}</span>
        {!own ? (
          <span className="min-w-0 truncate text-xs font-bold text-slate-800">
            {o.name || o.operator}
            {o.number ? <> <span className="font-mono font-semibold">{o.number}</span></> : null}
          </span>
        ) : null}
      </div>
      {own ? (
        <div className="px-3 py-2.5 text-xs leading-relaxed">
          <span className="font-semibold text-slate-800">“{pick.note}”</span>
          <span className="block text-[11px] text-slate-500">None of the suggestions suited them, so they described what they want.</span>
          {when ? <span className="block text-[11px] text-slate-500">Wanted to leave {when}</span> : null}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-3">
            <div className="min-w-0">
              <div className="text-lg font-extrabold leading-none text-slate-800 tabular-nums">{o.depart_time || '—'}</div>
              {o.from_station ? <div className="mt-1 max-w-[100px] truncate text-[11px] text-slate-500 sm:max-w-[150px]" title={o.from_station}>{o.from_station}</div> : null}
            </div>
            <div className="flex flex-col items-center gap-0.5 whitespace-nowrap text-[10.5px] text-slate-400">
              {o.duration || ''}
              <span className="w-full border-t border-dashed border-slate-300" />
            </div>
            <div className="min-w-0 text-right">
              <div className="text-lg font-extrabold leading-none text-slate-800 tabular-nums">{o.arrive_time || '—'}</div>
              {o.to_station ? <div className="ml-auto mt-1 max-w-[100px] truncate text-[11px] text-slate-500 sm:max-w-[150px]" title={o.to_station}>{o.to_station}</div> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-[11px]">
            <span className="flex items-center gap-1.5">
              {o.travel_class ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-600">{o.travel_class}</span> : null}
              {o.fare_inr ? <b className="text-[13px] text-slate-800 tabular-nums">~₹{Number(o.fare_inr).toLocaleString('en-IN')}</b> : null}
            </span>
            <span className="text-slate-400">{foundOn ? `Found ${foundOn} · ` : ''}check fare &amp; seats</span>
          </div>
          {when ? (
            <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
              <Clock size={12} className="text-slate-400" /> Wanted to leave {when}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// `solid`: a plain white card (the agent's page, where the page background shows through the
// Travel Desk's light tint); the Travel Desk keeps its tinted look.
export default function SegmentUploadForm({ seg, pick, fields, onChange, onFile, read, onSubmit, busy, isOnlySegment, solid = false }) {
  const filled = read?.filled || [];
  // Everything marked * must be in before the ticket can be saved (the server checks the same).
  const missing = [
    !fields.file && 'the ticket file',
    !String(fields.pnr_or_booking_ref || '').trim() && 'the PNR',
    !String(fields.provider || '').trim() && 'the provider',
    !(Number(fields.ticket_amount) > 0) && 'the ticket amount',
  ].filter(Boolean);
  const AutoTag = ({ field }) =>
    filled.includes(field) ? (
      <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-px text-[9px] font-bold normal-case tracking-normal text-emerald-700">auto-filled</span>
    ) : null;
  return (
    <form
      className={`space-y-3 border border-slate-200 ${solid ? 'rounded-2xl bg-white p-5 shadow-sm' : 'rounded-lg bg-slate-50/60 p-3.5'}`}
      onSubmit={onSubmit}
    >
      <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
        <ModeIcon mode={seg.mode} className="text-slate-400" />
        <span>{seg.label}</span>
      </div>

      <TravelerPick pick={pick} />

      <div className="space-y-1">
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ticket File *</span>
        {/* The chosen file lives in the form's state (fields.file), not just in the input — so the
            name shown and what Save sends always agree, even if the browser resets the input. */}
        <label className="flex cursor-pointer items-center gap-3 text-xs text-slate-500">
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.heic"
            className="sr-only"
            onChange={(e) => {
              const chosen = e.target.files?.[0] || null;
              // Emptied so choosing a file again (even the same one) always reads it again.
              e.target.value = '';
              if (chosen) onFile(chosen);
            }}
          />
          <span className="rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-700 hover:bg-slate-200">
            {fields.file ? 'Change file' : 'Choose file'}
          </span>
          <span className={`min-w-0 truncate ${fields.file ? 'font-semibold text-slate-700' : ''}`}>
            {fields.file ? fields.file.name : 'No file chosen'}
          </span>
        </label>
        {read?.status === 'reading' ? (
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <Clock size={12} className="animate-spin" /> Reading the ticket…
          </p>
        ) : null}
        {read?.status === 'failed' ? (
          <p className="text-[11px] font-semibold text-slate-500">{read.message || 'Couldn’t read this ticket — type it in.'}</p>
        ) : null}
        {read?.mismatch ? (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-900">
            <b>⚠ {read.mismatch}</b> Check you picked the right file. You can still save it.
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">PNR / Booking Reference *<AutoTag field="pnr_or_booking_ref" /></span>
        <input
          className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
          placeholder="Enter PNR or airline reference number"
          value={fields.pnr_or_booking_ref}
          onChange={(e) => onChange({ pnr_or_booking_ref: e.target.value })}
          required
        />
      </div>

      <div className="space-y-1">
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Provider (Airline / Transporter) *<AutoTag field="provider" /></span>
        <input
          className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
          placeholder="e.g. IndiGo, Air India, Indian Railways"
          value={fields.provider}
          onChange={(e) => onChange({ provider: e.target.value })}
          required
        />
      </div>

      <div className="space-y-1">
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ticket Amount (₹) *<AutoTag field="ticket_amount" /></span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
          placeholder="Total fare paid, as printed on the ticket"
          value={fields.ticket_amount}
          onChange={(e) => onChange({ ticket_amount: e.target.value })}
          required
        />
        {filled.length ? (
          <p className="text-[11px] font-semibold text-emerald-700">✓ Read from the ticket — check them. You can still change them.</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Notes for Employee</span>
        <textarea
          className="w-full min-h-[3rem] p-3 text-xs rounded-lg border border-slate-205 focus:border-slate-400 outline-none transition-all bg-white"
          placeholder="Add ticket remarks or guidelines for the traveler"
          value={fields.notes_for_employee}
          onChange={(e) => onChange({ notes_for_employee: e.target.value })}
        />
      </div>

      <button
        type="submit"
        className="inline-flex w-full h-10 items-center justify-center gap-1.5 rounded-lg bg-brand text-xs font-bold text-white hover:bg-brand/90 transition-all duration-200 shadow-md disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
        disabled={busy || missing.length > 0}
      >
        <CheckCircle2 size={13} /> {isOnlySegment ? 'Complete Ticketing & Notify Employee' : `Save Ticket — ${seg.label}`}
      </button>
      {missing.length ? (
        <p className="text-center text-[11px] text-slate-500">
          Add {missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing[0]} to save.
        </p>
      ) : null}
    </form>
  );
}
