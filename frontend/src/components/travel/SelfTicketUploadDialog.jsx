import { AlertTriangle, Check, Eye, FileText, Info, Loader2, RefreshCw, Sparkles, Ticket, UploadCloud, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { reimbursementApi } from '../../services/reimbursementApi';
import { showToast } from '../../store/toastStore';
import { formatWeekdayDate } from '../../utils/formatters';
import { LABEL, MODE_ICON } from './TravelRequestFormParts';
import { fillFromRead, plainAmount, providerLabel, selfTicketError, selfTicketsPayload } from './selfTickets';
import { MODE_NAME } from './travelRequestView';

/*
 * An approved trip the employee booked themselves: they attach the ticket for every leg. Each one
 * is read as it's attached (booking reference, who it's with, fare); they check every field
 * against the ticket and submit them together, which books the trip. Ticking "Submit these fares
 * for reimbursement" also creates and submits a travel claim with the tickets (the server keeps it
 * as a draft if it can't go through as it is).
 */

const EMPTY = { ref: '', filename: '', file: null, pnr: '', provider: '', amount: '' };
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic';

/** A ticket field. One filled in from the ticket (and not changed since) is tinted, with a sparkle. */
function TicketField({ id, label, value, onChange, auto, prefix, inputClassName = '', ...rest }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL}>
        {label}
        {auto ? <span className="sr-only"> (filled in from your ticket)</span> : null}
      </label>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[13px] font-semibold text-slate-400">{prefix}</span>
        ) : null}
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={[
            'h-[38px] w-full rounded-[10px] border text-[13px] text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15',
            auto ? 'border-violet-200 bg-violet-50/60' : 'border-slate-200 bg-white',
            prefix ? 'pl-7' : 'pl-[11px]',
            auto ? 'pr-8' : 'pr-[11px]',
            inputClassName,
          ].join(' ')}
          {...rest}
        />
        {auto ? (
          <span title="Filled in from your ticket" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-violet-500">
            <Sparkles size={13} aria-hidden />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Where a leg stands, top right of its card. */
function LegStatus({ ticket, read, uploading, className = '' }) {
  const [tone, Icon, text] = uploading
    ? ['bg-violet-50 text-violet-700', Loader2, 'Reading']
    : !ticket.ref
      ? ['bg-slate-100 text-slate-500', null, 'To attach']
      : read?.status === 'done' && read.mismatch
        ? ['bg-amber-50 text-amber-700', AlertTriangle, 'Check the route']
        : selfTicketError(ticket)
          ? ['bg-amber-50 text-amber-700', null, 'Details missing']
          : ['bg-emerald-50 text-emerald-700', Check, 'Ready'];
  return (
    <span className={`flex-none items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${tone} ${className}`}>
      {Icon ? <Icon size={12} className={uploading ? 'animate-spin' : ''} /> : null}
      {text}
    </span>
  );
}

export default function SelfTicketUploadDialog({ request, onClose, onSubmitted }) {
  useBodyScrollLock(true);
  const segments = request.segments || [];
  const [tickets, setTickets] = useState({});
  // What reading each leg's ticket found: { status: 'done', values, filled, mismatch } or
  // { status: 'failed', message }.
  const [reads, setReads] = useState({});
  const [uploadingSeq, setUploadingSeq] = useState(null);
  const [dragSeq, setDragSeq] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;
  const readsRef = useRef(reads);
  readsRef.current = reads;
  const busy = uploadingSeq !== null || submitting;
  const readyCount = segments.filter((s) => !selfTicketError(tickets[s.seq])).length;
  // "Submit the fares for reimbursement": a travel claim is made with these tickets and sent for approval.
  const [claimFares, setClaimFares] = useState(false);
  const fareTotal = segments.reduce((sum, s) => {
    const n = Number(plainAmount(tickets[s.seq]?.amount));
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const setField = (seq, field, value) =>
    setTickets((prev) => ({ ...prev, [seq]: { ...EMPTY, ...prev[seq], [field]: value } }));

  const attach = async (seq, file) => {
    if (busy) return;
    if (file.size > MAX_BYTES) {
      showToast('The ticket file can be up to 10 MB', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('leg_sequence', String(seq));
    setUploadingSeq(seq);
    try {
      const { data } = await reimbursementApi.uploadSelfTicket(request.id, fd);
      // Merged into what the leg holds now: it may have been typed in while the ticket was read.
      const current = { ...EMPTY, ...ticketsRef.current[seq] };
      const before = readsRef.current[seq];
      const { fields, filled } = fillFromRead(current, before?.status === 'done' ? before.values : null, data.read);
      setTickets((prev) => ({ ...prev, [seq]: { ...fields, ref: data.ref, filename: data.filename, file } }));
      setReads((prev) => ({
        ...prev,
        [seq]: data.read
          ? { status: 'done', values: data.read, filled, mismatch: data.read.mismatch }
          : { status: 'failed', message: data.read_error || 'Couldn’t read this ticket. Type the details in.' },
      }));
    } catch (err) {
      const detail = err?.response?.data?.detail;
      showToast(typeof detail === 'string' ? detail : 'Could not upload the ticket', 'error');
    } finally {
      setUploadingSeq(null);
    }
  };

  const pickFile = (seq) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) attach(seq, file);
    };
    input.click();
  };

  const dropProps = (seq) => ({
    onDragOver: (e) => {
      e.preventDefault();
      if (!busy) setDragSeq(seq);
    },
    onDragLeave: () => setDragSeq((cur) => (cur === seq ? null : cur)),
    onDrop: (e) => {
      e.preventDefault();
      setDragSeq(null);
      const file = e.dataTransfer?.files?.[0];
      if (file) attach(seq, file);
    },
  });

  const viewFile = (file) => {
    const url = URL.createObjectURL(file);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const submit = async () => {
    if (busy) return;
    if (segments.some((s) => selfTicketError(tickets[s.seq]))) {
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await reimbursementApi.submitSelfTickets(request.id, selfTicketsPayload(segments, tickets), claimFares);
      const claim = data?.claim;
      if (!claim) showToast('Tickets submitted. Your trip is booked.', 'success');
      else if (claim.status === 'submitted') showToast(`Tickets submitted. ${claim.message}`, 'success');
      else if (claim.status === 'draft') showToast(`Tickets submitted. The claim was saved as a draft: ${claim.message}`, 'info');
      else showToast(`Tickets submitted. ${claim.message}`, 'info');
      onSubmitted?.(data?.request ?? data);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      showToast(typeof detail === 'string' ? detail : 'Could not submit the tickets', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const fromTicket = (seq, field) => {
    const read = reads[seq];
    return read?.status === 'done' && read.filled.includes(field) && tickets[seq]?.[field] === read.values[field];
  };

  const smallButton =
    'inline-flex h-7 flex-none items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';

  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="self-ticket-upload-title"
        className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 pb-4 pt-[18px] sm:px-[22px]">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Ticket size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="self-ticket-upload-title" className="text-[17px] font-extrabold leading-tight text-ink">
              Upload your tickets
            </h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
              Your trip is approved. Attach each ticket and we&apos;ll fill in the details for you to check. Submitting books the trip.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={submitting}
            className="-mr-1.5 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 px-4 py-4 sm:px-[22px]">
          {segments.map((seg, index) => {
            const t = { ...EMPTY, ...tickets[seg.seq] };
            const read = reads[seg.seq];
            const err = showErrors ? selfTicketError(t) : null;
            const mode = seg.mode || request.travel_mode;
            const Icon = MODE_ICON[mode] || Ticket;
            const id = `self-ticket-${seg.seq}`;
            const uploading = uploadingSeq === seg.seq;
            const dragging = dragSeq === seg.seq;
            const filledSome = read?.status === 'done' && read.filled.length > 0;
            return (
              <section
                key={seg.seq}
                aria-label={`${seg.from_city} to ${seg.to_city}`}
                className={`space-y-3 rounded-[14px] border bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4 ${
                  err ? 'border-rose-200' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-sky-50 text-sky-700">
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block break-words text-[13.5px] font-extrabold leading-snug text-ink">
                      {seg.from_city} → {seg.to_city}
                    </b>
                    {/* Each part wraps whole on a narrow screen, never mid-date. */}
                    <span className="mt-0.5 flex flex-wrap gap-x-1 text-[11.5px] text-slate-500">
                      {[MODE_NAME[mode] || mode, seg.travel_date ? formatWeekdayDate(seg.travel_date) : null, segments.length > 1 ? `Leg ${index + 1} of ${segments.length}` : null]
                        .filter(Boolean)
                        .map((part, i, all) => (
                          <span key={part} className="whitespace-nowrap">
                            {part}
                            {i < all.length - 1 ? ' ·' : ''}
                          </span>
                        ))}
                    </span>
                    {/* On a phone the status sits under the route, leaving the route and date the full width. */}
                    <LegStatus ticket={t} read={read} uploading={uploading} className="mt-1.5 inline-flex w-fit sm:hidden" />
                  </div>
                  <LegStatus ticket={t} read={read} uploading={uploading} className="hidden sm:inline-flex" />
                </div>

                {uploading ? (
                  <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50/60 px-3.5 py-3" role="status">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white text-violet-600">
                      <Loader2 size={17} className="animate-spin" />
                    </span>
                    <span className="min-w-0">
                      <b className="block text-[12.5px] text-ink">Reading your ticket…</b>
                      <span className="text-[11.5px] text-slate-500">Finding the booking reference, {providerLabel(mode).toLowerCase()} and fare</span>
                    </span>
                  </div>
                ) : t.ref ? (
                  <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 py-2 pl-2.5 pr-2" {...dropProps(seg.seq)}>
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500">
                      <FileText size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink" title={t.filename}>
                      {t.filename || 'Ticket attached'}
                    </span>
                    {/* Icon-only on a phone, so the file name keeps the room. */}
                    {t.file ? (
                      <button type="button" onClick={() => viewFile(t.file)} className={smallButton} aria-label="View the ticket" title="View">
                        <Eye size={13} /> <span className="hidden sm:inline">View</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => pickFile(seg.seq)}
                      disabled={busy}
                      className={smallButton}
                      aria-label="Replace the ticket"
                      title="Replace"
                    >
                      <RefreshCw size={12} /> <span className="hidden sm:inline">Replace</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => pickFile(seg.seq)}
                    disabled={busy}
                    {...dropProps(seg.seq)}
                    className={`flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      dragging
                        ? 'border-brand bg-brand/5'
                        : err
                          ? 'border-rose-300 bg-rose-50/40'
                          : 'border-slate-200 bg-slate-50/50 hover:border-brand/40 hover:bg-brand/[0.03]'
                    }`}
                  >
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <UploadCloud size={17} />
                    </span>
                    <span className="min-w-0">
                      <b className="block text-[12.5px] text-ink">{dragging ? 'Drop it here' : 'Attach your ticket'}</b>
                      <span className="text-[11.5px] text-slate-500">Click or drop a file · PDF, JPG, PNG or HEIC, up to 10 MB</span>
                    </span>
                  </button>
                )}

                {read?.status === 'done' && read.mismatch ? (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11.5px] font-semibold leading-snug text-amber-800">
                    <AlertTriangle size={14} className="mt-px flex-none" /> {read.mismatch}
                  </p>
                ) : null}
                {filledSome && !uploading ? (
                  <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-violet-700">
                    <Sparkles size={12} className="flex-none" /> Filled in from your ticket. Check each value before you submit.
                  </p>
                ) : null}
                {read?.status === 'failed' && !uploading ? (
                  <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500">
                    <Info size={13} className="flex-none" /> {read.message}
                  </p>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px]">
                  <TicketField
                    id={`${id}-pnr`}
                    label="Booking reference (PNR)"
                    value={t.pnr}
                    onChange={(v) => setField(seg.seq, 'pnr', v)}
                    auto={fromTicket(seg.seq, 'pnr')}
                    inputClassName="font-mono uppercase tracking-wide placeholder:font-sans placeholder:normal-case placeholder:tracking-normal"
                    maxLength={128}
                    placeholder="e.g. X7K2QP"
                    autoComplete="off"
                  />
                  <TicketField
                    id={`${id}-provider`}
                    label={providerLabel(mode)}
                    value={t.provider}
                    onChange={(v) => setField(seg.seq, 'provider', v)}
                    auto={fromTicket(seg.seq, 'provider')}
                    maxLength={64}
                    placeholder={mode === 'TRAIN' ? 'e.g. Indian Railways (IRCTC)' : mode === 'BUS' ? 'e.g. VRL Travels' : 'e.g. IndiGo'}
                    autoComplete="off"
                  />
                  <TicketField
                    id={`${id}-fare`}
                    label="Fare"
                    prefix="₹"
                    value={t.amount}
                    onChange={(v) => setField(seg.seq, 'amount', v)}
                    auto={fromTicket(seg.seq, 'amount')}
                    inputClassName="text-right tabular-nums"
                    inputMode="decimal"
                    placeholder="0.00"
                    autoComplete="off"
                  />
                </div>
                {err ? (
                  <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-rose-600">
                    <AlertTriangle size={13} className="flex-none" /> {err}
                  </p>
                ) : null}
              </section>
            );
          })}

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-[14px] border bg-white p-3.5 transition-colors sm:p-4 ${
              claimFares ? 'border-brand/40 bg-brand/[0.03]' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="checkbox"
              checked={claimFares}
              onChange={(e) => setClaimFares(e.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-[17px] w-[17px] shrink-0 accent-brand"
            />
            <span className="min-w-0">
              <b className="block text-[13px] text-ink">
                Submit these fares for reimbursement
                {fareTotal > 0 ? <span className="font-semibold text-slate-500"> · ₹{fareTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span> : null}
              </b>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">
                A travel claim will be created with these tickets and sent through the approval process. By selecting this, I certify
                that these expenses are true, correct and were incurred exclusively for official business purposes.
              </span>
            </span>
          </label>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-3 sm:px-[22px]">
          <div className="flex items-center gap-2.5 text-[12px] font-semibold text-slate-600" aria-live="polite">
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <span
                className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${segments.length ? (readyCount / segments.length) * 100 : 0}%` }}
              />
            </span>
            {readyCount} of {segments.length} ticket{segments.length === 1 ? '' : 's'} ready
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <button type="button" className="btn-secondary flex-1 sm:flex-none" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary inline-flex flex-[2] items-center justify-center gap-1.5 sm:flex-none"
              onClick={submit}
              disabled={busy}
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {submitting ? 'Submitting…' : claimFares ? 'Submit tickets and claim' : 'Submit tickets'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
