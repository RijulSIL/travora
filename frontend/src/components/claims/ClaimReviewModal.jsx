import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CreditCard, FileText, History as HistoryIcon, Plane, Receipt, Undo2, X } from 'lucide-react';

import ClaimTimeline from './ClaimTimeline';
import ConfirmDialog from '../ui/ConfirmDialog';
import InvoicePreviewDrawer from '../ui/InvoicePreviewDrawer';
import Skeleton from '../ui/Skeleton';
import TicketPreviewDrawer from '../ui/TicketPreviewDrawer';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import useToast from '../../hooks/useToast';
import { normalizeApiError } from '../../utils/apiErrors';
import { hasAnyPermission } from '../../services/permissions';
import { reimbursementApi } from '../../services/reimbursementApi';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';

const STATUS_LABELS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_APPROVAL: 'In Approval',
  PENDING_EXCEPTION: 'Pending Exception',
  SENT_BACK: 'Sent Back',
  READY_FOR_PAYMENT: 'Ready for Payment',
  PAID: 'Paid',
  REJECTED: 'Rejected',
  ON_HOLD: 'On Hold',
};

const STATUS_STYLES = {
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  SUBMITTED: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  IN_APPROVAL: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  PENDING_EXCEPTION: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  SENT_BACK: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  READY_FOR_PAYMENT: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  PAID: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  REJECTED: 'bg-red-50 text-red-700 ring-red-600/20',
  ON_HOLD: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

const POLICY_STYLES = {
  OK: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  SOFT_FLAG: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  HARD_BLOCK: 'bg-red-50 text-red-700 ring-red-600/20',
};

const TABS = [
  { key: 'summary', label: 'Summary', icon: FileText },
  { key: 'invoices', label: 'Invoices', icon: Receipt },
  { key: 'trips', label: 'Trips', icon: Plane },
  { key: 'history', label: 'History', icon: HistoryIcon },
];

function StatusPill({ status }) {
  const style = STATUS_STYLES[status] || 'bg-slate-100 text-slate-600 ring-slate-500/20';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${style}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

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
  const approverPerms = ['approve_stage_1', 'approve_stage_2', 'approve_stage_3', 'process_payments'];
  const isApprover = hasAnyPermission(role, approverPerms);
  const { showToast } = useToast();
  useBodyScrollLock(true);

  const [claim, setClaim] = useState(null);
  const [comment, setComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [utr, setUtr] = useState('');
  const [payAmount, setPayAmount] = useState('');
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
          const normalized = String(authoritative);
          setPayableAmount(normalized);
          setPayAmount(normalized);
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

  const { run: pay, loading: paying } = useAsyncAction(async () => {
    await reimbursementApi.recordClaimPayment(claimId, {
      utr_reference: utr,
      amount: payAmount,
    });
    showToast('Payment recorded', 'success');
    onClose();
  });

  const readyForPayment = claim?.status === 'READY_FOR_PAYMENT';
  const payMax = Number(payableAmount || 0);
  const linkedInvoices = claim?.linked_invoices ?? [];
  const linkedTrips = claim?.linked_trips ?? [];

  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/55 p-4 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-6 py-4">
          {claim ? (
            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-lg font-bold text-ink">{claim.claim_reference || `Claim #${claim.id}`}</h2>
                <p className="text-sm text-slate-500">{claim.employee_id ? `Employee #${claim.employee_id}` : 'Employee'}</p>
              </div>
              <StatusPill status={claim.status} />
            </div>
          ) : (
            <div className="h-9 w-40 animate-pulse rounded bg-slate-100" />
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
          <div className="grid flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[1.7fr_1fr]">
            <section className="space-y-4">
              <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
                {TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all ${
                      activeTab === key ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                    onClick={() => setActiveTab(key)}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === 'summary' ? (
                <div className="space-y-2.5">
                  {(claim.expenses || []).map((expense) => (
                    <div key={expense.id} className="flex items-center justify-between rounded-lg border border-line bg-white px-3.5 py-2.5">
                      <span className="text-sm font-medium text-slate-700">{expense.category_name}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-ink">₹{Number(expense.amount || 0).toLocaleString('en-IN')}</span>
                        <PolicyPill status={expense.policy_status} />
                      </div>
                    </div>
                  ))}
                  {!(claim.expenses || []).length ? <p className="text-sm text-slate-500">No expense lines on this claim.</p> : null}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-600">
                    Policy exceptions on this claim:{' '}
                    <span className="text-ink">{(claim.compliance_report?.exceptions || []).length}</span>
                  </div>
                </div>
              ) : null}

              {activeTab === 'invoices' ? (
                <div className="space-y-2">
                  {linkedInvoices.map((invoice) => (
                    <div key={invoice.id} className="rounded-lg border border-line p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-slate-700">{invoice.original_filename}</span>
                        <div className="flex shrink-0 gap-3">
                          <button
                            type="button"
                            className="text-xs font-bold text-brand hover:underline"
                            onClick={async () => {
                              if (!invoiceExtractions[invoice.id]) {
                                const res = await reimbursementApi.invoiceExtraction(invoice.id);
                                setInvoiceExtractions((prev) => ({ ...prev, [invoice.id]: res.data }));
                              }
                              setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id);
                            }}
                          >
                            {expandedInvoiceId === invoice.id ? 'Collapse' : 'Expand'}
                          </button>
                          <button type="button" className="text-xs font-bold text-brand hover:underline" onClick={() => setInvoicePreview(invoice)}>
                            Preview
                          </button>
                        </div>
                      </div>
                      {expandedInvoiceId === invoice.id && invoiceExtractions[invoice.id] ? (
                        <div className="mt-2 overflow-hidden rounded-lg border border-line text-xs">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                                <th className="px-3 py-1.5">Field</th>
                                <th className="px-3 py-1.5">Value</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line bg-white">
                              {(invoiceExtractions[invoice.id].fields || []).map((field) => (
                                <tr key={field.id} className="hover:bg-slate-50/50">
                                  <td className="px-3 py-1.5 font-medium text-slate-700">{field.field_key.replace(/_/g, ' ')}</td>
                                  <td className="px-3 py-1.5 text-ink">{field.final_value || field.original_value || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!linkedInvoices.length ? <p className="text-sm text-slate-500">No invoices linked.</p> : null}
                </div>
              ) : null}

              {activeTab === 'trips' ? (
                <div className="space-y-2">
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
                  {!linkedTrips.length ? <p className="text-sm text-slate-500">No linked trips.</p> : null}
                </div>
              ) : null}

              {activeTab === 'history' ? <ClaimTimeline items={timeline} /> : null}
            </section>

            <aside className="space-y-4">
              {isApprover ? (
                <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-700">Comment</span>
                    <textarea
                      className="field mt-1.5 w-full bg-white"
                      rows={2}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Optional note for the audit trail"
                    />
                  </label>

                  {!readyForPayment ? (
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
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3.5 py-2 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => sendBack().catch(onActionError)}
                      >
                        <Undo2 size={15} />
                        {sending ? 'Sending…' : 'Send Back'}
                      </button>
                    </div>
                  ) : null}

                  <div className="border-t border-slate-200 pt-4">
                    <label className="block text-sm">
                      <span className="font-semibold text-slate-700">Reject reason</span>
                      <textarea
                        className="field mt-1.5 w-full bg-white"
                        rows={2}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Required — explain why this claim is being rejected"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={rejecting || !rejectReason.trim()}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3.5 py-2 text-sm font-bold text-red-700 ring-1 ring-inset ring-red-200 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setConfirmReject(true)}
                    >
                      <X size={15} />
                      Reject
                    </button>
                  </div>

                  {readyForPayment ? (
                    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3.5">
                      <p className="text-xs font-semibold text-violet-800">Authoritative payable: ₹{payableAmount || '0.00'}</p>
                      <label className="mt-2.5 block text-sm">
                        <span className="font-semibold text-slate-700">UTR Reference</span>
                        <input className="field mt-1.5 w-full bg-white" value={utr} onChange={(e) => setUtr(e.target.value)} />
                      </label>
                      <label className="mt-2.5 block text-sm">
                        <span className="font-semibold text-slate-700">Payment Amount</span>
                        <input
                          className="field mt-1.5 w-full bg-white"
                          type="number"
                          step="0.01"
                          value={payAmount}
                          onChange={(e) => {
                            const next = Number(e.target.value || 0);
                            if (Number.isNaN(next)) return;
                            setPayAmount(String(Math.min(next, payMax)));
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={paying || !utr.trim() || Number(payAmount || 0) !== payMax}
                        className="btn-primary mt-3 inline-flex w-full items-center justify-center gap-1.5"
                        onClick={() => pay().catch(onActionError)}
                      >
                        <CreditCard size={15} />
                        {paying ? 'Recording…' : 'Record Payment'}
                      </button>
                    </div>
                  ) : null}
                </div>
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
