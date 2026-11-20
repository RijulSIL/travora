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
  // Optional extra content under the description (e.g. a reason box), and a busy state that
  // disables both buttons while the action runs.
  children = null,
  busy = false,
}) {
  useBodyScrollLock(open);

  if (!open) return null;

  // Portaled to <body> rather than rendered in place — a caller whose own tree sits under an
  // ancestor with a transform/filter (common for page-enter animations) would otherwise turn
  // `fixed inset-0` into "fixed relative to that ancestor" instead of the true viewport,
  // leaving a sliver of the page's own background exposed above the dialog's overlay.
  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="panel w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className={confirmVariant === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
