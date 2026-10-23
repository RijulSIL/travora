import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Clock, X } from 'lucide-react';

import { ApprovalChain, ChainMark, ExceptionSubject, Pill, Tabs, ago, inr, shortDay, shortType } from '../components/approvals/ApprovalQueueParts';
import { TipBody, useFloatingTip } from '../components/ui/FloatingTip';
import Pagination from '../components/ui/Pagination';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import { usePagination } from '../hooks/usePagination';
import { useSetPageTitle } from '../context/PageTitleContext';
import { reimbursementApi } from '../services/reimbursementApi';
import { describeExceptionType, formatRole } from '../utils/formatters';

/*
 * Compliance: where claims go over policy (GET reports/policy-violations — over-cap expenses by
 * department and category) and the exceptions people asked for (GET reports/exception-requests,
 * the whole log, filtered here by status and type). The period and department apply to both.
 */

const PERIODS = [
  ['month', 'This month'],
  ['3m', 'Last 3 months'],
  ['6m', 'Last 6 months'],
  ['year', 'This year'],
  ['all', 'All time'],
  ['custom', 'Custom'],
];
const STATUS_TABS = [
  ['all', 'All'],
  ['PENDING', 'Open'],
  ['APPROVED', 'Approved'],
  ['REJECTED', 'Rejected'],
  ['CANCELLED', 'Cancelled'],
];
const DECISION = {
  APPROVED: ['bg-emerald-600', '✓', (d) => `Approved${d.acted_by_name ? ` by ${d.acted_by_name}` : ''}`],
  REJECTED: ['bg-rose-600', '✕', (d) => `Rejected${d.acted_by_name ? ` by ${d.acted_by_name}` : ''}`],
  SLA_SKIPPED: ['bg-orange-600', 'skip', () => 'Missed its SLA, passed on'],
  PENDING: ['bg-amber-500', '●', () => 'Deciding now'],
  AWAITING: ['bg-slate-400', '', () => 'Still to come'],
};
const EMPTY_VIOLATIONS = { departments: [], categories: [], matrix: {}, violations: [] };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** from_date / to_date for the chosen period (YYYY-MM-DD, or '' for open). */
function periodDates(period, from, to) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = { month: new Date(y, m, 1), '3m': new Date(y, m - 2, 1), '6m': new Date(y, m - 5, 1), year: new Date(y, 0, 1) }[period];
  if (period === 'custom') return { from_date: from, to_date: to };
  return { from_date: start ? isoDay(start) : '', to_date: '' };
}

/** Cell colour by how far over cap it is, relative to the worst cell. */
function heatTone(excess, max) {
  const t = max ? excess / max : 0;
  if (t > 0.66) return 'bg-rose-200 text-rose-900';
  if (t > 0.33) return 'bg-orange-200 text-orange-900';
  return 'bg-amber-100 text-amber-900';
}

const card = 'overflow-hidden rounded-[14px] border border-slate-200 bg-white';

function CardHead({ title, sub }) {
  return (
    <div className="border-b border-slate-100 px-4 py-[13px]">
      <h2 className="text-sm font-extrabold text-ink">{title}</h2>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function Empty({ title, children }) {
  return (
    <div className="px-4 py-8 text-center text-[12.5px] text-slate-500">
      <b className="mb-0.5 block text-[13.5px] text-ink">{title}</b>
      {children}
    </div>
  );
}

const EYEBROW = 'mb-1.5 mt-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400';

/** Opened exception: what it means, the reason, and every decision with its comment. */
function ExceptionDetail({ row }) {
  const types = row.exception_types?.length ? row.exception_types : [row.exception_type];
  return (
    <div className="grid gap-4 bg-[#fbfdfc] px-4 pb-4 pt-1 md:grid-cols-2">
      <div>
        <p className={EYEBROW}>What this means</p>
        {types.map((type) => (
          <p key={type} className="mb-1.5 text-[12.5px] text-slate-700">
            <b className="text-ink">{shortType(type)}:</b> {describeExceptionType(type)}
          </p>
        ))}
        <p className={EYEBROW}>Reason from {(row.employee || 'the employee').split(' ')[0]}</p>
        <div className="border-l-[3px] border-slate-200 px-2.5 py-0.5 text-[12.5px] text-slate-700">{row.description || '—'}</div>
      </div>
      <div>
        <p className={EYEBROW}>Decisions</p>
        {(row.decisions || []).length ? (
          <ol>
            {row.decisions.map((d, i) => {
              const [dot, mark, text] = DECISION[d.status] || DECISION.AWAITING;
              const last = i === row.decisions.length - 1;
              return (
                <li key={`${d.required_role}-${i}`} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-2 pb-2.5 text-[12.5px]">
                  {!last ? <span className="absolute bottom-0 left-2 top-[18px] w-0.5 bg-slate-200" aria-hidden="true" /> : null}
                  <i className={`z-[1] grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] not-italic leading-none text-white ${dot}`}>
                    <ChainMark mark={mark} size={8} />
                  </i>
                  <div className="min-w-0">
                    <b className="block text-ink">{formatRole(d.required_role)}</b>
                    <span className="text-xs text-slate-500">
                      {text(d)}
                      {d.acted_at ? ` · ${shortDay(d.acted_at)}` : ''}
                    </span>
                    {d.comment ? <div className="mt-1 border-l-[3px] border-slate-200 px-2.5 py-0.5 text-[12.5px] text-slate-700">{d.comment}</div> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <span className="text-[12.5px] text-slate-500">—</span>
        )}
      </div>
    </div>
  );
}

export default function ComplianceDashboard() {
  useSetPageTitle('Compliance');
  const [filters, setFilters] = useState({ period: 'all', from: '', to: '', department: '' });
  const [violations, setViolations] = useState(EMPTY_VIOLATIONS);
  const [departments, setDepartments] = useState([]);
  const [exceptionRows, setExceptionRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const tooltip = useFloatingTip();
  useBodyScrollLock(Boolean(selectedCell));

  const { from_date: fromDate, to_date: toDate } = periodDates(filters.period, filters.from, filters.to);

  // Both reports follow the period; the violations report also takes the department. The whole
  // exception log is loaded once per period and split by status / type on the page — asking the
  // server for status=PENDING would return only the requests this viewer can act on.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const dates = {};
    if (fromDate) dates.from_date = fromDate;
    if (toDate) dates.to_date = toDate;
    try {
      const [violationsRes, exceptionsRes] = await Promise.all([
        reimbursementApi.policyViolations({ ...dates, ...(filters.department ? { department: filters.department } : {}) }),
        reimbursementApi.exceptionRequestsLog(dates),
      ]);
      const data = violationsRes.data || EMPTY_VIOLATIONS;
      setViolations(data);
      // The department list comes from an unfiltered answer, so picking one doesn't shrink it.
      if (!filters.department) setDepartments(data.departments || []);
      setExceptionRows(exceptionsRes.data || []);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Could not load compliance data');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, filters.department]);

  useEffect(() => {
    load();
  }, [load]);

  // The violations report only has ids; the exception log knows the claim reference and name.
  const claimRefs = useMemo(() => {
    const map = {};
    exceptionRows.forEach((r) => {
      if (r.claim_id && r.claim_ref) map[r.claim_id] = r.claim_ref;
    });
    return map;
  }, [exceptionRows]);
  const names = useMemo(() => {
    const map = {};
    exceptionRows.forEach((r) => {
      if (r.employee_id && r.employee) map[r.employee_id] = r.employee;
    });
    return map;
  }, [exceptionRows]);
  const claimLabel = (row) => claimRefs[row.claim_id] || `Claim #${row.claim_id}`;
  const personLabel = (row) => names[row.employee_id] || (row.employee_id ? `Employee ${row.employee_id}` : 'Unknown');

  const rows = violations.violations || [];
  const totalExcess = rows.reduce((s, r) => s + Number(r.excess || 0), 0);
  const cellRows = (dept, cat) => rows.filter((r) => (r.department || 'Unknown') === dept && r.category === cat);
  const maxCellExcess = Math.max(
    ...violations.departments.flatMap((d) => violations.categories.map((c) => cellRows(d, c).reduce((s, r) => s + Number(r.excess || 0), 0))),
    0,
  );
  const overruns = [...rows].sort((a, b) => Number(b.excess) - Number(a.excess));

  const counts = { all: exceptionRows.length, PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
  exceptionRows.forEach((r) => {
    if (counts[r.status] != null) counts[r.status] += 1;
  });
  const typesInLog = [...new Set(exceptionRows.flatMap((r) => (r.exception_types?.length ? r.exception_types : [r.exception_type])))].filter(Boolean);
  const shown = useMemo(
    () =>
      exceptionRows
        .filter((r) => (tab === 'all' || r.status === tab) && (!typeFilter || (r.exception_types?.length ? r.exception_types : [r.exception_type]).includes(typeFilter)))
        .sort((a, b) => new Date(b.requested_on) - new Date(a.requested_on)),
    [exceptionRows, tab, typeFilter],
  );
  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(shown);
  useEffect(() => {
    setPage(1);
  }, [tab, typeFilter, fromDate, toDate, setPage]);

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const selectBox = (on) =>
    `inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-bold text-slate-500 ${on ? 'border-brand bg-brand/[0.04]' : 'border-slate-200 bg-white'}`;
  const selectInput = 'max-w-[220px] bg-transparent text-[12.5px] font-semibold text-ink outline-none';
  const selectedRows = selectedCell ? cellRows(selectedCell.department, selectedCell.category) : [];
  const statusPill = (r) => {
    if (r.status === 'PENDING') {
      const current = (r.decisions || []).find((d) => d.status === 'PENDING');
      return <Pill tone="amber">With {current ? formatRole(current.required_role) : 'an approver'}</Pill>;
    }
    if (r.status === 'APPROVED') return <Pill tone="ok">Approved</Pill>;
    if (r.status === 'REJECTED') return <Pill tone="rose">Rejected</Pill>;
    return <Pill title={r.decision_comment || undefined}>Cancelled</Pill>;
  };

  return (
    <section className="flex flex-col gap-3.5">
      <div>
        <h1 className="text-xl font-extrabold text-ink">Compliance</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">Where claims go over policy, and the exceptions people asked for.</p>
      </div>

      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
        <div role="group" aria-label="Period" className="inline-flex flex-wrap gap-0.5 rounded-[10px] bg-slate-100 p-[3px]">
          {PERIODS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters.period === key}
              onClick={() => setFilter('period', key)}
              className={`rounded-[7px] px-2.5 py-[5px] text-xs font-bold ${filters.period === key ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {filters.period === 'custom' ? (
          <>
            <label className={selectBox(true)}>
              From
              <input type="date" className={selectInput} value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
            </label>
            <label className={selectBox(true)}>
              To
              <input type="date" className={selectInput} value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
            </label>
          </>
        ) : null}
        <label className={selectBox(filters.department)}>
          Department
          <select className={selectInput} value={filters.department} onChange={(e) => setFilter('department', e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[13px] text-amber-900">{error}</div> : null}
      {loading && !exceptionRows.length && !rows.length ? (
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
          <Clock className="animate-spin text-slate-400" size={15} /> Loading compliance data…
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <div className="rounded-[14px] border border-slate-200 bg-white px-3.5 py-3">
          <div className="text-[11.5px] font-bold text-slate-500">Expenses over their cap</div>
          <div className="mt-[3px] text-xl font-semibold text-rose-700">{rows.length}</div>
          <div className="mt-0.5 text-[11.5px] text-slate-500">in {plural(new Set(rows.map((r) => r.claim_id)).size, 'claim')}</div>
        </div>
        <div className="rounded-[14px] border border-slate-200 bg-white px-3.5 py-3">
          <div className="text-[11.5px] font-bold text-slate-500">Over cap in total</div>
          <div className="mt-[3px] font-mono text-lg font-semibold tabular-nums text-rose-700 sm:text-xl">{inr(totalExcess)}</div>
          <div className="mt-0.5 text-[11.5px] text-slate-500">claimed above the caps</div>
        </div>
        <div className="rounded-[14px] border border-slate-200 bg-white px-3.5 py-3">
          <div className="text-[11.5px] font-bold text-slate-500">Exceptions asked for</div>
          <div className="mt-[3px] text-xl font-semibold text-ink">{counts.all}</div>
          <div className="mt-0.5 text-[11.5px] text-slate-500">{counts.PENDING} still open</div>
        </div>
        <div className="rounded-[14px] border border-slate-200 bg-white px-3.5 py-3">
          <div className="text-[11.5px] font-bold text-slate-500">How they ended</div>
          <div className="mt-1.5 text-[11.5px] text-slate-500">
            <b className="text-emerald-700">{counts.APPROVED}</b> approved · <b className="text-rose-700">{counts.REJECTED}</b> rejected ·{' '}
            <b className="text-amber-700">{counts.PENDING}</b> open{counts.CANCELLED ? ` · ${counts.CANCELLED} cancelled` : ''}
          </div>
          <div
            className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100"
            {...tooltip.bind(
              <TipBody
                title="Exceptions"
                line={`${counts.APPROVED} approved · ${counts.REJECTED} rejected · ${counts.PENDING} still open${counts.CANCELLED ? ` · ${counts.CANCELLED} cancelled` : ''}`}
              />,
            )}
          >
            {[
              ['APPROVED', 'bg-emerald-600'],
              ['REJECTED', 'bg-rose-600'],
              ['PENDING', 'bg-amber-500'],
              ['CANCELLED', 'bg-slate-400'],
            ].map(([key, color]) =>
              counts[key] ? <i key={key} className={`block h-full ${color}`} style={{ width: `${(counts[key] / Math.max(counts.all, 1)) * 100}%` }} /> : null,
            )}
          </div>
        </div>
      </div>

      <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className={`${card} flex flex-col`} aria-label="Where it goes over">
          <CardHead title="Where it goes over" sub="Over-cap expenses by department and category · click a cell" />
          {rows.length ? (
            <>
              <div className="overflow-x-auto px-4 pb-4 pt-3.5">
                <table className="min-w-full border-separate [border-spacing:6px]">
                  <thead>
                    <tr>
                      <th />
                      {violations.categories.map((c) => (
                        <th key={c} className="whitespace-nowrap px-0.5 text-left text-[11px] font-bold text-slate-500">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {violations.departments.map((dept) => (
                      <tr key={dept}>
                        <td className="whitespace-nowrap pr-1.5 text-[12.5px] font-bold text-ink">{dept}</td>
                        {violations.categories.map((cat) => {
                          const list = cellRows(dept, cat);
                          const excess = list.reduce((s, r) => s + Number(r.excess || 0), 0);
                          if (!list.length) {
                            return (
                              <td key={cat}>
                                <div className="min-w-[104px] rounded-[10px] bg-slate-50 px-2.5 py-[9px] text-slate-400">
                                  <b className="block text-[15px]">0</b>
                                  <span className="text-[11px] font-semibold">—</span>
                                </div>
                              </td>
                            );
                          }
                          return (
                            <td key={cat}>
                              <button
                                type="button"
                                className={`w-full min-w-[104px] rounded-[10px] px-2.5 py-[9px] text-left ${heatTone(excess, maxCellExcess)}`}
                                onClick={() => {
                                  tooltip.hide();
                                  setSelectedCell({ department: dept, category: cat });
                                }}
                                {...tooltip.bind(
                                  <TipBody title={`${dept} · ${cat}`} amount={inr(excess)} line={`over cap · ${plural(list.length, 'expense')}`} note="Click to see them" />,
                                )}
                              >
                                <b className="block text-[15px]">{list.length}</b>
                                <span className="font-mono text-[11px] font-semibold">{inr(excess)} over</span>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2.5 px-4 pb-3.5 text-[11px] text-slate-500">
                Colour = how far over cap:
                <span><i className="mr-1 inline-block h-2.5 w-3.5 rounded-[3px] bg-amber-100 align-[-1px]" />a little</span>
                <span><i className="mr-1 inline-block h-2.5 w-3.5 rounded-[3px] bg-orange-200 align-[-1px]" />more</span>
                <span><i className="mr-1 inline-block h-2.5 w-3.5 rounded-[3px] bg-rose-200 align-[-1px]" />the most</span>
              </div>
            </>
          ) : (
            <Empty title="Nothing over cap">No expense went over its cap for these filters.</Empty>
          )}
        </section>

        <section className={card} aria-label="Biggest overruns">
          <CardHead title="Biggest overruns" sub="Each over-cap expense, largest first" />
          {overruns.length ? (
            overruns.map((r, i) => {
              const claimed = Number(r.claimed || 0);
              const cap = Number(r.cap || 0);
              const scale = Math.max(claimed, cap, 1);
              return (
                <button
                  key={`${r.claim_id}-${r.category}-${i}`}
                  type="button"
                  onClick={() => {
                    tooltip.hide();
                    setSelectedCell({ department: r.department || 'Unknown', category: r.category });
                  }}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 border-t border-slate-100 px-4 py-[11px] text-left text-[13px] text-slate-700 first:border-t-0 hover:bg-[#fbfdfc]"
                  {...tooltip.bind(
                    <TipBody
                      title={`${claimLabel(r)} · ${r.category}`}
                      line={`Claimed ${inr(claimed)} against a cap of ${inr(cap)}`}
                      note={cap ? `${(claimed / cap).toFixed(1)}× the cap` : undefined}
                    />,
                  )}
                >
                  <div className="min-w-0">
                    <b className="text-ink">{claimLabel(r)}</b> · {r.category}
                    <div className="text-xs text-slate-500">
                      {personLabel(r)} · {r.department || 'Unknown'} · claimed {inr(claimed)} vs cap {inr(cap)}
                    </div>
                  </div>
                  <span className="self-start">
                    <Pill tone="rose">+{inr(r.excess)}</Pill>
                  </span>
                  <span className="relative col-span-2 h-[7px] rounded-full bg-slate-100" aria-hidden="true">
                    <i className="absolute inset-y-0 left-0 rounded-full bg-rose-600" style={{ width: `${(claimed / scale) * 100}%` }} />
                    <u className="absolute -bottom-[3px] -top-[3px] w-0.5 bg-ink/55" style={{ left: `${(cap / scale) * 100}%` }} />
                  </span>
                </button>
              );
            })
          ) : (
            <Empty title="Nothing over cap">for these filters.</Empty>
          )}
        </section>
      </div>

      <section className={card} aria-label="Exception log">
        <CardHead title="Exception log" sub="Every exception asked for in the period, newest first" />
        <div className="px-3">
          <Tabs
            label="Status"
            value={tab}
            onChange={(key) => {
              setTab(key);
              setExpanded(null);
            }}
            tabs={STATUS_TABS.map(([key, label]) => ({ key, label, count: counts[key] }))}
          />
        </div>
        <div className="border-b border-slate-100 px-4 py-2.5">
          <label className={selectBox(typeFilter)}>
            Type
            <select className={selectInput} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {typesInLog.map((t) => (
                <option key={t} value={t}>{shortType(t)}</option>
              ))}
            </select>
          </label>
        </div>
        {!loading && !shown.length ? <Empty title="Nothing here">Try another tab or a longer period.</Empty> : null}
        {pageItems.map((row) => {
          const open = expanded === row.exception_id;
          const types = row.exception_types?.length ? row.exception_types : [row.exception_type];
          const toggle = () => setExpanded(open ? null : row.exception_id);
          return (
            <div key={row.exception_id} className="border-t border-slate-100 first:border-t-0">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={(e) => {
                  if (e.target.closest('a')) return;
                  toggle();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                  }
                }}
                className="grid cursor-pointer gap-x-3.5 gap-y-2.5 px-4 py-3 hover:bg-[#fbfdfc] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_170px] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold text-ink">
                    <span>{row.exception_ref || `EXC-${String(row.exception_id).padStart(4, '0')}`}</span>
                    {types.map((t) => (
                      <Pill key={t}>{shortType(t)}</Pill>
                    ))}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {row.employee || '—'}
                    {row.requested_on ? ` · requested ${ago(row.requested_on)}` : ''}
                  </div>
                  {row.description ? <div className="mt-1 break-words text-xs italic text-slate-700">“{row.description}”</div> : null}
                </div>
                <div className="min-w-0">
                  <ExceptionSubject row={row} />
                  <div className="mt-1.5">
                    <ApprovalChain decisions={row.decisions || []} />
                  </div>
                </div>
                <div className="lg:text-right">
                  {statusPill(row)}
                  {row.decided_by && row.status !== 'PENDING' ? <span className="mt-1 block text-[11.5px] text-slate-500">by {row.decided_by}</span> : null}
                </div>
              </div>
              {open ? <ExceptionDetail row={row} /> : null}
            </div>
          );
        })}
        {shown.length ? (
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
        ) : null}
      </section>

      {selectedCell
        ? createPortal(
            <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/45 p-4" onClick={() => setSelectedCell(null)}>
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`${selectedCell.department} · ${selectedCell.category}`}
                className="flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-[13px]">
                  <div>
                    <h3 className="text-sm font-extrabold text-ink">
                      {selectedCell.department} · {selectedCell.category}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">{plural(selectedRows.length, 'expense')} over cap</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setSelectedCell(null)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="overflow-y-auto">
                  {selectedRows.map((r, i) => (
                    <div key={`${r.claim_id}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-slate-100 px-4 py-[11px] first:border-t-0">
                      <div className="min-w-0">
                        <Link to={`/claims/${r.claim_id}`} className="text-[13px] font-bold text-brand hover:underline">
                          {claimLabel(r)} ↗
                        </Link>
                        <div className="text-xs text-slate-500">
                          {personLabel(r)} · claimed {inr(r.claimed)} vs cap {inr(r.cap)}
                        </div>
                      </div>
                      <Pill tone="rose">+{inr(r.excess)}</Pill>
                    </div>
                  ))}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {tooltip.node}
    </section>
  );
}
