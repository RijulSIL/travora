import { useState } from 'react';

import { ApprovalDetailGrid, DetailColumn, FactGrid, NoticeBox, OutcomeBox, RouteTimeline } from '../approvals/ApprovalDetail';
import { adminApi } from '../../services/adminApi';
import { formatDate, formatDatetime, formatRole } from '../../utils/formatters';

/*
 * An admin override of one stuck item (override_service on the server): what it is and where it's
 * waiting, its route, and the override itself — decide the step in place of its approver, skip it,
 * or approve every remaining step. Same three columns as every approval detail view.
 */

export const KIND_LABEL = { claim: 'Claim', travel: 'Travel request', relocation: 'Relocation' };
const MIN_REASON = 10;

const ACTIONS = {
  approve: ['Approve this step', 'Approves it for the approver; it moves on to the next step as usual.'],
  reject: ['Reject', 'Rejects the whole item. The employee is told the reason.'],
  send_back: ['Send back to the employee', 'Returns the claim so the employee can correct and resubmit it.'],
  skip: ['Skip this step', 'Passes it to the next approver without a decision.'],
  approve_all: ['Approve all remaining steps', 'Approves every step left in one go. Claims stop at Finance, which still records the payment.'],
};
const DONE = {
  approve: 'Approved',
  reject: 'Rejected',
  send_back: 'Sent back to the employee',
  skip: 'Passed on to the next step',
  approve_all: 'Approved through every remaining step',
};

/** A route step as a timeline item. */
function stepItem(step, i, waitingRole) {
  const who = [step.decided_by, step.decided_at ? formatDatetime(step.decided_at) : null].filter(Boolean).join(' · ');
  const key = `${i}-${step.role}`;
  switch (step.status) {
    case 'APPROVED':
      return { key, state: 'done', title: step.label, sub: `Approved${who ? ` · ${who}` : ''}`, detail: step.comment };
    case 'REJECTED':
      return { key, state: 'rejected', title: step.label, sub: `Rejected${who ? ` · ${who}` : ''}`, detail: step.comment };
    case 'SENT_BACK':
      return { key, state: 'done', title: step.label, sub: `Sent back${who ? ` · ${who}` : ''}`, detail: step.comment };
    case 'SLA_SKIPPED':
      return { key, state: 'skipped', title: step.label, sub: 'Passed on after the SLA was missed' };
    case 'OVERRIDE_SKIPPED':
      return { key, state: 'skipped', title: step.label, sub: 'Skipped by an admin override', detail: step.comment };
    case 'SKIPPED_OWN':
      return { key, state: 'skipped', title: step.label, sub: "Skipped — the employee can't approve their own" };
    case 'PENDING':
      return { key, state: 'current', title: step.label, sub: `Waiting on ${formatRole(step.role || waitingRole)}` };
    case 'CANCELLED':
      return { key, state: 'cancelled', title: step.label, sub: 'Cancelled' };
    default:
      return { key, state: 'todo', title: step.label, sub: 'Then' };
  }
}

export function waitingFor(sinceIso) {
  if (!sinceIso) return '—';
  const days = Math.floor((Date.now() - new Date(sinceIso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

export default function OverridePanel({ item, onDone }) {
  const [action, setAction] = useState(item.actions[0]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const tooShort = reason.trim().length < MIN_REASON;

  const submit = async () => {
    if (tooShort || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await adminApi.overrideAct(item.kind, item.item_id, { action, reason: reason.trim() });
      const now = res.data?.waiting;
      setDone({
        ok: action !== 'reject',
        text: now ? `${DONE[action]}. It's now waiting on ${now.step_label}.` : `${DONE[action]}. It's no longer waiting on an approver.`,
      });
      onDone?.(now);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'The override could not be applied.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ApprovalDetailGrid columns="grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
      <DetailColumn first title={`${KIND_LABEL[item.kind]} ${item.reference}`} label="What's waiting">
        <p className="m-0 text-[13px] font-semibold text-ink">{item.summary}</p>
        <FactGrid
          cols={2}
          facts={[
            { label: 'Employee', value: item.employee_name || '—' },
            { label: 'Waiting on', value: item.step_label, hint: item.step_role ? formatRole(item.step_role) : null },
            { label: 'Waiting for', value: waitingFor(item.waiting_since), hint: item.waiting_since ? `since ${formatDate(item.waiting_since)}` : null },
            {
              label: 'SLA',
              value: item.sla_deadline_at ? (item.overdue ? 'Past its SLA' : 'Within its SLA') : '—',
              hint: item.sla_deadline_at ? `due ${formatDatetime(item.sla_deadline_at)}` : null,
            },
          ]}
        />
        {item.route === 'exception' ? (
          <NoticeBox tone="amber">On its exception route: the exception approvers decide it instead of the normal approval steps.</NoticeBox>
        ) : null}
      </DetailColumn>

      <DetailColumn title="Approval route">
        <RouteTimeline items={(item.steps || []).map((s, i) => stepItem(s, i, item.step_role))} />
      </DetailColumn>

      <DetailColumn title="Override">
        {done ? (
          <OutcomeBox ok={done.ok}>{done.text}</OutcomeBox>
        ) : (
          <>
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1 text-[11.5px] font-bold text-ink">What to do</legend>
              {item.actions.map((key) => (
                <label
                  key={key}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2 ${
                    action === key ? (key === 'reject' ? 'border-rose-300 bg-rose-50/60' : 'border-brand/40 bg-brand/5') : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name={`override-${item.kind}-${item.item_id}`}
                    className="mt-0.5"
                    checked={action === key}
                    onChange={() => setAction(key)}
                  />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-bold text-ink">{ACTIONS[key][0]}</span>
                    <span className="block text-[11.5px] leading-snug text-slate-500">{ACTIONS[key][1]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div>
              <label htmlFor={`override-reason-${item.kind}-${item.item_id}`} className="mb-1.5 block text-[11.5px] font-bold text-ink">
                Reason <span className="font-medium text-slate-500">(required; recorded in the audit log and sent with the notifications)</span>
              </label>
              <textarea
                id={`override-reason-${item.kind}-${item.item_id}`}
                className="min-h-[76px] w-full resize-y rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-brand focus:ring-[3px] focus:ring-brand/10"
                maxLength={2000}
                placeholder="e.g. The HRBP has left the company and the role isn't filled yet"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {reason && tooShort ? (
                <p className="mt-1 text-[11.5px] font-semibold text-slate-500">At least {MIN_REASON} characters.</p>
              ) : null}
            </div>
            {error ? <OutcomeBox ok={false}>{error}</OutcomeBox> : null}
            <button
              type="button"
              disabled={busy || tooShort}
              onClick={submit}
              className={`inline-flex h-[38px] w-fit items-center rounded-[9px] border px-4 text-[12.5px] font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                action === 'reject' ? 'border-rose-700 bg-rose-700 hover:bg-rose-800' : 'border-ink bg-ink hover:bg-ink/90'
              }`}
            >
              {busy ? 'Applying…' : `Override: ${ACTIONS[action][0].toLowerCase()}`}
            </button>
            <p className="m-0 text-[11.5px] leading-relaxed text-slate-500">
              Whoever the step was waiting on is told you acted for them. Finance&apos;s payment step can&apos;t be overridden.
            </p>
          </>
        )}
      </DetailColumn>
    </ApprovalDetailGrid>
  );
}
