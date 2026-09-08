import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import api from '../services/api';
import { setSession, useAuthStore } from '../store/authStore';
import LandingPage from './LandingPage';

/**
 * Public `/`: landing for guests; sends authenticated users to the app dashboard.
 */
export default function PublicIndex() {
  const [ready, setReady] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!useAuthStore.getState().isAuthenticated) {
        try {
          const refreshToken = useAuthStore.getState().refreshToken;
          if (refreshToken) {
            const headers = { 'X-Refresh-Token': refreshToken };
            const response = await api.post('/auth/refresh', {}, { headers });
            setSession(response.data);
          }

        } catch {
          /* stay logged out */
        }
      }
      if (mounted) setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">Loading…</div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <LandingPage />;
}
