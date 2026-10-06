import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  FileText,
  History as HistoryIcon,
  Plane,
  ReceiptIndianRupee,
  ShieldCheck,
  Undo2,
  Wallet,
  X,
} from 'lucide-react';

import ClaimStatusBadge from '../ui/ClaimStatusBadge';
import ReimbursementCategoryBadge from '../ui/ReimbursementCategoryBadge';
import ClaimTimeline from './ClaimTimeline';
import ConfirmDialog from '../ui/ConfirmDialog';
import InvoicePreviewDrawer from '../ui/InvoicePreviewDrawer';
import Skeleton from '../ui/Skeleton';
import TicketPreviewDrawer from '../ui/TicketPreviewDrawer';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import useToast from '../../hooks/useToast';
import { normalizeApiError } from '../../utils/apiErrors';
import { formatDate } from '../../utils/formatters';
import { hasAnyPermission } from '../../services/permissions';
import { reimbursementApi } from '../../services/reimbursementApi';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';

const POLICY_STYLES = {
  OK: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  SOFT_FLAG: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  HARD_BLOCK: 'bg-red-50 text-red-700 ring-red-600/20',
};

const money = (v) =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TABS = [
  { key: 'summary', label: 'Summary', icon: FileText },
  { key: 'invoices', label: 'Invoices', icon: ReceiptIndianRupee },
  { key: 'trips', label: 'Trips', icon: Plane },
  { key: 'history', label: 'History', icon: HistoryIcon },
];

function PolicyPill({ status }) {
  const style = POLICY_STYLES[status] || POLICY_STYLES.OK;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${style}`}>
      {status === 'HARD_BLOCK' ? 'Hard Block' : status === 'SOFT_FLAG' ? 'Soft Flag' : 'OK'}
    </span>
  );
}

/**
 * Renders the claim-approval workspace as a modal overlay rather than a standalone route,
 * so approvers stay in place in the queue behind it. `claimId` is expected to already be a
 * valid, non-null id when this component is mounted — the caller controls visibility by
 * mounting/unmounting it.
 */
export default function ClaimReviewModal({ claimId, onClose }) {
  const role = useAuthStore(selectResolvedRole);
  const delegatedRoles = useAuthStore((s) => s.profile?.delegated_roles);
  const approverPerms = ['approve_stage_1', 'approve_stage_2', 'approve_stage_3', 'process_payments'];
  const isApprover = hasAnyPermission(role, approverPerms, delegatedRoles);
  const { showToast } = useToast();
  useBodyScrollLock(true);

  const [claim, setClaim] = useState(null);
  const [comment, setComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [utr, setUtr] = useState('');
  const [tdsDeduction, setTdsDeduction] = useState('0.00');
  // Outstanding advance is a Finance-only figure (see advances_api.py) — never fetched for
  // any other role that can review/act on this claim.
  const [outstandingAdvance, setOutstandingAdvance] = useState(0);
  const [advanceDeducted, setAdvanceDeducted] = useState('0.00');
  const [payableAmount, setPayableAmount] = useState('');
  const [timeline, setTimeline] = useState([]);
  const [activeTab, setActiveTab] = useState('summary');
  const [expandedInvoiceId, setExpandedInvoiceId] = useState(null);
  const [invoiceExtractions, setInvoiceExtractions] = useState({});
  const [invoicePreview, setInvoicePreview] = useState(null);
  const [ticketPreview, setTicketPreview] = useState({ open: false, blob: null, name: '', type: '', title: '' });
  const [confirmReject, setConfirmReject] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, ch, t] = await Promise.all([
          reimbursementApi.claimDetail(claimId),
          reimbursementApi.approvalChain(claimId),
          reimbursementApi.claimTimeline(claimId),
        ]);
        if (cancelled) return;
        setClaim(c.data);
        setTimeline(t.data || []);
        const authoritative =
          ch.data?.authoritative_payable_amount ??
          c.data?.approved_amount ??
          c.data?.compliance_report?.net_payable;
        if (authoritative != null) {
          setPayableAmount(String(authoritative));
        }
        setTdsDeduction('0.00');
        setAdvanceDeducted('0.00');
        setOutstandingAdvance(0);
        if (role === 'FINANCE' && c.data?.status === 'READY_FOR_PAYMENT' && c.data?.employee_user_id) {
          try {
            const adv = await reimbursementApi.outstandingAdvanceFor(c.data.employee_user_id);
            if (!cancelled) setOutstandingAdvance(Number(adv.data?.outstanding_advance || 0));
          } catch {
            // Non-fatal — Finance can still record the payment without netting an advance.
          }
        }
      } catch (error) {
        if (!cancelled) {
          setClaim(false);
          showToast(error?.response?.data?.detail || 'Failed to load claim', 'error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  const onActionError = (error) => showToast(normalizeApiError(error).message, 'error');

  const { run: approve, loading: approving } = useAsyncAction(async () => {
    await reimbursementApi.approveClaim(claimId, { comment: comment || undefined });
    showToast('Claim approved', 'success');
    onClose();
  });

  const { run: sendBack, loading: sending } = useAsyncAction(async () => {
    await reimbursementApi.sendBackClaim(claimId, { comment });
    showToast('Claim sent back', 'success');
    onClose();
  });

  const { run: reject, loading: rejecting } = useAsyncAction(async () => {
    await reimbursementApi.rejectClaim(claimId, { reason: rejectReason });
    showToast('Claim rejected', 'success');
    onClose();
  });

  const readyForPayment = claim?.status === 'READY_FOR_PAYMENT';
  const payMax = Number(payableAmount || 0);
  const deductionAmount = Number(tdsDeduction || 0);
  const advanceAmount = Number(advanceDeducted || 0);
  const totalDue = payMax - deductionAmount - advanceAmount;
  const deductionInvalid = deductionAmount < 0 || deductionAmount > payMax;
  const advanceInvalid =
    advanceAmount < 0 || advanceAmount > outstandingAdvance || deductionAmount + advanceAmount > payMax;
  // The advance can't cover the whole claim — "Deduct from Advance" only ever applies what's
  // actually available, and whatever's left is simply paid out via UTR as normal.
  const advanceFallsShort = outstandingAdvance > 0 && outstandingAdvance < payMax - deductionAmount;

  const applyAdvanceDeduction = () => {
    const applied = Math.max(Math.min(outstandingAdvance, payMax - deductionAmount), 0);
    setAdvanceDeducted(applied.toFixed(2));
  };
  const removeAdvanceDeduction = () => setAdvanceDeducted('0.00');

  // TDS is edited after the advance is applied just as often as before — rather than leaving
  // a now-too-large advance sitting there as an unfixable validation error, shrink it to fit
  // whenever the two would otherwise together exceed the approved amount.
  useEffect(() => {
    if (advanceAmount > 0 && deductionAmount + advanceAmount > payMax) {
      const refitted = Math.max(Math.min(outstandingAdvance, payMax - deductionAmount), 0);
      setAdvanceDeducted(refitted.toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deductionAmount]);

  const { run: pay, loading: paying } = useAsyncAction(async () => {
    await reimbursementApi.recordClaimPayment(claimId, {
      utr_reference: utr,
      amount: totalDue,
      tds_deduction: deductionAmount,
      advance_deducted: advanceAmount,
    });
    showToast('Payment recorded', 'success');
    onClose();
  });

  const linkedInvoices = claim?.linked_invoices ?? [];
  const linkedTrips = claim?.linked_trips ?? [];
  const hasTripDetails = Boolean(
    claim?.from_city || claim?.destination_city || claim?.departure_date || claim?.trip_purpose,
  );
  // General Reimbursements and Reallocation claims are never trip-linked, so the Trips tab
  // has nothing to show for either (see GeneralReimbursementWizard.jsx, which both share).
  const visibleTabs =
    claim?.reimbursement_category === 'GENERAL' || claim?.reimbursement_category === 'REALLOCATION'
      ? TABS.filter((tab) => tab.key !== 'trips')
      : TABS;

  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/55 p-4 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="flex h-[calc(80vh-20px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-gradient-to-r from-brand/[0.06] via-white to-white px-6 py-4">
          {claim ? (
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Wallet size={20} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-ink">{claim.claim_reference || `Claim #${claim.id}`}</h2>
                  <ReimbursementCategoryBadge category={claim.reimbursement_category} />
                  <ClaimStatusBadge status={claim.status} />
                </div>
                <p className="text-sm text-slate-500">{claim.employee_id ? `Employee #${claim.employee_id}` : 'Employee'}</p>
              </div>
            </div>
          ) : (
            <div className="h-9 w-40 animate-pulse rounded-lg bg-slate-100" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {claim === false ? (
          <div className="p-8 text-center text-sm text-slate-500">This claim could not be loaded.</div>
        ) : !claim ? (
          <div className="p-6">
            <Skeleton variant="card" height={220} />
          </div>
        ) : (
          <div className="grid flex-1 items-start gap-6 overflow-y-auto p-6 lg:grid-cols-[1.7fr_1fr]">
            <section className="space-y-4">
              <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
                {visibleTabs.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all ${
                      activeTab === key ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                    onClick={() => setActiveTab(key)}
                  >
                    <Icon size={14} className={activeTab === key ? 'text-brand' : ''} />
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === 'summary' ? (
                <div className="space-y-4">
                  {(() => {
                    const gst = claim.compliance_report?.gst_summary || {};
                    const baseAmount = Number(gst.taxable_value ?? gst.total_taxable_value ?? 0);
                    const totalTax =
                      Number(gst.cgst || 0) + Number(gst.sgst || 0) + Number(gst.igst || 0) + Number(gst.other_tax || 0);
                    const totalPayable = baseAmount + totalTax;
                    return (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="flex items-start justify-between rounded-xl border border-line bg-slate-50/60 p-3.5">
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Total Base Amount</p>
                              <p className="mt-1 font-mono text-lg font-bold text-ink">
                                ₹{baseAmount.toLocaleString('en-IN')}
                              </p>
                            </div>
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200/70 text-slate-500">
                              <ReceiptIndianRupee size={15} />
                            </div>
                          </div>
                          <div className="flex items-start justify-between rounded-xl border border-line bg-slate-50/60 p-3.5">
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Total Tax</p>
                              <p className="mt-1 font-mono text-lg font-bold text-ink">
                                ₹{totalTax.toLocaleString('en-IN')}
                              </p>
                            </div>
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200/70 text-slate-500">
                              <ReceiptIndianRupee size={15} />
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start justify-between rounded-xl border border-brand/20 bg-brand/5 p-3.5">
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-brand/70">Total Payable</p>
                            <p className="mt-1 font-mono text-lg font-bold text-brand">
                              ₹{totalPayable.toLocaleString('en-IN')}
                            </p>
                          </div>
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
                            <Wallet size={15} />
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  <div className="overflow-hidden rounded-xl border border-line">
                    <div className="border-b border-line bg-slate-50/60 px-3.5 py-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Expense Breakdown</h3>
                    </div>
                    <div className="divide-y divide-line bg-white">
                      {(claim.expenses || []).map((expense) => (
                        <div key={expense.id} className="flex items-center justify-between px-3.5 py-2.5">
                          <span className="text-sm font-medium text-slate-700">{expense.category_name}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-ink">₹{Number(expense.amount || 0).toLocaleString('en-IN')}</span>
                            <PolicyPill status={expense.policy_status} />
                          </div>
                        </div>
                      ))}
                      {!(claim.expenses || []).length ? (
                        <p className="px-3.5 py-3 text-sm text-slate-500">No expense lines on this claim.</p>
                      ) : null}
                    </div>
                  </div>

                  {(() => {
                    const exceptionCount = (claim.compliance_report?.exceptions || []).length;
                    return (
                      <div
                        className={`flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs font-semibold ${
                          exceptionCount
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {exceptionCount ? <AlertTriangle size={14} className="shrink-0" /> : <ShieldCheck size={14} className="shrink-0" />}
                        <span>
                          Policy exceptions on this claim: <span className="font-bold">{exceptionCount}</span>
                        </span>
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              {activeTab === 'invoices' ? (
                <div className="space-y-2.5">
                  {linkedInvoices.map((invoice) => {
                    const isExpanded = expandedInvoiceId === invoice.id;
                    const toggleExpand = async () => {
                      if (!invoiceExtractions[invoice.id]) {
                        const res = await reimbursementApi.invoiceExtraction(invoice.id);
                        setInvoiceExtractions((prev) => ({ ...prev, [invoice.id]: res.data }));
                      }
                      setExpandedInvoiceId(isExpanded ? null : invoice.id);
                    };
                    return (
                      <div key={invoice.id} className="overflow-hidden rounded-xl border border-line">
                        <button
                          type="button"
                          onClick={toggleExpand}
                          className={`flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left text-sm transition-colors ${
                            isExpanded ? 'bg-brand/5' : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                              <ReceiptIndianRupee size={15} />
                            </div>
                            <span className="truncate font-medium text-slate-700">{invoice.original_filename}</span>
                            {invoice.payment_proof_original_filename ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                <CheckCircle2 size={11} />
                                Payment proof
                              </span>
                            ) : (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                                <AlertTriangle size={11} />
                                No payment proof
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span
                              role="button"
                              tabIndex={0}
                              className="text-xs font-bold text-brand hover:underline"
                              onClick={(event) => {
                                event.stopPropagation();
                                setInvoicePreview(invoice);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.stopPropagation();
                                  setInvoicePreview(invoice);
                                }
                              }}
                            >
                              Preview
                            </span>
                            <ChevronDown
                              size={16}
                              className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-brand' : ''}`}
                            />
                          </div>
                        </button>
                        {isExpanded && invoiceExtractions[invoice.id] ? (
                          <div className="border-t border-line text-xs">
                            <table className="w-full">
                              <thead>
                                <tr className="bg-slate-50 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                  <th className="px-3.5 py-2">Field</th>
                                  <th className="px-3.5 py-2">Value</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line/70 bg-white">
                                {(invoiceExtractions[invoice.id].fields || []).map((field) => (
                                  <tr key={field.id} className="hover:bg-slate-50/60">
                                    <td className="px-3.5 py-2 text-center font-medium capitalize text-slate-600">
                                      {field.field_key.replace(/_/g, ' ')}
                                    </td>
                                    <td className="px-3.5 py-2 text-center font-semibold text-ink">
                                      {field.final_value || field.original_value || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!linkedInvoices.length ? <p className="text-sm text-slate-500">No invoices linked.</p> : null}
                </div>
              ) : null}

              {activeTab === 'trips' ? (
                <div className="space-y-4">
                  {hasTripDetails ? (
                    <div className="rounded-xl border border-line bg-slate-50/60 p-3.5">
                      <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Trip Details</p>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                        <div className="rounded-lg border border-line/60 bg-white px-3 py-2.5">
                          <p className="text-[11px] text-slate-400">Route</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">
                            {claim.from_city || '—'} → {claim.destination_city || '—'}
                          </p>
                        </div>
                        <div className="rounded-lg border border-line/60 bg-white px-3 py-2.5">
                          <p className="text-[11px] text-slate-400">Travel Dates</p>
                          <div className="mt-1 space-y-1">
                            <p className="text-sm font-semibold text-slate-800">
                              {claim.departure_date ? formatDate(claim.departure_date) : '—'}
                            </p>
                            {claim.return_date ? (
                              <>
                                <div className="flex items-center gap-1.5 pl-0.5">
                                  <span className="h-2.5 w-px bg-slate-300" />
                                  <span className="text-[10px] uppercase tracking-wide text-slate-400">to</span>
                                </div>
                                <p className="text-sm font-semibold text-slate-800">{formatDate(claim.return_date)}</p>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="rounded-lg border border-line/60 bg-white px-3 py-2.5">
                          <p className="text-[11px] text-slate-400">Purpose</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">{claim.trip_purpose || '—'}</p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {linkedTrips.length ? (
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Linked Tickets</p>
                  ) : null}
                  {linkedTrips.map((trip) => (
                    <div key={trip.id} className="flex items-center justify-between rounded-lg border border-line p-3 text-sm">
                      <span className="font-medium text-slate-700">
                        {trip.from_city} → {trip.to_city} · {trip.travel_date}
                      </span>
                      {trip.desk_ticket_id ? (
                        <button
                          type="button"
                          className="text-xs font-bold text-brand hover:underline"
                          onClick={async () => {
                            const response = await reimbursementApi.travelTicketFileBlob(trip.desk_ticket_id);
                            setTicketPreview({
                              open: true,
                              blob: response.data,
                              name: `${trip.reference_id || trip.id}-ticket`,
                              type: response.headers['content-type'] || '',
                              title: `Trip ${trip.reference_id || trip.id}`,
                            });
                          }}
                        >
                          View Ticket
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {!linkedTrips.length ? (
                    <p className="text-sm text-slate-500">
                      {hasTripDetails ? 'No pre-booked ticket linked to this claim.' : 'No trip information available for this claim.'}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {activeTab === 'history' ? <ClaimTimeline items={timeline} /> : null}
            </section>

            <aside className="space-y-4">
              {isApprover ? (
                <>
                  {!readyForPayment ? (
                    <div className="space-y-3 rounded-xl border border-line bg-white p-4 shadow-sm">
                      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                        <ClipboardCheck size={14} className="text-brand" />
                        Decision
                      </h3>
                      <label className="block text-sm">
                        <span className="font-medium text-slate-600">Comment (optional)</span>
                        <textarea
                          className="field !h-auto min-h-[4.5rem] mt-1.5 w-full py-2"
                          rows={2}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="Note for the audit trail"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={approving}
                          className="btn-primary inline-flex items-center gap-1.5"
                          onClick={() => approve().catch(onActionError)}
                        >
                          <Check size={15} />
                          {approving ? 'Approving…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          disabled={sending || !comment.trim()}
                          title={!comment.trim() ? 'Add a comment explaining what needs to change' : ''}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3.5 py-2 text-sm font-bold text-amber-800 ring-1 ring-inset ring-amber-200 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => sendBack().catch(onActionError)}
                        >
                          <Undo2 size={15} />
                          {sending ? 'Sending…' : 'Send Back'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {!readyForPayment ? (
                    <details className="group rounded-xl border border-rose-200 bg-rose-50/40 p-4 open:pb-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold uppercase tracking-wide text-rose-700 [&::-webkit-details-marker]:hidden">
                        <span>Reject Claim</span>
                        <span className="text-rose-400 transition-transform group-open:rotate-180">⌄</span>
                      </summary>
                      <label className="mt-3 block text-sm">
                        <span className="font-medium text-slate-600">Reason</span>
                        <textarea
                          className="field !h-auto min-h-[4.5rem] mt-1.5 w-full bg-white py-2"
                          rows={2}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Required — explain why this claim is being rejected"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={rejecting || !rejectReason.trim()}
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => setConfirmReject(true)}
                      >
                        <X size={15} />
                        Reject
                      </button>
                    </details>
                  ) : null}

                  {readyForPayment ? (
                    <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between text-slate-600">
                          <span>Total Claimed</span>
                          <span>₹{money(claim.compliance_report?.total_claimed)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-ink">
                          <span>Approved Amount</span>
                          <span>₹{money(payableAmount)}</span>
                        </div>
                      </div>
                      <div className="my-3 h-px bg-slate-100" />
                      <label className="block text-sm">
                        <span className="font-semibold text-slate-700">UTR Reference</span>
                        <input className="field mt-1.5 w-full" value={utr} onChange={(e) => setUtr(e.target.value)} />
                      </label>
                      <label className="mt-2.5 block text-sm">
                        <span className="font-semibold text-slate-700">TDS &amp; Other Deductions</span>
                        <input
                          className="field mt-1.5 w-full"
                          type="number"
                          step="0.01"
                          min="0"
                          max={payMax}
                          value={tdsDeduction}
                          onChange={(e) => setTdsDeduction(e.target.value)}
                        />
                      </label>
                      {role === 'FINANCE' && outstandingAdvance > 0 ? (
                        <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
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
                                  max={Math.min(outstandingAdvance, payMax)}
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
                      <div className="mt-3 rounded-lg border border-brand/20 bg-brand/5 px-3.5 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-brand/70">Total Due</span>
                          <span className="font-mono text-base font-bold text-brand">₹{money(totalDue)}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Approved amount minus TDS &amp; other deductions{outstandingAdvance > 0 ? ' and advance deducted' : ''}.
                        </p>
                      </div>
                      {deductionInvalid ? (
                        <p className="mt-2 text-xs text-amber-700">TDS &amp; other deductions must be between ₹0.00 and the approved amount.</p>
                      ) : null}
                      {advanceInvalid ? (
                        <p className="mt-2 text-xs text-amber-700">
                          Advance deducted must be between ₹0.00 and ₹{money(outstandingAdvance)}, and can&apos;t push
                          the total withheld past the approved amount.
                        </p>
                      ) : null}
                      <button
                        type="button"
                        disabled={paying || !utr.trim() || deductionInvalid || advanceInvalid}
                        className="btn-primary mt-3 inline-flex w-full items-center justify-center gap-1.5"
                        onClick={() => pay().catch(onActionError)}
                      >
                        <CreditCard size={15} />
                        {paying ? 'Recording…' : 'Record Payment'}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-600">
                  Read-only view. Approvers manage this claim from queue actions.
                </p>
              )}
            </aside>
          </div>
        )}
      </div>

      <InvoicePreviewDrawer open={Boolean(invoicePreview)} onClose={() => setInvoicePreview(null)} invoice={invoicePreview} />
      <TicketPreviewDrawer
        open={ticketPreview.open}
        onClose={() => setTicketPreview((prev) => ({ ...prev, open: false }))}
        blob={ticketPreview.blob}
        contentType={ticketPreview.type}
        filename={ticketPreview.name}
        title={ticketPreview.title}
      />
      <ConfirmDialog
        open={confirmReject}
        title="Reject Claim"
        description="Are you sure you want to reject this claim? This cannot be undone."
        confirmLabel="Yes, Reject"
        confirmVariant="danger"
        onCancel={() => setConfirmReject(false)}
        onConfirm={() => {
          setConfirmReject(false);
          reject().catch(onActionError);
        }}
      />
    </div>,
    document.body,
  );
}
