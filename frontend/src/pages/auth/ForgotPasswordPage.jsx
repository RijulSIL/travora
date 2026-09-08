import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '../../services/api';
import useToast from '../../hooks/useToast';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSuccess(true);
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to send reset link', 'error');
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
            <img src="/companylogo.png" alt="Company Logo" className="h-10 w-auto object-contain mb-8" />
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Reset Password</h1>
            <p className="mt-2 text-sm text-slate-500 font-medium">Enter your email and we'll send you a link to reset your password.</p>
          </div>

          {success ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-3 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 size={18} />
                <span className="font-semibold">Check your inbox</span>
              </div>
              <p className="text-sm text-emerald-600 font-medium">
                We've sent a password reset link to <strong>{email}</strong>. Please check your email and click the link to continue.
              </p>
              <button 
                type="button"
                className="mt-4 w-full btn-secondary h-11 text-sm font-semibold shadow-sm"
                onClick={() => {
                  setSuccess(false);
                  setEmail('');
                }}
              >
                Try another email
              </button>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
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
                {loading ? 'Sending link...' : 'Send Reset Link'}
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
