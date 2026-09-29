import { AlertTriangle, CheckCircle2, ArrowLeft, Download, FileText, HelpCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';

import ReimbursementCategoryBadge from '../components/ui/ReimbursementCategoryBadge';
import { useSetPageTitle } from '../context/PageTitleContext';
import { useAsyncAction } from '../hooks/useAsyncAction';
import useToast from '../hooks/useToast';
import { reimbursementApi } from '../services/reimbursementApi';

const FIELD_LABELS = {
  vendor_name: 'Vendor Name',
  supplier_gstin: 'Supplier GSTIN',
  company_gstin: 'Company GSTIN',
  invoice_number: 'Invoice Number',
  invoice_date: 'Invoice Date',
  place_of_supply: 'Place of Supply',
  payment_mode: 'Payment Mode',
  currency: 'Currency',
  grand_total: 'Grand Total (original currency)',
  grand_total_inr_estimate: 'Grand Total (converted to INR)',
  total_taxable_value: 'Total Taxable Value',
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  is_tatkal: 'Is Tatkal Ticket?',
  expense_category: 'Expense Category (what this is for)',
};

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
]);

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
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofError, setProofError] = useState('');

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

  const viewProof = async () => {
    try {
      const res = await reimbursementApi.paymentProofFileBlob(invoiceId);
      const blob = new Blob([res.data], { type: res.headers['content-type'] || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      showToast('Could not open payment proof', 'error');
    }
  };

  const uploadProof = (file) => {
    if (!file) return;
    setProofError('');
    setUploadingProof(true);
    const formData = new FormData();
    formData.append('file', file);
    reimbursementApi
      .uploadPaymentProof(invoiceId, formData)
      .then(() => {
        showToast('Payment proof uploaded', 'success');
        return load();
      })
      .catch((err) => {
        setProofError(err?.response?.data?.detail || 'Could not upload payment proof.');
      })
      .finally(() => setUploadingProof(false));
  };

  useEffect(() => {
    load();
  }, [invoiceId]);

  useEffect(() => {
    if (!invoice?.id) return undefined;
    let mounted = true;
    let objectUrl = '';
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewUrl('');
    (async () => {
      try {
        const res = await reimbursementApi.invoiceFileBlob(invoice.id);
        if (!mounted) return;
        const blob = new Blob([res.data], {
          type: res.headers['content-type'] || invoice.content_type || 'application/octet-stream',
        });
        if (!mounted) return;
        objectUrl = URL.createObjectURL(blob);
        if (!mounted) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setPreviewUrl(objectUrl);
      } catch {
        if (mounted) setPreviewError('Could not load file preview. Try refreshing the page.');
      } finally {
        if (mounted) setPreviewLoading(false);
      }
    })();
    return () => {
      mounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [invoice?.id, invoice?.content_type]);

  const isPdf = useMemo(() => (invoice?.content_type || '').toLowerCase().includes('pdf'), [invoice?.content_type]);
  const isLocked = Boolean(invoice?.is_locked);

  const canSave = useMemo(() => {
    if (!invoice?.fields) return false;
    if (isLocked) return false;
    if (!invoice.payment_proof_original_filename) return false;
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

  const blockingSummary = useMemo(() => {
    if (!invoice?.fields) return '';
    const parts = [];
    if (!invoice.payment_proof_original_filename) {
      parts.push('Attach payment proof');
    }
    if (invoice.duplicate_invoice_id && !duplicateAcknowledged) {
      parts.push('Acknowledge the duplicate flag');
    }
    for (const field of invoice.fields) {
      if (OPTIONAL_FIELD_KEYS.has(field.field_key)) continue;
      const tone = confidenceTone(field.confidence);
      const label = FIELD_LABELS[field.field_key] || field.field_key;
      const state = actionState[field.field_key] || 'pending';
      const val = normalizeStr(values[field.field_key]);
      const orig = normalizeStr(originals[field.field_key]);
      if (tone === 'red' && !val) parts.push(`${label} is required`);
      if (tone === 'yellow' && state !== 'confirmed' && state !== 'edited') {
        parts.push(`${label} needs confirmation`);
      }
      if (tone === 'orange') {
        const corrected = orig === '' ? val.length > 0 : val !== orig;
        if (!val) parts.push(`${label} needs correction`);
        else if (!corrected) parts.push(`${label} must differ from original extraction`);
        else if (state !== 'edited' && state !== 'confirmed') parts.push(`${label} needs confirmation`);
      }
    }
    return parts.join(' · ');
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

  const confirmOrangeCorrection = (fieldKey) => {
    setActionState((s) => ({ ...s, [fieldKey]: 'confirmed' }));
  };

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

  // grand_total is only actually in INR when the invoice's own currency is INR — for a
  // foreign invoice it holds the original-currency figure, so it must not get the ₹ glyph
  // (grand_total_inr_estimate, which always is INR, still does).
  const currencyField = invoice.fields.find((f) => f.field_key === 'currency');
  const currencyValue = (currencyField?.final_value ?? currencyField?.original_value ?? '').trim();
  const isForeignInvoice = currencyValue && !['INR', 'RS', 'RS.', 'RUPEE', 'RUPEES', '₹'].includes(currencyValue.toUpperCase());

  return (
    <section>
      {/* Premium Header Area */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Link to="/invoices" className="hover:text-brand transition-colors">Invoices</Link>
            <span>/</span>
            <span className="text-slate-500">Review</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Review & Confirm Invoice</h1>
            <ReimbursementCategoryBadge category={invoice.reimbursement_category} />
          </div>
        </div>
        <Link className="btn-secondary self-start md:self-center" to="/invoices">
          <ArrowLeft size={16} /> Back to uploads
        </Link>
      </div>

      {isLocked && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 flex-none text-amber-600" />
          <span>
            This invoice can no longer be edited —{' '}
            <span className="font-semibold">{invoice.linked_claim_reference || `claim #${invoice.linked_claim_id}`}</span> is{' '}
            {String(invoice.linked_claim_status || '').replaceAll('_', ' ').toLowerCase()}. Re-upload the file on the Upload
            Invoices page to review it as a new invoice.
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* Right Side: Document Preview Card */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden h-[540px] lg:order-2">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <FileText className="text-slate-400" size={18} />
              <span className="text-sm font-semibold text-slate-800 truncate max-w-[280px]">
                {invoice.original_filename}
              </span>
            </div>
            {previewUrl && (
              <a
                href={previewUrl}
                download={invoice.original_filename}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
              >
                <Download size={13} /> Download
              </a>
            )}
          </div>
          <div className="flex-1 overflow-y-auto bg-slate-50 p-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
            {previewLoading ? (
              <div className="flex h-full items-center justify-center flex-col gap-2 text-slate-400">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500"></div>
                <span className="text-xs font-medium">Loading document...</span>
              </div>
            ) : previewError ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm font-medium text-rose-600">
                {previewError}
              </div>
            ) : isPdf ? (
              <iframe title="Invoice PDF" src={`${previewUrl}#toolbar=0&zoom=page-width`} className="h-full w-full bg-white rounded shadow-sm border border-slate-200" />
            ) : previewUrl ? (
              <div className="flex min-h-full items-center justify-center">
                <img
                  src={previewUrl}
                  alt="Invoice Document"
                  className="max-w-full h-auto rounded shadow-sm border border-slate-200 bg-white"
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                No preview available.
              </div>
            )}
          </div>
        </div>

        {/* Left Side: Extraction Form Card */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden h-[540px] lg:order-1">
          <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-800">Extracted Fields</h2>
          </div>
          
          <div className="flex-1 space-y-3.5 overflow-y-auto p-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
            <div
              className={`rounded-lg border p-3 text-xs ${
                invoice.payment_proof_original_filename
                  ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900'
                  : 'border-rose-200 bg-rose-50/50 text-rose-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  Payment proof {invoice.payment_proof_original_filename ? '' : '(required)'}
                </span>
                {invoice.payment_proof_original_filename ? <CheckCircle2 size={15} className="flex-none" /> : null}
              </div>
              {invoice.payment_proof_original_filename ? (
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="truncate">{invoice.payment_proof_original_filename}</span>
                  <div className="flex flex-none items-center gap-2.5">
                    <button type="button" className="font-semibold underline" onClick={viewProof}>
                      View
                    </button>
                    <label className={`cursor-pointer font-semibold underline ${isLocked ? 'pointer-events-none opacity-50' : ''}`}>
                      {uploadingProof ? 'Replacing…' : 'Replace'}
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png,.heic,.pdf"
                        className="hidden"
                        disabled={isLocked || uploadingProof}
                        onChange={(event) => uploadProof(event.target.files?.[0])}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="mt-1.5">
                  <p className="text-rose-700/80">
                    Attach proof you actually paid this invoice (bank statement, UPI receipt, card transaction
                    screenshot, etc.) before this invoice can be reviewed.
                  </p>
                  <label className={`btn-secondary mt-2 inline-flex h-8 cursor-pointer items-center text-xs ${isLocked ? 'pointer-events-none opacity-50' : ''}`}>
                    {uploadingProof ? 'Uploading…' : 'Upload payment proof'}
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.heic,.pdf"
                      className="hidden"
                      disabled={isLocked || uploadingProof}
                      onChange={(event) => uploadProof(event.target.files?.[0])}
                    />
                  </label>
                </div>
              )}
              {proofError && <p className="mt-1.5 text-rose-600">{proofError}</p>}
            </div>

            {invoice.extraction_error && (
              <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="status">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
                <span>{invoice.extraction_error}</span>
              </div>
            )}

            {invoice.duplicate_invoice_id && (
              <label className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-xs text-rose-800 cursor-pointer hover:bg-rose-50 transition-colors">
                <input
                  type="checkbox"
                  checked={duplicateAcknowledged}
                  onChange={(event) => setDuplicateAcknowledged(event.target.checked)}
                  disabled={isLocked}
                  className="mt-0.5 rounded border-rose-300 text-rose-600 focus:ring-rose-500/20 disabled:opacity-60"
                />
                <div>
                  <p className="font-semibold">Duplicate Candidate Detected</p>
                  <p className="text-rose-700/80 mt-0.5">
                    This invoice details match Invoice #{invoice.duplicate_invoice_id}. Check this box to acknowledge and proceed.
                  </p>
                </div>
              </label>
            )}

            {/* Extracted fields — plain label/value rows, no decoration */}
            <div className="divide-y divide-slate-100">
              {invoice.fields.map((field) => {
                const tone = confidenceTone(field.confidence);
                const state = actionState[field.field_key] || 'pending';
                const isOptional = OPTIONAL_FIELD_KEYS.has(field.field_key);
                const isRequired = tone === 'red' && !isOptional;
                const isMoney =
                  MONEY_FIELD_KEYS.has(field.field_key) &&
                  !(field.field_key === 'grand_total' && isForeignInvoice);
                const label =
                  field.field_key === 'grand_total' && !isForeignInvoice
                    ? 'Grand Total'
                    : FIELD_LABELS[field.field_key] || field.field_key;

                return (
                  <div key={field.id} className="py-3 first:pt-0 last:pb-0">
                    <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                      {label}
                      {isOptional && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
                      {isRequired && <span className="ml-1 text-rose-500">*</span>}
                    </label>

                    {field.field_key === 'is_tatkal' ? (
                      <label className="flex w-full cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={normalizeStr(values[field.field_key]) === 'true'}
                          onChange={(event) => onFieldChange(field.field_key, event.target.checked ? 'true' : 'false', field)}
                          disabled={isLocked}
                          className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/20 disabled:opacity-60"
                        />
                        <span className="text-sm text-slate-700">Flag as Tatkal booking</span>
                      </label>
                    ) : isMoney ? (
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                          ₹
                        </span>
                        <input
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-6 pr-3 text-sm tabular-nums text-slate-800 outline-none transition-colors focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70"
                          value={values[field.field_key] ?? ''}
                          onChange={(event) => onFieldChange(field.field_key, event.target.value, field)}
                          disabled={isLocked}
                        />
                      </div>
                    ) : (
                      <input
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-800 text-sm outline-none transition-colors focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70"
                        value={values[field.field_key] ?? ''}
                        onChange={(event) => onFieldChange(field.field_key, event.target.value, field)}
                        disabled={isLocked}
                      />
                    )}

                    {/* Confirmation prompts — still needed to complete review, kept plain */}
                    {tone === 'yellow' && state === 'pending' && (
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-500">Confirm this value is correct</span>
                        <button
                          type="button"
                          className="btn-secondary h-7 px-3 text-xs disabled:opacity-50"
                          onClick={() => confirmYellow(field.field_key)}
                          disabled={isLocked}
                        >
                          Confirm
                        </button>
                      </div>
                    )}

                    {tone === 'orange' && state === 'pending' && (
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-500">Low confidence — correct this value to match the document</span>
                        <button
                          type="button"
                          className="btn-secondary h-7 flex-none px-3 text-xs disabled:opacity-50"
                          onClick={() => confirmOrangeCorrection(field.field_key)}
                          disabled={isLocked || normalizeStr(values[field.field_key]) === normalizeStr(originals[field.field_key])}
                        >
                          Confirm Correction
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Blacklist warnings */}
            {invoice.line_items.some((item) => item.is_blacklisted) && (
              <div className="flex gap-2.5 rounded-lg border border-red-200 bg-rose-50/50 p-3 text-xs text-red-800">
                <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
                <span>Alcohol or tobacco was detected in line items. This claim will be automatically flagged for compliance review.</span>
              </div>
            )}

            {/* Line Items Detail */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Line Items Breakdown</h3>
              <div className="divide-y divide-slate-200/60 bg-white rounded-lg border border-slate-200 overflow-hidden">
                {invoice.line_items.map((item) => (
                  <div key={item.id} className="flex justify-between items-center px-3.5 py-3 hover:bg-slate-50/30 transition-colors">
                    <div className="text-xs">
                      <p className="font-semibold text-slate-800">{item.description}</p>
                      <p className="text-slate-400 mt-0.5">Quantity: {Number(item.quantity).toFixed(0)}</p>
                    </div>
                    <span className="text-xs font-bold text-slate-800">₹{Number(item.total_amount).toLocaleString('en-IN')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Action Footer Bar */}
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            {isLocked ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-slate-500">
                <AlertTriangle size={15} className="flex-none text-amber-500" /> Locked — read only
              </span>
            ) : canSave ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 size={15} className="flex-none" /> All fields ready to save
              </span>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-orange-700">
                <HelpCircle size={15} className="flex-none" />
                <span className="truncate">{blockingSummary || 'Complete required actions.'}</span>
              </div>
            )}

            {!isLocked && (
              <button
                className="inline-flex h-9 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-brand px-4 text-xs font-bold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60 transition-all duration-200 shadow-md focus:outline-none focus:ring-2 focus:ring-brand/10 disabled:shadow-none"
                disabled={saving || !canSave}
                onClick={save}
              >
                {saving ? 'Saving...' : 'Save & Complete Review'}
              </button>
            )}
          </div>
        </div>
      </div>
      {error && <div className="mt-3 text-xs font-semibold text-red-600">{error.message}</div>}

      {/* Custom Premium Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-6 text-center shadow-2xl transition-all duration-300 transform scale-100">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 ring-8 ring-emerald-50/50">
              <CheckCircle2 size={36} className="animate-bounce" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Review Completed Successfully!</h3>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              Your invoice has been verified and saved. Redirecting you to the uploads page...
            </p>
            <div className="mt-6">
              <button
                type="button"
                className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand text-sm font-bold text-white hover:bg-brand/90 transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-brand/10"
                onClick={() => navigate('/invoices')}
              >
                Go to Upload Documents
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
