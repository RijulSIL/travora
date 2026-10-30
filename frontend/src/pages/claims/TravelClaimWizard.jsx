import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  RELOCATION_PURPOSE,
  RelocationApprovalStep,
  RelocationSummaryStep,
  RelocationUndertakingStep,
} from '../../components/claims/ClaimRelocationSteps';
import ClaimWizardShell, { ClaimSummaryCard, dateSpan, netPayable, policyCounts } from '../../components/claims/ClaimWizardShell';
import ClaimWizardStepEvidence from '../../components/claims/ClaimWizardStepEvidence';
import { claimWindow, claimWindowDays, travelRef } from '../../components/travel/travelRequestView';
import { dayOf } from '../../components/home/HomeParts';
import ClaimWizardStepPolicyCheck from '../../components/claims/ClaimWizardStepPolicyCheck';
import ClaimWizardStepSubmit from '../../components/claims/ClaimWizardStepSubmit';
import ClaimWizardStepTripInfo from '../../components/claims/ClaimWizardStepTripInfo';
import ClaimExceptionsModal from '../../components/claims/ClaimExceptionsModal';
import TicketPreviewDrawer from '../../components/ui/TicketPreviewDrawer';
import ClaimSubmitAnimation from '../../components/ui/ClaimSubmitAnimation';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';

const STEP_LABELS = ['Trip', 'Invoices', 'Policy check', 'Submit'];
// The Relocation Claim form (`relocation`): raised against an approved relocation,
// Relocation-tagged invoices only, no policy check, and an undertaking to accept.
const RELOCATION_STEP_LABELS = ['Relocation', 'Invoices', 'Summary', 'Submit'];

function errorDetail(error, fallback) {
  const detail = error?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

function isoDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

/** Travel Claim, or — with `relocation` — the Relocation Claim form (its own route and menu entry;
 * they share the invoice step and the submit flow). */
export default function TravelClaimWizard({ relocation = false }) {
  const isRelocation = relocation;
  useSetPageTitle(isRelocation ? 'Relocation Claim' : 'Travel Claim');
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const effectiveEditId = id || null;
  const invoiceIdsFromUrl = useMemo(
    () =>
      (searchParams.get('invoiceIds') || '')
        .split(',')
        .map((value) => Number(value))
        .filter(Boolean),
    [searchParams],
  );
  const tripIdsFromUrl = useMemo(
    () =>
      (searchParams.get('tripIds') || '')
        .split(',')
        .map((value) => Number(value))
        .filter(Boolean),
    [searchParams],
  );
  const { showToast } = useToast();
  // Each form keeps its own unsaved draft, so starting one never resumes the other.
  const draftKey = isRelocation ? 'travora_relocation_claim_draft' : 'travora_claim_draft';

  // Links from before relocation had its own form (/claims/travel/new?purpose=Relocation).
  useEffect(() => {
    if (!isRelocation && !id && searchParams.get('purpose') === RELOCATION_PURPOSE) {
      navigate('/claims/relocation/new', { replace: true });
    }
  }, [isRelocation, id, searchParams, navigate]);

  const [currentStep, setCurrentStep] = useState(1);
  const [claim, setClaim] = useState(null);
  const [form, setForm] = useState({
    trip_purpose: isRelocation ? RELOCATION_PURPOSE : '',
    travel_type: 'NON_PROJECT',
    project_code: '',
    office_location: '',
    from_city: '',
    destination_city: '',
    departure_date: '',
    return_date: '',
  });
  const [officeLocations, setOfficeLocations] = useState([]);
  const [travelOptions, setTravelOptions] = useState({ project_codes: [], trip_purposes: [] });
  const [cityQ, setCityQ] = useState('');
  const [cityOptions, setCityOptions] = useState([]);
  const [cityGroupHint, setCityGroupHint] = useState('');
  // { tone, title, text } when the trip is past its on-time claim window (late, or archived).
  const [deadlineWarning, setDeadlineWarning] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [windowDays, setWindowDays] = useState(() => claimWindowDays(null));
  const [trips, setTrips] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedTripIds, setSelectedTripIds] = useState(tripIdsFromUrl);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState(invoiceIdsFromUrl);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [drawer, setDrawer] = useState({ open: false, blob: null, name: '', type: '', title: '' });
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [declarationChecked, setDeclarationChecked] = useState(false);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [submittedClaim, setSubmittedClaim] = useState(null);
  const [relocations, setRelocations] = useState([]);
  const [relocationsLoading, setRelocationsLoading] = useState(false);
  const [relocationRequestId, setRelocationRequestId] = useState(null);
  const [undertakingAccepted, setUndertakingAccepted] = useState(false);
  const stepLabels = isRelocation ? RELOCATION_STEP_LABELS : STEP_LABELS;
  const selectedRelocation = relocations.find((row) => row.id === relocationRequestId) || null;

  const loadRelocations = useCallback(async () => {
    setRelocationsLoading(true);
    try {
      const response = await reimbursementApi.relocationMine();
      const rows = response.data || [];
      setRelocations(rows);
      const approved = rows.filter((row) => row.status === 'APPROVED');
      // Keep the current choice while it's still usable; otherwise pick the only approved one.
      setRelocationRequestId((prev) =>
        prev && approved.some((row) => row.id === prev) ? prev : approved.length === 1 ? approved[0].id : null,
      );
    } catch {
      showToast('Could not load your relocations', 'error');
    } finally {
      setRelocationsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (isRelocation) loadRelocations();
  }, [isRelocation, loadRelocations]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tripOutcome, invoiceOutcome, meOutcome, optionsOutcome] = await Promise.allSettled([
        reimbursementApi.bookingTripsMy({ unlinked_only: true, editing_claim_id: effectiveEditId || undefined }),
        reimbursementApi.invoices({ unlinked: true, editing_claim_id: effectiveEditId || undefined }),
        reimbursementApi.me(),
        reimbursementApi.travelOptions(),
      ]);
      if (!cancelled) {
        if (tripOutcome.status === 'fulfilled') {
          const allTrips = tripOutcome.value.data || [];
          // Filling from the URL-linked trip(s) is handled by the selectedTripIds resync
          // effect below (selectedTripIds is already seeded from tripIdsFromUrl), which
          // re-runs as soon as `trips` updates here — no separate fill needed, and doing it
          // here too with blank-only gating would just reintroduce the stale-value bug.
          setTrips(allTrips);
        } else {
          setTrips([]);
        }
        if (invoiceOutcome.status === 'fulfilled') {
          setInvoices((invoiceOutcome.value.data || []).slice(0, 50));
        } else {
          setInvoices([]);
        }
        if (meOutcome.status === 'fulfilled') {
          const data = meOutcome.value.data;
          setOfficeLocations(data?.company_office_locations || []);
          if (!effectiveEditId) {
            setForm((prev) => ({
              ...prev,
              office_location: prev.office_location || data?.office_location || '',
              from_city: prev.from_city || data?.office_location || '',
            }));
          }
          setWindowDays(claimWindowDays(data));
        } else {
          setOfficeLocations([]);
        }
        if (tripOutcome.status === 'rejected' || invoiceOutcome.status === 'rejected') {
          showToast('Could not load trips or invoices', 'error');
        }
        if (optionsOutcome.status === 'fulfilled') {
          setTravelOptions(optionsOutcome.value.data || { project_codes: [], trip_purposes: [] });
        } else {
          setTravelOptions({ project_codes: [], trip_purposes: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    if (!effectiveEditId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await reimbursementApi.claimDetail(effectiveEditId);
        if (cancelled) return;
        const row = detail.data;
        // A relocation claim opened from an old travel-claim link edits in its own form, and the other way round.
        if ((row.reimbursement_category === 'RELOCATION') !== isRelocation) {
          const segment = row.reimbursement_category === 'RELOCATION' ? 'relocation' : 'travel';
          navigate(`/claims/${segment}/${row.id}/edit`, { replace: true });
          return;
        }
        setClaim(row);
        setForm((prev) => ({
          ...prev,
          trip_purpose: row.trip_purpose || '',
          travel_type: row.travel_type || 'NON_PROJECT',
          project_code: row.project_code || '',
          office_location: row.office_location || '',
          from_city: row.from_city || '',
          destination_city: row.destination_city || '',
          departure_date: isoDate(row.departure_date),
          return_date: isoDate(row.return_date),
        }));
        setSelectedTripIds(row.trip_ids || []);
        setSelectedInvoiceIds(row.invoice_ids || []);
        setRelocationRequestId(row.relocation_request_id || null);
      } catch {
        showToast('Could not load claim to edit', 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveEditId, isRelocation, navigate, showToast]);

  // From City / Destination City autocomplete — same debounced City Groups suggestion endpoint
  // the Travel Request form already uses (city_suggestions / CityGroup.city_name), so both
  // forms offer identical suggestions. Free text still works: a city missing here just falls
  // back to the default tier (see resolve_city_group), it isn't a closed list.
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

  // Draft Auto-Save: Load from localStorage on mount
  useEffect(() => {
    if (effectiveEditId) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // A travel-claim draft saved before relocation had its own form may be a relocation one.
        if ((parsed.form?.trip_purpose === RELOCATION_PURPOSE) !== isRelocation) return;
        if (parsed.form) setForm(prev => ({ ...prev, ...parsed.form }));
        if (parsed.selectedTripIds) setSelectedTripIds(parsed.selectedTripIds);
        if (parsed.selectedInvoiceIds) setSelectedInvoiceIds(parsed.selectedInvoiceIds);
        if (parsed.relocationRequestId) setRelocationRequestId(parsed.relocationRequestId);
        if (parsed.currentStep) setCurrentStep(parsed.currentStep);
      }
    } catch {
      // ignore parse errors
    }
  }, [effectiveEditId, draftKey, isRelocation]);

  // Draft Auto-Save: Save to localStorage on change
  useEffect(() => {
    if (effectiveEditId) return; // Don't auto-save if editing a backend claim
    const draftData = { form, selectedTripIds, selectedInvoiceIds, relocationRequestId, currentStep };
    localStorage.setItem(draftKey, JSON.stringify(draftData));
  }, [form, selectedTripIds, selectedInvoiceIds, relocationRequestId, currentStep, effectiveEditId, draftKey]);

  // Each claim type draws only from invoices tagged for it: a Travel claim from Travel, a
  // relocation claim from Relocation. General invoices belong to the
  // General Reimbursement wizard (see GeneralReimbursementWizard.jsx's visibleInvoices).
  const visibleInvoices = useMemo(
    () =>
      invoices.filter((invoice) => invoice.reimbursement_category === (isRelocation ? 'RELOCATION' : 'TRAVEL')),
    [invoices, isRelocation],
  );

  const reviewWarning = useMemo(() => {
    const selected = invoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id));
    return selected.some((invoice) => invoice.status !== 'REVIEWED')
      ? 'Review this invoice before submitting'
      : '';
  }, [invoices, selectedInvoiceIds]);

  const sentBackHint = claim?.status === 'SENT_BACK' ? 'Invoice missing — add hotel invoice.' : '';

  // A multi-city trip is booked as several separate TravelTrip rows (one per ticket/leg),
  // linked only by a shared travel_request_id — group them back into one selectable unit so
  // picking "the trip" links every leg together, instead of hunting down each ticket one by
  // one. A group only shows at all once at least one of its legs actually has an issued
  // ticket (desk_ticket_id set) — an entirely unticketed trip isn't ready to claim against yet.
  const tripGroups = useMemo(() => {
    const groups = new Map();
    for (const trip of trips) {
      const key = trip.travel_request_id ?? `solo-${trip.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(trip);
    }
    return Array.from(groups.entries())
      .map(([key, legs]) => {
        const sortedLegs = [...legs].sort((a, b) => new Date(a.travel_date) - new Date(b.travel_date));
        return {
          key,
          legs: sortedLegs,
          tripIds: sortedLegs.map((leg) => leg.id),
          hasIssuedTicket: sortedLegs.some((leg) => leg.desk_ticket_id != null),
          // The request's actual trip_type (ONE_WAY/ROUND_TRIP/MULTI_CITY) — leg count alone
          // can't tell a round trip (2 legs, same pair of cities) apart from a genuine
          // multi-city itinerary (2+ legs through different cities).
          tripType: sortedLegs[0]?.trip_type ?? (sortedLegs.length > 1 ? 'MULTI_CITY' : 'ONE_WAY'),
        };
      })
      .filter((group) => group.hasIssuedTicket);
  }, [trips]);

  // Tracks which exact set of trip legs the Trip/Destination/Date fields were last derived
  // from — compared against on every run so a *change* in selection always resyncs those
  // fields to match it. A plain "only fill if still blank" check (the previous approach)
  // sounds safe, but it means any wrong value that ever lands in these fields — a stale
  // autosaved draft, a prior bug, anything — permanently blocks them from ever being
  // corrected, since they no longer look "empty" to that check.
  const lastTripSelectionKey = useRef(null);

  useEffect(() => {
    if (selectedTripIds.length === 0 || trips.length === 0) {
      lastTripSelectionKey.current = null;
      return;
    }

    // `trips` comes back newest-date-first (see list_trips_for_merged_employee_scope) — sort
    // the actually-selected legs by date so the earliest one (the outbound leg) is always what
    // fills From/Destination/Departure, not whichever leg happened to load first.
    const selectedLegs = trips
      .filter((t) => selectedTripIds.includes(t.id))
      .sort((a, b) => new Date(a.travel_date) - new Date(b.travel_date));
    const firstTrip = selectedLegs[0];
    const lastTrip = selectedLegs[selectedLegs.length - 1];
    if (!firstTrip) return;

    const selectionKey = selectedLegs.map((t) => t.id).join(',');
    if (lastTripSelectionKey.current === selectionKey) return;
    lastTripSelectionKey.current = selectionKey;

    const departureValue = isoDate(firstTrip.travel_date);
    // `return_date` lives on the parent travel request (same value on every leg), but a
    // multi-city request may never set one — fall back to the latest selected leg's own date
    // (the final leg home) in that case.
    const returnValue = isoDate(firstTrip.return_date || lastTrip.travel_date);

    setForm(prev => {
      const next = { ...prev };
      let changed = false;

      if (firstTrip.from_city && next.from_city !== firstTrip.from_city) {
        next.from_city = firstTrip.from_city;
        changed = true;
      }
      if (firstTrip.to_city && next.destination_city !== firstTrip.to_city) {
        next.destination_city = firstTrip.to_city;
        changed = true;
      }
      if (departureValue && next.departure_date !== departureValue) {
        next.departure_date = departureValue;
        changed = true;
      }
      if (returnValue && next.return_date !== returnValue) {
        next.return_date = returnValue;
        changed = true;
      }
      if (firstTrip.purpose && next.trip_purpose !== firstTrip.purpose) {
        next.trip_purpose = firstTrip.purpose;
        changed = true;
      }
      if (firstTrip.travel_type && next.travel_type !== firstTrip.travel_type) {
        next.travel_type = firstTrip.travel_type;
        changed = true;
      }
      if (firstTrip.project_code && next.project_code !== firstTrip.project_code) {
        next.project_code = firstTrip.project_code;
        changed = true;
      }

      if (!next.office_location && next.from_city) {
        const match = officeLocations.find(loc =>
          loc.toLowerCase() === next.from_city.toLowerCase()
        );
        if (match) {
          next.office_location = match;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [selectedTripIds, trips, officeLocations]);

  const onChange = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'office_location' && value && !prev.from_city) {
        next.from_city = value;
      }
      if (key === 'travel_type' && value !== 'PROJECT') {
        next.project_code = '';
      }
      return next;
    });
  };

  const validateStep1 = () => {
    const next = {};
    if (!form.trip_purpose.trim()) next.trip_purpose = 'Trip purpose is required.';
    if (form.travel_type === 'PROJECT' && !form.project_code.trim()) next.project_code = 'Project code is required.';
    if (!form.office_location.trim()) next.office_location = 'Office location is required.';
    if (!form.from_city.trim()) next.from_city = 'From city is required.';
    if (!form.destination_city.trim()) next.destination_city = 'Destination city is required.';
    if (!form.departure_date) next.departure_date = 'Departure date is required.';
    if (!form.return_date) next.return_date = 'Return date is required.';
    if (form.departure_date && form.return_date && form.return_date < form.departure_date) {
      next.return_date = 'Return date must be on or after departure date.';
    }
    // Counted from the trip's to date (the return date here): a late claim needs an exception,
    // an archived trip can't be claimed (claim_submission_rules.claim_lateness on the server).
    const ended = dayOf(form.return_date);
    const claimState = ended ? claimWindow(ended, windowDays) : null;
    if (claimState?.state === 'archived') {
      next.return_date = 'Too late to claim this trip.';
      setDeadlineWarning({
        tone: 'rose',
        title: 'This trip is archived',
        text: `It ended more than ${windowDays.archiveDays} days ago, so it can no longer be claimed.`,
      });
    } else if (claimState?.state === 'late') {
      setDeadlineWarning({
        tone: 'amber',
        title: 'Late claim',
        text: `The trip ended more than ${windowDays.lateDays} days ago. You can still claim it until ${claimState.lastDay.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: you'll give a reason when you submit, and it goes to the exception approvers.`,
      });
    } else {
      setDeadlineWarning(null);
    }
    setValidationErrors(next);
    return !Object.keys(next).length;
  };

  const resolveDestinationCity = async () => {
    if (!form.destination_city || !form.departure_date) return;
    try {
      const res = await reimbursementApi.resolveCityGroup(form.destination_city, form.departure_date);
      const group = res.data?.group_type;
      if (group == null || String(group).trim() === '') {
        setCityGroupHint('');
        showToast('City group could not be resolved for that destination.', 'error');
        return;
      }
      const label = String(group).trim().toUpperCase();
      setCityGroupHint(
        `${form.destination_city.trim()} maps to Group ${label} for this travel date. Hotel and per-diem caps follow the active policy for that group.`,
      );
    } catch {
      setCityGroupHint('');
      showToast('Could not look up city group. Check the destination and date, then try again.', 'error');
    }
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const claimId = claim?.id || (effectiveEditId ? Number(effectiveEditId) : null);
      // Relocation claims: no trips or dates; cities, travel type and project code come from the
      // approved relocation on the server (create_or_update_claim_draft).
      const relocationPayload = {
        claim_id: claimId,
        reimbursement_category: 'RELOCATION',
        relocation_request_id: relocationRequestId,
        invoice_ids: selectedInvoiceIds,
        trip_ids: [],
        trip_purpose: RELOCATION_PURPOSE,
        travel_type: 'NON_PROJECT',
        project_code: null,
        departure_date: null,
        return_date: null,
        office_location: form.office_location || null,
        from_city: selectedRelocation?.origin_city || null,
        destination_city: selectedRelocation?.destination_city || null,
        advance_received: '0',
      };
      const payload = isRelocation ? relocationPayload : {
        claim_id: claimId,
        reimbursement_category: 'TRAVEL',
        invoice_ids: selectedInvoiceIds,
        trip_ids: selectedTripIds,
        trip_purpose: form.trip_purpose || null,
        travel_type: form.travel_type,
        project_code: form.travel_type === 'PROJECT' ? form.project_code || null : null,
        departure_date: form.departure_date || null,
        return_date: form.return_date || null,
        office_location: form.office_location || null,
        from_city: form.from_city || null,
        destination_city: form.destination_city || null,
        advance_received: '0',
      };
      const response = await reimbursementApi.saveClaimDraft(payload);
      setClaim(response.data);
      localStorage.removeItem(draftKey);
      return response.data;
    } finally {
      setSaving(false);
    }
  };

  const onUploadInvoice = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      // Quick-uploading from inside the wizard tags the invoice for this claim's type — Travel,
      // or Relocation on a relocation claim.
      formData.append('reimbursement_category', isRelocation ? 'RELOCATION' : 'TRAVEL');
      setUploadingInvoice(true);
      try {
        const uploaded = await reimbursementApi.uploadInvoice(formData);
        const row = uploaded.data;
        setInvoices((prev) => [row, ...prev.filter((item) => item.id !== row.id)]);
        setSelectedInvoiceIds((prev) => [...new Set([...prev, row.id])]);
        showToast('Invoice uploaded', 'success');
      } catch {
        showToast('Invoice upload failed', 'error');
      } finally {
        setUploadingInvoice(false);
      }
    };
    input.click();
  };

  const previewTicket = async (trip) => {
    try {
      const response = await reimbursementApi.travelTicketFileBlob(trip.desk_ticket_id);
      setDrawer({
        open: true,
        ticketId: trip.desk_ticket_id,
        blob: response.data,
        name: `${trip.reference_id || trip.id}-ticket`,
        type: response.headers['content-type'] || '',
        title: `Trip ${trip.reference_id || trip.id}`,
      });
    } catch {
      showToast('Could not preview ticket', 'error');
    }
  };

  // Flagged expenses, plus the whole claim's late-claim exception when it's late.
  const exceptionExpenses = [
    ...(claim?.expenses || []).filter((expense) => expense.exception_reason_required),
    ...(claim?.late_claim?.exception_reason_required ? [claim.late_claim] : []),
  ];

  const sendClaim = async (exceptions = []) => {
    if (!claim?.id) return;
    setSubmitting(true);
    try {
      const response = await reimbursementApi.submitClaim(claim.id, {
        exceptions,
        undertaking_accepted: isRelocation && undertakingAccepted,
      });
      const submitted = response?.data || claim;
      localStorage.removeItem(draftKey);
      showToast(`Claim submitted successfully. Claim ID: ${submitted.claim_reference || `CLM-${submitted.id}`}`, 'success');
      setExceptionsOpen(false);
      setSubmittedClaim(submitted);
    } catch (error) {
      showToast(errorDetail(error, 'Submit failed'), 'error');
      setSubmitting(false);
    }
  };

  const previewRelocationEvidence = async (row) => {
    try {
      const response = await reimbursementApi.relocationEvidenceBlob(row.id);
      setDrawer({
        open: true,
        blob: response.data,
        name: row.evidence_filename || `${row.reference}-approval`,
        type: response.headers['content-type'] || '',
        title: `${row.reference} · approval evidence`,
      });
    } catch {
      showToast('Could not open the approval evidence', 'error');
    }
  };

  const createRelocationRequest = async (payload) => {
    try {
      const response = await reimbursementApi.createRelocationRequest(payload);
      showToast(`Relocation request ${response.data.reference} sent for approval`, 'success');
      await loadRelocations();
      return true;
    } catch (error) {
      showToast(errorDetail(error, 'Could not send the relocation request'), 'error');
      return false;
    }
  };

  // An approval they already have needs no approval here: it's saved as approved, so the claim
  // goes straight on to its invoices.
  const uploadRelocationPriorApproval = async (formData) => {
    try {
      const response = await reimbursementApi.uploadRelocationPriorApproval(formData);
      showToast(`Approval saved as ${response.data.reference}. Now add your invoices.`, 'success');
      await loadRelocations();
      setRelocationRequestId(response.data.id);
      setCurrentStep(2);
      return true;
    } catch (error) {
      showToast(errorDetail(error, 'Could not upload the approval'), 'error');
      return false;
    }
  };

  // Expenses outside policy get their reasons in the exceptions modal first — the claim and all
  // its exception requests are only sent from there, so nothing is raised before submission.
  const submit = () => {
    if (!claim?.id) return;
    if (exceptionExpenses.length) {
      setExceptionsOpen(true);
      return;
    }
    sendClaim();
  };

  const goStep2 = async () => {
    if (isRelocation) {
      if (selectedRelocation?.status !== 'APPROVED') {
        showToast('Choose an approved relocation to continue', 'error');
        return;
      }
      setCurrentStep(2);
      return;
    }
    if (!validateStep1()) return;
    setCurrentStep(2);
  };

  const goStep3 = async () => {
    try {
      const draft = await saveDraft();
      if (!draft?.id) return;
      const checked = await reimbursementApi.policyCheck(draft.id);
      setClaim((prev) => ({ ...prev, ...checked.data }));
      // The undertaking names the claim amount — accept it again for the amount as it is now.
      setUndertakingAccepted(false);
      setCurrentStep(3);
    } catch (error) {
      showToast(errorDetail(error, 'Could not save the claim draft'), 'error');
    }
  };

  const goStep4 = async () => {
    try {
      const draft = await saveDraft();
      if (!draft?.id) return;
      const checked = await reimbursementApi.policyCheck(draft.id);
      setClaim((prev) => ({ ...prev, ...checked.data }));
      setCurrentStep(4);
    } catch (error) {
      showToast(errorDetail(error, 'Could not save the claim draft'), 'error');
    }
  };

  // "Your claim" beside the steps (trip claims only; relocation steps run full width).
  const selectedInvoiceRows = visibleInvoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id));
  const selectedGroups = tripGroups.filter((group) => group.tripIds.every((tripId) => selectedTripIds.includes(tripId)));
  const tripSummary = (() => {
    const group = selectedGroups.length === 1 ? selectedGroups[0] : null;
    if (group && group.legs.length > 1) {
      const legs = group.legs;
      const route =
        group.tripType === 'ROUND_TRIP'
          ? `${legs[0].from_city} ⇄ ${legs[0].to_city}`
          : [legs[0].from_city, ...legs.map((leg) => leg.to_city)].join(' → ');
      return { route, dates: dateSpan(form.departure_date, form.return_date) };
    }
    if (!form.destination_city) return null;
    return { route: `${form.from_city || '…'} → ${form.destination_city}`, dates: dateSpan(form.departure_date, form.return_date) };
  })();
  const bookingsSummary = selectedTripIds.length
    ? `${selectedTripIds.length} ${selectedTripIds.length === 1 ? 'booking' : 'legs'}${
        selectedGroups.length
          ? ` (${selectedGroups.map((g) => (g.legs[0].travel_request_id ? travelRef(g.legs[0].travel_request_id) : g.legs[0].reference_id)).filter(Boolean).join(', ')})`
          : ''
      }`
    : null;
  const policyChecked = currentStep >= 3 && claim;
  // Relocation has its own form, so it isn't one of a travel claim's trip purposes.
  const tripTravelOptions = {
    ...travelOptions,
    trip_purposes: (travelOptions.trip_purposes || []).filter((o) => o.value !== RELOCATION_PURPOSE),
  };
  const summary = isRelocation ? null : (
    <ClaimSummaryCard
      trip={tripSummary}
      bookings={bookingsSummary}
      invoiceCount={selectedInvoiceRows.length}
      invoiceTotal={selectedInvoiceRows.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0)}
      policyStep={3}
      policy={policyChecked ? policyCounts(claim) : null}
      advance={claim?.advance_received}
      payable={netPayable(claim)}
    />
  );

  return (
    <ClaimWizardShell
      title={`${effectiveEditId ? 'Edit' : 'New'} ${isRelocation ? 'relocation claim' : 'travel claim'}`}
      sub={isRelocation ? 'For the expenses of moving to a new posting.' : 'For expenses on a work trip.'}
      steps={stepLabels}
      current={currentStep}
      onStepClick={setCurrentStep}
      aside={summary}
    >
      {currentStep === 1 && isRelocation ? (
        <RelocationApprovalStep
          travelOptions={travelOptions}
          relocations={relocations}
          loading={relocationsLoading}
          selectedId={relocationRequestId}
          onSelect={setRelocationRequestId}
          onCreateRequest={createRelocationRequest}
          onUploadPriorApproval={uploadRelocationPriorApproval}
          onPreviewEvidence={previewRelocationEvidence}
          onNext={goStep2}
        />
      ) : null}

      {currentStep === 1 && !isRelocation ? (
        <ClaimWizardStepTripInfo
          form={form}
          onChange={onChange}
          officeLocations={officeLocations}
          travelOptions={tripTravelOptions}
          cityOptions={cityOptions}
          onCityQueryChange={setCityQ}
          cityGroupHint={cityGroupHint}
          deadlineWarning={deadlineWarning}
          validationErrors={validationErrors}
          onNext={goStep2}
          onResolveCityGroup={resolveDestinationCity}
          tripGroups={tripGroups}
          selectedTripIds={selectedTripIds}
          onToggleTripGroup={(tripIds, checked) =>
            setSelectedTripIds((prev) =>
              checked
                ? [...new Set([...prev, ...tripIds])]
                : prev.filter((item) => !tripIds.includes(item)),
            )
          }
          onPreviewTicket={previewTicket}
        />
      ) : null}

      {currentStep === 2 ? (
        <ClaimWizardStepEvidence
          invoices={visibleInvoices}
          selectedInvoiceIds={selectedInvoiceIds}
          onToggleInvoice={(invoiceId, checked) =>
            setSelectedInvoiceIds((prev) =>
              checked ? [...new Set([...prev, invoiceId])] : prev.filter((item) => item !== invoiceId),
            )
          }
          onUploadInvoice={onUploadInvoice}
          uploading={uploadingInvoice}
          busy={saving}
          reviewWarning={reviewWarning}
          sentBackHint={sentBackHint}
          onBack={() => setCurrentStep(1)}
          onNext={goStep3}
          {...(isRelocation
            ? {
              title: 'Relocation Invoices',
              description: 'Only invoices tagged Relocation can be added. Uploads here are tagged Relocation.',
              nextLabel: 'Next: Summary',
            }
            : {})}
        />
      ) : null}

      {currentStep === 3 && isRelocation ? (
        <RelocationSummaryStep
          claim={claim}
          relocation={selectedRelocation}
          onBack={() => setCurrentStep(2)}
          onNext={() => setCurrentStep(4)}
        />
      ) : null}

      {currentStep === 4 && isRelocation ? (
        <RelocationUndertakingStep
          claim={claim}
          relocation={selectedRelocation}
          accepted={undertakingAccepted}
          onToggle={setUndertakingAccepted}
          onBack={() => setCurrentStep(3)}
          onSubmit={submit}
          submitting={submitting || saving || uploadingInvoice}
        />
      ) : null}

      {currentStep === 3 && !isRelocation ? (
        <ClaimWizardStepPolicyCheck
          claim={claim}
          busy={saving}
          onBack={() => setCurrentStep(2)}
          onNext={goStep4}
        />
      ) : null}

      {currentStep === 4 && !isRelocation ? (
        <ClaimWizardStepSubmit
          claim={claim}
          trips={trips}
          invoices={invoices}
          selectedTripIds={selectedTripIds}
          selectedInvoiceIds={selectedInvoiceIds}
          declarationChecked={declarationChecked}
          onToggleDeclaration={setDeclarationChecked}
          onBack={() => setCurrentStep(3)}
          onSubmit={submit}
          submitting={submitting || saving || uploadingInvoice}
        />
      ) : null}

      <ClaimExceptionsModal
        open={exceptionsOpen}
        expenses={exceptionExpenses}
        onClose={() => {
          if (!submitting) setExceptionsOpen(false);
        }}
        onSubmit={sendClaim}
        submitting={submitting}
      />
      <TicketPreviewDrawer
        open={drawer.open}
        ticketId={drawer.ticketId}
        onClose={() => setDrawer((prev) => ({ ...prev, open: false }))}
        blob={drawer.blob}
        contentType={drawer.type}
        filename={drawer.name}
        title={drawer.title}
      />
      {submittedClaim && (
        <ClaimSubmitAnimation claim={submittedClaim} onComplete={() => navigate('/claims/my')} />
      )}

    </ClaimWizardShell>
  );
}
