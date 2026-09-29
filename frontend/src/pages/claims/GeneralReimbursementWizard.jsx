import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import ClaimWizardStepEvidence from '../../components/claims/ClaimWizardStepEvidence';
import ClaimWizardStepPolicyCheck from '../../components/claims/ClaimWizardStepPolicyCheck';
import ClaimWizardStepSubmit from '../../components/claims/ClaimWizardStepSubmit';
import ExceptionRequestModal from '../../components/claims/ExceptionRequestModal';
import OrigamiAnimation from '../../components/ui/OrigamiAnimation';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';
import { useAuthStore } from '../../store/authStore';

const STEP_LABELS = ['Invoices', 'Policy Check', 'Submit'];
const DRAFT_STORAGE_KEY = 'travora_general_reimbursement_draft';
// Reallocation isn't a trip either, so it shares this wizard rather than getting its own
// entry point — a Reallocation-tagged invoice shows up in the picker right alongside
// General ones (see visibleInvoices below). Which of the two the claim actually routes as
// is resolved server-side from the invoices actually attached (see
// reimbursement_service._resolve_claim_reimbursement_category).
const PICKER_CATEGORIES = ['GENERAL', 'REALLOCATION'];

export default function GeneralReimbursementWizard() {
  useSetPageTitle('General Reimbursement');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
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
  const { showToast } = useToast();

  const [currentStep, setCurrentStep] = useState(1);
  const [claim, setClaim] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState(invoiceIdsFromUrl);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [declarationChecked, setDeclarationChecked] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [activeExpense, setActiveExpense] = useState(null);
  const [requestingException, setRequestingException] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await reimbursementApi.invoices({ unlinked: true, editing_claim_id: effectiveEditId || undefined });
        if (!cancelled) setInvoices((res.data || []).slice(0, 50));
      } catch {
        if (!cancelled) {
          setInvoices([]);
          showToast('Could not load invoices', 'error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast, effectiveEditId]);

  useEffect(() => {
    if (!effectiveEditId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await reimbursementApi.claimDetail(effectiveEditId);
        if (cancelled) return;
        setClaim(detail.data);
        setSelectedInvoiceIds(detail.data.invoice_ids || []);
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
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
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
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ selectedInvoiceIds, currentStep }));
  }, [selectedInvoiceIds, currentStep, effectiveEditId]);

  // General and Reallocation share this one picker (enforced server-side too, see
  // assert_invoices_eligible_for_claim) — filter here so it never offers a Travel invoice
  // that would fail validation on save.
  const visibleInvoices = useMemo(
    () => invoices.filter((invoice) => PICKER_CATEGORIES.includes(invoice.reimbursement_category)),
    [invoices],
  );

  const reviewWarning = useMemo(() => {
    const selected = invoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id));
    return selected.some((invoice) => invoice.status !== 'REVIEWED')
      ? 'Review this invoice before submitting'
      : '';
  }, [invoices, selectedInvoiceIds]);

  const sentBackHint = claim?.status === 'SENT_BACK' ? 'Invoice missing — add supporting receipt.' : '';

  const saveDraft = async () => {
    setSaving(true);
    try {
      const payload = {
        claim_id: claim?.id || (effectiveEditId ? Number(effectiveEditId) : null),
        reimbursement_category: 'GENERAL',
        invoice_ids: selectedInvoiceIds,
        trip_ids: [],
        advance_received: '0',
      };
      const response = await reimbursementApi.saveClaimDraft(payload);
      setClaim(response.data);
      localStorage.removeItem(DRAFT_STORAGE_KEY);
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
      formData.append('reimbursement_category', 'GENERAL');
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

  const submit = async () => {
    if (!claim?.id) return;
    setSubmitting(true);
    try {
      await reimbursementApi.submitClaim(claim.id);
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      showToast(`Reimbursement submitted successfully. Claim ID: ${claim.claim_reference || `CLM-${claim.id}`}`, 'success');
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
    try {
      const draft = await saveDraft();
      if (!draft?.id) return;
      const checked = await reimbursementApi.policyCheck(draft.id);
      setClaim((prev) => ({ ...prev, ...checked.data }));
      setCurrentStep(2);
    } catch (error) {
      showToast(error?.response?.data?.detail || 'Could not save the reimbursement draft', 'error');
    }
  };

  const goStep3 = async () => {
    try {
      const draft = await saveDraft();
      if (!draft?.id) return;
      const checked = await reimbursementApi.policyCheck(draft.id);
      setClaim((prev) => ({ ...prev, ...checked.data }));
      setCurrentStep(3);
    } catch (error) {
      showToast(error?.response?.data?.detail || 'Could not save the reimbursement draft', 'error');
    }
  };

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-ink">
          {effectiveEditId ? 'Edit General Reimbursement' : 'New General Reimbursement'}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">For office expenses not tied to a trip — no travel details required.</p>
      </div>

      {/* Connected Progress Stepper Header */}
      <div className="rounded-xl border border-slate-200 bg-white px-6 sm:px-10 py-5 shadow-sm">
        <div className="relative grid grid-cols-3">
          {/* Background Connected Track */}
          <div className="absolute left-[16.6%] right-[16.6%] top-[18px] h-0.5 -translate-y-1/2 bg-slate-100">
            {/* Foreground Progress Fill */}
            <div
              className="absolute left-0 top-0 h-full bg-brand transition-all duration-300"
              style={{ width: `${((currentStep - 1) / (STEP_LABELS.length - 1)) * 100}%` }}
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
        <ClaimWizardStepEvidence
          invoices={visibleInvoices}
          selectedInvoiceIds={selectedInvoiceIds}
          onToggleInvoice={(invoiceId, checked) =>
            setSelectedInvoiceIds((prev) =>
              checked ? [...new Set([...prev, invoiceId])] : prev.filter((item) => item !== invoiceId),
            )
          }
          onUploadInvoice={onUploadInvoice}
          reviewWarning={reviewWarning}
          sentBackHint={sentBackHint}
          onNext={goStep2}
        />
      ) : null}

      {currentStep === 2 ? (
        <ClaimWizardStepPolicyCheck
          claim={claim}
          isGeneral
          onBack={() => setCurrentStep(1)}
          onNext={goStep3}
          onRequestException={(expense) => {
            setActiveExpense(expense);
            setExceptionOpen(true);
          }}
        />
      ) : null}

      {currentStep === 3 ? (
        <ClaimWizardStepSubmit
          claim={claim}
          isGeneral
          trips={[]}
          invoices={invoices}
          selectedTripIds={[]}
          selectedInvoiceIds={selectedInvoiceIds}
          declarationChecked={declarationChecked}
          onToggleDeclaration={setDeclarationChecked}
          onBack={() => setCurrentStep(2)}
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

      {showAnimation && (
        <OrigamiAnimation
          onComplete={() => navigate('/claims/my')}
          employeeName={user?.full_name || user?.email || 'Employee'}
          destination="General Reimbursement"
          date={new Date().toISOString().slice(0, 10)}
        />
      )}
    </section>
  );
}
