import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import ClaimWizardShell, { ClaimSummaryCard } from '../../components/claims/ClaimWizardShell';
import ClaimWizardStepEvidence from '../../components/claims/ClaimWizardStepEvidence';
import ClaimWizardStepSubmit from '../../components/claims/ClaimWizardStepSubmit';
import ClaimExceptionsModal from '../../components/claims/ClaimExceptionsModal';
import useBillUploads from '../../components/claims/useBillUploads';
import ClaimSubmitAnimation from '../../components/ui/ClaimSubmitAnimation';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { reimbursementApi } from '../../services/reimbursementApi';

// No policy-check step: there's no policy for general reimbursements, so the backend never
// flags their expenses (reimbursement_service builds them with no caps or exceptions).
const STEP_LABELS = ['Invoices', 'Submit'];
const DRAFT_STORAGE_KEY = 'travora_general_reimbursement_draft';
// General Reimbursement draws only from General-tagged invoices. Relocation claims are raised
// from the Relocation Claim form with Relocation-tagged invoices.
const PICKER_CATEGORIES = ['GENERAL'];

export default function GeneralReimbursementWizard() {
  useSetPageTitle('General Reimbursement');
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
  const { showToast } = useToast();

  const [currentStep, setCurrentStep] = useState(1);
  const [claim, setClaim] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState(invoiceIdsFromUrl);
  // Bills uploaded from inside the form are tagged General and ticked as each one comes in.
  const { uploading: uploadingInvoice, uploadBills } = useBillUploads({
    category: 'GENERAL',
    onUploaded: (row) => {
      setInvoices((prev) => [row, ...prev.filter((item) => item.id !== row.id)]);
      setSelectedInvoiceIds((prev) => [...new Set([...prev, row.id])]);
    },
  });
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [declarationChecked, setDeclarationChecked] = useState(false);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [submittedClaim, setSubmittedClaim] = useState(null);

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

  // Draft Auto-Save: Load from localStorage on mount. Only the ticked invoices come back — it
  // always reopens on Invoices, since the saved claim the Submit step needs isn't kept here.
  useEffect(() => {
    if (effectiveEditId) return;
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.selectedInvoiceIds) setSelectedInvoiceIds(parsed.selectedInvoiceIds);
      }
    } catch {
      // ignore parse errors
    }
  }, [effectiveEditId]);

  // Draft Auto-Save: Save to localStorage on change
  useEffect(() => {
    if (effectiveEditId) return; // Don't auto-save if editing a backend claim
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ selectedInvoiceIds }));
    } catch {
      // storage unavailable (private window) — the draft just isn't kept
    }
  }, [selectedInvoiceIds, effectiveEditId]);

  // Enforced server-side too (assert_invoices_eligible_for_claim) — filter here so it never
  // offers a Travel or Relocation invoice that would fail validation on save.
  const visibleInvoices = useMemo(
    () => invoices.filter((invoice) => PICKER_CATEGORIES.includes(invoice.reimbursement_category)),
    [invoices],
  );

  // A bill reviewed from the Invoices step: take its new status and amount, and tick it.
  const onInvoiceReviewed = (row) => {
    setInvoices((prev) =>
      prev.map((item) =>
        item.id === row.id ? { ...item, status: row.status, total_amount: row.total_amount, extraction_error: row.extraction_error } : item,
      ),
    );
    if (row.status === 'REVIEWED') setSelectedInvoiceIds((prev) => [...new Set([...prev, row.id])]);
  };

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

  const exceptionExpenses = (claim?.expenses || []).filter((expense) => expense.exception_reason_required);

  const sendClaim = async (exceptions = []) => {
    if (!claim?.id) return;
    setSubmitting(true);
    try {
      const response = await reimbursementApi.submitClaim(claim.id, { exceptions });
      const submitted = response?.data || claim;
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      showToast(`Reimbursement submitted successfully. Claim ID: ${submitted.claim_reference || `CLM-${submitted.id}`}`, 'success');
      setExceptionsOpen(false);
      setSubmittedClaim(submitted);
    } catch (error) {
      showToast(error?.response?.data?.detail || 'Submit failed', 'error');
      setSubmitting(false);
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

  // Saves the draft, then reads it back with its expenses (the same read the travel claim's
  // policy step uses) so the Submit step has the claim exactly as the server holds it.
  const goSubmit = async () => {
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

  const selectedInvoiceRows = visibleInvoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id));

  return (
    <ClaimWizardShell
      title={effectiveEditId ? 'Edit general reimbursement' : 'New general reimbursement'}
      sub="For work expenses with no trip."
      steps={STEP_LABELS}
      current={currentStep}
      onStepClick={setCurrentStep}
      aside={
        <ClaimSummaryCard
          invoiceCount={selectedInvoiceRows.length}
          invoiceTotal={selectedInvoiceRows.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0)}
        />
      }
    >
      {currentStep === 1 ? (
        <ClaimWizardStepEvidence
          invoices={visibleInvoices}
          selectedInvoiceIds={selectedInvoiceIds}
          onToggleInvoice={(invoiceId, checked) =>
            setSelectedInvoiceIds((prev) =>
              checked ? [...new Set([...prev, invoiceId])] : prev.filter((item) => item !== invoiceId),
            )
          }
          onUploadFiles={uploadBills}
          onInvoiceReviewed={onInvoiceReviewed}
          uploading={uploadingInvoice}
          busy={saving}
          sentBackHint={sentBackHint}
          nextLabel="Next: Submit"
          onNext={goSubmit}
        />
      ) : null}

      {currentStep === 2 ? (
        <ClaimWizardStepSubmit
          claim={claim}
          isGeneral
          trips={[]}
          invoices={invoices}
          selectedTripIds={[]}
          selectedInvoiceIds={selectedInvoiceIds}
          declarationChecked={declarationChecked}
          onToggleDeclaration={setDeclarationChecked}
          onBack={() => setCurrentStep(1)}
          onSubmit={submit}
          submitting={submitting || saving || Boolean(uploadingInvoice)}
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

      {/* Starts as soon as it's sent and finishes once the server confirms; a failed submit ends it. */}
      {(submitting || submittedClaim) && (
        <ClaimSubmitAnimation
          claim={submittedClaim || claim}
          confirmed={Boolean(submittedClaim)}
          onComplete={() => navigate('/claims/my')}
        />
      )}
    </ClaimWizardShell>
  );
}
