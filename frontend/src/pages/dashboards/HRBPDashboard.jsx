import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ClipboardList, ArrowRight, Settings } from 'lucide-react';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAuthStore } from '../../store/authStore';
import { reimbursementApi } from '../../services/reimbursementApi';

export default function HRBPDashboard() {
  useSetPageTitle('Home');
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const [heatmap, setHeatmap] = useState(null);
  const [loading, setLoading] = useState(true);

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];

  useEffect(() => {
    reimbursementApi.policyViolations()
      .then(res => setHeatmap(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const hrReview = profile?.pending_approvals_count ?? 0;
  const exceptions = profile?.exception_requests_pending_count ?? 0;

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">
          Welcome back, {firstName}
        </h2>
        <p className="mt-1 text-sm text-slate-500">Monitor HR approval pressure and escalations.</p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="stat-card">
          <div className="stat-card-icon bg-brand">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="stat-card-label">HR Review Queue</div>
          <div className="stat-card-value">{hrReview}</div>
          <Link className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/claims/pending">
            Open HR queue <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-red-500">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="stat-card-label">Exception Requests</div>
          <div className="stat-card-value">{exceptions}</div>
          <Link className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/claims/pending">
            Review escalation queue <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Compliance Heatmap */}
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-[15px] font-bold text-ink">Compliance Heatmap</h3>
          <p className="text-xs text-slate-400 mt-0.5">Violation density by Department and Expense Category.</p>
        </div>
        <div className="p-5 overflow-x-auto">
          {loading ? (
             <div className="py-8 text-center text-sm text-slate-400">Loading analytics…</div>
          ) : !heatmap || !heatmap.departments.length ? (
             <div className="py-8 text-center text-sm text-slate-400">No violation data found for this period.</div>
          ) : (
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr>
                  <th className="p-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Dept \ Cat</th>
                  {heatmap.categories.map(c => <th key={c} className="p-2 font-medium uppercase tracking-tighter text-slate-400">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {heatmap.departments.map(dept => (
                  <tr key={dept} className="border-t border-slate-100">
                    <td className="p-2 font-medium text-ink">{dept}</td>
                    {heatmap.categories.map(cat => {
                      const count = heatmap.matrix[dept]?.[cat] || 0;
                      let bg = 'bg-slate-50';
                      if (count > 0) bg = 'bg-red-50 text-red-700 font-bold';
                      if (count > 5) bg = 'bg-red-100 text-red-800 font-bold';
                      if (count > 10) bg = 'bg-red-200 text-red-900 font-bold';
                      return (
                        <td key={cat} className={`p-2 text-center rounded transition-colors ${bg}`}>
                          {count}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Admin shortcuts */}
      <section className="panel p-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="h-4 w-4 text-slate-400" />
          <h3 className="text-[15px] font-bold text-ink">Admin console shortcuts</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { to: '/admin/policy-versions', label: 'Policy versions' },
            { to: '/admin/impact-levels', label: 'Impact levels' },
            { to: '/admin/city-groups', label: 'City groups' },
            { to: '/admin/expense-limits', label: 'Expense limits' },
            { to: '/admin/expense-categories', label: 'Expense categories' },
            { to: '/admin/workflow-config', label: 'Approval matrix' },
            { to: '/admin/notification-templates', label: 'Notification templates' },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="quick-action"
            >
              <span className="flex-1">{item.label}</span>
              <ArrowRight className="h-4 w-4 opacity-40" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
