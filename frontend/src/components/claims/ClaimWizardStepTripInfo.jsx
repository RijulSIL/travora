import { Plane, Train, Bus, FileText, ArrowRight, ArrowLeftRight, MapPin, Calendar, Eye, RefreshCw, Route } from 'lucide-react';

import { formatDate } from '../../utils/formatters';

function ModeIcon({ mode, className, size = 18 }) {
  if (mode === 'FLIGHT') return <Plane className={className} size={size} />;
  if (mode === 'TRAIN') return <Train className={className} size={size} />;
  if (mode === 'BUS') return <Bus className={className} size={size} />;
  return <FileText className={className} size={size} />;
}

const ACCENT = {
  ROUND_TRIP: { border: 'border-l-indigo-400', badgeBg: 'bg-indigo-50', badgeText: 'text-indigo-600', badgeRing: 'ring-indigo-100' },
  MULTI_CITY: { border: 'border-l-violet-400', badgeBg: 'bg-violet-50', badgeText: 'text-violet-600', badgeRing: 'ring-violet-100' },
  ONE_WAY: { border: 'border-l-slate-300', badgeBg: 'bg-slate-100', badgeText: 'text-slate-500', badgeRing: 'ring-slate-100' },
};

function TicketButton({ onClick }) {
  return (
    <button
      type="button"
      className="inline-flex flex-none items-center gap-1 rounded-md border border-brand/20 bg-brand/5 px-2 py-1 text-[10px] font-bold text-brand hover:bg-brand/10 transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Eye size={11} /> Ticket
    </button>
  );
}

/** A single trip card — one-way trips get a flat single-row layout (nothing to summarize),
 * while a round trip or multi-city trip gets a headline (overall route + date span) with its
 * individual legs/tickets listed compactly underneath, instead of repeating the full route on
 * every single leg row (redundant for a round trip, since leg 2 is just leg 1 reversed). */
function TripCard({ group, isSelected, onPreviewTicket }) {
  const legs = group.legs;
  const isGrouped = legs.length > 1;
  const accent = ACCENT[group.tripType] || ACCENT.ONE_WAY;

  if (!isGrouped) {
    const leg = legs[0];
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm transition-colors ${
            isSelected ? 'bg-brand text-white' : 'bg-white text-slate-500 border border-slate-100'
          }`}>
            <ModeIcon mode={leg.mode} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
              <span>{leg.from_city}</span>
              <ArrowRight size={12} className="text-slate-400" />
              <span>{leg.to_city}</span>
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-slate-500">
              {formatDate(leg.travel_date)} · {leg.travel_class}
            </div>
          </div>
        </div>
        {leg.desk_ticket_id ? <TicketButton onClick={() => onPreviewTicket(leg)} /> : null}
      </div>
    );
  }

  const isRoundTrip = group.tripType === 'ROUND_TRIP';
  const dateRange =
    legs[0].travel_date === legs[legs.length - 1].travel_date
      ? formatDate(legs[0].travel_date)
      : `${formatDate(legs[0].travel_date)} – ${formatDate(legs[legs.length - 1].travel_date)}`;

  return (
    <div>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1 ring-inset ${accent.badgeBg} ${accent.badgeText} ${accent.badgeRing}`}
      >
        {isRoundTrip ? <RefreshCw size={10} /> : <Route size={10} />}
        {isRoundTrip ? 'Round Trip' : `Multi-city · ${legs.length} legs`}
      </span>

      <div className="mt-2 flex items-center gap-1.5 text-sm font-bold text-slate-800">
        {isRoundTrip ? (
          <>
            <span>{legs[0].from_city}</span>
            <ArrowLeftRight size={12} className="shrink-0 text-slate-400" />
            <span>{legs[0].to_city}</span>
          </>
        ) : (
          legs.map((leg, i) => (
            <span key={leg.id} className="flex items-center gap-1.5">
              {i > 0 ? <ArrowRight size={12} className="shrink-0 text-slate-400" /> : null}
              <span>{i === 0 ? leg.from_city : leg.to_city}</span>
            </span>
          ))
        )}
      </div>
      <div className="mt-0.5 text-[11px] font-medium text-slate-500">{dateRange}</div>

      <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5">
        {legs.map((leg, i) => (
          <div key={leg.id} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] text-slate-600">
              <ModeIcon mode={leg.mode} size={13} className="shrink-0 text-slate-400" />
              <span className="font-semibold text-slate-700">
                {isRoundTrip ? (i === 0 ? 'Onward' : 'Return') : `${leg.from_city} → ${leg.to_city}`}
              </span>
              <span className="text-slate-400">· {formatDate(leg.travel_date)} · {leg.travel_class}</span>
            </div>
            {leg.desk_ticket_id ? <TicketButton onClick={() => onPreviewTicket(leg)} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ClaimWizardStepTripInfo({
  form,
  onChange,
  officeLocations,
  cityGroupHint,
  deadlineWarning,
  validationErrors,
  onNext,
  onResolveCityGroup,
  tripGroups = [],
  selectedTripIds = [],
  onToggleTripGroup,
  onPreviewTicket,
}) {
  const getError = (name) => validationErrors?.[name];

  return (
    <div className="space-y-6">
      {/* Quick Start Booking Linker Card */}
      {tripGroups.length > 0 && (
        <div className="panel rounded-xl p-5 shadow-sm border border-slate-200 bg-white">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <span>Quick Start</span>
            <span className="inline-flex items-center rounded bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand uppercase">
              Link Bookings
            </span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Select a trip from your Travel Desk to automatically pre-fill dates, cities, and travel purposes —
            a multi-city trip&apos;s legs link together as one.
          </p>
          <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
            {tripGroups.map((group) => {
              const isSelected = group.tripIds.every((id) => selectedTripIds.includes(id));
              const accent = ACCENT[group.tripType] || ACCENT.ONE_WAY;
              return (
                <div
                  key={group.key}
                  className={`relative cursor-pointer rounded-xl border border-l-4 p-4 transition-all duration-200 hover:shadow-md ${
                    isSelected
                      ? 'border-brand bg-brand/5 shadow-sm ring-1 ring-brand/10'
                      : `border-slate-200 ${accent.border} bg-white hover:bg-slate-50/70`
                  }`}
                  onClick={() => onToggleTripGroup(group.tripIds, !isSelected)}
                >
                  {isSelected && (
                    <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
                      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  )}
                  <TripCard group={group} isSelected={isSelected} onPreviewTicket={onPreviewTicket} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Trip Information Card */}
      <div className="panel rounded-xl p-5 shadow-sm border border-slate-200 bg-white">
        <h2 className="text-sm font-bold text-slate-800 mb-4">Trip Information</h2>
        
        {deadlineWarning && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
            {deadlineWarning}
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          {/* Trip Purpose */}
          <div className="space-y-1">
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Trip Purpose *</span>
            <input 
              className={`w-full h-10 px-3 rounded-lg border bg-white text-slate-800 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-150 ${
                getError('trip_purpose') ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/10' : 'border-slate-250'
              }`}
              value={form.trip_purpose} 
              onChange={(e) => onChange('trip_purpose', e.target.value)} 
              placeholder="e.g. Client visit, quarterly review"
            />
            {getError('trip_purpose') && <p className="text-xs text-rose-600 font-semibold">{getError('trip_purpose')}</p>}
          </div>

          {/* Office Location */}
          <div className="space-y-1">
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Office Location *</span>
            <div className="relative">
              <select
                className={`w-full h-10 px-3 rounded-lg border bg-white text-slate-800 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-150 ${
                  getError('office_location') ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/10' : 'border-slate-250'
                }`}
                value={form.office_location}
                onChange={(e) => onChange('office_location', e.target.value)}
              >
                <option value="">Select office</option>
                {officeLocations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </div>
            {getError('office_location') && <p className="text-xs text-rose-600 font-semibold">{getError('office_location')}</p>}
          </div>

          {/* From City */}
          <div className="space-y-1">
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">From City *</span>
            <div className="relative">
              <input 
                className={`w-full h-10 pl-9 pr-3 rounded-lg border bg-white text-slate-800 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-150 ${
                  getError('from_city') ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/10' : 'border-slate-250'
                }`}
                value={form.from_city} 
                onChange={(e) => onChange('from_city', e.target.value)} 
                placeholder="Origin city"
              />
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            </div>
            {getError('from_city') && <p className="text-xs text-rose-600 font-semibold">{getError('from_city')}</p>}
          </div>

          {/* Destination City */}
          <div className="space-y-1">
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Destination City *</span>
            <div className="relative">
              <input
                className={`w-full h-10 pl-9 pr-3 rounded-lg border bg-white text-slate-800 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-150 ${
                  getError('destination_city') ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/10' : 'border-slate-250'
                }`}
                value={form.destination_city}
                onChange={(e) => onChange('destination_city', e.target.value)}
                onBlur={onResolveCityGroup}
                placeholder="Destination city"
              />
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            </div>
            {cityGroupHint && <p className="text-xs text-indigo-700 font-medium">{cityGroupHint}</p>}
            {getError('destination_city') && <p className="text-xs text-rose-600 font-semibold">{getError('destination_city')}</p>}
          </div>

          {/* Departure Date */}
          <div className="space-y-1">
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Departure Date *</span>
            <div className="relative">
              <input
                className={`w-full h-10 pl-9 pr-3 rounded-lg border bg-white text-slate-850 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-150 ${
                  getError('departure_date') ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/10' : 'border-slate-250'
                }`}
                type="date"
                value={form.departure_date}
                onChange={(e) => onChange('departure_date', e.target.value)}
              />
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            </div>
            {getError('departure_date') && <p className="text-xs text-rose-600 font-semibold">{getError('departure_date')}</p>}
          </div>

          {/* Return Date */}
          <div className="space-y-1">
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Return Date *</span>
            <div className="relative">
              <input
                className={`w-full h-10 pl-9 pr-3 rounded-lg border bg-white text-slate-850 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-150 ${
                  getError('return_date') ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/10' : 'border-slate-250'
                }`}
                type="date"
                value={form.return_date}
                onChange={(e) => onChange('return_date', e.target.value)}
              />
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            </div>
            {getError('return_date') && <p className="text-xs text-rose-600 font-semibold">{getError('return_date')}</p>}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex justify-end border-t border-slate-150 pt-4">
          <button 
            type="button" 
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand/90 transition-all duration-200 shadow-md focus:outline-none focus:ring-2 focus:ring-brand/10" 
            onClick={onNext}
          >
            Next: Attach Invoices <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
