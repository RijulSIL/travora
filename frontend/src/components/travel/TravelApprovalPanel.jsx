import { Bus, ConciergeBell, Plane, TrainFront } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  ApprovalDetailGrid,
  daysFromToday,
  DecisionBox,
  DetailColumn,
  EYEBROW,
  FactGrid,
  firstName,
  Journey,
  Quote,
  RouteTimeline,
  slaRemaining,
  waitingOnYou,
} from '../approvals/ApprovalDetail';
import { reimbursementApi } from '../../services/reimbursementApi';
import { formatDate, formatDatetime, formatRole } from '../../utils/formatters';

const MODE_ICONS = { FLIGHT: Plane, TRAIN: TrainFront, BUS: Bus };

const titleCase = (value) =>
  String(value || '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');

/** Route items for a travel request: requested, any exception reviews, the configured approval
 * stages, then the Travel Desk booking. `decided` = this approver has just acted. */
export function travelRouteItems(request, chain, { employeeName, decided, now }) {
  const items = [
    {
      key: 'requested',
      state: 'done',
      title: `Requested by ${employeeName || 'the employee'}`,
      sub: request.requested_at ? formatDatetime(request.requested_at) : null,
    },
  ];
  const exc = request.exception;
  for (const s of (chain?.exception_stages || []).filter((x) => !exc || x.exception_request_id === exc.id)) {
    const title = `Exception review — ${formatRole(s.required_role)}`;
    if (s.status === 'APPROVED') {
      items.push({ key: `exc-${s.exception_request_id}-${s.required_role}`, state: 'done', title,
        sub: [`Approved${s.acted_by_name ? ` by ${s.acted_by_name}` : ''}`, s.acted_at ? formatDatetime(s.acted_at) : null].filter(Boolean).join(' · '),
        detail: s.comment });
    } else if (s.status === 'REJECTED') {
      items.push({ key: `exc-${s.exception_request_id}-${s.required_role}`, state: 'rejected', title,
        sub: `Rejected${s.acted_by_name ? ` by ${s.acted_by_name}` : ''}`, detail: s.comment });
    } else if (s.status === 'SLA_SKIPPED') {
      items.push({ key: `exc-${s.exception_request_id}-${s.required_role}`, state: 'skipped', title, sub: 'Passed on after the SLA was missed' });
    } else if (s.status === 'PENDING') {
      items.push({ key: `exc-${s.exception_request_id}-${s.required_role}`, state: 'current', title,
        sub: s.pending_approver_names?.length ? `Waiting on ${s.pending_approver_names.join(', ')}` : 'Waiting on a decision' });
    } else {
      items.push({ key: `exc-${s.exception_request_id}-${s.required_role}`, state: 'todo', title, sub: 'Then' });
    }
  }

  const stages = chain?.stages || [];
  const rejected = request.status === 'REJECTED' || stages.some((s) => s.status === 'REJECTED');
  let upcoming = 0;
  for (const s of stages) {
    if (s.status === 'APPROVED') {
      items.push({ key: `stage-${s.stage_number}`, state: 'done', title: s.label,
        sub: [`Approved${s.decided_by_name ? ` by ${s.decided_by_name}` : ''}`, s.decided_at ? formatDatetime(s.decided_at) : null].filter(Boolean).join(' · '),
        detail: s.comment });
    } else if (s.status === 'REJECTED') {
      items.push({ key: `stage-${s.stage_number}`, state: 'rejected', title: s.label,
        sub: `Rejected${s.decided_by_name ? ` by ${s.decided_by_name}` : ''}`, detail: s.comment || request.rejection_reason });
    } else if (s.status === 'SLA_SKIPPED') {
      items.push({ key: `stage-${s.stage_number}`, state: 'skipped', title: s.label, sub: 'Passed on after the SLA was missed' });
    } else if (s.status === 'PENDING') {
      const names = s.pending_approver_names?.length ? s.pending_approver_names.join(', ') : null;
      items.push({ key: `stage-${s.stage_number}`, state: 'current', title: s.label,
        sub: decided ? `Waiting on ${names || 'the next approver'}` : waitingOnYou(slaRemaining(s.sla_deadline_at, now)) });
    } else {
      upcoming += 1;
      items.push({ key: `stage-${s.stage_number}`, state: 'todo', title: s.label,
        sub: rejected ? 'Not reached' : upcoming === 1 ? 'Next' : 'Then' });
    }
  }

  const status = request.status;
  items.push({
    key: 'desk',
    state: status === 'BOOKED' ? 'done' : status === 'APPROVED' || status === 'PARTIALLY_BOOKED' ? 'current' : status === 'CANCELLED' ? 'cancelled' : 'todo',
    title: 'Travel desk booking',
    sub:
      status === 'BOOKED'
        ? 'Booked'
        : status === 'APPROVED'
          ? 'Waiting on the travel desk'
          : status === 'PARTIALLY_BOOKED'
            ? 'Booking in progress'
            : rejected
              ? 'Not reached'
              : 'Last step. Booked once approved',
  });
  return items;
}

/**
 * Pending Approvals → Travel Requests: the opened row. The trip, the approval route, and this
 * approver's decision — same layout as the relocation and exception views.
 */
export default function TravelApprovalPanel({
  request,
  employeeName,
  comment,
  onCommentChange,
  rejecting,
  onRejectingChange,
  busy,
  decided,
  onApprove,
  onReject,
  now,
}) {
  const [chain, setChain] = useState(null);
  const name = firstName(employeeName);

  // Reloaded after a decision so the route shows the new state.
  useEffect(() => {
    let cancelled = false;
    reimbursementApi
      .travelRequestApprovalChain(request.id)
      .then((res) => {
        if (!cancelled) setChain(res.data);
      })
      .catch(() => {
        if (!cancelled) setChain({ stages: [], exception_stages: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [request.id, decided]);

  const isMultiCity = request.trip_type === 'MULTI_CITY' && request.legs?.length > 0;
  const firstDate = isMultiCity ? request.legs[0].travel_date : request.travel_date;
  const ModeIcon = MODE_ICONS[request.travel_mode] || Plane;
  const bookingNeeds = request.needs_additional_booking
    ? request.booking_items?.length
      ? request.booking_items.map((item) => ({ key: item.id, text: item.description }))
      : request.additional_booking_details
        ? [{ key: 'legacy', text: request.additional_booking_details }]
        : []
    : [];

  const stages = chain?.stages || [];
  const current = stages.find((s) => s.status === 'PENDING');
  const next = stages.find((s) => current && s.stage_number > current.stage_number && s.status === 'NOT_STARTED');

  return (
    <ApprovalDetailGrid>
      <DetailColumn first title="The trip" label="Trip details">
        {isMultiCity ? (
          <div className="space-y-1.5">
            {request.legs.map((leg, i) => {
              const LegIcon = MODE_ICONS[leg.travel_mode || request.travel_mode] || Plane;
              return (
                <div key={i} className="flex items-center gap-2.5 rounded-[10px] bg-slate-50 px-3 py-2">
                  <LegIcon size={15} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1 text-[13px] font-bold text-ink">
                    {leg.from_city} <span className="font-medium text-slate-400">→</span> {leg.to_city}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-slate-500">{leg.travel_date ? formatDate(leg.travel_date) : ''}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <Journey from={request.from_city} to={request.to_city} icon={ModeIcon} />
        )}
        <FactGrid
          facts={[
            { label: 'Travel date', value: firstDate ? formatDate(firstDate) : null, hint: daysFromToday(firstDate) },
            { label: 'Return date', value: request.return_date ? formatDate(request.return_date) : null },
            { label: 'Trip type', value: request.trip_type ? titleCase(request.trip_type) : null },
            { label: 'Mode', value: isMultiCity ? null : request.travel_mode ? titleCase(request.travel_mode) : null },
            { label: 'Travel type', value: request.travel_type === 'PROJECT' ? 'Project' : 'Non-project' },
            { label: 'Project code', value: request.project_code },
            { label: 'Purpose', value: request.purpose },
          ]}
        />
        {bookingNeeds.length ? (
          <div className="rounded-[10px] border border-amber-200/80 bg-amber-50/60 px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-amber-800">
              <ConciergeBell size={12} /> Also needs the company to book
            </div>
            <ul className="m-0 list-disc space-y-0.5 pl-4 text-[12.5px] text-slate-700">
              {bookingNeeds.map((need) => (
                <li key={need.key} className="whitespace-pre-wrap break-words">{need.text}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <Quote title={`Notes from ${name}`} text={request.notes} />
      </DetailColumn>

      <DetailColumn title="Approval route">
        {chain ? (
          <RouteTimeline items={travelRouteItems(request, chain, { employeeName, decided, now })} />
        ) : (
          <p className={EYEBROW}>Loading the route…</p>
        )}
      </DetailColumn>

      <DetailColumn title="Your decision">
        <DecisionBox
          idPrefix={`travel-${request.id}`}
          name={employeeName}
          comment={comment}
          onCommentChange={onCommentChange}
          rejectMode={rejecting}
          onRejectModeChange={onRejectingChange}
          busy={busy}
          decided={decided}
          onApprove={onApprove}
          onReject={onReject}
          commentPlaceholder="e.g. Fine to go ahead"
          reasonPlaceholder="e.g. Please travel by train for this distance"
          hint={
            <>
              {!chain ? null : next ? (
                <>
                  Approving passes it to <b className="text-ink">{next.label}</b>.
                </>
              ) : (
                <>Yours is the last approval: approving sends it to the travel desk for booking.</>
              )}{' '}
              Rejecting ends the request and tells {name} why.
            </>
          }
        />
      </DetailColumn>
    </ApprovalDetailGrid>
  );
}
