export default function EmptyState({ icon = '📋', title, description, action }) {
  return (
    <div className="panel mx-auto flex max-w-lg flex-col items-center rounded-lg border border-dashed border-line bg-white p-8 text-center">
      <span className="text-4xl" aria-hidden="true">
        {icon}
      </span>
      <h2 className="mt-4 text-lg font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-2 text-sm text-slate-600">{description}</p> : null}
      {action ? (
        <button
          type="button"
          className={action.className ?? 'btn-primary mt-6'}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
