import axios from 'axios';
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import SegmentUploadForm, { EMPTY_UPLOAD_FIELDS, ModeIcon, TravelerPick } from '../../components/travel/SegmentUploadForm';
import useToast from '../../hooks/useToast';

/**
 * The travel agent's public, unauthenticated booking page: /book/:token. No login, no sidebar, no
 * app shell — the emailed link itself is the only credential. Everything here is scoped to the
 * one request the token was issued for; the server never takes a request id from this page, only
 * the token in the URL (see app/api/v1/public_travel_booking.py).
 *
 * A plain axios instance is used instead of services/api.js on purpose: that instance attaches an
 * Authorization header from the signed-in session and redirects to /login on a 401 from its
 * interceptor — neither of which applies to a page a signed-out browser must be able to use.
 */
const PUBLIC_API_BASE = `${(import.meta.env.VITE_API_BASE_URL || 'http://localhost:9200/api/v1/').replace(/\/$/, '')}/public/travel-booking`;

function errorText(err, fallback) {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

const TRIP_TYPE_LABEL = { ONE_WAY: 'One way', ROUND_TRIP: 'Round trip', MULTI_CITY: 'Multi-city' };
const MODE_LABEL = { TRAIN: 'Train', FLIGHT: 'Flight', BUS: 'Bus' };
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-slate-400';

/** 'Onward: Delhi NCR → Mumbai' -> 'Onward' (the route is shown on its own line). */
const shortLegLabel = (label) => (label && label.includes(':') ? label.split(':')[0].trim() : 'Journey');

function formatDay(iso) {
  if (!iso) return 'Date to be confirmed';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** 'Impact level L6C; Eligible flight cabins: Not eligible; Eligible train classes: 3A, CC.' -> chips. */
const eligibilityParts = (text) =>
  (text || '')
    .split(';')
    .map((part) => part.trim().replace(/\.$/, '').replace('Eligible flight cabins:', 'Flights:').replace('Eligible train classes:', 'Trains:'))
    .filter(Boolean);

function Shell({ children, wide = false }) {
  return (
    <div className="flex min-h-screen w-full items-start justify-center bg-slate-50 px-4 py-8 sm:py-12">
      {/* Above the app's floating-dots layer (ParticleBackground), so the dots stay behind the cards. */}
      <div className={`relative z-10 w-full ${wide ? 'max-w-6xl' : 'max-w-xl'}`}>
        <div className="mb-8 flex flex-col items-center gap-2">
          <img src="/assets/travora-si-logo.png" alt="Travora" className="h-16 w-auto object-contain sm:h-20" />
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Ticket booking</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function AgentBookingPage() {
  const { token } = useParams();
  const { showToast } = useToast();
  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'invalid'
  const [trip, setTrip] = useState(null);
  const [uploadsBySeq, setUploadsBySeq] = useState({});
  const uploadsRef = useRef(uploadsBySeq);
  uploadsRef.current = uploadsBySeq;
  const [ticketReads, setTicketReads] = useState({});
  const [busySeq, setBusySeq] = useState(null);
  const [doneBanner, setDoneBanner] = useState(false);

  async function loadTrip() {
    try {
      const { data } = await axios.get(`${PUBLIC_API_BASE}/${token}`);
      setTrip(data);
      setState('ready');
    } catch {
      setState('invalid');
    }
  }

  useEffect(() => {
    loadTrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function getUploadFields(seq) {
    return uploadsBySeq[seq] || EMPTY_UPLOAD_FIELDS;
  }
  function patchUploadFields(seq, patch) {
    setUploadsBySeq((prev) => ({ ...prev, [seq]: { ...(prev[seq] || EMPTY_UPLOAD_FIELDS), ...patch } }));
  }

  // Same auto-fill-from-file behaviour as the Travel Desk's own upload form (see TravelDeskPage's
  // onTicketFile — kept in step with it, just talking to the public read-ticket endpoint).
  async function onTicketFile(seq, file) {
    const before = ticketReads[seq];
    const fromLastFile = before?.status === 'done' ? before.values || {} : {};
    const lastRefused = before?.status === 'failed';
    const current = uploadsBySeq[seq] || EMPTY_UPLOAD_FIELDS;
    const cleared = {};
    for (const [field, value] of Object.entries(fromLastFile)) {
      if (value && current[field] === value) cleared[field] = '';
    }
    patchUploadFields(seq, { ...cleared, file });
    if (!file) {
      setTicketReads((prev) => ({ ...prev, [seq]: null }));
      return;
    }
    const replaceable = new Set(Object.keys(cleared));
    if (lastRefused) ['pnr_or_booking_ref', 'provider', 'ticket_amount'].forEach((f) => replaceable.add(f));
    const readToken = `${seq}-${Date.now()}`;
    setTicketReads((prev) => ({ ...prev, [seq]: { status: 'reading', token: readToken } }));
    const fd = new FormData();
    fd.append('file', file);
    fd.append('leg_sequence', String(seq));
    try {
      const { data } = await axios.post(`${PUBLIC_API_BASE}/${token}/read-ticket`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const latest = uploadsRef.current[seq] || EMPTY_UPLOAD_FIELDS;
      if (latest.file !== file) return;
      const values = {};
      for (const [field, value] of [
        ['pnr_or_booking_ref', data.pnr],
        ['provider', data.provider],
        ['ticket_amount', data.amount],
      ]) {
        if (value && (!latest[field].trim() || replaceable.has(field))) values[field] = value;
      }
      setUploadsBySeq((prev) =>
        (prev[seq] || EMPTY_UPLOAD_FIELDS).file !== file ? prev : { ...prev, [seq]: { ...prev[seq], ...values } },
      );
      setTicketReads((prev) =>
        prev[seq]?.token !== readToken
          ? prev
          : {
              ...prev,
              [seq]: data.pnr || data.provider || data.amount || data.mismatch
                ? { status: 'done', token: readToken, filled: Object.keys(values), values, mismatch: data.mismatch }
                : { status: 'failed', token: readToken, message: 'Couldn’t read this ticket — type it in.' },
            },
      );
    } catch (err) {
      setTicketReads((prev) =>
        prev[seq]?.token !== readToken
          ? prev
          : { ...prev, [seq]: { status: 'failed', token: readToken, message: errorText(err, 'Couldn’t read this ticket — type it in.') } },
      );
    }
  }

  async function onUpload(e, seq) {
    e.preventDefault();
    const fields = getUploadFields(seq);
    if (!fields.file) {
      showToast('Choose a ticket file', 'error');
      return;
    }
    if (!(Number(fields.ticket_amount) > 0)) {
      showToast('Enter the ticket amount in rupees', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('file', fields.file);
    fd.append('leg_sequence', String(seq));
    fd.append('pnr_or_booking_ref', fields.pnr_or_booking_ref || '');
    fd.append('provider', fields.provider || '');
    fd.append('ticket_amount', String(fields.ticket_amount));
    fd.append('notes_for_employee', fields.notes_for_employee || '');
    setBusySeq(seq);
    try {
      const { data } = await axios.post(`${PUBLIC_API_BASE}/${token}/upload-ticket`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadsBySeq((prev) => {
        const next = { ...prev };
        delete next[seq];
        return next;
      });
      setTicketReads((prev) => ({ ...prev, [seq]: null }));
      showToast('Ticket uploaded', 'success');
      // The last ticket books the whole trip, and a fully booked trip's link stops working — so
      // reloading through it now would show "no longer valid". Go straight to the thank-you screen.
      if (data?.status === 'BOOKED') {
        setDoneBanner(true);
        return;
      }
      await loadTrip();
    } catch (err) {
      showToast(errorText(err, 'Upload failed'), 'error');
    } finally {
      setBusySeq(null);
    }
  }

  useEffect(() => {
    if (trip && trip.segments.every((s) => s.ticketed)) {
      setDoneBanner(true);
    }
  }, [trip]);

  if (state === 'loading') {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-10 text-sm font-semibold text-slate-500 shadow-sm">
          <Clock className="animate-spin text-slate-400" size={16} /> Loading…
        </div>
      </Shell>
    );
  }

  if (state === 'invalid') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <AlertTriangle className="text-amber-500" size={28} />
          <h1 className="text-base font-bold text-slate-800">This link is no longer valid</h1>
          <p className="max-w-sm text-sm text-slate-500">
            It may have already been used, replaced by a newer link, or the trip is no longer open for booking.
            Contact the Travel Desk if you think this is a mistake.
          </p>
        </div>
      </Shell>
    );
  }

  if (doneBanner) {
    return (
      <Shell>
        <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white text-center shadow-sm">
          <div className="flex flex-col items-center gap-3 bg-emerald-50 px-8 py-9">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-100">
              <CheckCircle2 className="text-emerald-600" size={30} />
            </span>
            <h1 className="text-xl font-extrabold text-emerald-900">All tickets uploaded</h1>
            <p className="max-w-sm text-sm text-emerald-800/80">
              Thank you — {trip.reference} for {trip.employee_name} is fully booked, and the Travel Desk has been told.
            </p>
          </div>
          <ul className="divide-y divide-slate-100 px-6 py-2 text-left">
            {trip.segments.map((seg) => (
              <li key={seg.seq} className="flex items-center gap-2 py-3 text-sm">
                <CheckCircle2 size={15} className="flex-none text-emerald-600" />
                <span className="min-w-0 truncate font-semibold text-slate-700">
                  {seg.from_city} → {seg.to_city}
                </span>
                <span className="ml-auto flex-none text-xs text-slate-500">{formatDay(seg.travel_date)}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-6 py-4 text-xs text-slate-500">You can close this page. This link is no longer needed.</p>
        </div>
      </Shell>
    );
  }

  const total = trip.segments.length;
  const booked = trip.segments.filter((s) => s.ticketed);
  const toBook = trip.segments.filter((s) => !s.ticketed);

  return (
    <Shell wide>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left: everything about the trip, to book from. Stays in view while the forms scroll. */}
        <aside aria-label="Trip details" className="space-y-3 lg:sticky lg:top-6">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-brand/[0.04] px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-brand">{trip.reference}</span>
                <span className="text-xs font-semibold text-slate-500 tabular-nums">
                  {booked.length} of {total} booked
                </span>
              </div>
              <p className={`${EYEBROW} mt-4`}>Traveller</p>
              <h1 className="mt-0.5 text-2xl font-extrabold leading-tight text-ink">{trip.employee_name}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {TRIP_TYPE_LABEL[trip.trip_type] || trip.trip_type} · {total} {total === 1 ? 'leg' : 'legs'}
              </p>
            </div>

            <div className="px-5 py-5">
              <h2 className={EYEBROW}>Itinerary</h2>
              <ol className="mt-3 space-y-3">
                {trip.segments.map((seg) => (
                  <li key={seg.seq} className={`rounded-xl border p-3.5 ${seg.ticketed ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          <ModeIcon mode={seg.mode} className="text-slate-400" />
                          {shortLegLabel(seg.label)} · {MODE_LABEL[seg.mode] || seg.mode}
                        </span>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-base font-bold text-ink">
                          <span>{seg.from_city}</span>
                          <ArrowRight size={14} className="text-slate-400" />
                          <span>{seg.to_city}</span>
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-500">
                          <CalendarDays size={13} className="text-slate-400" /> {formatDay(seg.travel_date)}
                        </p>
                      </div>
                      {seg.ticketed ? (
                        <span className="inline-flex flex-none items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                          <CheckCircle2 size={12} /> Booked
                        </span>
                      ) : (
                        <span className="flex-none rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">To book</span>
                      )}
                    </div>
                    {seg.pick && !seg.ticketed ? (
                      <div className="mt-3">
                        <TravelerPick pick={seg.pick} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>

            {trip.notes ? (
              <div className="px-5 pb-5">
                <h2 className={EYEBROW}>Notes from the traveller</h2>
                <p className="mt-2 rounded-lg border-l-[3px] border-brand bg-slate-50 px-3 py-2.5 text-sm text-slate-700">{trip.notes}</p>
              </div>
            ) : null}

            <div className="border-t border-slate-100 px-5 py-4">
              <h2 className={EYEBROW}>Eligible for</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {eligibilityParts(trip.entitlement_text).map((part) => (
                  <span key={part} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {part}
                  </span>
                ))}
              </div>
            </div>
          </section>
          <p className="flex items-start gap-1.5 px-1 text-[11.5px] text-slate-400">
            <ShieldCheck size={13} className="mt-px flex-none" />
            This secure link is only for this trip, and no login is needed. If the Travel Desk sends a new link, this one stops working.
          </p>
        </aside>

        {/* Right: the tickets to submit, one form per leg still to book. */}
        <section aria-label="Upload tickets" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-extrabold text-ink">Upload tickets</h2>
              <p className="mt-0.5 max-w-[60ch] text-sm text-slate-500">
                Book each leg, then upload its ticket here. Choosing the file fills in what it can read from it — check it before saving.
              </p>
            </div>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
              {toBook.length} {toBook.length === 1 ? 'leg' : 'legs'} to book
            </span>
          </div>

          {booked.map((seg) => (
            <div key={seg.seq} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-sm">
              <CheckCircle2 size={16} className="flex-none text-emerald-600" />
              <span className="min-w-0 truncate font-semibold text-slate-700">{seg.label}</span>
              <span className="ml-auto flex-none text-xs font-bold text-emerald-700">Ticket uploaded</span>
            </div>
          ))}

          {toBook.map((seg) => (
            <SegmentUploadForm
              key={seg.seq}
              seg={seg}
              pick={null}
              fields={getUploadFields(seg.seq)}
              onChange={(patch) => patchUploadFields(seg.seq, patch)}
              onFile={(file) => onTicketFile(seg.seq, file)}
              read={ticketReads[seg.seq]}
              onSubmit={(e) => onUpload(e, seg.seq)}
              busy={busySeq === seg.seq}
              isOnlySegment={total === 1}
              solid
            />
          ))}
        </section>
      </div>
    </Shell>
  );
}
