import { CheckCircle2, Download, FileText, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import ReimbursementCategoryBadge from './ReimbursementCategoryBadge';
import { reimbursementApi } from '../../services/reimbursementApi';
import { formatDate } from '../../utils/formatters';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';

const EYEBROW = 'text-[10.5px] font-bold uppercase tracking-[0.07em] text-slate-400';
const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 250];
// Below this (but above 0) a value is shown with a "check" tag — read off the invoice with
// little confidence. 0 means nothing was read (blank on the invoice, or entered by hand).
const CHECK_BELOW = 80;

const FIELD_LABELS = {
  vendor_name: 'Vendor',
  invoice_number: 'Invoice no.',
  invoice_date: 'Invoice date',
  payment_mode: 'Payment mode',
  place_of_supply: 'Place of supply',
  supplier_gstin: 'Supplier GSTIN',
  company_gstin: 'Company GSTIN',
  currency: 'Currency',
  grand_total: 'Grand total',
  grand_total_inr_estimate: 'Grand total (₹ estimate)',
  total_taxable_value: 'Taxable value',
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  other_tax: 'Other tax (not GST)',
  expense_category: 'Expense category',
  is_tatkal: 'Tatkal ticket',
};

// Amounts in the invoice's own currency — only grand_total. Taxes, line items and the INR
// estimate are kept in rupees (a foreign invoice's lines are converted when it's read).
const INVOICE_CURRENCY_FIELDS = ['grand_total'];
const INR_FIELDS = ['grand_total_inr_estimate', 'total_taxable_value', 'cgst', 'sgst', 'igst', 'other_tax'];

/** An amount in the invoice's own currency (e.g. NZ$1,397.25), rupees when it's INR or unknown. */
function inCurrency(value, currency) {
  const code = String(currency || 'INR').trim().toUpperCase();
  if (code === 'INR') return inr(value);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, minimumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return `${code} ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

const fieldLabel = (key) => FIELD_LABELS[key] || String(key || '').replace(/_/g, ' ');

const inr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fieldValue(field) {
  const raw = field?.final_value ?? field?.original_value;
  return raw == null || String(raw).trim() === '' ? null : String(raw).trim();
}

function displayValue(field, currency) {
  const value = fieldValue(field);
  if (value == null) return null;
  if (field.field_key === 'invoice_date' && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value);
  if (field.field_key === 'is_tatkal') return value.toLowerCase() === 'true' ? 'Yes' : 'No';
  if (Number.isNaN(Number(value))) return value;
  if (INVOICE_CURRENCY_FIELDS.includes(field.field_key)) return inCurrency(value, currency);
  if (INR_FIELDS.includes(field.field_key)) return inr(value);
  return value;
}

function ConfidencePill({ confidence }) {
  const conf = Number(confidence || 0);
  if (!conf) return <span className="inline-block min-w-[40px] rounded-full bg-slate-100 px-1.5 text-center text-[10.5px] font-bold text-slate-400">—</span>;
  const tone = conf > 90 ? 'bg-emerald-50 text-emerald-700' : conf >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700';
  return (
    <span className={`inline-block min-w-[40px] rounded-full px-1.5 text-center text-[10.5px] font-bold tabular-nums ${tone}`}>
      {conf.toFixed(0)}%
    </span>
  );
}

function needsCheck(field) {
  const conf = Number(field?.confidence || 0);
  return fieldValue(field) != null && conf > 0 && conf < CHECK_BELOW;
}

function Fact({ field, label, empty = '—' }) {
  const value = field ? displayValue(field) : null;
  const check = field && needsCheck(field);
  return (
    <div
      className={`min-w-0 rounded-[10px] px-3 py-2.5 ${check ? 'bg-amber-50 ring-1 ring-inset ring-amber-200' : 'bg-slate-50'}`}
      title={check ? `Read with ${Number(field.confidence).toFixed(0)}% confidence. Check it against the invoice.` : undefined}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-500">
        {label}
        {check ? (
          <span className="ml-auto rounded-full border border-amber-200 bg-white px-1.5 text-[9.5px] font-extrabold text-amber-700">check</span>
        ) : null}
      </div>
      <div className={`mt-0.5 break-words text-[13px] font-extrabold ${value ? 'text-ink' : 'font-semibold text-slate-400'}`}>
        {value || empty}
      </div>
    </div>
  );
}

/** The file itself — PDF or image — at the chosen zoom (null = fit to width). */
function DocumentView({ url, isPdf, name, zoom }) {
  if (!url) return <p className="p-6 text-sm text-slate-500">Loading the file…</p>;
  if (isPdf) {
    // The browser's PDF viewer takes its zoom from the URL fragment, so the frame reloads per step.
    return (
      <iframe
        key={zoom ?? 'fit'}
        title={name}
        src={`${url}#toolbar=0&zoom=${zoom ?? 'page-width'}`}
        className="h-full w-full rounded-[4px] border-0 bg-white shadow-[0_1px_2px_rgba(15,23,42,.08),0_10px_30px_rgba(15,23,42,.10)]"
      />
    );
  }
  return (
    <img
      src={url}
      alt={name}
      style={zoom ? { width: `${zoom}%`, maxWidth: 'none' } : undefined}
      className={`mx-auto rounded-[4px] bg-white shadow-[0_1px_2px_rgba(15,23,42,.08),0_10px_30px_rgba(15,23,42,.10)] ${zoom ? '' : 'max-h-full max-w-full object-contain'}`}
    />
  );
}

/**
 * Invoice preview: the document on the left (zoom, and a switch to the payment proof), and on
 * the right what an approver checks first — vendor, total, invoice details, GST and line items —
 * with every extracted field (and its confidence) in a collapsible section.
 */
export default function InvoicePreviewDrawer({ open, onClose, invoice }) {
  const [extraction, setExtraction] = useState(null);
  const [fileUrl, setFileUrl] = useState('');
  const [fileType, setFileType] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [proofContentType, setProofContentType] = useState('');
  const [loadError, setLoadError] = useState('');
  const [doc, setDoc] = useState('invoice');
  const [zoom, setZoom] = useState(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open || !invoice?.id) return undefined;
    let mounted = true;
    let nextUrl = '';
    let nextProofUrl = '';
    setExtraction(null);
    setFileUrl('');
    setProofUrl('');
    setLoadError('');
    setDoc('invoice');
    setZoom(null);
    (async () => {
      const [exRes, fileRes] = await Promise.all([
        reimbursementApi.invoiceExtraction(invoice.id),
        reimbursementApi.invoiceFileBlob(invoice.id),
      ]);
      if (!mounted) return;
      setExtraction(exRes.data);
      const type = fileRes.headers['content-type'] || 'application/octet-stream';
      nextUrl = URL.createObjectURL(new Blob([fileRes.data], { type }));
      setFileType(type);
      setFileUrl(nextUrl);

      if (invoice.payment_proof_original_filename) {
        try {
          const proofRes = await reimbursementApi.paymentProofFileBlob(invoice.id);
          if (!mounted) return;
          const contentType = proofRes.headers['content-type'] || 'application/octet-stream';
          nextProofUrl = URL.createObjectURL(new Blob([proofRes.data], { type: contentType }));
          setProofContentType(contentType);
          setProofUrl(nextProofUrl);
        } catch {
          setProofUrl('');
        }
      }
    })().catch(() => {
      if (!mounted) return;
      setExtraction(null);
      setFileUrl('');
      setLoadError('The invoice could not be loaded. Close this and try again.');
    });
    return () => {
      mounted = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
      if (nextProofUrl) URL.revokeObjectURL(nextProofUrl);
    };
  }, [open, invoice?.id, invoice?.payment_proof_original_filename]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const isPdf = useMemo(
    () => fileType.includes('pdf') || (invoice?.content_type || '').includes('pdf') || (invoice?.original_filename || '').toLowerCase().endsWith('.pdf'),
    [fileType, invoice],
  );
  const isProofPdf = useMemo(
    () => proofContentType.includes('pdf') || (invoice?.payment_proof_original_filename || '').toLowerCase().endsWith('.pdf'),
    [proofContentType, invoice],
  );

  const fields = useMemo(() => {
    const map = {};
    for (const f of extraction?.fields || []) map[f.field_key] = f;
    return map;
  }, [extraction]);

  if (!open || !invoice) return null;

  const hasProof = Boolean(invoice.payment_proof_original_filename);
  const lineItems = extraction?.line_items || [];
  const currency = String(fieldValue(fields.currency) || 'INR').toUpperCase();
  const isForeign = currency !== 'INR';
  const grandTotal = fieldValue(fields.grand_total) ?? invoice.total_amount;
  const lineTotal = lineItems.reduce((sum, li) => sum + Number(li.total_amount || 0), 0);
  // A foreign invoice's rupee figure: the extractor's estimate, else its converted line items.
  const inrEstimate = fieldValue(fields.grand_total_inr_estimate) ?? (isForeign && lineItems.length ? lineTotal : null);
  const vendor = fieldValue(fields.vendor_name);
  const invoiceNo = fieldValue(fields.invoice_number);
  const invoiceDate = fields.invoice_date ? displayValue(fields.invoice_date) : null;
  // Other tax: non-GST tax (VAT, sales tax, …) on a foreign invoice — read as its own field, or
  // only on the line items.
  const otherTax =
    Number(fieldValue(fields.other_tax) || 0) ||
    lineItems.reduce((sum, li) => sum + Number(li.other_tax || 0), 0);
  const taxes = [
    { key: 'total_taxable_value', label: 'Taxable', value: Number(fieldValue(fields.total_taxable_value) || 0) },
    { key: 'cgst', label: 'CGST', value: Number(fieldValue(fields.cgst) || 0) },
    { key: 'sgst', label: 'SGST', value: Number(fieldValue(fields.sgst) || 0) },
    { key: 'igst', label: 'IGST', value: Number(fieldValue(fields.igst) || 0) },
    ...(otherTax ? [{ key: 'other_tax', label: 'Other tax', value: otherTax }] : []),
  ];
  const gstTotal = taxes.filter((t) => ['cgst', 'sgst', 'igst'].includes(t.key)).reduce((s, t) => s + t.value, 0);
  const toCheck = (extraction?.fields || []).filter(needsCheck).length;
  const fileKind = isPdf ? 'PDF' : (fileType.split('/')[1] || 'Image').toUpperCase();
  const showingProof = doc === 'proof';
  const zoomIndex = zoom == null ? ZOOM_STEPS.indexOf(100) : ZOOM_STEPS.indexOf(zoom);

  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-slate-900/55" onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Invoice preview"
        className="absolute right-0 top-0 flex h-full w-full max-w-[1180px] flex-col bg-white shadow-[-24px_0_60px_rgba(15,23,42,.25)] animate-in slide-in-from-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-brand/[0.06] via-white to-white px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-brand/10 text-brand">
              <FileText size={20} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15.5px] font-extrabold text-ink" title={invoice.original_filename}>
                {invoice.original_filename}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500">
                <ReimbursementCategoryBadge category={invoice.reimbursement_category} />
                {invoice.status ? (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${
                      invoice.status === 'REVIEWED'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {invoice.status === 'REVIEWED' ? <CheckCircle2 size={11} /> : null}
                    {String(invoice.status).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                  </span>
                ) : null}
                <span>
                  {fileKind} · {Math.max(1, Math.round((invoice.file_size_bytes || 0) / 1024))} KB
                  {invoice.created_at ? ` · uploaded ${formatDate(invoice.created_at)}` : ''}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {fileUrl ? (
              <a
                href={showingProof && proofUrl ? proofUrl : fileUrl}
                download={showingProof && proofUrl ? invoice.payment_proof_original_filename : invoice.original_filename}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-slate-200 bg-white px-3 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50"
              >
                <Download size={14} /> Download
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:overflow-hidden">
          {/* Document */}
          <section
            aria-label="Document"
            className="flex min-h-[60vh] flex-col border-b border-slate-200 bg-[#f3f5f6] md:min-h-0 md:border-b-0 md:border-r"
          >
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 bg-white px-3.5 py-2.5">
              <div className="inline-flex gap-[3px] rounded-[10px] bg-slate-100 p-[3px]" role="tablist">
                {[
                  { key: 'invoice', label: 'Invoice' },
                  { key: 'proof', label: 'Payment proof' },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={doc === t.key}
                    onClick={() => {
                      setDoc(t.key);
                      setZoom(null);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                      doc === t.key ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t.key === 'proof' ? (
                      <span className={`h-[7px] w-[7px] rounded-full ${hasProof ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    ) : null}
                    {t.label}
                  </button>
                ))}
              </div>
              {!showingProof || proofUrl ? (
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    disabled={zoomIndex <= 0}
                    onClick={() => setZoom(ZOOM_STEPS[Math.max(0, zoomIndex - 1)])}
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
                    disabled={zoomIndex >= ZOOM_STEPS.length - 1}
                    onClick={() => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1)])}
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
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              {loadError ? (
                <p className="p-6 text-sm text-rose-700">{loadError}</p>
              ) : showingProof ? (
                hasProof ? (
                  <div className="h-full">
                    <DocumentView url={proofUrl} isPdf={isProofPdf} name="Payment proof" zoom={zoom} />
                  </div>
                ) : (
                  <div className="mx-auto mt-14 max-w-sm text-center text-[13px] leading-relaxed text-slate-500">
                    <b className="mb-1 block text-[13.5px] text-rose-700">No payment proof</b>
                    Nothing was attached to show this invoice was paid. The employee can add one from Upload Invoice.
                  </div>
                )
              ) : (
                <div className="h-full">
                  <DocumentView url={fileUrl} isPdf={isPdf} name={invoice.original_filename} zoom={zoom} />
                </div>
              )}
            </div>
          </section>

          {/* Details */}
          <section aria-label="Extracted details" className="flex min-w-0 flex-col gap-[18px] px-5 pb-7 pt-5 md:overflow-y-auto sm:px-6">
            {!extraction ? (
              <p className="text-sm text-slate-500">{loadError ? 'No details to show.' : 'Loading extracted details…'}</p>
            ) : (
              <>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                  <div className="min-w-0">
                    <div className={EYEBROW}>Vendor</div>
                    <div className="break-words text-[19px] font-extrabold leading-tight text-ink">{vendor || 'Vendor not read'}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {[invoiceNo ? `Invoice ${invoiceNo}` : null, invoiceDate].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-500">Grand total</div>
                    <div className="font-mono text-[22px] font-semibold text-brand">{inCurrency(grandTotal, currency)}</div>
                    {isForeign && inrEstimate != null ? (
                      <div className="text-[11.5px] text-slate-500" title="Converted to rupees when the invoice was read">
                        ≈ <span className="font-mono font-semibold text-slate-700">{inr(inrEstimate)}</span> in rupees
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Fact field={fields.invoice_number} label="Invoice no." />
                  <Fact field={fields.invoice_date} label="Invoice date" />
                  <Fact field={fields.payment_mode} label="Payment mode" />
                  <Fact field={fields.place_of_supply} label="Place of supply" />
                  <Fact field={fields.supplier_gstin} label="Supplier GSTIN" empty="Not on invoice" />
                  <Fact field={fields.currency} label="Currency" />
                </div>

                <div>
                  <div className={`${EYEBROW} mb-1.5`}>{otherTax ? 'Taxes' : 'GST'}</div>
                  <div
                    className={`grid overflow-hidden rounded-[10px] border border-slate-200 ${
                      taxes.length === 5 ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-4'
                    }`}
                  >
                    {taxes.map((t, i) => (
                      <div
                        key={t.key}
                        className={`px-2.5 py-2 ${i ? 'border-l border-slate-100' : ''} ${
                          t.key === 'other_tax' ? 'bg-sky-50/60' : ''
                        }`}
                        title={t.key === 'other_tax' ? 'Tax that isn’t Indian GST, e.g. VAT or sales tax on a foreign invoice' : undefined}
                      >
                        <div className="text-[10.5px] font-semibold text-slate-500">{t.label}</div>
                        <div className="mt-0.5 font-mono text-[12.5px] text-ink">{inr(t.value)}</div>
                      </div>
                    ))}
                  </div>
                  {otherTax ? (
                    <p className="mt-1.5 text-[11.5px] text-slate-500">
                      {gstTotal ? '' : 'No GST on this invoice. '}Other tax is a non-GST tax (e.g. VAT on a foreign
                      invoice): it counts toward the total but not toward GST input credit.
                      {isForeign ? ' Amounts here are in rupees.' : ''}
                    </p>
                  ) : !gstTotal ? (
                    <p className="mt-1.5 text-[11.5px] text-slate-500">No GST on this invoice.</p>
                  ) : null}
                </div>

                <div>
                  <div className={`${EYEBROW} mb-1.5`}>Line items ({lineItems.length}){isForeign && lineItems.length ? " · in rupees" : ""}</div>
                  {lineItems.length ? (
                    <div className="overflow-hidden rounded-[10px] border border-slate-200">
                      {lineItems.map((li, i) => (
                        <div
                          key={li.id}
                          className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2.5 ${i ? 'border-t border-slate-100' : ''}`}
                        >
                          <span className="break-words text-[12.5px] font-semibold text-ink">{li.description}</span>
                          <span className="text-right font-mono text-[12.5px] text-ink">{inr(li.total_amount)}</span>
                          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            {li.category_name || 'Uncategorised'}
                            {li.is_blacklisted ? (
                              <span className="rounded-full bg-rose-50 px-1.5 text-[10px] font-bold text-rose-700">Not reimbursable</span>
                            ) : null}
                          </span>
                        </div>
                      ))}
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-slate-100 bg-slate-50 px-3 py-2.5">
                        <span className="text-[11.5px] font-bold uppercase tracking-[0.05em] text-slate-500">Total</span>
                        <span className="text-right font-mono text-[12.5px] font-semibold text-brand">{inr(lineTotal)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12px] text-slate-500">No line items were read from this invoice.</p>
                  )}
                </div>

                {hasProof ? (
                  <div className="flex items-center justify-between gap-2.5 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
                    <span className="min-w-0">
                      <b>✓ Payment proof attached</b> · <span className="break-all">{invoice.payment_proof_original_filename}</span>
                      {invoice.payment_proof_uploaded_at ? ` · uploaded ${formatDate(invoice.payment_proof_uploaded_at)}` : ''}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 font-bold underline"
                      onClick={() => {
                        setDoc('proof');
                        setZoom(null);
                      }}
                    >
                      View
                    </button>
                  </div>
                ) : (
                  <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                    <b>No payment proof</b> was attached to this invoice.
                  </div>
                )}

                <details className="group rounded-[10px] border border-slate-200">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[12.5px] font-bold text-ink group-open:border-b group-open:border-slate-100 [&::-webkit-details-marker]:hidden">
                    All extracted fields
                    <span className="text-[11.5px] font-semibold text-slate-500">
                      {(extraction.fields || []).length} fields{toCheck ? ` · ${toCheck} to check` : ''}{' '}
                      <span className="inline-block transition-transform group-open:rotate-180">▾</span>
                    </span>
                  </summary>
                  <table className="w-full text-xs">
                    <tbody>
                      {(extraction.fields || []).map((field, i) => (
                        <tr key={field.id} className={i ? 'border-t border-slate-100' : ''}>
                          <td className="w-[40%] px-3 py-1.5 font-semibold text-slate-500">{fieldLabel(field.field_key)}</td>
                          <td className="break-words px-3 py-1.5 font-semibold text-ink">{displayValue(field, currency) ?? '—'}</td>
                          <td className="w-[70px] px-3 py-1.5 text-right">
                            <ConfidencePill confidence={field.confidence} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </>
            )}
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
