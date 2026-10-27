import { AlertTriangle, Bus, Check, ChevronDown, FileText, Paperclip, Plane, TrainFront, X } from 'lucide-react';

import { RouteTimeline } from '../approvals/ApprovalDetail';
import { DateBox, dayOf, shortDate, today, weekdayDate } from '../home/HomeParts';
import { travelRouteItems } from './TravelApprovalPanel';
import { busTypesText, leaveWindowsText, MODE_NAME, requestBanner, travelRef } from './travelRequestView';

/*
 * The employee's Travel Requests page: one line per request (calendar date, route, where it
 * stands, row actions), its opened view (status banner, the trip, and the approval route), and
 * one line per booked trip for the My trips view.
 */

const MODE_ICON = { FLIGHT: Plane, TRAIN: TrainFront, BUS: Bus };
const PILL = {
  ok: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  slate: 'bg-slate-100 text-slate-500',
  sky: 'bg-sky-50 text-sky-700',
};
const BANNER = {
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  rose: 'border-rose-200 bg-rose-50 text-rose-900',
  slate: 'border-slate-200 bg-slate-100 text-slate-700',
  sky: 'border-sky-200 bg-sky-50 text-sky-900',
};
const EYEBROW = 'mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400';
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function ModeIcons({ modes, size = 13 }) {
  return modes.map((m) => {
    const Icon = MODE_ICON[m] || FileText;
    return <Icon key={m} size={size} className="flex-none" aria-hidden="true" />;
  });
}

function Route({ cities, roundTrip = false }) {
  return (
    <div className="truncate text-[13.5px] font-extrabold text-ink" title={cities.join(' → ')}>
      {cities.map((c, i) => (
        <span key={`${c}-${i}`}>
          {i ? <span className="mx-0.5 font-semibold text-slate-400"> → </span> : null}
          {c}
        </span>
      ))}
      {roundTrip ? <span className="ml-1 font-semibold text-slate-400">⇄</span> : null}
    </div>
  );
}

/** One line per request. `actions` are its buttons (they stop the click from opening the row). */
export function TravelRequestRow({ request, view, open, onToggle, actions }) {
  const { start, end } = view;
  const isToday = start && start.getTime() === today().getTime();
  const bits = [
    view.modes.map((m) => MODE_NAME[m] || m).join(' · '),
    request.trip_type === 'MULTI_CITY' && start && end ? `${(request.segments || request.legs || []).length} legs · ${shortDate(start)}–${shortDate(end)}` : null,
    request.trip_type === 'ROUND_TRIP' && end && start && end > start ? `back ${shortDate(end)}` : null,
    isToday ? 'Today' : null,
    cap(request.purpose),
  ].filter(Boolean);
  const note = view.stale
    ? { text: `Trip date passed${view.note ? ` · ${view.note}` : ''}`, warn: true }
    : view.claim
      ? { text: view.claim.text, warn: !view.claim.closed }
      : view.note
        ? { text: view.note, warn: false }
        : null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={(e) => {
        if (e.target.closest('button, a')) return;
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onToggle();
      }}
      className={`grid cursor-pointer grid-cols-[48px_minmax(0,1fr)_18px] items-center gap-x-3.5 gap-y-2 border-t border-slate-100 px-4 py-[11px] first:border-t-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand md:grid-cols-[48px_minmax(0,1.5fr)_minmax(0,1.3fr)_210px_18px] ${
        open ? 'bg-[#f7faf9]' : 'hover:bg-[#fbfdfc]'
      }`}
    >
      <div className={`row-span-3 self-start md:row-span-1 md:self-center ${view.bucket === 'cancelled' ? 'opacity-55' : ''}`}>
        {start ? (
          <DateBox date={start} now={view.onNow} />
        ) : (
          <div className="flex h-[58px] w-12 items-center justify-center rounded-[10px] border border-slate-200 text-slate-400">—</div>
        )}
      </div>
      <div className="min-w-0">
        <Route cities={view.route} roundTrip={request.trip_type === 'ROUND_TRIP'} />
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
          <ModeIcons modes={view.modes} />
          <span className="truncate">{bits.join(' · ')}</span>
          {view.onNow && end > start ? <span className="whitespace-nowrap rounded-md bg-brand/10 px-1.5 text-[10.5px] font-bold text-brand">On now</span> : null}
          <span className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 font-mono text-[10.5px] font-semibold text-slate-500">{travelRef(request.id)}</span>
        </div>
      </div>
      <ChevronDown
        size={16}
        className={`col-start-3 row-start-1 justify-self-end text-slate-400 transition-transform md:order-last md:col-start-auto md:row-start-auto ${open ? 'rotate-180' : ''}`}
        aria-hidden="true"
      />
      <div className="col-span-2 flex min-w-0 flex-col gap-[3px] md:col-span-1">
        <span className={`self-start whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${PILL[view.tone]}`}>{view.pill}</span>
        {note ? (
          <span className={`truncate text-xs ${note.warn ? 'font-semibold text-amber-700' : 'text-slate-500'}`} title={note.text}>
            {note.text}
          </span>
        ) : null}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-start gap-1.5 md:col-span-1 md:justify-end">{actions}</div>
    </div>
  );
}

/** What the traveler chose for a leg when requesting (TravelRequest.leg_picks). */
function PickLine({ pick }) {
  if (!pick) return null;
  const o = pick.option;
  const when = leaveWindowsText(pick.time_windows);
  const wanted = when ? <span className="block text-[11px] text-slate-500">Wanted to leave {when}</span> : null;
  if (pick.choice === 'bus') {
    return (
      <span className="mt-0.5 block text-[11.5px] text-slate-600">
        You asked for: <b className="text-ink">{busTypesText(pick.bus_types) || 'Any bus'}</b>
        {wanted}
      </span>
    );
  }
  if (pick.choice === 'own') {
    return (
      <span className="mt-0.5 block text-[11.5px] text-slate-600">
        You asked for: <span className="font-semibold text-ink">“{pick.note}”</span>
        {wanted}
      </span>
    );
  }
  if (!o) return null;
  return (
    <span className="mt-0.5 block text-[11.5px] text-slate-600">
      Your pick: <b className="text-ink">{[o.name || o.operator, o.number].filter(Boolean).join(' ')}</b>
      {' · '}
      <span className="tabular-nums">
        {o.depart_time} → {o.arrive_time}
      </span>
      {o.travel_class ? ` · ${o.travel_class}` : ''}
      {o.fare_inr ? ` · ~₹${Number(o.fare_inr).toLocaleString('en-IN')}` : ''}
      {wanted}
    </span>
  );
}

/** The opened request: banner, then the trip (left) and the approval route (right). */
export function TravelRequestDetail({ request, view, chain, onViewTicket, onViewDocument, footer }) {
  const banner = requestBanner(request, view);
  const BannerIcon = banner.tone === 'ok' ? Check : banner.tone === 'rose' ? X : AlertTriangle;
  const segs = request.segments || [];
  const documents = request.supporting_documents || [];
  const facts = [
    ['Purpose', cap(request.purpose)],
    ['Travel type', `${request.travel_type === 'PROJECT' ? 'Project' : 'Non-project'}${request.project_code ? ` · ${request.project_code}` : ''}`],
    ['Requested', request.requested_at ? shortDate(new Date(request.requested_at)) + ` ${new Date(request.requested_at).getFullYear()}` : null],
  ].filter((f) => f[1]);
  const routeItems = travelRouteItems(request, chain, { employeeName: 'you', decided: true, now: Date.now() });

  return (
    <div className="border-t border-slate-100 bg-[#fbfcfc] px-4 pb-4 pt-3.5 md:pl-[78px]">
      <div className={`mb-3 flex items-start gap-2.5 rounded-[11px] border px-3 py-2.5 text-[12.5px] ${BANNER[banner.tone]}`}>
        <BannerIcon size={16} className="mt-px flex-none" />
        <div>
          <b className="block text-[13px]">{banner.title}</b>
          {banner.text}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className={EYEBROW}>Trip{segs.length > 1 ? ` · ${segs.length} legs` : ''}</p>
          <div className="mb-3.5 flex flex-col gap-1.5">
            {segs.map((s) => {
              const Icon = MODE_ICON[s.mode || request.travel_mode] || FileText;
              const d = dayOf(s.travel_date);
              return (
                <div key={s.seq} className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border border-slate-200 bg-white px-2.5 py-2">
                  <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0">
                    <b className="block truncate text-[12.5px] text-ink">
                      {cap(s.from_city)} → {cap(s.to_city)}
                    </b>
                    <span className="text-[11.5px] text-slate-500">
                      {MODE_NAME[s.mode || request.travel_mode] || s.mode}
                      {d ? ` · ${weekdayDate(d)}` : ''}
                    </span>
                    <PickLine pick={(request.leg_picks || []).find((p) => p.seq === s.seq)} />
                  </div>
                  {s.ticket ? (
                    <button
                      type="button"
                      onClick={() => onViewTicket(s.ticket, `Ticket · ${s.label}`)}
                      className="inline-flex h-7 max-w-[190px] items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 text-[11.5px] font-bold text-emerald-700 hover:bg-emerald-50"
                    >
                      <Check size={12} className="flex-none" />
                      <span className="truncate">Ticket{s.ticket.pnr_or_booking_ref ? ` · PNR ${s.ticket.pnr_or_booking_ref}` : ''}</span>
                    </button>
                  ) : ['APPROVED', 'PARTIALLY_BOOKED'].includes(request.status) ? (
                    <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Ticket pending</span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mb-3.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0 rounded-[10px] border border-slate-200 bg-white px-2.5 py-[7px]">
                <div className="text-[10.5px] font-semibold text-slate-500">{k}</div>
                <div className="break-words text-[12.5px] font-extrabold text-ink">{v}</div>
              </div>
            ))}
          </div>

          {documents.length ? (
            <>
              <p className={EYEBROW}>Additional documents from the travel desk</p>
              <div className="mb-3.5 flex flex-col gap-1">
                {documents.map((doc) => (
                  <DocButton key={doc.id} doc={doc} onOpen={onViewDocument} />
                ))}
              </div>
            </>
          ) : null}

          {request.notes ? <Quote label="Your notes" text={request.notes} /> : null}
          {request.exception?.description ? <Quote label="Why you asked for an exception" text={request.exception.description} warn /> : null}
          {request.exception?.decision_comment ? <Quote label="Decision comment" text={request.exception.decision_comment} warn /> : null}
        </div>
        <div className="min-w-0">
          <p className={EYEBROW}>Approval route</p>
          {chain === undefined ? <p className="text-xs text-slate-500">Loading…</p> : <RouteTimeline items={routeItems} />}
        </div>
      </div>
      {footer ? <div className="mt-1 flex flex-wrap justify-end gap-2">{footer}</div> : null}
    </div>
  );
}

function Quote({ label, text, warn = false }) {
  return (
    <div className={`mb-2.5 rounded-lg border border-l-[3px] border-slate-200 bg-white px-2.5 py-2 text-[12.5px] text-slate-700 ${warn ? 'border-l-amber-500' : 'border-l-slate-400'}`}>
      <span className="mb-0.5 block text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-slate-400">{label}</span>
      <span className="whitespace-pre-wrap break-words">{text}</span>
    </div>
  );
}

function DocButton({ doc, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(doc)}
      className="mt-1 inline-flex max-w-full items-center gap-1.5 text-left text-[11.5px] font-bold text-brand hover:underline"
    >
      <Paperclip size={12} className="flex-none" />
      <span className="truncate">{doc.description || doc.original_filename || 'Document'}</span>
    </button>
  );
}

/** "Impact level L6C; Eligible flight cabins: ECONOMY; Eligible train classes: 3AC, CC, SL." as chips.
 * Anything that doesn't follow that shape is shown as the plain sentence. */
export function EntitlementChips({ text }) {
  const parts = String(text || '').replace(/\.$/, '').split(';').map((p) => p.trim()).filter(Boolean);
  const level = parts.find((p) => /^impact level/i.test(p));
  const flights = parts.find((p) => /flight/i.test(p) && p.includes(':'));
  const trains = parts.find((p) => /train/i.test(p) && p.includes(':'));
  const values = (p) =>
    p
      .split(':')
      .slice(1)
      .join(':')
      .split(',')
      .map((v) => v.trim())
      .map((v) => (/^[A-Z]+$/.test(v) && v.length > 3 ? cap(v.toLowerCase()) : v))
      .join(', ');
  if (!flights && !trains) return <p className="text-xs text-slate-500">{text}</p>;
  const chip = 'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-[3px] font-semibold text-slate-700';
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      You can book{level ? ` (level ${level.replace(/^impact level\s*/i, '')})` : ''}:
      {flights ? (
        <span className={chip}>
          <Plane size={12} /> Flights: <b className="text-ink">{values(flights)}</b>
        </span>
      ) : null}
      {trains ? (
        <span className={chip}>
          <TrainFront size={12} /> Trains: <b className="text-ink">{values(trains)}</b>
        </span>
      ) : null}
    </div>
  );
}

/** One booked trip (My trips): the ticket, and whether it's been claimed. */
export function TripRow({ trip, claim, actions }) {
  const d = dayOf(trip.travel_date);
  const Icon = MODE_ICON[trip.mode] || FileText;
  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 border-t border-slate-100 px-4 py-[11px] first:border-t-0 md:grid-cols-[48px_minmax(0,1.4fr)_minmax(0,1.2fr)_210px]">
      <div className="row-span-3 self-start md:row-span-1 md:self-center">{d ? <DateBox date={d} /> : null}</div>
      <div className="min-w-0">
        <Route cities={[cap(trip.from_city), cap(trip.to_city)]} />
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
          <Icon size={13} className="flex-none" />
          <span className="truncate">
            {[MODE_NAME[trip.mode] || trip.mode, trip.provider, trip.reference_id, trip.booked_by_travel_desk ? 'booked by the travel desk' : null].filter(Boolean).join(' · ')}
          </span>
          {trip.travel_request_id ? (
            <span className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 font-mono text-[10.5px] font-semibold text-slate-500">{travelRef(trip.travel_request_id)}</span>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className={`self-start whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${claim.claimed ? PILL.ok : claim.open ? PILL.amber : PILL.slate}`}>
          {claim.claimed ? 'On a claim' : claim.open ? 'Not claimed yet' : 'Not claimed'}
        </span>
        {claim.text ? <span className={`truncate text-xs ${claim.open ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>{claim.text}</span> : null}
      </div>
      <div className="flex flex-wrap items-center justify-start gap-1.5 md:justify-end">{actions}</div>
    </div>
  );
}
