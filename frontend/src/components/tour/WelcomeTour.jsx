import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';

import { reimbursementApi } from '../../services/reimbursementApi';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';
import { useTourStore } from '../../store/tourStore';
import { navTourKeys } from '../layout/navConfig';
import { TOURS, buildStops, tourContext, tourMarks } from './tours';

/**
 * The welcome tours (tours.js). Runs on Home only: a new person's pending tours start by
 * themselves shortly after they land there (after the password and meal & ID screens, which come
 * first because ProtectedRoute shows them instead of the app); the account menu starts one again.
 * Every tour opens with a card showing the journey, then dims the page and points at each item
 * in turn, then ends with a few first things to do. Finished or skipped is saved on the server
 * (POST /me/tours), so it never starts by itself again.
 */

const HOME = '/dashboard';
/** Below Tailwind's md breakpoint the sidebar is the slide-out menu. */
const PHONE = '(max-width: 767px)';
const PAD = 6;
const GAP = 12;
const EDGE = 12;
const TIP_WIDTH = 320;
const SIDEBAR_MARK = /^(nav:|group:|new-claim$)/;
const SCRIM = 'rgba(15, 23, 30, 0.55)';

const BTN = 'inline-flex h-9 items-center justify-center rounded-lg px-3.5 text-[13px] font-bold transition-colors';
const BTN_PRIMARY = `${BTN} bg-brand text-white hover:bg-brand/90`;
const BTN_PLAIN = `${BTN} border border-slate-200 bg-white text-ink hover:bg-slate-50`;
const CARD =
  'fixed left-1/2 top-[10vh] z-[82] flex max-h-[80vh] w-[min(460px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 overflow-y-auto rounded-2xl bg-white p-6 shadow-[0_30px_60px_-20px_rgba(15,23,42,.5)] outline-none';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[0.09em] text-brand';

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const onChange = () => setPhone(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/** The first mark that's on screen. The sidebar exists twice (desktop rail and phone menu), so
 * only a copy that is actually showing counts. */
function findTarget(marks) {
  for (const mark of marks) {
    for (const el of document.querySelectorAll(`[data-tour="${CSS.escape(mark)}"]`)) {
      if (el.getClientRects().length) return el;
    }
  }
  return null;
}

function bringIntoView(el) {
  // The top bar slides away while scrolling down; at the top it's always there.
  if (el.closest('header')) {
    window.scrollTo({ top: 0 });
    return;
  }
  const r = el.getBoundingClientRect();
  if (r.top < 64 || r.bottom > window.innerHeight - EDGE) el.scrollIntoView({ block: 'center' });
}

/** Next to a sidebar item on a wide screen, otherwise below the item (above when there's no room). */
function placeTip(tip, rect, phone) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = phone ? vw - EDGE * 2 : Math.min(TIP_WIDTH, vw - EDGE * 2);
  tip.style.width = `${width}px`;
  const height = tip.offsetHeight;
  const box = {
    left: rect.left - PAD,
    top: rect.top - PAD,
    right: rect.left + rect.width + PAD,
    bottom: rect.top + rect.height + PAD,
  };
  let left;
  let top;
  if (!phone && rect.inSidebar) {
    left = box.right + GAP;
    top = clamp(box.top, EDGE, vh - height - EDGE);
  } else {
    if (phone) left = EDGE;
    else if ((box.left + box.right) / 2 > vw / 2) left = clamp(box.right - width, EDGE, vw - width - EDGE);
    else left = clamp(box.left, EDGE, vw - width - EDGE);
    top = box.bottom + GAP;
    if (top + height > vh - EDGE) {
      const above = box.top - GAP - height;
      top = above >= EDGE ? above : clamp(top, EDGE, vh - height - EDGE);
    }
  }
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/** Keeps Tab inside the tour's card. */
function trapFocus(event, root) {
  if (!root) return;
  const buttons = [...root.querySelectorAll('button')];
  if (!buttons.length) return;
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!root.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function recordTour(key, outcome) {
  try {
    const { data } = await reimbursementApi.recordTour(key, outcome);
    const current = useAuthStore.getState().profile;
    if (current) useAuthStore.getState().setProfile({ ...current, ...data });
  } catch {
    // Not saved: it's simply offered again next time.
  }
}

function Journey({ steps }) {
  return (
    <ol className="flex flex-wrap gap-1.5">
      {steps.map((step, i) => (
        <li
          key={step}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1 pr-2.5 text-[12px] font-bold text-ink"
        >
          <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-brand text-[10px] font-extrabold text-white">{i + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}

/** One run of one tour, from its opening card to its last. Remounted for every start. */
function TourRun({ tourKey, nextKey, via, stops, nextStopCount, firstName, setMenuOpen }) {
  const tour = TOURS[tourKey];
  const next = useTourStore((s) => s.next);
  const stopTour = useTourStore((s) => s.stop);
  const queue = useTourStore((s) => s.queue);
  const phone = usePhone();

  // welcome → stop (index) → done; or skipped at any point.
  const [phase, setPhase] = useState('welcome');
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const direction = useRef(1);
  const dialogRef = useRef(null);
  const primaryRef = useRef(null);
  const tipRef = useRef(null);
  const menuOpenedByTour = useRef(false);
  const stop = phase === 'stop' ? stops[index] : null;

  const finish = () => {
    setPhase('done');
    recordTour(tourKey, 'finished');
  };
  const goNext = () => {
    direction.current = 1;
    if (phase === 'welcome') {
      if (stops.length) {
        setIndex(0);
        setPhase('stop');
      } else finish();
    } else if (phase === 'stop') {
      if (index < stops.length - 1) setIndex(index + 1);
      else finish();
    }
  };
  const goBack = () => {
    direction.current = -1;
    if (phase === 'stop') {
      if (index > 0) setIndex(index - 1);
      else setPhase('welcome');
    } else if (phase === 'done' && stops.length) {
      setIndex(stops.length - 1);
      setPhase('stop');
    }
  };
  const skip = () => {
    // Skipping now skips the tours queued after this one too; all stay in the account menu.
    [tourKey, ...queue].forEach((key) => recordTour(key, 'skipped'));
    setPhase('skipped');
  };
  const notNow = () => {
    queue.forEach((key) => recordTour(key, 'skipped'));
    stopTour();
  };

  // On a phone, sidebar stops need the slide-out menu open; it closes again after.
  const wantMenu = Boolean(phone && stop && SIDEBAR_MARK.test(stop.targets[0]));
  useEffect(() => {
    if (wantMenu !== menuOpenedByTour.current) {
      menuOpenedByTour.current = wantMenu;
      setMenuOpen(wantMenu);
    }
  }, [wantMenu, setMenuOpen]);
  useEffect(
    () => () => {
      if (menuOpenedByTour.current) setMenuOpen(false);
    },
    [setMenuOpen]
  );

  // Follows the item every frame, so scrolling, the phone menu sliding in or the window
  // resizing never leave the highlight behind. Between stops the old position stays until the
  // new item is found, so the highlight glides across. An item that never shows up is passed over.
  const passOver = useRef(null);
  passOver.current = () => (direction.current < 0 ? goBack() : goNext());
  useEffect(() => {
    if (!stop) {
      setRect(null);
      return undefined;
    }
    let frame = 0;
    let tries = 0;
    let el = null;
    let shown = false;
    let last = '';
    const tick = () => {
      if (!el || !el.isConnected || !el.getClientRects().length) {
        el = findTarget(stop.targets);
        if (!el) {
          tries += 1;
          if (tries > 60) {
            passOver.current();
            return;
          }
          frame = requestAnimationFrame(tick);
          return;
        }
      }
      if (!shown) {
        shown = true;
        bringIntoView(el);
      }
      const r = el.getBoundingClientRect();
      const key = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
      if (key !== last) {
        last = key;
        setRect({ left: r.left, top: r.top, width: r.width, height: r.height, inSidebar: Boolean(el.closest('aside')) });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stop]);

  useLayoutEffect(() => {
    if (rect && tipRef.current) placeTip(tipRef.current, rect, phone);
  }, [rect, phone, index]);

  const ready = phase !== 'stop' || rect !== null;
  useEffect(() => {
    if (ready) primaryRef.current?.focus({ preventScroll: true });
  }, [phase, index, ready]);

  const onKey = useRef(null);
  onKey.current = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (phase === 'done' || phase === 'skipped') stopTour();
      else skip();
    } else if (event.key === 'ArrowRight' && (phase === 'welcome' || phase === 'stop')) {
      event.preventDefault();
      goNext();
    } else if (event.key === 'ArrowLeft' && phase === 'stop') {
      event.preventDefault();
      goBack();
    } else if (event.key === 'Tab') {
      trapFocus(event, dialogRef.current);
    }
  };
  useEffect(() => {
    const handler = (event) => onKey.current(event);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const spotlight = phase === 'stop' && rect;
  let content = null;

  // Each card has its own key: the tip's position is set straight on its element (placeTip), and a
  // card that reused that element would keep it.
  if (phase === 'welcome') {
    content = (
      <div key="welcome" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="tour-title" className={CARD}>
        <div className={EYEBROW}>{via === 'auto' ? 'Welcome to Travora' : tour.title}</div>
        <h2 id="tour-title" className="text-[21px] font-bold leading-tight text-ink">
          Hi {firstName}, {tour.hello}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-slate-600">{tour.intro}</p>
        <Journey steps={tour.journey} />
        <p className="text-[12px] font-semibold text-slate-500">
          {stops.length} {stops.length === 1 ? 'stop' : 'stops'} · about 2 minutes · skip any time
        </p>
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN_PLAIN} onClick={skip}>
            Skip for now
          </button>
          <button type="button" ref={primaryRef} className={BTN_PRIMARY} onClick={goNext}>
            Show me around
          </button>
        </div>
      </div>
    );
  } else if (phase === 'stop' && stop && rect) {
    content = (
      <div
        key="tip"
        ref={(node) => {
          tipRef.current = node;
          dialogRef.current = node;
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-tip-title"
        aria-live="polite"
        className="fixed z-[82] flex flex-col gap-1.5 rounded-xl bg-white px-4 pb-3 pt-3.5 shadow-[0_18px_40px_-14px_rgba(10,16,20,.5)]"
      >
        <div className="flex items-center justify-between gap-3 text-[10.5px] font-extrabold uppercase tracking-[0.08em]">
          <span className="text-brand">{tour.title}</span>
          <span className="tabular-nums text-slate-400">
            {index + 1} of {stops.length}
          </span>
        </div>
        <h2 id="tour-tip-title" className="text-[15.5px] font-bold text-ink">
          {stop.title}
        </h2>
        <p className="text-[13px] leading-relaxed text-slate-600">{stop.body}</p>
        <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className="h-full bg-brand motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${((index + 1) / stops.length) * 100}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <button type="button" className="px-0.5 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-ink" onClick={skip}>
            Skip tour
          </button>
          <div className="flex gap-1.5">
            <button type="button" className={BTN_PLAIN} onClick={goBack}>
              Back
            </button>
            <button type="button" ref={primaryRef} className={BTN_PRIMARY} onClick={goNext}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  } else if (phase === 'done') {
    const nextTour = nextKey ? TOURS[nextKey] : null;
    content = (
      <div key="done" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="tour-title" className={CARD}>
        <div className={EYEBROW}>All done</div>
        <h2 id="tour-title" className="text-[21px] font-bold leading-tight text-ink">
          You&apos;re set, {firstName}
        </h2>
        <p className="text-[13.5px] text-slate-600">Good first things to do:</p>
        <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-slate-600">
          {tour.firsts.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-[12.5px] text-slate-500">Replay any tour from the account menu, top right.</p>
        {nextTour ? (
          <div className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-[13px] text-slate-600">
            <b className="block text-ink">Next: {nextTour.title}</b>
            {nextKey === 'manager' ? 'Because people report to you. ' : ''}
            {nextStopCount} {nextStopCount === 1 ? 'stop' : 'stops'}, about 2 minutes.
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          {nextTour ? (
            <>
              <button type="button" className={BTN_PLAIN} onClick={notNow}>
                Not now
              </button>
              <button type="button" ref={primaryRef} className={BTN_PRIMARY} onClick={next}>
                Start the {nextTour.title.replace(/ tour$/, '')} tour
              </button>
            </>
          ) : (
            <>
              <button type="button" className={BTN_PLAIN} onClick={goBack}>
                Back
              </button>
              <button type="button" ref={primaryRef} className={BTN_PRIMARY} onClick={stopTour}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    );
  } else if (phase === 'skipped') {
    content = (
      <div key="skipped" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="tour-title" className={CARD}>
        <div className={EYEBROW}>Tour skipped</div>
        <h2 id="tour-title" className="text-[21px] font-bold leading-tight text-ink">
          No problem
        </h2>
        <p className="text-[13.5px] leading-relaxed text-slate-600">
          You can take it any time from your account menu, top right. It won&apos;t start by itself again.
        </p>
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={BTN_PLAIN}
            onClick={() => {
              direction.current = 1;
              setIndex(0);
              setPhase(stops.length ? 'stop' : 'done');
            }}
          >
            Show me around after all
          </button>
          <button type="button" ref={primaryRef} className={BTN_PRIMARY} onClick={stopTour}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return createPortal(
    <>
      {/* Catches every click so nothing behind the tour can be used until it's over. */}
      <div className="fixed inset-0 z-[80]" style={{ background: spotlight ? 'transparent' : SCRIM }} aria-hidden="true" />
      {spotlight ? (
        <div
          className="pointer-events-none fixed z-[81] rounded-xl motion-safe:transition-[left,top,width,height] motion-safe:duration-300"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: `0 0 0 3px #fff, 0 0 0 9999px ${SCRIM}`,
          }}
          aria-hidden="true"
        />
      ) : null}
      {content}
    </>,
    document.body
  );
}

export default function WelcomeTour({ setMenuOpen }) {
  const location = useLocation();
  const onHome = location.pathname === HOME;
  const profile = useAuthStore((s) => s.profile);
  const role = useAuthStore(selectResolvedRole);
  const active = useTourStore((s) => s.active);
  const queue = useTourStore((s) => s.queue);
  const via = useTourStore((s) => s.via);
  const run = useTourStore((s) => s.run);
  const start = useTourStore((s) => s.start);
  const stopTour = useTourStore((s) => s.stop);

  // A new person's tours start by themselves, once, a moment after they land on Home.
  const autoStarted = useRef(false);
  const pending = profile?.pending_tours;
  useEffect(() => {
    if (autoStarted.current || active || !onHome || !pending?.length) return undefined;
    const keys = pending.filter((key) => TOURS[key]);
    if (!keys.length) return undefined;
    const timer = setTimeout(() => {
      autoStarted.current = true;
      start(keys, 'auto');
    }, 700);
    return () => clearTimeout(timer);
  }, [active, onHome, pending, start]);

  // Leaving Home (e.g. the browser's Back button) ends the tour without recording anything.
  const shownOnHome = useRef(false);
  useEffect(() => {
    if (!active) shownOnHome.current = false;
    else if (onHome) shownOnHome.current = true;
    else if (shownOnHome.current) {
      shownOnHome.current = false;
      stopTour();
    }
  }, [active, onHome, stopTour]);

  const marks = useMemo(() => tourMarks(navTourKeys(role, profile), profile), [role, profile]);
  const ctx = useMemo(() => tourContext(profile), [profile]);
  const stops = useMemo(() => buildStops(active, marks, ctx), [active, marks, ctx]);
  const nextKey = queue.find((key) => TOURS[key]) || null;
  const nextStopCount = useMemo(() => (nextKey ? buildStops(nextKey, marks, ctx).length : 0), [nextKey, marks, ctx]);

  if (!active || !onHome || !TOURS[active]) return null;
  const firstName = (profile?.full_name || '').trim().split(/\s+/)[0] || 'there';

  return (
    <TourRun
      key={run}
      tourKey={active}
      nextKey={nextKey}
      via={via}
      stops={stops}
      nextStopCount={nextStopCount}
      firstName={firstName}
      setMenuOpen={setMenuOpen}
    />
  );
}
