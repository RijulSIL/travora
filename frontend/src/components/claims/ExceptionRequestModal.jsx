import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X, ShieldAlert, AlertCircle, FileText, Store } from 'lucide-react';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { reimbursementApi } from '../../services/reimbursementApi';

function money(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

// Left-hand invoice preview for the currently selected invoice — there's no bounding-box data
// from extraction to draw an exact highlight on the image itself, so instead this calls out the
// specific line item(s) (text + amount) that fall under the flagged category, for the employee
// to visually cross-reference against the preview themselves.
function InvoicePreviewPane({ invoice }) {
  const [fileUrl, setFileUrl] = useState('');
  const [contentType, setContentType] = useState('');
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!invoice?.invoice_id) return undefined;
    let cancelled = false;
    let nextUrl = '';
    setFileUrl('');
    setLoadError(false);
    reimbursementApi
      .invoiceFileBlob(invoice.invoice_id)
      .then((res) => {
        if (cancelled) return;
        const type = res.headers['content-type'] || 'application/octet-stream';
        nextUrl = URL.createObjectURL(new Blob([res.data], { type }));
        setContentType(type);
        setFileUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [invoice?.invoice_id]);

  const isPdf = contentType.includes('pdf') || (invoice?.original_filename || '').toLowerCase().endsWith('.pdf');

  return (
    <div className="flex flex-col gap-3">
      <div className="h-[400px] overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loadError ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-[11px] font-medium text-slate-400">
            Could not load invoice preview.
          </div>
        ) : !fileUrl ? (
          <div className="flex h-full items-center justify-center p-4 text-[11px] font-medium text-slate-400">
            Loading preview...
          </div>
        ) : isPdf ? (
          <iframe
            title="Invoice preview"
            src={`${fileUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            className="h-full w-full border-0"
          />
        ) : (
          <img src={fileUrl} alt={invoice.original_filename} className="h-full w-full object-contain" />
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 truncate">
          <Store size={12} className="text-slate-400 shrink-0" />
          <span className="truncate">{invoice.vendor_name || invoice.original_filename}</span>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-1">
          <div className="text-[9px] font-bold uppercase tracking-wide text-amber-600">
            Flagged on this invoice
          </div>
          {(invoice.line_items || []).map((line, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2 text-[11px] text-amber-900">
              <span className="truncate font-medium">{line.description}</span>
              <span className="font-bold shrink-0">₹{money(line.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ExceptionRequestModal({ open, expense, onClose, onSubmit, loading }) {
  const [reason, setReason] = useState('');
  const invoices = useMemo(() => expense?.invoice_breakdown || [], [expense]);
  const [activeInvoiceId, setActiveInvoiceId] = useState(null);
  useBodyScrollLock(open);

  useEffect(() => {
    setActiveInvoiceId(invoices[0]?.invoice_id ?? null);
  }, [invoices]);

  if (!open || !expense) return null;

  const activeInvoice = invoices.find((inv) => inv.invoice_id === activeInvoiceId) || invoices[0] || null;

  // The backend computes this once (reimbursement_service._dedicated_exception_type) and sends
  // it back on the expense — reading it directly instead of re-deriving a separate guess here
  // is what fixed a past bug where this frontend map and the backend's own mapping disagreed on
  // which type a hotel exception should use, silently leaving it unresolved forever.
  const exceptionType = expense.exception_type || `${String(expense.category_name || 'GENERAL').toUpperCase()}_DEVIATION`;
  // Any cap-driven category (Hotel, Food, Incidental) carries a numeric cap_amount, not just
  // Hotel — show the Policy Cap / Excess Deviation box whenever one is actually present.
  const isNumericCap = expense.cap_amount != null;
  const excess = Math.max(Number(expense.amount || 0) - Number(expense.cap_amount || 0), 0);

  const getExceptionFriendlyName = (type) => {
    switch (type) {
      case 'TRAIN_TATKAL':
        return 'Tatkal Train Ticket Exception';
      case 'AIR_TRAVEL_L5_L6':
        return 'Restricted Air Class Exception';
      case 'HIRED_TAXI_UNAUTHORIZED':
        return 'Unauthorized Local Hired Taxi Exception';
      case 'ROOM_RENT_DEVIATION':
        return 'Room Rent Limit Deviation';
      case 'FOOD_DEVIATION':
        return 'Food & Meals Limit Deviation';
      case 'INCIDENTAL_DEVIATION':
        return 'Incidental Expenses Limit Deviation';
      default:
        return 'Policy Exception Request';
    }
  };

  const getExceptionDescription = (type) => {
    switch (type) {
      case 'TRAIN_TATKAL':
        return 'Tatkal train bookings require explicit justification and Function Head approval.';
      case 'AIR_TRAVEL_L5_L6':
        return 'Air travel by your level code is conditional and requires CEO exception approval.';
      case 'HIRED_TAXI_UNAUTHORIZED':
        return 'Hired taxi claims for your level code require approval as local conveyance exceptions.';
      case 'ROOM_RENT_DEVIATION':
        return 'Hotel room rent exceeds the policy cap for your destination city group.';
      case 'FOOD_DEVIATION':
        return 'Food & Meals spend exceeds the policy cap for your level/city.';
      case 'INCIDENTAL_DEVIATION':
        return 'Incidental expenses exceed the policy cap for your level/city.';
      default:
        return 'This expense violates the company travel policy and requires approval.';
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
      <div
        className={`w-full scale-up rounded-2xl border border-slate-100 bg-white shadow-2xl transition-all duration-300 overflow-hidden flex flex-col max-h-[88vh] ${
          invoices.length > 0 ? 'max-w-5xl' : 'max-w-lg'
        }`}
      >
        {/* Header */}
        <div className="bg-slate-50 border-b border-slate-100 px-5 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-500 ring-4 ring-amber-50/50">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">{getExceptionFriendlyName(exceptionType)}</h3>
              <p className="text-[10px] font-medium text-slate-500">Raises policy exception workflow</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col md:flex-row min-h-0 flex-1 overflow-hidden">
          {/* Invoice preview pane */}
          {invoices.length > 0 && activeInvoice && (
            <div className="w-full md:w-[560px] shrink-0 border-b md:border-b-0 md:border-r border-slate-100 bg-slate-50/40 p-4 flex flex-col gap-3 overflow-y-auto max-h-full">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <FileText size={12} />
                <span>Invoice{invoices.length > 1 ? 's' : ''} for this expense</span>
              </div>
              {invoices.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {invoices.map((inv) => (
                    <button
                      key={inv.invoice_id}
                      type="button"
                      onClick={() => setActiveInvoiceId(inv.invoice_id)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold truncate max-w-[130px] transition-all ${
                        inv.invoice_id === activeInvoiceId
                          ? 'bg-brand text-white'
                          : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-100'
                      }`}
                      title={inv.vendor_name || inv.original_filename}
                    >
                      {inv.vendor_name || inv.original_filename}
                    </button>
                  ))}
                </div>
              )}
              <InvoicePreviewPane invoice={activeInvoice} />
            </div>
          )}

          {/* Content */}
          <div className="p-5 space-y-3 overflow-y-auto min-h-0 flex-1">
          {/* Warning Banner */}
          <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-3 flex items-start gap-2.5 text-[11px] text-amber-900 leading-snug">
            <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
            <div>
              <span className="font-bold">Policy Breach: </span>
              {getExceptionDescription(exceptionType)}
            </div>
          </div>

          {/* Metrics & Details */}
          <div className="rounded-xl border border-slate-150 bg-slate-50/50 p-3.5 space-y-3">
            <div className="grid grid-cols-2 gap-y-2.5 text-[11px] font-semibold text-slate-500">
              <div>Expense Category:</div>
              <div className="text-slate-800 text-right font-bold">{expense.category_name}</div>
              
              <div>Claimed Amount:</div>
              <div className="text-slate-800 text-right font-bold">₹{Number(expense.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>

            {isNumericCap && (
              <div className="border-t border-slate-150/60 pt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-100/50 p-2">
                  <div className="text-[10px] font-medium text-slate-500">Policy Cap</div>
                  <div className="text-xs font-bold text-slate-700">₹{Number(expense.cap_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>
                <div className="rounded-lg p-2 col-span-2 border border-rose-100 bg-rose-50/20 text-rose-700">
                  <div className="text-[10px] font-bold text-rose-500">Excess Deviation</div>
                  <div className="text-xs font-bold">₹{excess.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>
              </div>
            )}
          </div>

          {/* Justification Textarea */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">
              Reason for Exception <span className="text-slate-400 font-normal">(Minimum 20 characters)</span>
            </label>
            <div className="relative">
              <textarea
                className="w-full min-h-[90px] rounded-xl border border-slate-200 bg-slate-50/30 p-2.5 text-[11px] font-medium text-slate-800 placeholder-slate-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand/10 transition-all duration-200 resize-none leading-relaxed"
                placeholder="Describe why this policy deviation was necessary (e.g. client emergencies, unavailability of standard booking class, etc.)..."
                value={reason} 
                onChange={(e) => setReason(e.target.value)} 
              />
              <div className={`absolute bottom-3 right-3 text-[9px] font-bold ${reason.trim().length >= 20 ? 'text-emerald-600' : 'text-slate-400'}`}>
                {reason.trim().length} / 20+ chars
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 flex items-start gap-2 border border-slate-100">
            <AlertCircle size={14} className="text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[10px] leading-relaxed text-slate-500">
              This request will trigger an approval workflow involving your Function Head, HRBP, and Finance/CEO routes. Review status can be tracked from your dashboard.
            </p>
          </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 flex justify-end gap-2.5 shrink-0">
          <button 
            type="button" 
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-all shadow-sm focus:outline-none"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-brand px-5 text-xs font-bold text-white hover:bg-brand/90 transition-all shadow-md disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-brand/10"
            disabled={loading || reason.trim().length < 20}
            onClick={() => onSubmit({ reason, exceptionType })}
          >
            {loading ? 'Submitting...' : 'Submit Exception Request'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
