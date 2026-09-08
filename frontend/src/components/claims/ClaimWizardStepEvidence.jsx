import { FileText, UploadCloud, Check, ArrowLeft, ArrowRight, AlertTriangle } from 'lucide-react';

export default function ClaimWizardStepEvidence({
  invoices,
  selectedInvoiceIds,
  onToggleInvoice,
  onUploadInvoice,
  reviewWarning,
  sentBackHint,
  onBack,
  onNext,
}) {
  return (
    <div className="space-y-6">
      {/* Attach Invoices Main Card */}
      <div className="panel rounded-xl p-5 shadow-sm border border-slate-200 bg-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 mb-4 gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-800">Attach Invoices</h2>
            <p className="text-xs text-slate-500 mt-0.5">Link your expenses by selecting or uploading relevant invoices.</p>
          </div>
          <button 
            type="button" 
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 transition-all duration-200" 
            onClick={onUploadInvoice}
          >
            <UploadCloud size={14} /> Upload new invoice
          </button>
        </div>

        {sentBackHint && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0 text-rose-600" />
            <span>{sentBackHint}</span>
          </div>
        )}
        
        {reviewWarning && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900 flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0 text-amber-600" />
            <span>{reviewWarning}</span>
          </div>
        )}

        {!invoices.length ? (
          <div 
            onClick={onUploadInvoice}
            className="group cursor-pointer rounded-xl border-2 border-dashed border-slate-200 hover:border-brand/40 hover:bg-slate-50/50 py-12 text-center transition-all duration-200"
          >
            <UploadCloud className="mx-auto text-slate-400 group-hover:text-brand transition-colors" size={32} />
            <p className="mt-2.5 text-xs font-bold text-slate-700">No invoices uploaded yet</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Click here to upload your PDF or image receipts</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {invoices.map((invoice) => {
              const isSelected = selectedInvoiceIds.includes(invoice.id);
              const isReviewed = invoice.status === 'REVIEWED';
              
              return (
                <div
                  key={invoice.id}
                  onClick={() => onToggleInvoice(invoice.id, !isSelected)}
                  className={`relative flex items-center justify-between rounded-xl border-2 p-4 cursor-pointer transition-all duration-200 hover:shadow-md ${
                    isSelected 
                      ? 'border-brand bg-brand/5 shadow-sm ring-1 ring-brand/10' 
                      : 'border-slate-100 bg-slate-50/30 hover:border-slate-200 hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg shadow-sm transition-colors ${
                      isSelected ? 'bg-brand text-white' : 'bg-white text-slate-500 border border-slate-100'
                    }`}>
                      <FileText size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-800 line-clamp-1 max-w-[200px]">
                        {invoice.original_filename}
                      </div>
                      <div className="text-[10px] font-medium text-slate-500 mt-0.5 flex items-center gap-1.5">
                        <span>₹{Number(invoice.total_amount || 0).toLocaleString('en-IN')}</span>
                        <span>•</span>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                          isReviewed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {invoice.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {isSelected && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white shadow-sm">
                      <Check size={11} strokeWidth={3} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-6 flex justify-between border-t border-slate-150 pt-4">
          <button 
            type="button" 
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 bg-white px-5 text-sm font-bold text-slate-700 transition-all duration-200" 
            onClick={onBack}
          >
            <ArrowLeft size={15} /> Back
          </button>
          <button 
            type="button" 
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand/90 transition-all duration-200 shadow-md" 
            onClick={onNext}
          >
            Next: Policy Check <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
