import { AlertTriangle, Bus, Plane, TrainFront } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  ApprovalDetailGrid,
  daysFromToday,
  DecisionBox,
  DetailColumn,
  FactGrid,
  firstName,
  Journey,
  NoticeBox,
  OutcomeBox,
  Quote,
  RouteTimeline,
  slaRemaining,
  waitingOnYou,
} from './ApprovalDetail';
import TravelPicksSummary from '../travel/TravelPicksSummary';
import { describeExceptionType, formatDate, formatDatetime, formatExceptionType, formatRole } from '../../utils/formatters';

const MODE_ICONS = { FLIGHT: Plane, TRAIN: TrainFront, BUS: Bus };

const titleCase = (value) =>
  String(value || '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');

const money = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function routeItems(row, { canDecide, decided, now }) {
  const decisions = row.decisions || [];
  const ended = row.status === 'REJECTED' || row.status === 'CANCELLED';
  let upcoming = 0;
  const items = [
    {
      key: 'requested',
      state: 'done',
      title: `Requested by ${row.employee || 'the employee'}`,
      sub: row.requested_on ? formatDatetime(row.requested_on) : null,
    },
  ];
  decisions.forEach((d, i) => {
    const title = `${formatRole(d.required_role)} review`;
    const key = `step-${i}`;
    if (d.status === 'APPROVED') {
      items.push({
        key,
        state: 'done',
        title,
        sub: [`Approved${d.acted_by_name ? ` by ${d.acted_by_name}` : ''}`, d.acted_at ? formatDatetime(d.acted_at) : null]
          .filter(Boolean)
          .join(' · '),
        detail: d.comment,
      });
    } else if (d.status === 'REJECTED') {
      items.push({ key, state: 'rejected', title, sub: `Rejected${d.acted_by_name ? ` by ${d.acted_by_name}` : ''}`, detail: d.comment });
    } else if (d.status === 'SLA_SKIPPED') {
      items.push({ key, state: 'skipped', title, sub: 'Passed on after the SLA was missed' });
    } else if (d.status === 'PENDING' && !ended) {
      items.push({
        key,
        state: 'current',
        title,
        sub: canDecide && !decided ? waitingOnYou(slaRemaining(d.sla_deadline_at, now)) : `Waiting on ${formatRole(d.required_role)}`,
      });
    } else {
      upcoming += 1;
      items.push({ key, state: ended ? 'cancelled' : 'todo', title, sub: ended ? 'Not reached' : upcoming === 1 ? 'Next' : 'Then' });
    }
  });
  if (row.travel_request) {
    items.push({
      key: 'after',
      state: 'todo',
      title: 'Travel desk booking',
      sub: ended ? 'Not reached' : 'Once this exception is approved, the request goes to the travel desk',
    });
  } else if (row.claim_id) {
    items.push({
      key: 'after',
      state: 'todo',
      title: 'Finance payment',
      sub: ended ? 'Not reached' : 'Once every exception on the claim is approved',
    });
  }
  return items;
}

/**
 * Exception Requests: the opened row. What's flagged (and why the employee says it's needed),
 * the exception's approval route, and this approver's decision — the same layout as the
 * Pending Approvals panels.
 */
export default function ExceptionApprovalPanel({
  row,
  canDecide,
  hasActed,
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
  const name = firstName(row.employee);
  const types = row.exception_types?.length ? row.exception_types : [row.exception_type];
  const tr = row.travel_request;
  const isMultiCity = tr?.trip_type === 'MULTI_CITY' && tr?.legs?.length > 0;
  const firstDate = isMultiCity ? tr.legs[0].travel_date : tr?.travel_date;
  const decisions = row.decisions || [];
  const currentIndex = decisions.findIndex((d) => d.status === 'PENDING');
  const nextStep = currentIndex >= 0 ? decisions.slice(currentIndex + 1).find((d) => d.status !== 'APPROVED') : null;
  const waitingOn = currentIndex >= 0 ? formatRole(decisions[currentIndex].required_role) : 'the next approver';

  let decision;
  if (decided) {
    decision = <OutcomeBox ok={decided.ok}>{decided.text}</OutcomeBox>;
  } else if (row.status === 'PENDING' && canDecide) {
    decision = (
      <DecisionBox
        idPrefix={`exception-${row.exception_id}`}
        name={row.employee}
        comment={comment}
        onCommentChange={onCommentChange}
        rejectMode={rejecting}
        onRejectModeChange={onRejectingChange}
        busy={busy}
        onApprove={onApprove}
        onReject={onReject}
        approveLabel="Approve exception"
        rejectLabel="Reject exception"
        commentPlaceholder="e.g. Only option available on that date"
        reasonPlaceholder="e.g. A cheaper option was available"
        hint={
          <>
            {nextStep ? (
              <>
                Approving passes it to <b className="text-ink">{formatRole(nextStep.required_role)}</b>.
              </>
            ) : (
              <>Yours is the last approval for this exception.</>
            )}{' '}
            {tr
              ? `Rejecting rejects ${name}'s travel request.`
              : row.claim_id
                ? `Rejecting rejects ${name}'s whole claim.`
                : `Rejecting tells ${name} why.`}
          </>
        }
      />
    );
  } else if (row.status === 'PENDING') {
    decision = hasActed ? (
      <NoticeBox tone="emerald" title="You've approved your step">
        It&apos;s now waiting on {waitingOn}.
      </NoticeBox>
    ) : (
      <NoticeBox title={`Waiting on ${waitingOn}`}>This step isn&apos;t yours to decide.</NoticeBox>
    );
  } else if (row.status === 'APPROVED') {
    decision = <OutcomeBox ok>Approved{row.decided_by ? ` by ${row.decided_by}` : ''}.</OutcomeBox>;
  } else if (row.status === 'REJECTED') {
    decision = (
      <OutcomeBox ok={false}>
        Rejected{row.decided_by ? ` by ${row.decided_by}` : ''}.{row.decision_comment ? ` “${row.decision_comment}”` : ''}
      </OutcomeBox>
    );
  } else {
    decision = (
      <NoticeBox title="Cancelled">{row.decision_comment || 'This exception request was cancelled.'}</NoticeBox>
    );
  }

  return (
    <ApprovalDetailGrid>
      <DetailColumn first title="What's flagged" label="Exception details">
        <div className="space-y-2 rounded-[10px] border border-amber-200/80 bg-amber-50/60 px-3.5 py-3">
          {types.map((type) => (
            <div key={type} className="text-[12.5px] leading-relaxed">
              <div className="flex items-center gap-1.5 font-bold text-amber-900">
                <AlertTriangle size={13} className="shrink-0" /> {formatExceptionType(type)}
              </div>
              <div className="text-slate-600">{describeExceptionType(type)}</div>
            </div>
          ))}
        </div>

        {tr ? (
          <>
            {isMultiCity ? (
              <div className="space-y-1.5">
                {tr.legs.map((leg, i) => {
                  const LegIcon = MODE_ICONS[leg.travel_mode || tr.travel_mode] || Plane;
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
              <Journey from={tr.from_city} to={tr.to_city} icon={MODE_ICONS[tr.travel_mode] || Plane} />
            )}
            <FactGrid
              facts={[
                { label: 'Travel date', value: firstDate ? formatDate(firstDate) : null, hint: daysFromToday(firstDate) },
                { label: 'Return date', value: tr.return_date ? formatDate(tr.return_date) : null },
                { label: 'Mode', value: !isMultiCity && tr.travel_mode ? titleCase(tr.travel_mode) : null },
                { label: 'Trip type', value: tr.trip_type ? titleCase(tr.trip_type) : null },
                { label: 'Purpose', value: tr.purpose },
                { label: 'Project code', value: tr.project_code },
              ]}
            />
          </>
        ) : (
          <FactGrid
            facts={[
              {
                label: 'Claim',
                value: row.claim_id ? (
                  <Link to={`/claims/${row.claim_id}`} className="text-brand hover:underline">
                    {row.claim_ref} ↗
                  </Link>
                ) : (
                  row.claim_ref
                ),
              },
              { label: 'Flagged expense', value: row.expense_category_name },
              { label: 'Amount', value: row.claimed_amount != null ? money(row.claimed_amount) : null },
            ]}
          />
        )}

        {tr ? <TravelPicksSummary request={tr} name={name} /> : null}
        <Quote title={`Reason from ${name}`} text={row.description} empty="No reason given" />
        {tr?.notes ? <Quote title="Trip notes" text={tr.notes} /> : null}
      </DetailColumn>

      <DetailColumn title="Approval route">
        <RouteTimeline items={routeItems(row, { canDecide, decided, now })} />
      </DetailColumn>

      <DetailColumn title="Your decision">{decision}</DetailColumn>
    </ApprovalDetailGrid>
  );
}
