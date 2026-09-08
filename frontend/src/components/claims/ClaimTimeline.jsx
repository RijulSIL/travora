function eventColor(event) {
  if (event === 'stage_approved' || event === 'submitted' || event === 'resubmitted') return 'bg-emerald-500';
  if (event === 'sent_back') return 'bg-amber-500';
  if (event === 'rejected') return 'bg-red-500';
  if (event === 'payment_processed') return 'bg-blue-500';
  return 'bg-slate-400';
}

function eventLabel(item) {
  if (item.event === 'stage_approved') return `Stage ${item.stage} approved`;
  if (item.event === 'sent_back') return `Sent back at stage ${item.stage || '—'}`;
  if (item.event === 'payment_processed') return `Payment processed${item.utr ? ` (UTR: ${item.utr})` : ''}`;
  return item.event.replaceAll('_', ' ');
}

export default function ClaimTimeline({ items = [] }) {
  if (!items.length) return <p className="text-sm text-slate-500 font-medium">No timeline events yet.</p>;
  return (
    <div className="space-y-3.5">
      {[...items].reverse().map((item, idx) => (
        <div key={`${item.event}-${item.timestamp}-${idx}`} className="flex gap-3.5 rounded-xl border border-slate-100 bg-slate-50/20 p-3.5 hover:bg-slate-50/50 transition-all duration-150 shadow-sm">
          <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${eventColor(item.event)}`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-800">{eventLabel(item)}</div>
            <div className="text-xs text-slate-500 font-medium mt-0.5">
              {(item.actor || 'System')}{item.role ? ` · ${item.role}` : ''} · {
                (() => {
                  const dateStr = item.timestamp.endsWith('Z') || item.timestamp.includes('+') 
                    ? item.timestamp 
                    : item.timestamp + 'Z';
                  return new Date(dateStr).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
                })()
              }
            </div>
            {item.comment ? (
              <div className="mt-2.5">
                <p className="rounded-lg bg-white/60 border border-slate-100/50 px-3 py-2 text-xs italic text-slate-600">
                  &quot;{item.comment}&quot;
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
