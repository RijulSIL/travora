import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import PageHeader from '../components/ui/PageHeader';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import { useSetPageTitle } from '../context/PageTitleContext';
import { reimbursementApi } from '../services/reimbursementApi';
import { formatExceptionTypes, formatRole } from '../utils/formatters';

const DECISION_STATUS_STYLES = {
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  REJECTED: 'bg-red-50 text-red-700 ring-red-600/20',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  AWAITING: 'bg-slate-100 text-slate-500 ring-slate-500/20',
};

function DecisionStatusPill({ status }) {
  const style = DECISION_STATUS_STYLES[status] || DECISION_STATUS_STYLES.AWAITING;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${style}`}>
      {status ? status.charAt(0) + status.slice(1).toLowerCase() : 'Awaiting'}
    </span>
  );
}

const fmtMoney = (val) =>
  Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cellColor(value, maxValue) {
  if (!value) return 'bg-white';
  const ratio = maxValue ? value / maxValue : 0;
  if (ratio < 0.4) return 'bg-amber-100';
  if (ratio < 0.75) return 'bg-amber-300';
  return 'bg-red-300';
}

export default function ComplianceDashboard() {
  useSetPageTitle('Compliance');
  const [filters, setFilters] = useState({ from_date: '', to_date: '', department: '', status: '', exception_type: '' });
  const [violations, setViolations] = useState({ departments: [], categories: [], matrix: {}, violations: [] });
  const [exceptionRows, setExceptionRows] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [expandedException, setExpandedException] = useState(null);
  const didInitialLoad = useRef(false);

  const load = useCallback(async () => {
    const reportParams = {};
    if (filters.from_date) reportParams.from_date = filters.from_date;
    if (filters.to_date) reportParams.to_date = filters.to_date;
    if (filters.department) reportParams.department = filters.department;
    const exceptionsParams = {};
    if (filters.from_date) exceptionsParams.from_date = filters.from_date;
    if (filters.to_date) exceptionsParams.to_date = filters.to_date;
    if (filters.status) exceptionsParams.status = filters.status;
    if (filters.exception_type) exceptionsParams.exception_type = filters.exception_type;
    const [violationsRes, exceptionsRes] = await Promise.all([
      reimbursementApi.policyViolations(reportParams),
      reimbursementApi.exceptionRequestsLog(exceptionsParams),
    ]);
    setViolations(violationsRes.data || { departments: [], categories: [], matrix: {}, violations: [] });
    setExceptionRows(exceptionsRes.data || []);
  }, [filters]);

  useEffect(() => {
    if (didInitialLoad.current) return;
    didInitialLoad.current = true;
    load();
  }, [load]);

  const maxCount = useMemo(() => {
    let max = 0;
    violations.departments.forEach((dept) => {
      violations.categories.forEach((cat) => {
        max = Math.max(max, Number(violations.matrix?.[dept]?.[cat] || 0));
      });
    });
    return max;
  }, [violations]);

  const selectedViolations = useMemo(() => {
    if (!selectedCell) return [];
    return violations.violations.filter(
      (row) => row.department === selectedCell.department && row.category === selectedCell.category,
    );
  }, [selectedCell, violations]);

  useBodyScrollLock(Boolean(selectedCell));

  return (
    <>
      <PageHeader title="" />
      <section className="panel rounded p-4">
        <h2 className="mb-3 text-base font-semibold text-ink">Policy Violation Heatmap</h2>
        <div className="mb-3 grid gap-3 md:grid-cols-5">
          <input className="field" type="date" value={filters.from_date} onChange={(e) => setFilters({ ...filters, from_date: e.target.value })} />
          <input className="field" type="date" value={filters.to_date} onChange={(e) => setFilters({ ...filters, to_date: e.target.value })} />
          <input className="field" placeholder="Department" value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })} />
          <button className="btn-primary" type="button" onClick={load}>Apply Filters</button>
        </div>
        <div className="overflow-auto">
          <table className="min-w-[760px] text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left">Department</th>
                {violations.categories.map((cat) => (
                  <th key={cat} className="px-3 py-2 text-left">{cat}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {violations.departments.map((dept) => (
                <tr key={dept} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{dept}</td>
                  {violations.categories.map((cat) => {
                    const count = Number(violations.matrix?.[dept]?.[cat] || 0);
                    return (
                      <td key={`${dept}-${cat}`} className="px-3 py-2">
                        <button
                          type="button"
                          className={`w-full rounded px-2 py-2 text-left ${cellColor(count, maxCount)}`}
                          onClick={() => setSelectedCell({ department: dept, category: cat })}
                        >
                          {count}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel mt-4 rounded p-4">
        <h2 className="mb-3 text-base font-semibold text-ink">Exception Request Log</h2>
        <div className="mb-3 grid gap-3 md:grid-cols-5">
          <select className="field" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All status</option>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
          <input className="field" placeholder="Exception type" value={filters.exception_type} onChange={(e) => setFilters({ ...filters, exception_type: e.target.value })} />
          <button className="btn-primary" type="button" onClick={load}>Search</button>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Exception ID</th>
                <th className="px-3 py-2 text-left">Claim Ref</th>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Requested On</th>
                <th className="px-3 py-2 text-left">Decided By</th>
              </tr>
            </thead>
            <tbody>
              {exceptionRows.map((row) => (
                <Fragment key={row.exception_id}>
                  <tr
                    className="cursor-pointer border-t border-line hover:bg-slate-50"
                    onClick={() => setExpandedException(expandedException === row.exception_id ? null : row.exception_id)}
                  >
                    <td className="px-3 py-2 font-medium text-slate-700">
                      {row.exception_ref || `EXC-${String(row.exception_id).padStart(4, '0')}`}
                    </td>
                    <td className="px-3 py-2">{row.claim_ref || '—'}</td>
                    <td className="px-3 py-2">{row.employee || '-'}</td>
                    <td className="px-3 py-2">{formatExceptionTypes(row.exception_types, row.exception_type)}</td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{new Date(row.requested_on).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{row.decided_by || '-'}</td>
                  </tr>
                  {expandedException === row.exception_id ? (
                    <tr className="border-t border-line bg-slate-50">
                      <td colSpan={7} className="px-4 py-4">
                        <div className="space-y-3 text-sm">
                          <div>
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Description</span>
                            <p className="mt-0.5 text-slate-700">{row.description || '—'}</p>
                          </div>

                          <div>
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Required Approvers</span>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {(row.required_approvers || []).length ? (
                                row.required_approvers.map((role, idx) => (
                                  <span
                                    key={`${role}-${idx}`}
                                    className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-500/10"
                                  >
                                    {formatRole(role)}
                                  </span>
                                ))
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </div>
                          </div>

                          <div>
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Decisions</span>
                            <div className="mt-1.5 space-y-1.5">
                              {(row.decisions || []).length ? (
                                row.decisions.map((d, idx) => (
                                  <div
                                    key={`${d.required_role}-${idx}`}
                                    className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5"
                                  >
                                    <span className="text-sm font-medium text-slate-700">{formatRole(d.required_role)}</span>
                                    <DecisionStatusPill status={d.status} />
                                    {d.comment ? (
                                      <span className="text-xs italic text-slate-500">"{d.comment}"</span>
                                    ) : null}
                                  </div>
                                ))
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCell
        ? createPortal(
            <div
              className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/55 p-4 backdrop-blur-[1px]"
              onClick={() => setSelectedCell(null)}
            >
              <div
                className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
                  <h3 className="text-base font-bold text-ink">
                    Violations: {selectedCell.department} × {selectedCell.category}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSelectedCell(null)}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Close"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-5 text-sm">
                  {selectedViolations.map((row) => (
                    <div key={`${row.claim_id}-${row.employee_id}`} className="rounded-lg border border-line p-3">
                      <div className="font-medium text-slate-700">
                        Claim #{row.claim_id} | Employee {row.employee_id || '-'}
                      </div>
                      <div className="mt-1 text-slate-600">
                        Claimed ₹{fmtMoney(row.claimed)} / Cap ₹{fmtMoney(row.cap)} / Excess ₹{fmtMoney(row.excess)}
                      </div>
                    </div>
                  ))}
                  {selectedViolations.length === 0 ? (
                    <div className="text-slate-500">No violations in this cell.</div>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
