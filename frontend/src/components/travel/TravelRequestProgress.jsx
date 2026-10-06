import { CheckCircle2, Circle, Clock, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { reimbursementApi } from '../../services/reimbursementApi';

const ROLE_LABELS = {
  REPORTING_MANAGER: 'Reporting Manager',
  HRBP_HR: 'HR Business Partner',
  GROUP_HEAD_HR: 'Group Head HR',
  CEO: 'CEO',
};

function humanize(token) {
  return String(token || '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

function humanizeRole(role) {
  return ROLE_LABELS[role] || humanize(role);
}

function formatDateTime(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

const STATE_STYLES = {
  done: { Icon: CheckCircle2, iconCls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  current: { Icon: Clock, iconCls: 'text-amber-600 bg-amber-50 border-amber-200' },
  rejected: { Icon: XCircle, iconCls: 'text-rose-600 bg-rose-50 border-rose-200' },
  cancelled: { Icon: XCircle, iconCls: 'text-slate-400 bg-slate-100 border-slate-200' },
  pending: { Icon: Circle, iconCls: 'text-slate-300 bg-slate-50 border-slate-200' },
};

function buildApprovalSteps(request, chain) {
  const steps = [];

  steps.push({
    key: 'submitted',
    label: 'Submitted',
    state: 'done',
    stateLabel: formatDateTime(request.requested_at) || 'Done',
  });

  const exc = request.exception;
  if (exc) {
    // request.exception (TravelExceptionSummaryOut) has no approver names — only
    // chain.exception_stages does (acted_by_name / pending_approver_names). Match the two up
    // by required_role, scoped to this exception_request_id since chain.exception_stages
    // covers every exception ever raised on this travel request, not just the current one.
    const excStageByRole = new Map(
      (chain?.exception_stages || [])
        .filter((s) => s.exception_request_id === exc.id)
        .map((s) => [s.required_role, s]),
    );
    exc.approvals.forEach((a) => {
      const named = excStageByRole.get(a.required_role);
      let state = 'pending';
      let stateLabel = 'Queued';
      if (a.status === 'APPROVED') {
        state = 'done';
        const who = named?.acted_by_name ? `by ${named.acted_by_name}` : '';
        const when = formatDateTime(a.acted_at);
        stateLabel = who || when ? `Approved ${[who, when].filter(Boolean).join(' · ')}` : 'Approved';
      } else if (a.status === 'REJECTED') {
        state = 'rejected';
        stateLabel = named?.acted_by_name ? `Rejected by ${named.acted_by_name}` : 'Rejected';
      } else if (a.status === 'PENDING') {
        state = 'current';
        stateLabel = named?.pending_approver_names?.length
          ? `Awaiting ${named.pending_approver_names.join(', ')}`
          : 'Awaiting decision';
      }
      steps.push({
        key: `exc-${a.required_role}`,
        label: `Exception review — ${humanizeRole(a.required_role)}`,
        state,
        stateLabel,
        detail: a.comment || null,
      });
    });
  }

  const status = request.status;
  const rejectedDuringException = status === 'REJECTED' && exc && exc.status === 'REJECTED';
  const realStages = chain?.stages || [];

  if (status === 'CANCELLED') {
    steps.push({ key: 'manager', label: 'Approval', state: 'cancelled', stateLabel: 'Cancelled' });
  } else if (rejectedDuringException) {
    steps.push({ key: 'manager', label: 'Approval', state: 'pending', stateLabel: 'Not required' });
  } else if (realStages.length) {
    // Real, admin-configured stage(s) — could be more than one (Manager -> HRBP -> ...), unlike
    // the single hardcoded "Reporting manager approval" step this used to always show.
    realStages.forEach((s) => {
      let state = 'pending';
      let stateLabel = s.pending_approver_names?.length
        ? `Will route to ${s.pending_approver_names.join(', ')}`
        : 'Not yet reached';
      if (s.status === 'APPROVED') {
        state = 'done';
        const who = s.decided_by_name ? `by ${s.decided_by_name}` : '';
        const when = formatDateTime(s.decided_at);
        stateLabel = who || when ? `Approved ${[who, when].filter(Boolean).join(' · ')}` : 'Approved';
      } else if (s.status === 'REJECTED') {
        state = 'rejected';
        stateLabel = s.decided_by_name ? `Rejected by ${s.decided_by_name}` : 'Rejected';
      } else if (s.status === 'PENDING') {
        state = 'current';
        stateLabel = s.pending_approver_names?.length
          ? `Awaiting ${s.pending_approver_names.join(', ')}`
          : 'Awaiting decision';
      }
      steps.push({
        key: `stage-${s.stage_number}`,
        label: s.label,
        state,
        stateLabel,
        detail: s.comment || null,
      });
    });
  } else if (status === 'PENDING_EXCEPTION' && chain?.upcoming_stages?.length) {
    // No real stage rows yet (see init_travel_request_approval_chain) — preview what's coming
    // once every exception clears.
    chain.upcoming_stages.forEach((s) => {
      steps.push({
        key: `upcoming-${s.stage_number}`,
        label: s.label,
        state: 'pending',
        stateLabel: s.pending_approver_names?.length
          ? `Will route to ${s.pending_approver_names.join(', ')}`
          : 'Waiting on exception review',
      });
    });
  } else {
    // Chain hasn't loaded yet (or failed to) — fall back to a single generic step rather than
    // showing nothing.
    let managerState = 'pending';
    let managerLabel = 'Not yet reached';
    if (status === 'PENDING') {
      managerState = 'current';
      managerLabel = 'Awaiting decision';
    } else if (status === 'APPROVED' || status === 'PARTIALLY_BOOKED' || status === 'BOOKED') {
      managerState = 'done';
      managerLabel = 'Approved';
    } else if (status === 'REJECTED') {
      managerState = 'rejected';
      managerLabel = 'Rejected';
    } else if (status === 'PENDING_EXCEPTION') {
      managerLabel = 'Waiting on exception review';
    }
    steps.push({
      key: 'manager',
      label: 'Approval',
      state: managerState,
      stateLabel: managerLabel,
      detail: status === 'REJECTED' ? request.rejection_reason : null,
    });
  }

  let deskState = 'pending';
  let deskLabel = 'Not yet reached';
  if (status === 'BOOKED') {
    deskState = 'done';
    deskLabel = 'Ticket issued';
  } else if (status === 'PARTIALLY_BOOKED') {
    deskState = 'current';
    deskLabel = 'Booking in progress';
  } else if (status === 'APPROVED') {
    deskState = 'current';
    deskLabel = 'Awaiting booking';
  } else if (status === 'CANCELLED') {
    deskState = 'cancelled';
    deskLabel = 'Cancelled';
  }
  steps.push({
    key: 'desk',
    label: 'Travel desk booking',
    state: deskState,
    stateLabel: deskLabel,
  });

  return steps;
}

export default function TravelRequestProgress({ request }) {
  const [chain, setChain] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setChain(null);
    if (!request?.id) return undefined;
    reimbursementApi
      .travelRequestApprovalChain(request.id)
      .then((res) => {
        if (!cancelled) setChain(res.data);
      })
      .catch(() => {
        // Falls back to the single generic step inside buildApprovalSteps — not fatal.
      });
    return () => {
      cancelled = true;
    };
  }, [request?.id]);

  const steps = buildApprovalSteps(request, chain);

  return (
    <div className="flex flex-col gap-3 px-2 py-1">
      {request.exception ? (
        <div className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
          {request.exception.exception_types?.length > 1 ? 'Policy exceptions: ' : 'Policy exception: '}
          {(request.exception.exception_types?.length
            ? request.exception.exception_types
            : [request.exception.exception_type]
          ).map(humanize).join(', ')}
        </div>
      ) : null}
      {steps.map((step, idx) => {
        const { Icon, iconCls } = STATE_STYLES[step.state] || STATE_STYLES.pending;
        const isLast = idx === steps.length - 1;
        return (
          <div key={step.key} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              {/* size=14, not 13: the badge is h-6/w-6 (24px), and (24-13)/2 = 5.5px can't be
                  split evenly, so browsers round it asymmetrically — a real, measurable ~1px
                  off-center icon. 14 divides evenly (5px each side). */}
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${iconCls}`}>
                <Icon size={14} />
              </span>
              {!isLast ? <span className="mt-1 h-full min-h-[14px] w-px flex-1 bg-slate-200" /> : null}
            </div>
            <div className="min-w-0 pb-3">
              {/* leading-6 matches the icon circle's own h-6 (24px) exactly, so the first line
                  of text and the icon share the same line-box height and end up centered on
                  the same axis under the row's items-start — no guessed offset needed. */}
              <div className="flex flex-wrap items-baseline gap-x-2 leading-6">
                <span className="text-[11px] font-bold text-slate-700">{step.label}</span>
                <span className="text-[10px] font-medium text-slate-400">{step.stateLabel}</span>
              </div>
              {step.detail ? (
                <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500 italic">&ldquo;{step.detail}&rdquo;</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
