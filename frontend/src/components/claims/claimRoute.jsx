import { slaRemaining, waitingOnYou } from '../approvals/ApprovalDetail';
import { formatDatetime, formatRole } from '../../utils/formatters';

function stepSub(verb, name, at) {
  return [`${verb}${name ? ` by ${name}` : ''}`, at ? formatDatetime(at) : null].filter(Boolean).join(' · ');
}

/** The claim's approval route: submitted, any exception reviews (which replace the normal stages
 * for a claim with exceptions), the configured stages, then payment. */
export function claimRouteItems(claim, chain, { viewerName, decided, now }) {
  const items = [
    {
      key: 'submitted',
      state: 'done',
      title: `Submitted by ${claim.employee_name || 'the employee'}`,
      sub: claim.submitted_at ? formatDatetime(claim.submitted_at) : null,
    },
  ];
  const ended = ['REJECTED', 'SENT_BACK'].includes(claim.status);
  const exceptionLabels = new Map(
    (chain?.exceptions || []).map((e) => [e.exception_request_id, e.category_name || e.exception_type_label]),
  );
  for (const s of chain?.exception_stages || []) {
    const key = `exc-${s.exception_request_id}-${s.required_role}`;
    const title = `${exceptionLabels.get(s.exception_request_id) || s.exception_type_label} · ${formatRole(s.required_role)}`;
    if (s.status === 'APPROVED') items.push({ key, state: 'done', title, sub: stepSub('Approved', s.acted_by_name, s.acted_at), detail: s.comment });
    else if (s.status === 'REJECTED') items.push({ key, state: 'rejected', title, sub: stepSub('Rejected', s.acted_by_name, s.acted_at), detail: s.comment });
    else if (s.status === 'SLA_SKIPPED') items.push({ key, state: 'skipped', title, sub: 'Passed on after the SLA was missed' });
    else if (s.status === 'PENDING' && !ended) {
      items.push({ key, state: 'current', title,
        sub: s.pending_approver_names?.length ? `Waiting on ${s.pending_approver_names.join(', ')}` : 'Waiting on a decision' });
    } else if (s.status !== 'CANCELLED') items.push({ key, state: ended ? 'cancelled' : 'todo', title, sub: ended ? 'Not reached' : 'Then' });
  }

  const stages = chain?.stages?.length ? chain.stages : (chain?.upcoming_stages || []).map((s) => ({ ...s, status: 'NOT_STARTED' }));
  let upcoming = 0;
  for (const s of stages) {
    const key = `stage-${s.stage_number}`;
    if (s.status === 'APPROVED') items.push({ key, state: 'done', title: s.label, sub: stepSub('Approved', s.decided_by_name, s.decided_at), detail: s.comment });
    else if (s.status === 'REJECTED') items.push({ key, state: 'rejected', title: s.label, sub: stepSub('Rejected', s.decided_by_name, s.decided_at), detail: s.comment || claim.reject_reason });
    else if (s.status === 'SLA_SKIPPED') items.push({ key, state: 'skipped', title: s.label, sub: 'Passed on after the SLA was missed' });
    else if (s.status === 'PENDING' && !ended) {
      const names = s.pending_approver_names || [];
      const mine = !decided && viewerName && names.includes(viewerName);
      items.push({ key, state: 'current', title: s.label,
        sub: mine ? waitingOnYou(slaRemaining(s.sla_deadline_at, now)) : `Waiting on ${names.length ? names.join(', ') : 'the next approver'}` });
    } else {
      upcoming += 1;
      items.push({ key, state: ended ? 'cancelled' : 'todo', title: s.label, sub: ended ? 'Not reached' : upcoming === 1 ? 'Next' : 'Then' });
    }
  }

  if (claim.status === 'PAID') {
    items.push({ key: 'paid', state: 'done', title: 'Paid', sub: [claim.payment_utr ? `UTR ${claim.payment_utr}` : null, claim.payment_recorded_at ? formatDatetime(claim.payment_recorded_at) : null].filter(Boolean).join(' · ') || null });
  } else if (claim.status === 'SENT_BACK') {
    items.push({ key: 'sent-back', state: 'current', title: 'Sent back to the employee', sub: 'Waiting for them to fix and resubmit' });
  }
  return items;
}
