import { Download, Search } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Pagination from '../../components/ui/Pagination';
import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { usePagination } from '../../hooks/usePagination';
import { adminApi } from '../../services/adminApi';

const entityOptions = ['All', 'claim_draft', 'user', 'erp_ledger_entry', 'policy_version', 'expense_limit'];

function getDiffRows(oldValue, newValue) {
  const before = oldValue || {};
  const after = newValue || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  return keys.map((key) => {
    const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
    const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
    const beforeValue = hasBefore ? before[key] : undefined;
    const afterValue = hasAfter ? after[key] : undefined;
    let kind = 'same';
    if (!hasBefore && hasAfter) kind = 'added';
    else if (hasBefore && !hasAfter) kind = 'removed';
    else if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) kind = 'modified';
    return { key, beforeValue, afterValue, kind };
  });
}

function getChainStatus(rows) {
  const breaks = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i - 1].previous_event_hash !== rows[i].event_hash) {
      breaks.push(rows[i - 1].id);
    }
  }
  return { ok: breaks.length === 0, breaks };
}

export default function AuditLogs() {
  useSetPageTitle('Audit Logs');
  const [rows, setRows] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [filters, setFilters] = useState({
    entity_type: 'All',
    action: '',
    actor_id: '',
    claim_id: '',
    from_date: '',
    to_date: '',
  });
  const didInitialLoad = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const params = {};
      if (filters.claim_id) params.claim_id = filters.claim_id.trim();
      if (filters.actor_id) params.actor = filters.actor_id.trim();
      if (filters.action) params.action = filters.action.trim();
      if (filters.from_date) params.from_date = filters.from_date;
      if (filters.to_date) params.to_date = filters.to_date;
      const response = await adminApi.auditLogs(params);
      const data = response.data || [];
      const filtered =
        filters.entity_type === 'All'
          ? data
          : data.filter((entry) => (entry.entity_type || '').toLowerCase() === filters.entity_type.toLowerCase());
      setRows(filtered);
    } catch (error) {
      setLoadError(error);
    }
  }, [filters]);

  useEffect(() => {
    if (didInitialLoad.current) return;
    didInitialLoad.current = true;
    load();
  }, [load]);

  const searchAction = useAsyncAction(load);
  const exportAction = useAsyncAction(async () => {
    const params = {};
    if (filters.claim_id) params.claim_id = filters.claim_id.trim();
    if (filters.actor_id) params.actor = filters.actor_id.trim();
    if (filters.action) params.action = filters.action.trim();
    if (filters.from_date) params.from_date = filters.from_date;
    if (filters.to_date) params.to_date = filters.to_date;
    const res = await adminApi.auditLogsExport(params);
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit_logs.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  const chainStatus = useMemo(() => getChainStatus(rows), [rows]);
  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(rows);
  const error = loadError || searchAction.error || exportAction.error;
  const hasFilters = filters.entity_type !== 'All' || !!filters.action || !!filters.actor_id || !!filters.claim_id || !!filters.from_date || !!filters.to_date;

  return (
    <>
      <PageHeader
        title=""
        actions={
          <>
            <button className="btn-primary" type="button" onClick={searchAction.run} disabled={searchAction.loading}>
              <Search size={16} />
              Search
            </button>
            <button className="btn-secondary" type="button" onClick={exportAction.run} disabled={exportAction.loading}>
              <Download size={16} />
              Export CSV
            </button>
          </>
        }
      />
      {hasFilters ? null : (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${chainStatus.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}
        >
          {chainStatus.ok
            ? 'Audit chain integrity verified'
            : `Chain break detected at entries: ${chainStatus.breaks.map(b => '#' + b).join(', ')}`}
        </div>
      )}
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error.response?.data?.detail || error.message}
        </div>
      ) : null}
      <section className="panel mb-6 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="field w-full !pl-9" placeholder="Actor ID or Name" value={filters.actor_id} onChange={(event) => setFilters({ ...filters, actor_id: event.target.value })} />
          </div>
          <div className="relative min-w-[150px] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">#</span>
            <input className="field w-full !pl-8" placeholder="Claim ID" value={filters.claim_id} onChange={(event) => setFilters({ ...filters, claim_id: event.target.value })} />
          </div>
          <input className="field min-w-[150px] flex-1" placeholder="Action (e.g. UPDATE)" value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} />
          <select
            className="field min-w-[160px] flex-1"
            value={filters.entity_type}
            onChange={(event) => setFilters({ ...filters, entity_type: event.target.value })}
          >
            {entityOptions.map((value) => (
              <option key={value} value={value}>
                {value === 'All' ? 'All Entities' : value}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <input className="field w-[130px]" type="date" title="From Date" value={filters.from_date} onChange={(event) => setFilters({ ...filters, from_date: event.target.value })} />
            <span className="text-xs font-medium text-slate-400">to</span>
            <input className="field w-[130px]" type="date" title="To Date" value={filters.to_date} onChange={(event) => setFilters({ ...filters, to_date: event.target.value })} />
          </div>
        </div>
      </section>
      <section className="panel table-contain overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">S. No</th>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Entity ID</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Hash</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((row, idx) => {
              const isOpen = expandedId === row.id;
              const diffRows = getDiffRows(row.old_value, row.new_value);
              return (
                <Fragment key={row.id}>
                  <tr className={`cursor-pointer border-t border-line transition-colors ${isOpen ? 'bg-slate-50/80' : 'hover:bg-slate-50/50'}`} onClick={() => setExpandedId(isOpen ? null : row.id)}>
                    <td className="px-4 py-3 text-center text-slate-500 font-medium">{startIndex + idx + 1}</td>
                    <td className="px-4 py-3 text-center text-slate-700">{new Date(row.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className="px-4 py-3 text-center"><span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">{row.entity_type}</span></td>
                    <td className="px-4 py-3 text-center font-mono text-xs text-slate-600">{row.entity_id}</td>
                    <td className="px-4 py-3 text-center font-semibold text-slate-700">{row.action}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{row.actor_id || '-'}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-center font-mono text-xs text-slate-400" title={row.event_hash}>{row.event_hash}</td>
                  </tr>
                  {isOpen ? (
                    <tr className="border-t border-line bg-slate-50/80">
                      <td colSpan={7} className="p-4">
                        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm grid gap-6 md:grid-cols-2">
                          <div>
                            <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><span className="w-2 h-2 rounded-full bg-red-400"></span> Before</h4>
                            <div className="space-y-1.5 font-mono text-xs">
                              {diffRows.map((d) => (
                                <div
                                  key={`before-${d.key}`}
                                  className={`rounded-md px-3 py-2 border ${
                                    d.kind === 'modified'
                                      ? 'bg-amber-50 border-amber-200/50 text-amber-900'
                                      : d.kind === 'removed'
                                        ? 'bg-red-50 border-red-200/50 text-red-900'
                                        : 'bg-slate-50 border-slate-100 text-slate-600'
                                  }`}
                                >
                                  <span className="font-semibold text-slate-700 mr-2">{d.key}:</span> 
                                  <span className="opacity-90">{d.beforeValue === undefined ? '-' : JSON.stringify(d.beforeValue)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><span className="w-2 h-2 rounded-full bg-emerald-400"></span> After</h4>
                            <div className="space-y-1.5 font-mono text-xs">
                              {diffRows.map((d) => (
                                <div
                                  key={`after-${d.key}`}
                                  className={`rounded-md px-3 py-2 border ${
                                    d.kind === 'modified'
                                      ? 'bg-amber-50 border-amber-200/50 text-amber-900'
                                      : d.kind === 'added'
                                        ? 'bg-emerald-50 border-emerald-200/50 text-emerald-900'
                                        : 'bg-slate-50 border-slate-100 text-slate-600'
                                  }`}
                                >
                                  <span className="font-semibold text-slate-700 mr-2">{d.key}:</span> 
                                  <span className="opacity-90">{d.afterValue === undefined ? '-' : JSON.stringify(d.afterValue)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No audit logs match your search.</td></tr> : null}
          </tbody>
        </table>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
      </section>
    </>
  );
}
