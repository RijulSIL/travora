import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import ClaimTimeline from '../components/claims/ClaimTimeline';
import InvoicePreviewDrawer from '../components/ui/InvoicePreviewDrawer';
import Skeleton from '../components/ui/Skeleton';
import TicketPreviewDrawer from '../components/ui/TicketPreviewDrawer';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { useSetPageTitle } from '../context/PageTitleContext';
import { useAsyncAction } from '../hooks/useAsyncAction';
import useToast from '../hooks/useToast';
import { hasAnyPermission } from '../services/permissions';
import { reimbursementApi } from '../services/reimbursementApi';
import { selectResolvedRole, useAuthStore } from '../store/authStore';

export default function ClaimReview() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const role = useAuthStore(selectResolvedRole);
  const approverPerms = ['approve_stage_1', 'approve_stage_2', 'approve_stage_3', 'process_payments'];
  const isApprover = hasAnyPermission(role, approverPerms);
  const backTo = isApprover ? '/claims/pending' : '/claims/my';
  const [claim, setClaim] = useState(null);
  const [comment, setComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [utr, setUtr] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payableAmount, setPayableAmount] = useState('');
  const [timeline, setTimeline] = useState([]);
  const [allInvoices, setAllInvoices] = useState([]);
  const [allTrips, setAllTrips] = useState([]);
  const [activeTab, setActiveTab] = useState('summary');
  const [expandedInvoiceId, setExpandedInvoiceId] = useState(null);
  const [invoiceExtractions, setInvoiceExtractions] = useState({});
  const [invoicePreview, setInvoicePreview] = useState(null);
  const [ticketPreview, setTicketPreview] = useState({ open: false, blob: null, name: '', type: '', title: '' });
  const [confirmReject, setConfirmReject] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!claimId) return;
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
        if (!cancelled) setClaim(null);
        if (!cancelled) showToast(error?.response?.data?.detail || 'Failed to load claim', 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimId, showToast]);

  const { run: approve, loading: approving } = useAsyncAction(async () => {
    await reimbursementApi.approveClaim(claimId, { comment: comment || undefined });
    navigate(backTo);
  });

  const { run: sendBack, loading: sending } = useAsyncAction(async () => {
    await reimbursementApi.sendBackClaim(claimId, { comment });
    navigate(backTo);
  });

  const { run: reject, loading: rejecting } = useAsyncAction(async () => {
    await reimbursementApi.rejectClaim(claimId, { reason: rejectReason });
    navigate(backTo);
  });

  const { run: pay, loading: paying } = useAsyncAction(async () => {
    await reimbursementApi.recordClaimPayment(claimId, {
      utr_reference: utr,
      amount: payAmount,
    });
    navigate(backTo);
  });

  useSetPageTitle(
    claim?.claim_reference
      ? `${claim.claim_reference}`
      : claim
        ? `Claim #${claim.id}`
        : 'Claim review',
  );

  if (!claim) {
    return <Skeleton variant="card" height={220} />;
  }

  const readyForPayment = claim.status === 'READY_FOR_PAYMENT';
  const payMax = Number(payableAmount || 0);
  const linkedInvoices = claim?.linked_invoices ?? [];
  const linkedTrips = claim?.linked_trips ?? [];

  return (
    <div className="mx-auto max-w-7xl">
      <Link className="text-sm text-blue-700" to={backTo}>
        ← Back
      </Link>
      <div className="mt-4 grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <section className="space-y-4">
          <div className="panel rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-ink">{claim.claim_reference || `Claim #${claim.id}`}</h1>
                <p className="text-sm text-slate-600">{claim.employee_id || 'Employee'} · Status {claim.status}</p>
              </div>
            </div>
          </div>
          <div className="panel rounded-lg p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {['summary', 'invoices', 'trips', 'history'].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`rounded px-3 py-1 text-xs font-semibold ${activeTab === tab ? 'bg-brand text-white' : 'bg-slate-100 text-slate-700'}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            {activeTab === 'summary' ? (
              <div className="space-y-3 text-sm">
                {(claim.expenses || []).map((expense) => (
                  <div key={expense.id} className="flex justify-between border-b border-line pb-2">
                    <span>{expense.category_name}</span>
                    <span>₹{Number(expense.amount || 0).toLocaleString('en-IN')} · {expense.policy_status}</span>
                  </div>
                ))}
                <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                  Policy exceptions: {(claim.compliance_report?.exceptions || []).length}
                </div>
              </div>
            ) : null}
            {activeTab === 'invoices' ? (
              <div className="space-y-2">
                {linkedInvoices.map((invoice) => (
                  <div key={invoice.id} className="rounded border border-line p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>{invoice.original_filename}</span>
                      <div className="space-x-2">
                        <button
                          type="button"
                          className="text-xs text-brand underline"
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
                        <button type="button" className="text-xs text-brand underline" onClick={() => setInvoicePreview(invoice)}>
                          Preview
                        </button>
                      </div>
                    </div>
                    {expandedInvoiceId === invoice.id && invoiceExtractions[invoice.id] ? (
                      <div className="mt-2 overflow-hidden rounded border border-line text-xs">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-slate-100 text-left text-xs font-semibold uppercase text-slate-600">
                              <th className="px-3 py-1.5">Field</th>
                              <th className="px-3 py-1.5">Value</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line bg-white">
                            {(invoiceExtractions[invoice.id].fields || []).map((field) => (
                              <tr key={field.id} className="hover:bg-slate-50/50">
                                <td className="px-3 py-1.5 font-medium text-slate-700">
                                  {field.field_key.replace(/_/g, ' ')}
                                </td>
                                <td className="px-3 py-1.5 text-ink">
                                  {field.final_value || field.original_value || '—'}
                                </td>
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
                  <div key={trip.id} className="flex items-center justify-between rounded border border-line p-2 text-sm">
                    <span>{trip.from_city} → {trip.to_city} · {trip.travel_date}</span>
                    {trip.desk_ticket_id ? (
                      <button
                        type="button"
                        className="text-xs text-brand underline"
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
          </div>
        </section>

        <aside className="space-y-4">
          {isApprover ? (
            <div className="panel rounded-lg border border-slate-200 bg-white p-4">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Comment</span>
                <textarea className="field mt-1 w-full" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              {!readyForPayment ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={approving} className="btn-primary" onClick={() => approve()}>
                    ✓ Approve
                  </button>
                  <button type="button" disabled={sending || !comment.trim()} className="rounded bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50" onClick={() => sendBack()}>
                    ↩ Send Back
                  </button>
                </div>
              ) : null}
              <label className="mt-3 block text-sm">
                <span className="font-medium text-slate-700">Reject reason</span>
                <textarea className="field mt-1 w-full" rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
              </label>
              <button type="button" disabled={rejecting || !rejectReason.trim()} className="mt-3 rounded bg-red-100 px-3 py-2 text-sm font-semibold text-red-900 disabled:opacity-50" onClick={() => setConfirmReject(true)}>
                ✗ Reject
              </button>
              {readyForPayment ? (
                <div className="mt-4 rounded border border-slate-200 p-3">
                  <p className="text-xs text-slate-600">Authoritative payable: ₹{payableAmount || '0.00'}</p>
                  <label className="mt-2 block text-sm">
                    UTR Reference
                    <input className="field mt-1 w-full" value={utr} onChange={(e) => setUtr(e.target.value)} />
                  </label>
                  <label className="mt-2 block text-sm">
                    Payment Amount
                    <input
                      className="field mt-1 w-full"
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
                  <button type="button" disabled={paying || !utr.trim() || Number(payAmount || 0) !== payMax} className="btn-primary mt-3" onClick={() => pay()}>
                    💳 Record Payment
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-600">Read-only view. Approvers manage this claim from queue actions.</p>
          )}
        </aside>
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
          reject();
        }}
      />
    </div>
  );
}
