import { AlertTriangle, ArrowRight, Bus, Clock, Lock, MapPin, Plane, TrainFront } from 'lucide-react';

export const FIELD =
  'h-[38px] w-full rounded-[10px] border border-slate-200 bg-white px-[11px] text-[13px] text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15';
export const LABEL = 'mb-[5px] block text-xs font-bold text-slate-700';
export const EYEBROW = 'mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400';

export const MODES = [
  { value: 'FLIGHT', label: 'Flight', icon: Plane },
  { value: 'TRAIN', label: 'Train', icon: TrainFront },
  { value: 'BUS', label: 'Bus', icon: Bus },
];
export const MODE_ICON = Object.fromEntries(MODES.map((m) => [m.value, m.icon]));

/** Grey pill group where one option is picked (trip type, mode, travel type). */
export function SegButtons({ label, options, value, onChange, stretch = false }) {
  return (
    <div role="group" aria-label={label} className={`flex flex-wrap gap-0.5 rounded-[11px] bg-slate-100 p-[3px] ${stretch ? 'w-full' : 'w-fit'}`}>
      {options.map((o) => {
        const Icon = o.icon;
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-[7px] text-[12.5px] font-bold transition-colors ${stretch ? 'flex-1' : ''} ${
              on ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {Icon ? <Icon size={14} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Level, flights and train classes from the travel policy in force (/me/policy-limits). */
export function PolicyChips({ limits }) {
  if (!limits) return null;
  const air = limits.air_eligibility;
  const airClass = limits.air_class_allowed ? limits.air_class_allowed.replace('_', ' ').toLowerCase() : null;
  const chip = 'inline-flex items-center gap-[5px] rounded-full bg-slate-100 px-[9px] py-0.5 text-[11.5px] font-bold text-slate-700';
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {limits.impact_level_code ? (
        <span className={chip}>
          {limits.impact_level_code}
          {limits.impact_level_name ? ` · ${limits.impact_level_name}` : ''}
        </span>
      ) : null}
      {air === 'YES' ? (
        <span className={chip}>
          <Plane size={12} /> Flights{airClass ? `: ${airClass}` : ''}
        </span>
      ) : air === 'CONDITIONAL' ? (
        <span className={chip}>
          <Plane size={12} /> Flights with approval{airClass ? ` · ${airClass}` : ''}
        </span>
      ) : (
        <span className={`${chip} text-slate-500 line-through`} title="Not in your travel policy">
          <Plane size={12} /> Flights
        </span>
      )}
      {limits.train_classes_allowed?.length ? (
        <span className={chip}>
          <TrainFront size={12} /> Trains: {limits.train_classes_allowed.join(', ')}
        </span>
      ) : null}
    </div>
  );
}

/** Shown as soon as a flight is picked by someone whose policy doesn't simply allow flights. */
export function FlightNote({ limits, flightLegs, multi }) {
  if (!limits || !flightLegs.length || limits.air_eligibility === 'YES') return null;
  const level = limits.impact_level_code ? ` (${limits.impact_level_code})` : '';
  const listed = flightLegs.length > 1 ? `${flightLegs.slice(0, -1).join(', ')} and ${flightLegs[flightLegs.length - 1]}` : `${flightLegs[0]}`;
  const which = multi ? `${flightLegs.length > 1 ? 'Legs' : 'Leg'} ${listed} ${flightLegs.length > 1 ? 'are flights' : 'is a flight'}. ` : '';
  const conditional = limits.air_eligibility === 'CONDITIONAL';
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-[11px] py-[9px] text-xs text-amber-900">
      <AlertTriangle size={15} className="mt-px shrink-0 text-amber-700" />
      <div>
        <b className="block text-[12.5px]">
          {which}
          {conditional ? `Flights at your level${level} need approval` : `Flights aren't in your policy${level}`}
        </b>
        {conditional
          ? 'They need approval before the travel desk can book them.'
          : "You can still submit. You'll be asked why, and it goes for exception approval before booking."}
      </div>
    </div>
  );
}

function money(value) {
  return value == null ? '—' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const CAP_KEYS = [
  ['hotel', 'Hotel'],
  ['food', 'Food'],
  ['incidental', 'Incidentals', 'Incid.'],
  ['day_visit', 'Day visit'],
];

function CapValue({ entry, k }) {
  const cap = entry[`${k}_cap`];
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[12.5px] font-semibold tabular-nums text-ink">
      {money(cap)}
      {cap != null && entry[`${k}_is_hard_block`] ? <Lock size={10} className="text-slate-400" aria-label="strict" /> : null}
    </span>
  );
}

/** The traveller's expense caps at the destination, or at each stop of a multi-city trip. */
export function CapsPanel({ limits, loading }) {
  if (!loading && limits.length === 0) return null;
  const withCaps = limits.filter((e) => e.has_limits);
  const single = limits.length === 1;
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-[10px] border border-sky-200 bg-sky-50 px-[11px] py-[9px] text-xs text-sky-800">
        <MapPin size={14} className="mt-px shrink-0" />
        <div>
          <b className="block text-[12.5px]">
            {single
              ? `Your caps in ${limits[0].city} (${limits[0].city_group_name || `Group ${limits[0].city_group}`})`
              : 'Your caps at each stop'}
          </b>
          What the policy covers there if you pay yourself.
        </div>
      </div>
      {loading && limits.length === 0 ? (
        <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-slate-400">
          <Clock className="animate-spin" size={12} /> Checking caps…
        </div>
      ) : null}
      {single && withCaps.length === 1 ? (
        <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {CAP_KEYS.map(([k, label]) => (
            <div key={k} className="rounded-[10px] border border-slate-200 px-[9px] py-[7px]">
              <dt className="text-[11px] font-bold text-slate-500">{label}</dt>
              <dd>
                <CapValue entry={limits[0]} k={k} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {!single && withCaps.length ? (
        <div className="overflow-hidden rounded-[10px] border border-slate-200" role="table" aria-label="Your caps at each stop">
          <div role="row" className="grid grid-cols-[minmax(0,1.25fr)_repeat(4,minmax(0,1fr))] gap-1 bg-slate-50 px-2 py-[7px] text-[11px] font-bold text-slate-500 sm:gap-2 sm:px-[11px]">
            <span role="columnheader">Stop</span>
            {CAP_KEYS.map(([k, label, short]) => (
              <span key={k} role="columnheader">
                {short ? (
                  <>
                    <span className="sm:hidden" aria-hidden="true">{short}</span>
                    <span className="sr-only sm:not-sr-only">{label}</span>
                  </>
                ) : (
                  label
                )}
              </span>
            ))}
          </div>
          {withCaps.map((entry) => (
            <div key={entry.city} role="row" className="grid grid-cols-[minmax(0,1.25fr)_repeat(4,minmax(0,1fr))] items-baseline gap-1 border-t border-slate-100 px-2 py-2 text-[12.5px] sm:gap-2 sm:px-[11px]">
              <span role="cell" className="min-w-0">
                <b className="text-ink">{entry.city}</b>
                <small className="block text-[11px] font-semibold text-slate-500 sm:ml-1 sm:inline">
                  {entry.city_group_name || `Group ${entry.city_group}`}
                </small>
              </span>
              {CAP_KEYS.map(([k]) => (
                <span key={k} role="cell">
                  <CapValue entry={entry} k={k} />
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {limits.some((e) => !e.has_limits) ? (
        <p className="text-[11.5px] text-slate-500">
          No caps are set for {limits.filter((e) => !e.has_limits).map((e) => e.city).join(', ')} under the current policy.
        </p>
      ) : null}
      {withCaps.length ? (
        <p className="flex items-center gap-1 text-[11px] text-slate-400">
          <Lock size={10} /> Strict cap: going over it needs an exception.
        </p>
      ) : null}
    </div>
  );
}

/** "Delhi → Jaipur → Udaipur → Delhi" with each leg's mode, and the date span. */
export function RouteLine({ legs }) {
  const filled = legs.filter((l) => l.from_city || l.to_city);
  if (!filled.length) return null;
  const dates = legs.map((l) => l.travel_date).filter(Boolean).sort();
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1.5 rounded-[10px] border border-slate-200 bg-slate-50 px-[11px] py-2 text-[12.5px] font-bold text-ink">
      {legs.map((l, i) => {
        const Icon = MODE_ICON[l.travel_mode] || Plane;
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i === 0 ? <span>{l.from_city || '…'}</span> : null}
            <span className="inline-flex items-center gap-0.5 text-slate-400">
              <ArrowRight size={11} />
              <Icon size={12} />
            </span>
            <span>{l.to_city || '…'}</span>
          </span>
        );
      })}
      {dates.length ? (
        <span className="ml-auto text-[11.5px] font-semibold text-slate-500">
          {fmt(dates[0])}
          {dates[dates.length - 1] !== dates[0] ? ` – ${fmt(dates[dates.length - 1])}` : ''}
        </span>
      ) : null}
    </div>
  );
}
