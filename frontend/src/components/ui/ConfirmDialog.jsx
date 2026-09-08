import useBodyScrollLock from '../../hooks/useBodyScrollLock';

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  confirmVariant = 'danger',
}) {
  useBodyScrollLock(open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded border border-line bg-white p-5 shadow-lg">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={confirmVariant === 'danger' ? 'rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white' : 'btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
