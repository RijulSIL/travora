import { Truck } from 'lucide-react';

import {
  ApprovalDetailGrid,
  daysFromToday,
  DecisionBox,
  DetailColumn,
  FactGrid,
  firstName,
  Journey,
  Quote,
  RouteTimeline,
  waitingOnYou,
} from '../approvals/ApprovalDetail';
import { formatDate, formatDatetime, formatRole } from '../../utils/formatters';
import { formatInr, relocationTravelType } from './ClaimRelocationSteps';

/** The relocation request's route: requested, then each stage — done, waiting (with the SLA),
 * passed over after a missed SLA, rejected, or still to come. */
function routeItems(row, slaLeft, decided) {
  const stages = row.stages || [];
  const lastNumber = stages.length ? stages[stages.length - 1].stage_number : null;
  const rejected = stages.some((s) => s.status === 'REJECTED');
  let upcoming = 0;
  return [
    {
      key: 'requested',
      state: 'done',
      title: `Requested by ${row.employee_name || 'the employee'}`,
      sub: row.created_at ? formatDatetime(row.created_at) : null,
    },
    ...stages.map((stage) => {
      if (stage.status === 'APPROVED') {
        return {
          key: stage.stage_number,
          state: 'done',
          title: stage.label,
          sub: [`Approved${stage.decided_by_name ? ` by ${stage.decided_by_name}` : ''}`, stage.decided_at ? formatDatetime(stage.decided_at) : null]
            .filter(Boolean)
            .join(' · '),
          detail: stage.comment,
        };
      }
      if (stage.status === 'REJECTED') {
        return {
          key: stage.stage_number,
          state: 'rejected',
          title: stage.label,
          sub: `Rejected${stage.decided_by_name ? ` by ${stage.decided_by_name}` : ''}`,
          detail: stage.comment,
        };
      }
      if (stage.status === 'SLA_SKIPPED') {
        return { key: stage.stage_number, state: 'skipped', title: stage.label, sub: 'Passed on after the SLA was missed' };
      }
      if (stage.status === 'PENDING') {
        // Until this approver decides, the pending stage is theirs; afterwards it's the next one.
        return {
          key: stage.stage_number,
          state: 'current',
          title: stage.label,
          sub: decided ? `Waiting on ${formatRole(stage.required_role)}` : waitingOnYou(slaLeft),
        };
      }
      upcoming += 1;
      return {
        key: stage.stage_number,
        state: 'todo',
        title: stage.label,
        sub: rejected
          ? 'Not reached'
          : stage.stage_number === lastNumber
            ? `Last stage. ${firstName(row.employee_name)} is notified once it approves`
            : upcoming === 1
              ? 'Next'
              : 'Then',
      };
    }),
  ];
}

/**
 * Pending Approvals → Relocation: the opened row. Three columns — the move, the approval route,
 * and this approver's decision (comment next to Approve; Reject asks for its reason inline).
 */
export default function RelocationApprovalPanel({
  row,
  slaLeft,
  comment,
  onCommentChange,
  rejecting,
  onRejectingChange,
  busy,
  decided,
  onApprove,
  onReject,
}) {
  const details = row.details || {};
  const name = firstName(row.employee_name);
  const current = (row.stages || []).find((s) => s.stage_number === row.current_approval_stage);
  const next = (row.stages || []).find((s) => current && s.stage_number > current.stage_number);

  return (
    <ApprovalDetailGrid>
      <DetailColumn first title="The move" label="Relocation details">
        <Journey from={row.origin_city} to={row.destination_city} icon={Truck} />
        <FactGrid
          facts={[
            { label: 'Amount to be approved', value: row.estimated_amount ? `₹${formatInr(row.estimated_amount)}` : '—' },
            {
              label: 'Travel date',
              value: details.travel_date ? formatDate(details.travel_date) : '—',
              hint: daysFromToday(details.travel_date),
            },
            { label: 'Travel type', value: relocationTravelType(details) },
            { label: 'Family members', value: details.family_members != null ? String(details.family_members) : '—' },
          ]}
        />
        <Quote title={`Notes from ${name}`} text={details.notes} />
      </DetailColumn>

      <DetailColumn title="Approval route">
        <RouteTimeline items={routeItems(row, slaLeft, decided)} />
      </DetailColumn>

      <DetailColumn title="Your decision">
        <DecisionBox
          idPrefix={`relocation-${row.id}`}
          name={row.employee_name}
          comment={comment}
          onCommentChange={onCommentChange}
          rejectMode={rejecting}
          onRejectModeChange={onRejectingChange}
          busy={busy}
          decided={decided}
          onApprove={onApprove}
          onReject={onReject}
          reasonPlaceholder={'e.g. Relocation isn’t part of this offer'}
          hint={
            <>
              {next ? (
                <>
                  Approving passes it to <b className="text-ink">{formatRole(next.required_role)}</b>.
                </>
              ) : (
                <>Yours is the last stage: approving tells {name} they can raise the claim.</>
              )}{' '}
              Rejecting ends the request and tells {name} why.
            </>
          }
        />
      </DetailColumn>
    </ApprovalDetailGrid>
  );
}
