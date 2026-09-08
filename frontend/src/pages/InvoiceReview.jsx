import { AlertTriangle, CheckCircle2, ArrowLeft, Download, FileText, Check, HelpCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';

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
  grand_total: 'Grand Total',
  total_taxable_value: 'Total Taxable Value',
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  is_tatkal: 'Is Tatkal Ticket?',
};

function confidenceTone(confidence) {
  const value = Number(confidence);
  if (value > 90) return 'green';
  if (value >= 60) return 'yellow';
  if (value > 0) return 'orange';
  return 'red';
}

const toneConfig = {
  green: {
    accent: 'border-l-4 border-l-emerald-500',
    pill: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    text: 'text-emerald-700',
    bg: 'bg-emerald-50/20',
  },
  yellow: {
    accent: 'border-l-4 border-l-amber-500',
    pill: 'bg-amber-50 text-amber-700 border-amber-200',
    text: 'text-amber-700',
    bg: 'bg-amber-50/20',
  },
  orange: {
    accent: 'border-l-4 border-l-orange-500',
    pill: 'bg-orange-50 text-orange-700 border-orange-200',
    text: 'text-orange-700',
    bg: 'bg-orange-50/20',
  },
  red: {
    accent: 'border-l-4 border-l-rose-500',
    pill: 'bg-rose-50 text-rose-700 border-rose-200',
    text: 'text-rose-700',
    bg: 'bg-rose-50/20',
  },
};

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
        final_value: values[field.field_key] ?? '',
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

  const canSave = useMemo(() => {
    if (!invoice?.fields) return false;
    if (invoice.duplicate_invoice_id && !duplicateAcknowledged) return false;
    for (const field of invoice.fields) {
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
  }, [invoice, values, actionState, duplicateAcknowledged, originals]);

  const blockingSummary = useMemo(() => {
    if (!invoice?.fields) return '';
    const parts = [];
    if (invoice.duplicate_invoice_id && !duplicateAcknowledged) {
      parts.push('Acknowledge the duplicate flag');
    }
    for (const field of invoice.fields) {
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

  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      {/* Premium Header Area */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Link to="/invoices" className="hover:text-brand transition-colors">Invoices</Link>
            <span>/</span>
            <span className="text-slate-500">Review</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Review & Confirm Invoice</h1>
          <p className="mt-1 text-sm text-slate-500">
            Verify AI-extracted details below. Make corrections where necessary to match the document.
          </p>
        </div>
        <Link className="btn-secondary self-start md:self-center" to="/invoices">
          <ArrowLeft size={16} /> Back to uploads
        </Link>
      </div>

      {/* Visual Legend Card */}
      <div className="mb-6 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">AI Confidence Legend</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex items-center gap-2.5 rounded-lg bg-emerald-50/40 p-2.5 border border-emerald-100/50">
            <span className="h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-50"></span>
            <div className="text-xs">
              <p className="font-semibold text-emerald-950">Auto-Accepted</p>
              <p className="text-emerald-700/80">&gt;90% confidence</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg bg-amber-50/40 p-2.5 border border-amber-100/50">
            <span className="h-2 w-2 rounded-full bg-amber-500 ring-4 ring-amber-50"></span>
            <div className="text-xs">
              <p className="font-semibold text-amber-950">Needs Confirmation</p>
              <p className="text-amber-700/80">60% to 90% confidence</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg bg-orange-50/40 p-2.5 border border-orange-100/50">
            <span className="h-2 w-2 rounded-full bg-orange-500 ring-4 ring-orange-50"></span>
            <div className="text-xs">
              <p className="font-semibold text-orange-950">Suggested Correction</p>
              <p className="text-orange-700/80">&lt;60% confidence</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg bg-rose-50/40 p-2.5 border border-rose-100/50">
            <span className="h-2 w-2 rounded-full bg-rose-500 ring-4 ring-rose-50"></span>
            <div className="text-xs">
              <p className="font-semibold text-rose-950">Missing Value</p>
              <p className="text-rose-700/80">0% confidence / manual</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* Left Side: Document Preview Card */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden h-[540px]">
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
                className="inline-flex items-center gap-1.5 rounded-md bg-white border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
              >
                <Download size={13} /> Download
              </a>
            )}
          </div>
          <div className="flex-1 bg-slate-50 p-4 overflow-y-auto">
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
              <iframe title="Invoice PDF" src={previewUrl} className="h-full w-full bg-white rounded shadow-sm border border-slate-200" />
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

        {/* Right Side: Extraction Form Card */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden h-[540px]">
          <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-800">Extracted Fields</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
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
                  className="mt-0.5 rounded border-rose-300 text-rose-600 focus:ring-rose-500/20"
                />
                <div>
                  <p className="font-semibold">Duplicate Candidate Detected</p>
                  <p className="text-rose-700/80 mt-0.5">
                    This invoice details match Invoice #{invoice.duplicate_invoice_id}. Check this box to acknowledge and proceed.
                  </p>
                </div>
              </label>
            )}

            {/* Render fields as styled cards */}
            <div className="space-y-3">
              {invoice.fields.map((field) => {
                const tone = confidenceTone(field.confidence);
                const confStyle = toneConfig[tone];
                const state = actionState[field.field_key] || 'pending';
                const isConfirmed = state === 'confirmed' || state === 'edited' || state === 'auto';
                
                return (
                  <div 
                    key={field.id} 
                    className={`rounded-lg border border-slate-150 bg-white p-3 shadow-sm transition-all duration-150 ${confStyle.accent} hover:shadow-md`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">
                        {FIELD_LABELS[field.field_key] || field.field_key}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${confStyle.pill}`}>
                          {Number(field.confidence).toFixed(0)}% Confidence
                        </span>
                        {isConfirmed && (
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                            <Check size={10} />
                          </span>
                        )}
                      </div>
                    </div>

                    {field.field_key === 'is_tatkal' ? (
                      <div className={`p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center`}>
                        <label className="flex items-center gap-2 cursor-pointer w-full">
                          <input
                            type="checkbox"
                            checked={normalizeStr(values[field.field_key]) === 'true'}
                            onChange={(event) => onFieldChange(field.field_key, event.target.checked ? 'true' : 'false', field)}
                            className="rounded border-slate-300 text-brand focus:ring-brand/20 w-4 h-4"
                          />
                          <span className="text-sm font-semibold text-slate-700">Flag as Tatkal booking</span>
                        </label>
                      </div>
                    ) : (
                      <input
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-800 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-150"
                        value={values[field.field_key] ?? ''}
                        onChange={(event) => onFieldChange(field.field_key, event.target.value, field)}
                      />
                    )}

                    {/* Action buttons (only show if not auto-accepted) */}
                    {tone === 'yellow' && state === 'pending' && (
                      <div className="mt-2.5 flex items-center justify-between border-t border-slate-100/60 pt-2">
                        <span className="text-[11px] text-slate-500">Please confirm if this value is correct:</span>
                        <button
                          type="button"
                          className="inline-flex h-7 items-center justify-center rounded bg-slate-800 px-3 text-xs font-semibold text-white hover:bg-slate-900 transition-colors shadow-sm"
                          onClick={() => confirmYellow(field.field_key)}
                        >
                          Confirm Value
                        </button>
                      </div>
                    )}

                    {tone === 'orange' && state === 'pending' && (
                      <div className="mt-2.5 flex flex-col gap-1.5 border-t border-slate-100/60 pt-2">
                        <p className="text-[11px] text-slate-500">
                          AI confidence is low. Please correct this value to match the document:
                        </p>
                        <button
                          type="button"
                          className="inline-flex h-7 self-end items-center justify-center rounded bg-slate-800 px-3 text-xs font-semibold text-white hover:bg-slate-900 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => confirmOrangeCorrection(field.field_key)}
                          disabled={normalizeStr(values[field.field_key]) === normalizeStr(originals[field.field_key])}
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
            {canSave ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 size={15} /> All fields ready to save
              </span>
            ) : (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-700">
                <HelpCircle size={15} />
                <span className="truncate max-w-[280px]">{blockingSummary || 'Complete required actions.'}</span>
              </div>
            )}
            
            <button 
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-bold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60 transition-all duration-200 shadow-md focus:outline-none focus:ring-2 focus:ring-brand/10 disabled:shadow-none" 
              disabled={saving || !canSave} 
              onClick={save}
            >
              {saving ? 'Saving...' : 'Save & Complete Review'}
            </button>
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
