import { create } from 'zustand';

let idSeq = 0;

/** Toast text from whatever a caller passes — often `err.response.data.detail`, which for a 422
 * is a list of {loc, msg} objects. Rendering that list directly crashed the whole app. */
export function toastText(message) {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    const parts = message
      .map((item) => (typeof item === 'string' ? item : item?.msg ? `${item.msg}${item.loc?.length ? ` (${item.loc[item.loc.length - 1]})` : ''}` : ''))
      .filter(Boolean);
    return parts.length ? parts.join('; ') : 'Something went wrong';
  }
  if (message && typeof message === 'object') return message.msg || message.detail || message.message || 'Something went wrong';
  return message == null ? '' : String(message);
}

export const useToastStore = create((set, get) => ({
  toasts: [],
  showToast: (message, variant = 'info', action = null) => {
    const id = `t-${++idSeq}`;
    const next = [...get().toasts, { id, message: toastText(message), variant, action }];
    set({ toasts: next });
    window.setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 4000);
  },
}));

export const showToast = (message, variant, action) =>
  useToastStore.getState().showToast(message, variant, action);
