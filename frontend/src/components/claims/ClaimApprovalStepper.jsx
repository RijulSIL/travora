export default function ClaimApprovalStepper({
  stages = [],
  currentStageNumber,
  claimStatus,
  emptyHint = null,
}) {
  if (!stages.length) {
    if (emptyHint) {
      return <p className="text-xs text-slate-500">{emptyHint}</p>;
    }
    return null;
  }

  return (
    <div className="flex flex-wrap items-start gap-0 border-t border-slate-100 pt-4">
      {stages.map((s, idx) => {
        const done = s.status === 'APPROVED';
        const active =
          s.status === 'PENDING' &&
          s.stage_number === currentStageNumber &&
          (claimStatus === 'IN_APPROVAL' || claimStatus === 'READY_FOR_PAYMENT');
        const circleClass = done
          ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
          : active
            ? 'border-blue-400 bg-blue-50 text-blue-800'
            : 'border-slate-200 bg-slate-100 text-slate-400';
        const label = s.label || `Stage ${s.stage_number}`;
        const connDone = idx > 0 && stages[idx - 1].status === 'APPROVED';
        return (
          <div key={s.stage_number} className="flex min-w-[72px] flex-1 items-start">
            {idx > 0 ? (
              <div
                className={`mx-1 mt-4 h-0.5 flex-1 ${connDone ? 'bg-emerald-300' : 'bg-slate-200'}`}
                aria-hidden
              />
            ) : null}
            <div className="flex flex-1 flex-col items-center px-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold ${circleClass}`}
              >
                {done ? '✓' : s.stage_number}
              </div>
              <div className="mt-1 text-center text-[10px] font-medium text-slate-600">{label}</div>
              <div className="text-center text-[10px] text-slate-400">
                {s.status === 'PENDING' && s.sla_deadline_at
                  ? `SLA ${new Date(s.sla_deadline_at).toLocaleString()}`
                  : s.decided_at
                    ? new Date(s.decided_at).toLocaleString()
                    : '—'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
