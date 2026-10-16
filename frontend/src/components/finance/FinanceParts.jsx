import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import useBodyScrollLock from '../../hooks/useBodyScrollLock';

export const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const rupees = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
export const day = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dayTime = (v) =>
  v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const errorText = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return (typeof detail === 'string' && detail) || fallback;
};

/** A label on the left, a figure on the right. `minus` shows it as a deduction. */
export function Figure({ label, children, minus = false, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 text-[12.5px]">
      <span className={strong ? 'font-bold text-ink' : 'text-slate-500'}>{label}</span>
      <b className={`break-all text-right font-mono font-semibold tabular-nums ${minus ? 'text-amber-700' : 'text-ink'}`}>
        {minus ? '− ' : ''}
        {children}
      </b>
    </div>
  );
}

/** The green "what's actually paid" line at the end of a payment breakdown. */
export function PaidTotal({ label, amount }) {
  return (
    <div className="mt-0.5 flex items-center justify-between gap-2.5 rounded-[10px] bg-brand/10 px-2.5 py-2">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.05em] text-brand">{label}</span>
      <b className="font-mono text-[15px] tabular-nums text-brand">{money(amount)}</b>
    </div>
  );
}

/** One titled box inside an opened row. */
export function DetailBox({ title, children }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <h3 className="mb-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="px-4 py-9 text-center text-[13px] text-slate-500">
      <b className="mb-1 block text-sm text-ink">{title}</b>
      {children}
    </div>
  );
}

/** A centred window over the page; closes on Esc or a click outside unless `busy`. */
export function Modal({ title, sub, onClose, busy = false, children, footer, label }) {
  useBodyScrollLock(true);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/45 p-4" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label || title}
        className="flex max-h-[calc(100vh-32px)] w-full max-w-[440px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2.5 border-b border-slate-100 px-4 py-[13px]">
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-ink">{title}</h2>
            {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
          </div>
          <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50">
            <X size={14} />
          </button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3.5">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
