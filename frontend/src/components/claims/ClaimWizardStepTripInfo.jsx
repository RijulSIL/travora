import { ArrowLeftRight, Bus, Eye, FileText, Plane, Train } from 'lucide-react';
import { useEffect, useState } from 'react';

import { reimbursementApi } from '../../services/reimbursementApi';
import { travelRef } from '../travel/travelRequestView';
import { Card, EYEBROW, LABEL, Note, StepActions, dateSpan, dayMonth, fieldClass } from './ClaimWizardShell';

function ModeIcon({ mode, size = 13, className = 'shrink-0 text-slate-400' }) {
  if (mode === 'FLIGHT') return <Plane className={className} size={size} />;
  if (mode === 'TRAIN') return <Train className={className} size={size} />;
  if (mode === 'BUS') return <Bus className={className} size={size} />;
  return <FileText className={className} size={size} />;
}

const KIND = {
  ROUND_TRIP: { label: 'Round trip', cls: 'bg-slate-100 text-slate-600' },
  MULTI_CITY: { label: 'Multi-city', cls: 'bg-violet-50 text-violet-700' },
  ONE_WAY: { label: 'One way', cls: 'bg-slate-100 text-slate-600' },
};

function TicketButton({ onClick }) {
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-brand/20 bg-brand/5 px-2 py-0.5 text-[11px] font-bold text-brand hover:bg-brand/10"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      <Eye size={11} /> Ticket
    </button>
  );
}

/** One booked trip (all its legs) as a row you tick. */
function TripRow({ group, selected, onToggle, onPreviewTicket }) {
  const legs = group.legs;
  const first = legs[0];
  const multi = legs.length > 1;
  const kind = KIND[group.tripType] || (multi ? KIND.MULTI_CITY : KIND.ONE_WAY);
  const isRound = group.tripType === 'ROUND_TRIP';
  const route = isRound ? (
    <>
      {first.from_city} <ArrowLeftRight size={12} className="inline text-slate-400" /> {first.to_city}
    </>
  ) : (
    [first.from_city, ...legs.map((l) => l.to_city)].join(' → ')
  );
  const meta = [
    first.travel_request_id ? travelRef(first.travel_request_id) : first.reference_id,
    dateSpan(first.travel_date, legs[legs.length - 1].travel_date),
    first.purpose,
  ].filter(Boolean);

  return (
    <label
      className={`grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] gap-3 rounded-xl border px-3 py-2.5 ${
        selected ? 'border-brand bg-brand/[0.04]' : 'border-slate-200 hover:bg-slate-50/70'
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-brand"
        checked={selected}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[13px] text-ink">{route}</b>
          <span className={`rounded-full px-2 py-px text-[11px] font-bold ${kind.cls}`}>
            {kind.label}
            {multi && !isRound ? ` · ${legs.length} legs` : ''}
          </span>
        </div>
        <div className="text-xs text-slate-500">{meta.join(' · ')}</div>
        {multi ? (
          <div className="mt-[7px] grid gap-[3px] border-l-2 border-brand/25 pl-2.5">
            {legs.map((leg, i) => (
              <div key={leg.id} className="flex flex-wrap items-center gap-[7px] text-xs text-slate-700">
                <span className="rounded-full bg-slate-100 px-[7px] text-[11px] font-bold text-slate-500">{i + 1}</span>
                <ModeIcon mode={leg.mode} />
                <span>
                  {isRound ? (i === 0 ? 'Onward' : 'Return') : `${leg.from_city} → ${leg.to_city}`}
                </span>
                <span className="text-slate-500">
                  · {dayMonth(leg.travel_date)}
                  {leg.travel_class ? ` · ${leg.travel_class}` : ''}
                </span>
                {leg.desk_ticket_id ? <TicketButton onClick={() => onPreviewTicket(leg)} /> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-[7px] text-xs text-slate-700">
            <ModeIcon mode={first.mode} />
            <span className="text-slate-500">{first.travel_class || ''}</span>
            {first.desk_ticket_id ? <TicketButton onClick={() => onPreviewTicket(first)} /> : null}
          </div>
        )}
      </div>
    </label>
  );
}

const CAP_TEXT = [
  ['hotel', 'Hotel'],
  ['food', 'Food'],
  ['incidental', 'Incidentals'],
  ['day_visit', 'Day visit'],
];

/** The traveller's caps at the claim's destination (the one city the policy check uses). */
function useDestinationCaps(city, date) {
  const [caps, setCaps] = useState(null);
  useEffect(() => {
    const name = (city || '').trim();
    if (!name) {
      setCaps(null);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      reimbursementApi
        .travelCityExpenseLimits(name, date || undefined)
        .then((r) => !cancelled && setCaps(r.data || null))
        .catch(() => !cancelled && setCaps(null));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [city, date]);
  return caps;
}

export default function ClaimWizardStepTripInfo({
  form,
  onChange,
  officeLocations,
  travelOptions,
  cityOptions = [],
  onCityQueryChange,
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
  const err = (name) => (getError(name) ? <p className="mt-1 text-[11px] font-bold text-rose-600">{getError(name)}</p> : null);
  const selectedGroups = tripGroups.filter((g) => g.tripIds.every((id) => selectedTripIds.includes(id)));
  const fromRef = selectedGroups.length
    ? selectedGroups.map((g) => (g.legs[0].travel_request_id ? travelRef(g.legs[0].travel_request_id) : g.legs[0].reference_id)).filter(Boolean)
    : [];
  const multiStop = selectedGroups.some((g) => g.tripType === 'MULTI_CITY' && g.legs.length > 1);
  const caps = useDestinationCaps(form.destination_city, form.departure_date);
  const groupName = caps ? caps.city_group_name || (caps.city_group ? `Group ${caps.city_group}` : '') : '';

  return (
    <>
      {tripGroups.length > 0 ? (
        <Card title="Start from a booked trip" sub="Ticking a trip fills in the details below. All legs of a round or multi-city trip go together." bodyClass="space-y-1.5">
          {tripGroups.map((group) => (
            <TripRow
              key={group.key}
              group={group}
              selected={group.tripIds.every((id) => selectedTripIds.includes(id))}
              onToggle={(checked) => onToggleTripGroup(group.tripIds, checked)}
              onPreviewTicket={onPreviewTicket}
            />
          ))}
        </Card>
      ) : null}

      <Card
        title="Trip details"
        sub={fromRef.length ? `Filled in from ${fromRef.join(', ')}; change anything that's different.` : 'Where you went, when, and why.'}
      >
        {deadlineWarning ? <Note tone="rose" title="Past the claim deadline">{deadlineWarning}</Note> : null}

        <p className={EYEBROW}>Where and when</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="claim-from" className={LABEL}>From</label>
            <input
              id="claim-from"
              className={fieldClass(getError('from_city'))}
              value={form.from_city}
              onChange={(e) => {
                onChange('from_city', e.target.value);
                onCityQueryChange?.(e.target.value);
              }}
              placeholder="Origin city"
              list="claim-city-from"
            />
            {err('from_city')}
          </div>
          <div>
            <label htmlFor="claim-destination" className={LABEL}>Destination</label>
            <input
              id="claim-destination"
              className={fieldClass(getError('destination_city'))}
              value={form.destination_city}
              onChange={(e) => {
                onChange('destination_city', e.target.value);
                onCityQueryChange?.(e.target.value);
              }}
              onBlur={onResolveCityGroup}
              placeholder="Destination city"
              list="claim-city-to"
            />
            {err('destination_city')}
          </div>
          <div>
            <label htmlFor="claim-departure" className={LABEL}>Left on</label>
            <input
              id="claim-departure"
              type="date"
              className={fieldClass(getError('departure_date'))}
              value={form.departure_date}
              onChange={(e) => onChange('departure_date', e.target.value)}
            />
            {err('departure_date')}
          </div>
          <div>
            <label htmlFor="claim-return" className={LABEL}>Back on</label>
            <input
              id="claim-return"
              type="date"
              className={fieldClass(getError('return_date'))}
              value={form.return_date}
              onChange={(e) => onChange('return_date', e.target.value)}
            />
            {err('return_date')}
          </div>
        </div>
        <datalist id="claim-city-from">
          {cityOptions.map((c) => (
            <option key={`f-${c}`} value={c} />
          ))}
        </datalist>
        <datalist id="claim-city-to">
          {cityOptions.map((c) => (
            <option key={`t-${c}`} value={c} />
          ))}
        </datalist>

        {caps?.has_limits ? (
          <Note tone="sky" title={`Caps on this claim follow ${caps.city}${groupName ? ` (${groupName})` : ''}${multiStop ? ', the first stop' : ''}`}>
            {CAP_TEXT.filter(([k]) => caps[`${k}_cap`] != null)
              .map(([k, label]) => `${label} ₹${Number(caps[`${k}_cap`]).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)
              .join(' · ')}
            {multiStop ? '. A claim takes one destination today, so the other stops’ caps aren’t applied separately.' : ''}
          </Note>
        ) : cityGroupHint ? (
          <Note tone="sky">{cityGroupHint}</Note>
        ) : null}

        <p className={`${EYEBROW} pt-1.5`}>Why</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="claim-purpose" className={LABEL}>Purpose</label>
            <select
              id="claim-purpose"
              className={fieldClass(getError('trip_purpose'))}
              value={form.trip_purpose}
              onChange={(e) => onChange('trip_purpose', e.target.value)}
            >
              <option value="">Select trip purpose</option>
              {(travelOptions?.trip_purposes || []).map((o) => (
                <option key={o.id} value={o.value}>{o.label || o.value}</option>
              ))}
            </select>
            {(travelOptions?.trip_purposes || []).length === 0 ? (
              <p className="mt-1 text-[11px] font-bold text-amber-700">No trip purposes are configured yet. Ask an admin to add them.</p>
            ) : null}
            {err('trip_purpose')}
          </div>
          <div>
            <label htmlFor="claim-office" className={LABEL}>Office you travelled from</label>
            <select
              id="claim-office"
              className={fieldClass(getError('office_location'))}
              value={form.office_location}
              onChange={(e) => onChange('office_location', e.target.value)}
            >
              <option value="">Select office</option>
              {officeLocations.map((location) => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
            {err('office_location')}
          </div>
          <div>
            <span className={LABEL}>Travel type</span>
            <div role="group" aria-label="Travel type" className="flex w-full gap-0.5 rounded-[11px] bg-slate-100 p-[3px]">
              {[
                ['NON_PROJECT', 'Non-project'],
                ['PROJECT', 'Project'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={form.travel_type === value}
                  onClick={() => onChange('travel_type', value)}
                  className={`flex-1 rounded-lg px-3 py-[7px] text-[12.5px] font-bold ${
                    form.travel_type === value ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {err('travel_type')}
          </div>
          {form.travel_type === 'PROJECT' ? (
            <div>
              <label htmlFor="claim-project" className={LABEL}>Project code</label>
              <select
                id="claim-project"
                className={fieldClass(getError('project_code'))}
                value={form.project_code}
                onChange={(e) => onChange('project_code', e.target.value)}
              >
                <option value="">Select project code</option>
                {(travelOptions?.project_codes || []).map((o) => (
                  <option key={o.id} value={o.value}>{o.label || o.value}</option>
                ))}
              </select>
              {(travelOptions?.project_codes || []).length === 0 ? (
                <p className="mt-1 text-[11px] font-bold text-amber-700">No project codes are configured yet. Ask an admin to add them.</p>
              ) : null}
              {err('project_code')}
            </div>
          ) : null}
        </div>
      </Card>

      <StepActions onNext={onNext} nextLabel="Next: Invoices" />
    </>
  );
}
