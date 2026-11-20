import { Camera, FileText, Search, UploadCloud } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { showToast } from '../../store/toastStore';
import { billDate, billMatches, billName } from '../../utils/bills';
import { Card, Note, StepActions, foreignAmount, inr } from './ClaimWizardShell';
import { BILL_ACCEPT } from './useBillUploads';

// The same review as the invoice's own page, opened over the claim so a bill can be checked
// without leaving the form. Loaded only when it's first opened (it brings the PDF viewer).
const InvoiceReviewBody = lazy(() => import('../../pages/InvoiceReview').then((m) => ({ default: m.InvoiceReviewBody })));

const NOT_REVIEWED_TEXT = {
  READY_FOR_REVIEW: 'Needs your review',
  ERROR: 'Couldn’t read it · fill in the details',
  PROCESSING: 'Still being read',
};

// Phones and tablets get a "Take a photo" button that opens the camera.
const isTouchDevice = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);

/** What the review window says above a bill that's part of a run (just uploaded, or ticked). */
function introFor(run) {
  const n = run.queue.length;
  const at = run.at + 1;
  if (run.kind === 'uploaded') {
    return n > 1
      ? `You just uploaded ${n} bills. This is ${at} of ${n}: check what we read and save it.`
      : 'Your bill is in. Check what we read and save it to put it on the claim.';
  }
  if (run.kind === 'ticked') {
    return n > 1 ? `${n} ticked bills still need your review. This is ${at} of ${n}.` : 'Review this bill to put it on the claim.';
  }
  return '';
}

/** The review, over the claim form. Saving hands the invoice back; closing keeps nothing. */
function InvoiceReviewModal({ invoiceId, intro, onClose, onSaved }) {
  useBodyScrollLock(true);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Above the top bar (z-50), below toasts (z-60) so "Review saved" still shows. Keyed by the
  // bill, so moving to the next bill in a run starts fresh at the top.
  return createPortal(
    <div className="fixed inset-0 z-[55] bg-slate-900/55 p-2 backdrop-blur-[2px] sm:p-5" role="dialog" aria-modal="true" aria-label="Review the bill">
      <div key={invoiceId} className="animate-sheet-up mx-auto h-full max-w-[1320px] overflow-y-auto rounded-2xl bg-[#f8f9fb] p-3 shadow-2xl sm:p-4">
        <Suspense
          fallback={
            <div className="flex h-64 flex-col items-center justify-center gap-2">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand" />
              <p className="text-sm font-medium text-slate-600">Opening the bill…</p>
            </div>
          }
        >
          <InvoiceReviewBody invoiceId={invoiceId} embedded intro={intro} onClose={onClose} onSaved={onSaved} />
        </Suspense>
      </div>
    </div>,
    document.body,
  );
}

/** The bill being uploaded: a progress bar while it travels, then a scan while it's read. */
function UploadingRow({ upload }) {
  const reading = upload.pct == null || upload.pct >= 100;
  const of = upload.count > 1 ? ` ${upload.index + 1} of ${upload.count}` : '';
  return (
    <div role="status" aria-live="polite" className="relative overflow-hidden rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2.5">
      <div className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-3">
        <span className="relative grid h-[38px] w-[30px] place-items-center overflow-hidden rounded-[5px] border border-sky-200 bg-white text-sky-600">
          <FileText size={16} />
          {reading ? (
            <i className="animate-scan absolute inset-x-0 h-[2px] bg-sky-500 shadow-[0_0_6px_rgba(14,165,233,.8)] motion-reduce:hidden" />
          ) : null}
        </span>
        <div className="min-w-0">
          <b className="block truncate text-[13px] text-ink">{upload.name || 'Your bill'}</b>
          <span className="block truncate text-xs font-bold text-sky-700">
            {reading ? `Reading bill${of}: amount, GST and vendor. This takes a few seconds…` : `Uploading bill${of}… ${upload.pct}%`}
          </span>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-sky-100">
        {reading ? (
          <i className="animate-shimmer block h-full w-full bg-gradient-to-r from-transparent via-sky-500 to-transparent motion-reduce:animate-none motion-reduce:bg-sky-400" />
        ) : (
          <i className="block h-full bg-sky-500 transition-[width] duration-200" style={{ width: `${upload.pct}%` }} />
        )}
      </div>
    </div>
  );
}

export default function ClaimWizardStepEvidence({
  invoices,
  selectedInvoiceIds,
  onToggleInvoice,
  // (files) => Promise<invoices uploaded> — see useBillUploads.
  onUploadFiles,
  // Called with the invoice as saved when it's reviewed here (status, amount may have changed).
  onInvoiceReviewed,
  sentBackHint,
  onBack,
  onNext,
  busy = false,
  // null, or { name, pct, index, count } while bills upload (pct null/100 once it's being read).
  uploading = null,
  title = 'Which bills are you claiming?',
  description = "Tick the invoices for this claim, or upload new ones. Invoices already on another claim don't show here.",
  nextLabel = 'Next: Policy check',
}) {
  const [query, setQuery] = useState('');
  // The bills being reviewed, one after another: { queue: [invoice ids], at, kind }.
  const [run, setRun] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const mounted = useRef(true);
  const [touch] = useState(isTouchDevice);
  const upload = uploading || null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const shown = invoices.filter((invoice) => billMatches(invoice, query));
  const selected = invoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id));
  const selectedTotal = selected.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);
  const allShownSelected = shown.length > 0 && shown.every((invoice) => selectedInvoiceIds.includes(invoice.id));
  // A claim only takes reviewed bills (the server refuses the rest), so ticked ones still
  // needing review are reviewed here before moving on.
  const notReviewed = selected.filter((invoice) => invoice.status !== 'REVIEWED');

  const toggleAllShown = () => {
    shown.forEach((invoice) => {
      const isOn = selectedInvoiceIds.includes(invoice.id);
      if (allShownSelected ? isOn : !isOn) onToggleInvoice(invoice.id, !allShownSelected);
    });
  };

  const startRun = (ids, kind) => {
    if (ids.length) setRun({ queue: ids, at: 0, kind });
  };

  const reviewTicked = () => startRun(notReviewed.map((invoice) => invoice.id), 'ticked');

  // Uploaded bills open for review straight away, one after another — unless a review is
  // already open (left alone) or the step was left while they uploaded.
  const handleFiles = async (files) => {
    if (!files?.length) return;
    if (upload) {
      showToast('Wait for the bills already uploading to finish', 'info');
      return;
    }
    const rows = await onUploadFiles(files);
    if (!mounted.current) return;
    const ids = (rows || []).filter((row) => row.status !== 'REVIEWED').map((row) => row.id);
    if (ids.length) setRun((current) => current || { queue: ids, at: 0, kind: 'uploaded' });
  };

  const onPicked = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // so the same file can be picked again later
    handleFiles(files);
  };

  const next = () => {
    if (upload) return;
    if (notReviewed.length) {
      reviewTicked();
      return;
    }
    onNext();
  };

  const onSaved = (invoice) => {
    if (invoice?.id) onInvoiceReviewed?.(invoice);
    setRun((current) => (current && current.at + 1 < current.queue.length ? { ...current, at: current.at + 1 } : null));
  };

  // Drag-and-drop anywhere on the card.
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const dropProps = {
    onDragOver: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (!dragging) setDragging(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
    },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      handleFiles(Array.from(e.dataTransfer.files || []));
    },
  };

  const actionBtn =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';

  return (
    <>
      <input ref={fileInput} type="file" multiple accept={BILL_ACCEPT} className="hidden" onChange={onPicked} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPicked} />

      <div className="relative" {...dropProps}>
        <Card
          title={title}
          sub={description}
          action={
            <div className="flex flex-wrap gap-1.5">
              {touch ? (
                <button type="button" disabled={Boolean(upload)} className={actionBtn} onClick={() => cameraInput.current?.click()}>
                  <Camera size={14} /> Take a photo
                </button>
              ) : null}
              <button type="button" disabled={Boolean(upload)} className={actionBtn} onClick={() => fileInput.current?.click()}>
                <UploadCloud size={14} /> {upload ? 'Uploading…' : touch ? 'Upload' : 'Upload bills'}
              </button>
            </div>
          }
        >
          {sentBackHint ? <Note tone="rose">{sentBackHint}</Note> : null}
          {notReviewed.length ? (
            <Note tone="amber">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {notReviewed.length === 1
                    ? 'A ticked bill still needs your review before it can go on the claim.'
                    : `${notReviewed.length} ticked bills still need your review before they can go on the claim.`}
                </span>
                <button
                  type="button"
                  onClick={reviewTicked}
                  className="inline-flex h-7 items-center rounded-lg border border-amber-300 bg-white px-2.5 text-[11.5px] font-bold text-amber-800 hover:bg-amber-50"
                >
                  Review now
                </button>
              </div>
            </Note>
          ) : null}

          {!invoices.length && !upload ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="group w-full rounded-xl border-2 border-dashed border-slate-200 py-10 text-center hover:border-brand/40 hover:bg-slate-50/50"
            >
              <UploadCloud className="mx-auto text-slate-400 group-hover:text-brand" size={30} />
              <p className="mt-2 text-[13px] font-bold text-slate-700">No invoices to add yet</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {touch ? 'Upload a PDF or a photo of the bill' : 'Drop bills here, or click to choose: PDF, JPG, PNG or HEIC, up to 10 MB each'}
              </p>
            </button>
          ) : (
            <>
              {invoices.length ? (
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <label className="relative min-w-[200px] flex-1">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      aria-label="Search invoices"
                      className="h-[34px] w-full rounded-[10px] border border-slate-200 bg-white pl-8 pr-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                      placeholder="Search by vendor, amount or file name"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <div className="flex items-center gap-3 text-[12.5px] text-slate-500">
                    <button type="button" onClick={toggleAllShown} className="font-bold text-brand hover:text-brand/80">
                      {allShownSelected ? 'Clear all' : 'Select all'}
                    </button>
                    <span>
                      {selected.length} ticked · <b className="font-mono tabular-nums text-ink">{inr(selectedTotal)}</b>
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="space-y-1.5">
                {upload ? <UploadingRow upload={upload} /> : null}
                {shown.map((invoice) => {
                  const isOn = selectedInvoiceIds.includes(invoice.id);
                  const reviewed = invoice.status === 'REVIEWED';
                  const foreign = foreignAmount(invoice);
                  const date = billDate(invoice);
                  // A button inside the row's label: stop the click from also ticking the box.
                  const review = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startRun([invoice.id], 'single');
                  };
                  return (
                    <label
                      key={invoice.id}
                      className={`grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2.5 ${
                        isOn ? (reviewed ? 'border-brand bg-brand/[0.04]' : 'border-amber-300 bg-amber-50/40') : 'border-slate-200 hover:bg-slate-50/70'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand"
                        checked={isOn}
                        onChange={(e) => onToggleInvoice(invoice.id, e.target.checked)}
                      />
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-baseline gap-1.5">
                          <b className="truncate text-[13px] text-ink" title={invoice.original_filename}>
                            {billName(invoice)}
                          </b>
                          {date ? <span className="shrink-0 text-xs font-semibold text-slate-500">{date}</span> : null}
                        </div>
                        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          {reviewed ? (
                            <span className="text-slate-500">
                              Reviewed · ready to claim ·{' '}
                              <button type="button" onClick={review} className="font-bold text-brand hover:underline">
                                View
                              </button>
                            </span>
                          ) : (
                            <>
                              <span className="font-bold text-amber-700">{NOT_REVIEWED_TEXT[invoice.status] || 'Needs your review'}</span>
                              <button
                                type="button"
                                onClick={review}
                                className="inline-flex h-6 items-center rounded-md border border-amber-300 bg-white px-2 text-[11px] font-bold text-amber-800 hover:bg-amber-50"
                              >
                                Review now
                              </button>
                            </>
                          )}
                          {invoice.vendor_name ? <span className="min-w-0 truncate text-[11px] text-slate-400">{invoice.original_filename}</span> : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[13px] font-semibold tabular-nums text-ink">{inr(invoice.total_amount)}</div>
                        {foreign ? <div className="text-[11px] font-semibold text-slate-500">from {foreign}</div> : null}
                      </div>
                    </label>
                  );
                })}
                {invoices.length > 0 && !shown.length ? <p className="py-4 text-center text-[12.5px] text-slate-500">No invoice matches “{query}”.</p> : null}
              </div>
            </>
          )}
        </Card>

        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[14px] border-2 border-dashed border-brand bg-white/85">
            <div className="text-center">
              <UploadCloud className="mx-auto text-brand" size={30} />
              <p className="mt-1.5 text-[13px] font-extrabold text-ink">{upload ? 'Wait for the current upload to finish' : 'Drop to upload'}</p>
              <p className="text-xs text-slate-500">PDF, JPG, PNG or HEIC, up to 10 MB each</p>
            </div>
          </div>
        ) : null}
      </div>

      <StepActions
        onBack={onBack}
        onNext={next}
        nextLabel={nextLabel}
        busy={busy || Boolean(upload)}
        busyLabel={upload ? 'Wait, the bill is uploading…' : 'Saving…'}
        title={upload ? 'Wait for the bill to finish uploading' : undefined}
      />

      {run ? (
        <InvoiceReviewModal invoiceId={run.queue[run.at]} intro={introFor(run)} onClose={() => setRun(null)} onSaved={onSaved} />
      ) : null}
    </>
  );
}
