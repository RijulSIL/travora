import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { TipBody, useFloatingTip } from '../ui/FloatingTip';

/*
 * Building blocks of the shared Home page (pages/dashboards/HomeDashboard.jsx): the greeting
 * header, the money strip, the "Needs your attention" list, titled panels, empty states and the
 * small chart pieces used by the role sections. Plain markup only — data loading lives in the
 * hooks and sections that use these.
 */

export const inr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const inr0 = (value) => `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-10-15" (or an ISO datetime) → a local Date at midnight; null when missing/invalid. */
export function dayOf(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export const daysBetween = (a, b) => Math.round((b - a) / DAY);
export const shortDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const weekdayDate = (d) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Weekends-only working days, the same rule the travel claim form uses for its deadline. */
export function addWorkingDays(date, days) {
  const value = new Date(date);
  let left = days;
  while (left > 0) {
    value.setDate(value.getDate() + 1);
    const dow = value.getDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return value;
}

/** Plain-words SLA line for an approval queue, plus its tone. */
export function slaText(deadline, now = Date.now()) {
  if (!deadline) return null;
  const at = new Date(deadline);
  if (Number.isNaN(at.getTime())) return null;
  const time = at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const day = dayOf(deadline);
  const gap = daysBetween(today(), day);
  if (at.getTime() <= now) return { text: `SLA passed ${gap === 0 ? 'today' : shortDate(day)} ${time}`, tone: 'rose' };
  if (gap === 0) {
    const hrs = Math.floor((at.getTime() - now) / 3600000);
    return { text: `SLA ends today ${time}${hrs ? ` · ${hrs}h left` : ' · under an hour left'}`, tone: 'rose' };
  }
  if (gap === 1) return { text: `SLA ends tomorrow ${time}`, tone: 'amber' };
  return { text: `SLA ends ${weekdayDate(day)}`, tone: 'slate' };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function HomeHeader({ firstName, summary, profile, onOpenLimits }) {
  const level = profile?.impact_level_code
    ? `${profile.impact_level_code}${profile.impact_level_name ? ` · ${profile.impact_level_name}` : ''}`
    : null;
  return (
    <section className="flex flex-wrap items-end justify-between gap-3.5">
      <div className="min-w-0">
        <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
          {greeting()}, {firstName}
        </h2>
        <p className="mt-0.5 text-[13px] text-slate-500 [&_b]:font-bold [&_b]:text-ink">{summary}</p>
      </div>
      {level ? (
        <button
          type="button"
          onClick={onOpenLimits}
          className="inline-flex max-w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white py-[7px] pl-2 pr-3 text-left transition-colors hover:border-brand/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-brand/10 text-brand">
            <ShieldCheck size={16} />
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-extrabold text-ink">{level}</span>
            <span className="block text-[11.5px] text-slate-500">
              {profile?.hotel_cap_group_a
                ? `Hotel up to ${inr0(profile.hotel_cap_group_a)}/night in Group A cities · See all limits`
                : 'See all your limits'}
            </span>
          </span>
        </button>
      ) : null}
    </section>
  );
}

/** Three figures in one strip: `cells` = [{ label, value, zero, sub }]. */
export function MoneyStrip({ cells, label = 'Your money' }) {
  return (
    <section
      aria-label={label}
      className="grid overflow-hidden rounded-[14px] border border-slate-200 bg-white sm:grid-cols-3"
    >
      {cells.map((c) => (
        <div
          key={c.label}
          className="flex min-w-0 flex-col gap-[3px] border-t border-slate-100 px-[18px] py-3.5 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0"
        >
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400">{c.label}</span>
          <span className={`font-mono text-[19px] font-semibold tabular-nums ${c.zero ? 'text-slate-400' : 'text-ink'}`}>{c.value}</span>
          <span className="text-xs text-slate-500 [&_a]:font-bold [&_a]:text-brand hover:[&_a]:underline">{c.sub}</span>
        </div>
      ))}
    </section>
  );
}

/** A row of small stats (finance, admin): `cells` = [{ label, value, zero, sub }]. */
export function StatStrip({ cells, label }) {
  return (
    <section aria-label={label} className="grid grid-cols-2 overflow-hidden rounded-[14px] border border-slate-200 bg-white lg:grid-cols-4">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={`flex min-w-0 flex-col gap-[3px] px-4 py-3.5 ${i % 2 ? 'border-l border-slate-100' : ''} ${i >= 2 ? 'border-t border-slate-100 lg:border-t-0' : ''} ${
            i ? 'lg:border-l lg:border-slate-100' : ''
          }`}
        >
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400">{c.label}</span>
          <span className={`font-mono text-lg font-semibold tabular-nums ${c.zero ? 'text-slate-400' : 'text-ink'}`}>{c.value}</span>
          <span className="text-xs text-slate-500 [&_a]:font-bold [&_a]:text-brand hover:[&_a]:underline">{c.sub}</span>
        </div>
      ))}
    </section>
  );
}

export function SectionTitle({ title, note }) {
  return (
    <div className="-mb-1.5 mt-1 flex flex-wrap items-baseline gap-2.5 px-0.5">
      <h3 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-400">{title}</h3>
      {note ? <span className="text-xs text-slate-500">{note}</span> : null}
    </div>
  );
}

/** White panel with a title row and an optional "link →" on the right. */
export function Panel({ title, sub, link, children, badge = null }) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2.5 border-b border-slate-100 px-4 py-[13px]">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-ink">
            {title}
            {badge}
          </h3>
          {sub ? <p className="mt-0.5 text-xs font-medium text-slate-500">{sub}</p> : null}
        </div>
        {link ? (
          <Link to={link.to} className="inline-flex flex-none items-center gap-1 text-[12.5px] font-bold text-brand hover:underline">
            {link.label} <ArrowRight size={14} />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function PanelNote({ children }) {
  return <p className="px-4 py-6 text-center text-[12.5px] text-slate-500">{children}</p>;
}

/** The "No claims yet" / "No trips coming up" state: icon, title, a line, then buttons. */
export function EmptyState({ icon: Icon, tone = 'brand', title, children, actions }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 pb-[30px] pt-[34px] text-center">
      <div
        className={`mb-1.5 flex h-[46px] w-[46px] items-center justify-center rounded-[14px] ${
          tone === 'sky' ? 'bg-sky-50 text-sky-700' : 'bg-brand/10 text-brand'
        }`}
      >
        <Icon size={22} />
      </div>
      <b className="text-sm text-ink">{title}</b>
      <p className="max-w-[40ch] text-[12.5px] leading-relaxed text-slate-500">{children}</p>
      {actions ? <div className="mt-2.5 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

const TASK_TONE = { amber: 'text-amber-700', rose: 'text-rose-700', slate: 'text-slate-500' };
const ICON_TONE = {
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  sky: 'bg-sky-50 text-sky-700',
  slate: 'bg-slate-100 text-slate-500',
  fuchsia: 'bg-fuchsia-50 text-fuchsia-700',
};

/** One line in "Needs your attention": an approval queue or one of your own to-dos. */
export function TaskRow({ task }) {
  const Icon = task.icon;
  return (
    <div className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-1.5 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:grid-cols-[36px_minmax(0,1fr)_auto_auto]">
      <div className={`row-span-3 flex h-9 w-9 items-center justify-center self-start rounded-[10px] sm:row-span-1 sm:self-center ${ICON_TONE[task.iconTone] || ICON_TONE.slate}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className={`truncate text-[13.5px] font-extrabold ${task.closed ? 'text-slate-500' : 'text-ink'}`}>{task.title}</div>
        <div className="truncate text-xs text-slate-500 [&_b]:font-bold [&_b]:text-slate-700" title={task.subTitle}>
          {task.sub}
        </div>
      </div>
      <div className={`whitespace-nowrap text-xs font-bold sm:text-right ${TASK_TONE[task.whenTone] || TASK_TONE.slate}`}>{task.when}</div>
      <div className="flex justify-start sm:justify-end">
        {task.action ? (
          <button
            type="button"
            onClick={task.action.onClick}
            className={`inline-flex h-7 items-center whitespace-nowrap rounded-lg px-2.5 text-[11.5px] font-bold text-white ${
              task.action.danger ? 'bg-rose-700 hover:bg-rose-800' : 'bg-brand hover:bg-brand/90'
            }`}
          >
            {task.action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function GroupLabel({ children }) {
  return (
    <div className="border-y border-slate-100 bg-slate-50 px-4 py-[7px] text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400 first:border-t-0">
      {children}
    </div>
  );
}

/** "Needs your attention": approvals waiting on you, then your own to-dos, then what's coming. */
export function AttentionPanel({ approvals, mine, coming, loading, emptyTitle, emptyText }) {
  const open = approvals.length + mine.filter((t) => !t.closed).length;
  const both = approvals.length > 0 && mine.length > 0;
  return (
    <Panel
      title="Needs your attention"
      badge={open ? <span className="rounded-full bg-rose-50 px-2 py-px text-[11px] text-rose-700">{open}</span> : null}
    >
      {loading ? <PanelNote>Checking what needs you…</PanelNote> : null}
      {!loading && both ? <GroupLabel>Waiting on you to approve</GroupLabel> : null}
      {!loading ? approvals.map((t) => <TaskRow key={t.key} task={t} />) : null}
      {!loading && both ? <GroupLabel>Your own</GroupLabel> : null}
      {!loading ? mine.map((t) => <TaskRow key={t.key} task={t} />) : null}
      {!loading && !approvals.length && !mine.length ? (
        <div className="flex items-center gap-3 p-4 text-[12.5px] text-slate-500">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-emerald-50 text-emerald-700">
            <Check size={16} />
          </div>
          <div>
            <b className="block text-[13.5px] text-ink">{emptyTitle}</b>
            {emptyText}
          </div>
        </div>
      ) : null}
      {!loading && coming ? (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500 [&_b]:text-slate-700">{coming}</div>
      ) : null}
    </Panel>
  );
}

/** Calendar-style date block: month band, day, weekday. `now` turns the band brand green. */
export function DateBox({ date, now = false }) {
  return (
    <div className={`w-12 flex-none overflow-hidden rounded-[10px] border bg-white text-center ${now ? 'border-brand/30' : 'border-slate-200'}`}>
      <div
        className={`border-b py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.08em] ${
          now ? 'border-brand bg-brand text-white' : 'border-slate-100 bg-slate-50 text-slate-500'
        }`}
      >
        {MONTHS[date.getMonth()]}
      </div>
      <div className="pb-0.5 pt-[5px] text-base font-extrabold leading-none text-ink">{date.getDate()}</div>
      <div className="pb-1 text-[9.5px] font-bold text-slate-400">{WEEKDAYS[date.getDay()]}</div>
    </div>
  );
}

const percentOf = (value, total) => `${(total ? (value / total) * 100 : 0).toFixed(1)}%`;

/**
 * Horizontal bars: rows = [{ label, value, color }]; `format` renders the figure. Hovering a bar
 * shows its figure and share; `of` names the whole ("of all requests").
 */
export function BarList({ rows, format = (v) => v, of = 'of the total' }) {
  const tip = useFloatingTip();
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="flex flex-col gap-[9px] px-4 pb-4 pt-3.5">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid cursor-default grid-cols-[96px_minmax(0,1fr)_80px] items-center gap-2.5 rounded-md text-xs hover:bg-slate-50 sm:grid-cols-[128px_minmax(0,1fr)_92px]"
          {...tip.bind(<TipBody title={r.label} amount={String(format(r.value))} line={`${percentOf(r.value, total)} ${of}`} />)}
        >
          <span className="truncate text-slate-700">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            {r.value ? <i className="block h-full rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color }} /> : null}
          </span>
          <span className={`text-right font-mono text-xs font-semibold ${r.value ? 'text-ink' : 'text-slate-400'}`}>{format(r.value)}</span>
        </div>
      ))}
      {tip.node}
    </div>
  );
}

/** Vertical bars for a short series (e.g. six months): points = [{ label, value }]; hover for the figure. */
export function ColumnBars({ points, format = inr0 }) {
  const tip = useFloatingTip();
  const max = Math.max(...points.map((p) => p.value), 0) || 1;
  const total = points.reduce((a, p) => a + p.value, 0);
  return (
    <div className="px-4 pb-3.5 pt-4">
      <div className="grid h-[150px] items-end gap-2.5" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
        {points.map((p) => (
          <div
            key={p.label}
            className="flex h-full cursor-default flex-col items-center justify-end gap-1"
            {...tip.bind(
              <TipBody title={p.label} amount={inr(p.value)} line={p.value ? `${percentOf(p.value, total)} of these ${points.length} months` : 'nothing claimed'} />,
            )}
          >
            <small className="whitespace-nowrap font-mono text-[10.5px] text-slate-500">{p.value ? format(p.value) : '–'}</small>
            <i
              className={`block w-full max-w-[38px] rounded-t-md rounded-b-sm ${p.value ? 'bg-brand' : 'bg-slate-200'}`}
              style={{ height: p.value ? `${Math.max(4, (p.value / max) * 100)}px` : '2px' }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 grid gap-2.5 text-center text-[11px] font-bold text-slate-500" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
        {points.map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </div>
      {tip.node}
    </div>
  );
}

/** Donut + legend: slices = [{ label, value, color }]. Hover the ring or a legend row for the figure. */
export function Donut({ slices, centerLabel = 'Total spend' }) {
  const tip = useFloatingTip();
  const [active, setActive] = useState(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  let acc = 0;
  const bounds = slices.map((s) => {
    const from = acc;
    acc += total ? (s.value / total) * 360 : 0;
    return [from, acc];
  });
  const gradient = slices
    .map((s, i) => `${active == null || active === i ? s.color : `${s.color}55`} ${bounds[i][0]}deg ${bounds[i][1]}deg`)
    .join(',');
  const body = (s) => <TipBody title={s.label} amount={inr(s.value)} line={`${percentOf(s.value, total)} of ${centerLabel.toLowerCase()}`} />;
  // The ring is one CSS gradient, so the slice under the pointer comes from its angle.
  const sliceAt = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left - box.width / 2;
    const y = e.clientY - box.top - box.height / 2;
    const r = Math.hypot(x, y);
    if (r < box.width / 2 - 30 || r > box.width / 2) return null;
    const deg = ((Math.atan2(y, x) * 180) / Math.PI + 90 + 360) % 360;
    const i = bounds.findIndex(([from, to]) => deg >= from && deg < to);
    return i < 0 ? null : i;
  };
  const onRing = (e) => {
    const i = sliceAt(e);
    setActive(i);
    if (i == null) tip.hide();
    else tip.show(body(slices[i]), e);
  };
  return (
    <div className="grid items-center justify-items-center gap-5 p-4 sm:grid-cols-[170px_minmax(0,1fr)] sm:justify-items-stretch">
      <div
        className="relative h-[170px] w-[170px] rounded-full"
        style={{ background: `conic-gradient(${gradient})` }}
        onMouseMove={onRing}
        onClick={onRing}
        onMouseLeave={() => {
          setActive(null);
          tip.hide();
        }}
      >
        <div className="pointer-events-none absolute inset-[30px] flex flex-col items-center justify-center rounded-full bg-white text-center text-[10.5px] font-bold uppercase tracking-[0.05em] text-slate-500">
          {centerLabel}
          <b className="mt-0.5 font-mono text-[13px] normal-case tracking-normal text-ink">{inr(total)}</b>
        </div>
      </div>
      <div className="flex w-full flex-col gap-[7px] text-xs">
        {slices.map((s, i) => (
          <div
            key={s.label}
            className={`-mx-1 grid cursor-default grid-cols-[10px_minmax(0,1fr)_auto_44px] items-center gap-2 rounded-md px-1 ${active === i ? 'bg-slate-50' : ''}`}
            onMouseEnter={(e) => {
              setActive(i);
              tip.show(body(s), e);
            }}
            onMouseMove={(e) => tip.show(body(s), e)}
            onMouseLeave={() => {
              setActive(null);
              tip.hide();
            }}
          >
            <i className="block h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
            <span className="truncate text-slate-700">{s.label}</span>
            <span className="font-mono font-semibold text-ink">{inr(s.value)}</span>
            <span className="text-right text-[11px] text-slate-500">{percentOf(s.value, total)}</span>
          </div>
        ))}
      </div>
      {tip.node}
    </div>
  );
}
