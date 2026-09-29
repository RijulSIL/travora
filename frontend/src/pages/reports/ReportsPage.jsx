import { useEffect, useMemo, useState } from 'react';

import Pagination from '../../components/ui/Pagination';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { usePagination } from '../../hooks/usePagination';
import { reimbursementApi } from '../../services/reimbursementApi';

const REPORT_TYPES = [
  { value: 'claim-aging', label: 'Claim Aging' },
  { value: 'approval-tat', label: 'Approval TAT' },
  { value: 'travel-spend-summary', label: 'Travel Spend Summary' },
  { value: 'travel-requests-summary', label: 'Travel Requests Summary' },
];

export default function ReportsPage() {
  useSetPageTitle('Reports');
  const [tab, setTab] = useState('run');
  const [reportType, setReportType] = useState('claim-aging');
  const [filters, setFilters] = useState({
    from_date: '',
    to_date: '',
    department: '',
    employee_level: '',
    office_location: '',
    expense_category: '',
  });
  const [rows, setRows] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    report_type: 'claim-aging',
    report_format: 'CSV',
    frequency: 'DAILY',
    recipients: '',
  });

  const getCleanFilters = () => {
    const clean = {};
    for (const [k, v] of Object.entries(filters)) {
      if (v !== '' && v !== null && v !== undefined) {
        clean[k] = v;
      }
    }
    return clean;
  };

  const runReport = async () => {
    const res = await reimbursementApi.reportRun(reportType, getCleanFilters());
    setRows(res.data?.rows || []);
  };

  const exportCsv = async () => {
    const res = await reimbursementApi.reportExportCsv(reportType, getCleanFilters());
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportXlsx = async () => {
    const res = await reimbursementApi.reportExportXlsx(reportType, getCleanFilters());
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportType}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    const res = await reimbursementApi.reportExportPdf(reportType, getCleanFilters());
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportType}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadSchedules = async () => {
    const res = await reimbursementApi.reportSchedules();
    setSchedules(res.data || []);
  };

  useEffect(() => {
    if (tab === 'scheduled') loadSchedules();
  }, [tab]);

  const createSchedule = async () => {
    const recipients = scheduleForm.recipients
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await reimbursementApi.createReportSchedule({
      report_type: scheduleForm.report_type,
      report_format: 'CSV',
      frequency: scheduleForm.frequency,
      recipients,
      filters,
    });
    setShowModal(false);
    loadSchedules();
  };

  const columns = useMemo(() => (rows[0] ? Object.keys(rows[0]) : []), [rows]);
  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(rows);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-ink">Reports</h2>
      <div className="flex bg-slate-100 p-1 rounded-lg w-max">
        <button className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${tab === 'run' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`} onClick={() => setTab('run')}>Run Report</button>
        <button className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${tab === 'scheduled' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`} onClick={() => setTab('scheduled')}>Scheduled Reports</button>
      </div>

      {tab === 'run' ? (
        <>
          <section className="panel p-4">
            <div className="flex flex-col md:flex-row md:items-end gap-3 pb-4 border-b border-slate-100">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700">Report Type</span>
                <select className="field min-w-[200px]" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                  {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <button className="btn-primary" onClick={runReport}>Generate Report</button>
                <div className="flex items-center bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                  <button className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors border-r border-slate-200" onClick={exportCsv}>CSV</button>
                  <button className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors border-r border-slate-200" onClick={exportXlsx}>Excel</button>
                  <button className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors" onClick={exportPdf}>PDF</button>
                </div>
              </div>
            </div>
            <div className="grid gap-3 pt-4 md:grid-cols-3 lg:grid-cols-6">
              <label className="text-xs font-medium text-slate-500">From Date<input type="date" className="field mt-1" value={filters.from_date} onChange={(e) => setFilters((p) => ({ ...p, from_date: e.target.value }))} /></label>
              <label className="text-xs font-medium text-slate-500">To Date<input type="date" className="field mt-1" value={filters.to_date} onChange={(e) => setFilters((p) => ({ ...p, to_date: e.target.value }))} /></label>
              <label className="text-xs font-medium text-slate-500">Department<input className="field mt-1" placeholder="All Departments" value={filters.department} onChange={(e) => setFilters((p) => ({ ...p, department: e.target.value }))} /></label>
              <label className="text-xs font-medium text-slate-500">Employee Level<input className="field mt-1" placeholder="All Levels" value={filters.employee_level} onChange={(e) => setFilters((p) => ({ ...p, employee_level: e.target.value }))} /></label>
              <label className="text-xs font-medium text-slate-500">Office Location<input className="field mt-1" placeholder="All Locations" value={filters.office_location} onChange={(e) => setFilters((p) => ({ ...p, office_location: e.target.value }))} /></label>
              <label className="text-xs font-medium text-slate-500">Expense Category<input className="field mt-1" placeholder="All Categories" value={filters.expense_category} onChange={(e) => setFilters((p) => ({ ...p, expense_category: e.target.value }))} /></label>
            </div>
          </section>
          <section className="panel table-contain overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50/70 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3.5 whitespace-nowrap">S. No</th>
                  {columns.map((c) => <th key={c} className="px-4 py-3.5">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? pageItems.map((r, idx) => (
                  <tr key={startIndex + idx} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 text-center text-slate-500">{startIndex + idx + 1}</td>
                    {columns.map((c) => <td key={c} className="px-4 py-3 text-center">{String(r[c] ?? '')}</td>)}
                  </tr>
                )) : <tr><td colSpan={Math.max(columns.length, 1) + 1} className="px-4 py-8 text-center text-slate-500">Run a report to see data here.</td></tr>}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
          </section>
        </>
      ) : (
        <>
          <section className="panel p-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-slate-800">Active Schedules</h3>
              <button className="btn-primary" onClick={() => setShowModal(true)}>New Schedule</button>
            </div>
          </section>
          <section className="panel table-contain overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50/70 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3.5">Report Type</th>
                  <th className="px-4 py-3.5">Format</th>
                  <th className="px-4 py-3.5">Frequency</th>
                  <th className="px-4 py-3.5">Recipients</th>
                  <th className="px-4 py-3.5">Last Sent</th>
                  <th className="px-4 py-3.5">Next Run</th>
                </tr>
              </thead>
              <tbody>
                {schedules.length > 0 ? schedules.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors text-center">
                    <td className="px-4 py-3 font-medium text-slate-700">{s.report_type}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-inset ring-slate-500/20">{s.report_format}</span>
                    </td>
                    <td className="px-4 py-3">{s.frequency}</td>
                    <td className="px-4 py-3 text-slate-600 truncate max-w-[200px]" title={(s.recipients || []).join(', ')}>
                      {(s.recipients || []).join(', ')}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{s.last_run_at ? new Date(s.last_run_at).toLocaleString() : 'Never'}</td>
                    <td className="px-4 py-3 text-slate-500">{s.next_run_at ? new Date(s.next_run_at).toLocaleString() : '—'}</td>
                  </tr>
                )) : <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No scheduled reports found.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}

      {showModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={() => setShowModal(false)}>
          <div className="panel w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-ink">New Schedule</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <select className="field" value={scheduleForm.report_type} onChange={(e) => setScheduleForm((p) => ({ ...p, report_type: e.target.value }))}>
                {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <select className="field" value={scheduleForm.frequency} onChange={(e) => setScheduleForm((p) => ({ ...p, frequency: e.target.value }))}>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
              <input className="field md:col-span-2" placeholder="Recipients (comma-separated emails)" value={scheduleForm.recipients} onChange={(e) => setScheduleForm((p) => ({ ...p, recipients: e.target.value }))} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={createSchedule}>Save Schedule</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
