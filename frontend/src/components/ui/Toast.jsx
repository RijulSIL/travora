import { useToastStore } from '../../store/toastStore';

export default function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <div className="toast-container pointer-events-none" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`toast pointer-events-auto toast-${t.variant ?? 'info'}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span>{t.message}</span>
            {t.action?.label && t.action?.onClick ? (
              <button
                type="button"
                className="rounded border border-white/60 px-2 py-1 text-xs"
                onClick={t.action.onClick}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
