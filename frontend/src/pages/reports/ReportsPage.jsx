import { useEffect, useMemo, useState } from 'react';

import { useSetPageTitle } from '../../context/PageTitleContext';
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

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-ink">Reports</h2>
      <div className="flex bg-slate-100 p-1 rounded-lg w-max">
        <button className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${tab === 'run' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`} onClick={() => setTab('run')}>Run Report</button>
        <button className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${tab === 'scheduled' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`} onClick={() => setTab('scheduled')}>Scheduled Reports</button>
      </div>

      {tab === 'run' ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-end gap-3 pb-4 border-b border-slate-100">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Report Type</span>
              <select className="field min-w-[200px]" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={runReport}>Generate Report</button>
              <div className="flex items-center bg-slate-50 rounded border border-slate-200 overflow-hidden">
                <button className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors border-r border-slate-200" onClick={exportCsv}>CSV</button>
                <button className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors border-r border-slate-200" onClick={exportXlsx}>Excel</button>
                <button className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors" onClick={exportPdf}>PDF</button>
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <label className="text-xs font-medium text-slate-500">From Date<input type="date" className="field mt-1" value={filters.from_date} onChange={(e) => setFilters((p) => ({ ...p, from_date: e.target.value }))} /></label>
            <label className="text-xs font-medium text-slate-500">To Date<input type="date" className="field mt-1" value={filters.to_date} onChange={(e) => setFilters((p) => ({ ...p, to_date: e.target.value }))} /></label>
            <label className="text-xs font-medium text-slate-500">Department<input className="field mt-1" placeholder="All Departments" value={filters.department} onChange={(e) => setFilters((p) => ({ ...p, department: e.target.value }))} /></label>
            <label className="text-xs font-medium text-slate-500">Employee Level<input className="field mt-1" placeholder="All Levels" value={filters.employee_level} onChange={(e) => setFilters((p) => ({ ...p, employee_level: e.target.value }))} /></label>
            <label className="text-xs font-medium text-slate-500">Office Location<input className="field mt-1" placeholder="All Locations" value={filters.office_location} onChange={(e) => setFilters((p) => ({ ...p, office_location: e.target.value }))} /></label>
            <label className="text-xs font-medium text-slate-500">Expense Category<input className="field mt-1" placeholder="All Categories" value={filters.expense_category} onChange={(e) => setFilters((p) => ({ ...p, expense_category: e.target.value }))} /></label>
          </div>
          <div className="overflow-x-auto rounded border border-slate-200 mt-4">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>{columns.map((c) => <th key={c} className="px-4 py-3 text-left">{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.length > 0 ? rows.map((r, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                    {columns.map((c) => <td key={c} className="px-4 py-3">{String(r[c] ?? '')}</td>)}
                  </tr>
                )) : <tr><td colSpan={Math.max(columns.length, 1)} className="px-4 py-8 text-center text-slate-500">Run a report to see data here.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-slate-800">Active Schedules</h3>
            <button className="btn-primary" onClick={() => setShowModal(true)}>New Schedule</button>
          </div>
          <div className="overflow-hidden rounded border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">Report Type</th>
                  <th className="px-4 py-3 text-left">Format</th>
                  <th className="px-4 py-3 text-left">Frequency</th>
                  <th className="px-4 py-3 text-left">Recipients</th>
                </tr>
              </thead>
              <tbody>
                {schedules.length > 0 ? schedules.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-700">{s.report_type}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-inset ring-slate-500/20">{s.report_format}</span>
                    </td>
                    <td className="px-4 py-3">{s.frequency}</td>
                    <td className="px-4 py-3 text-slate-600 truncate max-w-[200px]" title={(s.recipients || []).join(', ')}>
                      {(s.recipients || []).join(', ')}
                    </td>
                  </tr>
                )) : <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No scheduled reports found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal ? (
        <div className="rounded border border-line bg-white p-4">
          <h3 className="text-sm font-semibold">New Schedule</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <select className="rounded border border-line px-2 py-1 text-sm" value={scheduleForm.report_type} onChange={(e) => setScheduleForm((p) => ({ ...p, report_type: e.target.value }))}>
              {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <select className="rounded border border-line px-2 py-1 text-sm" value={scheduleForm.frequency} onChange={(e) => setScheduleForm((p) => ({ ...p, frequency: e.target.value }))}>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
            <input className="rounded border border-line px-2 py-1 text-sm md:col-span-2" placeholder="Recipients (comma-separated emails)" value={scheduleForm.recipients} onChange={(e) => setScheduleForm((p) => ({ ...p, recipients: e.target.value }))} />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button className="btn-secondary text-sm" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn-primary text-sm" onClick={createSchedule}>Save Schedule</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
