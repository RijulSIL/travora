import { ChevronRight, Download, Search, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';

import { Pill } from '../../components/approvals/ApprovalQueueParts';
import { BTN_GHOST, BTN_SM, CARD, ErrorNote, FIELD, PolicyHead } from '../../components/policy/PolicyAdminParts';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { adminApi } from '../../services/adminApi';

/*
 * Audit logs: every change made in Travora, newest first, one page at a time from the server.
 * Each entry is linked to the one before it by its fingerprint; the integrity check (run on the
 * server over every entry, see audit_service.check_audit_chain) explains any gap. Gaps from
 * before the check existed are "old" (amber); anything newer is red.
 */

const PAGE_SIZE = 10;
const FILTER = FIELD.replace('w-full', '');

const ENTITY = {
  user: ['User', 'sky'],
  workflow_config: ['Approval matrix', 'violet'],
  policy_version: ['Policy version', 'violet'],
  permission_matrix_config: ['Role permissions', 'violet'],
  scheduled_report: ['Scheduled report', 'violet'],
  company_profile: ['Company profile', 'violet'],
  claim_draft: ['Claim', 'ok'],
  advance_request: ['Advance', 'orange'],
  erp_ledger_entry: ['ERP ledger', 'orange'],
  travel_request: ['Travel request', 'brand'],
  relocation_request: ['Relocation', 'brand'],
};

const ACTION = {
  user_bulk_imported: 'Added a user by CSV import',
  user_created_by_admin: 'Added a user',
  welcome_email_resent: 'Resent a welcome email',
  user_reactivated: 'Reactivated a user',
  made_manager_and_linked: 'Made someone a manager and linked their people',
  update_workflow_config: 'Changed the approval matrix',
  update_permission_matrix_config: 'Changed role permissions',
  update_company_profile: 'Changed the company profile',
  approve_stage: 'Approved a stage',
  reject_stage: 'Rejected a stage',
  send_back: 'Sent a claim back',
  record_payment: 'Recorded a payment',
  erp_posted: 'Posted to the ERP ledger',
  advance_granted: 'Granted an advance',
  advance_updated: 'Changed an advance',
  advance_topped_up: 'Topped up an advance',
  advance_settled: 'Settled an advance',
  policy_version_created: 'Created a policy version',
  policy_version_submitted: 'Sent a policy version for approval',
  policy_version_stage_approved: 'Approved a policy version step',
  policy_version_approved: 'Approved a policy version',
  policy_version_rejected: 'Rejected a policy version',
  policy_version_scheduled: 'Scheduled a policy version',
  policy_version_status_corrected: 'Corrected a policy version status',
  report_schedule_created: 'Scheduled a report',
  sla_passed_on: 'Passed on after a missed deadline',
};

const sentenceCase = (text) => {
  const words = String(text || '').replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
};
const entityOf = (type) => ENTITY[type] || [sentenceCase(type), 'slate'];
const actionLabel = (entry) => {
  if (entry.action === 'create') return `Created a ${entityOf(entry.entity_type)[0].toLowerCase()}`;
  return ACTION[entry.action] || sentenceCase(entry.action);
};
const pad = (id) => String(id).padStart(4, '0');
const refOf = (entry) => {
  if (entry.entity_label) return entry.entity_label;
  if (entry.entity_type === 'travel_request') return `TR-${pad(entry.entity_id)}`;
  if (entry.entity_type === 'relocation_request') return `REL-${pad(entry.entity_id)}`;
  if (entry.entity_type === 'claim_draft') return `CLM-${entry.entity_id}`;
  if (entry.entity_type === 'user') return `user #${entry.entity_id}`;
  return `#${entry.entity_id}`;
};

const day = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const time = (value) => new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const fullTime = (value) =>
  new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

function gapText(gap) {
  switch (gap.kind) {
    case 'missing_previous':
      return 'Links to an entry that’s no longer in the log — the entry before it was deleted.';
    case 'wrong_previous':
      return gap.is_old
        ? `Linked to #${gap.linked_to_id} instead of the entry just before it. It was saved while another change was still being saved — fixed now.`
        : `Linked to #${gap.linked_to_id} instead of the entry just before it.`;
    case 'altered':
      return 'Its details were changed after it was saved — they no longer match its fingerprint.';
    case 'missing_latest':
      return `The newest entries were removed — the log now ends at #${gap.linked_to_id ?? '—'}, but #${gap.id ?? '—'} was saved after it.`;
    default:
      return 'Doesn’t link to the entry before it.';
  }
}

function Integrity({ integrity }) {
  const [open, setOpen] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia('(min-width: 768px)').matches));
  const { status, total, gaps, recheck_from_id: recheckFrom, rechecked } = integrity;
  const newGaps = gaps.filter((g) => !g.is_old);
  const tone =
    status === 'new_gaps'
      ? { box: 'border-rose-300 bg-rose-50', text: 'text-rose-900', item: 'border-rose-200', summary: 'text-rose-800', pill: 'rose' }
      : status === 'old_gaps'
        ? { box: 'border-amber-300 bg-amber-50', text: 'text-amber-900', item: 'border-amber-200', summary: 'text-amber-800', pill: 'amber' }
        : { box: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-900', item: 'border-emerald-200', summary: 'text-emerald-800', pill: 'ok' };
  const badge =
    status === 'new_gaps'
      ? `${newGaps.length} new ${newGaps.length === 1 ? 'gap' : 'gaps'}`
      : status === 'old_gaps'
        ? `${gaps.length} old ${gaps.length === 1 ? 'gap' : 'gaps'} · nothing new`
        : 'Everything links up';
  const recheckNote =
    recheckFrom != null ? ` Entries from #${recheckFrom} on are also re-checked for edits (${rechecked} so far).` : '';
  const ordered = [...newGaps, ...gaps.filter((g) => g.is_old)];

  return (
    <div className={`flex flex-col gap-2 rounded-[14px] border px-4 py-3 ${tone.box}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <b className="text-[13.5px] text-ink">Integrity check · {total} entries</b>
        <Pill tone={tone.pill}>{badge}</Pill>
      </div>
      <p className={`max-w-[100ch] text-xs leading-relaxed ${tone.text}`}>
        Each entry is linked to the one before it, so a missing or altered entry shows up as a gap.
        {status === 'ok' ? ' No gaps.' : null}
        {status === 'old_gaps' ? ` All ${gaps.length} gaps were there before this check was added, and their causes are known. Anything new would turn this red.` : null}
        {status === 'new_gaps' ? ' Something changed in the log since this check was added — look at the gaps marked new.' : null}
        {recheckNote}
      </p>
      {gaps.length ? (
        <div>
          <button
            type="button"
            className={`inline-flex items-center gap-1 text-xs font-bold ${tone.summary}`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            {open ? 'Hide the gaps' : `What the ${gaps.length} ${gaps.length === 1 ? 'gap is' : 'gaps are'}`}
          </button>
          {open ? (
            <ul className="mt-2 grid gap-1.5">
              {ordered.map((gap) => (
                <li
                  key={`${gap.kind}-${gap.id}`}
                  className={`grid grid-cols-[64px_minmax(0,1fr)] gap-2 rounded-[10px] border bg-white px-3 py-2 text-xs text-slate-700 ${gap.is_old ? tone.item : 'border-rose-300'}`}
                >
                  <b className="font-mono text-ink">#{gap.id ?? '—'}</b>
                  <span>
                    {!gap.is_old ? <Pill tone="rose">New</Pill> : null} {gap.timestamp ? `${day(gap.timestamp)} · ` : ''}
                    {gap.action ? `“${actionLabel(gap)}”${gap.entity_type ? ` · ${refOf(gap)}` : ''}. ` : ''}
                    {gapText(gap)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Changes({ entry, gap }) {
  const before = entry.old_value || {};
  const after = entry.new_value || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const same = keys.filter((k) => !changed.includes(k));
  const show = (has, value) => {
    if (!has) return <span className="text-slate-300">—</span>;
    if (value === null || value === '') return <span className="italic text-slate-400">empty</span>;
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };

  return (
    <div className="border-t border-slate-100 bg-emerald-50/40 px-3.5 pb-3.5 pt-1">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse overflow-hidden rounded-[10px] border border-slate-200 bg-white text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-slate-400">
              <th className="px-2.5 py-[7px]">Field</th>
              <th className="px-2.5 py-[7px]">Before</th>
              <th className="px-2.5 py-[7px]">After</th>
            </tr>
          </thead>
          <tbody>
            {[...changed, ...same].map((key) => {
              const isSame = same.includes(key);
              return (
                <tr key={key} className="border-t border-slate-100 align-top">
                  <td className="w-[26%] break-words px-2.5 py-[7px] font-bold text-ink">{sentenceCase(key)}</td>
                  <td className={`break-all px-2.5 py-[7px] ${isSame ? 'text-slate-500' : 'text-rose-800'}`}>{show(key in before, before[key])}</td>
                  <td className={`break-all px-2.5 py-[7px] ${isSame ? 'text-slate-500' : 'text-emerald-800'}`}>{show(key in after, after[key])}</td>
                </tr>
              );
            })}
            {!keys.length ? (
              <tr>
                <td colSpan={3} className="px-2.5 py-[7px] text-slate-400">
                  No details recorded.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2.5 text-[11.5px] text-slate-500">
        <span>
          Entry #{entry.id} · {fullTime(entry.timestamp)}
        </span>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          Fingerprint <span className="font-mono" title={entry.event_hash}>{entry.event_hash.slice(0, 16)}…</span>
          {gap ? <Pill tone={gap.is_old ? 'amber' : 'rose'}>{gap.is_old ? 'Old gap — see above' : 'Gap — see above'}</Pill> : <Pill tone="ok">Linked ✓</Pill>}
        </span>
      </div>
    </div>
  );
}

const EMPTY_FILTERS = { search: '', entity_type: '', action: '', from_date: '', to_date: '' };

export default function AuditLogs() {
  useSetPageTitle('Audit Logs');
  const { showToast } = useToast();
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [listError, setListError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    adminApi
      .auditOverview()
      .then((res) => setOverview(res.data))
      .catch((err) => setOverviewError(err));
  }, []);

  // Typing in the search box waits a moment before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => (current.search === search.trim() ? current : { ...current, search: search.trim() }));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    const params = { page, page_size: PAGE_SIZE };
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params[key] = value;
    });
    adminApi
      .auditLogsPage(params)
      .then((res) => {
        if (id !== request.current) return;
        setResult(res.data);
        setListError(null);
      })
      .catch((err) => {
        if (id === request.current) setListError(err);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  }, [filters, page]);

  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setOpenId(null);
  };
  const clear = () => {
    setSearch('');
    setFilters(EMPTY_FILTERS);
    setPage(1);
    setOpenId(null);
  };
  const changePage = (next) => {
    setPage(next);
    setOpenId(null);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = {};
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params[key] = value;
      });
      const res = await adminApi.auditLogsExport(params);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'audit_logs.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Could not export the audit log.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const gapById = {};
  (overview?.integrity.gaps || []).forEach((gap) => {
    if (gap.id != null && gap.kind !== 'missing_latest') gapById[gap.id] = gap;
  });
  const hasFilters = Object.values(filters).some(Boolean) || search;
  const items = result?.items || [];
  const total = result?.total || 0;

  return (
    <section className="flex flex-col gap-3.5">
      <PolicyHead title="Audit logs" sub="Every change made in Travora: who made it, when, and what it changed. Entries can’t be edited or deleted from the app.">
        {[
          ['Entries', overview?.total],
          ['Since', overview ? day(overview.first_at) : null],
          ['People', overview?.people],
        ].map(([label, value]) => (
          <div key={label} className="min-w-[100px] rounded-xl border border-slate-200 bg-white px-3 py-[7px]">
            <b className="block text-[17px] text-ink">{value ?? '—'}</b>
            <span className="text-[11.5px] font-semibold text-slate-500">{label}</span>
          </div>
        ))}
        <button type="button" className={`${BTN_GHOST} !h-auto min-h-[52px] rounded-xl px-4`} onClick={exportCsv} disabled={exporting}>
          <Download size={15} />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </PolicyHead>

      <ErrorNote error={overviewError} />
      {overview ? <Integrity integrity={overview.integrity} /> : !overviewError ? <Skeleton variant="table" rows={2} columns={1} /> : null}

      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3.5 py-2.5">
          <label className="relative min-w-[180px] flex-1">
            <span className="sr-only">Search by person or ID</span>
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className={`${FIELD} !pl-8`}
              placeholder="Search by person or ID"
              title="A name, a reference like TR-0064 or CLM-2026-0059, or an entry number like #402"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select aria-label="What changed" className={FILTER} value={filters.entity_type} onChange={(event) => setFilter('entity_type', event.target.value)}>
            <option value="">Anything</option>
            {(overview?.entity_counts || []).map(({ key, count }) => (
              <option key={key} value={key}>
                {entityOf(key)[0]} ({count})
              </option>
            ))}
          </select>
          <select aria-label="Action" className={`${FILTER} max-w-full`} value={filters.action} onChange={(event) => setFilter('action', event.target.value)}>
            <option value="">Any action</option>
            {(overview?.action_counts || []).map(({ key, count }) => (
              <option key={key} value={key}>
                {ACTION[key] || (key === 'create' ? 'Created a record' : sentenceCase(key))} ({count})
              </option>
            ))}
          </select>
          <span className="inline-flex items-center gap-1.5">
            <input type="date" aria-label="From" className={FILTER} value={filters.from_date} max={filters.to_date || undefined} onChange={(event) => setFilter('from_date', event.target.value)} />
            <span className="text-xs text-slate-400">to</span>
            <input type="date" aria-label="To" className={FILTER} value={filters.to_date} min={filters.from_date || undefined} onChange={(event) => setFilter('to_date', event.target.value)} />
          </span>
          {hasFilters ? (
            <button type="button" className={BTN_SM} onClick={clear}>
              <X size={13} />
              Clear
            </button>
          ) : null}
        </div>

        <div className="hidden grid-cols-[150px_160px_minmax(0,1fr)_14px] gap-3 border-b border-slate-100 px-3.5 py-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-slate-400 md:grid">
          <span>When</span>
          <span>Who</span>
          <span>What happened</span>
          <span />
        </div>

        <ErrorNote error={listError} />
        {loading && !result ? (
          <div className="p-3.5">
            <Skeleton variant="table" rows={6} columns={1} />
          </div>
        ) : null}
        {result && !items.length ? (
          <p className="px-4 py-7 text-center text-[13px] text-slate-500">{hasFilters ? 'No entries match.' : 'No entries yet.'}</p>
        ) : null}

        <div className={loading && result ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {items.map((entry) => {
            const [label, tone] = entityOf(entry.entity_type);
            const gap = gapById[entry.id];
            const isOpen = openId === entry.id;
            return (
              <Fragment key={entry.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenId(isOpen ? null : entry.id)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_14px] items-center gap-x-3 gap-y-1 border-t border-slate-100 px-3.5 py-2.5 text-left first:border-t-0 hover:bg-slate-50 md:grid-cols-[150px_160px_minmax(0,1fr)_14px] ${
                    isOpen ? 'bg-emerald-50/40' : 'bg-white'
                  } ${gap ? (gap.is_old ? 'shadow-[inset_3px_0_0_#f59e0b]' : 'shadow-[inset_3px_0_0_#e11d48]') : ''}`}
                >
                  <span className="col-start-1">
                    <b className="block text-[12.5px] text-ink">{day(entry.timestamp)}</b>
                    <span className="text-[11.5px] text-slate-500">{time(entry.timestamp)}</span>
                  </span>
                  <span className={`col-start-1 truncate text-[12.5px] md:col-start-auto ${entry.actor_id ? 'font-semibold text-ink' : 'italic text-slate-500'}`}>
                    {entry.actor_name || (entry.actor_id ? `User #${entry.actor_id}` : 'System')}
                  </span>
                  <span className="col-start-1 flex min-w-0 flex-wrap items-center gap-2 md:col-start-auto">
                    <b className="text-[13px] text-ink">{actionLabel(entry)}</b>
                    <Pill tone={tone}>{label}</Pill>
                    <span className={`text-[11.5px] text-slate-500 ${entry.entity_label && entry.entity_type === 'user' ? '' : 'font-mono'}`}>{refOf(entry)}</span>
                  </span>
                  <ChevronRight
                    size={14}
                    className={`col-start-2 row-start-1 text-slate-400 transition-transform md:col-start-4 ${isOpen ? 'rotate-90' : ''}`}
                  />
                </button>
                {isOpen ? <Changes entry={entry} gap={gap} /> : null}
              </Fragment>
            );
          })}
        </div>

        {total ? (
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            onPageChange={changePage}
            total={total}
            pageSize={PAGE_SIZE}
            startIndex={(page - 1) * PAGE_SIZE}
          />
        ) : null}
      </div>
    </section>
  );
}
