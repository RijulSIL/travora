import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useState } from 'react';

import useFormValidation from '../../hooks/useFormValidation';
import api from '../../services/api';
import { setSession } from '../../store/authStore';
import { email, required } from '../../utils/validators';

/**
 * Shared login fields and submit logic. Used from the landing sign-in modal.
 */
export default function LoginForm({
  onSuccess,
  className = '',
  intro = null,
  submitClassName = 'btn-primary inline-flex w-full items-center justify-center gap-2',
  emailId = 'login-email',
  passwordId = 'login-password',
  emailRef = null,
}) {
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
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
      setSession(response.data);
      onSuccess?.(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={className}>
      {intro}
      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={emailId}>
            Email
          </label>
          <input
            ref={emailRef}
            id={emailId}
            type="email"
            autoComplete="username"
            required
            className="field w-full"
            value={form.values.email}
            onChange={(event) => form.handleChange('email', event.target.value)}
            onBlur={() => form.handleBlur('email')}
          />
          {form.errors.email ? <p className="mt-1 text-xs text-red-600">{form.errors.email}</p> : null}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-700" htmlFor={passwordId}>
              Password
            </label>
            <Link to="/forgot-password" className="text-xs font-semibold text-brand hover:underline" tabIndex="-1">
              Forgot password?
            </Link>
          </div>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            required
            className="field w-full"
            value={form.values.password}
            onChange={(event) => form.handleChange('password', event.target.value)}
            onBlur={() => form.handleBlur('password')}
          />
          {form.errors.password ? <p className="mt-1 text-xs text-red-600">{form.errors.password}</p> : null}
        </div>
        {error ? (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{String(error)}</div>
        ) : null}
        <button className={submitClassName} type="submit" disabled={submitting}>
          <LogIn size={18} aria-hidden="true" />
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
