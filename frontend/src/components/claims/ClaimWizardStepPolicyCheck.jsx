import { FileText, ShieldCheck, AlertTriangle, AlertCircle, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';

function money(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ClaimWizardStepPolicyCheck({
  claim,
  onBack,
  onNext,
  onRequestException,
}) {
  const report = claim?.compliance_report || {};
  const expenses = claim?.expenses || [];
  const gst = report.gst_summary || {};
  const exceptions = report.exceptions || [];
  const hardBlocks = expenses.filter((expense) => expense.policy_status === 'HARD_BLOCK').length;
  const softFlags = exceptions.length - hardBlocks;
  const hasUnresolvedHardBlocks = expenses.some(
    (expense) => expense.policy_status === 'HARD_BLOCK' && !expense.exception_requested
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
                
                return (
                  <div 
                    key={expense.id} 
                    className={`flex items-start justify-between gap-4 rounded-xl border p-3.5 transition-all ${
                      isHard 
                        ? 'border-rose-100 bg-rose-50/20' 
                        : isOk 
                          ? 'border-slate-100 bg-slate-50/10' 
                          : 'border-amber-100 bg-amber-50/10'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <FileText size={14} className="text-slate-400" />
                        <span>{expense.category_name}</span>
                      </div>
                      <div className="text-[10px] font-medium text-slate-500">
                        {expense.cap_amount ? `Cap: ₹${money(expense.cap_amount)}` : 'No policy cap'}
                      </div>
                    </div>
                    
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
                );
              })}
            </div>
          </div>

          {/* Financial Totals Section */}
          <div className="mt-6 border-t border-slate-150 pt-4 space-y-2 text-xs font-medium text-slate-600">
            <div className="flex justify-between">
              <span>Total Claimed Amount</span>
              <span className="font-semibold text-slate-800">₹{money(report.total_claimed)}</span>
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
              * ITC benefit automatically calculated for registered corporate accounts.
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
            {!exceptions.length && 'Compliance Verified: All expenses conform to internal travel policies.'}
            {!!softFlags && !hardBlocks && `Policy Check: ${softFlags} policy deviation(s) identified. You can request exception approval or adjust your amounts.`}
            {!!hardBlocks && `Action Required: ${hardBlocks} hard policy restriction(s) detected. You must submit exception request details to proceed.`}
          </div>
          {hardBlocks > 0 && (
            <div className="text-[10px] font-medium text-rose-700 mt-1">
              * Ensure you select 'Request Exception' and provide justification for the flagged line items.
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
          disabled={hasUnresolvedHardBlocks}
        >
          Next: Review & Submit <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
