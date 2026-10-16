import { Plane, Settings, Truck, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { adminApi } from '../../services/adminApi';
import { CLAIM_STAGE, TRAVEL_MODES, TRAVEL_STATUS, allRows } from '../reports/statusPalette';
import { TipBody, useFloatingTip } from '../ui/FloatingTip';
import { reimbursementApi } from '../../services/reimbursementApi';
import { formatRole } from '../../utils/formatters';
import {
  BarList,
  ColumnBars,
  DateBox,
  Donut,
  Panel,
  PanelNote,
  SectionTitle,
  StatStrip,
  dayOf,
  inr,
  inr0,
  plural,
  today,
} from './HomeParts';

/*
 * The role part of Home, below the viewer's own claims and travel. Each section loads its own
 * data and is shown by HomeDashboard only when the viewer has the permission behind it.
 */

const COLORS = ['#0F6B52', '#2563eb', '#f59e0b', '#7c3aed', '#dc2626', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#64748b'];

function useLoad(load, deps = []) {
  const [state, setState] = useState({ loading: true, data: null });
  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => !cancelled && setState({ loading: false, data }))
      .catch(() => !cancelled && setState({ loading: false, data: null }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

const titleCase = (value) =>
  String(value || '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');

/* ------------------------------------------------------------------ team */

/** Manager: confirmed team trips coming up, and team spend for the last six months. */
export function TeamSection({ showCalendar, showSpend }) {
  const calendar = useLoad(() => (showCalendar ? reimbursementApi.travelRequestsTeamCalendar().then((r) => r.data || []) : Promise.resolve([])), [showCalendar]);
  const spend = useLoad(() => (showSpend ? reimbursementApi.managerAnalytics().then((r) => r.data) : Promise.resolve(null)), [showSpend]);

  const now = today();
  const trips = (calendar.data || [])
    .map((t) => ({ ...t, date: dayOf(t.travel_date) }))
    .filter((t) => t.date && t.date >= now)
    .sort((a, b) => a.date - b.date)
    .slice(0, 5);
  const months = (spend.data?.spend_by_month || []).map((m) => ({ label: m.month, value: Number(m.spend || 0) }));
  const total = months.reduce((a, m) => a + m.value, 0);
  const budget = spend.data?.budgets_enabled && spend.data?.team_monthly_budget ? Number(spend.data.team_monthly_budget) : null;

  return (
    <>
      <SectionTitle title="Your team" note="People who report to you" />
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        {showCalendar ? (
          <Panel title="Team travel" sub="Confirmed trips coming up for people who report to you">
            {calendar.loading ? <PanelNote>Loading team trips…</PanelNote> : null}
            {!calendar.loading && !trips.length ? <PanelNote>No confirmed team trips coming up.</PanelNote> : null}
            {trips.map((t) => (
              <div key={t.id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-slate-100 px-4 py-[11px] first:border-t-0">
                <DateBox date={t.date} now={t.date.getTime() === now.getTime()} />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-extrabold text-ink">{String(t.route || '').replace('->', '→')}</div>
                  <div className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
                    <Plane size={13} className="flex-none" />
                    <span className="truncate">
                      {t.employee_name} · {titleCase(t.mode)}
                      {t.reference ? ` · ${t.reference}` : ''}
                    </span>
                  </div>
                </div>
                <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Booked</span>
              </div>
            ))}
          </Panel>
        ) : null}
        {showSpend ? (
          <Panel
            title="Team spend"
            sub={`Claimed by your team, last ${months.length || 6} months · ${inr(total)} in total${budget ? ` · budget ${inr0(budget)}/month` : ''}`}
            link={{ to: '/team/spend', label: 'Team spend' }}
          >
            {spend.loading ? <PanelNote>Loading team spend…</PanelNote> : months.length ? <ColumnBars points={months} /> : <PanelNote>No team spend yet.</PanelNote>}
          </Panel>
        ) : null}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- finance */

function monthBounds() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = now.getMonth();
  return { from_date: `${y}-${pad(m + 1)}-01`, to_date: `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}` };
}

/** Finance desk: what's ready to pay (from the payment queue) and GST so far this month. */
export function FinanceSection({ paymentRows: queueRows }) {
  const gst = useLoad(() => reimbursementApi.gstSummary(monthBounds()).then((r) => r.data));
  // Same rows the Payment Queue page lists (it drops ones with no SLA bucket).
  const paymentRows = queueRows.filter((r) => r.sla_bucket != null);
  const now = new Date();
  const month = now.toLocaleString('en-IN', { month: 'short' });
  const range = `1–${now.getDate()} ${month}`;
  const toPay = paymentRows.reduce((a, r) => a + Number(r.net_payable ?? r.amount ?? 0), 0);
  const g = gst.data || {};
  const val = (v) => (gst.loading ? '—' : inr(v));
  return (
    <>
      <SectionTitle title="Money & tax" note="Company-wide" />
      <StatStrip
        label="Money and tax"
        cells={[
          {
            label: 'Ready to pay',
            value: inr(toPay),
            zero: !paymentRows.length,
            sub: (
              <>
                {plural(paymentRows.length, 'claim')} · <Link to="/finance/payment-queue">Payment queue</Link>
              </>
            ),
          },
          { label: `CGST · ${month} so far`, value: val(g.cgst), zero: !Number(g.cgst), sub: range },
          { label: `SGST · ${month} so far`, value: val(g.sgst), zero: !Number(g.sgst), sub: range },
          {
            label: `IGST · ${month} so far`,
            value: val(g.igst),
            zero: !Number(g.igst),
            sub: <Link to="/finance/gst-dashboard">GST dashboard</Link>,
          },
        ]}
      />
    </>
  );
}

/* ----------------------------------------------------------------- admin */

/** A readable line for an audit event. */
function describeAudit(e) {
  const v = e.new_value || {};
  switch (e.action) {
    case 'user_created_by_admin':
      return { icon: User, text: `Created user ${v.email || `#${e.entity_id}`}${v.role ? ` as ${formatRole(v.role)}` : ''}` };
    case 'update_permission_matrix_config':
      return { icon: Settings, text: 'Changed role permissions' };
    case 'update_workflow_config':
      return { icon: Settings, text: 'Changed the approval workflow' };
    case 'create':
      if (e.entity_type === 'relocation_request') {
        const route = [v.origin, v.destination].filter(Boolean).join(' → ');
        return { icon: Truck, text: `New relocation request REL-${String(e.entity_id).padStart(4, '0')}${route ? ` (${route})` : ''}` };
      }
      break;
    default:
      break;
  }
  const what = titleCase(e.entity_type);
  return { icon: Settings, text: `${titleCase(e.action)} · ${what} #${e.entity_id}` };
}

/** IT Admin: system snapshot and the latest audit events. */
export function AdminSection({ canSeeAudit }) {
  const stats = useLoad(() => adminApi.dashboardStats().then((r) => r.data));
  const audit = useLoad(() => (canSeeAudit ? adminApi.auditLogs().then((r) => (r.data || []).slice(0, 5)) : Promise.resolve([])), [canSeeAudit]);
  const names = useLoad(() =>
    adminApi
      .users({ limit: 200 })
      .then((r) => Object.fromEntries((r.data || []).map((u) => [u.id ?? u.user_id, u.full_name || u.email])))
      .catch(() => ({})),
  );
  const s = stats.data || {};
  const at = (iso) =>
    new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <>
      <SectionTitle title="System" />
      <StatStrip
        label="System"
        cells={[
          { label: 'Active policy', value: s.active_policy_version ? `v${s.active_policy_version}` : '—', sub: <Link to="/admin/policy-versions">Policy versions</Link> },
          { label: 'Employees', value: s.total_employees ?? '—', sub: <Link to="/admin/users">User management</Link> },
          { label: 'Impact levels', value: s.impact_level_count ?? '—', sub: <Link to="/admin/impact-levels">Impact levels</Link> },
          { label: 'Waiting at HR stage', value: s.pending_hrbp_approvals ?? '—', zero: !s.pending_hrbp_approvals, sub: 'claims' },
        ]}
      />
      {canSeeAudit ? (
        <Panel title="Recent changes" sub="From the tamper-evident audit log" link={{ to: '/admin/audit-logs', label: 'Audit log' }}>
          {audit.loading ? <PanelNote>Loading recent changes…</PanelNote> : null}
          {!audit.loading && !(audit.data || []).length ? <PanelNote>No audit events yet.</PanelNote> : null}
          {(audit.data || []).map((e) => {
            const { icon: Icon, text } = describeAudit(e);
            return (
              <div key={e.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-slate-100 text-slate-500">
                  <Icon size={15} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-ink">{text}</div>
                  <div className="text-xs text-slate-500">{(names.data || {})[e.actor_id] || (e.actor_id ? `User #${e.actor_id}` : 'System')}</div>
                </div>
                <div className="whitespace-nowrap text-xs text-slate-500">{at(e.timestamp)}</div>
              </div>
            );
          })}
        </Panel>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------- company reports */

/** Company-wide report charts, for anyone who can open Reports. */
export function CompanyReports() {
  const tip = useFloatingTip();
  const violations = useLoad(() => reimbursementApi.policyViolations({}).then((r) => r.data));
  const travel = useLoad(() => reimbursementApi.reportRun('travel-requests-summary', {}).then((r) => r.data?.rows || []));
  const claims = useLoad(() => reimbursementApi.reportRun('claim-aging', {}).then((r) => r.data?.rows || []));
  const modes = useLoad(() => reimbursementApi.reportRun('travel-spend-summary', {}).then((r) => r.data?.rows || []));
  const categories = useLoad(() => reimbursementApi.spendByCategory({}).then((r) => r.data || []));

  const v = violations.data || {};
  const departments = v.departments || [];
  const cats = v.categories || [];
  const excess = {};
  (v.violations || []).forEach((row) => {
    const key = `${row.department}|${row.category}`;
    excess[key] = (excess[key] || 0) + Number(row.excess || 0);
  });
  const catCounts = {};
  (v.violations || []).forEach((row) => {
    catCounts[row.category] = (catCounts[row.category] || 0) + 1;
  });
  const topViolations = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value, color: '#e11d48' }));

  // Every status / stage / mode is listed, with 0 when nothing is in it, so each chart always
  // shows the whole picture (and cards side by side stay a similar height).
  const travelRows = allRows(travel.data, 'status', 'count', TRAVEL_STATUS);
  const claimRows = allRows(claims.data, 'stage', 'count', CLAIM_STAGE, ['DRAFT']);
  const modeRows = allRows(modes.data, 'travel_mode', 'spend', TRAVEL_MODES);
  const slices = (categories.data || []).map((r, i) => ({ label: r.category, value: Number(r.amount || 0), color: COLORS[i % COLORS.length] }));
  const sum = (rows) => rows.reduce((a, r) => a + r.value, 0);

  return (
    <>
      <SectionTitle title="Company reports" note="Because you can open Reports" />
      <Panel title="Compliance heatmap" sub="Expense lines over the policy cap, by department and category" link={{ to: '/compliance', label: 'Compliance' }}>
        {violations.loading ? <PanelNote>Loading…</PanelNote> : null}
        {!violations.loading && !departments.length ? <PanelNote>No expense lines over the cap.</PanelNote> : null}
        {departments.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-slate-400">
                  <th className="px-4 py-2 text-left">Department</th>
                  {cats.map((c) => (
                    <th key={c} className="px-4 py-2 text-center">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-bold text-ink">{d}</td>
                    {cats.map((c) => {
                      const n = v.matrix?.[d]?.[c] || 0;
                      return n ? (
                        <td
                          key={c}
                          className="cursor-default bg-rose-50 px-4 py-2.5 text-center font-extrabold text-rose-700 hover:bg-rose-100"
                          {...tip.bind(
                            <TipBody title={`${d} · ${c}`} amount={inr(excess[`${d}|${c}`] || 0)} line={`over cap · ${plural(n, 'line')}`} note="Open Compliance for the details" />,
                          )}
                        >
                          {n} <span className="font-semibold text-slate-500">· {inr0(excess[`${d}|${c}`] || 0)} over</span>
                        </td>
                      ) : (
                        <td key={c} className="px-4 py-2.5 text-center text-slate-400">
                          –
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {tip.node}
      </Panel>
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <Panel title="Travel requests by status" sub={travel.loading ? '' : plural(sum(travelRows), 'request')} link={{ to: '/reports', label: 'Reports' }}>
          {travel.loading ? <PanelNote>Loading…</PanelNote> : sum(travelRows) ? <BarList rows={travelRows} of="of all travel requests" /> : <PanelNote>No travel requests yet.</PanelNote>}
        </Panel>
        <Panel title="Claims pipeline" sub={claims.loading ? '' : plural(sum(claimRows), 'submitted claim')} link={{ to: '/reports', label: 'Reports' }}>
          {claims.loading ? <PanelNote>Loading…</PanelNote> : sum(claimRows) ? <BarList rows={claimRows} of="of submitted claims" /> : <PanelNote>No submitted claims yet.</PanelNote>}
        </Panel>
        <Panel title="Travel spend by mode" sub="All time" link={{ to: '/reports', label: 'Reports' }}>
          {modes.loading ? <PanelNote>Loading…</PanelNote> : sum(modeRows) ? <BarList rows={modeRows} format={inr0} of="of travel spend" /> : <PanelNote>No travel spend yet.</PanelNote>}
        </Panel>
        <Panel title="Top policy violations" sub="Most often over the cap" link={{ to: '/compliance', label: 'Compliance' }}>
          {violations.loading ? (
            <PanelNote>Loading…</PanelNote>
          ) : topViolations.length ? (
            <BarList rows={topViolations} format={(n) => plural(n, 'line')} of="of over-cap lines" />
          ) : (
            <PanelNote>No violations.</PanelNote>
          )}
        </Panel>
      </div>
      <Panel title="Spend by category" sub="From each invoice’s extracted content · all time" link={{ to: '/reports', label: 'Reports' }}>
        {categories.loading ? <PanelNote>Loading…</PanelNote> : slices.length ? <Donut slices={slices} /> : <PanelNote>No spend yet.</PanelNote>}
      </Panel>
    </>
  );
}
