import { EYEBROW } from '../approvals/ApprovalDetail';
import { busTypesText, leaveWindowsText } from './travelRequestView';

/*
 * The traveler's flight/train/bus choice for each leg (request.leg_picks), on the approval
 * screens: one line per leg with its route and date, then the option they picked (found with
 * Google by Gemini) or what they asked for instead.
 */

const MODE_PLURAL = { FLIGHT: 'flights', TRAIN: 'trains', BUS: 'buses' };
const day = (iso) => {
  const d = iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
};

/** The ticketable legs, numbered like leg_picks: onward (+ return), or each multi-city leg. */
function legsOf(request) {
  if (request.trip_type === 'MULTI_CITY' && request.legs?.length) {
    return request.legs.map((l, i) => ({ seq: i + 1, label: `Leg ${i + 1}`, from: l.from_city, to: l.to_city, date: l.travel_date }));
  }
  const legs = [{ seq: 1, label: request.trip_type === 'ROUND_TRIP' ? 'Onward' : null, from: request.from_city, to: request.to_city, date: request.travel_date }];
  if (request.trip_type === 'ROUND_TRIP' && request.return_date) {
    legs.push({ seq: 2, label: 'Return', from: request.to_city, to: request.from_city, date: request.return_date });
  }
  return legs;
}

export default function TravelPicksSummary({ request, name }) {
  const picks = request?.leg_picks || [];
  if (!picks.length) return null;
  const modes = new Set([request.travel_mode, ...(request.legs || []).map((l) => l.travel_mode)].filter(Boolean));
  const what = modes.size === 1 ? MODE_PLURAL[[...modes][0]] || 'options' : 'options';
  return (
    <div>
      <div className={`${EYEBROW} mb-1.5`}>
        {name ? `${name}’s ${what}` : `Chosen ${what}`}
      </div>
      <div className="flex flex-col gap-1.5">
        {legsOf(request).map((leg) => {
          const pick = picks.find((p) => p.seq === leg.seq);
          const o = pick?.option;
          return (
            <div key={leg.seq} className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-slate-700">
              <div className="text-[11.5px] font-semibold text-slate-500">
                {[leg.label, `${leg.from} → ${leg.to}`, day(leg.date)].filter(Boolean).join(' · ')}
              </div>
              {pick?.choice === 'bus' ? (
                <div>
                  <span className="text-slate-500">Asked for: </span>
                  <b className="text-ink">{busTypesText(pick.bus_types) || 'Any bus'}</b>
                </div>
              ) : pick?.choice === 'own' ? (
                <div>
                  <span className="text-slate-500">Asked for: </span>
                  <span className="font-semibold text-ink">“{pick.note}”</span>
                </div>
              ) : o ? (
                <div>
                  <b className="text-ink">{[o.name || o.operator, o.number].filter(Boolean).join(' ')}</b>
                  {' · '}
                  <span className="tabular-nums">
                    {o.depart_time} → {o.arrive_time}
                  </span>
                  {o.duration ? ` · ${o.duration}` : ''}
                  {o.travel_class ? ` · ${o.travel_class}` : ''}
                  {o.fare_inr ? ` · ~₹${Number(o.fare_inr).toLocaleString('en-IN')}` : ''}
                </div>
              ) : (
                <div className="italic text-slate-400">No choice recorded</div>
              )}
              {leaveWindowsText(pick?.time_windows) ? (
                <div className="text-[11.5px] text-slate-500">Wanted to leave {leaveWindowsText(pick.time_windows)}</div>
              ) : null}
            </div>
          );
        })}
      </div>
      {picks.some((p) => p.choice === 'option') ? (
        <p className="mt-1 text-[11px] text-slate-400">
          {picks.every((p) => p.choice !== 'option' || ['timetable', 'schedule'].includes(p.option?.source))
            ? 'From the railway timetable / airline schedules when they requested — check seats and fare before booking.'
            : 'Found with Google by Gemini when they requested — fares and times may have changed.'}
        </p>
      ) : null}
    </div>
  );
}
