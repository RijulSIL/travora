import { AlertCircle, Archive, FileImage, FileText, Lock, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import ReimbursementCategoryBadge from '../components/ui/ReimbursementCategoryBadge';
import { useSetPageTitle } from '../context/PageTitleContext';
import { reimbursementApi } from '../services/reimbursementApi';

function fileIcon(invoice) {
  const name = (invoice.original_filename || '').toLowerCase();
  if (name.endsWith('.pdf')) return FileText;
  return FileImage;
}

function humanizeClaimStatus(status) {
  return String(status || '')
    .replaceAll('_', ' ')
    .replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());
}

export default function ArchivedInvoices() {
  useSetPageTitle('Archived Invoices');
  const [invoices, setInvoices] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const response = await reimbursementApi.invoices();
        setInvoices((response.data || []).filter((invoice) => invoice.is_archived));
      } catch (err) {
        console.error('Failed to fetch archived invoices', err);
        setInvoices([]);
      }
    })();
  }, []);

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await reimbursementApi.deleteInvoice(deleteTarget.id);
      setInvoices((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err?.response?.data?.detail || 'Could not delete this invoice.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Archive size={20} />
          </span>
          <div>
            <h1 className="text-lg font-bold text-ink">Archived Invoices</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Invoices attached to a claim that&apos;s in approval, already paid, or was rejected. Re-upload the
              same file on the Upload Invoices page to use it on a new claim.
            </p>
          </div>
        </div>
        <Link className="btn-secondary flex-none" to="/invoices">
          Back to Upload Invoices
        </Link>
      </div>

      {deleteError ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertCircle size={15} className="flex-none" /> {deleteError}
        </div>
      ) : null}

      {invoices === null ? null : invoices.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="No archived invoices"
          description="Invoices move here once their claim enters approval, gets paid, or is rejected."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {invoices.map((invoice) => {
            const Icon = fileIcon(invoice);

            return (
              <article key={invoice.id} className="panel rounded-xl border border-slate-100 bg-slate-50/40 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-slate-100 p-3 text-slate-500">
                    <Icon size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink" title={invoice.original_filename}>
                      {invoice.original_filename}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <span>{(invoice.file_size_bytes / 1024).toFixed(1)} KB</span>
                      <ReimbursementCategoryBadge category={invoice.reimbursement_category} />
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-500">
                  {invoice.linked_claim_reference || (invoice.linked_claim_id ? `Claim #${invoice.linked_claim_id}` : 'Claim')} ·{' '}
                  {humanizeClaimStatus(invoice.linked_claim_status)}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                  <Link className="text-sm font-semibold text-brand hover:underline" to={`/invoices/${invoice.id}/review`}>
                    View
                  </Link>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-300" title="No longer usable on a new claim — re-upload the file to reuse it">
                      <Lock size={15} />
                    </span>
                    {invoice.can_delete && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError('');
                          setDeleteTarget(invoice);
                        }}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete ${invoice.original_filename}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this invoice?"
        description={
          deleteTarget ? `"${deleteTarget.original_filename}" will be permanently removed. This can't be undone.` : ''
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        confirmVariant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
