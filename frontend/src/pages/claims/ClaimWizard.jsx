import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import ClaimWizardStepEvidence from '../../components/claims/ClaimWizardStepEvidence';
import ClaimWizardStepPolicyCheck from '../../components/claims/ClaimWizardStepPolicyCheck';
import ClaimWizardStepSubmit from '../../components/claims/ClaimWizardStepSubmit';
import ClaimWizardStepTripInfo from '../../components/claims/ClaimWizardStepTripInfo';
import ExceptionRequestModal from '../../components/claims/ExceptionRequestModal';
import TicketPreviewDrawer from '../../components/ui/TicketPreviewDrawer';
import OrigamiAnimation from '../../components/ui/OrigamiAnimation';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';
import { useAuthStore } from '../../store/authStore';

const STEP_LABELS = ['Trip Info', 'Invoices', 'Policy Check', 'Submit Claim'];

function isoDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function addWorkingDays(date, days) {
  const value = new Date(date);
  let left = days;
  while (left > 0) {
    value.setDate(value.getDate() + 1);
    const dow = value.getDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return value;
}

export default function ClaimWizard() {
  useSetPageTitle('Claim Wizard');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const editIdFromQuery = searchParams.get('edit');
  const effectiveEditId = id || editIdFromQuery || null;
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

  const [currentStep, setCurrentStep] = useState(1);
  const [claim, setClaim] = useState(null);
  const [form, setForm] = useState({
    trip_purpose: '',
    office_location: '',
    from_city: '',
    destination_city: '',
    departure_date: '',
    return_date: '',
  });
  const [officeLocations, setOfficeLocations] = useState([]);
  const [cityGroupHint, setCityGroupHint] = useState('');
  const [deadlineWarning, setDeadlineWarning] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const [workflowConfig, setWorkflowConfig] = useState(null);
  const [trips, setTrips] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedTripIds, setSelectedTripIds] = useState(tripIdsFromUrl);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState(invoiceIdsFromUrl);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [drawer, setDrawer] = useState({ open: false, blob: null, name: '', type: '', title: '' });
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [declarationChecked, setDeclarationChecked] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [activeExpense, setActiveExpense] = useState(null);
  const [requestingException, setRequestingException] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);
  const [showLateModal, setShowLateModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tripOutcome, invoiceOutcome, meOutcome] = await Promise.allSettled([
        reimbursementApi.bookingTripsMy({ unlinked_only: true }),
        reimbursementApi.invoices({ unlinked: true }),
        reimbursementApi.me(),
      ]);
      if (!cancelled) {
        if (tripOutcome.status === 'fulfilled') {
          const allTrips = tripOutcome.value.data || [];
          setTrips(allTrips);
          if (tripIdsFromUrl.length > 0 && !effectiveEditId) {
            const firstTrip = allTrips.find(t => tripIdsFromUrl.includes(t.id));
            if (firstTrip) {
              setForm(prev => ({
                ...prev,
                from_city: prev.from_city || firstTrip.from_city || '',
                destination_city: prev.destination_city || firstTrip.to_city || '',
                departure_date: prev.departure_date || isoDate(firstTrip.travel_date),
                trip_purpose: prev.trip_purpose || firstTrip.travel_purpose || firstTrip.purpose || '',
              }));
            }
          }
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
          setWorkflowConfig({
            submission: {
              deadline_mode: data?.workflow_submission_deadline_mode || 'hard_block',
              max_working_days_after_return: data?.workflow_submission_max_working_days || 5,
            }
          });
        } else {
          setOfficeLocations([]);
        }
        if (tripOutcome.status === 'rejected' || invoiceOutcome.status === 'rejected') {
          showToast('Could not load trips or invoices', 'error');
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
        setClaim(row);
        setForm((prev) => ({
          ...prev,
          trip_purpose: row.trip_purpose || '',
          office_location: row.office_location || '',
          from_city: row.from_city || '',
          destination_city: row.destination_city || '',
          departure_date: isoDate(row.departure_date),
          return_date: isoDate(row.return_date),
        }));
        setSelectedTripIds(row.trip_ids || []);
        setSelectedInvoiceIds(row.invoice_ids || []);
      } catch {
        showToast('Could not load claim to edit', 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveEditId, showToast]);

  // Draft Auto-Save: Load from localStorage on mount
  useEffect(() => {
    if (effectiveEditId) return;
    try {
      const saved = localStorage.getItem('travora_claim_draft');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.form) setForm(prev => ({ ...prev, ...parsed.form }));
        if (parsed.selectedTripIds) setSelectedTripIds(parsed.selectedTripIds);
        if (parsed.selectedInvoiceIds) setSelectedInvoiceIds(parsed.selectedInvoiceIds);
        if (parsed.currentStep) setCurrentStep(parsed.currentStep);
      }
    } catch {
      // ignore parse errors
    }
  }, [effectiveEditId]);

  // Draft Auto-Save: Save to localStorage on change
  useEffect(() => {
    if (effectiveEditId) return; // Don't auto-save if editing a backend claim
    const draftData = { form, selectedTripIds, selectedInvoiceIds, currentStep };
    localStorage.setItem('travora_claim_draft', JSON.stringify(draftData));
  }, [form, selectedTripIds, selectedInvoiceIds, currentStep, effectiveEditId]);

  const reviewWarning = useMemo(() => {
    const selected = invoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id));
    return selected.some((invoice) => invoice.status !== 'REVIEWED')
      ? 'Review this invoice before submitting'
      : '';
  }, [invoices, selectedInvoiceIds]);

  const sentBackHint = claim?.status === 'SENT_BACK' ? 'Invoice missing — add hotel invoice.' : '';
  
  useEffect(() => {
    if (effectiveEditId || selectedTripIds.length === 0 || trips.length === 0) return;
    
    const firstTrip = trips.find(t => selectedTripIds.includes(t.id));
    if (firstTrip) {
      setForm(prev => {
        const next = { ...prev };
        let changed = false;
        
        if (!next.from_city && firstTrip.from_city) {
          next.from_city = firstTrip.from_city;
          changed = true;
        }
        if (!next.destination_city && firstTrip.to_city) {
          next.destination_city = firstTrip.to_city;
          changed = true;
        }
        if (!next.departure_date && firstTrip.travel_date) {
          next.departure_date = isoDate(firstTrip.travel_date);
          changed = true;
        }
        if (!next.return_date && firstTrip.return_date) {
          next.return_date = isoDate(firstTrip.return_date);
          changed = true;
        }
        if (!next.trip_purpose && (firstTrip.travel_purpose || firstTrip.purpose)) {
          next.trip_purpose = firstTrip.travel_purpose || firstTrip.purpose;
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
    }
  }, [selectedTripIds, trips, officeLocations, effectiveEditId]);
  
  useEffect(() => {
    if (form.office_location && !form.from_city) {
      setForm(prev => ({ ...prev, from_city: prev.office_location }));
    }
  }, [form.office_location, form.from_city]);

  const onChange = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'office_location' && value && !prev.from_city) {
        next.from_city = value;
      }
      return next;
    });
  };

  const validateStep1 = () => {
    const next = {};
    if (!form.trip_purpose.trim()) next.trip_purpose = 'Trip purpose is required.';
    if (!form.office_location.trim()) next.office_location = 'Office location is required.';
    if (!form.from_city.trim()) next.from_city = 'From city is required.';
    if (!form.destination_city.trim()) next.destination_city = 'Destination city is required.';
    if (!form.departure_date) next.departure_date = 'Departure date is required.';
    if (!form.return_date) next.return_date = 'Return date is required.';
    if (form.departure_date && form.return_date && form.return_date < form.departure_date) {
      next.return_date = 'Return date must be on or after departure date.';
    }
    if (form.return_date) {
      const returnDate = new Date(form.return_date);
      const maxDays = workflowConfig?.submission?.max_working_days_after_return ?? 5;
      const mode = workflowConfig?.submission?.deadline_mode ?? 'hard_block';
      const deadline = addWorkingDays(returnDate, maxDays);
      if (new Date() > deadline) {
        setDeadlineWarning(`Submission deadline has passed. You had until ${deadline.toLocaleDateString()} to submit.`);
        if (mode === 'hard_block') {
          next.return_date = 'Submission deadline has passed.';
        }
      } else {
        setDeadlineWarning('');
      }
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
      const payload = {
        claim_id: claim?.id || (effectiveEditId ? Number(effectiveEditId) : null),
        invoice_ids: selectedInvoiceIds,
        trip_ids: selectedTripIds,
        trip_purpose: form.trip_purpose || null,
        departure_date: form.departure_date || null,
        return_date: form.return_date || null,
        office_location: form.office_location || null,
        from_city: form.from_city || null,
        destination_city: form.destination_city || null,
        advance_received: '0',
      };
      const response = await reimbursementApi.saveClaimDraft(payload);
      setClaim(response.data);
      localStorage.removeItem('travora_claim_draft');
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
        blob: response.data,
        name: `${trip.reference_id || trip.id}-ticket`,
        type: response.headers['content-type'] || '',
        title: `Trip ${trip.reference_id || trip.id}`,
      });
    } catch {
      showToast('Could not preview ticket', 'error');
    }
  };

  const submit = async () => {
    if (!claim?.id) return;
    setSubmitting(true);
    try {
      await reimbursementApi.submitClaim(claim.id);
      localStorage.removeItem('travora_claim_draft');
      showToast(`Claim submitted successfully. Claim ID: ${claim.claim_reference || `CLM-${claim.id}`}`, 'success');
      setShowAnimation(true);
    } catch (error) {
      showToast(error?.response?.data?.detail || 'Submit failed', 'error');
      setSubmitting(false);
    }
  };

  const requestException = async ({ reason, exceptionType }) => {
    if (!claim?.id || !activeExpense) return;
    setRequestingException(true);
    try {
      await reimbursementApi.requestException({
        claim_id: claim.id,
        exception_type: exceptionType,
        description: reason.trim(),
      });
      setClaim((prev) => ({
        ...prev,
        expenses: (prev?.expenses || []).map((expense) =>
          expense.id === activeExpense.id ? { ...expense, exception_requested: true } : expense,
        ),
      }));
      showToast('Exception request submitted', 'success');
      setExceptionOpen(false);
      setActiveExpense(null);
    } catch {
      showToast('Exception request failed', 'error');
    } finally {
      setRequestingException(false);
    }
  };

  const goStep2 = async () => {
    if (!validateStep1()) return;
    
    if (form.return_date) {
      const returnDate = new Date(form.return_date);
      const maxDays = workflowConfig?.submission?.max_working_days_after_return ?? 5;
      const mode = workflowConfig?.submission?.deadline_mode ?? 'hard_block';
      const deadline = addWorkingDays(returnDate, maxDays);
      
      if (new Date() > deadline && mode === 'soft_warning') {
        setShowLateModal(true);
        return;
      }
    }
    
    setCurrentStep(2);
  };

  const goStep3 = async () => {
    const draft = await saveDraft();
    if (!draft?.id) return;
    const checked = await reimbursementApi.policyCheck(draft.id);
    setClaim((prev) => ({ ...prev, ...checked.data }));
    setCurrentStep(3);
  };

  const goStep4 = async () => {
    const draft = await saveDraft();
    if (!draft?.id) return;
    const checked = await reimbursementApi.policyCheck(draft.id);
    setClaim((prev) => ({ ...prev, ...checked.data }));
    setCurrentStep(4);
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-4">
      {/* Connected Progress Stepper Header */}
      <div className="rounded-xl border border-slate-200 bg-white px-6 sm:px-10 py-5 shadow-sm">
        <div className="relative grid grid-cols-4">
          {/* Background Connected Track */}
          <div className="absolute left-[12.5%] right-[12.5%] top-[18px] h-0.5 -translate-y-1/2 bg-slate-100">
            {/* Foreground Progress Fill */}
            <div 
              className="absolute left-0 top-0 h-full bg-brand transition-all duration-300"
              style={{ 
                width: `${((currentStep - 1) / (STEP_LABELS.length - 1)) * 100}%`
              }}
            ></div>
          </div>
          
          {STEP_LABELS.map((label, idx) => {
            const stepNum = idx + 1;
            const isCompleted = currentStep > stepNum;
            const isActive = currentStep === stepNum;
            
            return (
              <div key={label} className="relative z-10 flex flex-col items-center">
                <div 
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300 ${
                    isCompleted 
                      ? 'border-emerald-500 bg-emerald-500 text-white' 
                      : isActive 
                        ? 'border-brand bg-brand text-white shadow-lg shadow-brand/10 ring-4 ring-brand/10' 
                        : 'border-slate-200 bg-white text-slate-400'
                  }`}
                >
                  {isCompleted ? <Check size={14} /> : stepNum}
                </div>
                <span 
                  className={`mt-2 text-xs font-bold tracking-tight transition-colors duration-200 ${
                    isActive ? 'text-brand' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                  }`}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {currentStep === 1 ? (
        <ClaimWizardStepTripInfo
          form={form}
          onChange={onChange}
          officeLocations={officeLocations}
          cityGroupHint={cityGroupHint}
          deadlineWarning={deadlineWarning}
          validationErrors={validationErrors}
          onNext={goStep2}
          onResolveCityGroup={resolveDestinationCity}
          trips={trips}
          selectedTripIds={selectedTripIds}
          onToggleTrip={(tripId, checked) =>
            setSelectedTripIds((prev) => (checked ? [...new Set([...prev, tripId])] : prev.filter((item) => item !== tripId)))
          }
          onPreviewTicket={previewTicket}
        />
      ) : null}

      {currentStep === 2 ? (
        <ClaimWizardStepEvidence
          invoices={invoices}
          selectedInvoiceIds={selectedInvoiceIds}
          onToggleInvoice={(invoiceId, checked) =>
            setSelectedInvoiceIds((prev) =>
              checked ? [...new Set([...prev, invoiceId])] : prev.filter((item) => item !== invoiceId),
            )
          }
          onUploadInvoice={onUploadInvoice}
          reviewWarning={reviewWarning}
          sentBackHint={sentBackHint}
          onBack={() => setCurrentStep(1)}
          onNext={goStep3}
        />
      ) : null}

      {currentStep === 3 ? (
        <ClaimWizardStepPolicyCheck
          claim={claim}
          onBack={() => setCurrentStep(2)}
          onNext={goStep4}
          onRequestException={(expense) => {
            setActiveExpense(expense);
            setExceptionOpen(true);
          }}
        />
      ) : null}

      {currentStep === 4 ? (
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

      <ExceptionRequestModal
        open={exceptionOpen}
        expense={activeExpense}
        onClose={() => {
          if (requestingException) return;
          setExceptionOpen(false);
          setActiveExpense(null);
        }}
        onSubmit={requestException}
        loading={requestingException}
      />
      <TicketPreviewDrawer
        open={drawer.open}
        onClose={() => setDrawer((prev) => ({ ...prev, open: false }))}
        blob={drawer.blob}
        contentType={drawer.type}
        filename={drawer.name}
        title={drawer.title}
      />
      {showAnimation && (
        <OrigamiAnimation 
          onComplete={() => navigate('/claims/my')} 
          employeeName={user?.full_name || user?.email || 'Employee'}
          destination={form.destination_city}
          date={form.departure_date}
        />
      )}
      
      {showLateModal && createPortal(
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl">
            <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-amber-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              Late Claim Submission
            </h3>
            <p className="mb-6 text-sm text-slate-600 leading-relaxed">
              {deadlineWarning} Your claim will be flagged as late and may require additional scrutiny from your approver. Do you wish to proceed?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                onClick={() => setShowLateModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 transition-colors shadow-sm"
                onClick={() => {
                  setShowLateModal(false);
                  setCurrentStep(2);
                }}
              >
                Yes, Proceed
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
