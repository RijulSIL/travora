import { Navigate, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';

import api from '../services/api';
import { showToast } from '../store/toastStore';
import { setSession, useAuthStore } from '../store/authStore';

export default function ProtectedRoute() {
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    let mounted = true;
    const bootstrapSession = async () => {
      if (!useAuthStore.getState().isAuthenticated) {
        try {
          const refreshToken = useAuthStore.getState().refreshToken;
          const headers = refreshToken ? { 'X-Refresh-Token': refreshToken } : {};
          const response = await api.post('/auth/refresh', {}, { headers });
          setSession(response.data);




        } catch {
          /* allow redirect to public landing */
        }
      }

      if (!mounted) return;
      if (!useAuthStore.getState().isAuthenticated) {
        setIsBootstrapping(false);
        return;
      }

      try {
        if (!useAuthStore.getState().profile) {
          const { data } = await api.get('/me');
          useAuthStore.getState().setProfile(data);
        }
      } catch {
        const { user } = useAuthStore.getState();
        if (user?.role) {
          useAuthStore.getState().setProfile({
            role: user.role,
            full_name: user.full_name ?? null,
            email: user.email ?? null,
            pending_approvals_count: 0,
            payment_queue_total_inr: null,
          });
          showToast(
            'Could not load full profile from the server. Using your signed-in role; some counts may be missing. You can retry after the page loads.',
            'error',
            {
              label: 'Retry',
              onClick: async () => {
                try {
                  const { data } = await api.get('/me');
                  useAuthStore.getState().setProfile(data);
                  showToast('Profile refreshed.', 'success');
                } catch {
                  showToast('Profile still unavailable.', 'error');
                }
              },
            },
          );
        } else {
          showToast('Could not load your account profile. Please sign in again.', 'error');
        }
      } finally {
        if (mounted) setIsBootstrapping(false);
      }
    };

    bootstrapSession();
    return () => {
      mounted = false;
    };
  }, []);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const hasRoleForShell = Boolean(profile?.role ?? user?.role);

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading session…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (!hasRoleForShell) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center text-sm text-slate-600">
        <p>Your session is missing role information. Please sign out and sign in again.</p>
        <a className="btn-primary text-ink no-underline" href="/">
          Back to home
        </a>
      </div>
    );
  }

  return <Outlet />;
}
