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

function getStatusDetails(status) {
  switch (status) {
    case 'BOOKED':
      return { label: 'Booked', bg: 'bg-emerald-100 text-emerald-800' };
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

  const [upload, setUpload] = useState({
    file: null,
    pnr_or_booking_ref: '',
    ticket_amount: '',
    ticket_travel_class: '',
    provider: '',
    reference_id: '',
    external_booking_source: '',
    notes_for_employee: '',
  });

  const [allQ, setAllQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const selectedRow = useMemo(() => queue.find((e) => e.request.id === selectedKey) || null, [queue, selectedKey]);

  async function loadQueue() {
    const r = await reimbursementApi.travelDeskQueue();
    setQueue(r.data || []);
  }

  async function loadAll() {
    const r = await reimbursementApi.travelDeskAll({
      q: allQ.trim() || undefined,
      status: statusFilter.trim() || undefined,
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
  }, [mode, allQ, statusFilter]);

  async function onUpload(e) {
    e.preventDefault();
    if (!selectedRow || selectedRow.request.status !== 'APPROVED') return;
    if (!upload.file) {
      showToast('Choose a ticket file', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('file', upload.file);
    fd.append('pnr_or_booking_ref', upload.pnr_or_booking_ref || '');
    fd.append('ticket_amount', upload.ticket_amount || '');
    fd.append('ticket_travel_class', upload.ticket_travel_class || '');
    fd.append('provider', upload.provider || '');
    fd.append('reference_id', upload.reference_id || '');
    fd.append('external_booking_source', upload.external_booking_source || '');
    fd.append('notes_for_employee', upload.notes_for_employee || '');
    setBusy(true);
    try {
      await reimbursementApi.travelUploadTicket(selectedRow.request.id, fd);
      showToast('Ticket uploaded; trip created', 'success');
      setUpload({
        file: null,
        pnr_or_booking_ref: '',
        ticket_amount: '',
        ticket_travel_class: '',
        provider: '',
        reference_id: '',
        external_booking_source: '',
        notes_for_employee: '',
      });
      await loadQueue();
      setSelectedKey(null);
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
            {(queue || []).length === 0 ? (
              <div className="panel rounded-xl border border-slate-200 bg-white p-5 text-center text-xs font-semibold text-slate-400">
                No active requests in queue.
              </div>
            ) : (
              queue.map((row) => {
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
          </div>

          {/* Details & Actions Panel */}
          <div className="panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            {!selectedRow ? (
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
                      <span className="font-bold text-slate-700">{selectedRow.request.travel_date}</span>
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
                      <span className="font-bold text-slate-700">{selectedRow.request.travel_mode}</span>
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

                {/* Status APPROVED Form (Ticketing Upload) */}
                {selectedRow.request.status === 'APPROVED' ? (
                  <form className="mt-5 border-t border-slate-150 pt-4 space-y-3.5" onSubmit={onUpload}>
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <UploadCloud size={14} className="text-brand" />
                      <span>Upload Ticketing Confirmation</span>
                    </div>

                    <div className="space-y-1">
                      <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ticket File *</span>
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.heic"
                        required
                        className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
                        onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })}
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">PNR / Booking Reference *</span>
                      <input
                        className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                        placeholder="Enter PNR or airline reference number"
                        value={upload.pnr_or_booking_ref}
                        onChange={(e) => setUpload({ ...upload, pnr_or_booking_ref: e.target.value })}
                        required
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ticket Amount (₹) *</span>
                        <input
                          className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                          placeholder="e.g. 8500"
                          value={upload.ticket_amount}
                          onChange={(e) => setUpload({ ...upload, ticket_amount: e.target.value })}
                          required
                        />
                      </div>
                      
                      <div className="space-y-1">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Cabin / Travel Class Booked *</span>
                        <input
                          className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                          placeholder="e.g. Economy (Classic), Train AC-3T"
                          value={upload.ticket_travel_class}
                          onChange={(e) => setUpload({ ...upload, ticket_travel_class: e.target.value })}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Provider (Airline / Transporter) *</span>
                      <input
                        className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                        placeholder="e.g. IndiGo, Air India, Indian Railways"
                        value={upload.provider}
                        onChange={(e) => setUpload({ ...upload, provider: e.target.value })}
                        required
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Internal Desk Reference (Optional)</span>
                        <input
                          className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                          placeholder="Internal ID override"
                          value={upload.reference_id}
                          onChange={(e) => setUpload({ ...upload, reference_id: e.target.value })}
                        />
                      </div>
                      
                      <div className="space-y-1">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">External Source (e.g. MMT)</span>
                        <input
                          className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                          placeholder="Agent source portal"
                          value={upload.external_booking_source}
                          onChange={(e) => setUpload({ ...upload, external_booking_source: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Notes for Employee</span>
                      <textarea
                        className="w-full min-h-[3rem] p-3 text-xs rounded-lg border border-slate-205 focus:border-slate-400 outline-none transition-all"
                        placeholder="Add ticket remarks or guidelines for the traveler"
                        value={upload.notes_for_employee}
                        onChange={(e) => setUpload({ ...upload, notes_for_employee: e.target.value })}
                      />
                    </div>

                    <button 
                      type="submit" 
                      className="inline-flex w-full h-10 items-center justify-center gap-1.5 rounded-lg bg-brand text-xs font-bold text-white hover:bg-brand/90 transition-all duration-200 shadow-md" 
                      disabled={busy}
                    >
                      <CheckCircle2 size={13} /> Complete Ticketing & Notify Employee
                    </button>
                  </form>
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
                <option value="BOOKED">BOOKED</option>
                <option value="REJECTED">REJECTED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/60 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Submitted</th>
                  <th className="px-5 py-3">Travel Date</th>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-5 py-3">Mode</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 font-medium text-slate-700">
                {(allRows || []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-400 italic">
                      No matching records located.
                    </td>
                  </tr>
                ) : (
                  allRows.map((r) => {
                    const statusDetails = getStatusDetails(r.status);
                    
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
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
                        <td className="px-5 py-3 flex items-center gap-1.5 mt-0.5">
                          <ModeIcon mode={r.travel_mode} className="text-slate-400" />
                          <span>{r.travel_mode}</span>
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
        </div>
      ) : null}
    </section>
  );
}
