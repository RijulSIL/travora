import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Bus, Download, ExternalLink, FileText, Plane, TrainFront, X } from 'lucide-react';

import PdfPages from './PdfPages';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { reimbursementApi } from '../../services/reimbursementApi';
import { formatDate, formatDatetime } from '../../utils/formatters';

const EYEBROW = 'text-[10.5px] font-bold uppercase tracking-[0.07em] text-slate-400';
const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 250];
const MODE_ICONS = { FLIGHT: Plane, TRAIN: TrainFront, BUS: Bus };

function detectKind(contentType, filename) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('pdf')) return 'pdf';
  if (ct.startsWith('image/')) return 'image';
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (/\.(jpe?g|png|gif|webp|heic)$/.test(name)) return 'image';
  return 'other';
}

const titleCase = (value) =>
  String(value || '')
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const inr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Does the uploaded file's own name describe a different trip? Only when the name follows a
 * "<From>_to_<To>[_YYYY-MM-DD]" shape (as generated tickets do) — then the cities, and the date
 * if present, are compared with the leg the ticket was uploaded for. Anything else: no opinion.
 */
function fileTripMismatch(filename, segment) {
  if (!filename || !segment) return null;
  const base = filename.replace(/\.[a-z0-9]+$/i, '');
  const m = base.match(/^(.+?)[_\s-]+to[_\s-]+(.+?)(?:[_\s-]+(\d{4}-\d{2}-\d{2}))?$/i);
  if (!m) return null;
  const [, fileFrom, fileTo, fileDate] = m;
  const same = (a, b) => {
    const x = norm(a);
    const y = norm(b);
    return Boolean(x && y && (x.includes(y) || y.includes(x)));
  };
  const cityMismatch = !same(fileFrom, segment.from_city) || !same(fileTo, segment.to_city);
  const dateMismatch = Boolean(fileDate && segment.travel_date && String(segment.travel_date).slice(0, 10) !== fileDate);
  if (!cityMismatch && !dateMismatch) return null;
  return {
    fileRoute: `${fileFrom.replace(/[_-]+/g, ' ')} → ${fileTo.replace(/[_-]+/g, ' ')}`,
    fileDate,
    cityMismatch,
    dateMismatch,
  };
}

function Fact({ label, value, mono = false, empty = 'Not recorded', wide = false }) {
  const shown = value != null && String(value).trim() !== '';
  return (
    <div className={`min-w-0 rounded-[10px] bg-slate-50 px-3 py-2.5 ${wide ? 'col-span-2' : ''}`}>
      <div className="text-[10.5px] font-semibold text-slate-500">{label}</div>
      <div className={`mt-0.5 break-words text-[13px] ${shown ? `font-extrabold text-ink ${mono ? 'font-mono font-semibold' : ''}` : 'font-semibold text-slate-400'}`}>
        {shown ? value : empty}
      </div>
    </div>
  );
}

/**
 * Ticket / document preview. A PDF is drawn as clean white pages (pdf.js, falling back to the
 * browser's own viewer if it can't be read); an image is shown as is. Both zoom. Pass `ticketId` for a travel ticket to also show, beside it, the trip leg
 * it was uploaded for, its booking details and who uploaded it — plus a warning when the file's
 * own name describes a different trip. Without a ticketId (supporting documents, evidence) the
 * file fills the window.
 */
export default function TicketPreviewDrawer({ open, onClose, title, blob, contentType, filename, ticketId }) {
  const [url, setUrl] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [details, setDetails] = useState(null);
  const [pageCount, setPageCount] = useState(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  // What "Fit" works out to for a PDF, so + / − step up or down from the size on screen.
  const [fitZoom, setFitZoom] = useState(100);

  useEffect(() => {
    setPageCount(null);
    setPdfFailed(false);
    setFitZoom(100);
  }, [blob]);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open || !blob) {
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setZoom(null);
      return undefined;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
    };
  }, [open, blob]);

  useEffect(() => {
    setDetails(null);
    if (!open || !ticketId) return undefined;
    let cancelled = false;
    reimbursementApi
      .travelTicketDetails(ticketId)
      .then((res) => {
        if (!cancelled) setDetails(res.data);
      })
      .catch(() => {
        if (!cancelled) setDetails(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ticketId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const kind = useMemo(() => detectKind(contentType, filename), [contentType, filename]);

  if (!open) return null;

  const showPanel = Boolean(ticketId);
  const segment = details?.segment;
  const request = details?.request;
  const mode = segment?.mode || request?.travel_mode;
  const ModeIcon = MODE_ICONS[String(mode || '').toUpperCase()] || FileText;
  const mismatch = details ? fileTripMismatch(details.original_filename, segment) : null;
  const current = zoom ?? (kind === 'pdf' && !pdfFailed ? fitZoom : 100);
  const zoomUp = ZOOM_STEPS.find((z) => z > current) ?? null;
  const zoomDown = [...ZOOM_STEPS].reverse().find((z) => z < current) ?? null;
  const canZoom = Boolean(url) && kind !== 'other';
  const headerTitle = segment ? `${segment.from_city} → ${segment.to_city}` : title || 'Ticket preview';
  const legLabel = segment && request?.segment_count > 1 ? segment.label : null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-3 md:p-6" role="dialog" aria-modal="true" aria-label="Ticket preview">
      <button type="button" className="absolute inset-0 cursor-default bg-slate-900/55 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />

      <div
        className={`relative z-10 flex h-full max-h-[90vh] w-full flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_30px_80px_rgba(15,23,42,.35)] animate-in fade-in zoom-in-95 duration-200 ${
          showPanel ? 'max-w-[1120px]' : 'max-w-4xl'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-brand/[0.06] via-white to-white px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-brand/10 text-brand">
              <ModeIcon size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[15.5px] font-extrabold text-ink">{headerTitle}</h2>
                {showPanel && mode ? (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10.5px] font-bold text-brand">
                    {titleCase(mode)} ticket{legLabel ? ` · ${legLabel.split(':')[0]}` : ''}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[11.5px] text-slate-500">
                {request
                  ? [request.reference, request.employee_name, details.file_size_bytes ? `${kind === 'pdf' ? 'PDF' : 'File'} · ${Math.max(1, Math.round(details.file_size_bytes / 1024))} KB` : null]
                      .filter(Boolean)
                      .join(' · ')
                  : filename}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {url ? (
              <>
                <a
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-slate-200 bg-white px-3 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in a new tab"
                >
                  <ExternalLink size={14} />
                  <span className="hidden sm:inline">Open</span>
                </a>
                <a
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-slate-200 bg-white px-3 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50"
                  href={url}
                  download={details?.original_filename || filename || 'ticket'}
                  title="Download the file"
                >
                  <Download size={14} />
                  <span className="hidden sm:inline">Download</span>
                </a>
              </>
            ) : null}
            <button
              type="button"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div
          className={`grid min-h-0 flex-1 grid-cols-1 overflow-y-auto ${
            showPanel ? 'md:grid-cols-[minmax(0,1fr)_330px] md:overflow-hidden' : 'md:overflow-hidden'
          }`}
        >
          {/* The file */}
          <section
            aria-label="Document"
            className={`flex min-h-[60vh] flex-col bg-[#f3f5f6] md:min-h-0 ${showPanel ? 'border-b border-slate-200 md:border-b-0 md:border-r' : ''}`}
          >
            {canZoom ? (
              <div className="flex items-center justify-between gap-2.5 border-b border-slate-200 bg-white px-3.5 py-2">
                <span className="truncate text-[11.5px] font-semibold text-slate-500">
                  {showPanel ? (kind === 'pdf' ? 'Ticket PDF' : 'Ticket image') : kind === 'pdf' ? 'PDF' : 'Image'}
                  {kind === 'pdf' && pageCount ? ` · ${pageCount} page${pageCount > 1 ? 's' : ''}` : ''}
                </span>
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    disabled={zoomDown == null}
                    onClick={() => setZoom(zoomDown)}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-slate-200 bg-white font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="min-w-[46px] text-center text-[11.5px] font-bold tabular-nums text-slate-500">
                    {zoom == null ? 'Fit' : `${zoom}%`}
                  </span>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    disabled={zoomUp == null}
                    onClick={() => setZoom(zoomUp)}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-slate-200 bg-white font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    +
                  </button>
                  {zoom != null ? (
                    <button
                      type="button"
                      onClick={() => setZoom(null)}
                      className="ml-1 h-[30px] rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Fit
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className={`min-h-0 flex-1 ${kind === 'pdf' && !pdfFailed ? 'overflow-hidden' : kind === 'pdf' ? 'overflow-auto' : 'overflow-auto p-5'}`}>
              {!blob || !url ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                  <span className="mt-2 text-sm font-medium">Loading preview…</span>
                </div>
              ) : kind === 'pdf' && !pdfFailed ? (
                // Clean white pages drawn with pdf.js (loaded on first use).
                <PdfPages
                  blob={blob}
                  zoom={zoom}
                  onPageCount={setPageCount}
                  onFitZoom={setFitZoom}
                  onError={() => setPdfFailed(true)}
                />
              ) : kind === 'pdf' ? (
                // Fallback when pdf.js can't read the file: the browser's own PDF viewer — its zoom
                // comes from the URL fragment, so the frame reloads per zoom step.
                <iframe
                  key={zoom ?? 'fit'}
                  title={details?.original_filename || filename || 'Ticket PDF'}
                  src={`${url}#toolbar=0&navpanes=0&zoom=${zoom ?? 'page-width'}`}
                  className="block h-full w-full border-0"
                />
              ) : kind === 'image' ? (
                <img
                  src={url}
                  alt={title || 'Ticket'}
                  style={zoom ? { width: `${zoom}%`, maxWidth: 'none' } : undefined}
                  className={`mx-auto rounded-[4px] bg-white shadow-[0_1px_2px_rgba(15,23,42,.08),0_10px_30px_rgba(15,23,42,.10)] ${
                    zoom ? '' : 'max-h-full max-w-full object-contain'
                  }`}
                />
              ) : (
                <div className="mx-auto mt-10 max-w-md rounded-2xl border border-slate-200/60 bg-white p-8 text-center shadow-sm">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
                    <FileText size={24} />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">Preview unavailable</h3>
                  <p className="mb-4 mt-1 text-xs leading-relaxed text-slate-500">
                    This file type ({contentType || 'unknown'}) can&apos;t be shown here. Download it to view it.
                  </p>
                  <a className="btn-primary inline-flex h-9 px-4 text-xs" href={url} download={filename || 'ticket'}>
                    Download file
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* Ticket details */}
          {showPanel ? (
            <aside aria-label="Ticket details" className="flex min-w-0 flex-col gap-4 px-5 pb-6 pt-[18px] md:overflow-y-auto">
              {details === null ? (
                <p className="text-xs text-slate-400">Loading ticket details…</p>
              ) : details === false ? (
                <p className="text-xs text-slate-500">The ticket&apos;s details couldn&apos;t be loaded. The file itself is shown on the left.</p>
              ) : (
                <>
                  <div className={EYEBROW}>Trip as booked{legLabel ? ` · ${legLabel.split(':')[0]}` : ''}</div>
                  {segment ? (
                    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5">
                      <div className="min-w-0">
                        <div className={EYEBROW}>From</div>
                        <div className="mt-0.5 text-[17px] font-extrabold text-ink">{segment.from_city}</div>
                      </div>
                      <div className="relative h-6" aria-hidden="true">
                        <span className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-brand/30" />
                        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-1 text-brand">
                          <ModeIcon size={16} />
                        </span>
                      </div>
                      <div className="min-w-0 text-right">
                        <div className={EYEBROW}>To</div>
                        <div className="mt-0.5 text-[17px] font-extrabold text-ink">{segment.to_city}</div>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <Fact label="Travel date" value={segment?.travel_date ? formatDate(segment.travel_date) : null} />
                    <Fact
                      label="Mode · class"
                      value={[mode ? titleCase(mode) : null, details.ticket_travel_class ? titleCase(details.ticket_travel_class) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                    <Fact label="PNR / booking ref" value={details.pnr_or_booking_ref} mono />
                    <Fact label="Ticket amount" value={details.ticket_amount != null ? inr(details.ticket_amount) : null} mono />
                    <Fact label="Booked via" value={details.external_booking_source} wide />
                  </div>

                  <div>
                    <div className={`${EYEBROW} mb-1.5`}>Note from the travel desk</div>
                    {details.notes_for_employee ? (
                      <p className="m-0 whitespace-pre-wrap break-words border-l-[3px] border-brand/30 py-0.5 pl-3 text-[13px] leading-relaxed text-slate-700">
                        {details.notes_for_employee}
                      </p>
                    ) : (
                      <p className="m-0 border-l-[3px] border-slate-200 py-0.5 pl-3 text-[13px] italic text-slate-400">No note</p>
                    )}
                  </div>

                  <div>
                    <div className={`${EYEBROW} mb-1.5`}>File</div>
                    <div className="rounded-[10px] border border-slate-200 px-3 py-2.5 text-xs leading-relaxed">
                      Uploaded as <b className="break-all text-ink">{details.original_filename}</b>
                      <div className="text-slate-500">
                        {[details.uploaded_by_name ? `by ${details.uploaded_by_name}` : null, details.uploaded_at ? formatDatetime(details.uploaded_at) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </div>

                  {mismatch ? (
                    <div className="flex gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                      <span>
                        <b>Check this ticket.</b> The file name describes {mismatch.cityMismatch ? mismatch.fileRoute : 'a trip'}
                        {mismatch.fileDate ? ` on ${formatDate(mismatch.fileDate)}` : ''}, but this ticket is for{' '}
                        {segment.from_city} → {segment.to_city} on {formatDate(segment.travel_date)}. If it&apos;s the wrong file, the
                        travel desk can upload the right one.
                      </span>
                    </div>
                  ) : null}
                </>
              )}
            </aside>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
