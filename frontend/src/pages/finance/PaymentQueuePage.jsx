import { Clock, CreditCard, Eye, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import ClaimReviewModal from '../../components/claims/ClaimReviewModal';
import EmptyState from '../../components/ui/EmptyState';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { usePagination } from '../../hooks/usePagination';
import { reimbursementApi } from '../../services/reimbursementApi';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';

const money = (v) =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function slaClass(bucket) {
  if (bucket === 'breached') return 'sla-breached';
  if (bucket === 'warning') return 'sla-warning';
  return 'sla-ok';
}

export default function PaymentQueuePage() {
  useSetPageTitle('Payment Queue');
  const role = useAuthStore(selectResolvedRole);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  const [utr, setUtr] = useState('');
  const [tdsDeduction, setTdsDeduction] = useState('0.00');
  // Outstanding advance is a Finance-only figure (see advances_api.py) — never fetched for
  // any other role that can land on this shared payment queue.
  const [outstandingAdvance, setOutstandingAdvance] = useState(0);
  const [advanceDeducted, setAdvanceDeducted] = useState('0.00');
  const [saving, setSaving] = useState(false);
  const [payError, setPayError] = useState('');
  const [reviewClaimId, setReviewClaimId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reimbursementApi.pendingApprovals();
      const list = (res.data || []).filter((item) => item.sla_bucket != null);
      setRows(list);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to load payment queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openModal = async (row) => {
    setActive(row);
    setUtr('');
    setPayError('');
    setTdsDeduction('0.00');
    setOutstandingAdvance(0);
    setAdvanceDeducted('0.00');
    if (role === 'FINANCE' && row.employee_user_id) {
      try {
        const res = await reimbursementApi.outstandingAdvanceFor(row.employee_user_id);
        setOutstandingAdvance(Number(res.data?.outstanding_advance || 0));
      } catch {
        // Non-fatal — Finance can still record the payment without netting an advance.
        setOutstandingAdvance(0);
      }
    }
  };

  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(rows);
  const approvedAmount = useMemo(() => Number(active?.net_payable || 0), [active]);
  useBodyScrollLock(Boolean(active));
  const deductionAmount = Number(tdsDeduction || 0);
  const advanceAmount = Number(advanceDeducted || 0);
  const totalDue = approvedAmount - deductionAmount - advanceAmount;
  const deductionInvalid = deductionAmount < 0 || deductionAmount > approvedAmount;
  const advanceInvalid =
    advanceAmount < 0 || advanceAmount > outstandingAdvance || deductionAmount + advanceAmount > approvedAmount;
  // The advance can't cover the whole claim — clicking "Deduct from Advance" only ever applies
  // what's actually available, and whatever's left is simply paid out via UTR as normal.
  const advanceFallsShort = outstandingAdvance > 0 && outstandingAdvance < approvedAmount - deductionAmount;

  const applyAdvanceDeduction = () => {
    const applied = Math.max(Math.min(outstandingAdvance, approvedAmount - deductionAmount), 0);
    setAdvanceDeducted(applied.toFixed(2));
  };
  const removeAdvanceDeduction = () => setAdvanceDeducted('0.00');

  // TDS is edited after the advance is applied just as often as before — rather than leaving
  // a now-too-large advance sitting there as an unfixable validation error, shrink it to fit
  // whenever the two would otherwise together exceed the approved amount.
  useEffect(() => {
    if (advanceAmount > 0 && deductionAmount + advanceAmount > approvedAmount) {
      const refitted = Math.max(Math.min(outstandingAdvance, approvedAmount - deductionAmount), 0);
      setAdvanceDeducted(refitted.toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deductionAmount]);

  const submitPayment = async () => {
    if (!active) return;
    setSaving(true);
    setPayError('');
    try {
      // Posting to the ERP ledger now happens server-side as part of recording the payment
      // itself (see workflow_service.record_claim_payment) — atomically, so a paid claim can
      // never end up without a ledger entry the way it could when this was two separate calls.
      await reimbursementApi.recordClaimPayment(active.claim_id, {
        utr_reference: utr,
        amount: totalDue,
        tds_deduction: deductionAmount,
        advance_deducted: advanceAmount,
      });
      setActive(null);
      await load();
    } catch (err) {
      setPayError(err?.response?.data?.detail || 'Payment failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-ink">Finance payment queue</h2>
        <p className="mt-1 text-sm text-slate-600">All claims currently ready for payment.</p>
      </div>

      {error ? (
        <div className="panel rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="panel overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/70 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3.5 whitespace-nowrap">S. No</th>
                <th className="px-5 py-3.5">Claim Ref</th>
                <th className="px-5 py-3.5">Employee</th>
                <th className="px-5 py-3.5">Dept</th>
                <th className="px-5 py-3.5">Amount</th>
                <th className="px-5 py-3.5">Net Payable</th>
                <th className="px-5 py-3.5">Submitted</th>
                <th className="px-5 py-3.5">SLA</th>
                <th className="px-5 py-3.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-5 py-6" colSpan={9}>
                    <Skeleton variant="table" rows={4} columns={9} />
                  </td>
                </tr>
              ) : rows.length ? (
                pageItems.map((row, index) => (
                  <tr key={row.claim_id} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors duration-150">
                    <td className="px-5 py-4 text-center text-slate-500">{startIndex + index + 1}</td>
                    <td className="px-5 py-4 text-center font-semibold text-slate-900">{row.claim_reference}</td>
                    <td className="px-5 py-4 text-center text-slate-800">{row.employee_name || row.employee_label}</td>
                    <td className="px-5 py-4 text-center text-slate-600">{row.department || '—'}</td>
                    <td className="px-5 py-4 text-center text-slate-700">₹{money(row.amount)}</td>
                    <td className="px-5 py-4 text-center font-bold text-slate-900">₹{money(row.net_payable)}</td>
                    <td className="px-5 py-4 text-center text-slate-600">{row.submitted_at ? new Date(row.submitted_at).toLocaleDateString() : '—'}</td>
                    <td className="px-5 py-4 text-center">
                      <div className={`inline-flex items-center gap-1.5 text-xs font-semibold ${slaClass(row.sla_bucket)}`}>
                        <Clock size={13} className="shrink-0" />
                        <span>{row.sla_remaining_label}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          className="btn-secondary h-8 whitespace-nowrap px-3 text-xs"
                          onClick={() => setReviewClaimId(row.claim_id)}
                        >
                          <Eye size={13} />
                          Review
                        </button>
                        <button className="btn-primary h-8 whitespace-nowrap px-3 text-xs" onClick={() => openModal(row)}>
                          Process Payment
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-5 py-5" colSpan={9}>
                    <EmptyState
                      icon={CreditCard}
                      title="No claims in payment queue"
                      description="Claims ready for payment will appear here."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
      </div>

      {active
        ? createPortal(
            <div
              className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/55 p-4 backdrop-blur-[1px]"
              onClick={() => !saving && setActive(null)}
            >
              <div
                className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-line px-5 py-4">
                  <div>
                    <h3 className="text-sm font-bold text-ink">Record payment</h3>
                    <p className="text-xs text-slate-500">
                      {active.claim_reference} · {active.employee_name || active.employee_label}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActive(null)}
                    disabled={saving}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="p-5">
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-slate-600">
                      <span>Total Claimed</span>
                      <span>₹{money(active.amount)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-ink">
                      <span>Approved Amount</span>
                      <span>₹{money(active.net_payable)}</span>
                    </div>
                  </div>
                  <div className="my-3 h-px bg-slate-100" />
                  <div className="space-y-3.5">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-500">UTR Reference</label>
                      <input className="field w-full" value={utr} onChange={(e) => setUtr(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-500">TDS &amp; Other Deductions</label>
                      <input
                        className="field w-full"
                        type="number"
                        step="0.01"
                        min="0"
                        max={approvedAmount}
                        value={tdsDeduction}
                        onChange={(e) => setTdsDeduction(e.target.value)}
                      />
                    </div>
                    {role === 'FINANCE' && outstandingAdvance > 0 ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-600">Outstanding Advance</span>
                          <span className="font-mono font-bold text-slate-800">₹{money(outstandingAdvance)}</span>
                        </div>
                        {advanceAmount > 0 ? (
                          <>
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                className="field w-full"
                                type="number"
                                step="0.01"
                                min="0"
                                max={Math.min(outstandingAdvance, approvedAmount)}
                                value={advanceDeducted}
                                onChange={(e) => setAdvanceDeducted(e.target.value)}
                              />
                              <button
                                type="button"
                                className="whitespace-nowrap text-xs font-semibold text-red-600 hover:underline"
                                onClick={removeAdvanceDeduction}
                              >
                                Remove
                              </button>
                            </div>
                            {advanceFallsShort ? (
                              <p className="mt-1.5 text-[11px] text-slate-500">
                                The advance doesn&apos;t fully cover this claim — the remaining ₹{money(totalDue)} is
                                paid via UTR as usual.
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <button type="button" className="btn-secondary mt-2 w-full text-xs" onClick={applyAdvanceDeduction}>
                            Deduct from Advance
                          </button>
                        )}
                      </div>
                    ) : null}
                    <div className="rounded-lg border border-brand/20 bg-brand/5 px-3.5 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-brand/70">Total Due</span>
                        <span className="font-mono text-base font-bold text-brand">₹{money(totalDue)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Approved amount minus TDS &amp; other deductions{outstandingAdvance > 0 ? ' and advance deducted' : ''}.
                      </p>
                    </div>
                  </div>
                  {deductionInvalid ? (
                    <p className="mt-2 text-xs text-amber-700">TDS &amp; other deductions must be between ₹0.00 and the approved amount.</p>
                  ) : null}
                  {advanceInvalid ? (
                    <p className="mt-2 text-xs text-amber-700">
                      Advance deducted must be between ₹0.00 and ₹{money(outstandingAdvance)}, and can&apos;t push the total
                      withheld past the approved amount.
                    </p>
                  ) : null}
                  {payError ? <p className="mt-2 text-xs text-red-700">{payError}</p> : null}
                  <div className="mt-4 flex justify-end gap-2.5">
                    <button className="btn-secondary" onClick={() => setActive(null)} disabled={saving}>
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      onClick={submitPayment}
                      disabled={saving || !utr.trim() || deductionInvalid || advanceInvalid}
                    >
                      {saving ? 'Processing...' : 'Record Payment & Post to ERP'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {reviewClaimId ? (
        <ClaimReviewModal
          claimId={reviewClaimId}
          onClose={() => {
            setReviewClaimId(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}
