import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { KeyRound, Lock, AlertCircle, Eye, EyeOff, ArrowLeft, Check } from 'lucide-react';
import api from '../../services/api';
import useToast from '../../hooks/useToast';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const email = searchParams.get('email');
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token || !email) {
      setError('Invalid or missing reset token. Please request a new password reset link.');
    }
  }, [token, email]);

  const validateComplexity = (pwd) => {
    if (pwd.length < 8) return 'Password must be at least 8 characters long';
    if (!/[A-Z]/.test(pwd)) return 'Password must contain at least one uppercase letter';
    if (!/[a-z]/.test(pwd)) return 'Password must contain at least one lowercase letter';
    if (!/[0-9]/.test(pwd)) return 'Password must contain at least one number';
    if (!/[!@#$%^&*()_+={}[\]|\\:;"'<>,.?/~`-]/.test(pwd)) return 'Password must contain at least one special character';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token || !email) return;

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const complexityError = validateComplexity(password);
    if (complexityError) {
      setError(complexityError);
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await api.post('/auth/reset-password', {
        email,
        token,
        new_password: password
      });
      showToast('Password reset successful! You can now log in.', 'success');
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to reset password. The token may be expired or invalid.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      {/* Left Image Panel (Hidden on mobile) */}
      <div className="relative hidden w-1/2 lg:block overflow-hidden">
        <img 
          src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?q=80&w=2074&auto=format&fit=crop" 
          alt="Corporate Travel" 
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-10000 hover:scale-105"
        />
        <div className="absolute inset-0 bg-brand/60 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/40 to-transparent" />
        
        <div className="absolute bottom-16 left-16 right-16 text-white">
          <h2 className="text-4xl font-extrabold tracking-tight mb-4 leading-tight">
            Simplify Your Corporate Travel & Expenses
          </h2>
          <p className="text-lg text-white/80 font-medium leading-relaxed max-w-xl">
            Experience a seamless, unified platform for booking trips, managing approvals, and settling reimbursements instantly. Built for the modern enterprise.
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
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand mb-6 shadow-sm border border-brand/20">
              <KeyRound size={24} />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Create New Password</h1>
            <p className="mt-2 text-sm text-slate-500 font-medium">Please enter your new password below.</p>
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-3.5 flex items-start gap-2 text-rose-700 text-sm font-medium shadow-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {(!token || !email) ? (
             <div className="text-left mt-6">
              <Link to="/forgot-password" className="btn-primary w-full h-12 shadow-lg shadow-brand/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/40">
                Request New Link
              </Link>
             </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-slate-700">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock size={18} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    className="field !pl-10 !pr-10 h-12"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-slate-700">
                  Confirm New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock size={18} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    className="field !pl-10 h-12"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-[11px] font-medium text-slate-500 space-y-2.5 shadow-sm">
                <p className="font-bold text-slate-800 text-xs mb-1">Password Requirements:</p>
                <div className="space-y-1.5">
                  <div className={`flex items-center gap-2 transition-colors ${password.length >= 8 ? "text-emerald-600" : "text-rose-500"}`}>
                    {password.length >= 8 ? <Check size={14} strokeWidth={3} className="shrink-0" /> : <div className="h-1.5 w-1.5 rounded-full bg-rose-400 ml-1 mr-0.5 shrink-0" />}
                    <span>At least 8 characters</span>
                  </div>
                  <div className={`flex items-center gap-2 transition-colors ${/[A-Z]/.test(password) ? "text-emerald-600" : "text-rose-500"}`}>
                    {/[A-Z]/.test(password) ? <Check size={14} strokeWidth={3} className="shrink-0" /> : <div className="h-1.5 w-1.5 rounded-full bg-rose-400 ml-1 mr-0.5 shrink-0" />}
                    <span>At least 1 uppercase letter</span>
                  </div>
                  <div className={`flex items-center gap-2 transition-colors ${/[a-z]/.test(password) ? "text-emerald-600" : "text-rose-500"}`}>
                    {/[a-z]/.test(password) ? <Check size={14} strokeWidth={3} className="shrink-0" /> : <div className="h-1.5 w-1.5 rounded-full bg-rose-400 ml-1 mr-0.5 shrink-0" />}
                    <span>At least 1 lowercase letter</span>
                  </div>
                  <div className={`flex items-center gap-2 transition-colors ${/[0-9]/.test(password) ? "text-emerald-600" : "text-rose-500"}`}>
                    {/[0-9]/.test(password) ? <Check size={14} strokeWidth={3} className="shrink-0" /> : <div className="h-1.5 w-1.5 rounded-full bg-rose-400 ml-1 mr-0.5 shrink-0" />}
                    <span>At least 1 number</span>
                  </div>
                  <div className={`flex items-center gap-2 transition-colors ${/[!@#$%^&*()_+={}[\]|\\:;"'<>,.?/~`-]/.test(password) ? "text-emerald-600" : "text-rose-500"}`}>
                    {/[!@#$%^&*()_+={}[\]|\\:;"'<>,.?/~`-]/.test(password) ? <Check size={14} strokeWidth={3} className="shrink-0" /> : <div className="h-1.5 w-1.5 rounded-full bg-rose-400 ml-1 mr-0.5 shrink-0" />}
                    <span>At least 1 special character</span>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !password || !confirmPassword}
                className="btn-primary w-full h-12 mt-2 text-[15px] shadow-lg shadow-brand/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/40"
              >
                {loading ? 'Resetting Password...' : 'Reset Password'}
              </button>
            </form>
          )}

          <div className="mt-10 text-center lg:text-left">
            <Link to="/login" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
              <ArrowLeft size={16} /> Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
