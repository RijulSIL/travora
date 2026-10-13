import { Check, CheckCircle2, Inbox } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { INBOX_CENTER, SHEET, STAGE_H, STAGE_W, T, drawPaper, flightPathD, lin, seg } from './paperPlaneFold';

const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr = { format: (n) => (Number.isInteger(Math.round(n * 100) / 100) ? inrWhole : inrPaise).format(n) };
const MAX_ROWS = 3;

/* Timeline (ms) for everything around the paper */
const BACKDROP_IN = [0, 250];
const FADE_OUT = [4200, T.total];
const PATH_IN = [2650, 2780];
const PATH_OUT = [3500, 3700];
const INBOX_PULSE = [3520, 3760];
const TICK_IN = [3560, 3720];
const CARD_IN = [3650, 3900];

function summarise(claim) {
  const lines = (claim?.expenses || [])
    .map((e) => ({ label: e.category_name || 'Expense', amount: Number(e.amount) || 0 }))
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const total = lines.reduce((sum, e) => sum + e.amount, 0);
  const shown = lines.length > MAX_ROWS ? lines.slice(0, MAX_ROWS - 1) : lines;
  return {
    reference: claim?.claim_reference || (claim?.id ? `CLM-${claim.id}` : ''),
    rows: shown,
    more: lines.length - shown.length,
    total,
  };
}

/*
 * Claim submitted: the claim slip folds into a paper plane (one continuous sheet) and flies
 * into the approver's inbox, then a confirmation card shows the claimed total.
 * `claim` is the submitted claim as returned by POST /claims/{id}/submit.
 */
export default function ClaimSubmitAnimation({ claim, onComplete }) {
  const summary = useMemo(() => summarise(claim), [claim]);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const backdropRef = useRef(null);
  const slipRef = useRef(null);
  const groundRef = useRef(null);
  const pathRef = useRef(null);
  const inboxRef = useRef(null);
  const tickRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let finished = false;

    const fit = () => {
      const scale = Math.min(1.35, (window.innerWidth - 32) / STAGE_W);
      const dpr = Math.min(3, window.devicePixelRatio || 1) * scale;
      stageRef.current.style.transform = `scale(${scale})`;
      canvas.width = Math.round(STAGE_W * dpr);
      canvas.height = Math.round(STAGE_H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    window.addEventListener('resize', fit);

    const frame = (t) => {
      const out = 1 - lin(t, FADE_OUT);
      drawPaper(ctx, t);
      backdropRef.current.style.opacity = String(lin(t, BACKDROP_IN) * out);

      const slip = slipRef.current.style;
      slip.opacity = String(lin(t, [0, 180]) * (1 - lin(t, T.slipFade)));
      slip.transform = `translateY(${16 * (1 - seg(t, T.arrive))}px)`;

      const kHalf = seg(t, T.half);
      const ground = groundRef.current.style;
      ground.opacity = String(lin(t, [0, 250]) * (1 - lin(t, [2400, 2900])));
      ground.transform = `translateX(${-12 * kHalf + 30 * lin(t, [2400, 2900])}px) scaleX(${1 - 0.38 * kHalf - 0.2 * lin(t, [2400, 2900])})`;

      pathRef.current.style.opacity = String(lin(t, PATH_IN) * (1 - lin(t, PATH_OUT)));

      const pulse = t < INBOX_PULSE[0] || t > INBOX_PULSE[1] ? 0 : Math.sin(Math.PI * lin(t, INBOX_PULSE));
      inboxRef.current.style.opacity = String(lin(t, [0, 250]) * out);
      inboxRef.current.style.transform = `scale(${0.8 + 0.2 * seg(t, [0, 250]) + 0.18 * pulse})`;

      tickRef.current.style.opacity = String(lin(t, TICK_IN) * out);
      tickRef.current.style.transform = `scale(${seg(t, TICK_IN)})`;

      const kCard = seg(t, CARD_IN);
      cardRef.current.style.opacity = String(lin(t, CARD_IN) * out);
      cardRef.current.style.transform = `translate(-50%, ${12 * (1 - kCard)}px) scale(${0.92 + 0.08 * kCard})`;
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      onCompleteRef.current?.();
    };

    let timer = 0;
    if (reduce) {
      frame(CARD_IN[1]);
      timer = window.setTimeout(finish, 1600);
    } else {
      const start = performance.now();
      const loop = (now) => {
        const t = Math.min(T.total, now - start);
        frame(t);
        if (t >= T.total) finish();
        else raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener('resize', fit);
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center overflow-hidden" role="status" aria-live="polite">
      <div ref={backdropRef} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" style={{ opacity: 0 }} />
      <span className="sr-only">Claim submitted{summary.total ? ` for ${inr.format(summary.total)}` : ''}.</span>

      <div ref={stageRef} className="relative shrink-0" style={{ width: STAGE_W, height: STAGE_H }} aria-hidden="true">
        <div
          ref={groundRef}
          className="absolute rounded-[50%]"
          style={{
            left: 164, top: 214, width: 110, height: 18, opacity: 0,
            background: 'radial-gradient(closest-side, rgba(15,25,22,0.32), transparent)',
          }}
        />
        <svg ref={pathRef} className="absolute inset-0 overflow-visible" width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ opacity: 0 }}>
          <path d={flightPathD} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round" />
        </svg>
        <div
          ref={inboxRef}
          className="absolute grid place-items-center rounded-xl bg-white text-[#0F6B52] shadow-[0_8px_18px_rgba(0,0,0,0.18)]"
          style={{ left: INBOX_CENTER[0] - 22, top: INBOX_CENTER[1] - 22, width: 44, height: 44, opacity: 0 }}
        >
          <Inbox size={22} strokeWidth={2} />
        </div>
        <div
          ref={tickRef}
          className="absolute grid place-items-center rounded-full bg-[#0F6B52] text-white"
          style={{ left: INBOX_CENTER[0] + 8, top: INBOX_CENTER[1] - 32, width: 18, height: 18, opacity: 0 }}
        >
          <Check size={11} strokeWidth={3.4} />
        </div>

        <canvas ref={canvasRef} className="absolute inset-0" style={{ width: STAGE_W, height: STAGE_H }} />

        {/* Printed side of the slip, laid exactly over the flat sheet; it fades before the first fold */}
        <div
          ref={slipRef}
          className="absolute box-border flex flex-col gap-1.5 px-[11px] py-2.5 text-[8px] leading-tight text-slate-500"
          style={{ left: SHEET.left, top: SHEET.top, width: SHEET.width, height: SHEET.height, opacity: 0 }}
        >
          <div className="truncate font-extrabold tracking-[0.04em] text-[#0F6B52]">{summary.reference || 'CLAIM'}</div>
          <div className="border-t border-dashed border-slate-200" />
          {summary.rows.map((row, i) => (
            <div key={`${row.label}-${i}`} className="flex justify-between gap-1.5">
              <span className="min-w-0 truncate">{row.label}</span>
              <span className="shrink-0 tabular-nums">{inr.format(row.amount)}</span>
            </div>
          ))}
          {summary.more > 0 && <div>+{summary.more} more</div>}
          <div className="h-[5px] w-[70%] rounded-[3px] bg-slate-100" />
          <div className="mt-auto flex justify-between gap-1 text-[10px] font-extrabold text-slate-800">
            <span>Total</span>
            <span className="tabular-nums">{inr.format(summary.total)}</span>
          </div>
        </div>

        <div
          ref={cardRef}
          className="absolute left-1/2 flex min-w-[230px] max-w-[320px] items-center gap-3 rounded-2xl bg-white p-4 shadow-[0_16px_34px_rgba(0,0,0,0.18)]"
          style={{ top: 104, opacity: 0 }}
        >
          <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-bold text-[#0F6B52]">Claim Submitted</h3>
            <p className="mt-0.5 text-[11px] leading-snug text-[#2E8B74]">
              {inr.format(summary.total)} landed with your approver.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
