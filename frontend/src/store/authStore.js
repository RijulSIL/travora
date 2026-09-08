import { create } from 'zustand';

import { selectResolvedRole } from './authSelectors';

export { DEFAULT_RESOLVED_ROLE, selectResolvedRole } from './authSelectors';

export const useAuthStore = create((set) => ({
  accessToken: null,
  refreshToken: typeof localStorage !== 'undefined' ? localStorage.getItem('refresh_token') : null,
  user: null,
  profile: null,
  isAuthenticated: false,
  setProfile: (profile) => set({ profile }),
  setSession: ({ accessToken, access_token, refresh_token, user }) => {
    const rt = refresh_token || useAuthStore.getState().refreshToken;
    if (refresh_token && typeof localStorage !== 'undefined') {
      localStorage.setItem('refresh_token', refresh_token);
    }
    set({ 
      accessToken: accessToken || access_token, 
      refreshToken: rt,
      user, 
      isAuthenticated: true 
    });
  },
  clearSession: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('refresh_token');
    }
    set({
      accessToken: null,
      refreshToken: null,
      user: null,
      profile: null,
      isAuthenticated: false,
    });
  },
}));


export const getAccessToken = () => useAuthStore.getState().accessToken;
export const setSession = (session) => useAuthStore.getState().setSession(session);
export const clearSession = () => useAuthStore.getState().clearSession();

/** Resolved role for guards, nav, and permission checks (read outside React). */
export const getResolvedRole = () => selectResolvedRole(useAuthStore.getState());
