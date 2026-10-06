import { FileText, ShieldCheck, AlertTriangle, AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Store, MapPin } from 'lucide-react';
import { useState } from 'react';

function money(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ClaimWizardStepPolicyCheck({
  claim,
  isGeneral,
  onBack,
  onNext,
  onRequestException,
}) {
  const [expandedTotal, setExpandedTotal] = useState(null); // 'base' | 'tax' | null
  const [expandedExpenseId, setExpandedExpenseId] = useState(null);
  const report = claim?.compliance_report || {};
  const expenses = claim?.expenses || [];
  const gst = report.gst_summary || {};
  const baseAmount = Number(gst.taxable_value ?? gst.total_taxable_value ?? 0);
  const totalTax =
    Number(gst.cgst || 0) + Number(gst.sgst || 0) + Number(gst.igst || 0) + Number(gst.other_tax || 0);
  const totalPayable = baseAmount + totalTax;
  const exceptions = report.exceptions || [];
  const hardBlocks = expenses.filter((expense) => expense.policy_status === 'HARD_BLOCK').length;
  const softFlags = exceptions.length - hardBlocks;
  // Any flagged expense — hard block or soft deviation — must have an exception on file
  // before you can move on; there's no other way to resolve a deviation from this screen.
  const hasUnresolvedDeviations = expenses.some(
    (expense) => expense.policy_status !== 'OK' && !expense.exception_requested
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Expense Breakdown Card */}
        <div className="panel rounded-xl p-5 shadow-sm border border-slate-200 bg-white flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-3 mb-4">
              Expense Policy Verification
            </h2>
            <div className="space-y-3">
              {expenses.map((expense) => {
                const isOk = expense.policy_status === 'OK';
                const isHard = expense.policy_status === 'HARD_BLOCK';
                const invoiceBreakdown = expense.invoice_breakdown || [];
                const isExpanded = expandedExpenseId === expense.id;

                return (
                  <div
                    key={expense.id}
                    className={`rounded-xl border p-3.5 transition-all ${
                      isHard
                        ? 'border-rose-100 bg-rose-50/20'
                        : isOk
                          ? 'border-slate-100 bg-slate-50/10'
                          : 'border-amber-100 bg-amber-50/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <button
                        type="button"
                        disabled={invoiceBreakdown.length === 0}
                        onClick={() => setExpandedExpenseId(isExpanded ? null : expense.id)}
                        className="space-y-1 text-left disabled:cursor-default"
                      >
                        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <FileText size={14} className="text-slate-400" />
                          <span>{expense.category_name}</span>
                          {invoiceBreakdown.length > 0 && (
                            <ChevronDown
                              size={12}
                              className={`text-slate-400 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          )}
                        </div>
                        <div className="text-[10px] font-medium text-slate-500">
                          {expense.cap_amount ? `Cap: ₹${money(expense.cap_amount)}` : 'No policy cap'}
                          {invoiceBreakdown.length > 0 &&
                            ` · ${invoiceBreakdown.length} invoice${invoiceBreakdown.length > 1 ? 's' : ''}`}
                        </div>
                      </button>

                      <div className="text-right space-y-1.5">
                        <div className="text-xs font-bold text-slate-800">₹{money(expense.amount)}</div>

                        {!isOk ? (
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-all ${
                              expense.exception_requested
                                ? 'bg-slate-100 text-slate-500 cursor-default'
                                : isHard
                                  ? 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                                  : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                            }`}
                            onClick={() => !expense.exception_requested && onRequestException(expense)}
                          >
                            {isHard ? <AlertCircle size={10} /> : <AlertTriangle size={10} />}
                            <span>{expense.exception_requested ? 'Exception Requested' : 'Request Exception'}</span>
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-800">
                            <CheckCircle2 size={9} /> Verified
                          </span>
                        )}
                      </div>
                    </div>

                    {isExpanded && invoiceBreakdown.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-slate-150 pt-2.5">
                        {invoiceBreakdown.map((inv) => (
                          <div
                            key={inv.invoice_id}
                            className="flex items-center justify-between gap-3 rounded-lg bg-white/70 border border-slate-100 px-2.5 py-1.5"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 truncate">
                                <Store size={11} className="text-slate-400 shrink-0" />
                                <span className="truncate">{inv.vendor_name || inv.original_filename || 'Invoice'}</span>
                              </div>
                              {inv.place_of_supply && (
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                  <MapPin size={10} className="shrink-0" />
                                  <span>{inv.place_of_supply}</span>
                                </div>
                              )}
                            </div>
                            <span className="text-[11px] font-semibold text-slate-600 shrink-0">
                              ₹{money(inv.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Financial Totals Section */}
          <div className="mt-6 border-t border-slate-150 pt-4 space-y-2 text-xs font-medium text-slate-600">
            <div>
              <button
                type="button"
                onClick={() => setExpandedTotal(expandedTotal === 'base' ? null : 'base')}
                className="flex w-full items-center justify-between"
              >
                <span className="inline-flex items-center gap-1 text-slate-600">
                  Total Base Amount
                  <ChevronDown
                    size={12}
                    className={`text-slate-400 transition-transform duration-150 ${expandedTotal === 'base' ? 'rotate-180' : ''}`}
                  />
                </span>
                <span className="font-semibold text-slate-800">₹{money(baseAmount)}</span>
              </button>
              {expandedTotal === 'base' ? (
                <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2.5">
                  {expenses.length ? (
                    expenses.map((expense) => (
                      <div key={expense.id} className="flex justify-between text-[11px] text-slate-500">
                        <span>{expense.category_name}</span>
                        <span>₹{money(expense.taxable_value)}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-[11px] text-slate-400">No expenses yet</span>
                  )}
                </div>
              ) : null}
            </div>
            <div>
              <button
                type="button"
                onClick={() => setExpandedTotal(expandedTotal === 'tax' ? null : 'tax')}
                className="flex w-full items-center justify-between"
              >
                <span className="inline-flex items-center gap-1 text-slate-600">
                  Total Tax
                  <ChevronDown
                    size={12}
                    className={`text-slate-400 transition-transform duration-150 ${expandedTotal === 'tax' ? 'rotate-180' : ''}`}
                  />
                </span>
                <span className="font-semibold text-slate-800">₹{money(totalTax)}</span>
              </button>
              {expandedTotal === 'tax' ? (
                <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2.5">
                  {[
                    ['CGST', gst.cgst],
                    ['SGST', gst.sgst],
                    ['IGST', gst.igst],
                    ['Other Taxes', gst.other_tax],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between text-[11px] text-slate-500">
                      <span>{label}</span>
                      <span>₹{money(value)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex justify-between border-t border-dashed border-slate-200 pt-2.5">
              <span>Total Payable</span>
              <span className="font-semibold text-slate-800">₹{money(totalPayable)}</span>
            </div>
            {Number(claim?.advance_received) > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>Less: Advance Received</span>
                <span>-₹{money(claim?.advance_received)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-dashed border-slate-200 pt-2.5">
              <span>Net Reimbursement Payable</span>
              <span className="text-brand">₹{money(report.net_payable)}</span>
            </div>
          </div>
        </div>

        {/* GST Summary Card */}
        <div className="panel rounded-xl p-5 shadow-sm border border-slate-200 bg-white flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-3 mb-4">
              GST & Tax Allocation
            </h2>
            <div className="divide-y divide-slate-100">
              {[
                ['Total Taxable Value', gst.total_taxable_value],
                ['Central GST (CGST)', gst.cgst],
                ['State GST (SGST)', gst.sgst],
                ['Integrated GST (IGST)', gst.igst],
                ['Other Taxes (non-GST)', gst.other_tax],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-3 text-xs font-medium text-slate-600">
                  <span>{label}</span>
                  <span className="font-semibold text-slate-800">₹{money(value)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 mt-6">
            <div className="flex justify-between text-xs font-bold text-slate-800">
              <span>Total Input Tax Credit (ITC) Eligible</span>
              <span className="text-emerald-700">₹{money(gst.itc_eligible_amount)}</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              * ITC benefit automatically calculated for registered corporate accounts. Other Taxes
              (foreign VAT/sales tax, etc.) are never ITC-eligible.
            </p>
          </div>
        </div>
      </div>

      {/* Compliance Warning Banner */}
      <div className={`rounded-xl border p-4 text-xs font-bold flex items-start gap-3 shadow-sm ${
        hardBlocks 
          ? 'border-rose-200 bg-rose-50 text-rose-800' 
          : exceptions.length 
            ? 'border-amber-200 bg-amber-50 text-amber-900' 
            : 'border-emerald-250 bg-emerald-50 text-emerald-800'
      }`}>
        <div className="mt-0.5">
          {hardBlocks ? (
            <AlertCircle className="text-rose-600" size={16} />
          ) : exceptions.length ? (
            <AlertTriangle className="text-amber-600" size={16} />
          ) : (
            <ShieldCheck className="text-emerald-600" size={16} />
          )}
        </div>
        <div className="space-y-0.5">
          <div>
            {!exceptions.length &&
              `Compliance Verified: All expenses conform to internal ${isGeneral ? 'reimbursement' : 'travel'} policies.`}
            {!!softFlags && !hardBlocks && `Action Required: ${softFlags} policy deviation(s) identified. Request an exception for each flagged item to proceed.`}
            {!!hardBlocks && `Action Required: ${hardBlocks} hard policy restriction(s) detected. You must submit exception request details to proceed.`}
          </div>
          {exceptions.length > 0 && (
            <div className="text-[10px] font-medium text-rose-700 mt-1">
              * Ensure you select &apos;Request Exception&apos; and provide justification for the flagged line items.
            </div>
          )}
        </div>
      </div>

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
          onClick={onNext}
          disabled={hasUnresolvedDeviations}
        >
          Next: Review & Submit <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
