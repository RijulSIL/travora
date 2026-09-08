import { Link } from 'react-router-dom';
import { FileText, ClipboardList, ArrowRight } from 'lucide-react';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAuthStore } from '../../store/authStore';

export default function PayrollDashboard() {
  useSetPageTitle('Home');
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const stage3 = profile?.pending_approvals_count ?? 0;

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">
          Welcome back, {firstName}
        </h2>
        <p className="mt-1 text-sm text-slate-500">Stage 3 compliance for payroll payouts.</p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="stat-card">
          <div className="stat-card-icon bg-brand">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="stat-card-label">Claims at Payroll Stage</div>
          <div className="stat-card-value">{stage3}</div>
          <Link className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/claims/pending">
            Payroll queue <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-sky-500">
            <FileText className="h-5 w-5" />
          </div>
          <div className="stat-card-label">All Claims</div>
          <div className="stat-card-value text-base text-slate-500 font-medium">View-only roster of claims</div>
          <Link className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/claims/all">
            Open all claims <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
