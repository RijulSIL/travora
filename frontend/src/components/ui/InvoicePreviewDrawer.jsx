import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { reimbursementApi } from '../../services/reimbursementApi';
import { formatCurrency, formatDate } from '../../utils/formatters';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';

export default function InvoicePreviewDrawer({ open, onClose, invoice }) {
  const [extraction, setExtraction] = useState(null);
  const [fileUrl, setFileUrl] = useState('');
  const [tab, setTab] = useState('preview');
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open || !invoice?.id) return;
    let mounted = true;
    let nextUrl = '';
    (async () => {
      const [exRes, fileRes] = await Promise.all([
        reimbursementApi.invoiceExtraction(invoice.id),
        reimbursementApi.invoiceFileBlob(invoice.id),
      ]);
      if (!mounted) return;
      setExtraction(exRes.data);
      const blob = new Blob([fileRes.data], { type: fileRes.headers['content-type'] || 'application/octet-stream' });
      nextUrl = URL.createObjectURL(blob);
      setFileUrl(nextUrl);
    })().catch(() => {
      setExtraction(null);
      setFileUrl('');
    });
    return () => {
      mounted = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [open, invoice?.id]);

  const isPdf = useMemo(() => (invoice?.content_type || '').includes('pdf') || (invoice?.original_filename || '').toLowerCase().endsWith('.pdf'), [invoice]);

  if (!open || !invoice) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 transition-opacity" onClick={onClose}>
      <div className="absolute top-0 right-0 h-full w-full max-w-5xl overflow-y-auto bg-white p-5 shadow-xl animate-in slide-in-from-right outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">Invoice Preview</h3>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mb-3 flex gap-2 md:hidden">
          <button className={`btn-secondary ${tab === 'preview' ? 'ring-2 ring-brand/30' : ''}`} onClick={() => setTab('preview')}>Preview</button>
          <button className={`btn-secondary ${tab === 'data' ? 'ring-2 ring-brand/30' : ''}`} onClick={() => setTab('data')}>Extracted Data</button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className={`rounded border border-line p-3 ${tab === 'preview' ? 'block' : 'hidden'} md:block`}>
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">File Preview</div>
            <div className="h-[60vh] overflow-hidden rounded border border-line">
              {!fileUrl ? (
                <div className="p-4 text-sm text-slate-500">Loading preview...</div>
              ) : isPdf ? (
                <iframe title="Invoice file" src={`${fileUrl}#toolbar=0`} className="h-full w-full border-0" />
              ) : (
                <img src={fileUrl} alt={invoice.original_filename} className="h-full w-full object-contain" />
              )}
            </div>
            <div className="mt-2 text-xs text-slate-600">
              <div className="truncate font-medium" title={invoice.original_filename}>{invoice.original_filename}</div>
              <div>{Math.round((invoice.file_size_bytes || 0) / 1024)} KB</div>
              <div>{invoice.created_at ? formatDate(invoice.created_at) : '-'}</div>
            </div>
            {fileUrl ? (
              <a href={fileUrl} download={invoice.original_filename} className="btn-secondary mt-3">
                Download
              </a>
            ) : null}
          </div>
          <div className={`rounded border border-line p-3 ${tab === 'data' ? 'block' : 'hidden'} md:block`}>
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Extracted Data</div>
            {!extraction ? (
              <div className="text-sm text-slate-500">Loading extracted fields...</div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                      <th className="px-4 py-3">Field</th>
                      <th className="px-4 py-3">Value</th>
                      <th className="px-4 py-3 text-right">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(extraction.fields || []).map((field) => {
                      const conf = Number(field.confidence);
                      const badgeColor = conf > 90
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : conf >= 60
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-red-50 text-red-700 border-red-200';

                      return (
                        <tr key={field.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-3 font-medium text-slate-700">
                            {field.field_key.replace(/_/g, ' ')}
                          </td>
                          <td className="px-4 py-3 text-ink">
                            {field.final_value || field.original_value || '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badgeColor}`}>
                              {conf.toFixed(0)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="bg-slate-50 px-4 py-3 border-t border-line text-xs font-medium text-slate-600">
                  Status: <span className="text-ink">{invoice.status}</span> · Total: <span className="text-ink">{formatCurrency(invoice.total_amount || 0)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
