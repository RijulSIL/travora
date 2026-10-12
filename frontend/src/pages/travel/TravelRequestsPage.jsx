import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  Plus, Plane, Train, Bus, FileText, ArrowRight,
  Clock, Info, ShieldAlert, ArrowUpRight,
  X, ChevronDown, ChevronUp, GitBranch, Paperclip,
  ArrowLeftRight, Briefcase, CalendarDays, CheckCircle2, ConciergeBell, Hash, MessageSquare, Target
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

import TicketPreviewDrawer from '../../components/ui/TicketPreviewDrawer';
import TravelRequestProgress from '../../components/travel/TravelRequestProgress';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Pagination from '../../components/ui/Pagination';
import SubmissionAnimation from '../../components/ui/SubmissionAnimation';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useFormValidation from '../../hooks/useFormValidation';
import { usePagination } from '../../hooks/usePagination';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';
import { claimNewPath } from '../../utils/claimRoutes';
import { formatCurrency } from '../../utils/formatters';
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
    case 'PARTIALLY_BOOKED':
      return { label: 'Partially Booked', bg: 'bg-sky-100 text-sky-800' };
    case 'APPROVED':
      return { label: 'Approved', bg: 'bg-brand/10 text-brand' };
    case 'PENDING':
      return { label: 'Pending', bg: 'bg-amber-100 text-amber-800' };
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

function emptyRequestForm() {
  return {
    trip_type: 'ONE_WAY',
    travel_mode: 'FLIGHT',
    from_city: '',
    to_city: '',
    travel_date: '',
    return_date: '',
    travel_type: 'NON_PROJECT',
    project_code: '',
    purpose: '',
    needs_additional_booking: false,
    additional_booking_items: [],
    notes: '',
    legs: [{ travel_mode: 'FLIGHT', from_city: '', to_city: '', travel_date: '', preferred_time: '' }]
  };
}

const TRIP_TYPE_LABELS = { ONE_WAY: 'One Way', ROUND_TRIP: 'Round Trip', MULTI_CITY: 'Multi-City' };

function DetailTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        <Icon size={11} className="shrink-0" />
        {label}
      </div>
      <div className="mt-0.5 break-words text-xs font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function DocLink({ doc, onOpen }) {
  return (
    <button
      type="button"
      className="flex max-w-full items-center gap-1.5 text-left text-[11px] font-semibold text-brand hover:underline"
      onClick={() => onOpen(doc)}
    >
      <Paperclip size={11} className="shrink-0" />
      <span className="truncate">{doc.description || doc.original_filename}</span>
    </button>
  );
}

function NoteBlock({ icon: Icon, label, text, tone = 'plain' }) {
  const toneClass = tone === 'warn' ? 'border-orange-100 bg-orange-50/40' : 'border-slate-100';
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2.5 ${toneClass}`}>
      <Icon size={13} className="mt-0.5 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-700">{text}</p>
      </div>
    </div>
  );
}

/** "PRJ-1024 — Plant expansion"; just the value when the admin gave no separate description. */
function optionText(option) {
  return option.label && option.label !== option.value ? `${option.value} — ${option.label}` : option.value;
}

const LIMIT_FIELDS = [
  { key: 'hotel', label: 'Hotel' },
  { key: 'food', label: 'Food' },
  { key: 'incidental', label: 'Incidentals' },
  { key: 'day_visit', label: 'Day Visit' },
];

/** Travel-policy expense caps at each destination — shown when the traveler isn't asking the
 * company to book anything extra, i.e. they'll be paying for these things themselves. */
function ExpenseLimitsPanel({ limits, loading }) {
  if (!loading && limits.length === 0) return null;
  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start gap-2 text-[11px] font-semibold text-slate-600">
        <Info size={14} className="text-brand shrink-0 mt-0.5" />
        <span>Expense limits at your destination under the travel policy</span>
      </div>
      {loading && limits.length === 0 ? (
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
          <Clock className="animate-spin" size={12} /> Checking limits...
        </div>
      ) : null}
      {limits.map((entry) => (
        <div key={entry.city} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-800">
            <span>{entry.city}</span>
            <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
              {entry.city_group_name || `Group ${entry.city_group}`}
            </span>
            <span className="font-medium text-slate-400">· Impact level {entry.impact_level}</span>
          </div>
          {entry.has_limits ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-4">
              {LIMIT_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <dt className="font-semibold text-slate-400">{label}</dt>
                  <dd className="mt-0.5 font-bold text-slate-700">
                    {entry[`${key}_cap`] != null ? formatCurrency(entry[`${key}_cap`]) : 'No limit'}
                    {entry[`${key}_cap`] != null ? (
                      <span className="ml-1 text-[9px] font-medium text-slate-400">
                        {entry[`${key}_is_hard_block`] ? 'hard limit' : 'soft limit'}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[11px] italic text-slate-400">No expense limits are configured for this city under the current policy.</p>
          )}
        </div>
      ))}
    </div>
  );
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
  const [travelOptions, setTravelOptions] = useState({ project_codes: [], trip_purposes: [] });
  const [cityLimits, setCityLimits] = useState([]);
  const [limitsLoading, setLimitsLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [submissionState, setSubmissionState] = useState({ active: false, status: 'idle', mode: null });
  useBodyScrollLock(modalOpen || submissionState.active);
  const form = useFormValidation({
    initialValues: emptyRequestForm(),
    rules: {
      trip_type: [required()],
      travel_mode: [required()],
      from_city: [(val, values) => values.trip_type !== 'MULTI_CITY' ? required()(val) : null],
      to_city: [(val, values) => values.trip_type !== 'MULTI_CITY' ? required()(val) : null],
      travel_date: [(val, values) => values.trip_type !== 'MULTI_CITY' ? required()(val) : null],
      return_date: [(val, values) => values.trip_type === 'ROUND_TRIP' ? required()(val) : null],
      travel_type: [required()],
      project_code: [(val, values) => values.travel_type === 'PROJECT' ? required()(val) : null],
      purpose: [required()],
      additional_booking_items: [(val, values) => values.needs_additional_booking ? required()(val) : null],
      notes: [],
    },
  });
  const [cityQ, setCityQ] = useState('');
  const [cityOptions, setCityOptions] = useState([]);
  const [bookingItemDraft, setBookingItemDraft] = useState('');

  function addBookingItem() {
    const text = bookingItemDraft.trim();
    if (!text) return;
    form.handleChange('additional_booking_items', [...form.values.additional_booking_items, text]);
    setBookingItemDraft('');
  }

  function removeBookingItem(index) {
    form.handleChange('additional_booking_items', form.values.additional_booking_items.filter((_, i) => i !== index));
  }
  const [preview, setPreview] = useState({ open: false, blob: null, name: '', type: '', title: '' });
  const [confirmCancelId, setConfirmCancelId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  // Only one row's ticket picker is ever open at a time — id of that request, or null.
  // Rendered through a portal (see below) so it isn't clipped by the table's own
  // overflow-hidden/overflow-x-auto wrappers, so position is tracked separately in viewport
  // coordinates rather than relying on CSS `absolute` against an ancestor.
  const [openTicketMenuId, setOpenTicketMenuId] = useState(null);
  const [ticketMenuPos, setTicketMenuPos] = useState(null);
  const ticketMenuTriggerRef = useRef(null);
  const ticketMenuPanelRef = useRef(null);

  function toggleExpand(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openTicketMenu(requestId, buttonEl) {
    const rect = buttonEl.getBoundingClientRect();
    setTicketMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    setOpenTicketMenuId(requestId);
  }

  // Close the open ticket picker on outside click (mirrors AppNavbar's user-menu dropdown) —
  // checked against both the trigger button and the portal panel, since the panel is no longer
  // a DOM descendant of the trigger once it's rendered into document.body. Also closes on
  // scroll, since a fixed-position panel would otherwise visually detach from its button.
  useEffect(() => {
    if (openTicketMenuId === null) return;
    const handleClick = (e) => {
      if (ticketMenuTriggerRef.current?.contains(e.target)) return;
      if (ticketMenuPanelRef.current?.contains(e.target)) return;
      setOpenTicketMenuId(null);
    };
    const handleScroll = () => setOpenTicketMenuId(null);
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [openTicketMenuId]);

  useEffect(() => {
    reimbursementApi
      .travelEntitlementNote()
      .then((r) => setEntitlement(r.data))
      .catch(() => setEntitlement(null));
  }, []);

  // Admins manage these lists, so re-read them every time the form opens rather than caching
  // for the whole session.
  useEffect(() => {
    if (!modalOpen) return;
    reimbursementApi
      .travelOptions()
      .then((r) => setTravelOptions(r.data || { project_codes: [], trip_purposes: [] }))
      .catch(() => setTravelOptions({ project_codes: [], trip_purposes: [] }));
  }, [modalOpen]);

  // Destinations the traveler's policy limits are shown for: the To City of a one-way / round
  // trip, or each distinct leg destination (with that leg's date) for a multi-city trip.
  const limitTargets = useMemo(() => {
    const { trip_type: tripType, to_city: toCity, travel_date: travelDate, legs } = form.values;
    const raw = tripType === 'MULTI_CITY'
      ? legs.map((l) => ({ city: l.to_city, date: l.travel_date }))
      : [{ city: toCity, date: travelDate }];
    const seen = new Set();
    return raw
      .map((t) => ({ city: (t.city || '').trim(), date: t.date || '' }))
      .filter((t) => {
        if (!t.city || seen.has(t.city.toLowerCase())) return false;
        seen.add(t.city.toLowerCase());
        return true;
      });
  }, [form.values]);
  const limitTargetsKey = JSON.stringify(limitTargets);
  const showExpenseLimits = modalOpen && !form.values.needs_additional_booking;

  useEffect(() => {
    if (!showExpenseLimits || limitTargets.length === 0) {
      setCityLimits([]);
      setLimitsLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLimitsLoading(true);
    // Debounced so a half-typed city name isn't looked up on every keystroke.
    const t = setTimeout(async () => {
      try {
        const results = await Promise.all(
          limitTargets.map((target) =>
            reimbursementApi
              .travelCityExpenseLimits(target.city, target.date)
              .then((r) => r.data)
              .catch(() => null),
          ),
        );
        if (!cancelled) setCityLimits(results.filter(Boolean));
      } finally {
        if (!cancelled) setLimitsLoading(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // limitTargets is derived from limitTargetsKey, so keying on the string avoids refetching
    // on every unrelated keystroke elsewhere in the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExpenseLimits, limitTargetsKey]);

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
  const requestsPagination = usePagination(rows);
  const tripsPagination = usePagination(trips);

  const [policyError, setPolicyError] = useState(null);
  const [exceptionReason, setExceptionReason] = useState('');
  const [submittingException, setSubmittingException] = useState(false);
  const policyErrorRef = useRef(null);

  useEffect(() => {
    if (policyError && policyErrorRef.current) {
      policyErrorRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [policyError]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  function buildTravelRequestPayload() {
    const legs = form.values.trip_type === 'MULTI_CITY'
      ? form.values.legs.filter(l => l.from_city && l.to_city && l.travel_date)
      : [];
    return {
      trip_type: form.values.trip_type,
      travel_mode: form.values.trip_type === 'MULTI_CITY' ? (legs[0]?.travel_mode || 'FLIGHT') : form.values.travel_mode,
      from_city: form.values.trip_type !== 'MULTI_CITY' ? form.values.from_city : null,
      to_city: form.values.trip_type !== 'MULTI_CITY' ? form.values.to_city : null,
      travel_date: form.values.trip_type !== 'MULTI_CITY' ? form.values.travel_date : null,
      return_date: form.values.trip_type === 'ROUND_TRIP' ? form.values.return_date || null : null,
      travel_type: form.values.travel_type,
      project_code: form.values.travel_type === 'PROJECT' ? form.values.project_code || null : null,
      purpose: form.values.purpose || null,
      needs_additional_booking: form.values.needs_additional_booking,
      additional_booking_items: form.values.needs_additional_booking
        ? form.values.additional_booking_items
        : [],
      notes: form.values.notes || null,
      legs,
    };
  }

  async function onCreate(e) {
    e.preventDefault();
    setPolicyError(null);
    try {
      if (!form.validateAll()) return;

      const mode = form.values.trip_type === 'MULTI_CITY' ? (form.values.legs[0]?.travel_mode || 'FLIGHT') : form.values.travel_mode;
      setIsSubmitting(true);
      setSubmissionState({ active: true, status: 'submitting', mode });

      await reimbursementApi.travelRequestsCreate(buildTravelRequestPayload(), { suppressErrorToast: true });

      setIsSubmitting(false);
      setModalOpen(false);
      setSubmissionState(s => ({ ...s, status: 'success' }));

      const my = await reimbursementApi.travelRequestsMy();
      setRows(my.data || []);

      form.setValues(emptyRequestForm());
      setBookingItemDraft('');

    } catch (err) {
      setIsSubmitting(false);
      setSubmissionState({ active: false, status: 'idle', mode: null });
      const d = err.response?.data;
      const detailStr = typeof d?.detail === 'string' ? d.detail : err.message || 'Save failed';

      // 403 (AIR_TRAVEL_UNLOCK) and 409 (every other policy block raised by
      // _determine_blocking_exceptions — advance-booking windows, lead time, ...) both mean this
      // submission can go through the exception-request flow instead of failing outright; a
      // plain 422 is a genuine hard-validation error with no override path.
      const status = err.response?.status;
      if (status === 403 || status === 409) {
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

    const mode = form.values.trip_type === 'MULTI_CITY' ? (form.values.legs[0]?.travel_mode || 'FLIGHT') : form.values.travel_mode;
    setSubmittingException(true);
    setSubmissionState({ active: true, status: 'submitting', mode });
    try {
      await reimbursementApi.travelRequestsCreateWithException(
        { ...buildTravelRequestPayload(), justification: exceptionReason },
        { suppressErrorToast: true },
      );

      setSubmissionState(s => ({ ...s, status: 'success' }));
      showToast('Travel request submitted — under review pending exception approval.', 'success');
      setPolicyError(null);
      setExceptionReason('');
      setModalOpen(false);

      const my = await reimbursementApi.travelRequestsMy();
      setRows(my.data || []);

      form.setValues(emptyRequestForm());
      setBookingItemDraft('');
    } catch (err) {
      setSubmissionState({ active: false, status: 'idle', mode: null });
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

  async function viewSupportingDocument(doc) {
    try {
      const resp = await reimbursementApi.travelSupportingDocumentBlob(doc.id);
      setPreview({
        open: true,
        blob: resp.data,
        name: doc.original_filename || 'document.pdf',
        type: doc.content_type || resp.headers['content-type'] || '',
        title: doc.description || doc.original_filename || 'Supporting document',
      });
    } catch (e) {
      showToast('Could not load document preview', 'error');
    }
  }

  async function viewTicket(ticket, title) {
    if (!ticket?.id) return;
    try {
      const resp = await reimbursementApi.travelTicketFileBlob(ticket.id);
      const filename = ticket.original_filename || 'ticket.pdf';
      const ctype = ticket.content_type || resp.headers['content-type'] || '';
      setPreview({
        open: true,
        blob: resp.data,
        name: filename,
        type: ctype,
        title: title || 'Ticket',
      });
    } catch (e) {
      showToast('Could not load ticket preview', 'error');
    }
  }

  return (
    <section className="space-y-6">
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
              to={`${claimNewPath('TRAVEL')}?tripIds=${encodeURIComponent(tripIdsCsv)}`}
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
                <tr className="border-b border-slate-200 bg-slate-100/60 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="w-8 px-2 py-3" />
                  <th className="px-5 py-3 whitespace-nowrap">S. No</th>
                  <th className="px-5 py-3">Travel Date</th>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-5 py-3">Mode</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 font-medium text-slate-700">
                {(rows || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400 italic">
                      No travel requests created yet.
                    </td>
                  </tr>
                ) : (
                  requestsPagination.pageItems.map(({ request }, index) => {
                    const statusDetails = getStatusDetails(request.status);
                    const isExpanded = expandedIds.has(request.id);
                    const ticketedSegments = (request.segments || []).filter((s) => s.ticket);
                    const isTicketMenuOpen = openTicketMenuId === request.id;
                    // Docs uploaded before per-item linking existed (booking_item_id null) still show, just ungrouped.
                    const unlinkedSupportingDocuments = (request.supporting_documents || []).filter((doc) => !doc.booking_item_id);
                    const provenItemIds = new Set((request.supporting_documents || []).map((doc) => doc.booking_item_id).filter(Boolean));
                    const bookedItemCount = (request.booking_items || []).filter((item) => provenItemIds.has(item.id)).length;

                    return (
                      <Fragment key={request.id}>
                        <tr className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                              onClick={() => toggleExpand(request.id)}
                              aria-label={isExpanded ? 'Hide approval progress' : 'Show approval progress'}
                              title={isExpanded ? 'Hide approval progress' : 'Show approval progress'}
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </td>
                          <td className="px-5 py-3 text-center text-slate-500">
                            {requestsPagination.startIndex + index + 1}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-center">
                            {request.trip_type === 'MULTI_CITY' && request.legs?.length > 0 ? request.legs[0].travel_date : request.travel_date}
                          </td>
                          <td className="px-5 py-3 text-center">
                            {request.trip_type === 'MULTI_CITY' && request.legs && request.legs.length > 0 ? (
                              <div className="flex flex-col items-center gap-1">
                                {request.legs.map((leg, i) => (
                                  <div key={i} className="flex items-center gap-1 font-bold text-slate-800 text-[11px]">
                                    <ModeIcon mode={leg.travel_mode || request.travel_mode} className="text-slate-400" />
                                    <span>{leg.from_city}</span>
                                    <ArrowRight size={8} className="text-slate-400" />
                                    <span>{leg.to_city}</span>
                                    <span className="text-slate-400 font-normal ml-1">({leg.travel_date})</span>
                                  </div>
                                ))}
                                <div className="mt-0.5"><span className="inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Multi City</span></div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1 font-bold text-slate-800">
                                <span>{request.from_city}</span>
                                <ArrowRight size={10} className="text-slate-400" />
                                <span>{request.to_city}</span>
                                {request.trip_type === 'ROUND_TRIP' && (
                                  <span className="ml-1 inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">Round Trip</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3 text-center">
                            {request.trip_type === 'MULTI_CITY' && request.legs?.length > 0 ? (
                              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                                {[...new Set(request.legs.map((leg) => leg.travel_mode || request.travel_mode))].map((m) => (
                                  <span key={m} className="flex items-center gap-1">
                                    <ModeIcon mode={m} className="text-slate-400" />
                                    <span>{m}</span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1.5">
                                <ModeIcon mode={request.travel_mode} className="text-slate-400" />
                                <span>{request.travel_mode}</span>
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-bold tracking-tight uppercase ${statusDetails.bg}`}>
                                {statusDetails.label}
                              </span>
                              {request.exception ? (
                                <GitBranch size={11} className="text-orange-500" aria-label="Has policy exception" />
                              ) : null}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-center">
                            <div className="flex justify-center gap-2">
                              {ticketedSegments.length === 1 ? (
                                <button
                                  type="button"
                                  className="inline-flex h-7 items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 text-[10px] font-bold text-slate-700 px-3 transition-all"
                                  onClick={() => viewTicket(ticketedSegments[0].ticket, `Ticket · ${ticketedSegments[0].label}`)}
                                >
                                  View Ticket
                                </button>
                              ) : ticketedSegments.length > 1 ? (
                                <div ref={isTicketMenuOpen ? ticketMenuTriggerRef : null}>
                                  <button
                                    type="button"
                                    className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-[10px] font-bold text-slate-700 px-3 transition-all"
                                    onClick={(e) =>
                                      isTicketMenuOpen ? setOpenTicketMenuId(null) : openTicketMenu(request.id, e.currentTarget)
                                    }
                                    aria-expanded={isTicketMenuOpen}
                                  >
                                    View Tickets
                                    <ChevronDown size={11} className={`text-slate-400 transition-transform ${isTicketMenuOpen ? 'rotate-180' : ''}`} />
                                  </button>
                                  {isTicketMenuOpen && ticketMenuPos
                                    ? createPortal(
                                        <div
                                          ref={ticketMenuPanelRef}
                                          style={{ position: 'fixed', top: ticketMenuPos.top, right: ticketMenuPos.right }}
                                          className="z-[100] w-56 rounded-lg border border-slate-200 bg-white py-1.5 text-left shadow-lg"
                                        >
                                          {ticketedSegments.map((seg) => (
                                            <button
                                              key={seg.seq}
                                              type="button"
                                              className="block w-full px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                              onClick={() => {
                                                setOpenTicketMenuId(null);
                                                viewTicket(seg.ticket, `Ticket · ${seg.label}`);
                                              }}
                                            >
                                              {seg.label}
                                            </button>
                                          ))}
                                        </div>,
                                        document.body,
                                      )
                                    : null}
                                </div>
                              ) : null}
                              {request.status === 'PENDING' || request.status === 'PENDING_EXCEPTION' ? (
                                <button
                                  type="button"
                                  className="inline-flex h-7 items-center justify-center rounded-lg border border-rose-200 hover:bg-rose-50 text-[10px] font-bold text-rose-700 px-3 transition-all"
                                  onClick={() => setConfirmCancelId(request.id)}
                                >
                                  Cancel Request
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="bg-slate-50/60">
                            <td colSpan={7} className="px-5 py-4 border-b border-slate-150">
                              {/* On phones the table scrolls sideways; pin the panel to the visible width so it isn't clipped. */}
                              <div className="panel grid w-full gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm max-md:sticky max-md:left-3 max-md:w-[calc(100vw-3.5rem)] md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)]">
                                <section className="rounded-lg border border-slate-100 p-4">
                                  <h4 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Progress</h4>
                                  <TravelRequestProgress request={request} />
                                </section>

                                <section className="min-w-0 space-y-4 rounded-lg border border-slate-100 p-4">
                                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Trip Details</h4>
                                  <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                                    <DetailTile icon={Briefcase} label="Travel Type" value={request.travel_type === 'PROJECT' ? 'Project' : 'Non-project'} />
                                    {request.project_code ? <DetailTile icon={Hash} label="Project Code" value={request.project_code} /> : null}
                                    {request.purpose ? <DetailTile icon={Target} label="Purpose" value={request.purpose} /> : null}
                                    <DetailTile icon={ArrowLeftRight} label="Trip Type" value={TRIP_TYPE_LABELS[request.trip_type] || request.trip_type} />
                                    {request.trip_type === 'ROUND_TRIP' && request.return_date ? (
                                      <DetailTile icon={CalendarDays} label="Return Date" value={request.return_date} />
                                    ) : null}
                                  </div>

                                  {request.needs_additional_booking ? (
                                    <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 p-3">
                                      <div className="mb-2 flex items-center justify-between gap-2">
                                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                                          <ConciergeBell size={12} /> Additional Bookings
                                        </span>
                                        {request.booking_items?.length ? (
                                          <span className="text-[10px] font-bold text-amber-800">
                                            {bookedItemCount} of {request.booking_items.length} booked
                                          </span>
                                        ) : null}
                                      </div>
                                      {request.booking_items?.length ? (
                                        <ul className="space-y-1.5">
                                          {request.booking_items.map((item, i) => {
                                            const itemDocs = (request.supporting_documents || []).filter((doc) => doc.booking_item_id === item.id);
                                            return (
                                              <li key={item.id} className="rounded-md bg-white px-2.5 py-2 ring-1 ring-amber-100">
                                                <div className="flex items-start justify-between gap-2">
                                                  <span className="flex min-w-0 items-start gap-2 text-xs font-medium text-slate-700">
                                                    <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[9px] font-bold text-amber-800">
                                                      {i + 1}
                                                    </span>
                                                    <span className="break-words">{item.description}</span>
                                                  </span>
                                                  {itemDocs.length ? (
                                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                                      <CheckCircle2 size={10} /> Booked
                                                    </span>
                                                  ) : (
                                                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Pending</span>
                                                  )}
                                                </div>
                                                {itemDocs.length ? (
                                                  <div className="mt-1.5 space-y-1 pl-6">
                                                    {itemDocs.map((doc) => (
                                                      <DocLink key={doc.id} doc={doc} onOpen={viewSupportingDocument} />
                                                    ))}
                                                  </div>
                                                ) : null}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      ) : (
                                        <p className="whitespace-pre-wrap text-xs font-medium text-slate-700">{request.additional_booking_details}</p>
                                      )}
                                    </div>
                                  ) : null}

                                  {unlinkedSupportingDocuments.length ? (
                                    <div>
                                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Documents from Travel Desk</div>
                                      <div className="space-y-1">
                                        {unlinkedSupportingDocuments.map((doc) => (
                                          <DocLink key={doc.id} doc={doc} onOpen={viewSupportingDocument} />
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}

                                  {request.notes ? (
                                    <NoteBlock icon={MessageSquare} label="Notes" text={request.notes} />
                                  ) : null}
                                  {request.exception?.description ? (
                                    <NoteBlock icon={ShieldAlert} label="Exception Justification" text={request.exception.description} tone="warn" />
                                  ) : null}
                                  {request.exception?.decision_comment ? (
                                    <NoteBlock icon={GitBranch} label="Decision Comment" text={request.exception.decision_comment} tone="warn" />
                                  ) : null}
                                </section>

                                {(request.segments || []).length ? (
                                  <section className="rounded-lg border border-slate-100 p-4 md:col-span-2 xl:col-span-1">
                                    <h4 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Itinerary</h4>
                                    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                                      {request.segments.map((seg) => (
                                        <li key={seg.seq} className="rounded-md bg-slate-50 px-3 py-2.5">
                                          <div className="flex items-start gap-2">
                                            <ModeIcon mode={seg.mode || request.travel_mode} className="mt-0.5 shrink-0 text-slate-400" />
                                            <div className="min-w-0">
                                              <div className="break-words text-xs font-semibold text-slate-800">{seg.label}</div>
                                              <div className="mt-0.5 text-[11px] text-slate-500">{seg.travel_date}</div>
                                            </div>
                                          </div>
                                          {seg.ticket ? (
                                            <button
                                              type="button"
                                              className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-200"
                                              onClick={() => viewTicket(seg.ticket, `Ticket · ${seg.label}`)}
                                            >
                                              <CheckCircle2 size={10} className="shrink-0" />
                                              <span className="truncate">
                                                Ticketed{seg.ticket.pnr_or_booking_ref ? ` · PNR ${seg.ticket.pnr_or_booking_ref}` : ''}
                                              </span>
                                            </button>
                                          ) : ['APPROVED', 'PARTIALLY_BOOKED'].includes(request.status) ? (
                                            <span className="mt-2 inline-flex rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                              Ticket pending
                                            </span>
                                          ) : null}
                                        </li>
                                      ))}
                                    </ol>
                                  </section>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={requestsPagination.page}
            totalPages={requestsPagination.totalPages}
            onPageChange={requestsPagination.setPage}
            total={requestsPagination.total}
            pageSize={requestsPagination.pageSize}
            startIndex={requestsPagination.startIndex}
          />
        </div>
      ) : null}

      {/* Tab: Trips Table */}
      {!loading && tab === 'trips' ? (
        <div className="panel rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/60 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3 whitespace-nowrap">S. No</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-5 py-3">Provider & Ref</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Tags</th>
                  <th className="px-5 py-3">Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 font-medium text-slate-700">
                {(trips || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400 italic">
                      No trip tickets uploaded yet.
                    </td>
                  </tr>
                ) : (
                  tripsPagination.pageItems.map((t, index) => (
                    <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3 text-center text-slate-500">
                        {tripsPagination.startIndex + index + 1}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-center">{t.travel_date}</td>
                      <td className="px-5 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 font-bold text-slate-800">
                          <span>{t.from_city}</span>
                          <ArrowRight size={10} className="text-slate-400" />
                          <span>{t.to_city}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className="font-bold text-slate-800">{t.provider || '—'}</span>
                        {t.reference_id && <span className="text-slate-400 text-[10px] ml-1">({t.reference_id})</span>}
                      </td>
                      <td className="px-5 py-3 text-center font-bold text-slate-800">
                        {t.booked_by_travel_desk
                          ? '—'
                          : `₹${Number(t.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </td>
                      <td className="px-5 py-3 text-center">
                        {t.booked_by_travel_desk ? (
                          <span className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[9px] font-bold text-indigo-700 uppercase tracking-tight">
                            Desk Booked
                          </span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-center">
                        {t.desk_ticket_id ? (
                          <button
                            type="button"
                            className="inline-flex h-7 items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 text-[10px] font-bold text-slate-700 px-3 transition-all"
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
          <Pagination
            page={tripsPagination.page}
            totalPages={tripsPagination.totalPages}
            onPageChange={tripsPagination.setPage}
            total={tripsPagination.total}
            pageSize={tripsPagination.pageSize}
            startIndex={tripsPagination.startIndex}
          />
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
          <div className="panel flex w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-2xl max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">

            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 pt-5 pb-3">
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
              <div className="mx-5 mt-4 flex shrink-0 items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                <Info size={14} className="text-brand shrink-0 mt-0.5" />
                <span className="font-semibold">{entitlement.text}</span>
              </div>
            )}

            <form className="flex min-h-0 flex-1 flex-col" onSubmit={onCreate}>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {/* Travel Type + Project Code */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Travel Type *</span>
                  <select
                    className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none bg-white transition-all"
                    value={form.values.travel_type}
                    onChange={(e) => form.setValues({ ...form.values, travel_type: e.target.value, project_code: '' })}
                    onBlur={() => form.handleBlur('travel_type')}
                  >
                    <option value="NON_PROJECT">Non-project</option>
                    <option value="PROJECT">Project</option>
                  </select>
                </div>

                {form.values.travel_type === 'PROJECT' ? (
                  <div className="space-y-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Project Code *</span>
                    <select
                      className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none bg-white transition-all"
                      value={form.values.project_code}
                      onChange={(e) => form.handleChange('project_code', e.target.value)}
                      onBlur={() => form.handleBlur('project_code')}
                    >
                      <option value="">Select project code</option>
                      {travelOptions.project_codes.map((o) => (
                        <option key={o.id} value={o.value}>{optionText(o)}</option>
                      ))}
                    </select>
                    {travelOptions.project_codes.length === 0 ? (
                      <p className="text-[10px] font-bold text-amber-700">No project codes are configured yet — ask an admin to add them.</p>
                    ) : null}
                    {form.errors.project_code ? <p className="text-[10px] font-bold text-rose-650">{form.errors.project_code}</p> : null}
                  </div>
                ) : null}
              </div>

              {/* Travel Mode (multi-city sets this per leg instead) */}
              {form.values.trip_type !== 'MULTI_CITY' && (
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
              )}

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
                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="space-y-1">
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">Mode *</span>
                          <select
                            className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none bg-white transition-all"
                            required
                            value={leg.travel_mode || 'FLIGHT'}
                            onChange={(e) => {
                              const newLegs = [...form.values.legs];
                              newLegs[i].travel_mode = e.target.value;
                              form.handleChange('legs', newLegs);
                            }}
                          >
                            <option value="FLIGHT">Flight</option>
                            <option value="TRAIN">Train</option>
                            <option value="BUS">Bus</option>
                          </select>
                        </div>
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
                    form.handleChange('legs', [...form.values.legs, { travel_mode: 'FLIGHT', from_city: '', to_city: '', travel_date: '', preferred_time: '' }]);
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
                <select
                  className="w-full h-9 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none bg-white transition-all"
                  value={form.values.purpose}
                  onChange={(e) => form.handleChange('purpose', e.target.value)}
                  onBlur={() => form.handleBlur('purpose')}
                  required
                >
                  <option value="">Select trip purpose</option>
                  {travelOptions.trip_purposes.map((o) => (
                    <option key={o.id} value={o.value}>{optionText(o)}</option>
                  ))}
                </select>
                {travelOptions.trip_purposes.length === 0 ? (
                  <p className="text-[10px] font-bold text-amber-700">No trip purposes are configured yet — ask an admin to add them.</p>
                ) : null}
                {form.errors.purpose ? <p className="text-[10px] font-bold text-rose-650">{form.errors.purpose}</p> : null}
              </div>

              {/* Notes */}
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

              {/* Anything else the company should book */}
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded text-brand focus:ring-brand"
                    checked={form.values.needs_additional_booking}
                    onChange={(e) => form.handleChange('needs_additional_booking', e.target.checked)}
                  />
                  <span>
                    I need the company to book anything else for this trip
                    <span className="ml-1 font-medium text-slate-400">(optional — e.g. hotel, cab, visa)</span>
                  </span>
                </label>
                {form.values.needs_additional_booking ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        className="h-9 flex-1 px-3 text-xs rounded-lg border border-slate-250 focus:border-slate-400 outline-none transition-all"
                        placeholder="e.g. 2 nights hotel near client office"
                        value={bookingItemDraft}
                        onChange={(e) => setBookingItemDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addBookingItem();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="h-9 shrink-0 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-200"
                        onClick={addBookingItem}
                      >
                        Add
                      </button>
                    </div>
                    {form.values.additional_booking_items.length ? (
                      <ul className="space-y-1">
                        {form.values.additional_booking_items.map((item, idx) => (
                          <li
                            key={idx}
                            className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
                          >
                            <span className="truncate">{item}</span>
                            <button
                              type="button"
                              className="shrink-0 text-slate-400 hover:text-rose-600"
                              onClick={() => removeBookingItem(idx)}
                            >
                              <X size={13} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {form.errors.additional_booking_items ? <p className="text-[10px] font-bold text-rose-650">{form.errors.additional_booking_items}</p> : null}
                  </div>
                ) : null}
              </div>

              {showExpenseLimits ? <ExpenseLimitsPanel limits={cityLimits} loading={limitsLoading} /> : null}

              {/* Exception Warning Block */}
              {policyError && (
                <div ref={policyErrorRef} className="rounded-xl border border-rose-200 bg-rose-50/20 p-4 space-y-3">
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

              </div>

              {/* Actions Footer */}
              <div className="flex shrink-0 justify-end gap-2.5 border-t border-slate-100 px-5 py-3">
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
