import { useEffect, useMemo, useState } from 'react';

import { BTN_PLAIN, PageHead, Pill, QueueRow, RowSub, RowTitle, SlaBlock } from '../../components/approvals/ApprovalQueueParts';
import ClaimReviewModal from '../../components/claims/ClaimReviewModal';
import { Empty, Figure, Modal, PaidTotal, day, errorText, money, rupees } from '../../components/finance/FinanceParts';
import { BTN_GHOST, BTN_MAIN, CARD, FIELD, LABEL } from '../../components/policy/PolicyAdminParts';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { usePagination } from '../../hooks/usePagination';
import { hasPermission } from '../../services/permissions';
import { reimbursementApi } from '../../services/reimbursementApi';
import { useAuthStore } from '../../store/authStore';

const CATEGORY = { TRAVEL: ['Travel', 'sky'], GENERAL: ['General', 'violet'], RELOCATION: ['Relocation', 'orange'] };

function PayWindow({ row, canProcessPayments, onClose, onPaid }) {
  const [utr, setUtr] = useState('');
  const [tdsDeduction, setTdsDeduction] = useState('0.00');
  const [outstandingAdvance, setOutstandingAdvance] = useState(0);
  const [advanceDeducted, setAdvanceDeducted] = useState('0.00');
  const [useAdvance, setUseAdvance] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payError, setPayError] = useState('');

  useEffect(() => {
    if (!canProcessPayments || !row.employee_user_id) return;
    reimbursementApi
      .outstandingAdvanceFor(row.employee_user_id)
      .then((res) => setOutstandingAdvance(Number(res.data?.outstanding_advance || 0)))
      // Non-fatal — Finance can still record the payment without netting an advance.
      .catch(() => setOutstandingAdvance(0));
  }, [canProcessPayments, row.employee_user_id]);

  const approvedAmount = Number(row.net_payable || 0);
  const deductionAmount = Number(tdsDeduction || 0);
  const advanceAmount = useAdvance ? Number(advanceDeducted || 0) : 0;
  const usable = Math.max(Math.min(outstandingAdvance, approvedAmount - deductionAmount), 0);
  const totalDue = approvedAmount - deductionAmount - advanceAmount;
  const deductionInvalid = deductionAmount < 0 || deductionAmount > approvedAmount;
  const advanceInvalid = advanceAmount < 0 || advanceAmount > outstandingAdvance || deductionAmount + advanceAmount > approvedAmount;

  // A TDS change after the advance is set shrinks the advance to fit, instead of leaving an
  // unfixable "too much withheld" error.
  useEffect(() => {
    if (useAdvance && advanceAmount > 0 && deductionAmount + advanceAmount > approvedAmount) setAdvanceDeducted(usable.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deductionAmount]);

  const submitPayment = async () => {
    setSaving(true);
    setPayError('');
    try {
      // Posting to the ERP ledger happens server-side as part of recording the payment
      // (workflow_service.record_claim_payment), so a paid claim always has a ledger entry.
      await reimbursementApi.recordClaimPayment(row.claim_id, {
        utr_reference: utr,
        amount: totalDue,
        tds_deduction: deductionAmount,
        advance_deducted: advanceAmount,
      });
      onPaid();
    } catch (err) {
      setPayError(errorText(err, 'Payment failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Record payment"
      sub={`${row.claim_reference} · ${row.employee_name || row.employee_label}`}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BTN_GHOST} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={BTN_MAIN} onClick={submitPayment} disabled={saving || !utr.trim() || deductionInvalid || advanceInvalid}>
            {saving ? 'Recording…' : 'Record payment & post to ERP'}
          </button>
        </>
      }
    >
      <Figure label="Claimed">{money(row.amount)}</Figure>
      <Figure label="Approved" strong>
        {money(approvedAmount)}
      </Figure>
      <div>
        <label className={LABEL} htmlFor="pay-utr">
          Bank reference (UTR)
        </label>
        <input id="pay-utr" className={`${FIELD} font-mono`} value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. HDFC26101612345" />
      </div>
      <div>
        <label className={LABEL} htmlFor="pay-tds">
          TDS &amp; other deductions
        </label>
        <input id="pay-tds" className={`${FIELD} font-mono`} type="number" step="0.01" min="0" max={approvedAmount} value={tdsDeduction} onChange={(e) => setTdsDeduction(e.target.value)} />
        {deductionInvalid ? <p className="mt-1 text-xs text-rose-700">Enter ₹0.00 up to the approved amount.</p> : null}
      </div>
      {canProcessPayments && outstandingAdvance > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <Figure label="Advance not yet used" strong>
            {money(outstandingAdvance)}
          </Figure>
          {useAdvance ? (
            <>
              <div>
                <label className={LABEL} htmlFor="pay-advance">
                  Take from the advance <small className="font-medium text-slate-400">up to {money(usable)}</small>
                </label>
                <div className="flex items-center gap-2">
                  <input id="pay-advance" className={`${FIELD} font-mono ${advanceInvalid ? 'border-rose-400' : ''}`} type="number" step="0.01" min="0" max={usable} value={advanceDeducted} onChange={(e) => setAdvanceDeducted(e.target.value)} />
                  <button type="button" className={BTN_PLAIN} disabled={advanceAmount === usable} onClick={() => setAdvanceDeducted(usable.toFixed(2))}>
                    Use all
                  </button>
                </div>
                {advanceInvalid ? (
                  <p className="mt-1 text-xs text-rose-700">Enter ₹0 to {money(usable)}: no more than the advance left, or than what&apos;s being paid after TDS.</p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">{money(outstandingAdvance - advanceAmount)} of the advance stays for later claims.</p>
                )}
              </div>
              <button type="button" className={`${BTN_PLAIN} self-start`} onClick={() => setUseAdvance(false)}>
                Don&apos;t use the advance
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`${BTN_PLAIN} self-start`}
              onClick={() => {
                setAdvanceDeducted(usable.toFixed(2));
                setUseAdvance(true);
              }}
            >
              Use the advance
            </button>
          )}
          <p className="text-xs text-slate-500">Whatever isn&apos;t taken from the advance is paid by bank transfer.</p>
        </div>
      ) : null}
      <PaidTotal label="To pay by bank transfer" amount={totalDue} />
      <p className="text-xs text-slate-500">Approved amount minus TDS{advanceAmount > 0 ? ' and the advance used' : ''}.</p>
      {payError ? (
        <p role="alert" className="text-xs text-rose-700">
          {payError}
        </p>
      ) : null}
    </Modal>
  );
}

export default function PaymentQueuePage() {
  useSetPageTitle('Payment Queue');
  const permissions = useAuthStore((s) => s.profile?.permissions);
  // Tied to whoever can actually record the payment (process_payments), not a hardcoded Finance check.
  const canProcessPayments = hasPermission(permissions, 'process_payments');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  const [reviewClaimId, setReviewClaimId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reimbursementApi.pendingApprovals();
      setRows((res.data || []).filter((item) => item.sla_bucket != null));
    } catch (err) {
      setError(errorText(err, 'Failed to load payment queue'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(rows);
  const toPay = useMemo(() => rows.reduce((n, r) => n + Number(r.net_payable || 0), 0), [rows]);
  const late = rows.filter((r) => r.sla_bucket === 'breached').length;

  return (
    <section className="flex flex-col gap-3.5">
      <PageHead
        title="Payment queue"
        sub="Approved claims waiting to be paid. Enter the bank reference (UTR) to record the payment; it's posted to the ERP ledger at the same time."
        stats={[
          { label: 'Waiting', value: rows.length },
          { label: 'To pay', value: rupees(toPay) },
          { label: 'Past the SLA', value: late, tone: late ? 'rose' : undefined },
        ]}
      />
      {error ? (
        <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
          {error}
        </div>
      ) : null}
      <section aria-label="Claims to pay" className={CARD}>
        {loading ? (
          <div className="p-4">
            <Skeleton variant="table" rows={4} columns={4} />
          </div>
        ) : rows.length ? (
          pageItems.map((row) => {
            const [catLabel, catTone] = CATEGORY[row.reimbursement_category] || CATEGORY.TRAVEL;
            return (
              <QueueRow
                key={row.claim_id}
                wideLead
                lead={<SlaBlock deadline={row.sla_deadline_at} bucket={row.sla_bucket} />}
                main={
                  <>
                    <RowTitle>
                      {row.claim_reference} <Pill tone={catTone}>{catLabel}</Pill>
                    </RowTitle>
                    <RowSub>
                      {row.employee_name || row.employee_label}
                      {row.department ? ` · ${row.department}` : ''} · submitted {day(row.submitted_at)}
                    </RowSub>
                    {row.trip_summary && row.trip_summary !== '—' ? <RowSub>{row.trip_summary}</RowSub> : null}
                  </>
                }
                side={
                  <>
                    <b className="block font-mono text-[13.5px] tabular-nums text-ink">{money(row.net_payable)}</b>
                    <span className="text-xs text-slate-500">claimed {money(row.amount)}</span>
                  </>
                }
                actions={
                  <>
                    <button type="button" className={BTN_PLAIN} onClick={() => setReviewClaimId(row.claim_id)}>
                      Review
                    </button>
                    <button type="button" className={`${BTN_MAIN} h-[30px] rounded-lg px-[11px] text-xs`} onClick={() => setActive(row)}>
                      Pay
                    </button>
                  </>
                }
              />
            );
          })
        ) : (
          <Empty title="Nothing to pay right now">Claims appear here once every approval is done.</Empty>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
      </section>

      {active ? (
        <PayWindow
          key={active.claim_id}
          row={active}
          canProcessPayments={canProcessPayments}
          onClose={() => setActive(null)}
          onPaid={async () => {
            setActive(null);
            await load();
          }}
        />
      ) : null}
      {reviewClaimId ? (
        <ClaimReviewModal
          claimId={reviewClaimId}
          onClose={() => {
            setReviewClaimId(null);
            load();
          }}
        />
      ) : null}
    </section>
  );
}
