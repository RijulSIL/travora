import { Search, UploadCloud } from 'lucide-react';
import { useState } from 'react';

import { Card, Note, StepActions, foreignAmount, inr } from './ClaimWizardShell';

export default function ClaimWizardStepEvidence({
  invoices,
  selectedInvoiceIds,
  onToggleInvoice,
  onUploadInvoice,
  reviewWarning,
  sentBackHint,
  onBack,
  onNext,
  busy = false,
  uploading = false,
  title = 'Which bills are you claiming?',
  description = "Tick the invoices for this claim, or upload a new one. Invoices already on another claim don't show here.",
  nextLabel = 'Next: Policy check',
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? invoices.filter((invoice) => (invoice.original_filename || '').toLowerCase().includes(q)) : invoices;
  const selected = invoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id));
  const selectedTotal = selected.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);
  const allShownSelected = shown.length > 0 && shown.every((invoice) => selectedInvoiceIds.includes(invoice.id));

  const toggleAllShown = () => {
    shown.forEach((invoice) => {
      const isOn = selectedInvoiceIds.includes(invoice.id);
      if (allShownSelected ? isOn : !isOn) onToggleInvoice(invoice.id, !allShownSelected);
    });
  };

  return (
    <>
      <Card
        title={title}
        sub={description}
        action={
          <button
            type="button"
            disabled={uploading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={onUploadInvoice}
          >
            <UploadCloud size={14} /> {uploading ? 'Uploading…' : 'Upload a bill'}
          </button>
        }
      >
        {sentBackHint ? <Note tone="rose">{sentBackHint}</Note> : null}
        {reviewWarning ? <Note tone="amber">{reviewWarning}</Note> : null}

        {!invoices.length ? (
          <button
            type="button"
            onClick={onUploadInvoice}
            className="group w-full rounded-xl border-2 border-dashed border-slate-200 py-10 text-center hover:border-brand/40 hover:bg-slate-50/50"
          >
            <UploadCloud className="mx-auto text-slate-400 group-hover:text-brand" size={30} />
            <p className="mt-2 text-[13px] font-bold text-slate-700">No invoices to add yet</p>
            <p className="mt-0.5 text-xs text-slate-500">Upload a PDF or a photo of the bill</p>
          </button>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <label className="relative min-w-[200px] flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  aria-label="Search invoices"
                  className="h-[34px] w-full rounded-[10px] border border-slate-200 bg-white pl-8 pr-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  placeholder="Search by file name"
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
            <div className="space-y-1.5">
              {shown.map((invoice) => {
                const isOn = selectedInvoiceIds.includes(invoice.id);
                const reviewed = invoice.status === 'REVIEWED';
                const foreign = foreignAmount(invoice);
                return (
                  <label
                    key={invoice.id}
                    className={`grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2.5 ${
                      isOn ? 'border-brand bg-brand/[0.04]' : 'border-slate-200 hover:bg-slate-50/70'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={isOn}
                      onChange={(e) => onToggleInvoice(invoice.id, e.target.checked)}
                    />
                    <div className="min-w-0">
                      <b className="block truncate text-[13px] text-ink">{invoice.original_filename}</b>
                      <span className={`text-xs ${reviewed ? 'text-slate-500' : 'font-bold text-amber-700'}`}>
                        {reviewed ? 'Reviewed · ready to claim' : `${invoice.status.replaceAll('_', ' ').toLowerCase()} · review it first`}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[13px] font-semibold tabular-nums text-ink">{inr(invoice.total_amount)}</div>
                      {foreign ? <div className="text-[11px] font-semibold text-slate-500">from {foreign}</div> : null}
                    </div>
                  </label>
                );
              })}
              {!shown.length ? <p className="py-4 text-center text-[12.5px] text-slate-500">No invoice matches “{query}”.</p> : null}
            </div>
          </>
        )}
      </Card>

      <StepActions onBack={onBack} onNext={onNext} nextLabel={nextLabel} busy={busy} />
    </>
  );
}
