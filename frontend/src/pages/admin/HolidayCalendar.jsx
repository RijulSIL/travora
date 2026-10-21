import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BTN_GHOST, BTN_MAIN, BTN_NO, BTN_SM, CARD, FIELD, LABEL } from '../../components/policy/PolicyAdminParts';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { adminApi } from '../../services/adminApi';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => new Date(`${s}T00:00:00`);
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const longDate = (d) => `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function errorText(err, fallback) {
  const d = err?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join('; ') || fallback;
  return err?.message || fallback;
}

function Month({ year, month, byDate, todayIso, selected, onPick }) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const count = new Date(year, month + 1, 0).getDate();
  const inMonth = Object.keys(byDate).filter((k) => k.startsWith(`${year}-${pad(month + 1)}-`)).length;
  return (
    <div>
      <h3 className="mb-1.5 flex justify-between text-[12.5px] font-extrabold text-ink">
        {MONTHS[month]}
        {inMonth ? (
          <span className="text-[11px] font-bold text-brand">
            {inMonth} holiday{inMonth > 1 ? 's' : ''}
          </span>
        ) : null}
      </h3>
      <div className="mb-3 grid grid-cols-7 gap-0.5">
        {DOW.map((d, i) => (
          <span key={`${d}-${i}`} className="pb-0.5 text-center text-[9.5px] font-extrabold text-slate-400">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`pad-${i}`} aria-hidden />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const d = new Date(year, month, i + 1);
          const key = isoOf(d);
          const holiday = byDate[key];
          const weekend = isWeekend(d);
          let tone = 'text-slate-700 hover:bg-slate-100';
          if (holiday) tone = weekend ? 'bg-[#8fb9aa] font-extrabold text-white' : 'bg-brand font-extrabold text-white';
          else if (weekend) tone = 'bg-slate-50 text-slate-400 hover:bg-slate-100';
          const ring = selected === key ? 'shadow-[inset_0_0_0_2px_#f59e0b]' : key === todayIso ? 'shadow-[inset_0_0_0_1.5px_#17202a]' : '';
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              aria-label={`${holiday ? `${holiday.name}, ` : ''}${longDate(d)}${weekend ? ' (weekend)' : ''}`}
              title={`${holiday ? `${holiday.name} · ` : ''}${d.getDate()} ${MONTHS[month]}${weekend ? ' (weekend)' : ''}`}
              className={`grid aspect-square place-items-center rounded-md text-[11px] ${tone} ${ring}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function HolidayCalendar() {
  useSetPageTitle('Holiday Calendar');
  const { showToast } = useToast();
  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);
  const todayIso = isoOf(today);

  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [year, setYear] = useState(today.getFullYear());
  // The add / edit panel: null, or { id (null when adding), date, name }.
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [anim, setAnim] = useState('enter');
  // Bumped each time the panel opens or switches holiday, so it re-animates then (not while typing).
  const [openCount, setOpenCount] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef(null);
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setLoadError('');
      const res = await adminApi.holidays();
      setRows(res.data || []);
    } catch (err) {
      setRows((current) => current || []);
      setLoadError(errorText(err, 'Could not load holidays.'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const all = useMemo(() => rows || [], [rows]);
  const byDate = useMemo(() => Object.fromEntries(all.map((r) => [r.holiday_date, r])), [all]);
  const yearRows = all.filter((r) => r.holiday_date.startsWith(`${year}-`)).sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
  const upcoming = [...all].filter((r) => r.holiday_date >= todayIso).sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))[0];
  const onWeekend = yearRows.filter((r) => isWeekend(parse(r.holiday_date))).length;

  // Bring the panel into view when it opens below the calendar (narrow screens).
  const panelKey = form ? openCount : null;
  useEffect(() => {
    if (panelKey === null || !panelRef.current) return;
    const top = panelRef.current.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight - 120) panelRef.current.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [panelKey]);

  const openForm = (next) => {
    clearTimeout(leaveTimer.current);
    setLeaving(false);
    setAnim(form ? 'swap' : 'enter');
    setFormError('');
    setOpenCount((n) => n + 1);
    setForm(next);
  };
  const pickDay = (key) => {
    const h = byDate[key];
    openForm(h ? { id: h.id, date: h.holiday_date, name: h.name } : { id: null, date: key, name: '' });
  };
  // Slide the panel out, then remove it.
  const closeForm = () => {
    if (!form || leaving) return;
    if (reducedMotion()) {
      setForm(null);
      return;
    }
    setLeaving(true);
    leaveTimer.current = setTimeout(() => {
      setLeaving(false);
      setForm(null);
    }, 280);
  };

  const save = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!form.date || !name) {
      setFormError('Pick a date and give it a name.');
      return;
    }
    const clash = byDate[form.date];
    if (clash && clash.id !== form.id) {
      setFormError(`There's already a holiday on this date: ${clash.name}.`);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (form.id != null) await adminApi.updateHoliday(form.id, { holiday_date: form.date, name });
      else await adminApi.createHoliday({ holiday_date: form.date, name });
      await load();
      showToast(form.id != null ? `Saved ${name}.` : `Added ${name}.`, 'success');
      setYear(parse(form.date).getFullYear());
      closeForm();
    } catch (err) {
      setFormError(errorText(err, 'Could not save this holiday.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (holiday) => {
    setConfirmDelete(null);
    try {
      await adminApi.deleteHoliday(holiday.id);
      if (form?.id === holiday.id) closeForm();
      await load();
      showToast(`Deleted ${holiday.name}.`, 'success');
    } catch (err) {
      showToast(errorText(err, 'Could not delete this holiday.'), 'error');
    }
  };

  const formDate = form?.date ? parse(form.date) : null;
  const panelAnim = leaving
    ? 'pointer-events-none animate-sheet-down lg:animate-sheet-out'
    : anim === 'swap'
      ? 'animate-sheet-swap'
      : 'animate-sheet-up lg:animate-sheet-in';

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Holiday calendar</h1>
          <p className="mt-0.5 max-w-[52ch] text-[13px] text-slate-500">Company holidays. Approval deadlines skip these days, as well as weekends.</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          <div className="min-w-[110px] rounded-xl border border-slate-200 bg-white px-3 py-[7px]">
            <b className="block text-[17px] text-ink">{rows ? yearRows.length : '—'}</b>
            <span className="text-[11.5px] font-semibold text-slate-500">Holidays in {year}</span>
          </div>
          <div className="min-w-[110px] max-w-[200px] rounded-xl border border-slate-200 bg-white px-3 py-[7px]">
            <b className="block text-[17px] text-ink">{upcoming ? `${parse(upcoming.holiday_date).getDate()} ${SHORT[parse(upcoming.holiday_date).getMonth()]}` : '—'}</b>
            <span className="block truncate text-[11.5px] font-semibold text-slate-500" title={upcoming?.name}>
              {upcoming ? upcoming.name : 'Next holiday'}
            </span>
          </div>
          <div className="min-w-[110px] rounded-xl border border-slate-200 bg-white px-3 py-[7px]">
            <b className={`block text-[17px] ${onWeekend ? 'text-amber-700' : 'text-ink'}`}>{rows ? onWeekend : '—'}</b>
            <span className="text-[11.5px] font-semibold text-slate-500">On a weekend</span>
          </div>
          <button type="button" className={`${BTN_MAIN} h-auto min-h-[52px] rounded-xl px-4`} onClick={() => openForm({ id: null, date: '', name: '' })}>
            <Plus size={15} />
            Add holiday
          </button>
        </div>
      </div>

      {loadError ? (
        <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
          {loadError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="inline-flex items-center gap-1 rounded-[10px] border border-slate-200 bg-white p-[3px]">
          <button type="button" aria-label="Previous year" className="grid h-7 w-7 place-items-center rounded-[7px] text-slate-500 hover:bg-slate-100" onClick={() => setYear((y) => y - 1)}>
            <ChevronLeft size={15} />
          </button>
          <b className="min-w-[52px] text-center text-sm text-ink">{year}</b>
          <button type="button" aria-label="Next year" className="grid h-7 w-7 place-items-center rounded-[7px] text-slate-500 hover:bg-slate-100" onClick={() => setYear((y) => y + 1)}>
            <ChevronRight size={15} />
          </button>
        </span>
        <span className="flex flex-wrap items-center gap-3.5 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3 w-3 rounded bg-brand" /> Holiday
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3 w-3 rounded border border-slate-200 bg-slate-50" /> Weekend
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3 w-3 rounded shadow-[inset_0_0_0_1.5px_#17202a]" /> Today
          </span>
        </span>
      </div>

      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label={`Calendar ${year}`} className={CARD}>
          {rows === null ? (
            <div className="p-4">
              <Skeleton variant="table" rows={6} columns={1} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 p-3 sm:grid-cols-3 sm:gap-x-3.5 sm:p-4 xl:grid-cols-4">
              {MONTHS.map((_, m) => (
                <Month key={m} year={year} month={m} byDate={byDate} todayIso={todayIso} selected={form?.date} onPick={pickDay} />
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-3.5 lg:sticky lg:top-[calc(var(--app-nav-h,56px)+12px)]">
          {form ? (
            <form
              key={panelKey}
              ref={panelRef}
              aria-label={form.id != null ? 'Edit holiday' : 'Add a holiday'}
              onSubmit={save}
              className={`${CARD} scroll-mt-20 origin-top motion-reduce:animate-none lg:origin-right ${panelAnim}`}
            >
              <div className="flex items-center justify-between gap-2.5 border-b border-slate-100 px-4 py-3">
                <div className="min-w-0">
                  <b className="block text-sm text-ink">{form.id != null ? 'Edit holiday' : 'Add a holiday'}</b>
                  <span className="block truncate text-xs text-slate-500">{formDate ? longDate(formDate) : 'Pick a date'}</span>
                </div>
                <button type="button" aria-label="Close" className={BTN_SM} onClick={closeForm}>
                  <X size={13} />
                </button>
              </div>
              <div className="flex flex-col gap-2.5 px-4 py-3.5">
                <label className="block">
                  <span className={LABEL}>Date</span>
                  <input type="date" className={FIELD} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </label>
                <label className="block">
                  <span className={LABEL}>Name</span>
                  <input className={FIELD} placeholder="e.g. Diwali" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                {formDate && isWeekend(formDate) ? (
                  <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    This is a weekend, which deadlines already skip, so this holiday won&apos;t change anything.
                  </p>
                ) : null}
                {formError ? (
                  <p role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {formError}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-[11px]">
                {form.id != null ? (
                  <button type="button" className={BTN_NO} onClick={() => setConfirmDelete(all.find((r) => r.id === form.id))}>
                    Delete
                  </button>
                ) : null}
                <span className="flex-1" />
                <button type="button" className={BTN_GHOST} onClick={closeForm}>
                  Cancel
                </button>
                <button type="submit" className={BTN_MAIN} disabled={saving}>
                  {saving ? 'Saving…' : form.id != null ? 'Save' : 'Add holiday'}
                </button>
              </div>
            </form>
          ) : null}

          <section aria-label={`Holidays in ${year}`} className={CARD}>
            <div className="border-b border-slate-100 px-4 py-3">
              <b className="block text-sm text-ink">Holidays in {year}</b>
              <span className="text-xs text-slate-500">
                {yearRows.length} day{yearRows.length === 1 ? '' : 's'}
              </span>
            </div>
            {yearRows.length ? (
              yearRows.map((r, i) => {
                const d = parse(r.holiday_date);
                const past = r.holiday_date < todayIso;
                return (
                  <div
                    key={r.id}
                    className={`grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-[11px] px-4 py-2.5 ${i ? 'border-t border-slate-100' : ''} ${
                      form?.id === r.id ? 'bg-brand/[0.07]' : ''
                    } ${past ? 'opacity-60' : ''}`}
                  >
                    <span className="w-[46px] overflow-hidden rounded-[9px] border border-slate-200 bg-white text-center">
                      <span className="block bg-slate-100 py-px text-[9.5px] font-extrabold uppercase tracking-[0.05em] text-slate-500">{SHORT[d.getMonth()]}</span>
                      <span className="block text-[15px] font-extrabold leading-snug text-ink">{d.getDate()}</span>
                    </span>
                    <span className="min-w-0">
                      <b className="block truncate text-[13px] text-ink">{r.name}</b>
                      <span className="text-[11.5px] text-slate-500">
                        {WEEKDAYS[d.getDay()]}
                        {past ? ' · passed' : ''}
                      </span>
                      {isWeekend(d) ? <span className="ml-1 rounded-full bg-amber-50 px-[7px] py-px text-[10.5px] font-bold text-amber-700">Weekend</span> : null}
                    </span>
                    <span className="flex gap-1">
                      <button type="button" className={BTN_SM} onClick={() => openForm({ id: r.id, date: r.holiday_date, name: r.name })}>
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${r.name}`}
                        className={`${BTN_SM} w-7 px-0 text-rose-600 hover:border-rose-200 hover:bg-rose-50`}
                        onClick={() => setConfirmDelete(r)}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="px-4 py-7 text-center text-[12.5px] text-slate-500">
                <b className="mb-0.5 block text-[13.5px] text-ink">No holidays in {year}</b>
                Click a day on the calendar to add one.
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this holiday?"
        description={confirmDelete ? `"${confirmDelete.name}" will become a normal working day for approval deadlines.` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
      />
    </section>
  );
}
