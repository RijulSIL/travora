import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IndianRupee, ReceiptIndianRupee, TrendingUp, ArrowRight, ShieldAlert } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';
import { useAuthStore } from '../../store/authStore';

// Deeper/more saturated than the old palette (which read flat) — brand green always lands on
// whichever category is largest, since the backend already returns rows sorted by amount desc.
const CATEGORY_COLORS = [
  '#116149', '#2563eb', '#f59e0b', '#7c3aed', '#dc2626',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#64748b',
];

const RADIAN = Math.PI / 180;

// Percentage label drawn inside the slice itself, at the mid-radius of the donut ring. Skipped
// below 5% — at that size the text no longer fits cleanly and just clutters the chart; the
// legend/tooltip already cover it.
function renderCategorySliceLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700}>
      {`${Math.round(percent * 100)}%`}
    </text>
  );
}

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
  // Moved here from the full GST Dashboard page (FinanceGstPage.jsx) — this version has no
  // department/category/impact-level filters of its own, so it's always scoped to all time
  // (see the fetch below), not an arbitrary slice.
  const [spendByCategory, setSpendByCategory] = useState([]);
  const [categoryLoading, setCategoryLoading] = useState(true);
  // Synced between the pie slices and the legend rows — hovering either one highlights both and
  // swaps the donut's center label from the grand total to that category's own figure.
  const [activeCategory, setActiveCategory] = useState(null);

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
      setCategoryLoading(true);
      try {
        // All time, not month-to-date — matches Vendor Spend Analysis below. Month-to-date
        // looked "broken" right after any month rollover until enough new claims had actually
        // reached READY_FOR_PAYMENT/PAID this month (the only statuses this query counts).
        const res = await reimbursementApi.spendByCategory({});
        // amount comes back as a Decimal, which FastAPI/Pydantic serialize as a JSON string
        // (e.g. "3655.00") — recharts' Pie needs an actual number to compute slice angles from.
        if (!cancelled) setSpendByCategory((res.data || []).map((row) => ({ ...row, amount: Number(row.amount) })));
      } catch {
        if (!cancelled) setSpendByCategory([]);
      } finally {
        if (!cancelled) setCategoryLoading(false);
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
            <IndianRupee className="h-5 w-5" />
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
            <ReceiptIndianRupee className="h-5 w-5" />
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
          <div className="p-6 min-h-[250px]">
            {spendLoading ? (
              <div className="py-8 text-center text-sm text-slate-400">Loading spend data…</div>
            ) : !spend.length ? (
              <div className="py-8 text-center text-sm text-slate-400">No spend data found.</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, spend.length * 56)}>
                <BarChart data={spend} layout="vertical" margin={{ top: 0, right: 24, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis type="category" dataKey="travel_mode" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} width={80} />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value) => [`₹${fmtMoney(value)}`, 'Spend']}
                  />
                  <Bar dataKey="spend" name="Spend" fill="#116149" radius={[0, 4, 4, 0]} barSize={24} animationDuration={800} />
                </BarChart>
              </ResponsiveContainer>
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

      {/* Spend by Category — full width, matching every other section on this dashboard. */}
      <section className="panel rounded-2xl p-5">
        <h3 className="mb-1 text-[15px] font-bold text-ink">Spend by category</h3>
        <p className="mb-4 text-xs text-slate-500">
          What money is being spent on — Hotel, Software, Local Conveyance, etc. — classified from each invoice&apos;s
          extracted content, not just the filename. All time, same scope as Vendor Spend Analysis above.
        </p>
        {categoryLoading ? (
          <p className="text-sm text-slate-600">Loading spend by category…</p>
        ) : spendByCategory.length ? (() => {
          const categoryTotal = spendByCategory.reduce((sum, row) => sum + (row.amount || 0), 0);
          const activeEntry = spendByCategory.find((row) => row.category === activeCategory);
          const activePercent = activeEntry && categoryTotal > 0 ? ((activeEntry.amount / categoryTotal) * 100).toFixed(1) : null;
          // An even 50/50 split, not a fixed chart column + flexible remainder — the chart is
          // centered within its own half (not pinned to the half's left edge), and the legend is
          // one column like before, sized to its own content rather than stretched or split into
          // columns. items-center keeps both halves vertically centered against each other
          // regardless of which one is taller.
          return (
            <div className="grid items-center gap-6 md:grid-cols-2">
              <div className="relative flex w-full items-center justify-center">
                {/* Percentage radii (not literal pixels) so the donut scales with its container
                    instead of staying a fixed small size regardless of how much room it has. */}
                <ResponsiveContainer width="100%" height={400} className="max-w-[420px]">
                  <PieChart>
                    <Pie
                      data={spendByCategory}
                      dataKey="amount"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      innerRadius="50%"
                      outerRadius="85%"
                      label={renderCategorySliceLabel}
                      labelLine={false}
                      animationDuration={700}
                      animationEasing="ease-out"
                    >
                      {/* No paddingAngle — an actual angular gap (background showing through)
                          reads as broken/missing data on the thinnest slices (1.8%, 0.1%, 0.1%
                          here). A consistent white stroke on every slice gives a clean separator
                          line between categories without ever exposing empty space. */}
                      {spendByCategory.map((entry, index) => (
                        <Cell
                          key={entry.category}
                          fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                          stroke="#fff"
                          strokeWidth={activeCategory === entry.category ? 3 : 2}
                          opacity={activeCategory && activeCategory !== entry.category ? 0.4 : 1}
                          style={{ cursor: 'pointer', transition: 'opacity 150ms ease' }}
                          onMouseEnter={() => setActiveCategory(entry.category)}
                          onMouseLeave={() => setActiveCategory(null)}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [
                        `₹${fmtMoney(value)} (${categoryTotal > 0 ? ((value / categoryTotal) * 100).toFixed(1) : '0.0'}%)`,
                        name,
                      ]}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  {activeEntry ? (
                    <>
                      <span className="max-w-[140px] truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {activeEntry.category}
                      </span>
                      <span className="text-lg font-extrabold text-ink">₹{fmtMoney(activeEntry.amount)}</span>
                      <span className="text-xs text-slate-500">{activePercent}% of total</span>
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total Spend</span>
                      <span className="text-lg font-extrabold text-ink">₹{fmtMoney(categoryTotal)}</span>
                    </>
                  )}
                </div>
              </div>
              {/* w-full, no width cap — a grid item stretches to fill its whole cell by default
                  anyway, but spelling it out: each row's justify-between is meant to spread name
                  and amount across this entire half, not sit close together. max-h/overflow-y
                  DOES cap the height, roughly matching the chart's own 400px — without it, a
                  long category list (new ones appear over time as invoices get classified) just
                  keeps growing the whole card instead of scrolling, leaving the chart stranded
                  in a sea of blank space above/below it once there are many more rows than fit
                  next to the donut. */}
              <div className="flex max-h-[400px] w-full flex-col gap-1 overflow-y-auto pr-1 text-sm">
                {spendByCategory.map((row, index) => {
                  const pct = categoryTotal > 0 ? (row.amount / categoryTotal) * 100 : 0;
                  const isActive = activeCategory === row.category;
                  return (
                    <div
                      key={row.category}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors ${isActive ? 'bg-slate-50' : ''}`}
                      onMouseEnter={() => setActiveCategory(row.category)}
                      onMouseLeave={() => setActiveCategory(null)}
                    >
                      <span className="flex items-center gap-2 truncate text-slate-700">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
                        />
                        <span className={`truncate ${isActive ? 'font-semibold text-ink' : ''}`}>{row.category}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono font-semibold text-ink">₹{fmtMoney(row.amount)}</span>
                        <span className="block text-[10px] text-slate-400">{pct.toFixed(1)}%</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })() : (
          <p className="text-sm text-slate-600">No categorized spend found.</p>
        )}
      </section>
    </div>
  );
}
