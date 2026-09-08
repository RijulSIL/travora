import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DollarSign, Receipt, TrendingUp, ArrowRight, ShieldAlert } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';
import { useAuthStore } from '../../store/authStore';

function boundsThisMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const from_date = `${y}-${pad(m + 1)}-01`;
  const last = new Date(y, m + 1, 0);
  const to_date = `${y}-${pad(m + 1)}-${pad(last.getDate())}`;
  return { from_date, to_date };
}

export default function FinanceDashboard() {
  useSetPageTitle('Home');
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const [gst, setGst] = useState(null);
  const [gstLoading, setGstLoading] = useState(true);
  const [spend, setSpend] = useState([]);
  const [spendLoading, setSpendLoading] = useState(true);
  
  // Analytics state
  const [violationsData, setViolationsData] = useState([]);
  const [violationsLoading, setViolationsLoading] = useState(true);

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGstLoading(true);
      try {
        const params = boundsThisMonth();
        const res = await reimbursementApi.gstSummary(params);
        if (!cancelled) setGst(res.data || null);
      } catch {
        if (!cancelled) setGst(null);
      } finally {
        if (!cancelled) setGstLoading(false);
      }
    })();
    
    (async () => {
      setSpendLoading(true);
      try {
        const res = await reimbursementApi.reportRun('travel-spend-summary', {});
        if (!cancelled) setSpend(res.data?.rows || []);
      } catch {
        if (!cancelled) setSpend([]);
      } finally {
        if (!cancelled) setSpendLoading(false);
      }
    })();
    
    (async () => {
      setViolationsLoading(true);
      try {
        const res = await reimbursementApi.policyViolations({});
        if (!cancelled && res.data) {
          // Flatten the dense_matrix into chart data
          // response shape: { matrix: { "Sales": {"Food": 1} }, categories: ["Food"], departments: ["Sales"], violations: [...] }
          const catCounts = {};
          if (res.data.violations) {
            res.data.violations.forEach(v => {
              catCounts[v.category] = (catCounts[v.category] || 0) + 1;
            });
          }
          const chartData = Object.keys(catCounts).map(cat => ({
            category: cat,
            count: catCounts[cat]
          })).sort((a, b) => b.count - a.count).slice(0, 5); // top 5
          setViolationsData(chartData);
        }
      } catch {
        // Ignore errors
      } finally {
        if (!cancelled) setViolationsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const pqCount = profile?.pending_approvals_count ?? 0;
  const pqTotal = profile?.payment_queue_total_inr;

  const fmtMoney = (v) =>
    v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">
          Welcome back, {firstName}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Payment readiness and consolidated GST totals for this month-to-date slice.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="stat-card">
          <div className="stat-card-icon bg-brand">
            <DollarSign className="h-5 w-5" />
          </div>
          <div className="stat-card-label">Payment Queue</div>
          <div className="stat-card-value text-xl">
            {pqCount} claim{pqCount === 1 ? '' : 's'} · ₹{fmtMoney(pqTotal)}
          </div>
          <Link className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/finance/payment-queue">
            Open settlement queue <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon bg-purple-500">
            <Receipt className="h-5 w-5" />
          </div>
          <div className="stat-card-label">GST this month ({boundsThisMonth().from_date} → today)</div>
          {gstLoading ? (
            <p className="mt-3 text-sm text-slate-400">Loading GST…</p>
          ) : gst ? (
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">CGST</div>
                <div className="mt-0.5 font-bold text-ink">₹{fmtMoney(gst.cgst)}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">SGST</div>
                <div className="mt-0.5 font-bold text-ink">₹{fmtMoney(gst.sgst)}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">IGST</div>
                <div className="mt-0.5 font-bold text-ink">₹{fmtMoney(gst.igst)}</div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">GST summaries unavailable.</p>
          )}
          <Link className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/finance/gst-dashboard">
            GST dashboards <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Vendor Spend Analysis */}
        <section className="panel overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-slate-400" />
              <h3 className="text-[15px] font-bold text-ink">Vendor Spend Analysis</h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Distribution of spend across travel modes (All time).</p>
          </div>
          <div className="p-6">
            {spendLoading ? (
              <div className="py-4 text-center text-sm text-slate-400">Loading spend data…</div>
            ) : !spend.length ? (
              <div className="py-4 text-center text-sm text-slate-400">No spend data found.</div>
            ) : (
              <div className="space-y-4">
                {spend.map((item) => {
                  const max = Math.max(...spend.map(s => Number(s.spend)), 1);
                  const percent = (Number(item.spend) / max) * 100;
                  return (
                    <div key={item.travel_mode}>
                      <div className="flex justify-between text-xs font-medium text-slate-600">
                        <span>{item.travel_mode}</span>
                        <span className="font-bold text-ink">₹{fmtMoney(item.spend)}</span>
                      </div>
                      <div className="mt-1.5 h-2 w-full rounded-full bg-slate-100">
                        <div 
                          className="h-full rounded-full bg-brand transition-all duration-500" 
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Policy Violations Analysis */}
        <section className="panel overflow-hidden flex flex-col">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-500" />
              <h3 className="text-[15px] font-bold text-ink">Top Policy Violations</h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Most frequently flagged expense categories.</p>
          </div>
          <div className="p-6 flex-1 min-h-[250px]">
            {violationsLoading ? (
              <div className="py-8 text-center text-sm text-slate-400">Loading violations…</div>
            ) : !violationsData.length ? (
              <div className="flex flex-col items-center justify-center h-full space-y-2 animate-float">
                <ShieldAlert className="w-8 h-8 text-slate-200" />
                <span className="text-sm text-slate-400">No policy violations found!</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={violationsData} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis type="category" dataKey="category" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} width={80} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Bar dataKey="count" name="Violations" fill="#f43f5e" radius={[0, 4, 4, 0]} barSize={24} animationDuration={1000} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
