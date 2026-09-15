import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plane, Train, Bus, FileText, CheckCircle2,
  ArrowRight, UploadCloud,
  Clock, AlertCircle
} from 'lucide-react';

import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';

function ModeIcon({ mode, className }) {
  if (mode === 'FLIGHT') return <Plane className={className} size={16} />;
  if (mode === 'TRAIN') return <Train className={className} size={16} />;
  if (mode === 'BUS') return <Bus className={className} size={16} />;
  return <FileText className={className} size={16} />;
}

const EMPTY_UPLOAD_FIELDS = {
  file: null,
  pnr_or_booking_ref: '',
  ticket_amount: '',
  ticket_travel_class: '',
  provider: '',
  reference_id: '',
  external_booking_source: '',
  notes_for_employee: '',
};

function SegmentUploadForm({ seg, fields, onChange, onSubmit, busy, isOnlySegment }) {
  return (
    <form className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 space-y-3" onSubmit={onSubmit}>
      <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
        <ModeIcon mode={seg.mode} className="text-slate-400" />
        <span>{seg.label}</span>
      </div>

      <div className="space-y-1">
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ticket File *</span>
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.heic"
          required
          className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          onChange={(e) => onChange({ file: e.target.files?.[0] || null })}
        />
      </div>

      <div className="space-y-1">
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">PNR / Booking Reference *</span>
        <input
          className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
          placeholder="Enter PNR or airline reference number"
          value={fields.pnr_or_booking_ref}
          onChange={(e) => onChange({ pnr_or_booking_ref: e.target.value })}
          required
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ticket Amount (₹) *</span>
          <input
            className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
            placeholder="e.g. 8500"
            value={fields.ticket_amount}
            onChange={(e) => onChange({ ticket_amount: e.target.value })}
            required
          />
        </div>

        <div className="space-y-1">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Cabin / Travel Class Booked *</span>
          <input
            className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
            placeholder="e.g. Economy (Classic), Train AC-3T"
            value={fields.ticket_travel_class}
            onChange={(e) => onChange({ ticket_travel_class: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Provider (Airline / Transporter) *</span>
        <input
          className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
          placeholder="e.g. IndiGo, Air India, Indian Railways"
          value={fields.provider}
          onChange={(e) => onChange({ provider: e.target.value })}
          required
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Internal Desk Reference (Optional)</span>
          <input
            className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
            placeholder="Internal ID override"
            value={fields.reference_id}
            onChange={(e) => onChange({ reference_id: e.target.value })}
          />
        </div>

        <div className="space-y-1">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">External Source (e.g. MMT)</span>
          <input
            className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
            placeholder="Agent source portal"
            value={fields.external_booking_source}
            onChange={(e) => onChange({ external_booking_source: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Notes for Employee</span>
        <textarea
          className="w-full min-h-[3rem] p-3 text-xs rounded-lg border border-slate-205 focus:border-slate-400 outline-none transition-all bg-white"
          placeholder="Add ticket remarks or guidelines for the traveler"
          value={fields.notes_for_employee}
          onChange={(e) => onChange({ notes_for_employee: e.target.value })}
        />
      </div>

      <button
        type="submit"
        className="inline-flex w-full h-10 items-center justify-center gap-1.5 rounded-lg bg-brand text-xs font-bold text-white hover:bg-brand/90 transition-all duration-200 shadow-md"
        disabled={busy}
      >
        <CheckCircle2 size={13} /> {isOnlySegment ? 'Complete Ticketing & Notify Employee' : `Save Ticket — ${seg.label}`}
      </button>
    </form>
  );
}

const QUEUE_PAGE_SIZE = 10;

const IMPACT_LEVELS = ['L1', 'L2', 'L3A', 'L3B', 'L4A', 'L4B', 'L4C', 'L5A', 'L5B', 'L6A', 'L6B', 'L6C', 'L6D'];

function primaryTravelDate(request) {
  if (request.trip_type === 'MULTI_CITY' && request.legs?.length) {
    const dates = request.legs.map((leg) => leg.travel_date).filter(Boolean).sort();
    return dates[0] || null;
  }
  return request.travel_date || null;
}

const SORT_OPTIONS = [
  { value: '', label: 'Default order' },
  { value: 'date_asc', label: 'Travel Date (Oldest first)' },
  { value: 'date_desc', label: 'Travel Date (Newest first)' },
  { value: 'impact_asc', label: 'Impact Level (Low to High)' },
  { value: 'impact_desc', label: 'Impact Level (High to Low)' },
];

function sortRows(rows, sortBy) {
  if (!sortBy) return rows;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sortBy === 'date_asc' || sortBy === 'date_desc') {
      const da = primaryTravelDate(a.request) || '';
      const db = primaryTravelDate(b.request) || '';
      if (da === db) return 0;
      const cmp = da < db ? -1 : 1;
      return sortBy === 'date_asc' ? cmp : -cmp;
    }
    const ia = IMPACT_LEVELS.indexOf(a.impact_level_code);
    const ib = IMPACT_LEVELS.indexOf(b.impact_level_code);
    const na = ia === -1 ? IMPACT_LEVELS.length : ia;
    const nb = ib === -1 ? IMPACT_LEVELS.length : ib;
    return sortBy === 'impact_asc' ? na - nb : nb - na;
  });
  return sorted;
}

function getStatusDetails(status) {
  switch (status) {
    case 'BOOKED':
      return { label: 'Booked', bg: 'bg-emerald-100 text-emerald-800' };
    case 'PARTIALLY_BOOKED':
      return { label: 'Partially Booked', bg: 'bg-sky-100 text-sky-800' };
    case 'APPROVED':
      return { label: 'Approved - Awaiting Ticketing', bg: 'bg-brand/10 text-brand' };
    case 'PENDING':
      return { label: 'Pending Manager Approval', bg: 'bg-amber-100 text-amber-800' };
    case 'PENDING_EXCEPTION':
      return { label: 'Under Review (Exception)', bg: 'bg-orange-100 text-orange-800' };
    case 'REJECTED':
      return { label: 'Rejected', bg: 'bg-rose-100 text-rose-800' };
    case 'CANCELLED':
      return { label: 'Cancelled', bg: 'bg-slate-100 text-slate-500' };
    default:
      return { label: status, bg: 'bg-slate-100 text-slate-600' };
  }
}

export default function TravelDeskPage() {
  useSetPageTitle('Travel Desk');
  const { showToast } = useToast();
  const [mode, setMode] = useState('queue');
  const [queue, setQueue] = useState([]);
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bookedSuccess, setBookedSuccess] = useState(null);
  const [queuePage, setQueuePage] = useState(1);
  const [queueDateFrom, setQueueDateFrom] = useState('');
  const [queueDateTo, setQueueDateTo] = useState('');
  const [queueImpactLevel, setQueueImpactLevel] = useState('');
  const [queueSortBy, setQueueSortBy] = useState('');

  const [uploadsBySeq, setUploadsBySeq] = useState({});
  const [activeSegSeq, setActiveSegSeq] = useState(null);

  const [allQ, setAllQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [allDateFrom, setAllDateFrom] = useState('');
  const [allDateTo, setAllDateTo] = useState('');
  const [allImpactLevel, setAllImpactLevel] = useState('');
  const [allSortBy, setAllSortBy] = useState('');
  const [allPage, setAllPage] = useState(1);

  const selectedRow = useMemo(() => queue.find((e) => e.request.id === selectedKey) || null, [queue, selectedKey]);

  useEffect(() => {
    if (!selectedRow) {
      setActiveSegSeq(null);
      return;
    }
    const segments = selectedRow.request.segments || [];
    const nextUnticketed = segments.find((s) => !s.ticket);
    setActiveSegSeq(nextUnticketed ? nextUnticketed.seq : null);
  }, [selectedRow]);

  useEffect(() => {
    setUploadsBySeq({});
  }, [selectedKey]);

  function getUploadFields(seq) {
    return uploadsBySeq[seq] || EMPTY_UPLOAD_FIELDS;
  }

  function patchUploadFields(seq, patch) {
    setUploadsBySeq((prev) => ({ ...prev, [seq]: { ...(prev[seq] || EMPTY_UPLOAD_FIELDS), ...patch } }));
  }

  const filteredQueue = useMemo(() => {
    const filtered = queue.filter((row) => {
      if (queueImpactLevel && row.impact_level_code !== queueImpactLevel) return false;
      const travelDate = primaryTravelDate(row.request);
      if (queueDateFrom && (!travelDate || travelDate < queueDateFrom)) return false;
      if (queueDateTo && (!travelDate || travelDate > queueDateTo)) return false;
      return true;
    });
    return sortRows(filtered, queueSortBy);
  }, [queue, queueDateFrom, queueDateTo, queueImpactLevel, queueSortBy]);

  const queueTotalPages = Math.max(1, Math.ceil(filteredQueue.length / QUEUE_PAGE_SIZE));
  const pagedQueue = useMemo(
    () => filteredQueue.slice((queuePage - 1) * QUEUE_PAGE_SIZE, queuePage * QUEUE_PAGE_SIZE),
    [filteredQueue, queuePage]
  );

  useEffect(() => {
    setQueuePage((page) => Math.min(page, queueTotalPages));
  }, [queueTotalPages]);

  useEffect(() => {
    setQueuePage(1);
  }, [queueDateFrom, queueDateTo, queueImpactLevel, queueSortBy]);

  function clearQueueFilters() {
    setQueueDateFrom('');
    setQueueDateTo('');
    setQueueImpactLevel('');
    setQueueSortBy('');
  }

  const queueFiltersActive = Boolean(queueDateFrom || queueDateTo || queueImpactLevel || queueSortBy);

  const sortedAllRows = useMemo(() => sortRows(allRows, allSortBy), [allRows, allSortBy]);

  const allTotalPages = Math.max(1, Math.ceil(sortedAllRows.length / QUEUE_PAGE_SIZE));
  const pagedAllRows = useMemo(
    () => sortedAllRows.slice((allPage - 1) * QUEUE_PAGE_SIZE, allPage * QUEUE_PAGE_SIZE),
    [sortedAllRows, allPage]
  );

  useEffect(() => {
    setAllPage((page) => Math.min(page, allTotalPages));
  }, [allTotalPages]);

  useEffect(() => {
    setAllPage(1);
  }, [allQ, statusFilter, allDateFrom, allDateTo, allImpactLevel, allSortBy]);

  async function loadQueue() {
    const r = await reimbursementApi.travelDeskQueue();
    setQueue(r.data || []);
  }

  async function loadAll() {
    const r = await reimbursementApi.travelDeskAll({
      q: allQ.trim() || undefined,
      status: statusFilter.trim() || undefined,
      date_from: allDateFrom || undefined,
      date_to: allDateTo || undefined,
      impact_level: allImpactLevel || undefined,
    });
    setAllRows(r.data || []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (mode === 'queue') await loadQueue();
        else await loadAll();
      } catch (e) {
        if (!cancelled) {
          const d = e.response?.data?.detail;
          showToast(typeof d === 'string' ? d : 'Failed to load desk data', 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'all') return undefined;
    const t = setTimeout(() => {
      loadAll().catch(() => {});
    }, 280);
    return () => clearTimeout(t);
  }, [mode, allQ, statusFilter, allDateFrom, allDateTo, allImpactLevel]);

  async function onUpload(e, seq) {
    e.preventDefault();
    if (!selectedRow || (selectedRow.request.status !== 'APPROVED' && selectedRow.request.status !== 'PARTIALLY_BOOKED')) return;
    const fields = getUploadFields(seq);
    if (!fields.file) {
      showToast('Choose a ticket file', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('file', fields.file);
    fd.append('leg_sequence', String(seq));
    fd.append('pnr_or_booking_ref', fields.pnr_or_booking_ref || '');
    fd.append('ticket_amount', fields.ticket_amount || '');
    fd.append('ticket_travel_class', fields.ticket_travel_class || '');
    fd.append('provider', fields.provider || '');
    fd.append('reference_id', fields.reference_id || '');
    fd.append('external_booking_source', fields.external_booking_source || '');
    fd.append('notes_for_employee', fields.notes_for_employee || '');
    setBusy(true);
    try {
      const bookedFor = selectedRow.employee_display_name;
      const resp = await reimbursementApi.travelUploadTicket(selectedRow.request.id, fd);
      const allDone = resp.data?.request?.status === 'BOOKED';
      setUploadsBySeq((prev) => {
        const next = { ...prev };
        delete next[seq];
        return next;
      });
      await loadQueue();
      if (allDone) {
        showToast('All legs ticketed; employee notified', 'success');
        setBookedSuccess({ name: bookedFor });
        setTimeout(() => {
          setBookedSuccess(null);
          setSelectedKey(null);
        }, 1900);
      } else {
        showToast('Leg ticketed — continue with the remaining leg(s)', 'success');
      }
    } catch (err) {
      const d = err.response?.data?.detail;
      showToast(typeof d === 'string' ? d : 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const queueCount = queue.length;

  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-4">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-200 pb-5 gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Travel Desk Agent Dashboard</h1>
          <p className="mt-1 text-xs text-slate-500">
            Handle pending employee travel ticketing requests and upload booking proofs. Review the{' '}
            <a href="https://intranet.example/travel-policies" className="text-brand font-semibold hover:underline" target="_blank" rel="noreferrer">
              Corporate Travel playbook
            </a>.
          </p>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1 shrink-0 w-fit self-start md:self-center">
          <button
            type="button"
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
              mode === 'queue' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
            onClick={() => setMode('queue')}
          >
            <span>Active Queue</span>
            {queueCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-bold text-brand">
                {queueCount}
              </span>
            )}
          </button>
          <button 
            type="button" 
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
              mode === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`} 
            onClick={() => setMode('all')}
          >
            <span>All Requests</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-xs font-bold">
          <Clock className="animate-spin text-slate-400" size={15} /> Loading travel desk data...
        </div>
      ) : null}

      {!loading && mode === 'queue' ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          {/* Active Queue List */}
          <div className="space-y-3">
            {queue.length > 0 ? (
              <div className="panel flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
                <div className="space-y-1">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">From Date</span>
                  <input
                    type="date"
                    className="h-9 rounded-lg border border-slate-250 px-2.5 text-xs outline-none focus:border-slate-400 transition-all"
                    value={queueDateFrom}
                    onChange={(e) => setQueueDateFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">To Date</span>
                  <input
                    type="date"
                    className="h-9 rounded-lg border border-slate-250 px-2.5 text-xs outline-none focus:border-slate-400 transition-all"
                    value={queueDateTo}
                    onChange={(e) => setQueueDateTo(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Impact Level</span>
                  <select
                    className="h-9 rounded-lg border border-slate-250 px-2.5 text-xs outline-none bg-white focus:border-slate-400 transition-all"
                    value={queueImpactLevel}
                    onChange={(e) => setQueueImpactLevel(e.target.value)}
                  >
                    <option value="">Any level</option>
                    {IMPACT_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>{lvl}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Sort By</span>
                  <select
                    className="h-9 rounded-lg border border-slate-250 px-2.5 text-xs outline-none bg-white focus:border-slate-400 transition-all"
                    value={queueSortBy}
                    onChange={(e) => setQueueSortBy(e.target.value)}
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                {queueFiltersActive ? (
                  <button
                    type="button"
                    className="h-9 rounded-lg px-3 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
                    onClick={clearQueueFilters}
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            ) : null}

            {(queue || []).length === 0 ? (
              <div className="panel rounded-xl border border-slate-200 bg-white p-5 text-center text-xs font-semibold text-slate-400">
                No active requests in queue.
              </div>
            ) : filteredQueue.length === 0 ? (
              <div className="panel rounded-xl border border-slate-200 bg-white p-5 text-center text-xs font-semibold text-slate-400">
                No requests match the selected filters.
              </div>
            ) : (
              pagedQueue.map((row) => {
                const isSelected = selectedKey === row.request.id;
                const statusDetails = getStatusDetails(row.request.status);
                
                return (
                  <button
                    key={row.request.id}
                    type="button"
                    onClick={() => setSelectedKey(row.request.id)}
                    className={`panel block w-full rounded-xl border-2 p-4 text-left transition-all duration-200 bg-white hover:border-brand/45 hover:shadow-md ${
                      isSelected ? 'border-brand ring-1 ring-brand/10 shadow-sm' : 'border-slate-100'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="text-xs font-bold text-slate-800">
                          {row.employee_display_name || 'Corporate Employee'}
                        </div>
                        
                        <div className="text-[11px] font-bold text-slate-600 flex flex-col gap-1.5">
                          {row.request.trip_type === 'MULTI_CITY' && row.request.legs && row.request.legs.length > 0 ? (
                            row.request.legs.map((leg, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <ModeIcon mode={leg.travel_mode || row.request.travel_mode} className="text-slate-400 shrink-0" />
                                <span>{leg.from_city}</span>
                                <ArrowRight size={10} className="text-slate-400" />
                                <span>{leg.to_city}</span>
                                <span className="text-slate-400 font-normal ml-1">({leg.travel_date})</span>
                              </div>
                            ))
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <ModeIcon mode={row.request.travel_mode} className="text-slate-400 shrink-0" />
                              <span>{row.request.from_city}</span>
                              <ArrowRight size={10} className="text-slate-400" />
                              <span>{row.request.to_city}</span>
                              {row.request.trip_type === 'ROUND_TRIP' && (
                                <span className="ml-1 inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Round Trip</span>
                              )}
                            </div>
                          )}
                        </div>
                        
                        <div className="text-[10px] font-medium text-slate-500 flex items-center gap-2">
                          <span className="bg-slate-100 rounded px-1.5 py-0.5">{row.request.travel_date}</span>
                          <span>•</span>
                          <span>Impact: <strong className="text-slate-700">{row.impact_level_code}</strong></span>
                        </div>
                      </div>

                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold tracking-tight uppercase ${statusDetails.bg}`}>
                        {statusDetails.label}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
            {filteredQueue.length > QUEUE_PAGE_SIZE ? (
              <div className="panel flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-500">
                <span>
                  Showing {(queuePage - 1) * QUEUE_PAGE_SIZE + 1}
                  –{Math.min(queuePage * QUEUE_PAGE_SIZE, filteredQueue.length)} of {filteredQueue.length} requests
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                    onClick={() => setQueuePage((page) => Math.max(1, page - 1))}
                    disabled={queuePage <= 1}
                  >
                    Previous
                  </button>
                  <span className="text-slate-600">Page {queuePage} of {queueTotalPages}</span>
                  <button
                    type="button"
                    className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                    onClick={() => setQueuePage((page) => Math.min(queueTotalPages, page + 1))}
                    disabled={queuePage >= queueTotalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Details & Actions Panel */}
          <div className="panel sticky top-[7.5rem] self-start max-h-[calc(100vh-9rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            {bookedSuccess ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <span className="absolute inline-flex h-16 w-16 animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 animate-fade-scale shadow-lg shadow-emerald-500/30">
                    <CheckCircle2 size={30} className="text-white" strokeWidth={2.5} />
                  </span>
                </div>
                <h3 className="mt-5 text-sm font-bold text-slate-800 animate-slide-up-fade">Ticket booked & employee notified</h3>
                <p className="mt-1.5 text-xs text-slate-500 max-w-[240px] animate-slide-up-fade">
                  {bookedSuccess.name} will see the confirmed itinerary in their travel requests.
                </p>
              </div>
            ) : !selectedRow ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <FileText size={32} strokeWidth={1.5} />
                <p className="mt-3 text-xs font-bold">Select a request from the active queue to review</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="border-b border-slate-100 pb-3">
                  <span className="text-[10px] font-bold text-brand uppercase tracking-wider">Ticketing details</span>
                  <h2 className="text-sm font-bold text-slate-800 mt-0.5">{selectedRow.employee_display_name}</h2>
                </div>
                {/* Routing Visualization */}
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-4">
                  {selectedRow.request.trip_type === 'MULTI_CITY' && selectedRow.request.legs && selectedRow.request.legs.length > 0 ? (
                    <div className="flex flex-col gap-4">
                      {selectedRow.request.legs.map((leg, i) => (
                        <div key={i} className="flex items-center justify-between px-3 relative">
                          <div className="text-center">
                            <div className="text-xs font-bold text-slate-800">{leg.from_city}</div>
                            <div className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">Origin</div>
                          </div>
                          <div className="flex-1 border-t-2 border-dashed border-slate-200 mx-4 relative flex items-center justify-center">
                            <div className="absolute -top-3.5 bg-slate-50 p-1 rounded-full text-slate-400 border border-slate-200">
                              <ModeIcon mode={leg.travel_mode || selectedRow.request.travel_mode} />
                            </div>
                            <div className="absolute -top-6 text-[9px] font-bold text-slate-400 bg-slate-50 px-1">{leg.travel_date}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs font-bold text-slate-800">{leg.to_city}</div>
                            <div className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">Destination</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between px-3">
                      <div className="text-center">
                        <div className="text-xs font-bold text-slate-800">{selectedRow.request.from_city}</div>
                        <div className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">Origin</div>
                      </div>
                      <div className="flex-1 border-t-2 border-dashed border-slate-200 mx-4 relative flex items-center justify-center">
                        <div className="absolute -top-3.5 bg-slate-50 p-1 rounded-full text-slate-400 border border-slate-200">
                          <ModeIcon mode={selectedRow.request.travel_mode} />
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-bold text-slate-800">{selectedRow.request.to_city}</div>
                        <div className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">Destination</div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 mt-4 border-t border-slate-200/60 pt-3 text-[11px] font-medium text-slate-600">
                    <div>
                      <span className="text-slate-400 font-semibold block uppercase text-[9px]">Travel Date</span>
                      <span className="font-bold text-slate-700">{primaryTravelDate(selectedRow.request)}</span>
                    </div>
                    {selectedRow.request.return_date && (
                      <div>
                        <span className="text-slate-400 font-semibold block uppercase text-[9px]">Return Date</span>
                        <span className="font-bold text-slate-700">{selectedRow.request.return_date}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 font-semibold block uppercase text-[9px]">Preferred Cabin</span>
                      <span className="font-bold text-slate-700">{selectedRow.request.preferred_class || 'Economy'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-semibold block uppercase text-[9px]">Requested Mode</span>
                      <span className="font-bold text-slate-700">
                        {selectedRow.request.trip_type === 'MULTI_CITY' && selectedRow.request.legs?.length > 0
                          ? [...new Set(selectedRow.request.legs.map((leg) => leg.travel_mode || selectedRow.request.travel_mode))].join(', ')
                          : selectedRow.request.travel_mode}
                      </span>
                    </div>
                  </div>
                </div>

                {selectedRow.request.purpose && (
                  <div className="space-y-0.5">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Travel Purpose</span>
                    <p className="text-xs text-slate-700 font-medium">{selectedRow.request.purpose}</p>
                  </div>
                )}

                {selectedRow.request.notes && (
                  <div className="space-y-0.5">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Employee Notes</span>
                    <p className="text-xs text-slate-700 bg-amber-50/40 border border-amber-100 rounded-lg p-2.5 font-medium">{selectedRow.request.notes}</p>
                  </div>
                )}

                {/* Status APPROVED / PARTIALLY_BOOKED: per-segment ticketing */}
                {selectedRow.request.status === 'APPROVED' || selectedRow.request.status === 'PARTIALLY_BOOKED' ? (
                  <div className="mt-5 border-t border-slate-150 pt-4 space-y-3">
                    {(() => {
                      const segments = selectedRow.request.segments || [];
                      const doneCount = segments.filter((s) => s.ticket).length;
                      return (
                        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <UploadCloud size={14} className="text-brand" />
                          <span>
                            Upload Ticketing Confirmation
                            {segments.length > 1 ? ` (${doneCount}/${segments.length} legs done)` : ''}
                          </span>
                        </div>
                      );
                    })()}

                    {(selectedRow.request.segments || []).map((seg) => {
                      if (seg.ticket) {
                        return (
                          <div key={seg.seq} className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 flex items-start gap-2">
                            <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                            <div className="text-[11px] text-emerald-800">
                              <div className="font-bold">{seg.label}</div>
                              <div className="text-emerald-700/80">
                                PNR {seg.ticket.pnr_or_booking_ref || '—'} · ₹{seg.ticket.ticket_amount ?? '—'} · {seg.ticket.ticket_travel_class || 'Class n/a'}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      if (activeSegSeq !== seg.seq) {
                        return (
                          <button
                            key={seg.seq}
                            type="button"
                            onClick={() => setActiveSegSeq(seg.seq)}
                            className="w-full rounded-lg border border-dashed border-slate-250 p-3 text-left text-[11px] font-bold text-slate-500 hover:border-brand/50 hover:text-brand transition-colors"
                          >
                            {seg.label} — ticket not yet uploaded
                          </button>
                        );
                      }
                      return (
                        <SegmentUploadForm
                          key={seg.seq}
                          seg={seg}
                          fields={getUploadFields(seg.seq)}
                          onChange={(patch) => patchUploadFields(seg.seq, patch)}
                          onSubmit={(e) => onUpload(e, seg.seq)}
                          busy={busy}
                          isOnlySegment={(selectedRow.request.segments || []).length === 1}
                        />
                      );
                    })}
                  </div>
                ) : (
                  selectedRow.request.status !== 'PENDING' && selectedRow.request.status !== 'APPROVED' ? (
                    <div className="mt-5 border-t border-slate-100 pt-4 flex items-start gap-2 rounded-lg bg-slate-50 border border-slate-200/50 p-3 text-xs font-bold text-slate-600">
                      <AlertCircle className="text-slate-400 mt-0.5 shrink-0" size={14} />
                      <span>This request is in status {selectedRow.request.status} and cannot be processed further.</span>
                    </div>
                  ) : null
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {!loading && mode === 'all' ? (
        <div className="panel rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-end gap-4 border-b border-slate-100 px-5 py-4 bg-slate-50/50">
            <div className="space-y-1 shrink-0">
              <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Search Records</span>
              <div className="relative">
                <input 
                  className="w-56 h-9 pl-8 pr-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none bg-white transition-all" 
                  value={allQ} 
                  onChange={(e) => setAllQ(e.target.value)} 
                  placeholder="City, traveler email, name" 
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
              </div>
            </div>
            
            <div className="space-y-1 shrink-0">
              <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Filter Status</span>
              <select
                className="w-44 h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none bg-white transition-all"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All requests</option>
                <option value="PENDING">PENDING</option>
                <option value="PENDING_EXCEPTION">PENDING_EXCEPTION</option>
                <option value="APPROVED">APPROVED</option>
                <option value="PARTIALLY_BOOKED">PARTIALLY_BOOKED</option>
                <option value="BOOKED">BOOKED</option>
                <option value="REJECTED">REJECTED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>

            <div className="space-y-1 shrink-0">
              <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">From Date</span>
              <input
                type="date"
                className="h-9 rounded-lg border border-slate-250 px-2.5 text-xs outline-none focus:border-slate-400 bg-white transition-all"
                value={allDateFrom}
                onChange={(e) => setAllDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1 shrink-0">
              <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">To Date</span>
              <input
                type="date"
                className="h-9 rounded-lg border border-slate-250 px-2.5 text-xs outline-none focus:border-slate-400 bg-white transition-all"
                value={allDateTo}
                onChange={(e) => setAllDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-1 shrink-0">
              <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Impact Level</span>
              <select
                className="w-32 h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none bg-white transition-all"
                value={allImpactLevel}
                onChange={(e) => setAllImpactLevel(e.target.value)}
              >
                <option value="">Any level</option>
                {IMPACT_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>{lvl}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 shrink-0">
              <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sort By</span>
              <select
                className="h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none bg-white transition-all"
                value={allSortBy}
                onChange={(e) => setAllSortBy(e.target.value)}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {(allDateFrom || allDateTo || allImpactLevel || allSortBy) ? (
              <button
                type="button"
                className="h-9 rounded-lg px-3 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
                onClick={() => {
                  setAllDateFrom('');
                  setAllDateTo('');
                  setAllSortBy('');
                  setAllImpactLevel('');
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/60 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Employee</th>
                  <th className="px-5 py-3">Submitted</th>
                  <th className="px-5 py-3">Travel Date</th>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-5 py-3">Mode</th>
                  <th className="px-5 py-3">Impact Level</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 font-medium text-slate-700">
                {(allRows || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400 italic">
                      No matching records located.
                    </td>
                  </tr>
                ) : (
                  pagedAllRows.map(({ request: r, employee_display_name, impact_level_code }) => {
                    const statusDetails = getStatusDetails(r.status);

                    return (
                      <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="whitespace-nowrap px-5 py-3 font-bold text-slate-800">
                          {employee_display_name || '—'}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3">
                          {r.requested_at ? new Date(r.requested_at).toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3">
                          {r.trip_type === 'MULTI_CITY' && r.legs?.length > 0 ? r.legs[0].travel_date : r.travel_date}
                        </td>
                        <td className="px-5 py-3">
                          {r.trip_type === 'MULTI_CITY' && r.legs && r.legs.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {r.legs.map((leg, i) => (
                                <div key={i} className="flex items-center gap-1 font-bold text-slate-800 text-[11px]">
                                  <span>{leg.from_city}</span>
                                  <ArrowRight size={8} className="text-slate-400" />
                                  <span>{leg.to_city}</span>
                                  <span className="text-slate-400 font-normal ml-1">({leg.travel_date})</span>
                                </div>
                              ))}
                              <div className="mt-0.5"><span className="inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Multi City</span></div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 font-bold text-slate-800">
                              <span>{r.from_city}</span>
                              <ArrowRight size={10} className="text-slate-400" />
                              <span>{r.to_city}</span>
                              {r.trip_type === 'ROUND_TRIP' && (
                                <span className="ml-1 inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Round Trip</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {r.trip_type === 'MULTI_CITY' && r.legs?.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              {[...new Set(r.legs.map((leg) => leg.travel_mode || r.travel_mode))].map((m) => (
                                <span key={m} className="flex items-center gap-1">
                                  <ModeIcon mode={m} className="text-slate-400" />
                                  <span>{m}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <ModeIcon mode={r.travel_mode} className="text-slate-400" />
                              <span>{r.travel_mode}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                            {impact_level_code || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold tracking-tight uppercase ${statusDetails.bg}`}>
                            {statusDetails.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {sortedAllRows.length > QUEUE_PAGE_SIZE ? (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs font-medium text-slate-500">
              <span>
                Showing {(allPage - 1) * QUEUE_PAGE_SIZE + 1}
                –{Math.min(allPage * QUEUE_PAGE_SIZE, sortedAllRows.length)} of {sortedAllRows.length} requests
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                  onClick={() => setAllPage((page) => Math.max(1, page - 1))}
                  disabled={allPage <= 1}
                >
                  Previous
                </button>
                <span className="text-slate-600">Page {allPage} of {allTotalPages}</span>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                  onClick={() => setAllPage((page) => Math.min(allTotalPages, page + 1))}
                  disabled={allPage >= allTotalPages}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
