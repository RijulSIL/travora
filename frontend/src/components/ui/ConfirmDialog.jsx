import { createPortal } from 'react-dom';

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

  // Portaled to <body> rather than rendered in place — a caller whose own tree sits under an
  // ancestor with a transform/filter (common for page-enter animations) would otherwise turn
  // `fixed inset-0` into "fixed relative to that ancestor" instead of the true viewport,
  // leaving a sliver of the page's own background exposed above the dialog's overlay.
  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/40 p-4">
      <div className="panel w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={confirmVariant === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
