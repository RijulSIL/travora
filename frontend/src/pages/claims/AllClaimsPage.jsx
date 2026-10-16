import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHead, Pill, Tabs } from '../../components/approvals/ApprovalQueueParts';
import { Empty, day, errorText, money, rupees } from '../../components/finance/FinanceParts';
import { CARD } from '../../components/policy/PolicyAdminParts';
import { CLAIM_STAGE } from '../../components/reports/statusPalette';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { usePagination } from '../../hooks/usePagination';
import { reimbursementApi } from '../../services/reimbursementApi';

const CATEGORY = { TRAVEL: ['Travel', 'sky'], GENERAL: ['General', 'violet'], RELOCATION: ['Relocation', 'orange'] };
const TAB_ORDER = ['PENDING_EXCEPTION', 'IN_APPROVAL', 'ON_HOLD', 'READY_FOR_PAYMENT', 'PAID', 'SENT_BACK', 'REJECTED'];
const INPUT = 'h-8 rounded-[10px] border border-slate-200 bg-white px-2.5 text-[12.5px] text-ink outline-none focus:border-brand';
const COLS = 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_150px_130px]';
const shortDay = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');

function StatusPill({ status }) {
  const [label, color] = CLAIM_STAGE[status] || [String(status || '').replace(/_/g, ' '), '#94a3b8'];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: `${color}1a`, color }}>
      <i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export default function AllClaimsPage() {
  useSetPageTitle('All Claims');
  const navigate = useNavigate();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('all');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClaims((await reimbursementApi.claims({ all_claims: true })).data || []);
    } catch (e) {
      setError(errorText(e, e.message || 'Failed to load claims'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Category, search and dates narrow the list first; the tabs then count within that.
  const narrowed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return claims.filter((c) => {
      if (category && (c.reimbursement_category || 'TRAVEL') !== category) return false;
      const sub = c.submitted_at ? String(c.submitted_at).slice(0, 10) : '';
      if (from && sub && sub < from) return false;
      if (to && sub && sub > to) return false;
      if (q && ![c.claim_reference, c.employee_id, c.employee_name, c.destination_city].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [claims, category, query, from, to]);
  const shown = tab === 'all' ? narrowed : narrowed.filter((c) => c.status === tab);
  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(shown);

  const statuses = [...TAB_ORDER, ...new Set(claims.map((c) => c.status).filter((s) => !TAB_ORDER.includes(s)))];
  const tabs = [{ key: 'all', label: 'All', count: narrowed.length }, ...statuses.map((s) => ({ key: s, label: (CLAIM_STAGE[s] || [s.replace(/_/g, ' ')])[0], count: narrowed.filter((c) => c.status === s).length }))];
  const claimed = claims.reduce((n, c) => n + Number(c.compliance_report?.total_claimed || 0), 0);
  const open = claims.filter((c) => !['PAID', 'REJECTED'].includes(c.status)).length;

  return (
    <section className="flex flex-col gap-3.5">
      <PageHead
        title="All claims"
        sub="Every claim across the company, view only. Click one to open it."
        stats={[
          { label: 'Claims', value: claims.length },
          { label: 'Claimed', value: rupees(claimed) },
          { label: 'Still open', value: open },
        ]}
      />
      {error ? (
        <div role="alert" className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
          {error}
        </div>
      ) : null}
      <Tabs label="Status" tabs={tabs} value={tab} onChange={setTab} />
      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
        <select aria-label="Type" className="h-8 rounded-[10px] border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All types</option>
          <option value="TRAVEL">Travel</option>
          <option value="GENERAL">General</option>
          <option value="RELOCATION">Relocation</option>
        </select>
        <label className="relative">
          <span className="sr-only">Search</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${INPUT} w-[230px] pl-8`} placeholder="Search claim, employee or city" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <span className="text-xs text-slate-500">Submitted</span>
        <input aria-label="Submitted from" type="date" className={INPUT} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs text-slate-500">to</span>
        <input aria-label="Submitted until" type="date" className={INPUT} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        {category || query || from || to ? (
          <button
            type="button"
            className="text-xs font-bold text-brand hover:underline"
            onClick={() => {
              setCategory('');
              setQuery('');
              setFrom('');
              setTo('');
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <section aria-label="Claims" className={CARD}>
        <div className={`hidden gap-3.5 bg-slate-50 px-4 py-[9px] text-[11px] font-bold text-slate-500 lg:grid ${COLS}`}>
          <span>Claim</span>
          <span>Trip / type</span>
          <span className="text-right">Amount</span>
          <span>Status</span>
        </div>
        {loading ? (
          <div className="p-4">
            <Skeleton variant="table" rows={5} columns={4} />
          </div>
        ) : shown.length ? (
          pageItems.map((c) => {
            const [catLabel, catTone] = CATEGORY[c.reimbursement_category] || CATEGORY.TRAVEL;
            const report = c.compliance_report || {};
            const trip = c.destination_city
              ? `${c.office_location || c.from_city || '—'} → ${c.destination_city}${c.departure_date ? ` · ${shortDay(c.departure_date)}–${day(c.return_date || c.departure_date)}` : ''}`
              : `${catLabel} reimbursement`;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/claims/${c.id}`)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 border-t border-slate-100 px-4 py-3 text-left first:border-t-0 hover:bg-[#fbfdfc] ${COLS}`}
              >
                <span className="min-w-0">
                  <b className="flex flex-wrap items-center gap-[7px] text-[13.5px] text-ink">
                    {c.claim_reference || `CLM-${c.id}`} <Pill tone={catTone}>{catLabel}</Pill>
                  </b>
                  <span className="block text-xs text-slate-500">
                    {c.employee_name || 'Employee'}
                    {c.employee_id ? ` (${c.employee_id})` : ''} · {c.submitted_at ? `submitted ${day(c.submitted_at)}` : 'not submitted'}
                  </span>
                  <span className="block text-xs text-slate-500 lg:hidden">{trip}</span>
                </span>
                <span className="hidden text-xs text-slate-500 lg:block">{trip}</span>
                <span className="text-right">
                  <b className="block font-mono text-[13px] font-semibold tabular-nums text-ink">{money(report.total_claimed)}</b>
                  {c.status === 'PAID' && c.payment_amount != null ? <span className="text-xs text-slate-500">paid {money(c.payment_amount)}</span> : null}
                </span>
                <span className="col-span-2 lg:col-span-1">
                  <StatusPill status={c.status} />
                </span>
              </button>
            );
          })
        ) : (
          <Empty title={claims.length ? 'No claims here' : 'No claims yet'}>{claims.length ? 'Try another tab or clear the filters.' : 'Submitted claims show up here.'}</Empty>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
      </section>
    </section>
  );
}
