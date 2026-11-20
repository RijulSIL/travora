import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Lock, AlertCircle, Eye, EyeOff, Check } from 'lucide-react';
import AuthBrandPanel, { AuthMobileLogo } from '../../components/auth/AuthBrandPanel';
import api from '../../services/api';
import useToast from '../../hooks/useToast';

// Printed in every welcome email (backend welcome_service.TEMPORARY_PASSWORD).
const TEMPORARY_PASSWORD = 'Welcome@123';
// Reset codes are always 6 characters (backend auth_service.generate_and_send_otp).
const OTP_LENGTH = 6;

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Same rules as the first sign-in page (SetInitialPasswordPage); Reset Password stays off until all pass.
  const rules = [
    [password.length >= 8, 'At least 8 characters'],
    [/[A-Z]/.test(password), 'At least 1 uppercase letter'],
    [/[a-z]/.test(password), 'At least 1 lowercase letter'],
    [/[0-9]/.test(password), 'At least 1 number'],
    [/[!@#$%^&*()_+={}[\]|\\:;"'<>,.?/~`-]/.test(password), 'At least 1 special character'],
    [Boolean(password) && password !== TEMPORARY_PASSWORD, 'Not the temporary password'],
    [Boolean(password) && password === confirmPassword, 'Both passwords match'],
  ];
  const ready = otpCode.trim().length === OTP_LENGTH && rules.every(([ok]) => ok);

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setStep('otp');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to send OTP', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!ready) return;

    setError(null);
    setLoading(true);

    try {
      await api.post('/auth/reset-password', {
        email,
        otp_code: otpCode,
        new_password: password,
      });
      showToast('Password reset successful! You can now log in.', 'success');
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to reset password. The OTP may be expired or invalid.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      {/* Left photo panel with the logo (hidden on mobile) — shared by every sign-in screen */}
      <AuthBrandPanel />

      {/* Right Content Panel */}
      <div className="flex w-full items-center justify-center lg:w-1/2 p-6 lg:p-12 relative overflow-hidden bg-white">
        <div className="pointer-events-none absolute inset-0 overflow-hidden lg:hidden">
          <div className="absolute top-1/4 left-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/5 blur-[80px]" />
        </div>

        <div className="relative z-10 w-full max-w-[400px]">
          {step === 'email' ? (
            <>
              <div className="mb-8 text-left">
                <AuthMobileLogo />
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Reset Password</h1>
                <p className="mt-2 text-sm text-slate-500 font-medium">Enter your email and we&apos;ll send you a one-time code to reset your password.</p>
              </div>

              <form className="space-y-5" onSubmit={handleRequestOtp}>
                <div className="space-y-1.5">
                  <label htmlFor="email" className="block text-sm font-semibold text-slate-700">
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Mail size={18} />
                    </div>
                    <input
                      id="email"
                      type="email"
                      required
                      className="field !pl-10 h-12"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="btn-primary w-full h-12 text-[15px] shadow-lg shadow-brand/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/40"
                >
                  {loading ? 'Sending OTP...' : 'Send OTP'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-8 text-left">
                <AuthMobileLogo />
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Enter Code & New Password</h1>
                <p className="mt-2 text-sm text-slate-500 font-medium">
                  If an account exists for <strong>{email}</strong>, we&apos;ve sent it a 6-character code. It expires in a few minutes.
                </p>
              </div>

              {error && (
                <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3.5 flex items-start gap-2 text-red-700 text-sm font-medium shadow-sm">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form className="space-y-5" onSubmit={handleResetPassword}>
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">OTP Code</label>
                  <input
                    type="text"
                    required
                    maxLength={OTP_LENGTH}
                    className="field h-12 tracking-[0.3em] font-mono text-center uppercase"
                    placeholder="------"
                    value={otpCode}
                    onChange={(e) => {
                      setOtpCode(e.target.value.toUpperCase());
                      if (error) setError(null);
                    }}
                    disabled={loading}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">New Password</label>
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
                  <label className="block text-sm font-semibold text-slate-700">Confirm New Password</label>
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

                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-[11px] font-medium text-slate-500 shadow-sm">
                  <p className="font-bold text-slate-800 text-xs mb-2.5">Password Requirements:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
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
                  {loading ? 'Resetting Password...' : 'Reset Password'}
                </button>
              </form>
            </>
          )}

          <div className="mt-6 flex items-center justify-center gap-6 lg:justify-between">
            <Link to="/login" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
              <ArrowLeft size={16} /> Back to Login
            </Link>
            {step === 'otp' && (
              <button
                type="button"
                className="text-[13px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
                onClick={() => {
                  setStep('email');
                  setOtpCode('');
                  setError(null);
                }}
                disabled={loading}
              >
                Use a different email
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
