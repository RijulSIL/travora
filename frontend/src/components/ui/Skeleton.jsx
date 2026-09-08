export default function Skeleton({ variant = 'text', width = '100%', height = 16, rows = 5, columns = 4 }) {
  if (variant === 'card') {
    return <div className="animate-pulse rounded bg-slate-200" style={{ height }} />;
  }
  if (variant === 'stat-card') {
    return (
      <div className="animate-pulse rounded border border-line bg-white p-5">
        <div className="mb-3 h-4 w-2/3 rounded bg-slate-200" />
        <div className="h-8 w-1/2 rounded bg-slate-200" />
      </div>
    );
  }
  if (variant === 'table') {
    return (
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }).map((__, c) => (
              <div key={`${r}-${c}`} className="h-8 animate-pulse rounded bg-slate-200" />
            ))}
          </div>
        ))}
      </div>
    );
  }
  return <div className="animate-pulse rounded bg-slate-200" style={{ width, height }} />;
}
