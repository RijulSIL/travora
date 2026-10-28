import { AlertCircle, Check, Eye, EyeOff, KeyRound, Lock, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import useToast from '../../hooks/useToast';
import api, { currentRefreshToken } from '../../services/api';
import { clearSession, useAuthStore } from '../../store/authStore';

// Everyone added to Travora starts with this (backend welcome_service.TEMPORARY_PASSWORD).
const TEMPORARY_PASSWORD = 'Welcome@123';

/*
 * First sign-in: someone still on the temporary password from their welcome email sets their own
 * before they can use the app (ProtectedRoute shows this instead of any page). Same look and
 * password rules as Forgot password's reset step, and not the temporary password.
 */
export default function SetInitialPasswordPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const profile = useAuthStore((s) => s.profile);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const firstName = String(profile?.full_name || '').trim().split(/\s+/)[0];
  const rules = [
    [password.length >= 8, 'At least 8 characters'],
    [/[A-Z]/.test(password), 'At least 1 uppercase letter'],
    [/[a-z]/.test(password), 'At least 1 lowercase letter'],
    [/[0-9]/.test(password), 'At least 1 number'],
    [/[!@#$%^&*()_+={}[\]|\\:;"'<>,.?/~`-]/.test(password), 'At least 1 special character'],
    [Boolean(password) && password !== TEMPORARY_PASSWORD, 'Not the temporary password'],
    [Boolean(password) && password === confirmPassword, 'Both passwords match'],
  ];
  const ready = rules.every(([ok]) => ok);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setLoading(true);
    try {
      // Sends this session's refresh token so it stays signed in (anyone else on the temporary
      // password is signed out); the /me below then refreshes into a new session.
      const token = currentRefreshToken();
      await api.post('/auth/set-initial-password', { new_password: password }, { headers: token ? { 'X-Refresh-Token': token } : {} });
      const { data } = await api.get('/me');
      useAuthStore.getState().setProfile(data);
      showToast('Your password is set. Welcome to Travora!', 'success');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail[0]?.msg || 'Could not set your password.' : 'Could not set your password.');
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      const token = currentRefreshToken();
      await api.post('/auth/logout', {}, { headers: token ? { 'X-Refresh-Token': token } : {} });
    } catch {
      /* proceed with local sign-out */
    }
    clearSession();
    navigate('/', { replace: true });
  };

  const onType = (setter) => (e) => {
    setter(e.target.value);
    if (error) setError(null);
  };

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      {/* Left Image Panel (Hidden on mobile) — same as the sign-in and reset-password pages */}
      <div className="relative hidden w-1/2 lg:block overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?q=80&w=2074&auto=format&fit=crop"
          alt="Corporate Travel"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-10000 hover:scale-105"
        />
        <div className="absolute inset-0 bg-brand/60 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/40 to-transparent" />

        <div className="absolute bottom-16 left-16 right-16 text-white">
          <h2 className="text-4xl font-extrabold tracking-tight mb-4 leading-tight">Simplify Your Corporate Travel & Expenses</h2>
          <p className="text-lg text-white/80 font-medium leading-relaxed max-w-xl">
            Experience a seamless, unified platform for booking trips, managing approvals, and settling reimbursements instantly. Built for the modern
            enterprise.
          </p>
        </div>
      </div>

      {/* Right Content Panel */}
      <div className="flex w-full items-center justify-center lg:w-1/2 p-6 lg:p-12 relative overflow-hidden bg-white">
        <div className="pointer-events-none absolute inset-0 overflow-hidden lg:hidden">
          <div className="absolute top-1/4 left-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/5 blur-[80px]" />
        </div>

        <div className="relative z-10 w-full max-w-[400px]">
          <div className="mb-10 text-left">
            <img src="/assets/travora-si-logo.png" alt="Travora" className="h-11 w-auto object-contain mb-8" />
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand mb-6 shadow-sm border border-brand/20">
              <KeyRound size={24} />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Set Your Password</h1>
            <p className="mt-2 text-sm text-slate-500 font-medium">
              Welcome{firstName ? `, ${firstName}` : ''}. You signed in with a temporary password — choose your own to continue. You&apos;ll use it from now
              on.
            </p>
          </div>

          {error && (
            <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3.5 flex items-start gap-2 text-red-700 text-sm font-medium shadow-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <label htmlFor="new-password" className="block text-sm font-semibold text-slate-700">
                New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock size={18} />
                </div>
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  autoFocus
                  className="field !pl-10 !pr-10 h-12"
                  placeholder="••••••••"
                  value={password}
                  onChange={onType(setPassword)}
                  disabled={loading}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="block text-sm font-semibold text-slate-700">
                Confirm New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock size={18} />
                </div>
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  className="field !pl-10 h-12"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={onType(setConfirmPassword)}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-[11px] font-medium text-slate-500 space-y-2.5 shadow-sm">
              <p className="font-bold text-slate-800 text-xs mb-1">Password Requirements:</p>
              <div className="space-y-1.5">
                {rules.map(([ok, label]) => (
                  <div key={label} className={`flex items-center gap-2 transition-colors ${ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {ok ? <Check size={14} strokeWidth={3} className="shrink-0" /> : <div className="h-1.5 w-1.5 rounded-full bg-red-400 ml-1 mr-0.5 shrink-0" />}
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !ready}
              className="btn-primary w-full h-12 mt-2 text-[15px] shadow-lg shadow-brand/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/40"
            >
              {loading ? 'Setting Password...' : 'Set Password and Continue'}
            </button>
          </form>

          <div className="mt-10 text-center lg:text-left">
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
