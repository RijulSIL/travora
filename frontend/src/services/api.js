import axios from 'axios';

import { clearSession, getAccessToken, setSession, useAuthStore } from '../store/authStore';
import { showToast } from '../store/toastStore';
import { normalizeApiError } from '../utils/apiErrors';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8005/api/v1/',
  withCredentials: true,
});

let refreshPromise = null;

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
      originalRequest?.url?.includes('/auth/refresh') ||
      originalRequest?.url?.includes('/auth/login')
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
      const refreshToken = useAuthStore.getState().refreshToken;
      const headers = refreshToken ? { 'X-Refresh-Token': refreshToken } : {};
      refreshPromise ||= api.post('/auth/refresh', {}, { headers });
      const response = await refreshPromise;


      refreshPromise = null;
      setSession(response.data);
      originalRequest.headers.Authorization = `Bearer ${response.data.access_token}`;
      return api(originalRequest);
    } catch (refreshError) {
      refreshPromise = null;
      clearSession();
      showToast('Your session has expired. Please log in again.', 'error');
      window.location.assign('/');
      return Promise.reject(refreshError);
    }
  },
);

export default api;
