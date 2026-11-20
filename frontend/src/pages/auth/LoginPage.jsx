import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AuthBrandPanel, { AuthMobileLogo } from '../../components/auth/AuthBrandPanel';
import useFormValidation from '../../hooks/useFormValidation';
import api from '../../services/api';
import { setSession } from '../../store/authStore';
import { email, required } from '../../utils/validators';
import { useSetPageTitle } from '../../context/PageTitleContext';

export default function LoginPage() {
  useSetPageTitle('Sign In');
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaToken, setMfaToken] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  
  const form = useFormValidation({
    initialValues: { email: '', password: '' },
    rules: {
      email: [required(), email()],
      password: [required()],
    },
  });

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.validateAll()) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await api.post('/auth/login', form.values);
      if (response.data?.mfa_required) {
        setMfaToken(response.data.mfa_token);
      } else {
        // Fallback for non-MFA cases (though not expected anymore)
        setSession(response.data);
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (event) => {
    event.preventDefault();
    if (!otpCode) {
      setError('Please enter the OTP');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await api.post('/auth/login/verify-otp', {
        mfa_token: mfaToken,
        otp_code: otpCode,
      });
      setSession(response.data);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'OTP Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      {/* Left photo panel with the logo (hidden on mobile) — shared by every sign-in screen */}
      <AuthBrandPanel />

      {/* Right Login Panel */}
      <div className="flex w-full items-center justify-center lg:w-1/2 p-6 lg:p-12 relative overflow-hidden bg-white">
        {/* Subtle background effects on the form side */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden lg:hidden">
          <div className="absolute top-1/4 left-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/5 blur-[80px]" />
        </div>

        <div className="relative z-10 w-full max-w-[400px]">
          <div className="mb-8 text-left">
            <AuthMobileLogo />
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
              {mfaToken ? 'Verify your identity' : 'Welcome back'}
            </h1>
            <p className="mt-2 text-sm text-slate-500 font-medium">
              {mfaToken ? 'Enter the 6-character code sent to your email.' : 'Sign in to your enterprise portal to continue.'}
            </p>
          </div>

          {!mfaToken ? (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-slate-700" htmlFor="login-email">
                  Work Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  required
                  className="field w-full h-12"
                  value={form.values.email}
                  onChange={(event) => form.handleChange('email', event.target.value)}
                  onBlur={() => form.handleBlur('email')}
                  placeholder="name@company.com"
                />
                {form.errors.email ? <p className="mt-1 text-xs text-red-600 font-medium">{form.errors.email}</p> : null}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="login-password">
                    Password
                  </label>
                  <Link to="/forgot-password" className="text-[13px] font-semibold text-brand hover:underline" tabIndex="-1">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    className="field w-full h-12 !pr-11"
                    value={form.values.password}
                    onChange={(event) => form.handleChange('password', event.target.value)}
                    onBlur={() => form.handleBlur('password')}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 transition-colors hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {form.errors.password ? <p className="mt-1 text-xs text-red-600 font-medium">{form.errors.password}</p> : null}
              </div>

              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700 font-medium shadow-sm">{String(error)}</div>
              ) : null}

              <button
                className="group btn-primary mt-6 flex h-12 w-full items-center justify-center gap-2 text-[15px] font-bold shadow-lg shadow-brand/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/40"
                type="submit"
                disabled={submitting}
              >
                {submitting ? (
                  'Signing in...'
                ) : (
                  <>
                    Sign in to Dashboard
                    <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={handleVerifyOtp}>
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-slate-700" htmlFor="otp-code">
                  OTP Code
                </label>
                <input
                  id="otp-code"
                  type="text"
                  required
                  className="field w-full h-12 uppercase tracking-[0.2em] text-center font-bold text-lg"
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value)}
                  placeholder="XXXXXX"
                  maxLength={6}
                />
              </div>

              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700 font-medium shadow-sm">{String(error)}</div>
              ) : null}

              <button
                className="group btn-primary mt-6 flex h-12 w-full items-center justify-center gap-2 text-[15px] font-bold shadow-lg shadow-brand/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/40"
                type="submit"
                disabled={submitting}
              >
                {submitting ? (
                  'Verifying...'
                ) : (
                  <>
                    Verify & Continue
                    <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
              
              <div className="mt-4 flex flex-col items-center gap-3">
                <button
                  type="button"
                  className="text-sm font-semibold text-brand hover:underline disabled:opacity-50"
                  onClick={(e) => {
                    setOtpCode('');
                    handleSubmit(e);
                  }}
                  disabled={submitting}
                >
                  Resend OTP
                </button>
                <button
                  type="button"
                  className="text-sm font-medium text-slate-500 hover:text-slate-700 underline"
                  onClick={() => { setMfaToken(null); setError(null); }}
                >
                  Back to login
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 text-center lg:text-left">
            <Link to="/"className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
              &larr; Back to Landing Page
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
