import {
  AlertCircle,
  Archive,
  Camera,
  ClipboardList,
  FileImage,
  FileText,
  Lock,
  Plane,
  Plus,
  ReceiptIndianRupee,
  Search,
  Trash2,
  Truck,
  UploadCloud,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { useSetPageTitle } from '../context/PageTitleContext';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { reimbursementApi } from '../services/reimbursementApi';
import { claimNewPath } from '../utils/claimRoutes';
import { formatDate } from '../utils/formatters';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_INVOICES = 30;

const UPLOAD_CATEGORIES = [
  {
    value: 'TRAVEL',
    label: 'Travel claim',
    short: 'Travel',
    description: 'Bills from a work trip: tickets, hotel, taxis, meals on the road',
    icon: Plane,
    tone: 'bg-sky-50 text-sky-700',
  },
  {
    value: 'GENERAL',
    label: 'General reimbursement',
    short: 'General',
    description: 'Work expenses with no trip: software, office supplies, local travel',
    icon: ClipboardList,
    tone: 'bg-indigo-50 text-indigo-700',
  },
  {
    value: 'RELOCATION',
    label: 'Relocation',
    short: 'Relocation',
    description: 'Moving to a new posting: packing, shifting, temporary stay',
    icon: Truck,
    tone: 'bg-fuchsia-50 text-fuchsia-700',
  },
];
const CATEGORY = Object.fromEntries(UPLOAD_CATEGORIES.map((c) => [c.value, c]));

const CLAIM_STATE = {
  SUBMITTED: 'Submitted',
  IN_APPROVAL: 'In approval',
  PENDING_EXCEPTION: 'Exception review',
  SENT_BACK: 'Sent back',
  READY_FOR_PAYMENT: 'Approved',
  ON_HOLD: 'On hold',
};

const PILL = {
  ok: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  slate: 'bg-slate-100 text-slate-500',
  sky: 'bg-sky-50 text-sky-700',
};

const inr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function isRealInvoiceId(id) {
  return !String(id).startsWith('temp-');
}

/** A foreign bill keeps its original amount in the extraction note: "(NZD 1397.25)". */
function foreignAmount(invoice) {
  const match = /\(([A-Z]{3}) ([\d.,]+)\)/.exec(invoice.extraction_error || '');
  if (!match) return null;
  return `${match[1]} ${Number(match[2].replace(/,/g, '')).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Only reviewed invoices that aren't on a claim yet can go on a new one. */
function isClaimable(invoice) {
  return isRealInvoiceId(invoice.id) && invoice.status === 'REVIEWED' && !invoice.linked_claim_id;
}

/** Where an invoice stands, in plain words: { tone, pill, note, locked }. */
function standing(invoice) {
  if (invoice.status === 'UPLOADING' || invoice.status === 'PROCESSING') {
    return { tone: 'sky', pill: 'Reading…', note: 'Pulling out the amount, GST and vendor' };
  }
  if (invoice.status === 'ERROR' && !isRealInvoiceId(invoice.id)) {
    return { tone: 'rose', pill: 'Upload failed', note: 'It never reached us — try uploading it again' };
  }
  if (invoice.status === 'ERROR') return { tone: 'rose', pill: "Couldn't read", note: 'Open it to fill in the details yourself' };
  if (invoice.status === 'READY_FOR_REVIEW') {
    return { tone: 'amber', pill: 'Needs your review', note: foreignAmount(invoice) ? 'Check the ₹ conversion' : 'Check what we read' };
  }
  if (invoice.linked_claim_id && invoice.linked_claim_status === 'DRAFT') {
    return { tone: 'slate', pill: `In draft ${invoice.linked_claim_reference || ''}`.trim(), note: '' };
  }
  if (invoice.linked_claim_id) {
    return {
      tone: 'amber',
      pill: `On ${invoice.linked_claim_reference || 'a claim'}`,
      note: CLAIM_STATE[invoice.linked_claim_status] || '',
      // Locked (can't be edited) once the claim is in approval or later — the backend's rule.
      locked: Boolean(invoice.is_locked),
    };
  }
  return { tone: 'ok', pill: 'Ready to claim', note: '' };
}

function fileSize(bytes) {
  const kb = Number(bytes || 0) / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
}

const TABS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'ready', label: 'Ready to claim', match: (i) => isClaimable(i) },
  { key: 'onclaim', label: 'On a claim', match: (i) => Boolean(i.linked_claim_id) },
  ...UPLOAD_CATEGORIES.map((c) => ({ key: c.value, label: c.short, match: (i) => i.reimbursement_category === c.value })),
];

export default function InvoiceUpload() {
  useSetPageTitle('Upload Invoices');
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [message, setMessage] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(null);
  const [pendingCategory, setPendingCategory] = useState('TRAVEL');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [picked, setPicked] = useState(() => new Set());
  const [releasingId, setReleasingId] = useState(null);
  const [releaseError, setReleaseError] = useState('');

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

  // Tabs and search only change what's listed — the upload capacity and the picked invoices
  // still count every active invoice, since those aren't a "view" concern.
  const searchQuery = search.trim().toLowerCase();
  const activeTab = TABS.find((t) => t.key === tab) || TABS[0];
  const filteredInvoices = activeInvoices.filter((invoice) => {
    if (!activeTab.match(invoice)) return false;
    if (searchQuery && !(invoice.original_filename || '').toLowerCase().includes(searchQuery)) return false;
    return true;
  });
  const hasActiveFilters = Boolean(search) || tab !== 'all';
  const clearFilters = () => {
    setSearch('');
    setTab('all');
  };

  const { run, error } = useAsyncAction(async (files, category) => {
    const selected = Array.from(files).slice(0, MAX_INVOICES - activeInvoices.length);
    if (selected.length === 0) return;

    // Create unique placeholders for files in this batch
    const placeholders = selected.map((file, idx) => ({
      id: `temp-${Date.now()}-${idx}-${file.name}`,
      original_filename: file.name,
      file_size_bytes: file.size,
      status: 'UPLOADING',
      reimbursement_category: category,
      created_at: new Date().toISOString(),
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
        setInvoices((current) => current.map((item) => (item.id === placeholder.id ? actualInvoice : item)));
      } catch {
        // Mark placeholder with error status
        setInvoices((current) => current.map((item) => (item.id === placeholder.id ? { ...item, status: 'ERROR' } : item)));
      }
    }

    if (uploaded.length) {
      setMessage(`${uploaded.length} invoice${uploaded.length > 1 ? 's' : ''} uploaded.`);
    }
  });

  // Picked invoices go on a new claim together. A claim takes one type of invoice (each claim
  // form only accepts its own type), so once one is picked, the other types can't be.
  const pickedInvoices = activeInvoices.filter((invoice) => picked.has(invoice.id) && isClaimable(invoice));
  const pickedType = pickedInvoices[0]?.reimbursement_category || null;
  const togglePick = (invoice) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(invoice.id)) next.delete(invoice.id);
      else next.add(invoice.id);
      return next;
    });
  const startClaim = () => {
    if (!pickedType) return;
    navigate(claimNewPath(pickedType, { invoiceIds: pickedInvoices.map((invoice) => invoice.id).join(',') }));
  };

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
    if (isMobile || atCapacity) return;
    if (event.dataTransfer?.files?.length) handleFilesSelected(event.dataTransfer.files);
  };

  const confirmUpload = () => {
    if (!pendingFiles) return;
    run(pendingFiles, pendingCategory);
    setPendingFiles(null);
  };

  const releaseFromDraft = async (invoice) => {
    setReleaseError('');
    setReleasingId(invoice.id);
    try {
      const res = await reimbursementApi.releaseInvoiceFromDraft(invoice.id);
      // Merge the (lightweight) updated invoice in place — no fields/line_items here, and
      // no need to reload the whole list just to clear this one invoice's claim link.
      setInvoices((current) => current.map((item) => (item.id === invoice.id ? { ...item, ...res.data } : item)));
    } catch (err) {
      setReleaseError(err?.response?.data?.detail || 'Could not remove this invoice from its draft claim.');
    } finally {
      setReleasingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await reimbursementApi.deleteInvoice(deleteTarget.id);
      setInvoices((current) => current.filter((item) => item.id !== deleteTarget.id));
      setPicked((current) => {
        const next = new Set(current);
        next.delete(deleteTarget.id);
        return next;
      });
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err?.response?.data?.detail || 'Could not delete this invoice.');
    } finally {
      setDeleting(false);
    }
  };

  const tabCounts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, activeInvoices.filter(t.match).length])), [activeInvoices]);
  const ready = activeInvoices.filter(isClaimable);
  const onClaimCount = activeInvoices.filter((i) => i.linked_claim_id).length;
  const foreignCount = activeInvoices.filter((i) => foreignAmount(i)).length;

  const renderRow = (invoice) => {
    const reading = invoice.status === 'UPLOADING' || invoice.status === 'PROCESSING';
    const s = standing(invoice);
    const claimable = isClaimable(invoice);
    const otherType = Boolean(pickedType) && invoice.reimbursement_category !== pickedType;
    const isPdf = (invoice.original_filename || '').toLowerCase().endsWith('.pdf') || invoice.content_type === 'application/pdf';
    const ext = isPdf ? 'PDF' : (invoice.original_filename || '').split('.').pop()?.toUpperCase().slice(0, 4) || '';
    const Icon = isPdf ? FileText : FileImage;
    const cat = CATEGORY[invoice.reimbursement_category];
    const foreign = foreignAmount(invoice);
    const isInDraft = invoice.linked_claim_id && invoice.linked_claim_status === 'DRAFT';
    const canDelete = isRealInvoiceId(invoice.id) && !reading && invoice.can_delete !== false;
    const total = invoice.total_amount != null && invoice.total_amount !== '' ? Number(invoice.total_amount) : null;
    const pickTitle = !claimable
      ? 'Only reviewed invoices that are not on a claim yet can go on a new claim'
      : otherType
        ? 'A claim takes one type of invoice'
        : 'Add to a new claim';

    return (
      <div
        key={invoice.id}
        className={`grid grid-cols-[22px_36px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-slate-100 px-4 py-[11px] first:border-t-0 lg:grid-cols-[22px_36px_minmax(0,1.6fr)_104px_minmax(0,1.3fr)_150px_128px] ${
          picked.has(invoice.id) ? 'bg-emerald-50/50' : 'hover:bg-[#fbfdfc]'
        } ${claimable && otherType ? 'opacity-45' : ''} ${reading ? 'animate-pulse' : ''}`}
      >
        <input
          type="checkbox"
          className="row-span-3 mt-2.5 h-4 w-4 cursor-pointer self-start accent-brand disabled:cursor-not-allowed lg:row-span-1 lg:mt-0 lg:self-center"
          checked={picked.has(invoice.id)}
          disabled={!claimable || otherType}
          onChange={() => togglePick(invoice)}
          aria-label={`Pick ${invoice.original_filename}`}
          title={pickTitle}
        />
        <div className="relative row-span-3 flex h-9 w-9 items-center justify-center self-start rounded-[10px] bg-slate-100 text-slate-500 lg:row-span-1 lg:self-center">
          <Icon size={16} />
          {ext ? (
            <span className="absolute -bottom-1 -right-1 rounded border border-slate-200 bg-white px-[3px] text-[8.5px] font-extrabold text-slate-500">{ext}</span>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-extrabold text-ink" title={invoice.original_filename}>
            {invoice.original_filename}
          </div>
          <div className="flex items-center gap-1.5 truncate text-xs text-slate-500">
            {invoice.created_at ? `Uploaded ${formatDate(invoice.created_at).replace(/ \d{4}$/, '')} · ` : ''}
            {fileSize(invoice.file_size_bytes)}
          </div>
        </div>
        {/* Top-right on narrow screens; its own column after "where it stands" on wide ones. */}
        <div className="text-right lg:order-6">
          <AmountCell total={total} foreign={foreign} />
        </div>
        <span className={`order-last col-start-3 justify-self-start whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold lg:order-4 lg:col-start-auto ${cat?.tone || PILL.slate}`}>
          {cat?.short || '—'}
        </span>
        <div className="col-span-2 col-start-3 flex min-w-0 flex-col gap-[3px] lg:order-5 lg:col-span-1 lg:col-start-auto">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${PILL[s.tone]}`}>
              {s.locked ? <Lock size={11} /> : null}
              {s.pill}
            </span>
            {invoice.duplicate_invoice_id && !invoice.duplicate_acknowledged ? (
              <span className="whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">Possible duplicate</span>
            ) : null}
          </div>
          {s.note ? <span className="truncate text-[11.5px] text-slate-500">{s.note}</span> : null}
        </div>
        <div className="order-last flex items-center justify-end gap-0.5 lg:order-7">
          {!isRealInvoiceId(invoice.id) && invoice.status === 'ERROR' ? (
            <button
              type="button"
              onClick={() => setInvoices((current) => current.filter((item) => item.id !== invoice.id))}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label={`Dismiss ${invoice.original_filename}`}
              title="Dismiss"
            >
              <X size={15} />
            </button>
          ) : null}
          {reading || !isRealInvoiceId(invoice.id) ? null : (
            <Link
              to={`/invoices/${invoice.id}/review`}
              className={`inline-flex h-7 items-center whitespace-nowrap rounded-lg px-2.5 text-[11.5px] font-bold ${
                invoice.status === 'READY_FOR_REVIEW' ? 'bg-brand text-white hover:bg-brand/90' : 'text-brand hover:bg-brand/5'
              }`}
            >
              {invoice.status === 'READY_FOR_REVIEW' ? 'Review' : 'Open'}
            </Link>
          )}
          {isInDraft ? (
            <button
              type="button"
              onClick={() => releaseFromDraft(invoice)}
              disabled={releasingId === invoice.id}
              className="whitespace-nowrap px-1.5 text-[11.5px] font-bold text-amber-700 hover:underline disabled:opacity-50"
            >
              {releasingId === invoice.id ? 'Removing…' : 'Remove from draft'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDeleteError('');
                setDeleteTarget(invoice);
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 ${canDelete ? '' : 'invisible'}`}
              aria-label={`Delete ${invoice.original_filename}`}
              title="Delete"
              disabled={!canDelete}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const pickedTotal = pickedInvoices.reduce((a, i) => a + Number(i.total_amount || 0), 0);
  const pickedCategory = CATEGORY[pickedType];
  const PickedIcon = pickedCategory?.icon || Plane;

  return (
    <section className={`flex flex-col gap-3.5 ${pickedInvoices.length ? 'pb-24' : ''}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Upload Invoices</h1>
          <p className="mt-0.5 max-w-[70ch] text-[13px] text-slate-500">
            Add bills and receipts here. We read the amount, GST and vendor for you; then put them on a claim.
          </p>
        </div>
        {archivedInvoices.length ? (
          <Link className="btn-secondary inline-flex items-center gap-1.5" to="/invoices/archived">
            <Archive size={14} />
            Archived ({archivedInvoices.length})
          </Link>
        ) : null}
      </div>

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          if (!isMobile && !atCapacity) setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={handleDrop}
        className={`grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3.5 rounded-[14px] border-[1.5px] border-dashed px-4 py-3.5 transition-colors md:grid-cols-[44px_minmax(0,1fr)_auto] ${
          dragActive ? 'border-brand bg-brand/10' : 'border-brand/30 bg-white'
        } ${atCapacity ? 'opacity-60' : ''}`}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <UploadCloud size={20} />
        </span>
        <div className="min-w-0">
          <b className="block text-sm text-ink">
            {atCapacity ? 'Upload limit reached' : dragActive ? 'Drop to upload' : isMobile ? 'Add bills and receipts' : 'Drop bills here, or choose files'}
          </b>
          <span className="text-xs text-slate-500">
            {atCapacity
              ? `You can keep up to ${MAX_INVOICES} invoices that aren't on a claim. Put some on a claim or delete ones you don't need.`
              : 'JPEG, PNG, HEIC or PDF · up to 10 MB each · you can pick several at once'}
          </span>
        </div>
        <div className="col-span-2 flex flex-wrap items-center justify-between gap-3.5 md:col-span-1 md:justify-end">
          <div className="flex min-w-[128px] flex-col gap-1 text-[11.5px] text-slate-500">
            <span>
              <b className="text-ink">
                {activeInvoices.length} of {MAX_INVOICES}
              </b>{' '}
              slots used
            </span>
            <span className="h-[5px] overflow-hidden rounded-full bg-slate-100">
              <i className="block h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </span>
          </div>
          {isMobile ? (
            <div className="flex gap-2">
              <label className={`btn-primary ${atCapacity ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
                <Camera size={16} /> Take photo
                <input
                  className="hidden"
                  multiple
                  capture="environment"
                  type="file"
                  accept="image/*"
                  disabled={atCapacity}
                  onChange={(event) => handleFilesSelected(event.target.files)}
                />
              </label>
              <label className={`btn-secondary ${atCapacity ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
                Gallery
                <input
                  className="hidden"
                  multiple
                  type="file"
                  accept=".jpg,.jpeg,.png,.heic,.pdf"
                  disabled={atCapacity}
                  onChange={(event) => handleFilesSelected(event.target.files)}
                />
              </label>
            </div>
          ) : (
            <label className={`btn-primary inline-flex items-center gap-1.5 ${atCapacity ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
              <Plus size={15} /> Select files
              <input
                className="hidden"
                multiple
                type="file"
                accept=".jpg,.jpeg,.png,.heic,.pdf"
                disabled={atCapacity}
                onChange={(event) => handleFilesSelected(event.target.files)}
              />
            </label>
          )}
        </div>
      </div>

      {message ? <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{message}</div> : null}
      {[error?.message, deleteError, releaseError].filter(Boolean).map((text) => (
        <div key={text} className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertCircle size={15} className="flex-none" /> {text}
        </div>
      ))}

      {activeInvoices.length > 0 ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-2.5 border-b border-slate-200">
            <div className="flex flex-wrap gap-0.5" role="tablist" aria-label="Show invoices">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-[9px] text-[12.5px] font-bold ${
                    tab === t.key ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.label}
                  <span className={`rounded-full px-[7px] py-px text-[10.5px] ${tab === t.key ? 'bg-brand/10 text-brand' : 'bg-slate-100 text-slate-500'}`}>
                    {tabCounts[t.key]}
                  </span>
                </button>
              ))}
            </div>
            <div className="relative mb-1.5 w-full sm:w-60">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="h-[34px] w-full rounded-[9px] border border-slate-200 bg-white pl-8 pr-8 text-[12.5px] text-ink focus:border-brand focus:outline-none"
                placeholder="Search by file name"
                aria-label="Search invoices"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-[18px] gap-y-1 px-0.5 text-[12.5px] text-slate-500">
            <span>
              Ready to claim: <b className="font-mono font-semibold text-ink">{inr(ready.reduce((a, i) => a + Number(i.total_amount || 0), 0))}</b> across{' '}
              {ready.length} invoice{ready.length === 1 ? '' : 's'}
            </span>
            {onClaimCount ? <span>On a claim: {onClaimCount}</span> : null}
            {foreignCount ? <span>{foreignCount} foreign-currency bill{foreignCount === 1 ? '' : 's'}, shown in ₹</span> : null}
          </div>
        </>
      ) : null}

      {invoices.length === 0 ? (
        <EmptyState
          icon={ReceiptIndianRupee}
          title="No invoices yet"
          description="Upload your first bill above. We'll read the amount, GST and vendor for you."
        />
      ) : activeInvoices.length === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <EmptyState
            icon={Archive}
            title="All your invoices are archived"
            description="Every invoice you've uploaded is on a claim that's been paid or was rejected."
          />
          <Link className="btn-secondary" to="/invoices/archived">
            View Archived Invoices
          </Link>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <EmptyState icon={Search} title="No invoices match" description="Try another name or tab, or clear the filters to see everything again." />
          {hasActiveFilters ? (
            <button type="button" className="btn-secondary" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <section aria-label="Your invoices" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
          <div className="hidden grid-cols-[22px_36px_minmax(0,1.6fr)_104px_minmax(0,1.3fr)_150px_128px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-slate-400 lg:grid">
            <span />
            <span />
            <span>Invoice</span>
            <span>Type</span>
            <span>Where it stands</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {filteredInvoices.map(renderRow)}
        </section>
      )}

      {pickedInvoices.length ? (
        <div className="fixed bottom-[76px] left-1/2 z-40 flex md:bottom-4 w-[min(760px,calc(100%-32px))] -translate-x-1/2 flex-wrap items-center gap-3 rounded-[14px] bg-ink py-2.5 pl-[18px] pr-3 text-[13px] text-slate-200 shadow-[0_12px_32px_rgba(15,23,42,.28)]">
          <span>
            <b className="text-white">
              {pickedInvoices.length} {pickedCategory?.short.toLowerCase()} invoice{pickedInvoices.length > 1 ? 's' : ''}
            </b>{' '}
            picked · <span className="font-mono font-semibold text-white">{inr(pickedTotal)}</span>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            className="h-7 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-[11.5px] font-bold text-slate-200 hover:bg-slate-700"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={startClaim}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[11.5px] font-bold text-ink hover:bg-slate-100"
          >
            <PickedIcon size={14} /> Start {pickedCategory?.label} with these
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this invoice?"
        description={deleteTarget ? `"${deleteTarget.original_filename}" will be permanently removed. This can't be undone.` : ''}
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

function AmountCell({ total, foreign }) {
  return (
    <>
      <div className="font-mono text-[13.5px] font-semibold text-ink">{total == null ? <span className="text-slate-300">—</span> : inr(total)}</div>
      {foreign ? <div className="text-[11px] font-semibold text-slate-500">from {foreign}</div> : null}
    </>
  );
}

function UploadCategoryModal({ files, category, onSelectCategory, onConfirm, onCancel }) {
  const open = Boolean(files?.length);
  useBodyScrollLock(open);

  if (!open) return null;
  const names = Array.from(files).map((f) => f.name);

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-900/40 p-4">
      <div className="w-full max-w-[560px] rounded-2xl bg-white p-5 shadow-[0_24px_48px_rgba(15,23,42,.25)]" role="dialog" aria-modal="true" aria-labelledby="upload-category-title">
        <h3 id="upload-category-title" className="text-base font-bold text-ink">
          What {files.length > 1 ? `are these ${files.length} invoices` : 'is this invoice'} for?
        </h3>
        <p className="mt-1 text-[12.5px] text-slate-500">This decides which kind of claim {files.length > 1 ? 'they' : 'it'} can go on.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {names.slice(0, 6).map((name, i) => (
            <span key={`${name}-${i}`} className="max-w-[240px] truncate rounded-md bg-slate-100 px-2 py-[3px] text-[11.5px] text-slate-700" title={name}>
              {name}
            </span>
          ))}
          {names.length > 6 ? <span className="px-1 py-[3px] text-[11.5px] text-slate-500">+{names.length - 6} more</span> : null}
        </div>
        <div className="mt-3.5 grid gap-2" role="radiogroup" aria-label="Invoice type">
          {UPLOAD_CATEGORIES.map((option) => {
            const Icon = option.icon;
            const on = category === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onSelectCategory(option.value)}
                className={`grid grid-cols-[36px_minmax(0,1fr)_18px] items-center gap-3 rounded-xl border-[1.5px] px-3 py-[11px] text-left transition-colors ${
                  on ? 'border-brand bg-emerald-50/40' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${option.tone}`}>
                  <Icon size={16} />
                </span>
                <span className="min-w-0">
                  <b className="block text-[13px] text-ink">{option.label}</b>
                  <span className="text-xs text-slate-500">{option.description}</span>
                </span>
                <span className={`h-[18px] w-[18px] rounded-full ${on ? 'border-[5px] border-brand' : 'border-2 border-slate-200'}`} />
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm}>
            Upload {files.length} file{files.length > 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
