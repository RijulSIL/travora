import { create } from 'zustand';

/**
 * The welcome tour that's running (components/tour/WelcomeTour). Home starts a new person's
 * pending tours by itself (`via` 'auto'); the account menu starts one to replay ('menu').
 * `queue` holds the tours to offer after this one; `run` changes on every start, so a tour
 * started again begins from its first card.
 */
export const useTourStore = create((set) => ({
  active: null,
  queue: [],
  via: null,
  run: 0,
  start: (keys, via = 'auto') =>
    set((state) => ({ active: keys[0] ?? null, queue: keys.slice(1), via, run: state.run + 1 })),
  next: () =>
    set((state) => ({ active: state.queue[0] ?? null, queue: state.queue.slice(1), via: 'queue', run: state.run + 1 })),
  stop: () => set({ active: null, queue: [], via: null }),
}));
