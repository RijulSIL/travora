import { Plane, Train, Bus, FileText, ArrowRight, MapPin, Calendar, Eye } from 'lucide-react';

function ModeIcon({ mode, className }) {
  if (mode === 'FLIGHT') return <Plane className={className} size={18} />;
  if (mode === 'TRAIN') return <Train className={className} size={18} />;
  if (mode === 'BUS') return <Bus className={className} size={18} />;
  return <FileText className={className} size={18} />;
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
  trips = [],
  selectedTripIds = [],
  onToggleTrip,
  onPreviewTicket,
}) {
  const getError = (name) => validationErrors?.[name];

  return (
    <div className="space-y-6">
      {/* Quick Start Booking Linker Card */}
      {trips.length > 0 && (
        <div className="panel rounded-xl p-5 shadow-sm border border-slate-200 bg-white">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <span>Quick Start</span>
            <span className="inline-flex items-center rounded bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand uppercase">
              Link Bookings
            </span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Select a trip from your Travel Desk to automatically pre-fill dates, cities, and travel purposes.
          </p>
          <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
            {trips.map((trip) => {
              const isSelected = selectedTripIds.includes(trip.id);
              return (
                <div
                  key={trip.id}
                  className={`relative cursor-pointer rounded-xl border-2 p-4 transition-all duration-200 hover:shadow-md ${
                    isSelected 
                      ? 'border-brand bg-brand/5 shadow-sm ring-1 ring-brand/10' 
                      : 'border-slate-100 bg-slate-50/30 hover:border-slate-200 hover:bg-slate-50/70'
                  }`}
                  onClick={() => onToggleTrip(trip.id, !isSelected)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg shadow-sm transition-colors ${
                        isSelected ? 'bg-brand text-white' : 'bg-white text-slate-500 border border-slate-100'
                      }`}>
                        <ModeIcon mode={trip.mode} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <span>{trip.from_city}</span>
                          <ArrowRight size={10} className="text-slate-400" />
                          <span>{trip.to_city}</span>
                        </div>
                        <div className="text-[10px] font-medium text-slate-500 mt-0.5">
                          {trip.travel_date} · {trip.travel_class}
                        </div>
                      </div>
                    </div>
                    {trip.desk_ticket_id && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-brand hover:underline p-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPreviewTicket(trip);
                        }}
                      >
                        <Eye size={11} /> Ticket
                      </button>
                    )}
                  </div>
                  {isSelected && (
                    <div className="absolute right-2 top-2 text-brand">
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  )}
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
