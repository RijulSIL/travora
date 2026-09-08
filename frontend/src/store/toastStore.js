import { create } from 'zustand';

let idSeq = 0;

export const useToastStore = create((set, get) => ({
  toasts: [],
  showToast: (message, variant = 'info', action = null) => {
    const id = `t-${++idSeq}`;
    const next = [...get().toasts, { id, message, variant, action }];
    set({ toasts: next });
    window.setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 4000);
  },
}));

export const showToast = (message, variant, action) =>
  useToastStore.getState().showToast(message, variant, action);
