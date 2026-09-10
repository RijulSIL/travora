import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import PageHeader from '../components/ui/PageHeader';
import { useSetPageTitle } from '../context/PageTitleContext';
import { reimbursementApi } from '../services/reimbursementApi';
import { formatExceptionType } from '../utils/formatters';

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
                    <td className="px-3 py-2">{row.exception_id}</td>
                    <td className="px-3 py-2">{row.claim_ref || '-'}</td>
                    <td className="px-3 py-2">{row.employee || '-'}</td>
                    <td className="px-3 py-2">{formatExceptionType(row.exception_type)}</td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{new Date(row.requested_on).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{row.decided_by || '-'}</td>
                  </tr>
                  {expandedException === row.exception_id ? (
                    <tr className="border-t border-line bg-slate-50">
                      <td colSpan={7} className="px-3 py-2 text-xs">
                        <div>Description: {row.description || '-'}</div>
                        <div>Required Approvers: {(row.required_approvers || []).join(', ') || '-'}</div>
                        <div className="mt-1">
                          Decisions:{' '}
                          {(row.decisions || [])
                            .map((d) => `${d.required_role}:${d.status}${d.comment ? ` (${d.comment})` : ''}`)
                            .join(' | ') || '-'}
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

      {selectedCell ? (
        <div className="fixed inset-0 z-40 bg-slate-900/40" onClick={() => setSelectedCell(null)}>
          <div className="absolute right-0 top-0 h-full w-full max-w-xl overflow-auto bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-ink">
              Violations: {selectedCell.department} x {selectedCell.category}
            </h3>
            <div className="mt-3 space-y-2 text-sm">
              {selectedViolations.map((row) => (
                <div key={`${row.claim_id}-${row.employee_id}`} className="rounded border border-line p-2">
                  <div>Claim #{row.claim_id} | Employee {row.employee_id || '-'}</div>
                  <div>
                    Claimed ₹{fmtMoney(row.claimed)} / Cap ₹{fmtMoney(row.cap)} / Excess ₹{fmtMoney(row.excess)}
                  </div>
                </div>
              ))}
              {selectedViolations.length === 0 ? <div className="text-slate-500">No violations in this cell.</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
