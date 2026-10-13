import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Maximize2,
  Minus,
  Plus,
  ShieldAlert,
  Store,
  X,
} from 'lucide-react';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { reimbursementApi } from '../../services/reimbursementApi';

export const MIN_REASON_CHARS = 20;
const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2];

function money(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const exceptionKey = (expense) => `${expense.exception_type}::${expense.category_name}`;

const EXCEPTION_COPY = {
  TRAIN_TATKAL: ['Tatkal Train Ticket Exception', 'Tatkal train bookings need explicit justification and approval.'],
  AIR_TRAVEL_L5_L6: ['Restricted Air Class Exception', 'Air travel at your level is conditional and needs exception approval.'],
  HIRED_TAXI_UNAUTHORIZED: [
    'Unauthorized Local Hired Taxi Exception',
    'Hired taxi claims at your level need approval as local conveyance exceptions.',
  ],
  ROOM_RENT_DEVIATION: ['Room Rent Limit Deviation', 'Hotel room rent exceeds the policy cap for your destination city group.'],
  FOOD_DEVIATION: ['Food & Meals Limit Deviation', 'Food & Meals spend exceeds the policy cap for your level/city.'],
  INCIDENTAL_DEVIATION: ['Incidental Expenses Limit Deviation', 'Incidental expenses exceed the policy cap for your level/city.'],
  DAY_VISIT_EXTERNAL_MEETING: ['Day Visit Limit Deviation', 'Day visit spend exceeds the policy cap for your level/city.'],
};

function exceptionCopy(type) {
  return EXCEPTION_COPY[type] || ['Policy Exception', 'This expense is outside company policy and needs approval.'];
}

/*
 * Invoice files for the modal, fetched once per invoice and shared by the side pane and the
 * full-size viewer. Object URLs are revoked when the modal unmounts.
 */
function useInvoiceFiles() {
  const cache = useRef(new Map());
  const [, force] = useState(0);

  useEffect(() => {
    const entries = cache.current;
    return () => {
      entries.forEach((entry) => entry.url && URL.revokeObjectURL(entry.url));
      entries.clear();
    };
  }, []);

  return useCallback((invoiceId) => {
    if (!invoiceId) return null;
    const hit = cache.current.get(invoiceId);
    if (hit) return hit;
    const entry = { status: 'loading', url: '', type: '' };
    cache.current.set(invoiceId, entry);
    reimbursementApi
      .invoiceFileBlob(invoiceId)
      .then((res) => {
        entry.type = res.headers['content-type'] || 'application/octet-stream';
        entry.url = URL.createObjectURL(new Blob([res.data], { type: entry.type }));
        entry.status = 'ready';
      })
      .catch(() => {
        entry.status = 'error';
      })
      .finally(() => force((n) => n + 1));
    return entry;
  }, []);
}

function isPdf(file, invoice) {
  return (file?.type || '').includes('pdf') || (invoice?.original_filename || '').toLowerCase().endsWith('.pdf');
}

function InvoiceFile({ file, invoice, fit }) {
  if (!file || file.status === 'loading') {
    return <div className="flex h-full items-center justify-center p-4 text-[11px] font-medium text-slate-400">Loading preview...</div>;
  }
  if (file.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[11px] font-medium text-slate-400">
        Could not load invoice preview.
      </div>
    );
  }
  if (isPdf(file, invoice)) {
    return (
      <iframe
        title={`Invoice ${invoice.vendor_name || invoice.original_filename || ''}`}
        src={`${file.url}#toolbar=${fit ? 0 : 1}&navpanes=0&view=FitH`}
        className="h-full w-full border-0"
      />
    );
  }
  return <img src={file.url} alt={invoice.original_filename || 'Invoice'} className="h-full w-full object-contain" />;
}

function FlaggedLines({ invoice }) {
  const lines = invoice?.line_items || [];
  if (!lines.length) return null;
  return (
    <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
      <div className="text-[9px] font-bold uppercase tracking-wide text-amber-600">Flagged on this invoice</div>
      {lines.map((line, idx) => (
        <div key={idx} className="flex items-center justify-between gap-2 text-[11px] text-amber-900">
          <span className="truncate font-medium">{line.description}</span>
          <span className="shrink-0 font-bold">₹{money(line.amount)}</span>
        </div>
      ))}
    </div>
  );
}

/* Full-size invoice viewer, layered over the modal. Images zoom here; PDFs use the browser's own viewer controls. */
function InvoiceViewer({ expense, invoices, index, onIndex, getFile, onClose }) {
  const [zoom, setZoom] = useState(1);
  const closeRef = useRef(null);
  const invoice = invoices[index];
  const file = getFile(invoice?.invoice_id);
  const pdf = isPdf(file, invoice);
  const count = invoices.length;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    setZoom(1);
  }, [index]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (event.key === 'ArrowRight' && index < count - 1) onIndex(index + 1);
      else if (!pdf && (event.key === '+' || event.key === '=')) setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)]);
      else if (!pdf && event.key === '-') setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [count, index, onClose, onIndex, pdf]);

  const toolBtn =
    'inline-grid h-8 min-w-8 place-items-center rounded-lg border border-white/15 bg-white/10 px-2 text-xs font-bold text-slate-100 transition hover:bg-white/20 disabled:cursor-default disabled:opacity-35';

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-slate-900/95 backdrop-blur-sm" role="dialog" aria-label="Invoice preview">
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 text-slate-200">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-bold">{invoice?.vendor_name || invoice?.original_filename || 'Invoice'}</div>
          <div className="truncate text-[10.5px] font-semibold text-slate-400">
            {expense.category_name}
            {count > 1 ? ` · invoice ${index + 1} of ${count}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {!pdf && (
            <>
              <button type="button" className={toolBtn} aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}>
                <Minus size={14} />
              </button>
              <span className="min-w-[42px] text-center text-[11px] font-bold tabular-nums text-slate-300">{Math.round(zoom * 100)}%</span>
              <button type="button" className={toolBtn} aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}>
                <Plus size={14} />
              </button>
              <button type="button" className={toolBtn} onClick={() => setZoom(1)}>
                Fit
              </button>
            </>
          )}
          <button ref={closeRef} type="button" className={toolBtn} aria-label="Close preview" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>
      {/* Arrows live outside the scroll area so they stay put (and on top) while zoomed in. */}
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-auto px-4 pb-5 pt-1">
          {pdf ? (
            <div className="mx-auto h-full w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl">
              <InvoiceFile file={file} invoice={invoice} />
            </div>
          ) : (
            <div className="flex min-h-full justify-center">
              <div
                className="h-[min(78vh,900px)] w-full max-w-3xl origin-top rounded-lg bg-white shadow-2xl transition-transform duration-150"
                style={{ transform: `scale(${zoom})` }}
              >
                <InvoiceFile file={file} invoice={invoice} />
              </div>
            </div>
          )}
        </div>
        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous invoice"
              disabled={index === 0}
              onClick={() => onIndex(index - 1)}
              className={`${toolBtn} absolute left-3 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full bg-slate-800/90`}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              aria-label="Next invoice"
              disabled={index === count - 1}
              onClick={() => onIndex(index + 1)}
              className={`${toolBtn} absolute right-3 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full bg-slate-800/90`}
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/*
 * Opened by the wizard's final Submit when any expense is outside policy: one tab per flagged
 * expense, each with its invoices and its own reason. The claim and all its exception requests
 * are sent together once every tab has a reason — nothing is raised before that.
 */
export default function ClaimExceptionsModal({ open, expenses, onClose, onSubmit, submitting }) {
  const [reasons, setReasons] = useState({});
  const [activeKey, setActiveKey] = useState(null);
  const [invoiceIndex, setInvoiceIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const textareaRef = useRef(null);
  const getFile = useInvoiceFiles();
  useBodyScrollLock(open);

  const items = useMemo(() => expenses || [], [expenses]);
  const blocked = items.filter((expense) => expense.exception_mode === 'BLOCK');
  const isDone = (expense) =>
    expense.exception_mode !== 'BLOCK' && (reasons[exceptionKey(expense)] || '').trim().length >= MIN_REASON_CHARS;
  const doneCount = items.filter(isDone).length;
  const allowedCount = items.length - blocked.length;
  const canSubmit = !submitting && !blocked.length && doneCount === items.length;

  useEffect(() => {
    if (!open) return;
    // Land on the first tab that still needs something.
    const first = items.find((expense) => !isDone(expense)) || items[0];
    setActiveKey(first ? exceptionKey(first) : null);
    setInvoiceIndex(0);
    setViewerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !items.length) return null;

  const active = items.find((expense) => exceptionKey(expense) === activeKey) || items[0];
  const invoices = active.invoice_breakdown || [];
  const invoice = invoices[Math.min(invoiceIndex, Math.max(0, invoices.length - 1))];
  const activeBlocked = active.exception_mode === 'BLOCK';
  const reason = reasons[exceptionKey(active)] || '';
  const [title, description] = exceptionCopy(active.exception_type);
  const hasCap = active.cap_amount != null;
  const excess = Math.max(Number(active.amount || 0) - Number(active.cap_amount || 0), 0);
  const nextTodo = items.find((expense) => exceptionKey(expense) !== exceptionKey(active) && !isDone(expense) && expense.exception_mode !== 'BLOCK');

  const selectTab = (expense) => {
    setActiveKey(exceptionKey(expense));
    setInvoiceIndex(0);
  };

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(
      items.map((expense) => ({
        exception_type: expense.exception_type,
        category_name: expense.category_name,
        reason: (reasons[exceptionKey(expense)] || '').trim(),
      })),
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-exceptions-title"
        className="scale-up relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-500 ring-4 ring-amber-50/50">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 id="claim-exceptions-title" className="text-sm font-bold text-slate-900">
                {items.length} expense{items.length > 1 ? 's need' : ' needs'} an exception
              </h3>
              <p className="text-[11px] font-medium text-slate-500">
                {blocked.length
                  ? `Policy doesn't allow ${blocked.length > 1 ? 'some of these' : 'one of these'} to be submitted — see the red tab${blocked.length > 1 ? 's' : ''}.`
                  : "Give a reason for each one. They're sent together when you submit the claim."}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div role="tablist" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-slate-200 px-5 pt-2.5">
          {items.map((expense) => {
            const key = exceptionKey(expense);
            const selected = key === exceptionKey(active);
            const done = isDone(expense);
            const isBlockedTab = expense.exception_mode === 'BLOCK';
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectTab(expense)}
                className={`relative top-px flex shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 pb-2.5 pt-2 text-left transition ${
                  selected ? 'border-slate-200 bg-white' : 'border-transparent hover:bg-slate-50'
                }`}
              >
                <span
                  className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] font-extrabold ${
                    done
                      ? 'bg-emerald-600 text-white'
                      : isBlockedTab || expense.policy_status === 'HARD_BLOCK'
                        ? 'border border-rose-200 bg-rose-50 text-rose-700'
                        : 'border border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                >
                  {done ? <Check size={10} strokeWidth={4} /> : isBlockedTab ? <X size={10} strokeWidth={3.5} /> : '!'}
                </span>
                <span>
                  <span className={`block whitespace-nowrap text-xs font-bold ${selected ? 'text-brand' : 'text-slate-600'}`}>
                    {expense.category_name}
                  </span>
                  <span className="block text-[10.5px] font-semibold tabular-nums text-slate-400">₹{money(expense.amount)}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {invoices.length > 0 && invoice && (
            <div className="flex w-full shrink-0 flex-col gap-3 border-b border-slate-100 bg-slate-50/40 p-4 md:w-[52%] md:overflow-y-auto md:border-b-0 md:border-r">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <FileText size={12} />
                  <span>Invoice{invoices.length > 1 ? 's' : ''} for this expense</span>
                </div>
                <button
                  type="button"
                  onClick={() => setViewerOpen(true)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-brand transition hover:bg-brand/5"
                >
                  <Maximize2 size={12} /> Open full preview
                </button>
              </div>
              {invoices.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {invoices.map((inv, idx) => (
                    <button
                      key={inv.invoice_id}
                      type="button"
                      onClick={() => setInvoiceIndex(idx)}
                      title={inv.vendor_name || inv.original_filename}
                      className={`max-w-[140px] truncate rounded-full px-2.5 py-1 text-[10px] font-bold transition-all ${
                        idx === invoiceIndex ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {inv.vendor_name || inv.original_filename}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setViewerOpen(true)}
                className="h-[340px] shrink-0 cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-white text-left"
                aria-label="Open full invoice preview"
              >
                <InvoiceFile file={getFile(invoice.invoice_id)} invoice={invoice} fit />
              </button>
              <div className="flex items-center gap-1.5 truncate text-[11px] font-bold text-slate-700">
                <Store size={12} className="shrink-0 text-slate-400" />
                <span className="truncate">{invoice.vendor_name || invoice.original_filename}</span>
              </div>
              <FlaggedLines invoice={invoice} />
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-3 p-5 md:overflow-y-auto">
            {activeBlocked ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 text-[12px] leading-snug text-rose-900">
                <div className="mb-1 flex items-center gap-1.5 font-bold">
                  <AlertCircle size={15} className="text-rose-600" /> Not allowed by policy
                </div>
                {title}: policy doesn&apos;t allow submitting this expense, even with an exception. Go back to the
                Evidence step and remove its invoice{invoices.length > 1 ? 's' : ''} to submit the rest of the claim.
              </div>
            ) : (
              <div
                className={`rounded-xl border p-3 text-[11.5px] leading-snug ${
                  active.policy_status === 'HARD_BLOCK'
                    ? 'border-rose-100 bg-rose-50/40 text-rose-900'
                    : 'border-amber-100 bg-amber-50/40 text-amber-900'
                }`}
              >
                <AlertTriangle size={14} className="mr-1.5 inline -translate-y-px text-amber-500" />
                <span className="font-bold">{title}: </span>
                {description}
              </div>
            )}

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
              <div className="grid grid-cols-2 gap-y-2 text-[11.5px] font-semibold text-slate-500">
                <div>Expense category</div>
                <div className="text-right font-bold text-slate-800">{active.category_name}</div>
                <div>Claimed amount</div>
                <div className="text-right font-bold tabular-nums text-slate-800">₹{money(active.amount)}</div>
              </div>
              {hasCap && (
                <div className="grid grid-cols-3 gap-2 border-t border-slate-200/70 pt-3 text-center">
                  <div className="rounded-lg bg-slate-100/60 p-2">
                    <div className="text-[10px] font-medium text-slate-500">Policy cap</div>
                    <div className="text-xs font-bold tabular-nums text-slate-700">₹{money(active.cap_amount)}</div>
                  </div>
                  <div className="col-span-2 rounded-lg border border-rose-100 bg-rose-50/30 p-2 text-rose-700">
                    <div className="text-[10px] font-bold text-rose-500">Excess deviation</div>
                    <div className="text-xs font-bold tabular-nums">₹{money(excess)}</div>
                  </div>
                </div>
              )}
            </div>

            {!activeBlocked && (
              <div className="space-y-1.5">
                <label htmlFor="claim-exception-reason" className="block text-xs font-bold text-slate-700">
                  Reason for exception <span className="font-normal text-slate-400">(minimum {MIN_REASON_CHARS} characters)</span>
                </label>
                <div className="relative">
                  <textarea
                    id="claim-exception-reason"
                    ref={textareaRef}
                    className="min-h-[110px] w-full resize-none rounded-xl border border-slate-200 bg-slate-50/30 p-2.5 pb-6 text-[12px] font-medium leading-relaxed text-slate-800 placeholder-slate-400 transition-all duration-200 focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand/10"
                    placeholder="Describe why this deviation was necessary (e.g. client emergency, standard option unavailable)…"
                    value={reason}
                    maxLength={2000}
                    onChange={(e) => setReasons((prev) => ({ ...prev, [exceptionKey(active)]: e.target.value }))}
                  />
                  <div
                    className={`absolute bottom-3 right-3 text-[9.5px] font-bold ${
                      reason.trim().length >= MIN_REASON_CHARS ? 'text-emerald-600' : 'text-slate-400'
                    }`}
                  >
                    {reason.trim().length} / {MIN_REASON_CHARS}+ chars
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
              <span className="font-bold text-slate-600">What happens next: </span>
              each exception goes to its own approvers, and they decide the whole claim — it doesn't also go
              through the normal approvers. Once every exception is approved, the claim goes to Finance for payment; if
              any exception is rejected, the whole claim is rejected.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <div className="flex items-center gap-2.5 text-[11.5px] font-bold text-slate-500">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${allowedCount ? (doneCount / allowedCount) * 100 : 0}%` }}
              />
            </div>
            <span>
              {doneCount} of {allowedCount} reason{allowedCount === 1 ? '' : 's'} added
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-800"
            >
              Cancel
            </button>
            {nextTodo && (
              <button
                type="button"
                onClick={() => {
                  selectTab(nextTodo);
                  setTimeout(() => textareaRef.current?.focus(), 0);
                }}
                className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-50"
              >
                Next exception <ChevronRight size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-brand px-5 text-xs font-bold text-white shadow-md transition-all hover:bg-brand/90 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
            >
              {submitting
                ? 'Submitting...'
                : `Submit claim & ${items.length} exception${items.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>

        {viewerOpen && invoices.length > 0 && (
          <InvoiceViewer
            expense={active}
            invoices={invoices}
            index={Math.min(invoiceIndex, invoices.length - 1)}
            onIndex={setInvoiceIndex}
            getFile={getFile}
            onClose={() => setViewerOpen(false)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
