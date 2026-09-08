import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

import LoginForm from './LoginForm';

export default function LoginModal({ open, onClose, onSuccess }) {
  const titleId = useId();
  const emailInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      emailInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[100] bg-slate-900/50"
        aria-label="Close sign-in dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed left-1/2 top-1/2 z-[101] w-[min(100%,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            Sign in
          </h2>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">Use your work account to continue.</p>
        <LoginForm
          emailRef={emailInputRef}
          emailId="login-modal-email"
          passwordId="login-modal-password"
          onSuccess={() => {
            onSuccess?.();
            onClose();
          }}
        />
      </div>
    </>
  );
}
