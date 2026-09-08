export default function PageHeader({ title, actions }) {
  if (!title && !actions) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      {title ? <h1 className="text-2xl font-semibold text-ink">{title}</h1> : <span className="flex-1" />}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
