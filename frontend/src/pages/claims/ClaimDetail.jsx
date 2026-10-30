import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Clock,
  Download,
  Eye,
  FileText,
  PencilLine,
  Plane,
  Undo2,
  Wallet,
  X,
} from 'lucide-react';

import { EYEBROW, RouteTimeline, slaRemaining } from '../../components/approvals/ApprovalDetail';
import ClaimExceptionList from '../../components/claims/ClaimExceptionList';
import { RelocationClaimPanel } from '../../components/claims/ClaimRelocationSteps';
import { claimRouteItems } from '../../components/claims/claimRoute';
import ClaimStatusBadge from '../../components/ui/ClaimStatusBadge';
import ReimbursementCategoryBadge from '../../components/ui/ReimbursementCategoryBadge';
import InvoicePreviewDrawer from '../../components/ui/InvoicePreviewDrawer';
import Skeleton from '../../components/ui/Skeleton';
import TicketPreviewDrawer from '../../components/ui/TicketPreviewDrawer';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';
import { useAuthStore } from '../../store/authStore';
import { claimEditPath } from '../../utils/claimRoutes';
import { formatDate, formatDatetime, formatRole } from '../../utils/formatters';

const inr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const POLICY = {
  OK: { label: 'OK', cls: 'bg-emerald-50 text-emerald-700' },
  Compliant: { label: 'OK', cls: 'bg-emerald-50 text-emerald-700' },
  SOFT_FLAG: { label: 'Soft flag', cls: 'bg-amber-50 text-amber-700' },
  HARD_BLOCK: { label: 'Hard block', cls: 'bg-rose-50 text-rose-700' },
};

function PolicyPill({ status }) {
  const p = POLICY[status] || { label: String(status || '—').replace(/_/g, ' '), cls: 'bg-slate-100 text-slate-600' };
  return <span className={`inline-block rounded-full px-2 py-px text-[10.5px] font-bold ${p.cls}`}>{p.label}</span>;
}

const BANNER_TONES = {
  ok: { box: 'border-emerald-200 bg-emerald-50', icon: 'text-emerald-700', title: 'text-emerald-700' },
  amber: { box: 'border-amber-200 bg-amber-50', icon: 'text-amber-700', title: 'text-amber-900' },
  rose: { box: 'border-rose-200 bg-rose-50', icon: 'text-rose-700', title: 'text-rose-900' },
  slate: { box: 'border-slate-200 bg-slate-50', icon: 'text-slate-500', title: 'text-ink' },
};

/** What's happened to the claim and what comes next — the first thing the page says. */
function StatusBanner({ tone, icon: Icon, title, sub, quote, facts = [], action }) {
  const t = BANNER_TONES[tone] || BANNER_TONES.slate;
  return (
    <section className={`flex flex-wrap items-center gap-x-[22px] gap-y-3.5 rounded-[14px] border px-5 py-4 ${t.box}`} aria-live="polite">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white ${t.icon}`}>
        <Icon size={19} strokeWidth={2.5} />
      </div>
      <div className="min-w-[220px] flex-1">
        <div className={`text-[15px] font-extrabold ${t.title}`}>{title}</div>
        {sub ? <div className="mt-0.5 text-[12.5px] leading-relaxed text-slate-700">{sub}</div> : null}
        {quote ? (
          <div className="mt-1.5 border-l-[3px] border-rose-200 pl-2.5 text-[12.5px] italic text-rose-900">&ldquo;{quote}&rdquo;</div>
        ) : null}
      </div>
      {facts.length ? (
        <div className="flex flex-wrap gap-2">
          {facts.map((f) => (
            <div key={f.label} className="rounded-[10px] bg-white/75 px-3 py-1.5">
              <div className="text-[10.5px] font-semibold text-slate-500">{f.label}</div>
              <div className="font-mono text-[12.5px] font-bold text-ink">{f.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {action || null}
    </section>
  );
}

export default function ClaimDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const viewerName = useAuthStore((s) => s.profile?.full_name);
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
      } else {
        setChain({ stages: [], exception_stages: [], upcoming_stages: [] });
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
  const expenses = claim.expenses || [];
  const totalClaimed = Number(report.total_claimed ?? expenses.reduce((s, e) => s + Number(e.amount || 0), 0));
  const isTripClaim = claim.reimbursement_category !== 'GENERAL' && claim.reimbursement_category !== 'RELOCATION';
  const sentBackEvent = [...timeline].reverse().find((item) => item.event === 'sent_back');

  // GST: one taxable figure (older reports carry it twice), the taxes, and the ITC amount.
  const gst = report.gst_summary || {};
  const taxable = gst.total_taxable_value ?? gst.taxable_value;
  const taxes = [
    { key: 'taxable', label: 'Taxable', value: taxable },
    { key: 'cgst', label: 'CGST', value: gst.cgst },
    { key: 'sgst', label: 'SGST', value: gst.sgst },
    { key: 'igst', label: 'IGST', value: gst.igst },
    ...(Number(gst.other_tax || 0) ? [{ key: 'other_tax', label: 'Other tax', value: gst.other_tax }] : []),
  ];
  const hasGst = Object.keys(gst).length > 0;

  const stages = chain?.stages || [];
  const pending = stages.find((s) => s.status === 'PENDING');
  // The claim's policy exceptions, each with every approver's decision on it.
  const exceptionItems = chain?.exceptions || [];
  const exceptionStep = (chain?.exception_stages || []).find((s) => s.status === 'PENDING');
  const exceptionSentBackBy = (chain?.exception_stages || []).find((s) => s.itemized && s.status === 'SENT_BACK');
  const nextAfterPending = stages.find((s) => pending && s.stage_number > pending.stage_number && s.status === 'NOT_STARTED');

  let banner;
  if (claim.status === 'PAID') {
    banner = {
      tone: 'ok',
      icon: Check,
      title: `Paid ${inr(claim.payment_amount ?? claim.approved_amount ?? totalClaimed)}`,
      sub: claim.payment_recorded_at ? `on ${formatDatetime(claim.payment_recorded_at)}` : null,
      facts: [
        claim.payment_utr ? { label: 'UTR', value: claim.payment_utr } : null,
        { label: 'TDS & deductions', value: inr(claim.tds_deduction) },
      ].filter(Boolean),
    };
  } else if (claim.status === 'REJECTED') {
    banner = { tone: 'rose', icon: X, title: 'Claim rejected', quote: claim.reject_reason || null };
  } else if (claim.status === 'SENT_BACK') {
    banner = {
      tone: 'rose',
      icon: Undo2,
      title: exceptionSentBackBy ? 'Policy exceptions sent back to fix' : 'Sent back to fix',
      sub: [sentBackEvent?.actor ? `by ${sentBackEvent.actor}` : null, sentBackEvent?.timestamp ? formatDatetime(sentBackEvent.timestamp) : null]
        .filter(Boolean)
        .join(', ') || null,
      quote: sentBackEvent?.comment || 'Please update and resubmit',
      ...(exceptionSentBackBy
        ? {
            sub: `${exceptionSentBackBy.acted_by_name ? `${exceptionSentBackBy.acted_by_name} sent` : 'Sent'} back the exceptions marked below. Change their reason or bill and resubmit — the claim goes back to ${
              exceptionSentBackBy.acted_by_name || formatRole(exceptionSentBackBy.required_role)
            }, who decides only those again.`,
          }
        : {}),
      action: (
        <button type="button" className="btn-primary gap-1.5" onClick={() => navigate(claimEditPath(claim))}>
          <PencilLine size={14} /> Edit &amp; resubmit
        </button>
      ),
    };
  } else if (claim.status === 'DRAFT') {
    banner = {
      tone: 'slate',
      icon: FileText,
      title: 'Draft, not submitted yet',
      sub: 'Finish it and submit it when you are ready.',
      action: (
        <button type="button" className="btn-primary gap-1.5" onClick={() => navigate(claimEditPath(claim))}>
          <PencilLine size={14} /> Edit draft
        </button>
      ),
    };
  } else if (claim.status === 'PENDING_EXCEPTION') {
    banner = {
      tone: 'amber',
      icon: Clock,
      title: 'Waiting on policy exception approvals',
      sub: [
        exceptionStep?.pending_approver_names?.length ? `With ${exceptionStep.pending_approver_names.join(', ')} now.` : null,
        'Each exception approver accepts, rejects or sends back every exception. Once the last one accepts them all, the claim goes to Finance for payment.',
      ]
        .filter(Boolean)
        .join(' '),
    };
  } else if (pending) {
    const left = slaRemaining(pending.sla_deadline_at);
    const names = pending.pending_approver_names || [];
    const who = viewerName && names.includes(viewerName) ? 'You have' : names.length ? `${names.join(', ')} ${names.length > 1 ? 'have' : 'has'}` : null;
    banner = {
      tone: 'amber',
      icon: Clock,
      title: `Waiting on ${pending.label}`,
      sub: [
        who && left && left !== 'SLA Breached' ? `${who} ${left} left to act.` : null,
        left === 'SLA Breached' ? 'The SLA for this stage has passed.' : null,
        nextAfterPending ? `If it isn't acted on in time, it passes on to ${nextAfterPending.label}.` : null,
      ]
        .filter(Boolean)
        .join(' ') || null,
      facts: [{ label: 'Stage', value: `${stages.indexOf(pending) + 1} of ${stages.length}` }],
    };
  } else {
    banner = { tone: 'amber', icon: Clock, title: 'In approval', sub: null };
  }

  return (
    <div className="space-y-3.5">
      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-slate-200 bg-white bg-gradient-to-r from-brand/[0.06] via-white to-white px-[22px] py-[18px]">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Wallet size={21} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-ink">{claim.claim_reference || `Claim #${claim.id}`}</h1>
              <ReimbursementCategoryBadge category={claim.reimbursement_category} />
              <ClaimStatusBadge status={claim.status} />
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {claim.submitted_at
                ? `Submitted by ${claim.employee_name || 'the employee'} · ${formatDatetime(claim.submitted_at)}`
                : `Created ${formatDate(claim.created_at)}`}
              {isTripClaim && (claim.office_location || claim.destination_city) ? (
                <>
                  {' '}·{' '}
                  <Plane size={12} className="-mt-0.5 inline text-slate-400" />{' '}
                  {[claim.office_location, claim.destination_city].filter(Boolean).join(' → ')}
                  {claim.departure_date && claim.return_date ? ` · ${formatDate(claim.departure_date)} – ${formatDate(claim.return_date)}` : ''}
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-[18px]">
          <div className="text-right">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-500">Total claimed</div>
            <div className="font-mono text-[22px] font-semibold text-brand">{inr(totalClaimed)}</div>
          </div>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 print:hidden"
            onClick={() => window.print()}
          >
            <Download size={13} /> Download PDF
          </button>
        </div>
      </section>

      <StatusBanner {...banner} />

      {report.is_late_submission ? (
        <div className="flex items-center gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={15} className="shrink-0 text-amber-600" />
          <span>
            <b>Late claim:</b>{' '}
            {report.days_since_trip != null
              ? `submitted ${report.days_since_trip} days after the trip ended, so it needed a late-claim exception.`
              : `sent ${report.late_by_days} day(s) after the deadline, so it may get extra scrutiny.`}
          </span>
        </div>
      ) : null}

      {/* The claim · the approval route */}
      <section className="grid overflow-hidden rounded-[14px] border border-slate-200 bg-white lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4 px-5 py-[18px]" aria-label="The claim">
          <div className={EYEBROW}>The claim</div>

          <div>
            <div className={`${EYEBROW} mb-1.5`}>Expenses ({expenses.length})</div>
            <div className="overflow-hidden rounded-[10px] border border-slate-200">
              {expenses.map((expense, i) => (
                <div
                  key={expense.id}
                  className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 ${i ? 'border-t border-slate-100' : ''}`}
                >
                  <span className="text-[13px] font-bold text-ink">{expense.category_name}</span>
                  <PolicyPill status={expense.policy_status} />
                  <span className="text-right font-mono text-[13px] text-ink">{inr(expense.amount)}</span>
                </div>
              ))}
              {!expenses.length ? <p className="px-3 py-2.5 text-xs text-slate-500">No expenses on this claim.</p> : null}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-slate-100 bg-slate-50 px-3 py-2.5">
                <span className="text-[11.5px] font-bold uppercase tracking-[0.05em] text-slate-500">Total</span>
                <span className="text-right font-mono text-[13px] font-semibold text-brand">{inr(totalClaimed)}</span>
              </div>
            </div>
          </div>

          {exceptionItems.length ? (
            <div>
              <div className={`${EYEBROW} mb-1.5`}>Policy exceptions ({exceptionItems.length})</div>
              <div className="overflow-hidden rounded-[10px] border border-slate-200">
                <ClaimExceptionList exceptions={exceptionItems} />
              </div>
            </div>
          ) : null}

          {hasGst ? (
            <div>
              <div className={`${EYEBROW} mb-1.5`}>GST</div>
              <div className={`grid overflow-hidden rounded-[10px] border border-slate-200 ${taxes.length === 5 ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
                {taxes.map((t, i) => (
                  <div key={t.key} className={`px-2.5 py-2 ${i ? 'border-l border-slate-100' : ''}`}>
                    <div className="text-[10.5px] font-semibold text-slate-500">{t.label}</div>
                    <div className="mt-0.5 font-mono text-[12.5px] text-ink">{inr(t.value)}</div>
                  </div>
                ))}
              </div>
              {gst.itc_eligible_amount != null ? (
                <p className="mt-1.5 text-[11.5px] text-slate-500">
                  Input tax credit eligible: <b className="font-mono font-semibold text-emerald-700">{inr(gst.itc_eligible_amount)}</b>
                </p>
              ) : null}
            </div>
          ) : null}

          {claim.relocation ? (
            <RelocationClaimPanel
              relocation={claim.relocation}
              onPreviewEvidence={async () => {
                try {
                  const response = await reimbursementApi.claimRelocationEvidenceBlob(claim.id);
                  setTicketPreview({
                    open: true,
                    blob: response.data,
                    name: claim.relocation.evidence_filename || 'relocation-approval',
                    type: response.headers['content-type'] || '',
                    title: `${claim.relocation.reference || 'Relocation'} · approval evidence`,
                  });
                } catch {
                  showToast('Could not open the approval evidence', 'error');
                }
              }}
            />
          ) : null}

          <div>
            <div className={`${EYEBROW} mb-1.5`}>Invoices ({linkedInvoices.length})</div>
            <div className="space-y-2">
              {linkedInvoices.map((invoice) => (
                <div key={invoice.id} className="flex items-center gap-2.5 rounded-[10px] border border-slate-200 px-3 py-2.5">
                  <FileText size={17} className="shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold text-ink" title={invoice.original_filename}>
                      {invoice.original_filename}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    onClick={() => setInvoicePreview(invoice)}
                  >
                    <Eye size={12} /> Preview
                  </button>
                </div>
              ))}
              {!linkedInvoices.length ? <p className="text-xs text-slate-500">No linked invoices.</p> : null}
            </div>
          </div>

          {/* General/Relocation claims are never trip-linked. */}
          {isTripClaim ? (
            <div>
              <div className={`${EYEBROW} mb-1.5`}>Trips ({linkedTrips.length})</div>
              <div className="space-y-2">
                {linkedTrips.map((trip) => (
                  <div key={trip.id} className="flex items-center gap-2.5 rounded-[10px] border border-slate-200 px-3 py-2.5">
                    <Plane size={16} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
                      {trip.from_city} → {trip.to_city}
                      <span className="ml-1.5 text-xs font-medium text-slate-500">{trip.travel_date ? formatDate(trip.travel_date) : ''}</span>
                    </span>
                    {trip.desk_ticket_id ? (
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        onClick={async () => {
                          try {
                            const response = await reimbursementApi.travelTicketFileBlob(trip.desk_ticket_id);
                            setTicketPreview({
                              open: true,
                              ticketId: trip.desk_ticket_id,
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
                        <Eye size={12} /> View ticket
                      </button>
                    ) : null}
                  </div>
                ))}
                {!linkedTrips.length ? <p className="text-xs text-slate-500">No linked trips.</p> : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4 border-t border-slate-100 px-5 py-[18px] lg:border-l lg:border-t-0" aria-label="Approval route">
          <div className={EYEBROW}>Approval route</div>
          {chain ? (
            <RouteTimeline items={claimRouteItems(claim, chain, { viewerName, decided: null, now: Date.now() })} />
          ) : (
            <p className="text-xs text-slate-400">Loading the route…</p>
          )}
        </div>
      </section>

      <InvoicePreviewDrawer open={Boolean(invoicePreview)} onClose={() => setInvoicePreview(null)} invoice={invoicePreview} />
      <TicketPreviewDrawer
        open={ticketPreview.open}
        ticketId={ticketPreview.ticketId}
        onClose={() => setTicketPreview((prev) => ({ ...prev, open: false }))}
        blob={ticketPreview.blob}
        contentType={ticketPreview.type}
        filename={ticketPreview.name}
        title={ticketPreview.title}
      />
    </div>
  );
}
