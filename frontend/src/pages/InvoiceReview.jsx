import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Download, Lock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import PdfPages from '../components/ui/PdfPages';
import { useSetPageTitle } from '../context/PageTitleContext';
import { useAsyncAction } from '../hooks/useAsyncAction';
import useToast from '../hooks/useToast';
import { reimbursementApi } from '../services/reimbursementApi';
import { formatDate } from '../utils/formatters';

const FIELD_LABELS = {
  vendor_name: 'Vendor',
  supplier_gstin: 'Supplier GSTIN',
  company_gstin: 'Company GSTIN',
  invoice_number: 'Invoice number',
  invoice_date: 'Invoice date',
  place_of_supply: 'Place of supply',
  payment_mode: 'Payment mode',
  currency: 'Currency',
  grand_total: 'Total',
  grand_total_inr_estimate: 'Rupee amount',
  total_taxable_value: 'Taxable value',
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  other_tax: 'Other tax',
  is_tatkal: 'Tatkal ticket',
  expense_category: 'Expense category',
};
const FIELD_HINTS = { other_tax: 'e.g. foreign VAT or sales tax', expense_category: 'what this is for' };

// Not every valid invoice carries a GSTIN (unregistered vendors, cash memos, foreign
// expenses) — never block review completion on these two being unextracted.
// grand_total_inr_estimate deliberately stays OUT of this set — it only ever exists on a
// non-INR invoice (see backend's _persist_parsed_extraction) and must always be confirmed.
// Informational/analytics-only fields — never block review completion, since a low-confidence
// guess here just means "confirm the category if you like," not "this invoice can't be trusted."
const OPTIONAL_FIELD_KEYS = new Set(['supplier_gstin', 'company_gstin', 'expense_category']);

const MONEY_FIELD_KEYS = new Set([
  'grand_total',
  'grand_total_inr_estimate',
  'total_taxable_value',
  'cgst',
  'sgst',
  'igst',
  'other_tax',
]);

// Where each value is shown. The two totals sit in the Amount card; everything else in groups.
const AMOUNT_KEYS = ['grand_total', 'grand_total_inr_estimate'];
const TAX_KEYS = new Set(['total_taxable_value', 'cgst', 'sgst', 'igst', 'other_tax']);
const GROUPS = [
  { key: 'details', title: 'Invoice details', match: (k) => !TAX_KEYS.has(k) && !OPTIONAL_FIELD_KEYS.has(k) && !AMOUNT_KEYS.includes(k) },
  { key: 'tax', title: 'Tax', note: 'in ₹', match: (k) => TAX_KEYS.has(k) },
  { key: 'optional', title: 'Optional', note: 'never blocks the review', match: (k) => OPTIONAL_FIELD_KEYS.has(k) },
];

const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 250];
const CATEGORY_LABEL = { TRAVEL: 'travel invoice', GENERAL: 'general invoice', RELOCATION: 'relocation invoice' };

function confidenceTone(confidence) {
  const value = Number(confidence);
  if (value > 90) return 'green';
  if (value >= 60) return 'yellow';
  if (value > 0) return 'orange';
  return 'red';
}

function normalizeStr(v) {
  return String(v ?? '').trim();
}

/** The invoice, drawn as clean pages (PDF) or shown as is (image), with zoom.
 * Returns the zoom/download controls and the body separately so the page can lay them out. */
function useDocumentView({ blob, contentType, filename, emptyText }) {
  const [zoom, setZoom] = useState(null);
  const [fitZoom, setFitZoom] = useState(100);
  const [pageCount, setPageCount] = useState(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  const [url, setUrl] = useState('');
  const isPdf = (contentType || '').toLowerCase().includes('pdf') || (filename || '').toLowerCase().endsWith('.pdf');

  useEffect(() => {
    setZoom(null);
    setPdfFailed(false);
    setPageCount(null);
    if (!blob) {
      setUrl('');
      return undefined;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  const current = zoom ?? (isPdf && !pdfFailed ? fitZoom : 100);
  const zoomUp = ZOOM_STEPS.find((z) => z > current) ?? null;
  const zoomDown = [...ZOOM_STEPS].reverse().find((z) => z < current) ?? null;
  const btn =
    'flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-40';

  return { url, isPdf, pageCount, controls: url ? (
    <div className="inline-flex items-center gap-1">
      <button type="button" aria-label="Zoom out" disabled={zoomDown == null} onClick={() => setZoom(zoomDown)} className={btn}>
        −
      </button>
      <button
        type="button"
        onClick={() => setZoom(null)}
        className="min-w-[44px] text-center text-[11.5px] font-bold tabular-nums text-slate-500"
        title="Fit to width"
      >
        {zoom == null ? 'Fit' : `${zoom}%`}
      </button>
      <button type="button" aria-label="Zoom in" disabled={zoomUp == null} onClick={() => setZoom(zoomUp)} className={btn}>
        +
      </button>
      <a href={url} download={filename || 'document'} className={`${btn} ml-1.5`} title="Download" aria-label="Download">
        <Download size={14} />
      </a>
    </div>
  ) : null, body: !blob ? (
    <div className="flex h-full items-center justify-center p-6 text-center text-[12.5px] text-slate-500">{emptyText}</div>
  ) : !url ? null : isPdf && !pdfFailed ? (
    <PdfPages blob={blob} zoom={zoom} onPageCount={setPageCount} onFitZoom={setFitZoom} onError={() => setPdfFailed(true)} />
  ) : isPdf ? (
    <iframe key={zoom ?? 'fit'} title={filename || 'Document'} src={`${url}#toolbar=0&navpanes=0&zoom=${zoom ?? 'page-width'}`} className="block h-full w-full border-0" />
  ) : (
    <div className="h-full overflow-auto p-4">
      <img
        src={url}
        alt={filename || 'Document'}
        style={zoom ? { width: `${zoom}%`, maxWidth: 'none' } : undefined}
        className={`mx-auto rounded-[3px] bg-white shadow-[0_2px_10px_rgba(15,23,42,.12)] ${zoom ? '' : 'max-w-full'}`}
      />
    </div>
  ) };
}

export default function InvoiceReview() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  useSetPageTitle('Review invoice');
  const { showToast } = useToast();
  const [invoice, setInvoice] = useState(null);
  const [values, setValues] = useState({});
  const [initialValues, setInitialValues] = useState({});
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [originals, setOriginals] = useState({});
  const [actionState, setActionState] = useState({});
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [invoiceBlob, setInvoiceBlob] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [onlyNeed, setOnlyNeed] = useState(false);

  const resetFromResponse = useCallback((data) => {
    setInvoice(data);
    setDuplicateAcknowledged(Boolean(data.duplicate_acknowledged));
    const nextValues = {};
    const nextInitial = {};
    const nextOriginals = {};
    const nextAction = {};
    for (const field of data.fields) {
      const tone = confidenceTone(field.confidence);
      const display = field.final_value ?? field.original_value ?? '';
      nextValues[field.field_key] = display;
      nextInitial[field.field_key] = display;
      nextOriginals[field.field_key] = field.original_value ?? '';
      if (tone === 'green') {
        nextAction[field.field_key] = 'auto';
      } else if (field.confirmed_at) {
        const orig = normalizeStr(field.original_value);
        const fin = normalizeStr(field.final_value ?? field.original_value);
        nextAction[field.field_key] = fin !== orig ? 'edited' : 'confirmed';
      } else {
        nextAction[field.field_key] = 'pending';
      }
    }
    setValues(nextValues);
    setInitialValues(nextInitial);
    setOriginals(nextOriginals);
    setActionState(nextAction);
  }, []);

  const { run: load, loading } = useAsyncAction(async () => {
    const response = await reimbursementApi.invoiceExtraction(invoiceId);
    resetFromResponse(response.data);
  });

  const { run: save, loading: saving, error } = useAsyncAction(async () => {
    const fieldsPayload = invoice.fields.map((field) => {
      const tone = confidenceTone(field.confidence);
      const finalValue = normalizeStr(values[field.field_key]);
      const state = actionState[field.field_key] || 'pending';
      let confirmed = false;
      if (tone === 'green') {
        confirmed = true;
      } else if (tone === 'yellow') {
        confirmed = state === 'confirmed' || state === 'edited';
      } else if (tone === 'orange' || tone === 'red') {
        confirmed = state === 'edited' || state === 'confirmed';
      }
      return {
        field_key: field.field_key,
        final_value: finalValue,
        confirmed,
      };
    });
    await reimbursementApi.updateInvoiceFields(invoiceId, {
      duplicate_acknowledged: duplicateAcknowledged,
      fields: fieldsPayload,
    });
    await load();
    showToast('Review saved successfully', 'success');
    setShowSuccessModal(true);
    setTimeout(() => {
      navigate('/invoices');
    }, 2000);
  });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  // The invoice file, for the document view.
  useEffect(() => {
    if (!invoice?.id) return undefined;
    let mounted = true;
    setPreviewError('');
    setInvoiceBlob(null);
    reimbursementApi
      .invoiceFileBlob(invoice.id)
      .then((res) => {
        if (mounted) setInvoiceBlob(new Blob([res.data], { type: res.headers['content-type'] || invoice.content_type || 'application/octet-stream' }));
      })
      .catch(() => {
        if (mounted) setPreviewError('Could not load the invoice file. Try refreshing the page.');
      });
    return () => {
      mounted = false;
    };
  }, [invoice?.id, invoice?.content_type]);

  const isLocked = Boolean(invoice?.is_locked);

  const canSave = useMemo(() => {
    if (!invoice?.fields) return false;
    if (isLocked) return false;
    if (invoice.duplicate_invoice_id && !duplicateAcknowledged) return false;
    for (const field of invoice.fields) {
      if (OPTIONAL_FIELD_KEYS.has(field.field_key)) continue;
      const tone = confidenceTone(field.confidence);
      const val = normalizeStr(values[field.field_key]);
      const state = actionState[field.field_key] || 'pending';
      const orig = normalizeStr(originals[field.field_key]);

      if (tone === 'red' && !val) return false;
      if (tone === 'yellow' && state !== 'confirmed' && state !== 'edited') return false;
      if (tone === 'orange') {
        if (!val) return false;
        const corrected = orig === '' ? val.length > 0 : val !== orig;
        if (!corrected) return false;
        if (state !== 'edited' && state !== 'confirmed') return false;
      }
    }
    return true;
  }, [invoice, values, actionState, duplicateAcknowledged, originals, isLocked]);

  /** What still stops the review from being saved — the same checks as canSave, one per item. */
  const blockers = useMemo(() => {
    if (!invoice?.fields) return [];
    const out = [];
    if (invoice.duplicate_invoice_id && !duplicateAcknowledged) out.push({ key: 'duplicate', text: 'Confirm it isn’t a duplicate' });
    for (const field of invoice.fields) {
      if (OPTIONAL_FIELD_KEYS.has(field.field_key)) continue;
      const tone = confidenceTone(field.confidence);
      const label = FIELD_LABELS[field.field_key] || field.field_key;
      const state = actionState[field.field_key] || 'pending';
      const val = normalizeStr(values[field.field_key]);
      const orig = normalizeStr(originals[field.field_key]);
      const k = field.field_key;
      if (tone === 'red' && !val) out.push({ key: k, text: `Fill in ${label.toLowerCase()}` });
      if (tone === 'yellow' && state !== 'confirmed' && state !== 'edited') out.push({ key: k, text: `Check ${label.toLowerCase()}` });
      if (tone === 'orange') {
        const corrected = orig === '' ? val.length > 0 : val !== orig;
        if (!val) out.push({ key: k, text: `Correct ${label.toLowerCase()}` });
        else if (!corrected) out.push({ key: k, text: `Correct ${label.toLowerCase()} (it must differ from what we read)` });
        else if (state !== 'edited' && state !== 'confirmed') out.push({ key: k, text: `Confirm ${label.toLowerCase()}` });
      }
    }
    return out;
  }, [invoice, values, actionState, duplicateAcknowledged, originals]);

  const onFieldChange = (fieldKey, newValue, field) => {
    setValues((current) => ({ ...current, [fieldKey]: newValue }));
    const tone = confidenceTone(field.confidence);
    const init = normalizeStr(initialValues[fieldKey]);
    if (tone === 'yellow' && normalizeStr(newValue) !== init) {
      setActionState((s) => ({ ...s, [fieldKey]: 'edited' }));
    }
    if (tone === 'orange' || tone === 'red') {
      if (normalizeStr(newValue) !== normalizeStr(originals[fieldKey])) {
        setActionState((s) => ({ ...s, [fieldKey]: 'edited' }));
      } else if (tone === 'red') {
        setActionState((s) => ({ ...s, [fieldKey]: 'pending' }));
      }
    }
  };

  const confirmYellow = (fieldKey) => {
    setActionState((s) => ({ ...s, [fieldKey]: 'confirmed' }));
  };

  // grand_total is only actually in INR when the invoice's own currency is INR — for a
  // foreign invoice it holds the original-currency figure, so it must not get the ₹ glyph
  // (grand_total_inr_estimate, which always is INR, still does).
  const currencyField = invoice?.fields?.find((f) => f.field_key === 'currency');
  const currencyValue = normalizeStr(values.currency ?? currencyField?.final_value ?? currencyField?.original_value);
  const isForeignInvoice = Boolean(currencyValue) && !['INR', 'RS', 'RS.', 'RUPEE', 'RUPEES', '₹'].includes(currencyValue.toUpperCase());

  const invoiceDoc = useDocumentView({
    blob: invoiceBlob,
    contentType: invoice?.content_type,
    filename: invoice?.original_filename,
    emptyText: previewError || 'Loading the invoice…',
  });

  if (loading && !invoice) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand"></div>
        <p className="text-sm font-medium text-slate-600">Loading invoice details...</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm font-semibold text-red-700">Invoice not found.</p>
        <Link className="mt-4 inline-flex items-center text-sm font-medium text-red-700 underline" to="/invoices">
          Back to uploads
        </Link>
      </div>
    );
  }

  const fieldByKey = Object.fromEntries(invoice.fields.map((f) => [f.field_key, f]));
  const blockingKeys = new Set(blockers.map((b) => b.key));

  /** How a value stands, in plain words: { tone, text, need, missing, action }. */
  const statusOf = (field) => {
    const k = field.field_key;
    const tone = confidenceTone(field.confidence);
    const state = actionState[k] || 'pending';
    const val = normalizeStr(values[k]);
    if (isLocked) return { tone: 'muted', text: 'Locked', icon: Lock };
    if (tone === 'green') {
      return val !== normalizeStr(initialValues[k]) ? { tone: 'ok', text: 'Edited', icon: Check } : { tone: 'muted', text: 'Read clearly', icon: Check };
    }
    if (state === 'confirmed') return { tone: 'ok', text: 'Confirmed', icon: Check };
    if (state === 'edited') return { tone: 'ok', text: tone === 'red' ? 'Filled in' : 'Corrected', icon: Check };
    if (tone === 'yellow' && OPTIONAL_FIELD_KEYS.has(k)) return { tone: 'muted', text: 'Optional · check if you like', action: () => confirmYellow(k) };
    if (tone === 'yellow') return { tone: 'amber', text: 'Check this', need: true, action: () => confirmYellow(k) };
    if (tone === 'orange') return { tone: 'rose', text: 'Unclear, correct it', need: true };
    if (!val && !OPTIONAL_FIELD_KEYS.has(k)) return { tone: 'rose', text: 'Missing, fill it in', missing: true };
    if (!val) return { tone: 'muted', text: 'Not on the invoice?' };
    return { tone: 'muted', text: 'Couldn’t read · check it' };
  };
  const TONE_TEXT = { ok: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700', muted: 'text-slate-400' };

  const renderInput = (field, { large = false } = {}) => {
    const k = field.field_key;
    if (k === 'is_tatkal') {
      return (
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={normalizeStr(values[k]).toLowerCase() === 'true'}
            onChange={(event) => onFieldChange(k, event.target.checked ? 'true' : 'false', field)}
            disabled={isLocked}
            className="h-4 w-4 rounded border-slate-300 accent-brand disabled:opacity-60"
          />
          Booked under Tatkal
        </label>
      );
    }
    const isMoney = MONEY_FIELD_KEYS.has(k) && !(k === 'grand_total' && isForeignInvoice);
    const prefix = k === 'grand_total' && isForeignInvoice ? currencyValue.toUpperCase() : isMoney ? '₹' : null;
    return (
      <div className="relative">
        {prefix ? (
          <span className={`pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-slate-400 ${prefix.length > 1 ? 'text-[11px] font-bold' : 'text-[13px]'}`}>
            {prefix}
          </span>
        ) : null}
        <input
          className={`w-full rounded-[9px] border border-slate-200 bg-white pr-2.5 text-ink outline-none transition-colors focus:border-brand disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${
            large ? 'h-10 font-mono text-lg font-semibold' : 'h-[34px] text-[13px]'
          } ${isMoney || prefix ? 'font-mono tabular-nums' : ''} ${prefix ? (prefix.length > 1 ? 'pl-11' : 'pl-6') : 'pl-2.5'}`}
          value={values[k] ?? ''}
          onChange={(event) => onFieldChange(k, event.target.value, field)}
          disabled={isLocked}
          aria-label={FIELD_LABELS[k] || k}
          placeholder={OPTIONAL_FIELD_KEYS.has(k) ? 'Leave blank if not on the invoice' : ''}
        />
      </div>
    );
  };

  const renderStatus = (field, align = 'end') => {
    const s = statusOf(field);
    const Icon = s.icon;
    return (
      <div className={`flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-bold ${TONE_TEXT[s.tone]} ${align === 'end' ? 'justify-end' : ''}`}>
        {Icon ? <Icon size={12} /> : null}
        {s.text}
        {s.action ? (
          <button
            type="button"
            onClick={s.action}
            className="ml-0.5 h-7 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-bold text-slate-700 hover:bg-slate-50"
          >
            Looks right
          </button>
        ) : null}
      </div>
    );
  };

  // "What's left": duplicate, then one line per area that needed checking when the
  // invoice was read (amount, tax, other details) — ticked off live as values are confirmed.
  const needed = (keys) =>
    keys.filter((k) => fieldByKey[k] && !OPTIONAL_FIELD_KEYS.has(k) && confidenceTone(fieldByKey[k].confidence) !== 'green');
  const amountKeys = needed(AMOUNT_KEYS);
  const taxKeys = needed([...TAX_KEYS]);
  const detailKeys = needed(invoice.fields.map((f) => f.field_key).filter((k) => GROUPS[0].match(k)));
  const left = (keys) => keys.filter((k) => blockingKeys.has(k));
  const label = (k) => (FIELD_LABELS[k] || k).toLowerCase();
  const todos = [
    invoice.duplicate_invoice_id
      ? {
          key: 'duplicate',
          done: duplicateAcknowledged,
          title: duplicateAcknowledged ? 'Checked: not a duplicate' : 'Possible duplicate',
          sub: `It matches invoice #${invoice.duplicate_invoice_id}. Tick if this is a separate bill.`,
          action: (
            <input
              type="checkbox"
              checked={duplicateAcknowledged}
              onChange={(event) => setDuplicateAcknowledged(event.target.checked)}
              disabled={isLocked}
              className="h-4 w-4 accent-brand"
              aria-label="This is a separate bill, not a duplicate"
            />
          ),
        }
      : null,
    amountKeys.length
      ? {
          key: 'amount',
          done: !left(amountKeys).length,
          title: left(amountKeys).length
            ? isForeignInvoice && left(amountKeys).includes('grand_total_inr_estimate')
              ? 'Confirm the rupee amount'
              : `Confirm the ${left(amountKeys).map(label).join(' and ')}`
            : isForeignInvoice
              ? 'Rupee amount confirmed'
              : 'Total confirmed',
          sub: isForeignInvoice
            ? `${currencyValue.toUpperCase()} ${normalizeStr(values.grand_total) || '—'} → ₹${normalizeStr(values.grand_total_inr_estimate) || '—'}`
            : `₹${normalizeStr(values.grand_total) || '—'}`,
        }
      : null,
    taxKeys.length
      ? {
          key: 'tax',
          done: !left(taxKeys).length,
          title: left(taxKeys).length ? `Check ${left(taxKeys).length} tax value${left(taxKeys).length > 1 ? 's' : ''}` : 'Tax values checked',
          sub: (left(taxKeys).length ? left(taxKeys) : taxKeys).map((k) => FIELD_LABELS[k] || k).join(', '),
        }
      : null,
    detailKeys.length
      ? {
          key: 'details',
          done: !left(detailKeys).length,
          title: left(detailKeys).length
            ? blockers.filter((b) => detailKeys.includes(b.key)).map((b) => b.text).join(', ').replace(/^./, (c) => c.toUpperCase())
            : 'Other details checked',
          sub: detailKeys.map((k) => FIELD_LABELS[k] || k).join(', '),
        }
      : null,
  ].filter(Boolean);
  const doneCount = todos.filter((t) => t.done).length;

  const amountFields = AMOUNT_KEYS.map((k) => fieldByKey[k]).filter(Boolean);
  const vendor = normalizeStr(values.vendor_name) || invoice.original_filename;
  const invoiceDate = normalizeStr(values.invoice_date);
  const extractionNote =
    invoice.extraction_error && !/^Non-INR currency detected/.test(invoice.extraction_error) ? invoice.extraction_error : null;
  const doc = invoiceDoc;

  return (
    <section className="flex flex-col gap-3.5">
      <div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
          <Link to="/invoices" className="inline-flex items-center gap-1 font-bold text-brand hover:underline">
            <ArrowLeft size={13} /> Invoices
          </Link>
          <span>/</span>
          <span className="truncate">{invoice.original_filename}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[21px] font-extrabold text-ink">{vendor}</h1>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              {[
                normalizeStr(values.invoice_number) ? `Invoice ${normalizeStr(values.invoice_number)}` : null,
                invoiceDate && !Number.isNaN(new Date(invoiceDate).getTime()) ? `dated ${formatDate(invoiceDate)}` : null,
                CATEGORY_LABEL[invoice.reimbursement_category],
                invoice.created_at ? `uploaded ${formatDate(invoice.created_at)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-bold ${
              isLocked ? 'bg-slate-100 text-slate-500' : invoice.status === 'REVIEWED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {isLocked ? <Lock size={12} /> : invoice.status === 'REVIEWED' ? <Check size={12} /> : null}
            {isLocked ? `On ${invoice.linked_claim_reference || 'a claim'}` : invoice.status === 'REVIEWED' ? 'Reviewed' : 'Needs your review'}
          </span>
        </div>
      </div>

      {isLocked ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-900">
          <Lock size={15} className="mt-0.5 flex-none text-amber-600" />
          <span>
            <b>Read only.</b> This invoice is on {invoice.linked_claim_reference || `claim #${invoice.linked_claim_id}`}, which is{' '}
            {String(invoice.linked_claim_status || '').replaceAll('_', ' ').toLowerCase()}, so it can&apos;t be changed. Re-upload the file on the
            Upload Invoices page to review it as a new invoice.
          </span>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* Document */}
        <section
          aria-label="Invoice document"
          className="flex h-[520px] flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-white lg:sticky lg:top-[72px] lg:h-[calc(100vh-88px)] lg:max-h-[900px]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-2.5 py-2">
            <span className="px-1.5 text-xs font-bold text-ink">Invoice</span>
            <div className="flex items-center gap-2">
              {doc.isPdf && doc.pageCount ? (
                <span className="text-[11.5px] font-semibold text-slate-500">
                  {doc.pageCount} page{doc.pageCount > 1 ? 's' : ''}
                </span>
              ) : null}
              {doc.controls}
            </div>
          </div>
          <div className="min-h-0 flex-1 bg-[#e9eeec]">{doc.body}</div>
        </section>

        {/* Review */}
        <div className="flex min-w-0 flex-col gap-3">
          <section aria-labelledby="todo-h" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h2 id="todo-h" className="text-[13.5px] font-extrabold text-ink">
                What&apos;s left
              </h2>
              <span className="text-xs text-slate-500">{isLocked ? 'Read only' : doneCount === todos.length ? 'All done' : `${doneCount} of ${todos.length} done`}</span>
            </div>
            <div className="h-1 bg-slate-100">
              <i className="block h-full bg-emerald-600 transition-all duration-200" style={{ width: `${todos.length ? (doneCount / todos.length) * 100 : 100}%` }} />
            </div>
            {!todos.length ? (
              <div className="grid grid-cols-[22px_minmax(0,1fr)] items-center gap-2.5 px-4 py-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-emerald-600 bg-emerald-600 text-white">
                  <Check size={12} strokeWidth={3} />
                </span>
                <div className="min-w-0">
                  <b className="block text-[13px] font-semibold text-slate-500">Nothing to check</b>
                  <span className="block text-xs text-slate-500">Everything on this invoice was read clearly.</span>
                </div>
              </div>
            ) : null}
            {todos.map((t) => (
              <div key={t.key} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-slate-100 px-4 py-2.5 first:border-t-0">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                    t.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-amber-500'
                  }`}
                >
                  {t.done ? <Check size={12} strokeWidth={3} /> : null}
                </span>
                <div className="min-w-0">
                  <b className={`block text-[13px] ${t.done ? 'font-semibold text-slate-500' : 'text-ink'}`}>{t.title}</b>
                  <span className="block truncate text-xs text-slate-500" title={t.sub}>
                    {t.sub}
                  </span>
                </div>
                <div>{t.action || null}</div>
              </div>
            ))}
          </section>

          {amountFields.length ? (
            <section aria-labelledby="amount-h" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <h2 id="amount-h" className="text-[13.5px] font-extrabold text-ink">
                  Amount
                </h2>
                <span className="text-xs text-slate-500">{isForeignInvoice ? `Foreign invoice · ${currencyValue.toUpperCase()}` : 'In rupees'}</span>
              </div>
              <div className={`grid gap-3 px-4 py-3.5 ${amountFields.length > 1 ? 'sm:grid-cols-[minmax(0,1fr)_24px_minmax(0,1.2fr)] sm:items-start' : ''}`}>
                {amountFields.map((field, i) => (
                  <div key={field.field_key} className="contents">
                    {i > 0 ? <div className="hidden pt-8 text-center text-slate-400 sm:block">→</div> : null}
                    <div className="min-w-0">
                      <div className="mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400">
                        {field.field_key === 'grand_total_inr_estimate' ? 'You’re claiming, in ₹' : isForeignInvoice ? 'On the invoice' : 'Total on the invoice'}
                      </div>
                      {renderInput(field, { large: true })}
                      <div className="mt-1.5">{renderStatus(field, 'start')}</div>
                    </div>
                  </div>
                ))}
                {isForeignInvoice ? (
                  <p className="rounded-[9px] bg-slate-50 px-2.5 py-2 text-xs text-slate-500 sm:col-span-3">
                    Match the rupee amount to what your card or bank statement shows for this payment. That&apos;s what you&apos;ll be paid back.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="fields-h" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h2 id="fields-h" className="text-[13.5px] font-extrabold text-ink">
                What we read
              </h2>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={onlyNeed} onChange={(e) => setOnlyNeed(e.target.checked)} className="h-4 w-4 accent-brand" />
                Only show what needs you
              </label>
            </div>
            {extractionNote ? (
              <div className="flex gap-2 border-b border-slate-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-900" role="status">
                <AlertTriangle size={14} className="mt-px flex-none text-amber-600" />
                <span>{extractionNote}</span>
              </div>
            ) : null}
            {(() => {
              let shown = 0;
              const groups = GROUPS.map((g) => {
                const fields = invoice.fields.filter((f) => g.match(f.field_key)).filter((f) => {
                  if (!onlyNeed) return true;
                  const s = statusOf(f);
                  return s.need || s.missing;
                });
                shown += fields.length;
                if (!fields.length) return null;
                return (
                  <div key={g.key}>
                    <div className="flex justify-between border-y border-slate-100 bg-slate-50 px-4 py-[7px] text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400">
                      <span>{g.title}</span>
                      {g.note ? <span className="font-semibold normal-case tracking-normal">{g.note}</span> : null}
                    </div>
                    {fields.map((field, idx) => {
                      const s = statusOf(field);
                      return (
                        <div
                          key={field.id}
                          className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-l-[3px] px-4 py-[9px] ${idx ? 'border-t border-t-slate-100' : ''} sm:grid-cols-[150px_minmax(0,1fr)_minmax(140px,auto)] ${
                            s.missing ? 'border-l-rose-600 bg-rose-50/30' : s.need ? 'border-l-amber-500 bg-amber-50/30' : 'border-l-transparent'
                          }`}
                        >
                          <div className="min-w-0 text-[12.5px] font-bold text-slate-700">
                            {FIELD_LABELS[field.field_key] || field.field_key}
                            {FIELD_HINTS[field.field_key] ? <span className="block text-[11px] font-medium text-slate-400">{FIELD_HINTS[field.field_key]}</span> : null}
                          </div>
                          <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">{renderInput(field)}</div>
                          <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">{renderStatus(field)}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              });
              return shown ? groups : <p className="px-4 py-4 text-[12.5px] text-slate-500">Nothing here needs you. Untick the box to see everything we read.</p>;
            })()}
          </section>

          {invoice.line_items.length ? (
            <section aria-labelledby="items-h" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <h2 id="items-h" className="text-[13.5px] font-extrabold text-ink">
                  Line items
                </h2>
                <span className="text-xs text-slate-500">
                  {invoice.line_items.length} item{invoice.line_items.length > 1 ? 's' : ''} · amounts in ₹
                </span>
              </div>
              {invoice.line_items.some((item) => item.is_blacklisted) ? (
                <div className="flex gap-2 border-b border-slate-100 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
                  <AlertTriangle size={14} className="mt-px flex-none text-rose-600" />
                  <span>Alcohol or tobacco was detected in line items. This claim will be automatically flagged for compliance review.</span>
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="bg-slate-50 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-slate-400">
                      <th className="px-4 py-2 text-left">Item</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                      <th className="px-4 py-2 text-left">Category</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.line_items.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-4 py-2.5 text-slate-700">
                          {item.description}
                          {item.is_blacklisted ? <span className="ml-1.5 rounded bg-rose-50 px-1.5 text-[10.5px] font-bold text-rose-700">Flagged</span> : null}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">{Number(item.quantity).toFixed(0)}</td>
                        <td className="px-4 py-2.5">
                          {item.category_name ? (
                            <span className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-px text-[11px] font-bold text-slate-500">{item.category_name}</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink">
                          ₹{Number(item.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {error ? <div className="text-xs font-semibold text-red-600">{error.message}</div> : null}

          {/* Sticky bar: what's left + save */}
          <div className="sticky bottom-[76px] z-20 flex items-center gap-3 rounded-[14px] bg-ink py-2.5 pl-4 pr-3 text-slate-300 shadow-[0_12px_28px_rgba(15,23,42,.25)] md:bottom-4">
            <div className="min-w-0 flex-1 text-[12.5px]">
              <b className="block text-[13px] text-white">
                {isLocked
                  ? 'Read only'
                  : blockers.length
                    ? `${blockers.length} thing${blockers.length > 1 ? 's' : ''} left`
                    : invoice.status === 'REVIEWED'
                      ? 'Reviewed. Save again after any change'
                      : 'Everything checked'}
              </b>
              <span className="block truncate">
                {isLocked
                  ? `On ${invoice.linked_claim_reference || 'a claim'}`
                  : blockers.length
                    ? blockers.map((b) => b.text).join(' · ')
                    : 'You can now put this invoice on a claim.'}
              </span>
            </div>
            {isLocked ? (
              <Link to="/invoices" className="inline-flex h-[34px] items-center rounded-[9px] border border-slate-700 bg-slate-800 px-3 text-xs font-bold text-slate-200 hover:bg-slate-700">
                Back to invoices
              </Link>
            ) : (
              <button
                type="button"
                className="inline-flex h-[34px] flex-none items-center rounded-[9px] bg-white px-3.5 text-xs font-bold text-ink hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                disabled={saving || !canSave}
                // A failed save is shown below the form (useAsyncAction keeps the error); nothing else to do here.
                onClick={() => save().catch(() => {})}
              >
                {saving ? 'Saving…' : 'Save & finish review'}
              </button>
            )}
          </div>
        </div>
      </div>

      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 ring-8 ring-emerald-50/50">
              <CheckCircle2 size={36} />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Review saved</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">This invoice can now go on a claim. Taking you back to your invoices…</p>
            <div className="mt-6">
              <button
                type="button"
                className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand text-sm font-bold text-white hover:bg-brand/90"
                onClick={() => navigate('/invoices')}
              >
                Back to invoices
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
