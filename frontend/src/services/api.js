import axios from 'axios';

import { clearSession, getAccessToken, setSession, useAuthStore } from '../store/authStore';
import { showToast } from '../store/toastStore';
import { normalizeApiError } from '../utils/apiErrors';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:9200/api/v1/',
  withCredentials: true,
});

let refreshPromise = null;

// Sign-in, code and password steps answer 401 for a wrong password or code — not an expired
// session — so they're shown as errors instead of triggering a refresh (which would log the person
// out mid-reset, or send the same wrong code twice and use up two of its three tries).
const CREDENTIAL_CHECK_URLS = [
  '/auth/refresh',
  '/auth/login',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/change-password',
];

// 401s that mean the session itself has ended (rbac.get_current_claims), not a wrong password or
// code — a signed-in step like the Profile password change still refreshes and retries on these.
// The retried call is the first one that reaches the code check, so no try is used up.
const SESSION_ENDED_DETAILS = ['Missing bearer token', 'Invalid bearer token'];

function isCredentialCheck(error) {
  const url = error.config?.url || '';
  if (!CREDENTIAL_CHECK_URLS.some((check) => url.includes(check))) return false;
  return url.includes('/auth/refresh') || !SESSION_ENDED_DETAILS.includes(error.response?.data?.detail);
}

/** The refresh token as last saved by any tab (tabs share local storage), not this tab's copy. */
export function currentRefreshToken() {
  try {
    return localStorage.getItem('refresh_token') || useAuthStore.getState().refreshToken;
  } catch {
    return useAuthStore.getState().refreshToken;
  }
}

/**
 * Get a new access token and save the new session. Every caller shares one request while it's in
 * flight — the backend cancels a refresh token once it's swapped, so firing several at once with
 * the same token (a page's double load in development, many calls expiring together) would only
 * lean on its short grace period. Resolves with the session; rejects if the login has ended.
 */
export function refreshSession() {
  if (!refreshPromise) {
    const token = currentRefreshToken();
    refreshPromise = api
      .post('/auth/refresh', {}, { headers: token ? { 'X-Refresh-Token': token } : {} })
      .then((response) => {
        setSession(response.data);
        return response.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Request interceptor for debugging and auth
api.interceptors.request.use((config) => {
  console.log('[DEBUG_API] Requesting:', config.method?.toUpperCase(), config.url);
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    console.log('[DEBUG_API] Response OK from:', response.config.url);
    return response;
  },
  async (error) => {
    console.error('[DEBUG_API] Response ERROR from:', error.config?.url, error.response?.status);
    const originalRequest = error.config;
    if (
      error.response?.status !== 401 ||
      originalRequest?._retry ||
      isCredentialCheck(error)
    ) {
      const normalized = normalizeApiError(error);
      if (!originalRequest?.suppressErrorToast) {
        if (normalized.kind === 'network') {
          showToast(normalized.message, 'error', {
            label: 'Retry',
            onClick: () => {
              if (originalRequest) api(originalRequest);
            },
          });
        } else if (normalized.kind === 'server' || normalized.kind === 'forbidden') {
          showToast(normalized.message, 'error');
        }
      }
      error.normalized = normalized;
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    try {
      const session = await refreshSession();
      originalRequest.headers.Authorization = `Bearer ${session.access_token}`;
      return api(originalRequest);
    } catch (refreshError) {
      clearSession();
      showToast('Your session has expired. Please log in again.', 'error');
      window.location.assign('/');
      return Promise.reject(refreshError);
    }
  },
);

export default api;
