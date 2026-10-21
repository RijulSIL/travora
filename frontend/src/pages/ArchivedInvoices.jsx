import { ArrowLeft, ChevronRight, FileImage, FileText, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Pill, Tabs } from '../components/approvals/ApprovalQueueParts';
import { BTN_GHOST, CARD } from '../components/policy/PolicyAdminParts';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Pagination from '../components/ui/Pagination';
import Skeleton from '../components/ui/Skeleton';
import { useSetPageTitle } from '../context/PageTitleContext';
import { usePagination } from '../hooks/usePagination';
import { reimbursementApi } from '../services/reimbursementApi';

const TYPE = { TRAVEL: ['Travel', 'sky'], GENERAL: ['General', 'violet'], RELOCATION: ['Relocation', 'orange'] };
const STATUS = { PAID: ['Paid', 'ok'], REJECTED: ['Rejected', 'rose'] };
const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const uploaded = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const isPdf = (invoice) => (invoice.original_filename || '').toLowerCase().endsWith('.pdf') || invoice.content_type === 'application/pdf';
const titleCase = (s) => String(s || '').replaceAll('_', ' ').replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());

export default function ArchivedInvoices() {
  useSetPageTitle('Archived Invoices');
  const [invoices, setInvoices] = useState(null);
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    reimbursementApi
      .invoices()
      .then((response) => setInvoices((response.data || []).filter((invoice) => invoice.is_archived)))
      .catch(() => {
        setInvoices([]);
        setError('Could not load your archived invoices.');
      });
  }, []);

  const all = useMemo(() => invoices || [], [invoices]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (i) =>
        (tab === 'all' || i.reimbursement_category === tab) &&
        (!q || [i.original_filename, i.linked_claim_reference].some((v) => String(v || '').toLowerCase().includes(q))),
    );
  }, [all, tab, query]);
  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(shown);

  // This page's invoices, grouped under the claim they were used on (in the order they appear).
  const groups = [];
  pageItems.forEach((invoice) => {
    const key = invoice.linked_claim_id ?? invoice.linked_claim_reference ?? 'none';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, invoice, items: [] };
      groups.push(group);
    }
    group.items.push(invoice);
  });
  // Claim totals count every archived invoice on that claim, not just the ones on this page.
  const claimOf = (invoice) => shown.filter((i) => (i.linked_claim_id ?? i.linked_claim_reference) === (invoice.linked_claim_id ?? invoice.linked_claim_reference));
  const shownTotal = shown.reduce((n, i) => n + Number(i.total_amount || 0), 0);
  const claimCount = new Set(shown.map((i) => i.linked_claim_id ?? i.linked_claim_reference)).size;
  const count = (t) => all.filter((i) => t === 'all' || i.reimbursement_category === t).length;

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError('');
    try {
      await reimbursementApi.deleteInvoice(deleteTarget.id);
      setInvoices((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Could not delete this invoice.');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Archived invoices</h1>
          <p className="mt-0.5 max-w-[75ch] text-[13px] text-slate-500">
            Invoices on claims that have been paid or rejected. They can&apos;t go on a new claim; to use a file again, upload it again.
          </p>
        </div>
        <Link to="/invoices" className={BTN_GHOST}>
          <ArrowLeft size={14} />
          Upload invoices
        </Link>
      </div>
      {error ? (
        <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-2.5 border-b border-slate-200">
        <div className="-mb-px min-w-0 flex-1 [&>div]:border-b-0">
          <Tabs
            label="Type"
            value={tab}
            onChange={setTab}
            tabs={['all', 'TRAVEL', 'GENERAL', 'RELOCATION'].map((t) => ({ key: t, label: t === 'all' ? 'All' : TYPE[t][0], count: count(t) }))}
          />
        </div>
        <label className="relative mb-1.5 w-full max-w-[260px]">
          <span className="sr-only">Search file name or claim</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="h-[34px] w-full rounded-[10px] border border-slate-200 bg-white pl-8 pr-2.5 text-[12.5px] text-ink outline-none focus:border-brand"
            placeholder="Search file name or claim"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {invoices && shown.length ? (
        <p className="flex flex-wrap gap-3.5 text-[12.5px] text-slate-500">
          <span>
            <b className="font-mono text-ink">{money(shownTotal)}</b> across {shown.length} invoice{shown.length === 1 ? '' : 's'}
          </span>
          <span>
            on {claimCount} claim{claimCount === 1 ? '' : 's'}
          </span>
        </p>
      ) : null}

      <section aria-label="Archived invoices" className={CARD}>
        {invoices === null ? (
          <div className="p-4">
            <Skeleton variant="table" rows={4} columns={1} />
          </div>
        ) : groups.length ? (
          groups.map((group, gi) => {
            const head = group.invoice;
            const onClaim = claimOf(head);
            const [typeLabel, typeTone] = TYPE[head.reimbursement_category] || TYPE.TRAVEL;
            const [statusLabel, statusTone] = STATUS[head.linked_claim_status] || [titleCase(head.linked_claim_status) || 'Closed', 'slate'];
            return (
              <div key={group.key}>
                <div className={`flex flex-wrap items-center justify-between gap-2.5 bg-slate-50 px-4 py-2.5 ${gi ? 'border-t border-slate-200' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] font-extrabold text-ink">
                      {head.linked_claim_reference || (head.linked_claim_id ? `Claim #${head.linked_claim_id}` : 'Claim')}
                      <Pill tone={typeTone}>{typeLabel}</Pill>
                      <Pill tone={statusTone}>{statusLabel}</Pill>
                    </div>
                    <div className="text-xs text-slate-500">
                      {onClaim.length} invoice{onClaim.length === 1 ? '' : 's'} · {money(onClaim.reduce((n, i) => n + Number(i.total_amount || 0), 0))}
                    </div>
                  </div>
                  {head.linked_claim_id ? (
                    <Link to={`/claims/${head.linked_claim_id}`} className="inline-flex items-center text-xs font-bold text-brand hover:underline">
                      Open claim
                      <ChevronRight size={13} />
                    </Link>
                  ) : null}
                </div>
                {group.items.map((invoice) => {
                  const Icon = isPdf(invoice) ? FileText : FileImage;
                  return (
                    <div key={invoice.id} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-slate-100 px-4 py-[11px]">
                      <span className="grid h-10 w-9 place-items-center rounded-lg bg-slate-100 text-slate-500">
                        <Icon size={17} />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-bold text-ink" title={invoice.original_filename}>
                          {invoice.original_filename}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          Uploaded {uploaded(invoice.created_at)} · {(Number(invoice.file_size_bytes || 0) / 1024).toFixed(1)} KB
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-[18px]">
                        <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">{invoice.total_amount != null ? money(invoice.total_amount) : '—'}</span>
                        <span className="flex items-center gap-2">
                          <Link to={`/invoices/${invoice.id}/review`} className="text-[13px] font-bold text-brand hover:underline">
                            Open
                          </Link>
                          {invoice.can_delete ? (
                            <button
                              type="button"
                              onClick={() => {
                                setError('');
                                setDeleteTarget(invoice);
                              }}
                              className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              aria-label={`Delete ${invoice.original_filename}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        ) : (
          <div className="px-4 py-9 text-center text-[13px] text-slate-500">
            <b className="mb-1 block text-sm text-ink">{all.length ? 'Nothing here' : 'No archived invoices'}</b>
            {all.length ? 'Try another tab or search.' : 'Invoices move here once their claim is paid or rejected. Until then they stay under “On a claim” on Upload invoices.'}
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this invoice?"
        description={deleteTarget ? `"${deleteTarget.original_filename}" will be permanently removed. This can't be undone.` : ''}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        confirmVariant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
