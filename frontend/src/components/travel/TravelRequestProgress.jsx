import { CheckCircle2, Circle, Clock, XCircle } from 'lucide-react';

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

function buildApprovalSteps(request) {
  const steps = [];

  steps.push({
    key: 'submitted',
    label: 'Submitted',
    state: 'done',
    stateLabel: formatDateTime(request.requested_at) || 'Done',
  });

  const exc = request.exception;
  if (exc) {
    exc.approvals.forEach((a) => {
      let state = 'pending';
      let stateLabel = 'Queued';
      if (a.status === 'APPROVED') {
        state = 'done';
        stateLabel = formatDateTime(a.acted_at) ? `Approved ${formatDateTime(a.acted_at)}` : 'Approved';
      } else if (a.status === 'REJECTED') {
        state = 'rejected';
        stateLabel = 'Rejected';
      } else if (a.status === 'PENDING') {
        state = 'current';
        stateLabel = 'Awaiting decision';
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

  let managerState = 'pending';
  let managerLabel = 'Not yet reached';
  if (status === 'PENDING') {
    managerState = 'current';
    managerLabel = 'Awaiting decision';
  } else if (status === 'APPROVED' || status === 'PARTIALLY_BOOKED' || status === 'BOOKED') {
    managerState = 'done';
    managerLabel = 'Approved';
  } else if (status === 'REJECTED') {
    managerState = rejectedDuringException ? 'pending' : 'rejected';
    managerLabel = rejectedDuringException ? 'Not required' : 'Rejected';
  } else if (status === 'CANCELLED') {
    managerState = 'cancelled';
    managerLabel = 'Cancelled';
  } else if (status === 'PENDING_EXCEPTION') {
    managerState = 'pending';
    managerLabel = 'Waiting on exception review';
  }

  steps.push({
    key: 'manager',
    label: 'Reporting manager approval',
    state: managerState,
    stateLabel: managerLabel,
    detail: status === 'REJECTED' && !rejectedDuringException ? request.rejection_reason : null,
  });

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
  const steps = buildApprovalSteps(request);

  return (
    <div className="flex flex-col gap-3 px-2 py-1">
      {request.exception ? (
        <div className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
          Policy exception: {humanize(request.exception.exception_type)}
        </div>
      ) : null}
      {steps.map((step, idx) => {
        const { Icon, iconCls } = STATE_STYLES[step.state] || STATE_STYLES.pending;
        const isLast = idx === steps.length - 1;
        return (
          <div key={step.key} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${iconCls}`}>
                <Icon size={13} />
              </span>
              {!isLast ? <span className="mt-1 h-full min-h-[14px] w-px flex-1 bg-slate-200" /> : null}
            </div>
            <div className="min-w-0 pb-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
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
