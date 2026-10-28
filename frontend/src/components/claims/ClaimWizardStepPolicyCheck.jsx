import { AlertCircle, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';

import { Card, Note, StepActions, inr } from './ClaimWizardShell';

// What happens to an expense at submit. Exceptions are raised together from the submit step's
// modal, never one by one here.
function StatusPill({ expense }) {
  const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold';
  if (!expense.exception_type) {
    return (
      <span className={`${pill} bg-emerald-50 text-emerald-700`}>
        <CheckCircle2 size={11} /> Within policy
      </span>
    );
  }
  if (!expense.exception_reason_required) {
    const pending = expense.exception_status && expense.exception_status !== 'APPROVED';
    // On a claim whose exceptions were sent back: this one an approver already accepted.
    const acceptedSoFar = pending && (expense.exception_decisions || []).some((d) => d.decision === 'ACCEPTED');
    return (
      <span className={`${pill} ${pending && !acceptedSoFar ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
        <CheckCircle2 size={11} /> {acceptedSoFar ? 'Exception accepted so far' : pending ? 'Exception requested' : 'Exception approved'}
      </span>
    );
  }
  if (expense.exception_status === 'SENT_BACK' && expense.exception_mode !== 'BLOCK') {
    return (
      <span className={`${pill} bg-orange-50 text-orange-700`} title={expense.exception_comment || undefined}>
        <AlertTriangle size={11} /> Sent back
      </span>
    );
  }
  if (expense.exception_mode === 'BLOCK') {
    return (
      <span className={`${pill} bg-rose-50 text-rose-700`}>
        <AlertCircle size={11} /> Not allowed by policy
      </span>
    );
  }
  const over = expense.cap_amount != null && Number(expense.amount) > Number(expense.cap_amount);
  return (
    <span className={`${pill} ${expense.policy_status === 'HARD_BLOCK' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
      <AlertTriangle size={11} /> {over ? `Over by ${inr(Number(expense.amount) - Number(expense.cap_amount))}` : 'Outside policy'}
    </span>
  );
}

function ExpenseCard({ expense, cityGroup }) {
  const amount = Number(expense.amount || 0);
  const cap = expense.cap_amount != null ? Number(expense.cap_amount) : null;
  const flagged = Boolean(expense.exception_reason_required);
  const blocked = flagged && expense.exception_mode === 'BLOCK';
  const hard = expense.policy_status === 'HARD_BLOCK';
  const scale = cap ? Math.max(amount, cap) : 1;
  const breakdown = expense.invoice_breakdown || [];
  const lineCount = breakdown.reduce((n, inv) => n + (inv.line_items?.length || 0), 0);
  const vendors = breakdown.map((inv) => inv.vendor_name || inv.original_filename).filter(Boolean);
  const files = breakdown.map((inv) => inv.original_filename).filter(Boolean);
  const bar = blocked || (flagged && hard) ? 'bg-rose-600' : flagged ? 'bg-amber-500' : 'bg-emerald-600';

  return (
    <div className={`space-y-2 rounded-xl border p-3 ${blocked || (flagged && hard) ? 'border-rose-200 bg-rose-50/30' : flagged ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0">
          <b className="text-[13.5px] text-ink">{expense.category_name}</b>
          {vendors.length || files.length ? (
            <div className="break-words text-xs text-slate-500">
              {[vendors.join(', '), files.join(', ')].filter(Boolean).join(' · ')}
            </div>
          ) : null}
        </div>
        <div className="text-right">
          <div className="font-mono text-sm font-semibold tabular-nums text-ink">{inr(amount)}</div>
          <StatusPill expense={expense} />
        </div>
      </div>
      {cap ? (
        <>
          <div className="relative h-2 rounded-full bg-slate-100" aria-hidden="true">
            <i className={`absolute inset-y-0 left-0 rounded-full ${bar}`} style={{ width: `${(amount / scale) * 100}%` }} />
            <span className="absolute -bottom-[3px] -top-[3px] w-0.5 bg-ink/55" style={{ left: `${(cap / scale) * 100}%` }} />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
            <span>
              Cap {inr(cap)}
              {cityGroup ? ` (Group ${cityGroup})` : ''}
            </span>
            {flagged && !blocked ? <span>Needs an exception: you&apos;ll be asked why when you submit</span> : null}
            {blocked ? <span className="font-bold text-rose-700">Remove this invoice to submit</span> : null}
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-500">
          No cap for this category
          {blocked ? <span className="ml-2 font-bold text-rose-700">Remove this invoice to submit</span> : null}
        </div>
      )}
      {expense.exception_status === 'SENT_BACK' && expense.exception_comment ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs leading-relaxed text-orange-900">
          <b>Sent back:</b> &ldquo;{expense.exception_comment}&rdquo; Change the reason when you submit, or replace or remove its bill.
        </div>
      ) : null}
      {lineCount || breakdown.length > 1 ? (
        <details>
          <summary className="cursor-pointer text-xs font-bold text-brand">
            {lineCount ? `${lineCount} line item${lineCount === 1 ? '' : 's'}` : `${breakdown.length} invoices`}
          </summary>
          <div className="mt-1.5 space-y-2 border-t border-dashed border-slate-200 pt-2">
            {breakdown.map((inv) => (
              <div key={inv.invoice_id} className="space-y-0.5 text-xs text-slate-500">
                {breakdown.length > 1 ? (
                  <div className="flex justify-between gap-2.5 font-bold text-slate-700">
                    <span className="min-w-0 truncate">{inv.vendor_name || inv.original_filename || 'Invoice'}</span>
                    <span className="font-mono tabular-nums">{inr(inv.amount)}</span>
                  </div>
                ) : null}
                {(inv.line_items || []).map((line, i) => (
                  <div key={i} className="flex justify-between gap-2.5">
                    <span className="min-w-0">{line.description}</span>
                    <span className="font-mono tabular-nums">{inr(line.amount)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default function ClaimWizardStepPolicyCheck({ claim, isGeneral, onBack, onNext, busy = false }) {
  const report = claim?.compliance_report || {};
  const expenses = claim?.expenses || [];
  const gst = claim?.gst_summary || report.gst_summary || {};
  const exceptions = claim?.exceptions || report.exceptions || [];
  const cityGroup = isGeneral ? null : claim?.city_group || claim?.destination_city_group || null;
  const needingReason = expenses.filter((expense) => expense.exception_reason_required);
  const blocked = needingReason.filter((expense) => expense.exception_mode === 'BLOCK');
  const softFlags = needingReason.length - blocked.length;
  const plural = (n, one, many) => (n === 1 ? one : many);

  let verdict;
  if (blocked.length) {
    verdict = (
      <Note tone="rose" icon={AlertCircle} title={`${blocked.map((e) => e.category_name).join(', ')} can't be claimed`}>
        Policy doesn&apos;t allow {plural(blocked.length, 'it', 'them')}, even with an exception. Remove {plural(blocked.length, 'that invoice', 'those invoices')} to submit.
        {softFlags ? ` ${softFlags} other expense${plural(softFlags, ' is', 's are')} outside policy and will need a reason.` : ''}
      </Note>
    );
  } else if (softFlags) {
    verdict = (
      <Note tone="amber" title={`${softFlags} expense${plural(softFlags, ' is', 's are')} outside policy`}>
        You can still submit. You&apos;ll give a reason for {plural(softFlags, 'it', 'each')} when you submit. A claim with exceptions is approved by
        its exception approvers instead of the normal ones, then goes to Finance for payment.
      </Note>
    );
  } else {
    verdict = (
      <Note tone="ok" icon={ShieldCheck} title={exceptions.length ? 'Exceptions are already in place' : 'Everything is within policy'}>
        {exceptions.length
          ? 'The policy deviations on this claim already have exception requests. Go ahead and submit.'
          : `Nothing needs an exception under the ${isGeneral ? 'reimbursement' : 'travel'} policy. Go ahead and submit.`}
      </Note>
    );
  }

  const taxTiles = [
    ['Taxable value', gst.total_taxable_value ?? gst.taxable_value],
    ['CGST + SGST', Number(gst.cgst || 0) + Number(gst.sgst || 0)],
    ['IGST', gst.igst],
    ['Other taxes', gst.other_tax],
  ];

  return (
    <>
      {verdict}
      <Card title="Expenses" sub="Grouped by category from the invoices you ticked" bodyClass="space-y-2.5">
        {expenses.length ? (
          expenses.map((expense) => <ExpenseCard key={expense.id} expense={expense} cityGroup={cityGroup} />)
        ) : (
          <p className="text-[12.5px] text-slate-500">No expenses on this claim yet. Go back and tick some invoices.</p>
        )}
      </Card>
      <Card
        title="Tax on these bills"
        sub={
          <>
            Input tax credit the company can claim: <b className="font-mono tabular-nums text-ink">{inr(gst.itc_eligible_amount)}</b>
          </>
        }
      >
        <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {taxTiles.map(([label, value]) => (
            <div key={label} className="rounded-[10px] bg-slate-50 px-[9px] py-[7px]">
              <dt className="text-[11px] font-bold text-slate-500">{label}</dt>
              <dd className="font-mono text-[13px] font-semibold tabular-nums text-ink">{inr(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-slate-400">Other taxes (foreign VAT, sales tax and so on) never count towards input tax credit.</p>
      </Card>
      <StepActions onBack={onBack} onNext={onNext} nextLabel="Next: Submit" busy={busy} />
    </>
  );
}
