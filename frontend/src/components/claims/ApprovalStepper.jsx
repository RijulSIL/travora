import { Check, X, ArrowLeft, Clock, Circle } from 'lucide-react';

function statusMeta(status) {
  if (status === 'APPROVED') return { icon: Check, className: 'bg-emerald-50 text-emerald-600 border-emerald-200/60' };
  if (status === 'REJECTED') return { icon: X, className: 'bg-red-50 text-red-600 border-red-200/60' };
  if (status === 'SENT_BACK') return { icon: ArrowLeft, className: 'bg-amber-50 text-amber-600 border-amber-200/60' };
  if (status === 'PENDING') return { icon: Clock, className: 'bg-blue-50 text-blue-600 border-blue-200/60 animate-pulse' };
  return { icon: Circle, className: 'bg-slate-50/60 text-slate-400 border-slate-200/40' };
}

function slaText(deadlineIso) {
  if (!deadlineIso) return null;
  const now = Date.now();
  const deadline = new Date(deadlineIso).getTime();
  const diff = deadline - now;
  if (diff <= 0) return { label: 'SLA breached', className: 'text-red-600 font-bold' };
  const hrs = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const klass = hrs < 24 ? 'text-amber-600 font-bold' : 'text-slate-400';
  return { label: `SLA: ${hrs}h ${mins}m remaining`, className: klass };
}

export default function ApprovalStepper({ stages = [] }) {
  if (!stages.length) return <p className="text-sm text-slate-500">Approval chain unavailable.</p>;
  return (
    <div className="space-y-3.5">
      {stages.map((stage) => {
        const meta = statusMeta(stage.status);
        const IconComponent = meta.icon;
        const sla = stage.status === 'PENDING' ? slaText(stage.sla_deadline_at) : null;
        return (
          <div
            key={stage.stage_number}
            className="rounded-xl border border-slate-100 bg-slate-50/20 p-3.5 hover:bg-slate-50/50 transition-all duration-150 shadow-sm"
          >
            <div className="flex items-center gap-2.5 text-sm font-bold text-slate-800">
              <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${meta.className}`}>
                <IconComponent size={12} className="stroke-[3]" />
              </span>
              <span>
                Stage {stage.stage_number}: {stage.label} · <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{stage.status}</span>
              </span>
            </div>
            <div className="mt-1.5 pl-[38px] text-xs text-slate-500 font-medium">
              {stage.decided_at ? new Date(stage.decided_at).toLocaleString() : 'Not started'}
            </div>
            {sla ? (
              <div className={`mt-1.5 pl-[38px] text-xs flex items-center gap-1.5 ${sla.className}`}>
                <Clock size={12} />
                <span>{sla.label}</span>
              </div>
            ) : null}
            {stage.comment ? (
              <div className="mt-2.5 pl-[38px]">
                <p className="rounded-lg bg-white/60 border border-slate-100/50 px-3 py-2 text-xs italic text-slate-600">
                  &quot;{stage.comment}&quot;
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
