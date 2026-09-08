import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  Plus, Plane, Train, Bus, FileText, ArrowRight,
  Clock, Info, ShieldAlert, ArrowUpRight,
  X
} from 'lucide-react';
import { useAuthStore, selectResolvedRole } from '../../store/authStore';

import TicketPreviewDrawer from '../../components/ui/TicketPreviewDrawer';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import SubmissionAnimation from '../../components/ui/SubmissionAnimation';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useFormValidation from '../../hooks/useFormValidation';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';
import { required } from '../../utils/validators';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';

function ModeIcon({ mode, className }) {
  if (mode === 'FLIGHT') return <Plane className={className} size={15} />;
  if (mode === 'TRAIN') return <Train className={className} size={15} />;
  if (mode === 'BUS') return <Bus className={className} size={15} />;
  return <FileText className={className} size={15} />;
}

function getStatusDetails(status) {
  switch (status) {
    case 'BOOKED':
      return { label: 'Booked', bg: 'bg-emerald-100 text-emerald-800' };
    case 'APPROVED':
      return { label: 'Approved', bg: 'bg-brand/10 text-brand' };
    case 'PENDING':
      return { label: 'Pending', bg: 'bg-amber-100 text-amber-800' };
    case 'REJECTED':
      return { label: 'Rejected', bg: 'bg-rose-100 text-rose-800' };
    case 'CANCELLED':
      return { label: 'Cancelled', bg: 'bg-slate-100 text-slate-500' };
    default:
      return { label: status, bg: 'bg-slate-100 text-slate-600' };
  }
}

export default function TravelRequestsPage() {
  useSetPageTitle('Travel Requests');
  const profile = useAuthStore((s) => s.profile);
  const { showToast } = useToast();
  const [tab, setTab] = useState('requests');
  const [rows, setRows] = useState([]);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entitlement, setEntitlement] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [submissionState, setSubmissionState] = useState({ active: false, status: 'idle', mode: null });
  useBodyScrollLock(modalOpen || submissionState.active);
    const form = useFormValidation({
    initialValues: {
      trip_type: 'ONE_WAY',
      travel_mode: 'FLIGHT',
      from_city: '',
      to_city: '',
      travel_date: '',
      return_date: '',
      purpose: '',
      preferred_class: '',
      notes: '',
      legs: [{ travel_mode: '', from_city: '', to_city: '', travel_date: '', preferred_time: '' }]
    },
    rules: {
      trip_type: [required()],
      travel_mode: [required()],
      from_city: [(val, values) => values.trip_type !== 'MULTI_CITY' ? required()(val) : null],
      to_city: [(val, values) => values.trip_type !== 'MULTI_CITY' ? required()(val) : null],
      travel_date: [(val, values) => values.trip_type !== 'MULTI_CITY' ? required()(val) : null],
      return_date: [(val, values) => values.trip_type === 'ROUND_TRIP' ? required()(val) : null],
      purpose: [required()],
      preferred_class: [],
      notes: [],
    },
  });
  const [cityQ, setCityQ] = useState('');
  const [cityOptions, setCityOptions] = useState([]);
  const [preview, setPreview] = useState({ open: false, blob: null, name: '', type: '', title: '' });
  const [confirmCancelId, setConfirmCancelId] = useState(null);

  useEffect(() => {
    reimbursementApi
      .travelEntitlementNote()
      .then((r) => setEntitlement(r.data))
      .catch(() => setEntitlement(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        if (cancelled) return;
        if (tab === 'requests') {
          const my = await reimbursementApi.travelRequestsMy();
          if (!cancelled) setRows(my.data || []);
        } else {
          const tm = await reimbursementApi.bookingTripsMy();
          if (!cancelled) setTrips(tm.data || []);
        }
      } catch (e) {
        if (!cancelled) showToast(e.response?.data?.detail || e.message || 'Failed to load travel data', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tab, showToast]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        if (!cityQ.trim()) {
          setCityOptions([]);
          return;
        }
        const r = await reimbursementApi.travelCitySuggestions(cityQ, 40);
        if (!cancelled) setCityOptions(r.data || []);
      } catch {
        if (!cancelled) setCityOptions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cityQ]);

  useEffect(() => {
    if (profile?.office_location && !form.values.from_city) {
      form.setValues({ ...form.values, from_city: profile.office_location });
    }
  }, [profile, form]);

  const tripIdsCsv = useMemo(() => (trips || []).filter((x) => x?.id).map((t) => t.id).join(','), [trips]);

  const [policyError, setPolicyError] = useState(null);
  const [exceptionReason, setExceptionReason] = useState('');
  const [submittingException, setSubmittingException] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onCreate(e) {
    e.preventDefault();
    setPolicyError(null);
    try {
      if (!form.validateAll()) return;

      const mode = form.values.travel_mode;
      setIsSubmitting(true);
      setSubmissionState({ active: true, status: 'submitting', mode });

      await reimbursementApi.travelRequestsCreate({
        trip_type: form.values.trip_type,
        travel_mode: form.values.travel_mode,
        from_city: form.values.trip_type !== 'MULTI_CITY' ? form.values.from_city : null,
        to_city: form.values.trip_type !== 'MULTI_CITY' ? form.values.to_city : null,
        travel_date: form.values.trip_type !== 'MULTI_CITY' ? form.values.travel_date : null,
        return_date: form.values.trip_type === 'ROUND_TRIP' ? form.values.return_date || null : null,
        purpose: form.values.purpose || null,
        preferred_class: form.values.preferred_class || null,
        notes: form.values.notes || null,
        legs: form.values.trip_type === 'MULTI_CITY' ? form.values.legs.filter(l => l.from_city && l.to_city && l.travel_date) : [],
      });

      setIsSubmitting(false);
      setModalOpen(false);
      setSubmissionState(s => ({ ...s, status: 'success' }));

      const my = await reimbursementApi.travelRequestsMy();
      setRows(my.data || []);

      form.setValues({
        trip_type: 'ONE_WAY',
        travel_mode: 'FLIGHT',
        from_city: '',
        to_city: '',
        travel_date: '',
        return_date: '',
        purpose: '',
        preferred_class: '',
        notes: '',
        legs: [{ travel_mode: '', from_city: '', to_city: '', travel_date: '', preferred_time: '' }]
      });

    } catch (err) {
      setIsSubmitting(false);
      setSubmissionState({ active: false, status: 'idle', mode: null });
      const d = err.response?.data;
      const detailStr = typeof d?.detail === 'string' ? d.detail : err.message || 'Save failed';

      if (
        detailStr.includes('7-day') ||
        detailStr.includes('locked for your level') ||
        detailStr.includes('not allowed for your impact level')
      ) {
        setPolicyError(detailStr);
      } else {
        showToast(detailStr, 'error');
      }
    }
  }

  async function handleRequestException() {
    if (!exceptionReason.trim()) {
      showToast('Please enter a justification for the exception request', 'error');
      return;
    }

    setSubmittingException(true);
    try {
      let type = 'FLIGHT_ADVANCE_BOOKING_OVERRIDE';
      if (policyError.includes('locked for your level')) {
        type = 'AIR_TRAVEL_UNLOCK';
      } else if (policyError.includes('not allowed for your impact level')) {
        type = 'FLIGHT_COST_DELTA';
      }

      await reimbursementApi.requestException({
        exception_type: type,
        description: exceptionReason,
      });

      showToast('Policy exception request submitted to your Manager.', 'success');
      setPolicyError(null);
      setExceptionReason('');
      setModalOpen(false);
    } catch (err) {
      showToast(err.response?.data?.detail || err.message || 'Failed to submit exception', 'error');
    } finally {
      setSubmittingException(false);
    }
  }

  async function onCancel(id) {
    try {
      await reimbursementApi.travelRequestDelete(id);
      showToast('Request cancelled', 'success');
      const my = await reimbursementApi.travelRequestsMy();
      setRows(my.data || []);
    } catch (e) {
      showToast(
        typeof e.response?.data?.detail === 'string' ? e.response.data.detail : e.message || 'Cancel failed',
        'error',
      );
    }
  }

  async function previewTripDesk(trip) {
    const tid = trip.desk_ticket_id;
    if (!tid) {
      showToast('No uploaded ticket linked to this trip', 'info');
      return;
    }
    try {
      const resp = await reimbursementApi.travelTicketFileBlob(tid);
      const filename = `${trip.reference_id || 'trip'}-${tid}.pdf`;
      setPreview({
        open: true,
        blob: resp.data,
        name: filename,
        type: resp.headers['content-type'] || '',
        title: `${trip.from_city} → ${trip.to_city}`,
      });
    } catch (e) {
      showToast('Could not load ticket preview', 'error');
    }
  }

  async function viewTicket(row) {
    const ticketId = row.ticket?.id;
    if (!ticketId) return;
    try {
      const resp = await reimbursementApi.travelTicketFileBlob(ticketId);
      const filename = row.ticket?.original_filename || 'ticket.pdf';
      const ctype = row.ticket?.content_type || resp.headers['content-type'] || '';
      setPreview({
        open: true,
        blob: resp.data,
        name: filename,
        type: ctype,
        title: `Ticket · ${row.request.from_city} → ${row.request.to_city}`,
      });
    } catch (e) {
      showToast('Could not load ticket preview', 'error');
    }
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-4">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-200 pb-5 gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Travel Bookings & Requests</h1>
          <p className="mt-1 text-xs text-slate-500">
            Submit itinerary requests to the Travel Desk and monitor ticket status.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Tab Selection */}
          <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1 shrink-0">
            <button
              type="button"
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${tab === 'requests' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              onClick={() => setTab('requests')}
            >
              My Requests
            </button>
            <button
              type="button"
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${tab === 'trips' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              onClick={() => setTab('trips')}
            >
              My Trips
            </button>
          </div>

          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand text-xs font-bold text-white hover:bg-brand/90 transition-all duration-200 shadow-md px-4"
            onClick={() => setModalOpen(true)}
          >
            <Plus size={14} /> New Request
          </button>

          {tab === 'trips' && tripIdsCsv ? (
            <Link
              className="inline-flex h-9 items-center justify-center gap-1 px-4 rounded-lg border border-slate-250 hover:bg-slate-50 text-xs font-bold text-slate-700 transition-all duration-200"
              to={`/claims/draft?tripIds=${encodeURIComponent(tripIdsCsv)}`}
            >
              Link to Claim <ArrowUpRight size={13} />
            </Link>
          ) : null}
        </div>
      </div>

      {entitlement?.text ? (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 shadow-sm">
          <Info size={16} className="text-brand shrink-0 mt-0.5" />
          <div className="font-medium">{entitlement.text}</div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-xs font-bold">
          <Clock className="animate-spin text-slate-400" size={15} /> Loading data...
        </div>
      ) : null}

      {/* Tab: Requests Table */}
      {!loading && tab === 'requests' ? (
        <div className="panel rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/60 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Travel Date</th>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-5 py-3">Mode</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 font-medium text-slate-700">
                {(rows || []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-400 italic">
                      No travel requests created yet.
                    </td>
                  </tr>
                ) : (
                  rows.map(({ request, ticket }) => {
                    const statusDetails = getStatusDetails(request.status);

                    return (
                      <tr key={request.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="whitespace-nowrap px-5 py-3">
                          {request.trip_type === 'MULTI_CITY' && request.legs?.length > 0 ? request.legs[0].travel_date : request.travel_date}
                        </td>
                        <td className="px-5 py-3">
                          {request.trip_type === 'MULTI_CITY' && request.legs && request.legs.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {request.legs.map((leg, i) => (
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
                              <span>{request.from_city}</span>
                              <ArrowRight size={10} className="text-slate-400" />
                              <span>{request.to_city}</span>
                              {request.trip_type === 'ROUND_TRIP' && (
                                <span className="ml-1 inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Round Trip</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            <ModeIcon mode={request.travel_mode} className="text-slate-400" />
                            <span>{request.travel_mode}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold tracking-tight uppercase ${statusDetails.bg}`}>
                            {statusDetails.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {request.status === 'BOOKED' && ticket ? (
                              <button
                                type="button"
                                className="inline-flex h-7 items-center justify-center rounded border border-slate-205 hover:bg-slate-50 text-[10px] font-bold text-slate-700 px-3 transition-all"
                                onClick={() => viewTicket({ request, ticket })}
                              >
                                View Ticket
                              </button>
                            ) : null}
                            {request.status === 'PENDING' ? (
                              <button
                                type="button"
                                className="inline-flex h-7 items-center justify-center rounded border border-rose-200 hover:bg-rose-50 text-[10px] font-bold text-rose-700 px-3 transition-all"
                                onClick={() => setConfirmCancelId(request.id)}
                              >
                                Cancel Request
                              </button>
                            ) : null}
                          </div>
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

      {/* Tab: Trips Table */}
      {!loading && tab === 'trips' ? (
        <div className="panel rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/60 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-5 py-3">Provider & Ref</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Tags</th>
                  <th className="px-5 py-3 text-right">Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 font-medium text-slate-700">
                {(trips || []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400 italic">
                      No trip tickets uploaded yet.
                    </td>
                  </tr>
                ) : (
                  trips.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="whitespace-nowrap px-5 py-3">{t.travel_date}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1 font-bold text-slate-800">
                          <span>{t.from_city}</span>
                          <ArrowRight size={10} className="text-slate-400" />
                          <span>{t.to_city}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-bold text-slate-800">{t.provider || '—'}</span>
                        {t.reference_id && <span className="text-slate-400 text-[10px] ml-1">({t.reference_id})</span>}
                      </td>
                      <td className="px-5 py-3 font-bold text-slate-800">
                        ₹{Number(t.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-5 py-3">
                        {t.booked_by_travel_desk ? (
                          <span className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[9px] font-bold text-indigo-700 uppercase tracking-tight">
                            Desk Booked
                          </span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {t.desk_ticket_id ? (
                          <button
                            type="button"
                            className="inline-flex h-7 items-center justify-center rounded border border-slate-205 hover:bg-slate-50 text-[10px] font-bold text-slate-700 px-3 transition-all"
                            onClick={() => previewTripDesk(t)}
                          >
                            View Ticket
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Global Submission Animation Overlay */}
      {submissionState.active ? (
        <SubmissionAnimation 
          mode={submissionState.mode} 
          status={submissionState.status}
          onComplete={() => setSubmissionState({ active: false, status: 'idle', mode: null })} 
        />
      ) : null}

      {/* Modal: New Request Dialog */}
      {modalOpen ? createPortal(
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-900/40 p-4 backdrop-blur-[2px]">
          <div className="panel w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">

            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-800">Submit Travel Request</h2>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 rounded-lg p-1 hover:bg-slate-100 transition-colors"
                onClick={() => {
                  setModalOpen(false);
                  setPolicyError(null);
                  setExceptionReason('');
                }}
              >
                <X size={16} />
              </button>
            </div>

            {entitlement?.text && (
              <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                <Info size={14} className="text-brand shrink-0 mt-0.5" />
                <span className="font-semibold">{entitlement.text}</span>
              </div>
            )}

            <form className="space-y-4" onSubmit={onCreate}>
              {/* Travel Mode */}
              <div className="space-y-1">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Travel Mode *</span>
                <select
                  className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none bg-white transition-all"
                  value={form.values.travel_mode}
                  onChange={(e) => form.handleChange('travel_mode', e.target.value)}
                  onBlur={() => form.handleBlur('travel_mode')}
                >
                  <option value="FLIGHT">Flight</option>
                  <option value="TRAIN">Train</option>
                  <option value="BUS">Bus</option>
                </select>
              </div>

              {/* Trip Type */}
              <div className="space-y-1 border-b border-slate-100 pb-4">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Trip Type *</span>
                <div className="flex gap-4">
                  {['ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'].map((type) => (
                    <label key={type} className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="radio"
                        name="trip_type"
                        value={type}
                        checked={form.values.trip_type === type}
                        onChange={(e) => form.handleChange('trip_type', e.target.value)}
                        className="text-brand focus:ring-brand"
                      />
                      {type === 'ONE_WAY' ? 'One Way' : type === 'ROUND_TRIP' ? 'Round Trip' : 'Multi-City'}
                    </label>
                  ))}
                </div>
              </div>

              {/* Origins & Destination / Legs */}
              {form.values.trip_type !== 'MULTI_CITY' ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">From City *</span>
                    <input
                      className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                      required
                      value={form.values.from_city}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCityQ(v);
                        form.handleChange('from_city', v);
                      }}
                      onBlur={() => form.handleBlur('from_city')}
                      list="city-from"
                    />
                    {form.errors.from_city ? <p className="text-[10px] font-bold text-rose-650">{form.errors.from_city}</p> : null}
                  </div>

                  <div className="space-y-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">To City *</span>
                    <input
                      className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                      required
                      value={form.values.to_city}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCityQ(v);
                        form.handleChange('to_city', v);
                      }}
                      onBlur={() => form.handleBlur('to_city')}
                      list="city-to"
                    />
                    {form.errors.to_city ? <p className="text-[10px] font-bold text-rose-650">{form.errors.to_city}</p> : null}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Trip Legs *</span>
                  {form.values.legs.map((leg, i) => (
                    <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg relative">
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-1">
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">From City *</span>
                          <input
                            className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
                            required
                            value={leg.from_city}
                            onChange={(e) => {
                              const v = e.target.value;
                              setCityQ(v);
                              const newLegs = [...form.values.legs];
                              newLegs[i].from_city = v;
                              form.handleChange('legs', newLegs);
                            }}
                            list="city-from"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">To City *</span>
                          <input
                            className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
                            required
                            value={leg.to_city}
                            onChange={(e) => {
                              const v = e.target.value;
                              setCityQ(v);
                              const newLegs = [...form.values.legs];
                              newLegs[i].to_city = v;
                              form.handleChange('legs', newLegs);
                            }}
                            list="city-to"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Date *</span>
                          <input
                            type="date"
                            className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all bg-white"
                            required
                            value={leg.travel_date}
                            onChange={(e) => {
                              const newLegs = [...form.values.legs];
                              newLegs[i].travel_date = e.target.value;
                              form.handleChange('legs', newLegs);
                            }}
                          />
                        </div>
                      </div>
                      {form.values.legs.length > 1 && (
                        <button type="button" onClick={() => {
                          const newLegs = form.values.legs.filter((_, idx) => idx !== i);
                          form.handleChange('legs', newLegs);
                        }} className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded-full text-slate-400 hover:text-red-500 shadow-sm">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => {
                    form.handleChange('legs', [...form.values.legs, { travel_mode: '', from_city: '', to_city: '', travel_date: '', preferred_time: '' }]);
                  }} className="text-[12px] font-medium text-brand flex items-center gap-1 hover:underline">
                    <Plus size={14} /> Add another leg
                  </button>
                </div>
              )}

              <datalist id="city-from">
                {cityOptions.map((c) => (
                  <option key={`f-${c}`} value={c} />
                ))}
              </datalist>
              <datalist id="city-to">
                {cityOptions.map((c) => (
                  <option key={`t-${c}`} value={c} />
                ))}
              </datalist>

              {/* Dates */}
              {form.values.trip_type !== 'MULTI_CITY' && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Departure Date *</span>
                    <input
                      type="date"
                      required
                      className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                      value={form.values.travel_date}
                      onChange={(e) => form.handleChange('travel_date', e.target.value)}
                      onBlur={() => form.handleBlur('travel_date')}
                    />
                    {form.errors.travel_date ? <p className="text-[10px] font-bold text-rose-650">{form.errors.travel_date}</p> : null}
                  </div>

                  {form.values.trip_type === 'ROUND_TRIP' && (
                    <div className="space-y-1">
                      <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Return Date *</span>
                      <input
                        type="date"
                        required
                        className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                        value={form.values.return_date}
                        onChange={(e) => form.handleChange('return_date', e.target.value)}
                        onBlur={() => form.handleBlur('return_date')}
                      />
                      {form.errors.return_date ? <p className="text-[10px] font-bold text-rose-650">{form.errors.return_date}</p> : null}
                    </div>
                  )}
                </div>
              )}

              {/* Purpose */}
              <div className="space-y-1">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Trip Purpose *</span>
                <input
                  className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                  value={form.values.purpose}
                  onChange={(e) => form.handleChange('purpose', e.target.value)}
                  onBlur={() => form.handleBlur('purpose')}
                  required
                />
                {form.errors.purpose ? <p className="text-[10px] font-bold text-rose-650">{form.errors.purpose}</p> : null}
              </div>

              {/* Class & Notes */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Preferred Cabin Class</span>
                  <input
                    className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                    placeholder="e.g. Economy, AC 3-Tier"
                    value={form.values.preferred_class}
                    onChange={(e) => form.handleChange('preferred_class', e.target.value)}
                    onBlur={() => form.handleBlur('preferred_class')}
                  />
                </div>

                <div className="space-y-1">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Additional Instructions</span>
                  <input
                    className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                    placeholder="Meal preferences, seat requirements"
                    value={form.values.notes}
                    onChange={(e) => form.handleChange('notes', e.target.value)}
                    onBlur={() => form.handleBlur('notes')}
                  />
                </div>
              </div>

              {/* Exception Warning Block */}
              {policyError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/20 p-4 space-y-3">
                  <div className="flex items-start gap-2.5 text-rose-900 text-[11px] font-bold">
                    <ShieldAlert size={16} className="text-rose-650 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block text-rose-800">Corporate Policy Restriction</strong>
                      {policyError}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="block text-[10px] font-bold text-rose-800 uppercase tracking-wide">Exception Justification *</span>
                    <textarea
                      className="w-full min-h-[3rem] p-3 text-xs rounded-lg border border-rose-200 focus:border-rose-450 outline-none transition-all bg-white"
                      rows={2}
                      placeholder="Explain why this policy override is required (e.g. Urgent customer escalation meeting requested by VP)"
                      value={exceptionReason}
                      onChange={(e) => setExceptionReason(e.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    className="w-full inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-xs font-bold text-white transition-all shadow-md"
                    disabled={submittingException}
                    onClick={handleRequestException}
                  >
                    Submit Exception Override Request
                  </button>
                </div>
              )}

              {/* Actions Footer */}
              <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 px-4 transition-colors"
                  onClick={() => {
                    setModalOpen(false);
                    setPolicyError(null);
                    setExceptionReason('');
                  }}
                >
                  Close
                </button>
                {!policyError && (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand text-xs font-bold text-white transition-all shadow-md px-4 disabled:opacity-50 ${isSubmitting ? 'animate-pulse w-32' : 'hover:bg-brand/90'}`}
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>,
        document.body
      ) : null}

      <TicketPreviewDrawer
        open={preview.open}
        onClose={() => setPreview((p) => ({ ...p, open: false }))}
        blob={preview.blob}
        contentType={preview.type}
        filename={preview.name}
        title={preview.title}
      />
      <ConfirmDialog
        open={Boolean(confirmCancelId)}
        title="Cancel Travel Request"
        description="Are you sure you want to cancel this travel request? This action cannot be undone."
        confirmLabel="Yes, Cancel Request"
        confirmVariant="danger"
        onCancel={() => setConfirmCancelId(null)}
        onConfirm={() => {
          if (confirmCancelId) onCancel(confirmCancelId);
          setConfirmCancelId(null);
        }}
      />
    </section>
  );
}
