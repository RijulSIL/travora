import { AlertTriangle, Bus, Check, Plane, TrainFront, Undo2, X } from 'lucide-react';
import { useState } from 'react';
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

const itemName = (item) => item.category_name || formatExceptionType(item.exception_type);

const DECISION_WORDS = { ACCEPTED: 'Accepted', REJECTED: 'Rejected', SENT_BACK: 'Sent back' };

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
    const by = d.acted_by_name ? ` by ${d.acted_by_name}` : '';
    if (d.status === 'APPROVED') {
      items.push({
        key,
        state: 'done',
        title,
        sub: [`${row.itemized ? 'Accepted' : 'Approved'}${by}`, d.acted_at ? formatDatetime(d.acted_at) : null].filter(Boolean).join(' · '),
        detail: d.comment,
      });
    } else if (d.status === 'REJECTED') {
      items.push({ key, state: 'rejected', title, sub: `Rejected${by}`, detail: d.comment });
    } else if (d.status === 'SENT_BACK') {
      // Exceptions sent back to the employee: the claim comes back to this same step on resubmission.
      items.push({
        key,
        state: 'current',
        title,
        sub: `Sent back to ${firstName(row.employee)}${by} — comes back here once they resubmit`,
        detail: d.comment,
      });
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
      sub: ended
        ? 'Not reached'
        : row.itemized
          ? 'Once the last approver accepts every exception'
          : 'Once every exception on the claim is approved',
    });
  }
  return items;
}

/** Claimed vs cap for one exception. */
function AmountLine({ item }) {
  const over = item.cap_amount != null ? Number(item.claimed_amount || 0) - Number(item.cap_amount) : null;
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px] text-slate-500">
      <span>
        Claimed <b className="font-mono font-semibold tabular-nums text-ink">{money(item.claimed_amount)}</b>
      </span>
      {item.cap_amount != null ? (
        <span>
          Cap <b className="font-mono font-semibold tabular-nums text-ink">{money(item.cap_amount)}</b>
        </span>
      ) : null}
      {over > 0 ? <b className="font-mono font-semibold tabular-nums text-rose-700">{money(over)} over</b> : null}
    </div>
  );
}

/** Each step's decision on one exception, as small chips. */
function ItemHistory({ item }) {
  const shown = (item.decisions || []).filter((d) => DECISION_WORDS[d.decision]);
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((d, i) => (
        <span
          key={`${d.exception_approval_id}-${i}`}
          title={d.comment || undefined}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
            d.decision === 'ACCEPTED' ? 'bg-emerald-50 text-emerald-700' : d.decision === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-orange-50 text-orange-700'
          }`}
        >
          {DECISION_WORDS[d.decision]} · {d.decided_by_name || formatRole(d.required_role)}
        </span>
      ))}
    </div>
  );
}

/** One exception on a claim's request: what it is, claimed vs cap, the employee's reason. */
function ExceptionItemCard({ item, name, children }) {
  return (
    <div className="space-y-1.5 rounded-[10px] border border-amber-200/80 bg-amber-50/50 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold text-amber-900">
          <AlertTriangle size={13} className="shrink-0" /> {itemName(item)}
        </span>
        <span className="text-[11px] font-semibold text-amber-800/80">{formatExceptionType(item.exception_type)}</span>
      </div>
      <AmountLine item={item} />
      {item.reason ? (
        <p className="m-0 whitespace-pre-wrap break-words border-l-[3px] border-brand/30 py-0.5 pl-2.5 text-[12.5px] leading-relaxed text-slate-700">
          <span className="font-semibold text-slate-500">{name}: </span>
          {item.reason}
        </p>
      ) : null}
      <ItemHistory item={item} />
      {children}
    </div>
  );
}

const CHOICES = [
  ['ACCEPT', 'Accept', Check, 'border-emerald-600 bg-emerald-600 text-white'],
  ['REJECT', 'Reject', X, 'border-rose-700 bg-rose-700 text-white'],
  ['SEND_BACK', 'Send back', Undo2, 'border-orange-600 bg-orange-600 text-white'],
];

/**
 * The decision column for a claim's exceptions: Accept / Reject / Send back on each one the step
 * still has to decide (a reason or comment when not accepting), then one Submit for all of them.
 */
function ItemDecisionBox({ row, waiting, alreadyAccepted, busy, onSubmit, nextStep }) {
  const [choices, setChoices] = useState({});
  const [tried, setTried] = useState(false);
  const who = firstName(row.employee);
  const set = (id, patch) => setChoices((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const needsText = (c) => c?.decision && c.decision !== 'ACCEPT' && !(c.comment || '').trim();
  const decidedCount = waiting.filter((i) => choices[i.item_id]?.decision).length;
  const ready = decidedCount === waiting.length && !waiting.some((i) => needsText(choices[i.item_id]));
  const values = waiting.map((i) => choices[i.item_id]?.decision);
  const outcome = values.includes('REJECT')
    ? `Submitting rejects ${who}'s whole claim.`
    : values.includes('SEND_BACK')
      ? `Submitting sends the claim back to ${who}; it returns to you once they resubmit.`
      : ready
        ? nextStep
          ? `Submitting passes it to ${formatRole(nextStep.required_role)}.`
          : 'Yours is the last step: the claim then goes to Finance.'
        : null;

  const submit = () => {
    if (!ready) {
      setTried(true);
      return;
    }
    onSubmit(
      waiting.map((i) => ({
        item_id: i.item_id,
        decision: choices[i.item_id].decision,
        comment: (choices[i.item_id].comment || '').trim() || null,
      })),
    );
  };

  return (
    <>
      {alreadyAccepted.length ? (
        <NoticeBox tone="emerald">
          You accepted {alreadyAccepted.map(itemName).join(', ')} before {who} resubmitted; only what you sent back needs a decision again.
        </NoticeBox>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {waiting.map((item) => {
          const choice = choices[item.item_id] || {};
          const fieldId = `exception-${row.exception_id}-item-${item.item_id}`;
          return (
            <li key={item.item_id} className="space-y-2 rounded-[10px] border border-slate-200 bg-white px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <b className="text-[13px] text-ink">{itemName(item)}</b>
                <span className="font-mono text-[12px] font-semibold tabular-nums text-slate-600">{money(item.claimed_amount)}</span>
              </div>
              <div role="group" aria-label={`Decision for ${itemName(item)}`} className="flex flex-wrap gap-1.5">
                {CHOICES.map(([value, label, Icon, on]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={choice.decision === value}
                    disabled={busy}
                    onClick={() => set(item.item_id, { decision: value })}
                    className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      choice.decision === value ? on : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={12} /> {label}
                  </button>
                ))}
              </div>
              {choice.decision && choice.decision !== 'ACCEPT' ? (
                <div>
                  <label htmlFor={fieldId} className="mb-1 block text-[11.5px] font-bold text-ink">
                    {choice.decision === 'REJECT' ? 'Reason for rejecting ' : 'What needs to change '}
                    <span className="font-medium text-slate-500">(required, sent to {who})</span>
                  </label>
                  <textarea
                    id={fieldId}
                    className={`min-h-[64px] w-full resize-y rounded-[10px] border bg-white px-3 py-2 text-[13px] text-ink outline-none ${
                      choice.decision === 'REJECT' ? 'border-rose-200 focus:border-rose-600' : 'border-orange-200 focus:border-orange-600'
                    }`}
                    maxLength={2000}
                    placeholder={choice.decision === 'REJECT' ? 'e.g. A cheaper option was available' : 'e.g. Attach the itemised bill'}
                    value={choice.comment || ''}
                    onChange={(e) => set(item.item_id, { comment: e.target.value })}
                  />
                  {tried && needsText(choice) ? (
                    <p className="mt-1 text-[11.5px] font-semibold text-rose-700">Add a note so {who} knows why.</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={submit}
          className="inline-flex h-[38px] items-center gap-1.5 rounded-[9px] border border-brand bg-brand px-4 text-[12.5px] font-bold text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={14} /> {busy ? 'Submitting…' : 'Submit decisions'}
        </button>
        <span className="text-[11.5px] font-semibold text-slate-500">
          {decidedCount} of {waiting.length} decided
        </span>
      </div>
      <p className="m-0 text-[11.5px] leading-relaxed text-slate-500">
        {outcome || 'Decide every exception to submit. Reject or Send back needs a note.'}
      </p>
    </>
  );
}

/**
 * Exception Requests: the opened row. What's flagged (and why the employee says it's needed),
 * the exception's approval route, and this approver's decision — the same layout as the
 * Pending Approvals panels. A claim's request lists each of its exceptions, decided one by one.
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
  onSubmitItems,
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
  const items = row.itemized ? row.items || [] : [];
  const waitingItems = items.filter((i) => i.awaiting_current_step);
  const acceptedHere = items.filter((i) => i.status === 'PENDING' && !i.awaiting_current_step);

  let decision;
  if (decided) {
    decision = <OutcomeBox ok={decided.ok}>{decided.text}</OutcomeBox>;
  } else if (row.status === 'PENDING' && canDecide && row.itemized) {
    decision = (
      <ItemDecisionBox
        key={`${row.exception_id}-${currentIndex}`}
        row={row}
        waiting={waitingItems}
        alreadyAccepted={acceptedHere}
        busy={busy}
        onSubmit={onSubmitItems}
        nextStep={nextStep}
      />
    );
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
      <NoticeBox tone="emerald" title="You've decided your step">
        It&apos;s now waiting on {waitingOn}.
      </NoticeBox>
    ) : (
      <NoticeBox title={`Waiting on ${waitingOn}`}>This step isn&apos;t yours to decide.</NoticeBox>
    );
  } else if (row.status === 'SENT_BACK') {
    decision = (
      <NoticeBox tone="orange" title={`Sent back to ${name}`}>
        {row.items?.some((i) => i.status === 'SENT_BACK')
          ? `Waiting for ${name} to change ${row.items.filter((i) => i.status === 'SENT_BACK').map(itemName).join(', ')} and resubmit. It then comes back to the step that sent it back.`
          : `Waiting for ${name} to resubmit.`}
      </NoticeBox>
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
    <ApprovalDetailGrid columns="grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
      <DetailColumn first title="What's flagged" label="Exception details">
        {row.itemized ? (
          <>
            <FactGrid
              facts={[
                {
                  label: 'Claim',
                  value: (
                    <Link to={`/claims/${row.claim_id}`} className="text-brand hover:underline">
                      {row.claim_ref} ↗
                    </Link>
                  ),
                },
                { label: 'Exceptions', value: items.length },
                { label: 'Total', value: row.claimed_amount != null ? money(row.claimed_amount) : null },
              ]}
            />
            <div className="space-y-2">
              {items.map((item) => (
                <ExceptionItemCard key={item.item_id} item={item} name={name} />
              ))}
            </div>
          </>
        ) : (
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
        )}

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
        ) : row.itemized ? null : (
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
        {row.itemized ? null : <Quote title={`Reason from ${name}`} text={row.description} empty="No reason given" />}
        {tr?.notes ? <Quote title="Trip notes" text={tr.notes} /> : null}
      </DetailColumn>

      <DetailColumn title="Approval route" className="max-lg:border-l-0 max-lg:border-t">
        <RouteTimeline items={routeItems(row, { canDecide, decided, now })} />
      </DetailColumn>

      <DetailColumn title="Your decision" className="max-lg:border-l-0 max-lg:border-t">
        {decision}
      </DetailColumn>
    </ApprovalDetailGrid>
  );
}
