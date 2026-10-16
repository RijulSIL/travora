import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, ChevronDown, Clock, Plus, Send, ShieldAlert, Ticket, X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

import { RELOCATION_PURPOSE } from '../../components/claims/ClaimRelocationSteps';
import TicketPreviewDrawer from '../../components/ui/TicketPreviewDrawer';
import { EntitlementChips, TravelRequestDetail, TravelRequestRow, TripRow } from '../../components/travel/TravelRequestList';
import { describeRequest } from '../../components/travel/travelRequestView';
import {
  CapsPanel,
  EYEBROW,
  FIELD,
  FlightNote,
  LABEL,
  MODES,
  PolicyChips,
  RouteLine,
  SegButtons,
} from '../../components/travel/TravelRequestFormParts';
import { addWorkingDays, dayOf, daysBetween, shortDate, today, weekdayDate } from '../../components/home/HomeParts';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Pagination from '../../components/ui/Pagination';
import SubmissionAnimation from '../../components/ui/SubmissionAnimation';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useFormValidation from '../../hooks/useFormValidation';
import { usePagination } from '../../hooks/usePagination';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';
import { claimNewPath } from '../../utils/claimRoutes';
import { required } from '../../utils/validators';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';

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

/** "PRJ-1024 — Plant expansion"; just the value when the admin gave no separate description. */
function optionText(option) {
  return option.label && option.label !== option.value ? `${option.value} — ${option.label}` : option.value;
}

const TRIP_TYPES = [
  { value: 'ONE_WAY', label: 'One way' },
  { value: 'ROUND_TRIP', label: 'Round trip' },
  { value: 'MULTI_CITY', label: 'Multi-city' },
];
const TRAVEL_TYPES = [
  { value: 'NON_PROJECT', label: 'Non-project' },
  { value: 'PROJECT', label: 'Project' },
];

function FieldError({ children }) {
  return children ? <p className="mt-1 text-[11px] font-bold text-rose-600">{children}</p> : null;
}

/** "Wed, 14 Oct" */
function formDate(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
}

export default function TravelRequestsPage() {
  useSetPageTitle('Travel Requests');
  const profile = useAuthStore((s) => s.profile);
  const { showToast } = useToast();
  const navigate = useNavigate();
  // 'requests' or 'trips' (My trips), and which requests tab is showing.
  const [view, setView] = useState('requests');
  const [bucket, setBucket] = useState('upcoming');
  const [rows, setRows] = useState([]);
  const [trips, setTrips] = useState([]);
  const [chains, setChains] = useState({});
  const [unclaimedIds, setUnclaimedIds] = useState(() => new Set());
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

  function openTicketMenu(requestId, buttonEl, itemCount = 2) {
    const rect = buttonEl.getBoundingClientRect();
    // Opens below the button, or above it when there isn't room (e.g. the last row on screen).
    const menuHeight = itemCount * 36 + 14;
    const below = rect.bottom + 6 + menuHeight <= window.innerHeight;
    setTicketMenuPos(
      below
        ? { top: rect.bottom + 6, right: window.innerWidth - rect.right }
        : { bottom: window.innerHeight - rect.top + 6, right: window.innerWidth - rect.right },
    );
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

  // The policy in force (level, flights, train classes) for the form's header chips and the
  // "flights aren't in your policy" note. Read on open, like the option lists below.
  const [policyLimits, setPolicyLimits] = useState(null);
  useEffect(() => {
    if (!modalOpen) return;
    reimbursementApi
      .myPolicyLimits()
      .then((r) => setPolicyLimits(r.data || null))
      .catch(() => setPolicyLimits(null));
  }, [modalOpen]);

  // Admins manage these lists, so re-read them every time the form opens rather than caching
  // for the whole session.
  useEffect(() => {
    if (!modalOpen) return;
    reimbursementApi
      .travelOptions()
      .then((r) => {
        const data = r.data || { project_codes: [], trip_purposes: [] };
        // "Relocation" is a Travel Claim purpose only (it starts the relocation claim flow) —
        // the server refuses it on a travel request.
        setTravelOptions({
          ...data,
          trip_purposes: (data.trip_purposes || []).filter((o) => o.value !== RELOCATION_PURPOSE),
        });
      })
      .catch(() => setTravelOptions({ project_codes: [], trip_purposes: [] }));
  }, [modalOpen]);

  // Destinations the traveler's policy limits are shown for: the To City of a one-way / round
  // trip, or each distinct leg destination (with that leg's date) for a multi-city trip — except
  // the city the trip starts from, where the last leg usually ends (home isn't a stop).
  const limitTargets = useMemo(() => {
    const { trip_type: tripType, to_city: toCity, travel_date: travelDate, legs } = form.values;
    const raw = tripType === 'MULTI_CITY'
      ? legs.map((l) => ({ city: l.to_city, date: l.travel_date }))
      : [{ city: toCity, date: travelDate }];
    const home = tripType === 'MULTI_CITY' ? (legs[0]?.from_city || '').trim().toLowerCase() : '';
    const seen = new Set(home ? [home] : []);
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

  // Requests, each one's approval chain (who it's waiting on), the booked trips, and which of
  // those trips aren't on a claim yet — all in one go, reloaded after a create or cancel.
  const loadAll = useCallback(async () => {
    const [my, allTrips, unclaimed] = await Promise.all([
      reimbursementApi.travelRequestsMy(),
      reimbursementApi.bookingTripsMy().catch(() => ({ data: [] })),
      reimbursementApi.bookingTripsMy({ unlinked_only: true }).catch(() => ({ data: [] })),
    ]);
    const list = my.data || [];
    setRows(list);
    setTrips(allTrips.data || []);
    setUnclaimedIds(new Set((unclaimed.data || []).map((t) => t.id)));
    // The list shows straight away; each request's "waiting on …" fills in as its chain arrives.
    list.forEach(({ request }) => {
      reimbursementApi
        .travelRequestApprovalChain(request.id)
        .then((r) => r.data)
        .catch(() => null)
        .then((chain) => setChains((prev) => ({ ...prev, [request.id]: chain })));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadAll();
      } catch (e) {
        if (!cancelled) showToast(e.response?.data?.detail || e.message || 'Failed to load travel data', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAll, showToast]);

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

  // How each request reads (tab, status in plain words, claim window), then the current tab's rows.
  const viewOptions = useMemo(
    () => ({
      trips,
      unclaimedIds,
      claimDays: profile?.workflow_submission_max_working_days || 5,
      claimMode: profile?.workflow_submission_deadline_mode || 'hard_block',
    }),
    [trips, unclaimedIds, profile?.workflow_submission_max_working_days, profile?.workflow_submission_deadline_mode],
  );
  const described = useMemo(
    () => (rows || []).map(({ request }) => ({ request, view: describeRequest(request, chains[request.id], viewOptions) })),
    [rows, chains, viewOptions],
  );
  const bucketCounts = useMemo(() => {
    const counts = { upcoming: 0, past: 0, cancelled: 0, all: described.length };
    described.forEach(({ view }) => {
      counts[view.bucket] += 1;
    });
    return counts;
  }, [described]);
  const staleCount = described.filter(({ view }) => view.stale).length;
  const visibleRequests = useMemo(() => {
    const list = described.filter(({ view }) => bucket === 'all' || view.bucket === bucket);
    // Upcoming: soonest first. Everything else: most recent trip first.
    const key = ({ view }) => (view.start ? view.start.getTime() : 0);
    return list.sort((a, b) => (bucket === 'upcoming' ? key(a) - key(b) : key(b) - key(a)));
  }, [described, bucket]);
  const requestsPagination = usePagination(visibleRequests);
  const tripsPagination = usePagination(trips);

  /** Claim status of one booked trip, grouped with the other trips from the same request. */
  const tripClaim = (trip) => {
    if (!unclaimedIds.has(trip.id)) return { claimed: true, open: false, text: '' };
    const group = trips.filter((t) => t.travel_request_id && t.travel_request_id === trip.travel_request_id);
    const ends = (group.length ? group : [trip]).map((t) => dayOf(t.return_date) || dayOf(t.travel_date)).filter(Boolean);
    const end = ends.sort((a, b) => b - a)[0];
    if (!end) return { claimed: false, open: true, text: '', ids: [trip.id] };
    const deadline = addWorkingDays(end, viewOptions.claimDays);
    const now = today();
    const left = daysBetween(now, deadline);
    const ids = (group.length ? group : [trip]).filter((t) => unclaimedIds.has(t.id)).map((t) => t.id);
    if (end >= now) return { claimed: false, open: false, text: 'Claim after you travel', ids };
    if (now > deadline && viewOptions.claimMode === 'hard_block') return { claimed: false, open: false, text: `Claim window closed ${shortDate(deadline)}`, ids };
    return {
      claimed: false,
      open: true,
      ids,
      text: now > deadline ? `Claim window closed ${shortDate(deadline)} · late claim` : `Claim by ${weekdayDate(deadline)} · ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `${left} days left`}`,
    };
  };
  const startClaim = (ids) => navigate(claimNewPath('TRAVEL', { tripIds: ids.join(',') }));

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

      await loadAll();

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

      await loadAll();

      form.setValues(emptyRequestForm());
      setBookingItemDraft('');
    } catch (err) {
      setSubmissionState({ active: false, status: 'idle', mode: null });
      showToast(err.response?.data?.detail || err.message || 'Failed to submit exception', 'error');
    } finally {
      setSubmittingException(false);
    }
  }

  function closeRequestModal() {
    setModalOpen(false);
    setPolicyError(null);
    setExceptionReason('');
  }

  function updateLeg(index, patch) {
    form.handleChange('legs', form.values.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }

  const isMultiCity = form.values.trip_type === 'MULTI_CITY';
  // Which legs are flights (1-based), or [0] for a one-way / round trip by flight.
  const flightLegs = isMultiCity
    ? form.values.legs.map((leg, i) => (leg.travel_mode === 'FLIGHT' ? i + 1 : 0)).filter(Boolean)
    : form.values.travel_mode === 'FLIGHT'
      ? [0]
      : [];
  const routeSummary = (() => {
    const v = form.values;
    if (isMultiCity) {
      const legs = v.legs;
      const cities = [legs[0]?.from_city, ...legs.map((l) => l.to_city)].map((c) => c || '…');
      const dates = legs.map((l) => l.travel_date).filter(Boolean).sort();
      return (
        <>
          <b className="text-ink">{cities.join(' → ')}</b> · {legs.length} leg{legs.length === 1 ? '' : 's'}
          {dates.length ? ` · ${formDate(dates[0])}${dates[dates.length - 1] !== dates[0] ? ` – ${formDate(dates[dates.length - 1])}` : ''}` : ''}
        </>
      );
    }
    if (!v.from_city && !v.to_city) return null;
    const mode = MODES.find((m) => m.value === v.travel_mode)?.label;
    return (
      <>
        <b className="text-ink">
          {v.from_city || '…'} {v.trip_type === 'ROUND_TRIP' ? '⇄' : '→'} {v.to_city || '…'}
        </b>
        {mode ? ` · ${mode}` : ''}
        {v.travel_date ? ` · ${formDate(v.travel_date)}` : ''}
        {v.trip_type === 'ROUND_TRIP' && v.return_date ? ` – ${formDate(v.return_date)}` : ''}
      </>
    );
  })();

  async function onCancel(id) {
    try {
      await reimbursementApi.travelRequestDelete(id);
      showToast('Request cancelled', 'success');
      await loadAll();
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
        ticketId: tid,
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
        ticketId: ticket.id,
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
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Travel Requests</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">Ask for travel here. Once it&apos;s approved, the travel desk books your tickets.</p>
        </div>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[9px] bg-brand px-3.5 text-[12.5px] font-bold text-white hover:bg-brand/90"
          onClick={() => setModalOpen(true)}
        >
          <Plus size={15} /> New request
        </button>
      </div>

      {entitlement?.text ? <EntitlementChips text={entitlement.text} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-2.5 border-b border-slate-200">
        {view === 'requests' ? (
          <div className="flex flex-wrap gap-0.5" role="tablist" aria-label="Show requests">
            {[
              ['upcoming', 'Upcoming'],
              ['past', 'Past'],
              ['cancelled', 'Cancelled & rejected'],
              ['all', 'All'],
            ].map(([key, label]) => {
              const warn = key === 'past' && staleCount > 0;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={bucket === key}
                  onClick={() => setBucket(key)}
                  title={warn ? `${staleCount} past trip${staleCount > 1 ? 's' : ''} still waiting` : undefined}
                  className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-[9px] text-[12.5px] font-bold ${
                    bucket === key ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                  <span
                    className={`rounded-full px-[7px] py-px text-[10.5px] ${
                      warn ? 'bg-amber-50 text-amber-700' : bucket === key ? 'bg-brand/10 text-brand' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {bucketCounts[key]}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3 pb-2.5 text-[12.5px] font-bold text-slate-700">
            {trips.length} booked trip{trips.length === 1 ? '' : 's'}
            {trips.filter((t) => tripClaim(t).open).length ? (
              <span className="font-bold text-amber-700">{trips.filter((t) => tripClaim(t).open).length} still to claim</span>
            ) : null}
          </div>
        )}
        <div className="mb-1.5 inline-flex rounded-[10px] border border-slate-200 bg-white p-[3px]" role="group" aria-label="Show">
          {[
            ['requests', 'My requests'],
            ['trips', 'My trips'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              className={`rounded-[7px] px-3 py-[5px] text-xs font-bold ${view === key ? 'bg-ink text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
          <Clock className="animate-spin text-slate-400" size={15} /> Loading your travel…
        </div>
      ) : null}

      {!loading && view === 'requests' ? (
        <section aria-label="Travel requests" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
          {visibleRequests.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-slate-500">
              {rows.length === 0
                ? 'No travel requests yet. Use New request to ask for your first trip.'
                : bucket === 'upcoming'
                  ? 'No trips coming up.'
                  : 'Nothing here.'}
            </p>
          ) : (
            requestsPagination.pageItems.map(({ request, view: rv }) => {
              const isOpen = expandedIds.has(request.id);
              const isTicketMenuOpen = openTicketMenuId === request.id;
              const canClaim = rv.claim && !rv.claim.closed;
              return (
                <Fragment key={request.id}>
                  <TravelRequestRow
                    request={request}
                    view={rv}
                    open={isOpen}
                    onToggle={() => toggleExpand(request.id)}
                    actions={
                      <>
                        {canClaim ? (
                          <button
                            type="button"
                            onClick={() => startClaim(rv.claim.ids)}
                            className="inline-flex h-7 items-center rounded-lg bg-brand px-2.5 text-[11.5px] font-bold text-white hover:bg-brand/90"
                          >
                            Start claim
                          </button>
                        ) : null}
                        {rv.ticketed.length === 1 ? (
                          <button
                            type="button"
                            onClick={() => viewTicket(rv.ticketed[0].ticket, `Ticket · ${rv.ticketed[0].label}`)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-bold text-slate-700 hover:bg-slate-50"
                          >
                            <Ticket size={13} /> Ticket
                          </button>
                        ) : rv.ticketed.length > 1 ? (
                          <div ref={isTicketMenuOpen ? ticketMenuTriggerRef : null}>
                            <button
                              type="button"
                              onClick={(e) => (isTicketMenuOpen ? setOpenTicketMenuId(null) : openTicketMenu(request.id, e.currentTarget, rv.ticketed.length))}
                              aria-expanded={isTicketMenuOpen}
                              className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-bold text-slate-700 hover:bg-slate-50"
                            >
                              <Ticket size={13} /> {rv.ticketed.length} tickets
                              <ChevronDown size={12} className={`text-slate-400 transition-transform ${isTicketMenuOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {isTicketMenuOpen && ticketMenuPos
                              ? createPortal(
                                  <div
                                    ref={ticketMenuPanelRef}
                                    style={{ position: 'fixed', top: ticketMenuPos.top, bottom: ticketMenuPos.bottom, right: ticketMenuPos.right }}
                                    className="z-[100] w-56 rounded-lg border border-slate-200 bg-white py-1.5 text-left shadow-lg"
                                  >
                                    {rv.ticketed.map((seg) => (
                                      <button
                                        key={seg.seq}
                                        type="button"
                                        className="block w-full px-3 py-2 text-left text-[11.5px] font-semibold text-slate-700 hover:bg-slate-50"
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
                      </>
                    }
                  />
                  {isOpen ? (
                    <TravelRequestDetail
                      request={request}
                      view={rv}
                      chain={request.id in chains ? chains[request.id] : undefined}
                      onViewTicket={viewTicket}
                      onViewDocument={viewSupportingDocument}
                      footer={
                        <>
                          {rv.cancellable ? (
                            <button
                              type="button"
                              onClick={() => setConfirmCancelId(request.id)}
                              className="inline-flex h-7 items-center rounded-lg border border-rose-200 bg-white px-2.5 text-[11.5px] font-bold text-rose-700 hover:bg-rose-50"
                            >
                              Cancel request
                            </button>
                          ) : null}
                          {canClaim ? (
                            <button
                              type="button"
                              onClick={() => startClaim(rv.claim.ids)}
                              className="inline-flex h-7 items-center rounded-lg bg-brand px-2.5 text-[11.5px] font-bold text-white hover:bg-brand/90"
                            >
                              Start claim
                            </button>
                          ) : null}
                        </>
                      }
                    />
                  ) : null}
                </Fragment>
              );
            })
          )}
          {visibleRequests.length ? (
            <Pagination
              page={requestsPagination.page}
              totalPages={requestsPagination.totalPages}
              onPageChange={requestsPagination.setPage}
              total={requestsPagination.total}
              pageSize={requestsPagination.pageSize}
              startIndex={requestsPagination.startIndex}
            />
          ) : null}
        </section>
      ) : null}

      {!loading && view === 'trips' ? (
        <section aria-label="Booked trips" className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
          {trips.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-slate-500">No booked trips yet. They show up here once the travel desk books your tickets.</p>
          ) : (
            tripsPagination.pageItems.map((t) => {
              const claim = tripClaim(t);
              return (
                <TripRow
                  key={t.id}
                  trip={t}
                  claim={claim}
                  actions={
                    <>
                      {claim.open && claim.ids?.length ? (
                        <button
                          type="button"
                          onClick={() => startClaim(claim.ids)}
                          className="inline-flex h-7 items-center rounded-lg bg-brand px-2.5 text-[11.5px] font-bold text-white hover:bg-brand/90"
                        >
                          Start claim
                        </button>
                      ) : null}
                      {t.desk_ticket_id ? (
                        <button
                          type="button"
                          onClick={() => previewTripDesk(t)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-bold text-slate-700 hover:bg-slate-50"
                        >
                          <Ticket size={13} /> Ticket
                        </button>
                      ) : null}
                    </>
                  }
                />
              );
            })
          )}
          {trips.length ? (
            <Pagination
              page={tripsPagination.page}
              totalPages={tripsPagination.totalPages}
              onPageChange={tripsPagination.setPage}
              total={tripsPagination.total}
              pageSize={tripsPagination.pageSize}
              startIndex={tripsPagination.startIndex}
            />
          ) : null}
        </section>
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
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-travel-request-title"
            className="flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="flex shrink-0 items-start justify-between gap-2.5 border-b border-slate-100 px-4 pb-3.5 pt-[18px] sm:px-[22px]">
              <div className="min-w-0">
                <h2 id="new-travel-request-title" className="text-[17px] font-extrabold text-ink">New travel request</h2>
                <p className="mt-0.5 text-[12.5px] text-slate-500">The travel desk books your tickets once it&apos;s approved.</p>
                <PolicyChips limits={policyLimits} />
              </div>
              <button
                type="button"
                aria-label="Close"
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                onClick={closeRequestModal}
              >
                <X size={18} />
              </button>
            </div>

            <form className="flex min-h-0 flex-1 flex-col" onSubmit={onCreate}>
              <div className="min-h-0 flex-1 space-y-[18px] overflow-y-auto px-4 pb-[18px] pt-4 sm:px-[22px]">
                {/* Your trip */}
                <section className="space-y-3">
                  <p className={EYEBROW}>Your trip</p>
                  <div className="flex flex-wrap gap-2.5">
                    <SegButtons
                      label="Trip type"
                      options={TRIP_TYPES}
                      value={form.values.trip_type}
                      onChange={(v) => form.handleChange('trip_type', v)}
                    />
                    {!isMultiCity ? (
                      <SegButtons
                        label="Travel mode"
                        options={MODES}
                        value={form.values.travel_mode}
                        onChange={(v) => form.handleChange('travel_mode', v)}
                      />
                    ) : null}
                  </div>

                  {!isMultiCity ? (
                    <>
                      <div className="grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] items-end gap-2">
                        <div>
                          <label htmlFor="tr-from" className={LABEL}>From</label>
                          <input
                            id="tr-from"
                            className={FIELD}
                            required
                            value={form.values.from_city}
                            onChange={(e) => {
                              setCityQ(e.target.value);
                              form.handleChange('from_city', e.target.value);
                            }}
                            onBlur={() => form.handleBlur('from_city')}
                            list="city-from"
                          />
                        </div>
                        <button
                          type="button"
                          aria-label="Swap from and to"
                          title="Swap"
                          className="grid h-[38px] w-8 place-items-center rounded-[10px] border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                          onClick={() => form.setValues({ ...form.values, from_city: form.values.to_city, to_city: form.values.from_city })}
                        >
                          <ArrowLeftRight size={15} />
                        </button>
                        <div>
                          <label htmlFor="tr-to" className={LABEL}>To</label>
                          <input
                            id="tr-to"
                            className={FIELD}
                            required
                            value={form.values.to_city}
                            onChange={(e) => {
                              setCityQ(e.target.value);
                              form.handleChange('to_city', e.target.value);
                            }}
                            onBlur={() => form.handleBlur('to_city')}
                            list="city-to"
                          />
                        </div>
                      </div>
                      {form.errors.from_city || form.errors.to_city ? (
                        <FieldError>{form.errors.from_city || form.errors.to_city}</FieldError>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="tr-date" className={LABEL}>{form.values.trip_type === 'ROUND_TRIP' ? 'Going on' : 'Travel date'}</label>
                          <input
                            id="tr-date"
                            type="date"
                            required
                            className={FIELD}
                            value={form.values.travel_date}
                            onChange={(e) => form.handleChange('travel_date', e.target.value)}
                            onBlur={() => form.handleBlur('travel_date')}
                          />
                          <FieldError>{form.errors.travel_date}</FieldError>
                        </div>
                        {form.values.trip_type === 'ROUND_TRIP' ? (
                          <div>
                            <label htmlFor="tr-return" className={LABEL}>Coming back on</label>
                            <input
                              id="tr-return"
                              type="date"
                              required
                              className={FIELD}
                              value={form.values.return_date}
                              onChange={(e) => form.handleChange('return_date', e.target.value)}
                              onBlur={() => form.handleBlur('return_date')}
                            />
                            <FieldError>{form.errors.return_date}</FieldError>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div>
                      <RouteLine legs={form.values.legs} />
                      <div className="hidden grid-cols-[26px_118px_minmax(0,1fr)_minmax(0,1fr)_138px_28px] gap-2 pt-1.5 text-[11px] font-bold text-slate-400 sm:grid" aria-hidden="true">
                        <span />
                        <span>Mode</span>
                        <span>From</span>
                        <span>To</span>
                        <span>Date</span>
                        <span />
                      </div>
                      {form.values.legs.map((leg, i) => {
                        const isFlightWarn = leg.travel_mode === 'FLIGHT' && policyLimits && policyLimits.air_eligibility !== 'YES';
                        return (
                          <div
                            key={i}
                            className="relative mb-2 grid grid-cols-[26px_minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-2 rounded-xl border border-slate-200 p-2 sm:mb-0 sm:grid-cols-[26px_118px_minmax(0,1fr)_minmax(0,1fr)_138px_28px] sm:rounded-none sm:border-0 sm:px-0 sm:py-1.5"
                          >
                            {i > 0 ? <span className="absolute -top-3.5 left-[11px] hidden h-[30px] w-0.5 bg-brand/25 sm:block" aria-hidden="true" /> : null}
                            <span className="relative row-span-3 grid h-6 w-6 place-items-center self-start rounded-full bg-brand/10 text-[11px] font-extrabold text-brand sm:row-span-1 sm:self-center">
                              {i + 1}
                            </span>
                            <select
                              aria-label={`Leg ${i + 1} mode`}
                              className={`${FIELD} col-span-2 sm:col-span-1 ${isFlightWarn ? 'border-amber-200 bg-amber-50' : ''}`}
                              required
                              value={leg.travel_mode || 'FLIGHT'}
                              onChange={(e) => updateLeg(i, { travel_mode: e.target.value })}
                            >
                              {MODES.map((m) => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              aria-label={`Remove leg ${i + 1}`}
                              disabled={form.values.legs.length < 2}
                              onClick={() => form.handleChange('legs', form.values.legs.filter((_, idx) => idx !== i))}
                              className="col-start-4 row-start-1 grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 sm:col-start-6"
                            >
                              <X size={14} />
                            </button>
                            <input
                              aria-label={`Leg ${i + 1} from`}
                              placeholder="From"
                              className={`${FIELD} sm:col-start-3 sm:row-start-1`}
                              required
                              value={leg.from_city}
                              onChange={(e) => {
                                setCityQ(e.target.value);
                                updateLeg(i, { from_city: e.target.value });
                              }}
                              list="city-from"
                            />
                            <input
                              aria-label={`Leg ${i + 1} to`}
                              placeholder="To"
                              className={`${FIELD} col-span-2 sm:col-span-1 sm:col-start-4 sm:row-start-1`}
                              required
                              value={leg.to_city}
                              onChange={(e) => {
                                setCityQ(e.target.value);
                                updateLeg(i, { to_city: e.target.value });
                              }}
                              list="city-to"
                            />
                            <input
                              type="date"
                              aria-label={`Leg ${i + 1} date`}
                              className={`${FIELD} col-span-3 sm:col-span-1 sm:col-start-5 sm:row-start-1`}
                              required
                              value={leg.travel_date}
                              onChange={(e) => updateLeg(i, { travel_date: e.target.value })}
                            />
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          const last = form.values.legs[form.values.legs.length - 1];
                          form.handleChange('legs', [
                            ...form.values.legs,
                            { travel_mode: 'FLIGHT', from_city: last?.to_city || '', to_city: '', travel_date: '', preferred_time: '' },
                          ]);
                        }}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-[9px] border border-dashed border-brand/40 bg-white px-2.5 py-1.5 text-xs font-bold text-brand hover:bg-brand/5 sm:ml-[34px]"
                      >
                        <Plus size={13} /> Add a leg
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

                  <FlightNote limits={policyLimits} flightLegs={flightLegs} multi={isMultiCity} />
                  {showExpenseLimits ? <CapsPanel limits={cityLimits} loading={limitsLoading} /> : null}
                </section>

                {/* Why */}
                <section className="space-y-3">
                  <p className={EYEBROW}>Why you&apos;re travelling</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="tr-purpose" className={LABEL}>Purpose</label>
                      <select
                        id="tr-purpose"
                        className={FIELD}
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
                        <p className="mt-1 text-[11px] font-bold text-amber-700">No trip purposes are configured yet. Ask an admin to add them.</p>
                      ) : null}
                      <FieldError>{form.errors.purpose}</FieldError>
                    </div>
                    <div>
                      <span className={LABEL}>Travel type</span>
                      <SegButtons
                        label="Travel type"
                        options={TRAVEL_TYPES}
                        value={form.values.travel_type}
                        onChange={(v) => form.setValues({ ...form.values, travel_type: v, project_code: '' })}
                        stretch
                      />
                    </div>
                  </div>
                  {form.values.travel_type === 'PROJECT' ? (
                    <div>
                      <label htmlFor="tr-project" className={LABEL}>Project code</label>
                      <select
                        id="tr-project"
                        className={FIELD}
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
                        <p className="mt-1 text-[11px] font-bold text-amber-700">No project codes are configured yet. Ask an admin to add them.</p>
                      ) : null}
                      <FieldError>{form.errors.project_code}</FieldError>
                    </div>
                  ) : null}
                </section>

                {/* Anything else */}
                <section className="space-y-3">
                  <p className={EYEBROW}>Anything else</p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.values.needs_additional_booking}
                    onClick={() => form.handleChange('needs_additional_booking', !form.values.needs_additional_booking)}
                    className="flex w-full items-center justify-between gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span>
                      <b className="block text-[13px] text-ink">The company should also book something</b>
                      <span className="text-xs text-slate-500">e.g. a hotel, a cab, a visa</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${form.values.needs_additional_booking ? 'bg-brand' : 'bg-slate-200'}`}
                    >
                      <span
                        className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${form.values.needs_additional_booking ? 'left-[19px]' : 'left-[3px]'}`}
                      />
                    </span>
                  </button>
                  {form.values.needs_additional_booking ? (
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {form.values.additional_booking_items.map((item, idx) => (
                          <span key={idx} className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-slate-100 py-1 pl-2 pr-1 text-xs font-semibold text-slate-700">
                            <span className="truncate">{item}</span>
                            <button
                              type="button"
                              aria-label={`Remove ${item}`}
                              className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:text-rose-600"
                              onClick={() => removeBookingItem(idx)}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                        <div className="flex min-w-[220px] flex-1 gap-1.5">
                          <input
                            aria-label="Something else to book"
                            className={`${FIELD} h-8`}
                            placeholder="Add one, e.g. 2 nights hotel near client office"
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
                            className="h-8 shrink-0 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-600 hover:bg-slate-200"
                            onClick={addBookingItem}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                      <FieldError>{form.errors.additional_booking_items}</FieldError>
                    </div>
                  ) : null}
                  <div>
                    <label htmlFor="tr-notes" className={LABEL}>
                      Notes for the travel desk <small className="font-medium text-slate-400">(optional)</small>
                    </label>
                    <input
                      id="tr-notes"
                      className={FIELD}
                      placeholder="Meal preference, seat, timing…"
                      value={form.values.notes}
                      onChange={(e) => form.handleChange('notes', e.target.value)}
                      onBlur={() => form.handleBlur('notes')}
                    />
                  </div>
                </section>

                {/* The server said this needs an exception */}
                {policyError ? (
                  <section ref={policyErrorRef} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
                    <div className="flex items-start gap-2 text-xs text-amber-900">
                      <ShieldAlert size={16} className="mt-px shrink-0 text-amber-700" />
                      <div>
                        <b className="block text-[13px]">This trip needs an exception</b>
                        {policyError}
                      </div>
                    </div>
                    <div>
                      <label htmlFor="tr-exception" className={LABEL}>Why do you need it?</label>
                      <textarea
                        id="tr-exception"
                        rows={2}
                        className="min-h-[3rem] w-full rounded-[10px] border border-amber-200 bg-white p-2.5 text-[13px] text-ink outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200/60"
                        placeholder="e.g. Urgent customer escalation meeting requested by the VP"
                        value={exceptionReason}
                        onChange={(e) => setExceptionReason(e.target.value)}
                      />
                    </div>
                    <p className="text-[11.5px] text-amber-800">It goes for exception approval first, then to the travel desk.</p>
                  </section>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-[22px]">
                <div className="min-w-0 text-[12.5px] text-slate-500">{routeSummary}</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center rounded-[10px] border border-slate-200 bg-white px-3.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50"
                    onClick={closeRequestModal}
                  >
                    Cancel
                  </button>
                  {policyError ? (
                    <button
                      type="button"
                      disabled={submittingException}
                      onClick={handleRequestException}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] bg-amber-700 px-3.5 text-[12.5px] font-bold text-white hover:bg-amber-800 disabled:opacity-50"
                    >
                      <Send size={14} /> {submittingException ? 'Submitting…' : 'Submit with exception'}
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] bg-brand px-3.5 text-[12.5px] font-bold text-white hover:bg-brand/90 disabled:opacity-50"
                    >
                      <Send size={14} /> {isSubmitting ? 'Submitting…' : 'Submit request'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      ) : null}

      <TicketPreviewDrawer
        open={preview.open}
        ticketId={preview.ticketId}
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
