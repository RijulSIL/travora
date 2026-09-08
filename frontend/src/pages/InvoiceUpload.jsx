import { FileText, UploadCloud } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useSetPageTitle } from '../context/PageTitleContext';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { reimbursementApi } from '../services/reimbursementApi';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_INVOICES = 30;

function statusClass(status) {
  if (status === 'READY_FOR_REVIEW' || status === 'REVIEWED') return 'bg-emerald-100 text-emerald-700';
  if (status === 'ERROR') return 'bg-red-100 text-red-700';
  if (status === 'UPLOADING') return 'bg-blue-50 text-blue-700 animate-pulse';
  return 'bg-amber-100 text-amber-700';
}

export default function InvoiceUpload() {
  useSetPageTitle('Upload Invoices');
  const [invoices, setInvoices] = useState([]);
  const [message, setMessage] = useState('');

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
  
  const { run, loading, error } = useAsyncAction(async (files) => {
    const selected = Array.from(files).slice(0, MAX_INVOICES - invoices.length);
    if (selected.length === 0) return;

    // Create unique placeholders for files in this batch
    const placeholders = selected.map((file, idx) => ({
      id: `temp-${Date.now()}-${idx}-${file.name}`,
      original_filename: file.name,
      file_size_bytes: file.size,
      status: 'UPLOADING',
    }));

    // Put placeholders in state immediately
    setInvoices((current) => [...placeholders, ...current].slice(0, MAX_INVOICES));

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

  // Filter out any temporary uploading placeholders from draft link
  const invoiceIds = invoices
    .filter((invoice) => !String(invoice.id).startsWith('temp-'))
    .map((invoice) => invoice.id)
    .join(',');

  return (
      <section className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-600">
              Upload receipts for your trip. The AI extraction pipeline will pre-fill review fields.
            </p>
          </div>
          <Link className="btn-secondary" to="/dashboard">
            Back home
          </Link>
        </div>

        <div className="flex flex-col items-center rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 p-6 text-center">
          <UploadCloud className="mb-3 text-brand" size={36} />
          <span className="text-sm font-semibold text-brand">Upload invoices</span>
          <span className="mt-1 text-xs text-slate-500">
            JPEG, PNG, HEIC, PDF · Max 10 MB each · Up to 30 invoices
          </span>
          {isMobile ? (
            <div className="mt-4 flex w-full flex-col gap-2">
              <label className="btn-primary cursor-pointer">
                📷 Take Photo
                <input
                  className="hidden"
                  multiple
                  capture="environment"
                  type="file"
                  accept="image/*"
                  disabled={loading || invoices.length >= MAX_INVOICES}
                  onChange={(event) => run(event.target.files)}
                />
              </label>
              <label className="btn-secondary cursor-pointer">
                Upload from Gallery
                <input
                  className="hidden"
                  multiple
                  type="file"
                  accept=".jpg,.jpeg,.png,.heic,.pdf"
                  disabled={loading || invoices.length >= MAX_INVOICES}
                  onChange={(event) => run(event.target.files)}
                />
              </label>
            </div>
          ) : (
            <label className="btn-primary mt-4 cursor-pointer">
              Select files
              <input
                className="hidden"
                multiple
                type="file"
                accept=".jpg,.jpeg,.png,.heic,.pdf"
                disabled={loading || invoices.length >= MAX_INVOICES}
                onChange={(event) => run(event.target.files)}
              />
            </label>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-white px-4 py-3 text-sm text-slate-600">
          <span>{invoices.length} of 30 invoices uploaded in this session</span>
          {invoiceIds ? (
            <Link className="btn-primary" to={`/claims/draft?invoiceIds=${invoiceIds}`}>
              Create reimbursement draft
            </Link>
          ) : null}
        </div>

        {message ? <div className="mt-3 text-sm text-slate-600">{message}</div> : null}
        {error ? <div className="mt-3 text-sm text-red-600">{error.message}</div> : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {invoices.map((invoice) => {
            const isUploading = invoice.status === 'UPLOADING';

            return (
              <article 
                key={invoice.id} 
                className={`panel rounded-lg p-4 transition-all duration-200 ${
                  isUploading ? 'opacity-60 cursor-not-allowed select-none shadow-sm' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-slate-100 p-3 text-slate-500 relative">
                    <FileText size={22} />
                    {isUploading && (
                      <span className="absolute inset-0 flex items-center justify-center bg-slate-150/80 rounded-lg">
                        <svg className="animate-spin h-4.5 w-4.5 text-brand" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">
                      {invoice.original_filename}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {(invoice.file_size_bytes / 1024).toFixed(1)} KB
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(invoice.status)}`}>
                    {invoice.status === 'UPLOADING' ? 'Uploading & Analysing...' : invoice.status.replaceAll('_', ' ')}
                  </span>
                  {isUploading ? (
                    <span className="text-sm font-semibold text-slate-400 select-none">Review</span>
                  ) : (
                    <Link className="text-sm font-semibold text-brand hover:underline" to={`/invoices/${invoice.id}/review`}>
                      Review
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
  );
}
