import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock, Calendar, Plane, FileText, ArrowRight } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { reimbursementApi } from '../../services/reimbursementApi';
import { useAuthStore } from '../../store/authStore';
import useToast from '../../hooks/useToast';

function slaClass(bucket) {
  if (bucket === 'breached') return 'sla-breached';
  if (bucket === 'warning') return 'sla-warning';
  return 'sla-ok';
}

const MOCK_TEAM_SPEND = [
  { month: 'Jan', budget: 50000, spend: 32000 },
  { month: 'Feb', budget: 50000, spend: 41000 },
  { month: 'Mar', budget: 50000, spend: 48000 },
  { month: 'Apr', budget: 50000, spend: 29000 },
  { month: 'May', budget: 50000, spend: 18000 },
  { month: 'Jun', budget: 50000, spend: 22000 },
];

const MOCK_SPEND_CATEGORY = [
  { name: 'Flight', value: 45000 },
  { name: 'Hotel', value: 30000 },
  { name: 'Food', value: 12000 },
  { name: 'Transport', value: 8000 },
];
const COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6'];

export default function ManagerDashboard() {
  useSetPageTitle('Home');
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const [rows, setRows] = useState([]);
  const [travelRows, setTravelRows] = useState([]);
  const [teamTrips, setTeamTrips] = useState([]);
  
  // Analytics state
  const [teamSpendData, setTeamSpendData] = useState([]);
  const [spendCategoryData, setSpendCategoryData] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reimbursementApi.pendingApprovals();
      setRows(res.data || []);
      
      const resp = await reimbursementApi.travelRequestsManagerPending();
      setTravelRows(resp.data || []);
      
      const tripsResp = await reimbursementApi.travelRequestsTeamCalendar();
      setTeamTrips(tripsResp.data || []);
      
      // Fetch analytics
      const analyticsRes = await reimbursementApi.managerAnalytics();
      if (analyticsRes.data) {
        setTeamSpendData(analyticsRes.data.spend_by_month || []);
        setSpendCategoryData(analyticsRes.data.spend_by_category || []);
      }
    } catch {
      // Ignore errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { run: approve, loading: acting } = useAsyncAction(async (claimId) => {
    await reimbursementApi.approveClaim(claimId, { comment: '' });
    showToast('Claim approved.', 'success');
    await load();
  });

  const { run: approveTravel, loading: actingTravel } = useAsyncAction(async (requestId) => {
    await reimbursementApi.travelApprove(requestId);
    showToast('Travel request approved.', 'success');
    await load();
  });

  const topFive = rows.slice(0, 5);
  const topFiveTravel = travelRows.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">
          Welcome back, {firstName}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Top approvals with SLA countdown — open the pending queue for the full backlog.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="stat-card">
          <div className="stat-card-icon bg-brand">
            <FileText className="h-5 w-5" />
          </div>
          <div className="stat-card-label">Pending Claims</div>
          <div className="stat-card-value">{loading ? '—' : rows.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-amber-500">
            <Plane className="h-5 w-5" />
          </div>
          <div className="stat-card-label">Pending Travel</div>
          <div className="stat-card-value">{loading ? '—' : travelRows.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon bg-sky-500">
            <Calendar className="h-5 w-5" />
          </div>
          <div className="stat-card-label">Upcoming Team Trips</div>
          <div className="stat-card-value">{loading ? '—' : teamTrips.length}</div>
        </div>
      </div>

      {/* Interactive Analytics */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="panel overflow-hidden p-5 flex flex-col h-80">
          <h3 className="text-[15px] font-bold text-ink mb-4">Team Spend vs. Budget</h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={teamSpendData.length ? teamSpendData : MOCK_TEAM_SPEND} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(val) => `₹${val / 1000}k`} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Bar dataKey="budget" name="Budget" fill="#cbd5e1" radius={[4, 4, 0, 0]} animationDuration={1000} />
                <Bar dataKey="spend" name="Spend" fill="#10b981" radius={[4, 4, 0, 0]} animationDuration={1000} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel overflow-hidden p-5 flex flex-col h-80">
          <h3 className="text-[15px] font-bold text-ink mb-4">Spend by Category (YTD)</h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={spendCategoryData.length ? spendCategoryData : MOCK_SPEND_CATEGORY}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  animationDuration={1000}
                >
                  {(spendCategoryData.length ? spendCategoryData : MOCK_SPEND_CATEGORY).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `₹${value.toLocaleString()}`} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend iconType="circle" layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Pending Claims table */}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h3 className="text-[15px] font-bold text-ink">Pending Claims</h3>
          <Link className="flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/claims/pending">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-5 py-3">Reference</th>
                <th className="px-5 py-3">Employee</th>
                <th className="px-5 py-3">Trip</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3">SLA</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : null}
              {!loading && !topFive.length ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No pending claims — you&apos;re caught up!</td></tr>
              ) : null}
              {topFive.map((row) => (
                <tr key={row.claim_id} className="border-b border-slate-50 last:border-none hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-3.5 font-bold text-ink">{row.claim_reference}</td>
                  <td className="px-5 py-3.5 font-medium text-slate-700">{row.employee_label}</td>
                  <td className="max-w-[220px] truncate px-5 py-3.5 text-xs text-slate-500">{row.trip_summary}</td>
                  <td className="px-5 py-3.5 font-bold text-ink">₹{row.amount}</td>
                  <td className="px-5 py-3.5">
                    <div className={`inline-flex items-center gap-1.5 text-xs font-semibold ${slaClass(row.sla_bucket)}`}>
                      <Clock size={13} className="shrink-0" />
                      <span>{row.sla_remaining_label}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      type="button"
                      disabled={acting}
                      className={`inline-flex items-center gap-1 rounded-lg bg-brand/10 border border-brand/20 px-3 py-1.5 text-xs font-bold text-brand hover:bg-brand/15 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm ${acting ? 'animate-morph' : ''}`}
                      onClick={() => approve(row.claim_id)}
                    >
                      <Check size={13} />
                      <span>Approve</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending Travel Requests */}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h3 className="text-[15px] font-bold text-ink">Pending Travel Requests</h3>
          <Link className="flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline" to="/claims/pending">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-5 py-3">Employee</th>
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Route</th>
                <th className="px-5 py-3">Mode</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : null}
              {!loading && !topFiveTravel.length ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No pending travel requests — you&apos;re caught up!</td></tr>
              ) : null}
              {topFiveTravel.map((item) => (
                <tr key={item.request.id} className="border-b border-slate-50 last:border-none hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-700">{item.employee_display_name}</td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {item.request.trip_type === 'MULTI_CITY' && item.request.legs?.length > 0 ? item.request.legs[0].travel_date : item.request.travel_date}
                  </td>
                  <td className="px-5 py-3.5 text-ink">
                    {item.request.trip_type === 'MULTI_CITY' && item.request.legs && item.request.legs.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {item.request.legs.map((leg, i) => (
                          <div key={i} className="flex items-center gap-1 text-[11px]">
                            <span>{leg.from_city}</span>
                            <span className="text-slate-400 font-normal">→</span>
                            <span>{leg.to_city}</span>
                          </div>
                        ))}
                        <div className="mt-0.5"><span className="inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Multi City</span></div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span>{item.request.from_city}</span>
                        <span className="text-slate-400 font-normal">→</span>
                        <span>{item.request.to_city}</span>
                        {item.request.trip_type === 'ROUND_TRIP' && (
                          <span className="ml-1 inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Round Trip</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">{item.request.travel_mode}</td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      type="button"
                      disabled={actingTravel}
                      className={`inline-flex items-center gap-1 rounded-lg bg-brand/10 border border-brand/20 px-3 py-1.5 text-xs font-bold text-brand hover:bg-brand/15 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm ${actingTravel ? 'animate-morph' : ''}`}
                      onClick={() => approveTravel(item.request.id)}
                    >
                      <Check size={13} />
                      <span>Approve</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Team Travel Calendar */}
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-[15px] font-bold text-ink">Team Travel Calendar</h3>
          <p className="text-xs text-slate-400 mt-0.5">Upcoming confirmed trips for your reporting team.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-5 py-3">Employee</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Route</th>
                <th className="px-5 py-3">Mode</th>
                <th className="px-5 py-3">Reference</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : null}
              {!loading && !teamTrips.length ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center space-y-2 animate-float">
                    <Calendar className="w-8 h-8 opacity-50" />
                    <span>No upcoming team travel confirmed.</span>
                  </div>
                </td></tr>
              ) : null}
              {teamTrips.map((trip) => (
                <tr key={trip.id} className="border-b border-slate-50 last:border-none hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-700">{trip.employee_name}</td>
                  <td className="px-5 py-3.5 text-slate-500">{trip.travel_date}</td>
                  <td className="px-5 py-3.5 text-ink">{trip.route}</td>
                  <td className="px-5 py-3.5">
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      {trip.mode}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[11px] text-slate-400">{trip.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
