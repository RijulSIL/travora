export default function NotificationPanel({ items, onMarkAllRead, onSelect }) {
  return (
    <div className="absolute right-0 top-11 z-50 w-80 rounded-lg border border-line bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="text-sm font-semibold text-ink">Notifications</div>
        <button className="text-xs font-semibold text-blue-700" onClick={onMarkAllRead}>
          Mark all read
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {items.length ? (
          items.map((item) => (
            <button
              key={item.sqlid}
              className="w-full border-b border-line px-3 py-2 text-left hover:bg-slate-50"
              onClick={() => onSelect(item)}
            >
              <div className="text-sm font-medium text-ink">{item.title}</div>
              <div className="text-xs text-slate-600">{item.body || '—'}</div>
              <div className="mt-1 text-[11px] text-slate-500">{new Date(item.created_at).toLocaleString()}</div>
            </button>
          ))
        ) : (
          <div className="px-3 py-4 text-sm text-slate-500">No recent notifications.</div>
        )}
      </div>
      <div className="px-3 py-2 text-right text-sm">
        <a className="font-semibold text-blue-700" href="/notifications">
          View all →
        </a>
      </div>
    </div>
  );
}
