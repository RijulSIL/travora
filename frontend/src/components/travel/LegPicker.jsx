import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

import { reimbursementApi } from '../../services/reimbursementApi';
import { EYEBROW } from './TravelRequestFormParts';
import { BUS_TYPES, leaveWindowsText, TIME_WINDOWS } from './travelRequestView';

/*
 * "Choose your trains" on the travel request form: for each ticketable leg, real options found
 * with Google by Gemini (only classes the traveler is allowed), one of which they pick as their
 * recommendation to the Travel Desk — or, if none suit, a short note saying what they'd like.
 * A choice per leg is required (the server checks too: travel_request_service.validate_leg_picks).
 * Before anything is searched they choose when they want to leave (one or more time windows);
 * each window is searched on its own, so adding one only searches that window.
 *
 * Bus legs aren't searched (BusCard): they choose times and kinds of bus, and the desk books it.
 *
 * `segments`: [{ key, mode, from, to, date }];
 * `picks`: { [key]: { time_windows, choice, option, note, searched_at, bus_types } }.
 */

const MODE_PLURAL = { FLIGHT: 'flights', TRAIN: 'trains', BUS: 'buses' };
// `${seg.key}|${window}` -> { status, options, classes, searched_at, message } (shared across renders)
const results = new Map();

export const segmentComplete = (seg) => Boolean(seg.mode && seg.from?.trim() && seg.to?.trim() && seg.date);
export const pickDone = (pick) =>
  Boolean(
    pick &&
      ((pick.choice === 'option' && pick.option) ||
        (pick.choice === 'own' && (pick.note || '').trim().length >= 5) ||
        (pick.choice === 'bus' && pick.time_windows?.length && pick.bus_types?.length)),
  );

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const dayLabel = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};
const minutes = (clock) => {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(clock || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/** One search per chosen window; returns [{ code, status, options, ... }] in the day's order. */
function useSearches(seg, windows) {
  const [, bump] = useState(0);
  const ready = segmentComplete(seg);
  const wanted = windows.join(',');
  useEffect(() => {
    const missing = wanted ? wanted.split(',').filter((w) => !results.has(`${seg.key}|${w}`)) : [];
    if (!ready || !missing.length) return undefined;
    // Wait for typing / clicking to settle before searching.
    const timer = setTimeout(() => {
      missing.forEach((w) => {
        const key = `${seg.key}|${w}`;
        if (results.has(key)) return;
        results.set(key, { status: 'loading' });
        reimbursementApi
          .travelSearchOptions({ mode: seg.mode, from_city: seg.from.trim(), to_city: seg.to.trim(), travel_date: seg.date, time_windows: [w] })
          .then(({ data }) => results.set(key, { status: 'done', ...data }))
          .catch((err) => {
            const d = err.response?.data?.detail;
            results.set(key, { status: 'failed', message: typeof d === 'string' ? d : 'Couldn’t search right now — describe what you want instead' });
          })
          .finally(() => bump((n) => n + 1));
      });
      bump((n) => n + 1);
    }, 700);
    return () => clearTimeout(timer);
  }, [ready, wanted, seg.key, seg.mode, seg.from, seg.to, seg.date]);
  return ready ? windows.map((code) => ({ code, ...(results.get(`${seg.key}|${code}`) || { status: 'loading' }) })) : [];
}

function TimeChips({ seg, windows, onToggle }) {
  return (
    <div className="space-y-1.5 border-b border-slate-100 px-3 py-2.5">
      <p className="text-xs font-bold text-slate-700">
        When do you want to leave? <span className="font-medium text-slate-500">Choose one or more</span>
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="group" aria-label={`Departure time, ${seg.from} to ${seg.to}`}>
        {TIME_WINDOWS.map((w) => {
          const on = windows.includes(w.code);
          return (
            <button
              key={w.code}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(w.code)}
              className={`rounded-[10px] border px-1.5 py-1.5 text-center transition-colors ${
                on ? 'border-brand bg-brand/10 shadow-[inset_0_0_0_1px_theme(colors.brand)]' : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <b className={`block text-[12.5px] ${on ? 'text-brand' : 'text-ink'}`}>{w.label}</b>
              <span className="text-[10.5px] text-slate-500">{w.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A bus leg: never searched (no reliable source) — they say when they want to leave and what
 * kind of bus, and the travel desk books it. */
function BusCard({ seg, index, count, pick, onPick, showErrors }) {
  const windows = pick?.time_windows || [];
  const types = pick?.bus_types || [];
  const done = pickDone(pick);
  const title = count > 1 ? `Leg ${index + 1} · ${seg.from} → ${seg.to}` : `${seg.from} → ${seg.to}`;
  const flip = (list, code, all) => all.filter((c) => (c === code ? !list.includes(c) : list.includes(c)));
  const save = (next) => onPick({ choice: 'bus', option: null, note: null, time_windows: windows, bus_types: types, ...next });

  if (!segmentComplete(seg)) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500">
        {count > 1 ? `Leg ${index + 1}: ` : ''}Fill in where you’re going and the date.
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-xl border ${done ? 'border-slate-200' : showErrors ? 'border-rose-300' : 'border-amber-300'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <span className="text-[13px] font-bold text-ink">
          {title} <span className="text-[11.5px] font-medium text-slate-500">· {dayLabel(seg.date)}</span>
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${done ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          {done
            ? '✓ Chosen'
            : !windows.length && !types.length
              ? 'Choose a time and bus type'
              : !windows.length
                ? 'Choose a time'
                : 'Choose a bus type'}
        </span>
      </div>

      <TimeChips seg={seg} windows={windows} onToggle={(code) => save({ time_windows: flip(windows, code, TIME_WINDOWS.map((w) => w.code)) })} />

      <div className="space-y-1.5 px-3 py-2.5">
        <p className="text-xs font-bold text-slate-700">
          What kind of bus? <span className="font-medium text-slate-500">Choose one or more</span>
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5" role="group" aria-label={`Bus type, ${seg.from} to ${seg.to}`}>
          {BUS_TYPES.map((t) => {
            const on = types.includes(t.code);
            return (
              <button
                key={t.code}
                type="button"
                aria-pressed={on}
                onClick={() => save({ bus_types: flip(types, t.code, BUS_TYPES.map((b) => b.code)) })}
                // The fifth button fills its row on phones (two per row) instead of sitting alone.
                className={`rounded-[10px] border px-1.5 py-1.5 text-center transition-colors last:col-span-2 sm:last:col-span-1 ${
                  on ? 'border-brand bg-brand/10 shadow-[inset_0_0_0_1px_theme(colors.brand)]' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <b className={`block text-[12.5px] ${on ? 'text-brand' : 'text-ink'}`}>{t.label}</b>
                <span className="text-[10.5px] text-slate-500">{t.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">
        There’s no bus search: the travel desk finds and books the bus.
      </div>
    </div>
  );
}

function LegCard({ seg, index, count, pick, onPick, showErrors }) {
  const windows = pick?.time_windows || [];
  const searches = useSearches(seg, windows);
  const done = pickDone(pick);
  const loading = searches.filter((s) => s.status === 'loading');
  const failed = searches.filter((s) => s.status === 'failed');
  const options = searches
    .filter((s) => s.status === 'done')
    .flatMap((s) => (s.options || []).map((o) => ({ ...o, searched_at: s.searched_at, in_policy: (s.classes || []).length > 0 })))
    .sort((a, b) => minutes(a.depart_time) - minutes(b.depart_time))
    // Two windows' searches can both return the same train/flight (with different times): keep the first.
    .filter((o, i, all) => {
      const number = (o.number || '').replace(/\s/g, '').toUpperCase();
      return !number || all.findIndex((x) => (x.number || '').replace(/\s/g, '').toUpperCase() === number) === i;
    });
  const nothing = windows.length > 0 && !loading.length && !options.length;
  const own = pick?.choice === 'own' || nothing;
  const title = count > 1 ? `Leg ${index + 1} · ${seg.from} → ${seg.to}` : `${seg.from} → ${seg.to}`;
  const windowText = leaveWindowsText(loading.map((s) => s.code)) || leaveWindowsText(windows);

  const toggle = (code) => {
    const next = TIME_WINDOWS.map((w) => w.code).filter((c) => (c === code ? !windows.includes(c) : windows.includes(c)));
    if (!next.includes(code)) {
      // Let a failed search be tried again if they choose this time later.
      const key = `${seg.key}|${code}`;
      if (results.get(key)?.status === 'failed') results.delete(key);
    }
    // A picked option leaving in a time they've just removed is no longer their choice.
    const dropOption = pick?.choice === 'option' && pick.option?.time_window && !next.includes(pick.option.time_window);
    onPick(dropOption ? { time_windows: next } : { ...pick, time_windows: next });
  };
  const choose = (choice) => onPick({ ...(choice || {}), time_windows: windows });

  if (!segmentComplete(seg)) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500">
        {count > 1 ? `Leg ${index + 1}: ` : ''}Fill in where you’re going and the date to see {MODE_PLURAL[seg.mode] || 'options'}.
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-xl border ${done ? 'border-slate-200' : showErrors ? 'border-rose-300' : 'border-amber-300'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <span className="text-[13px] font-bold text-ink">
          {title} <span className="text-[11.5px] font-medium text-slate-500">· {dayLabel(seg.date)}</span>
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${done ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          {done ? '✓ Chosen' : windows.length ? 'Pick one' : 'Pick a time'}
        </span>
      </div>

      <TimeChips seg={seg} windows={windows} onToggle={toggle} />

      {!windows.length ? (
        <p className="px-3 py-3 text-xs text-slate-500">Choose a time to see {MODE_PLURAL[seg.mode] || 'options'}.</p>
      ) : null}

      {options.length ? (
        <div role="radiogroup" aria-label={title}>
          {options.map((o, i) => {
            const checked = pick?.choice === 'option' && pick.option && pick.option.name === o.name && pick.option.number === o.number && pick.option.depart_time === o.depart_time;
            const { searched_at: searchedAt, in_policy: inPolicy, ...option } = o;
            return (
              <button
                key={`${o.number}-${o.depart_time}-${i}`}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => choose({ choice: 'option', option, note: null, searched_at: searchedAt })}
                className={`grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-slate-100 px-3 py-2 text-left first:border-t-0 hover:bg-slate-50 ${
                  checked ? 'bg-brand/10 shadow-[inset_3px_0_0_theme(colors.brand)]' : 'bg-white'
                }`}
              >
                <span className={`grid h-[18px] w-[18px] place-items-center rounded-full border-2 ${checked ? 'border-brand' : 'border-slate-300'}`}>
                  {checked ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <b className="text-[13px] text-ink">{o.name || o.operator}</b>
                    {o.number ? <span className="font-mono text-[11.5px] text-slate-500">{o.number}</span> : null}
                    {o.operator && o.operator !== o.name && seg.mode !== 'TRAIN' ? <span className="text-[11.5px] text-slate-500">{o.operator}</span> : null}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-600">
                    <span className="font-bold tabular-nums text-ink">
                      {o.depart_time}
                      {o.from_station ? ` ${o.from_station}` : ''} → {o.arrive_time}
                      {o.to_station ? ` ${o.to_station}` : ''}
                    </span>
                    {o.duration ? <span>· {o.duration}</span> : null}
                    {o.travel_class ? <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10.5px] font-bold text-slate-600">{o.travel_class}</span> : null}
                    {inPolicy ? (
                      <span className="rounded-full bg-emerald-50 px-1.5 py-px text-[10.5px] font-bold text-emerald-700">In your policy</span>
                    ) : null}
                  </span>
                </span>
                {/* Trains are shown without prices; timetable and schedule results have none. */}
                {o.fare_inr || (seg.mode !== 'TRAIN' && o.source !== 'schedule') ? (
                  <span className="text-right text-xs">
                    {o.fare_inr ? <b className="block text-[13.5px] tabular-nums text-ink">~{inr(o.fare_inr)}</b> : null}
                    <span className="text-[10.5px] text-slate-400">{o.fare_inr ? 'approx. fare' : 'fare not shown'}</span>
                  </span>
                ) : (
                  <span />
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      {loading.length ? (
        <p className="flex items-center gap-2 border-t border-slate-100 px-3 py-3 text-xs text-slate-500 first:border-t-0">
          <Clock size={14} className="animate-spin" /> Looking for {MODE_PLURAL[seg.mode]} leaving {windowText} on {dayLabel(seg.date)}…
        </p>
      ) : null}

      {failed.length && !nothing ? (
        <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Couldn’t search {leaveWindowsText(failed.map((s) => s.code))} right now.</p>
      ) : null}

      {nothing ? (
        <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          {failed.length === windows.length ? failed[0].message : `No ${MODE_PLURAL[seg.mode]} found leaving ${leaveWindowsText(windows)} on this day.`}{' '}
          Choose another time, or tell the travel desk what you’d like.
        </p>
      ) : null}

      {own ? (
        <div className="border-t border-slate-100 px-3 py-2.5">
          <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor={`own-${seg.key}`}>
            Tell the travel desk what you’d like
          </label>
          <textarea
            id={`own-${seg.key}`}
            rows={2}
            className="w-full rounded-[10px] border border-slate-200 px-2.5 py-2 text-[13px] text-ink outline-none focus:border-brand"
            placeholder={`e.g. any evening ${seg.mode === 'FLIGHT' ? 'flight' : seg.mode === 'BUS' ? 'bus' : 'train'} after 6 pm`}
            value={pick?.choice === 'own' ? pick.note || '' : ''}
            onChange={(e) => choose({ choice: 'own', option: null, note: e.target.value })}
          />
        </div>
      ) : null}

      {options.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">
          <span>
            {options.every((o) => o.source === 'timetable')
              ? 'From the Indian Railways timetable · seats and fares are checked by the travel desk'
              : options.every((o) => o.source === 'schedule')
                ? 'From airline schedules · seats and fares are checked by the travel desk'
                : 'Found with Google by Gemini and checked against timetables · fares are estimates; the travel desk confirms'}
          </span>
          <button
            type="button"
            className="font-bold text-brand hover:underline"
            onClick={() => choose(pick?.choice === 'own' ? null : { choice: 'own', option: null, note: '' })}
          >
            {pick?.choice === 'own' ? 'Pick from the list instead' : 'None of these — describe what you want'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function LegPicker({ segments, picks, onChange, showErrors }) {
  const modes = new Set(segments.map((s) => s.mode));
  const allBus = modes.size === 1 && modes.has('BUS');
  const what = modes.size === 1 ? MODE_PLURAL[[...modes][0]] || 'options' : 'how you’ll travel';
  const left = segments.filter((s) => segmentComplete(s) && !pickDone(picks[s.key])).length;
  return (
    <section className="space-y-2" aria-label="Choose your options">
      <p className={EYEBROW}>
        {allBus ? 'Your bus' : `Choose your ${what}`} <span className="font-semibold normal-case tracking-normal">· required for each leg</span>
      </p>
      {segments.map((seg, i) => {
        const Card = seg.mode === 'BUS' ? BusCard : LegCard;
        return (
          <Card
            key={seg.key}
            seg={seg}
            index={i}
            count={segments.length}
            pick={picks[seg.key]}
            onPick={(pick) => onChange({ ...picks, [seg.key]: pick })}
            showErrors={showErrors}
          />
        );
      })}
      {showErrors && left ? (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          {allBus
            ? `Choose a time and bus type for ${left === 1 ? 'the leg' : `${left} legs`} above.`
            : `Choose an option for ${left === 1 ? 'the leg' : `${left} legs`} above, or describe what you want.`}
        </p>
      ) : null}
    </section>
  );
}
