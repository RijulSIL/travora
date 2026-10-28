import { useState } from 'react';
import { FileText, Truck } from 'lucide-react';

import { reimbursementApi } from '../../services/reimbursementApi';
import { showToast } from '../../store/toastStore';

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
import { formatInr } from './ClaimRelocationSteps';

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
      title: `${row.source === 'PRIOR_APPROVAL' ? 'Approval uploaded' : 'Requested'} by ${row.employee_name || 'the employee'}`,
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
  // An approval given outside the app, uploaded by the employee: the approver checks the document.
  const prior = row.source === 'PRIOR_APPROVAL';
  const [opening, setOpening] = useState(false);
  const openEvidence = async () => {
    setOpening(true);
    try {
      const response = await reimbursementApi.relocationEvidenceBlob(row.id);
      window.open(URL.createObjectURL(response.data), '_blank', 'noopener');
    } catch {
      showToast('Could not open the uploaded approval', 'error');
    } finally {
      setOpening(false);
    }
  };

  return (
    <ApprovalDetailGrid>
      <DetailColumn first title={prior ? 'The uploaded approval' : 'The move'} label="Relocation details">
        <Journey from={row.origin_city} to={row.destination_city} icon={Truck} />
        {prior ? (
          <>
            <FactGrid
              facts={[
                { label: 'Approved amount', value: row.estimated_amount ? `₹${formatInr(row.estimated_amount)}` : 'Not given' },
                { label: 'Uploaded', value: row.created_at ? formatDate(row.created_at) : '—' },
              ]}
            />
            {row.has_evidence ? (
              <button
                type="button"
                onClick={openEvidence}
                disabled={opening}
                className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-bold text-ink hover:bg-slate-50"
              >
                <FileText size={14} /> {opening ? 'Opening…' : `View ${row.evidence_filename || 'approval'}`}
              </button>
            ) : null}
            <p className="text-[11.5px] text-slate-500">Check the document matches the move and amount before approving.</p>
          </>
        ) : (
          <>
            <FactGrid
              facts={[
                { label: 'Estimate', value: row.estimated_amount ? `₹${formatInr(row.estimated_amount)}` : '—' },
                {
                  label: 'Planned move',
                  value: details.planned_move_date ? formatDate(details.planned_move_date) : '—',
                  hint: daysFromToday(details.planned_move_date),
                },
                { label: 'Family members', value: details.family_members != null ? String(details.family_members) : '—' },
              ]}
            />
            <Quote title={`Notes from ${name}`} text={details.notes} />
          </>
        )}
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
