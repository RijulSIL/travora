import { MapPin, Calendar, Plane, FileText, ArrowLeft, Send } from 'lucide-react';

function money(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ClaimWizardStepSubmit({
  claim,
  trips,
  invoices,
  selectedTripIds,
  selectedInvoiceIds,
  declarationChecked,
  onToggleDeclaration,
  onBack,
  onSubmit,
  submitting,
}) {
  const selectedTrips = trips.filter((trip) => selectedTripIds.includes(trip.id));
  const selectedInvoices = invoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id));
  const hardBlocks = (claim?.expenses || []).some((expense) => expense.policy_status === 'HARD_BLOCK');

  return (
    <div className="space-y-6">
      {/* Step 4 Review & Submit Card */}
      <div className="panel rounded-xl p-5 shadow-sm border border-slate-200 bg-white">
        <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2">
          <span>Review Claim Summary</span>
          <span className="inline-flex items-center rounded bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-600 uppercase">
            Final Step
          </span>
        </h2>
        
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-brand/10 text-brand">
              <MapPin size={16} />
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Office & Destination</div>
              <div className="text-xs font-bold text-slate-800">
                {claim?.office_location || '—'} → {claim?.destination_city || '—'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-brand/10 text-brand">
              <Calendar size={16} />
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Travel Timeline</div>
              <div className="text-xs font-bold text-slate-800">
                {claim?.departure_date || '—'} to {claim?.return_date || '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Linked Travel Desk Bookings */}
      <div className="panel rounded-xl p-5 shadow-sm border border-slate-200 bg-white">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          Linked Bookings ({selectedTrips.length})
        </h3>
        
        {!selectedTrips.length ? (
          <p className="text-xs font-medium text-slate-400 italic">No travel desk bookings linked.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {selectedTrips.map((trip) => (
              <div key={trip.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="flex h-7 w-7 items-center justify-center rounded bg-slate-100 text-slate-500 border border-slate-200">
                  <Plane size={14} />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-800">
                    {trip.from_city} → {trip.to_city}
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium">
                    Date: {trip.travel_date} · Class: {trip.travel_class}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Linked Expense Invoices */}
      <div className="panel rounded-xl p-5 shadow-sm border border-slate-200 bg-white">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          Linked Invoices ({selectedInvoices.length})
        </h3>
        
        {!selectedInvoices.length ? (
          <p className="text-xs font-medium text-slate-400 italic">No receipts or invoices linked.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {selectedInvoices.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-slate-100 text-slate-500 border border-slate-200">
                    <FileText size={14} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 max-w-[280px] truncate">
                      {invoice.original_filename}
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium">
                      Status: {invoice.status}
                    </div>
                  </div>
                </div>
                <div className="text-xs font-bold text-slate-800">
                  ₹{money(invoice.total_amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legal Declaration */}
      <label className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-all duration-200 ${
        declarationChecked 
          ? 'border-brand/40 bg-brand/5 shadow-sm ring-1 ring-brand/10' 
          : 'border-slate-200 hover:border-slate-300 bg-white'
      }`}>
        <input 
          type="checkbox" 
          checked={declarationChecked} 
          onChange={(e) => onToggleDeclaration(e.target.checked)} 
          className="mt-0.5"
        />
        <span className="text-xs font-medium text-slate-700 select-none">
          I certify that all expenses claimed are true, correct, and were incurred exclusively for official business purposes. I understand that any false declarations are subject to disciplinary action under corporate compliance guidelines.
        </span>
      </label>

      {/* Footer Actions */}
      <div className="mt-6 flex justify-between border-t border-slate-150 pt-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <button 
          type="button" 
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 bg-white px-5 text-sm font-bold text-slate-700 transition-all duration-200" 
          onClick={onBack}
        >
          <ArrowLeft size={15} /> Back
        </button>
        <button 
          type="button" 
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand/90 transition-all duration-200 shadow-md disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none" 
          onClick={onSubmit} 
          disabled={submitting || !declarationChecked || hardBlocks}
        >
          <Send size={14} /> {submitting ? 'Submitting...' : 'Submit Claim'}
        </button>
      </div>
    </div>
  );
}
