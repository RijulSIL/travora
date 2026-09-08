import { useEffect, useState } from 'react';
import { Users, Settings, Shield, Layers, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { adminApi } from '../../services/adminApi';
import { useAuthStore } from '../../store/authStore';
import Skeleton from '../../components/ui/Skeleton';

const statConfig = [
  { key: 'active_policy_version', label: 'Active policy version', icon: Shield, color: 'bg-brand' },
  { key: 'total_employees', label: 'Total employees', icon: Users, color: 'bg-sky-500' },
  { key: 'pending_hrbp_approvals', label: 'Pending HRBP approvals', icon: Layers, color: 'bg-amber-500' },
  { key: 'impact_level_count', label: 'Impact level count', icon: Settings, color: 'bg-purple-500' },
];

export default function AdminDashboard() {
  useSetPageTitle('Home');
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];

  useEffect(() => {
    Promise.all([
      adminApi.dashboardStats(),
      adminApi.auditLogs()
    ])
      .then(([statsRes, logsRes]) => {
        setStats(statsRes.data);
        setAuditLogs((logsRes.data || []).slice(0, 5));
      })
      .catch((requestError) => setError(requestError))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">
          Welcome back, {firstName}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Operational snapshot from the admin dashboard; audit excerpts are placeholders ahead of richer search.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.response?.data?.detail || error.message}
        </div>
      ) : null}

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statConfig.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="stat-card">
            <div className={`stat-card-icon ${color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="stat-card-label">{label}</div>
            <div className="stat-card-value">
              {loading ? <Skeleton width="50%" height={28} /> : stats[key] ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Recent audit activity */}
      <section className="panel p-6">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-[15px] font-bold text-ink">Recent audit activity</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Latest system actions and events recorded in the immutable audit log.
            </p>
          </div>
          <Link to="/admin/audit-logs" className="btn-secondary px-4 text-xs">
            View immutable log <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </div>
        <ul className="space-y-2">
          {loading ? (
            <div className="py-4 text-center text-sm text-slate-500">Loading...</div>
          ) : auditLogs.length > 0 ? (
            auditLogs.map((log) => (
              <li
                key={log.id}
                className="flex flex-wrap gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-slate-500 items-center"
              >
                <span className="font-bold text-ink uppercase">{log.entity_type}</span>
                <span className="font-semibold text-slate-700">{log.action}</span>
                <span>·</span>
                <span>Actor: {log.actor_id || 'System'}</span>
                <span>·</span>
                <span>{new Date(log.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="ml-auto font-mono text-[10px] text-slate-400 truncate max-w-[120px]" title={log.event_hash}>
                  {log.event_hash}
                </span>
              </li>
            ))
          ) : (
            <li className="text-sm text-slate-500 text-center py-4">No recent audit activity found.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
