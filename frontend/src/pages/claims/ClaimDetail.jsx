import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText, Plane, Eye, Download, Send, AlertTriangle } from 'lucide-react';

import ApprovalStepper from '../../components/claims/ApprovalStepper';
import ClaimTimeline from '../../components/claims/ClaimTimeline';
import InvoicePreviewDrawer from '../../components/ui/InvoicePreviewDrawer';
import Skeleton from '../../components/ui/Skeleton';
import TicketPreviewDrawer from '../../components/ui/TicketPreviewDrawer';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';
import { formatCurrency, formatDatetime } from '../../utils/formatters';

export default function ClaimDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [claim, setClaim] = useState(null);
  const [chain, setChain] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [invoicePreview, setInvoicePreview] = useState(null);
  const [ticketPreview, setTicketPreview] = useState({ open: false, blob: null, name: '', type: '', title: '' });

  useSetPageTitle(claim?.claim_reference || `Claim #${id}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setClaim(null);
      setChain(null);
      setTimeline([]);
      try {
        const detailRes = await reimbursementApi.claimDetail(id);
        if (cancelled) return;
        setClaim(detailRes.data);
      } catch (error) {
        if (!cancelled) showToast(error?.response?.data?.detail || 'Could not load claim details', 'error');
        return;
      }

      const [chainResult, timelineResult] = await Promise.allSettled([
        reimbursementApi.approvalChain(id),
        reimbursementApi.claimTimeline(id),
      ]);
      if (cancelled) return;
      if (chainResult.status === 'fulfilled') {
        setChain(chainResult.value.data);
      }
      if (timelineResult.status === 'fulfilled') {
        setTimeline(timelineResult.value.data || []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, showToast]);

  const linkedInvoices = useMemo(() => claim?.linked_invoices ?? [], [claim]);
  const linkedTrips = useMemo(() => claim?.linked_trips ?? [], [claim]);

  if (!claim) return <Skeleton variant="card" height={240} />;

  const report = claim.compliance_report || {};
  const sentBackEvent = [...timeline].reverse().find((item) => item.event === 'sent_back');

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="space-y-6">
          <div className="flex justify-end print:hidden">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition-all shadow-sm"
              onClick={() => window.print()}
            >
              <Download size={13} />
              <span>Download PDF</span>
            </button>
          </div>

          {/* Header Panel */}
          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 bg-slate-50/50 border-b border-line/60">
              <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">{claim.claim_reference || `Claim #${claim.id}`}</h1>
                <p className="mt-1 text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <Plane size={13} className="text-slate-400" />
                  <span>{[claim.office_location, claim.destination_city].filter(Boolean).join(' → ') || 'Trip route pending'}</span>
                  {claim.departure_date && claim.return_date ? (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>{claim.departure_date} - {claim.return_date}</span>
                    </>
                  ) : null}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                claim.status === 'READY_FOR_PAYMENT' || claim.status === 'PAID'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : claim.status === 'REJECTED'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  claim.status === 'READY_FOR_PAYMENT' || claim.status === 'PAID'
                    ? 'bg-emerald-500'
                    : claim.status === 'REJECTED'
                      ? 'bg-red-500'
                      : 'bg-amber-500 animate-pulse'
                }`} />
                {claim.status}
              </span>
            </div>
          </div>

          {report.is_late_submission && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-amber-900">Late Submission Warning</h3>
                  <p className="text-xs text-amber-800">
                    This claim was submitted {report.late_by_days} day(s) after the configured deadline and may require additional scrutiny.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Expense Breakdown */}
          <div className="panel overflow-hidden">
            <div className="border-b border-line/60 bg-slate-50/50 px-5 py-4">
              <h2 className="text-sm font-bold text-ink uppercase tracking-wider">Expense Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line/60 bg-slate-50/70 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="px-5 py-3.5">Category</th>
                    <th className="px-5 py-3.5">Claimed</th>
                    <th className="px-5 py-3.5">Policy</th>
                  </tr>
                </thead>
                <tbody>
                  {(claim.expenses || []).map((expense) => {
                    const isCompliant = expense.policy_status === 'Compliant';
                    return (
                      <tr key={expense.id} className="border-b border-slate-100 last:border-none hover:bg-slate-50/50 transition-colors duration-150">
                        <td className="px-5 py-4 font-semibold text-slate-800">{expense.category_name}</td>
                        <td className="px-5 py-4 font-bold text-slate-900">{formatCurrency(expense.amount)}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                            isCompliant
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-red-50 text-red-700 border-red-200 animate-pulse'
                          }`}>
                            {expense.policy_status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* GST Summary */}
          <div className="panel overflow-hidden">
            <div className="border-b border-line/60 bg-slate-50/50 px-5 py-4">
              <h2 className="text-sm font-bold text-ink uppercase tracking-wider">GST Summary</h2>
            </div>
            <div className="p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.entries(report.gst_summary || {}).map(([key, value]) => {
                  const label = key.replace(/_/g, ' ').toUpperCase();
                  const isTotal = key === 'grand_total';
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between rounded-xl p-3.5 text-sm border transition-all ${
                        isTotal
                          ? 'bg-brand/5 border-brand/20 font-bold text-brand shadow-sm'
                          : 'bg-slate-50/30 border-slate-100 font-medium text-slate-700 hover:bg-slate-50/60'
                      }`}
                    >
                      <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">{label}</span>
                      <span className="font-bold text-slate-900">{formatCurrency(value)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Linked Invoices */}
          <div className="panel overflow-hidden">
            <div className="border-b border-line/60 bg-slate-50/50 px-5 py-4">
              <h2 className="text-sm font-bold text-ink uppercase tracking-wider">Linked Invoices</h2>
            </div>
            <div className="p-5 space-y-2.5">
              {linkedInvoices.map((invoice) => (
                <div key={invoice.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/30 p-3.5 text-sm hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2.5 truncate">
                    <FileText size={16} className="text-slate-400 shrink-0" />
                    <span className="truncate font-medium text-slate-700">{invoice.original_filename}</span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-all active:scale-[0.98]"
                    onClick={() => setInvoicePreview(invoice)}
                  >
                    <Eye size={12} />
                    <span>Preview</span>
                  </button>
                </div>
              ))}
              {!linkedInvoices.length ? <p className="text-sm text-slate-500">No linked invoices.</p> : null}
            </div>
          </div>

          {/* Linked Trips */}
          <div className="panel overflow-hidden">
            <div className="border-b border-line/60 bg-slate-50/50 px-5 py-4">
              <h2 className="text-sm font-bold text-ink uppercase tracking-wider">Linked Trips</h2>
            </div>
            <div className="p-5 space-y-2.5">
              {linkedTrips.map((trip) => (
                <div key={trip.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/30 p-3.5 text-sm hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2.5 truncate">
                    <Plane size={16} className="text-slate-400 shrink-0" />
                    <span className="truncate font-medium text-slate-700">
                      {trip.from_city} → {trip.to_city} · {trip.travel_date}
                    </span>
                  </div>
                  {trip.desk_ticket_id ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-all active:scale-[0.98]"
                      onClick={async () => {
                        try {
                          const response = await reimbursementApi.travelTicketFileBlob(trip.desk_ticket_id);
                          setTicketPreview({
                            open: true,
                            blob: response.data,
                            name: `${trip.reference_id || trip.id}-ticket`,
                            type: response.headers['content-type'] || '',
                            title: `Trip ${trip.reference_id || trip.id}`,
                          });
                        } catch {
                          showToast('Could not open ticket preview', 'error');
                        }
                      }}
                    >
                      <Eye size={12} />
                      <span>View Ticket</span>
                    </button>
                  ) : null}
                </div>
              ))}
              {!linkedTrips.length ? <p className="text-sm text-slate-500">No linked trips.</p> : null}
            </div>
          </div>
        </section>

        {/* Right Sidebar */}
        <aside className="space-y-6">
          <div className="panel overflow-hidden">
            <div className="border-b border-line/60 bg-slate-50/50 px-5 py-4">
              <h2 className="text-sm font-bold text-ink uppercase tracking-wider">Approval Stepper</h2>
            </div>
            <div className="p-5">
              <ApprovalStepper stages={chain?.stages || []} />
            </div>
          </div>
          {['SENT_BACK', 'DRAFT'].includes(claim.status) ? (
            <div className={`rounded-xl border p-5 ${claim.status === 'SENT_BACK' ? 'border-red-100 bg-red-50/50' : 'border-slate-200 bg-slate-50/50'}`}>
              <h3 className={`text-sm font-bold ${claim.status === 'SENT_BACK' ? 'text-red-800' : 'text-slate-800'}`}>
                {claim.status === 'SENT_BACK' ? 'Claim was sent back' : 'Claim is a draft'}
              </h3>
              {claim.status === 'SENT_BACK' && (
                <>
                  <p className="mt-2 text-xs text-red-700/80 font-medium">
                    Returned by <span className="font-bold text-red-800">{sentBackEvent?.actor || 'Approver'}</span> on{' '}
                    {sentBackEvent?.timestamp ? formatDatetime(sentBackEvent.timestamp) : '—'}:
                  </p>
                  <p className="mt-1.5 rounded-lg bg-white/60 border border-red-100/50 px-3 py-2 text-xs italic text-red-700/90">&quot;{sentBackEvent?.comment || 'Please update and resubmit'}&quot;</p>
                </>
              )}
              {claim.status === 'DRAFT' && (
                <p className="mt-2 text-xs text-slate-600">
                  This claim has not been submitted yet. You can continue editing it to finish the process.
                </p>
              )}
              <button
                type="button"
                className="btn-primary mt-4 w-full justify-center gap-1.5"
                onClick={() => navigate(`/claims/new?edit=${claim.id}`)}
              >
                {claim.status === 'SENT_BACK' ? <Send size={14} /> : null}
                <span>{claim.status === 'SENT_BACK' ? 'Edit & Resubmit' : 'Edit Draft'}</span>
              </button>
            </div>
          ) : null}
        </aside>
      </div>

      {/* Claim Timeline */}
      <div className="panel overflow-hidden">
        <div className="border-b border-line/60 bg-slate-50/50 px-5 py-4">
          <h2 className="text-sm font-bold text-ink uppercase tracking-wider">Claim Timeline</h2>
        </div>
        <div className="p-5">
          <ClaimTimeline items={timeline} />
        </div>
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
    </div>
  );
}
