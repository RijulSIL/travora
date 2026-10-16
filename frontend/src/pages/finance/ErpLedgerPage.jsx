import { AlertTriangle, ChevronDown, Search } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { PageHead, Pill } from '../../components/approvals/ApprovalQueueParts';
import { DetailBox, Empty, Figure, PaidTotal, day, dayTime, errorText, money, rupees } from '../../components/finance/FinanceParts';
import { CARD, Seg } from '../../components/policy/PolicyAdminParts';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { usePagination } from '../../hooks/usePagination';
import { reimbursementApi } from '../../services/reimbursementApi';

const STATUS = { POSTED: ['Posted', 'ok'], FAILED: ['Failed', 'rose'], PENDING: ['Pending', 'amber'] };
const INPUT = 'h-8 rounded-[10px] border border-slate-200 bg-white px-2.5 text-[12.5px] text-ink outline-none focus:border-brand';
const COLS = 'lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_150px_120px_90px_16px]';

export default function ErpLedgerPage() {
  useSetPageTitle('ERP Ledger');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Dates and status go to the server; the search box filters what's loaded.
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const params = Object.fromEntries(Object.entries({ from_date: from, to_date: to }).filter(([, v]) => v));
    reimbursementApi
      .erpLedger(params)
      .then((res) => live && setRows(res.data || []))
      .catch((err) => live && setError(errorText(err, 'Failed to load the ledger')))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [from, to]);

  const counts = useMemo(() => Object.fromEntries(Object.keys(STATUS).map((k) => [k, rows.filter((r) => r.status === k).length])), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || [r.employee_name, r.employee_id, r.claim_reference, r.erp_entry_id, r.payment_reference].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))),
    );
  }, [rows, status, query]);
  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(shown);
  const paidOut = rows.reduce((n, r) => n + Number(r.payment_amount || 0), 0);

  return (
    <section className="flex flex-col gap-3.5">
      <PageHead
        title="ERP ledger"
        sub="Every payment posted to the ERP. Click an entry for the expense split, the payment maths and its references."
        stats={[
          { label: 'Entries', value: rows.length },
          { label: 'Paid out', value: rupees(paidOut) },
          { label: 'Failed', value: counts.FAILED || 0, tone: counts.FAILED ? 'rose' : undefined },
        ]}
      />
      {error ? (
        <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
          {error}
        </div>
      ) : null}
      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
        <Seg
          label="Status"
          value={status}
          onChange={setStatus}
          options={[{ key: '', label: `All ${rows.length}` }, ...Object.entries(STATUS).map(([k, [label]]) => ({ key: k, label: `${label} ${counts[k] || 0}` }))]}
        />
        <label className="relative">
          <span className="sr-only">Search employee or claim</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${INPUT} w-[220px] pl-8`} placeholder="Search employee or claim" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <input aria-label="Paid from" type="date" className={INPUT} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs text-slate-500">to</span>
        <input aria-label="Paid until" type="date" className={INPUT} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
      </div>

      <section aria-label="Ledger entries" className={CARD}>
        <div className={`hidden gap-3.5 bg-slate-50 px-4 py-[9px] text-[11px] font-bold text-slate-500 lg:grid ${COLS}`}>
          <span>Entry</span>
          <span>Employee</span>
          <span className="text-right">Paid</span>
          <span>Date</span>
          <span>Status</span>
          <span />
        </div>
        {loading ? (
          <div className="p-4">
            <Skeleton variant="table" rows={4} columns={5} />
          </div>
        ) : shown.length ? (
          pageItems.map((row) => {
            const open = expanded === row.id;
            const [label, tone] = STATUS[row.status] || [row.status, 'slate'];
            return (
              <Fragment key={row.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : row.id)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 border-t border-slate-100 px-4 py-3 text-left first:border-t-0 hover:bg-[#fbfdfc] ${COLS} ${open ? 'bg-[#f4faf7]' : ''}`}
                >
                  <span className="min-w-0">
                    <b className="block text-[13.5px] text-ink">{row.claim_reference || `CLM-${row.claim_id}`}</b>
                    <span className="block truncate font-mono text-[11px] text-slate-500">{row.erp_entry_id || `ERP-${row.id}`}</span>
                    <span className="block text-xs text-slate-500 lg:hidden">
                      {row.employee_name || '—'} · {day(row.payment_date)}
                    </span>
                  </span>
                  <span className="hidden min-w-0 lg:block">
                    <b className="block truncate text-[13px] text-ink">{row.employee_name || '—'}</b>
                    <span className="text-xs text-slate-500">{row.employee_id}</span>
                  </span>
                  <span className="text-right">
                    <b className="block font-mono text-[13px] font-semibold tabular-nums text-ink">{money(row.payment_amount)}</b>
                    {Number(row.advance_deducted) > 0 ? <span className="text-xs text-slate-500">+ {rupees(row.advance_deducted)} from advance</span> : null}
                  </span>
                  <span className="hidden text-xs text-slate-500 lg:block">{day(row.payment_date)}</span>
                  <span className="col-span-2 lg:col-span-1">
                    <Pill tone={tone}>{label}</Pill>
                  </span>
                  <ChevronDown size={14} className={`hidden text-slate-400 transition-transform lg:block ${open ? 'rotate-180' : ''}`} />
                </button>
                {open ? (
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3.5">
                    {row.status === 'FAILED' && row.failure_reason ? (
                      <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                        <AlertTriangle size={14} className="mt-px shrink-0" />
                        <span>
                          <b className="block">Posting failed</b>
                          {row.failure_reason}
                        </span>
                      </div>
                    ) : null}
                    <div className="grid gap-3 lg:grid-cols-3">
                      <DetailBox title="Expenses">
                        {Object.entries(row.expense_category_breakdown || {}).map(([k, v]) => (
                          <Figure key={k} label={k}>
                            {money(v)}
                          </Figure>
                        ))}
                        {!Object.keys(row.expense_category_breakdown || {}).length ? <span className="text-xs text-slate-400">No breakdown recorded</span> : null}
                      </DetailBox>
                      <DetailBox title="Payment">
                        <Figure label="Claimed">{money(row.total_claimed)}</Figure>
                        <Figure label="TDS & other deductions" minus>
                          {money(row.tds_deduction)}
                        </Figure>
                        {Number(row.advance_deducted) > 0 ? (
                          <Figure label="From the advance" minus>
                            {money(row.advance_deducted)}
                          </Figure>
                        ) : null}
                        <PaidTotal label="Paid by bank transfer" amount={row.payment_amount} />
                      </DetailBox>
                      <DetailBox title="References">
                        <Figure label="Bank reference (UTR)">{row.payment_reference || '—'}</Figure>
                        <Figure label="Paid on">
                          <span className="font-sans">{dayTime(row.payment_date)}</span>
                        </Figure>
                        <Figure label="Posted by">
                          <span className="font-sans">{row.posted_by_name || '—'}</span>
                        </Figure>
                        <Figure label="ERP entry">
                          {row.erp_entry_id || `ERP-${row.id}`}
                          {row.erp_system ? ` (${row.erp_system})` : ''}
                        </Figure>
                        {row.cost_centre ? <Figure label="Cost centre">{row.cost_centre}</Figure> : null}
                      </DetailBox>
                    </div>
                  </div>
                ) : null}
              </Fragment>
            );
          })
        ) : (
          <Empty title={rows.length ? 'Nothing matches these filters' : 'No ledger entries yet'}>{rows.length ? 'Try clearing the search or the status.' : 'Paid claims appear here once they’re posted.'}</Empty>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
      </section>
    </section>
  );
}
