import {
  AlertCircle,
  Archive,
  Camera,
  CheckCircle2,
  FileImage,
  FileText,
  ReceiptIndianRupee,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import ReimbursementCategoryBadge from '../components/ui/ReimbursementCategoryBadge';
import { useSetPageTitle } from '../context/PageTitleContext';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { reimbursementApi } from '../services/reimbursementApi';
import { claimNewPath } from '../utils/claimRoutes';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_INVOICES = 30;

const UPLOAD_CATEGORIES = [
  { value: 'TRAVEL', label: 'Travel reimbursement', description: 'Linked to a trip' },
  { value: 'GENERAL', label: 'General reimbursement', description: 'Office expense, no trip' },
  { value: 'REALLOCATION', label: 'Reallocation', description: 'Trip-linked, reallocated spend' },
];

function statusClass(status) {
  if (status === 'READY_FOR_REVIEW' || status === 'REVIEWED') return 'bg-emerald-100 text-emerald-700';
  if (status === 'ERROR') return 'bg-red-100 text-red-700';
  if (status === 'UPLOADING') return 'bg-blue-50 text-blue-700 animate-pulse';
  return 'bg-amber-100 text-amber-700';
}

function statusIcon(status) {
  if (status === 'READY_FOR_REVIEW' || status === 'REVIEWED') return CheckCircle2;
  if (status === 'ERROR') return AlertCircle;
  return null;
}

function fileIcon(invoice) {
  const name = (invoice.original_filename || '').toLowerCase();
  if (name.endsWith('.pdf')) return FileText;
  return FileImage;
}

function isRealInvoiceId(id) {
  return !String(id).startsWith('temp-');
}

export default function InvoiceUpload() {
  useSetPageTitle('Upload Invoices');
  const [invoices, setInvoices] = useState([]);
  const [message, setMessage] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(null);
  const [pendingCategory, setPendingCategory] = useState('TRAVEL');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const response = await reimbursementApi.invoices();
        setInvoices(response.data || []);
      } catch (err) {
        console.error('Failed to fetch invoices', err);
      }
    })();
  }, []);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

  // The 30-invoice cap only applies to invoices still in active use — an archived one is
  // done with the upload workflow, so it shouldn't eat into the budget for new uploads.
  const activeInvoices = invoices.filter((invoice) => !invoice.is_archived);
  const archivedInvoices = invoices.filter((invoice) => invoice.is_archived);

  const { run, loading, error } = useAsyncAction(async (files, category) => {
    const selected = Array.from(files).slice(0, MAX_INVOICES - activeInvoices.length);
    if (selected.length === 0) return;

    // Create unique placeholders for files in this batch
    const placeholders = selected.map((file, idx) => ({
      id: `temp-${Date.now()}-${idx}-${file.name}`,
      original_filename: file.name,
      file_size_bytes: file.size,
      status: 'UPLOADING',
    }));

    // Put placeholders in state immediately — cap only the active ones so a full batch of
    // archived invoices never gets sliced out of view.
    setInvoices((current) => {
      const archived = current.filter((item) => item.is_archived);
      const active = [...placeholders, ...current.filter((item) => !item.is_archived)].slice(0, MAX_INVOICES);
      return [...active, ...archived];
    });

    const uploaded = [];
    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      const placeholder = placeholders[i];

      if (!ACCEPTED_TYPES.includes(file.type) || file.size > MAX_FILE_SIZE) {
        setMessage(`${file.name} skipped. Use JPEG, PNG, HEIC or PDF under 10 MB.`);
        // Remove placeholder from list
        setInvoices((current) => current.filter((item) => item.id !== placeholder.id));
        continue;
      }

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('reimbursement_category', category);
        const response = await reimbursementApi.uploadInvoice(formData);
        const actualInvoice = response.data;
        uploaded.push(actualInvoice);

        // Replace placeholder with actual invoice
        setInvoices((current) =>
          current.map((item) => (item.id === placeholder.id ? actualInvoice : item))
        );
      } catch (err) {
        // Mark placeholder with error status
        setInvoices((current) =>
          current.map((item) =>
            item.id === placeholder.id ? { ...item, status: 'ERROR' } : item
          )
        );
      }
    }

    if (uploaded.length) {
      setMessage(`${uploaded.length} invoice${uploaded.length > 1 ? 's' : ''} uploaded.`);
    }
  });

  // Filter out any temporary uploading placeholders and archived (already-claimed)
  // invoices from the draft link — archived ones can't be reused on a new claim.
  const draftEligibleInvoices = invoices.filter(
    (invoice) => !String(invoice.id).startsWith('temp-') && !invoice.is_archived,
  );
  const invoiceIds = draftEligibleInvoices.map((invoice) => invoice.id).join(',');
  // The General Reimbursement wizard's invoice picker takes both General- and
  // Reallocation-tagged invoices (see GeneralReimbursementWizard.jsx's visibleInvoices) — only
  // send the draft link there if every invoice about to be attached is one of those two;
  // otherwise default to the Travel flow, same as clicking "New Claim" directly.
  const draftIsAllGeneral =
    draftEligibleInvoices.length > 0 &&
    draftEligibleInvoices.every((invoice) => invoice.reimbursement_category === 'GENERAL' || invoice.reimbursement_category === 'REALLOCATION');

  const atCapacity = activeInvoices.length >= MAX_INVOICES;
  const progressPct = Math.min(100, Math.round((activeInvoices.length / MAX_INVOICES) * 100));

  // Files are staged here first — the category popup (below) confirms what they're for
  // before anything actually uploads, rather than requiring a choice made ahead of time.
  const handleFilesSelected = (files) => {
    if (!files?.length) return;
    setPendingCategory('TRAVEL');
    setPendingFiles(files);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    if (isMobile || loading || atCapacity) return;
    if (event.dataTransfer?.files?.length) handleFilesSelected(event.dataTransfer.files);
  };

  const confirmUpload = () => {
    if (!pendingFiles) return;
    run(pendingFiles, pendingCategory);
    setPendingFiles(null);
  };

  const renderInvoiceCard = (invoice) => {
    const isUploading = invoice.status === 'UPLOADING';
    const isError = invoice.status === 'ERROR';
    const Icon = fileIcon(invoice);
    const StatusIcon = statusIcon(invoice.status);

    return (
      <article
        key={invoice.id}
        className={`panel rounded-xl p-4 transition-all duration-200 ${
          isUploading
            ? 'opacity-60 cursor-not-allowed select-none shadow-sm'
            : isError
              ? 'border-red-200'
              : 'hover:-translate-y-0.5 hover:shadow-md'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`relative rounded-xl p-3 ${isError ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-500'}`}>
            <Icon size={22} />
            {isUploading && (
              <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80">
                <svg className="h-4.5 w-4.5 animate-spin text-brand" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink" title={invoice.original_filename}>
              {invoice.original_filename}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {(invoice.file_size_bytes / 1024).toFixed(1)} KB
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(invoice.status)}`}>
              {StatusIcon ? <StatusIcon size={12} /> : null}
              {invoice.status === 'UPLOADING' ? 'Uploading & analysing…' : invoice.status.replaceAll('_', ' ')}
            </span>
            {!isUploading ? <ReimbursementCategoryBadge category={invoice.reimbursement_category} /> : null}
          </div>
          {isUploading ? (
            <span className="select-none text-sm font-semibold text-slate-300">Review</span>
          ) : (
            <div className="flex items-center gap-1">
              <Link className="text-sm font-semibold text-brand hover:underline" to={`/invoices/${invoice.id}/review`}>
                Review
              </Link>
              {isRealInvoiceId(invoice.id) && (
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
          )}
        </div>
      </article>
    );
  };

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
            <span className="mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brand/10 text-brand">
              <ReceiptIndianRupee size={20} />
            </span>
            <div>
              <h1 className="text-lg font-bold text-ink">Upload Invoices</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Upload receipts for your trip — AI extraction will pre-fill the review fields for you.
              </p>
            </div>
          </div>
          <div className="flex flex-none items-center gap-2">
            {archivedInvoices.length ? (
              <Link className="btn-secondary inline-flex items-center gap-1.5" to="/invoices/archived">
                <Archive size={14} />
                Archived ({archivedInvoices.length})
              </Link>
            ) : null}
            <Link className="btn-secondary" to="/dashboard">
              Back home
            </Link>
          </div>
        </div>

        <div
          onDragEnter={(event) => {
            event.preventDefault();
            if (!isMobile && !loading && !atCapacity) setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={handleDrop}
          className={`relative flex flex-col items-center overflow-hidden rounded-2xl border-2 border-dashed p-5 text-center transition-all duration-200 ${
            dragActive
              ? 'scale-[1.01] border-brand bg-brand/5 shadow-md'
              : 'border-blue-200 bg-gradient-to-b from-blue-50/80 to-white hover:border-blue-300'
          } ${atCapacity ? 'opacity-60' : ''}`}
        >
          <span className={`mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-100 transition-transform duration-200 ${dragActive ? 'scale-110' : ''}`}>
            <UploadCloud className="text-brand" size={20} />
          </span>
          <span className="text-sm font-semibold text-ink">
            {atCapacity ? 'Upload limit reached' : dragActive ? 'Drop to upload' : 'Drag & drop invoices here'}
          </span>
          <span className="mt-0.5 text-xs text-slate-500">
            {atCapacity ? `You've uploaded the maximum of ${MAX_INVOICES} invoices this session.` : 'or choose files below'}
          </span>
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
            {['JPEG', 'PNG', 'HEIC', 'PDF'].map((type) => (
              <span key={type} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                {type}
              </span>
            ))}
            <span className="text-[11px] text-slate-400">· Max 10 MB each · Up to {MAX_INVOICES} invoices</span>
          </div>
          {isMobile ? (
            <div className="mt-3.5 flex w-full flex-col gap-2">
              <label className="btn-primary cursor-pointer">
                <Camera size={16} /> Take Photo
                <input
                  className="hidden"
                  multiple
                  capture="environment"
                  type="file"
                  accept="image/*"
                  disabled={loading || atCapacity}
                  onChange={(event) => handleFilesSelected(event.target.files)}
                />
              </label>
              <label className="btn-secondary cursor-pointer">
                Upload from Gallery
                <input
                  className="hidden"
                  multiple
                  type="file"
                  accept=".jpg,.jpeg,.png,.heic,.pdf"
                  disabled={loading || atCapacity}
                  onChange={(event) => handleFilesSelected(event.target.files)}
                />
              </label>
            </div>
          ) : (
            <label className={`btn-primary mt-3.5 ${atCapacity ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
              Select files
              <input
                className="hidden"
                multiple
                type="file"
                accept=".jpg,.jpeg,.png,.heic,.pdf"
                disabled={loading || atCapacity}
                onChange={(event) => handleFilesSelected(event.target.files)}
              />
            </label>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-sm text-slate-600">
              <span className="font-semibold text-ink">{activeInvoices.length}</span> of {MAX_INVOICES} invoices uploaded
            </span>
          </div>
          {invoiceIds ? (
            <Link
              className="btn-primary"
              to={`${claimNewPath(draftIsAllGeneral ? 'GENERAL' : 'TRAVEL')}?invoiceIds=${invoiceIds}`}
            >
              Create reimbursement draft
            </Link>
          ) : null}
        </div>

        {message ? (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{message}</div>
        ) : null}
        {error ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle size={15} className="flex-none" /> {error.message}
          </div>
        ) : null}
        {deleteError ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle size={15} className="flex-none" /> {deleteError}
          </div>
        ) : null}

        {invoices.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon={ReceiptIndianRupee}
              title="No invoices yet"
              description="Upload your first receipt above to get started — the AI extraction pipeline will read the details for you."
            />
          </div>
        ) : activeInvoices.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-4">
            <EmptyState
              icon={Archive}
              title="All your invoices are archived"
              description="Every invoice you've uploaded is attached to a claim that's in approval, paid, or was rejected."
            />
            <Link className="btn-secondary" to="/invoices/archived">
              View Archived Invoices
            </Link>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeInvoices.map((invoice) => renderInvoiceCard(invoice))}
          </div>
        )}

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="Delete this invoice?"
          description={
            deleteTarget
              ? `"${deleteTarget.original_filename}" will be permanently removed. This can't be undone.`
              : ''
          }
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          confirmVariant="danger"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />

        <UploadCategoryModal
          files={pendingFiles}
          category={pendingCategory}
          onSelectCategory={setPendingCategory}
          onConfirm={confirmUpload}
          onCancel={() => setPendingFiles(null)}
        />
      </section>
  );
}

function UploadCategoryModal({ files, category, onSelectCategory, onConfirm, onCancel }) {
  const open = Boolean(files?.length);
  useBodyScrollLock(open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-900/40 p-4">
      <div className="panel w-full max-w-lg p-5">
        <h3 className="text-base font-semibold text-ink">What are these invoices for?</h3>
        <p className="mt-1 text-sm text-slate-500">
          Applies to the {files.length} file{files.length > 1 ? 's' : ''} you just selected.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {UPLOAD_CATEGORIES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelectCategory(option.value)}
              className={`rounded-lg border-2 p-2.5 text-left transition-all duration-150 cursor-pointer ${
                category === option.value
                  ? 'border-brand bg-brand/5'
                  : 'border-slate-150 bg-slate-50/50 hover:border-slate-300'
              }`}
            >
              <div className="text-xs font-bold text-slate-800">{option.label}</div>
              <div className="text-[10px] text-slate-500">{option.description}</div>
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" onClick={onConfirm}>
            Upload {files.length} file{files.length > 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
