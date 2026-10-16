import { Bus, FileText, Plane, Send, Train } from 'lucide-react';

import { Card, Note, StepActions, dateSpan, dayMonth, foreignAmount, inr } from './ClaimWizardShell';

const MODE_ICON = { FLIGHT: Plane, TRAIN: Train, BUS: Bus };
const TRAVEL_TYPE = { PROJECT: 'Project', NON_PROJECT: 'Non-project' };

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-[13px] font-bold text-ink">{children}</div>
    </div>
  );
}

export default function ClaimWizardStepSubmit({
  claim,
  isGeneral,
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
  const selectedTrips = trips
    .filter((trip) => selectedTripIds.includes(trip.id))
    .sort((a, b) => new Date(a.travel_date) - new Date(b.travel_date));
  const selectedInvoices = invoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id));
  const invoiceTotal = selectedInvoices.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);
  // Flagged expenses don't block this button — Submit opens the exceptions modal (one tab per
  // flagged expense) and only sends the claim once every reason is filled in.
  const flagged = (claim?.expenses || []).filter((expense) => expense.exception_reason_required);
  const exceptionCount = flagged.length;

  return (
    <>
      <Card title="Check and submit" sub="This is what goes to your approvers.">
        {!isGeneral ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Fact label="Trip">
              {claim?.from_city || claim?.office_location || '—'} → {claim?.destination_city || '—'}
              <span className="block font-medium text-slate-500">{dateSpan(claim?.departure_date, claim?.return_date) || '—'}</span>
            </Fact>
            <Fact label="Purpose">
              {claim?.trip_purpose || '—'}
              <span className="block font-medium text-slate-500">
                {TRAVEL_TYPE[claim?.travel_type] || claim?.travel_type || ''}
                {claim?.project_code ? ` · ${claim.project_code}` : ''}
                {claim?.office_location ? ` · from the ${claim.office_location} office` : ''}
              </span>
            </Fact>
          </div>
        ) : null}

        {!isGeneral ? (
          <div>
            <div className="mb-1 text-xs font-bold text-slate-500">Bookings ({selectedTrips.length})</div>
            {selectedTrips.length ? (
              <div className="divide-y divide-slate-100 border-y border-slate-100">
                {selectedTrips.map((trip) => {
                  const Icon = MODE_ICON[trip.mode] || Plane;
                  return (
                    <div key={trip.id} className="flex items-center gap-2 py-1.5 text-[12.5px] text-slate-700">
                      <Icon size={13} className="shrink-0 text-slate-400" />
                      <span className="font-semibold text-ink">
                        {trip.from_city} → {trip.to_city}
                      </span>
                      <span className="text-slate-500">
                        · {dayMonth(trip.travel_date)}
                        {trip.travel_class ? ` · ${trip.travel_class}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[12.5px] text-slate-400">No travel desk bookings linked.</p>
            )}
          </div>
        ) : null}

        <div>
          <div className="mb-1 text-xs font-bold text-slate-500">Invoices ({selectedInvoices.length})</div>
          {selectedInvoices.length ? (
            <div className="divide-y divide-slate-100 border-y border-slate-100">
              {selectedInvoices.map((invoice) => {
                const foreign = foreignAmount(invoice);
                return (
                  <div key={invoice.id} className="flex items-center justify-between gap-2.5 py-1.5 text-[12.5px]">
                    <span className="flex min-w-0 items-center gap-2 text-slate-700">
                      <FileText size={13} className="shrink-0 text-slate-400" />
                      <span className="min-w-0 break-all">{invoice.original_filename}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <b className="font-mono tabular-nums text-ink">{inr(invoice.total_amount)}</b>
                      {foreign ? <span className="block text-[11px] font-semibold text-slate-500">from {foreign}</span> : null}
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-between gap-2.5 py-1.5 text-[12.5px] font-bold text-ink">
                <span>Total</span>
                <span className="font-mono tabular-nums">{inr(invoiceTotal)}</span>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-400">No invoices linked.</p>
          )}
        </div>

        {exceptionCount ? (
          <Note tone="amber" title={`${exceptionCount === 1 ? 'An exception' : `${exceptionCount} exceptions`} will be requested`}>
            {flagged.map((expense) => expense.category_name).join(', ')} {exceptionCount === 1 ? 'is' : 'are'} outside policy. When you submit,
            you&apos;ll be asked why.
          </Note>
        ) : null}

        <label
          className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-[12.5px] text-slate-700 ${
            declarationChecked ? 'border-brand/40 bg-brand/[0.04]' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <input
            type="checkbox"
            checked={declarationChecked}
            onChange={(e) => onToggleDeclaration(e.target.checked)}
            className="mt-0.5 h-[17px] w-[17px] shrink-0 accent-brand"
          />
          <span className="select-none">
            I certify that all expenses claimed are true, correct, and were incurred exclusively for official business purposes. I understand that any false
            declarations are subject to disciplinary action under corporate compliance guidelines.
          </span>
        </label>
      </Card>

      <StepActions
        onBack={onBack}
        onNext={onSubmit}
        nextLabel="Submit claim"
        nextIcon={<Send size={14} />}
        nextDisabled={!declarationChecked}
        busy={submitting}
        busyLabel="Submitting…"
        title={exceptionCount ? `You'll give a reason for ${exceptionCount} policy exception${exceptionCount > 1 ? 's' : ''} next` : undefined}
      />
    </>
  );
}
