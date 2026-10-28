import { ArrowLeft, ArrowRight, Check, ChevronDown, Eye, FileCheck2, Send, Truck, UploadCloud } from 'lucide-react';
import { useState } from 'react';

import { formatDate, formatDatetime, formatRole } from '../../utils/formatters';

/** Trip purpose (Travel Claim form) that switches the wizard into the relocation flow — seeded by
 * backend migration f4c1a7e2b905, see relocation_service.RELOCATION_TRIP_PURPOSE. */
export const RELOCATION_PURPOSE = 'Relocation';

const INPUT =
  'w-full h-10 px-3 rounded-lg border border-slate-250 bg-white text-slate-800 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-150';
const LABEL = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide';
const CARD = 'panel rounded-xl p-5 shadow-sm border border-slate-200 bg-white';
const PRIMARY =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand/90 transition-all duration-200 shadow-md disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed';
const SECONDARY =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 bg-white px-5 text-sm font-bold text-slate-700 transition-all duration-200';

/** Indian digit grouping, whole rupees without paise — same as relocation_service.format_inr, so
 * the undertaking shown here reads exactly like the one saved with the claim. */
export function formatInr(value) {
  const amount = Math.round(Number(value || 0) * 100) / 100;
  const whole = Number.isInteger(amount);
  return amount.toLocaleString('en-IN', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

export function claimTotal(claim) {
  return (claim?.expenses || []).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
}

export function relocationRef(row) {
  return row?.reference || (row?.id ? `REL-${String(row.id).padStart(4, '0')}` : '');
}

const NODE_STYLE = {
  APPROVED: 'bg-emerald-50 text-emerald-700',
  PENDING: 'bg-amber-50 text-amber-700',
  REJECTED: 'bg-rose-50 text-rose-700',
  SLA_SKIPPED: 'bg-slate-100 text-slate-400 line-through',
  NOT_STARTED: 'bg-slate-100 text-slate-500',
};

/** The relocation's approval route as a row of chips (approved ✓, current, rejected, passed over). */
export function RelocationChain({ stages = [] }) {
  if (!stages.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-y-1.5">
      {stages.map((stage, i) => (
        <span key={stage.stage_number} className="flex items-center">
          {i > 0 ? <span className="px-1.5 text-slate-300">→</span> : null}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${NODE_STYLE[stage.status] || NODE_STYLE.NOT_STARTED}`}
            title={
              stage.status === 'SLA_SKIPPED'
                ? `${stage.label}: passed on after the SLA was missed`
                : stage.decided_by_name
                  ? `${stage.label}: ${stage.decided_by_name}`
                  : stage.label
            }
          >
            {stage.status === 'APPROVED' ? <Check size={11} strokeWidth={3} /> : null}
            {formatRole(stage.required_role)}
          </span>
        </span>
      ))}
    </div>
  );
}

export function RelocationStatusPill({ row }) {
  if (!row) return null;
  if (row.status === 'APPROVED') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
        {row.source === 'PRIOR_APPROVAL' ? 'Approved · evidence uploaded' : 'Approved'}
      </span>
    );
  }
  if (row.status === 'REJECTED') {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold text-rose-700">
        Rejected
      </span>
    );
  }
  const current = (row.stages || []).find((stage) => stage.stage_number === row.current_approval_stage);
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700">
      Awaiting {current ? formatRole(current.required_role) : 'approval'}
    </span>
  );
}

function ChoiceButton({ active, title, text, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border p-4 text-left transition-all duration-200 ${
        active ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <span className="block text-sm font-bold text-slate-800">{title}</span>
      <span className="mt-1 block text-xs leading-relaxed text-slate-500">{text}</span>
    </button>
  );
}

function RequestForm({ routeText, busy, onSubmit }) {
  const [values, setValues] = useState({
    origin_city: '',
    destination_city: '',
    estimated_amount: '',
    planned_move_date: '',
    family_members: '',
    notes: '',
  });
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setValues((prev) => ({ ...prev, [key]: e.target.value }));
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local

  const submit = () => {
    const next = {};
    if (!values.origin_city.trim()) next.origin_city = 'Required';
    if (!values.destination_city.trim()) next.destination_city = 'Required';
    else if (values.destination_city.trim().toLowerCase() === values.origin_city.trim().toLowerCase()) {
      next.destination_city = "Can't be the same as Moving from";
    }
    if (!(Number(values.estimated_amount) > 0)) next.estimated_amount = 'Enter the estimated amount';
    if (!values.planned_move_date) next.planned_move_date = 'Required';
    else if (values.planned_move_date < today) next.planned_move_date = "Can't be in the past";
    if (values.family_members !== '' && !(Number(values.family_members) >= 0 && Number(values.family_members) <= 50)) {
      next.family_members = 'Enter a number from 0 to 50';
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    onSubmit({
      origin_city: values.origin_city.trim(),
      destination_city: values.destination_city.trim(),
      estimated_amount: String(values.estimated_amount),
      planned_move_date: values.planned_move_date,
      family_members: values.family_members === '' ? null : Number(values.family_members),
      notes: values.notes.trim() || null,
    });
  };

  const err = (key) => (errors[key] ? <p className="text-xs font-semibold text-rose-600">{errors[key]}</p> : null);

  return (
    <div className={`${CARD} space-y-4`}>
      <h2 className="text-sm font-bold text-slate-800">Relocation request</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className={LABEL}>Moving from *</span>
          <input className={INPUT} value={values.origin_city} onChange={set('origin_city')} placeholder="Current city" />
          {err('origin_city')}
        </label>
        <label className="space-y-1">
          <span className={LABEL}>Moving to *</span>
          <input className={INPUT} value={values.destination_city} onChange={set('destination_city')} placeholder="New city" />
          {err('destination_city')}
        </label>
        <label className="space-y-1">
          <span className={LABEL}>Estimated amount (₹) *</span>
          <input
            className={INPUT}
            type="number"
            min="1"
            step="0.01"
            value={values.estimated_amount}
            onChange={set('estimated_amount')}
            placeholder="e.g. 85000"
          />
          {err('estimated_amount')}
        </label>
        <label className="space-y-1">
          <span className={LABEL}>Planned move date *</span>
          <input className={INPUT} type="date" min={today} value={values.planned_move_date} onChange={set('planned_move_date')} />
          {err('planned_move_date')}
        </label>
        <label className="space-y-1">
          <span className={LABEL}>Family members relocating</span>
          <input
            className={INPUT}
            type="number"
            min="0"
            max="50"
            value={values.family_members}
            onChange={set('family_members')}
            placeholder="Optional"
          />
          {err('family_members')}
        </label>
      </div>
      <label className="block space-y-1">
        <span className={LABEL}>Notes</span>
        <textarea
          className={`${INPUT} h-20 resize-none py-2`}
          value={values.notes}
          onChange={set('notes')}
          maxLength={2000}
          placeholder="Anything the approvers should know (optional)"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <span className="text-xs text-slate-500">Goes to {routeText} for approval.</span>
        <button type="button" className={PRIMARY} onClick={submit} disabled={busy}>
          <Send size={14} /> {busy ? 'Sending...' : 'Submit for approval'}
        </button>
      </div>
    </div>
  );
}

function PriorApprovalForm({ busy, onSubmit }) {
  const [file, setFile] = useState(null);
  const [values, setValues] = useState({ origin_city: '', destination_city: '', approved_amount: '' });
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setValues((prev) => ({ ...prev, [key]: e.target.value }));

  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.heic';
    input.onchange = () => {
      const picked = input.files?.[0];
      if (!picked) return;
      if (picked.size > 10 * 1024 * 1024) {
        setErrors((prev) => ({ ...prev, file: 'The file can be up to 10 MB' }));
        return;
      }
      setFile(picked);
      setErrors((prev) => ({ ...prev, file: undefined }));
    };
    input.click();
  };

  const submit = () => {
    const next = {};
    if (!file) next.file = 'Upload the approval';
    if (!values.origin_city.trim()) next.origin_city = 'Required';
    if (!values.destination_city.trim()) next.destination_city = 'Required';
    if (values.approved_amount !== '' && !(Number(values.approved_amount) > 0)) {
      next.approved_amount = 'Enter an amount greater than zero, or leave it blank';
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('origin_city', values.origin_city.trim());
    formData.append('destination_city', values.destination_city.trim());
    if (values.approved_amount !== '') formData.append('approved_amount', String(values.approved_amount));
    onSubmit(formData);
  };

  const err = (key) => (errors[key] ? <p className="text-xs font-semibold text-rose-600">{errors[key]}</p> : null);

  return (
    <div className={`${CARD} space-y-4`}>
      <h2 className="text-sm font-bold text-slate-800">Approval evidence</h2>
      <div>
        <button
          type="button"
          onClick={pickFile}
          className={`w-full rounded-xl border-2 px-4 py-5 text-center text-xs font-semibold transition-colors ${
            file
              ? 'border-solid border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-dashed border-slate-200 bg-slate-50/60 text-slate-500 hover:border-brand/40'
          }`}
        >
          {file ? (
            <span className="inline-flex items-center gap-1.5">
              <FileCheck2 size={15} /> {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB (click to replace)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <UploadCloud size={15} /> Click to upload the approval: PDF, JPG, PNG or HEIC, up to 10 MB
            </span>
          )}
        </button>
        {err('file')}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className={LABEL}>Moving from *</span>
          <input className={INPUT} value={values.origin_city} onChange={set('origin_city')} placeholder="Current city" />
          {err('origin_city')}
        </label>
        <label className="space-y-1">
          <span className={LABEL}>Moving to *</span>
          <input className={INPUT} value={values.destination_city} onChange={set('destination_city')} placeholder="New city" />
          {err('destination_city')}
        </label>
        <label className="space-y-1">
          <span className={LABEL}>Approved amount (₹, if stated)</span>
          <input
            className={INPUT}
            type="number"
            min="1"
            step="0.01"
            value={values.approved_amount}
            onChange={set('approved_amount')}
            placeholder="Optional"
          />
          {err('approved_amount')}
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <span className="text-xs text-slate-500">Your claim&apos;s approvers and Finance will see this evidence.</span>
        <button type="button" className={PRIMARY} onClick={submit} disabled={busy}>
          <UploadCloud size={14} /> {busy ? 'Uploading...' : 'Save approval'}
        </button>
      </div>
    </div>
  );
}

/** Step 1 of a relocation claim: pick the approved relocation it's raised against — or upload an
 * approval the employee already has, or request one (Recruiter → CEO → HRBP → Payroll by default). */
export function RelocationApprovalStep({
  form,
  onChange,
  travelOptions,
  relocations,
  loading,
  selectedId,
  onSelect,
  onCreateRequest,
  onUploadPriorApproval,
  onPreviewEvidence,
  onNext,
}) {
  const [hasApproval, setHasApproval] = useState(null);
  const [busy, setBusy] = useState(false);
  const selected = relocations.find((row) => row.id === selectedId);
  const canContinue = selected?.status === 'APPROVED';

  const run = async (action, payload) => {
    setBusy(true);
    try {
      if (await action(payload)) setHasApproval(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <h2 className="mb-4 text-sm font-bold text-slate-800">Trip Information</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-1">
            <span className={LABEL}>Travel Type *</span>
            <select className={`${INPUT} bg-slate-50 text-slate-500`} value="NON_PROJECT" disabled>
              <option value="NON_PROJECT">Non-Project</option>
            </select>
          </div>
          <div className="space-y-1">
            <span className={LABEL}>Trip Purpose *</span>
            <select className={INPUT} value={form.trip_purpose} onChange={(e) => onChange('trip_purpose', e.target.value)}>
              <option value="">Select trip purpose</option>
              {(travelOptions?.trip_purposes || []).map((o) => (
                <option key={o.id} value={o.value}>
                  {o.label || o.value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Relocation claims are raised against an approved relocation, using invoices tagged Relocation.
        </p>
      </div>

      {relocations.length ? (
        <div className={CARD}>
          <h2 className="text-sm font-bold text-slate-800">Your relocations</h2>
          <p className="mt-0.5 mb-3 text-xs text-slate-500">
            Choose the approved relocation this claim is for. You can raise more than one claim against the same approval.
          </p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-150">
            {relocations.map((row) => {
              const usable = row.status === 'APPROVED';
              const isSelected = row.id === selectedId;
              return (
                <div
                  key={row.id}
                  role={usable ? 'button' : undefined}
                  tabIndex={usable ? 0 : undefined}
                  onClick={usable ? () => onSelect(row.id) : undefined}
                  onKeyDown={usable ? (e) => (e.key === 'Enter' || e.key === ' ') && onSelect(row.id) : undefined}
                  className={`flex flex-wrap items-center gap-3 border-l-[3px] px-4 py-3 transition-colors ${
                    isSelected
                      ? 'border-l-brand bg-brand/5'
                      : usable
                        ? 'cursor-pointer border-l-transparent hover:bg-slate-50/70'
                        : 'border-l-transparent'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      isSelected ? 'border-brand bg-brand text-white' : usable ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    {isSelected ? <Check size={11} strokeWidth={3} /> : null}
                  </span>
                  <div className="min-w-[180px] flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-800">
                      {relocationRef(row)}
                      <RelocationStatusPill row={row} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {row.origin_city} → {row.destination_city}
                      {row.estimated_amount ? ` · ₹${formatInr(row.estimated_amount)}` : ''}
                      {row.details?.planned_move_date ? ` · moving ${formatDate(row.details.planned_move_date)}` : ''}
                      {row.claim_count ? ` · ₹${formatInr(row.total_claimed)} claimed so far` : ''}
                    </div>
                    {row.status === 'REJECTED' && row.rejection_reason ? (
                      <div className="mt-1 text-[11px] font-medium text-rose-700">Reason: {row.rejection_reason}</div>
                    ) : null}
                  </div>
                  {row.source === 'REQUESTED' ? (
                    <RelocationChain stages={row.stages} />
                  ) : row.has_evidence ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-brand/20 bg-brand/5 px-2 py-1 text-[10px] font-bold text-brand hover:bg-brand/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreviewEvidence(row);
                      }}
                    >
                      <Eye size={11} /> Evidence
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {relocations.some((row) => row.status === 'PENDING') ? (
            <p className="mt-3 rounded-lg border border-slate-150 bg-slate-50 p-3 text-xs text-slate-500">
              You&apos;ll get a notification when a pending request is approved, and can continue from New Claim → Travel Claim → Relocation.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={CARD}>
        <h2 className="text-sm font-bold text-slate-800">{relocations.length ? 'Add another relocation' : 'Relocation approval'}</h2>
        <p className="mt-0.5 mb-3 text-xs text-slate-500">
          {loading ? 'Loading your relocations...' : 'Do you already have approval for this relocation?'}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <ChoiceButton
            active={hasApproval === true}
            title="Yes, I have approval"
            text="Upload the approval (PDF or screenshot). It goes with your claim for approvers and Finance to see."
            onClick={() => setHasApproval(hasApproval === true ? null : true)}
          />
          <ChoiceButton
            active={hasApproval === false}
            title="No, request approval"
            text="Send a relocation request for approval. You'll be notified when it's approved."
            onClick={() => setHasApproval(hasApproval === false ? null : false)}
          />
        </div>
      </div>

      {hasApproval === true ? (
        <PriorApprovalForm busy={busy} onSubmit={(formData) => run(onUploadPriorApproval, formData)} />
      ) : null}
      {hasApproval === false ? (
        <RequestForm
          routeText="the relocation approvers (Recruiter → CEO → HRBP → Payroll by default)"
          busy={busy}
          onSubmit={(payload) => run(onCreateRequest, payload)}
        />
      ) : null}

      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <span className="text-xs text-slate-500">
          {canContinue
            ? `Claiming against ${relocationRef(selected)} (${selected.origin_city} → ${selected.destination_city}).`
            : 'Choose an approved relocation to continue.'}
        </span>
        <button type="button" className={PRIMARY} onClick={onNext} disabled={!canContinue}>
          Next: Attach Invoices <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

/** Step 3: what's being claimed, against the approved estimate (all claims on it combined). */
export function RelocationSummaryStep({ claim, relocation, onBack, onNext }) {
  const total = claimTotal(claim);
  const earlier = Number(relocation?.total_claimed || 0);
  const estimate = relocation?.estimated_amount != null ? Number(relocation.estimated_amount) : null;
  const combined = total + earlier;
  const over = estimate != null && combined > estimate ? combined - estimate : 0;
  const expenses = claim?.expenses || [];

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <h2 className="mb-4 text-sm font-bold text-slate-800">Claim summary</h2>
        <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[170px_1fr]">
          <dt className="text-slate-500">Relocation</dt>
          <dd className="font-bold text-slate-800">
            {relocation ? `${relocation.origin_city} → ${relocation.destination_city} · ${relocationRef(relocation)}` : '—'}
            {relocation?.source === 'PRIOR_APPROVAL' ? ' (approval evidence attached)' : ''}
          </dd>
          <dt className="text-slate-500">Claim amount</dt>
          <dd className="font-bold text-slate-800">₹{formatInr(total)}</dd>
          {earlier > 0 ? (
            <>
              <dt className="text-slate-500">Earlier claims on it</dt>
              <dd className="font-bold text-slate-800">₹{formatInr(earlier)}</dd>
            </>
          ) : null}
          {estimate != null ? (
            <>
              <dt className="text-slate-500">{relocation?.source === 'PRIOR_APPROVAL' ? 'Approved amount' : 'Approved estimate'}</dt>
              <dd className="font-bold text-slate-800">
                ₹{formatInr(estimate)}
                {over ? <span className="ml-1 text-rose-600">· ₹{formatInr(over)} over</span> : null}
              </dd>
            </>
          ) : null}
        </dl>
        {over ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900">
            {earlier > 0 ? 'Together with your earlier claims, this' : 'This'} goes ₹{formatInr(over)} over the approved
            amount. You can still submit it; your approvers will see the difference.
          </div>
        ) : null}
        <div className="mt-4 rounded-lg border border-slate-150 bg-slate-50 p-3 text-xs text-slate-500">
          Policy exceptions don&apos;t apply to relocation claims, so there&apos;s nothing to request here.
        </div>
      </div>

      <div className={CARD}>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Expenses ({expenses.length})</h3>
        {expenses.length ? (
          <div className="divide-y divide-slate-100">
            {expenses.map((expense) => (
              <div key={expense.id ?? expense.category_name} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <span className="text-xs font-bold text-slate-800">{expense.category_name}</span>
                <span className="text-xs font-bold tabular-nums text-slate-800">₹{formatInr(expense.amount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs italic text-slate-400">No expenses on this claim yet.</p>
        )}
      </div>

      <div className={`${CARD} flex justify-between`}>
        <button type="button" className={SECONDARY} onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
        <button type="button" className={PRIMARY} onClick={onNext} disabled={!expenses.length}>
          Next: Submit <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Fill({ children }) {
  return <b className="rounded bg-brand/10 px-1 text-brand">{children}</b>;
}

/** The undertaking text exactly as relocation_service.UNDERTAKING_TEMPLATE renders it (the backend
 * saves its own rendering with the claim) — keep the two in step. */
export function UndertakingText({ origin, destination, amount }) {
  const F = Fill;
  return (
    <div className="space-y-3">
      <p>
        This undertaking is with reference to your request for reimbursement of relocation expenses incurred for shifting from{' '}
        <F>{origin}</F> to <F>{destination}</F>, amounting to <F>₹{formatInr(amount)}/-</F>.
      </p>
      <p>
        The relocation reimbursement claim is subject to review and approval in accordance with Company policy. Upon approval,
        reimbursement will be processed against submission of the original bills and supporting documents after completion of
        the shifting process.
      </p>
      <div>
        <p className="font-bold text-slate-800">Terms and Conditions:</p>
        <p>
          In the event you separate from the Company within a period of two (2) years from your date of joining, the relocation
          expenses reimbursed shall be recovered on a pro-rata basis for the unserved period and adjusted against your Full
          &amp; Final settlement.
        </p>
      </div>
      <p>
        By accepting this undertaking, you acknowledge that you have read, understood, and agreed to the above terms and
        conditions. Your acceptance will enable the claim to proceed to the approval stage.
      </p>
      <p>Please confirm your acceptance to proceed.</p>
    </div>
  );
}

/** What a relocation claim's approvers and Finance see (claimDetail().relocation, built by
 * relocation_service.relocation_summary_for_claim): the approval it's raised against or the
 * employee's uploaded evidence, this claim against the estimate (all claims on it combined),
 * and the undertaking exactly as the employee accepted it. */
export function RelocationClaimPanel({ relocation, onPreviewEvidence }) {
  const [showUndertaking, setShowUndertaking] = useState(false);
  if (!relocation) return null;
  const thisClaim = Number(relocation.this_claim_amount || 0);
  const others = Number(relocation.other_claims_amount || 0);
  const combined = Number(relocation.combined_claimed || 0);
  const estimate = relocation.estimated_amount != null ? Number(relocation.estimated_amount) : null;
  const over = relocation.over_estimate_by != null ? Number(relocation.over_estimate_by) : 0;
  const isPrior = relocation.source === 'PRIOR_APPROVAL';

  return (
    <div className="overflow-hidden rounded-xl border border-fuchsia-200">
      <div className="flex items-center gap-2 border-b border-fuchsia-200 bg-fuchsia-50 px-3.5 py-2.5">
        <Truck size={14} className="shrink-0 text-fuchsia-700" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-fuchsia-800">Relocation</h3>
      </div>
      <div className="space-y-3 bg-white p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-800">
              {relocation.origin_city} → {relocation.destination_city}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {relocationRef(relocation)} ·{' '}
              {isPrior
                ? 'approval the employee already had (evidence uploaded)'
                : `approved${relocation.decided_at ? ` ${formatDate(relocation.decided_at)}` : ''}`}
            </div>
          </div>
          {isPrior && relocation.has_evidence ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-brand/20 bg-brand/5 px-2 py-1 text-[11px] font-bold text-brand hover:bg-brand/10"
              onClick={onPreviewEvidence}
            >
              <Eye size={12} /> View approval evidence
            </button>
          ) : null}
        </div>
        {!isPrior ? <RelocationChain stages={relocation.stages} /> : null}

        <div
          className={`rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${
            over ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-150 bg-slate-50 text-slate-600'
          }`}
        >
          <div>
            This claim: <b className="font-mono">₹{formatInr(thisClaim)}</b>
            {others > 0 ? (
              <>
                {' '}· earlier claims on {relocationRef(relocation)}: <b className="font-mono">₹{formatInr(others)}</b>
              </>
            ) : null}
          </div>
          {estimate != null ? (
            <div className="mt-0.5">
              {others > 0 ? 'Total claimed' : 'Claimed'} <b className="font-mono">₹{formatInr(combined)}</b> vs{' '}
              {isPrior ? 'approved amount' : 'estimate'} <b className="font-mono">₹{formatInr(estimate)}</b>
              {over ? <b className="text-rose-700"> · ₹{formatInr(over)} over</b> : ' · within the estimate'}
            </div>
          ) : (
            <div className="mt-0.5 text-slate-500">No approved amount was given with this approval.</div>
          )}
        </div>

        {relocation.undertaking_accepted_at ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left font-semibold"
              onClick={() => setShowUndertaking((v) => !v)}
            >
              <span className="inline-flex items-center gap-1.5">
                <Check size={13} strokeWidth={3} /> Undertaking accepted on {formatDatetime(relocation.undertaking_accepted_at)}
              </span>
              <ChevronDown size={14} className={`shrink-0 transition-transform ${showUndertaking ? 'rotate-180' : ''}`} />
            </button>
            {showUndertaking && relocation.undertaking_text ? (
              <p className="mt-2 whitespace-pre-wrap rounded-md bg-white/70 p-2.5 leading-relaxed text-slate-700">
                {relocation.undertaking_text}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-150 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            The undertaking is accepted when the claim is submitted.
          </div>
        )}
      </div>
    </div>
  );
}

/** Step 4: the undertaking, filled in with this claim's origin, destination and amount; accepting
 * it is what submits the claim (the acceptance and its time are saved with the claim). */
export function RelocationUndertakingStep({ claim, relocation, accepted, onToggle, onBack, onSubmit, submitting }) {
  return (
    <div className="space-y-6">
      <div className={`${CARD} space-y-4`}>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Relocation undertaking</h2>
          <p className="mt-0.5 text-xs text-slate-500">Read and accept to submit your claim.</p>
        </div>
        <div className="max-h-[340px] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-[13px] leading-relaxed text-slate-700">
          <UndertakingText
            origin={relocation?.origin_city || claim?.from_city || '—'}
            destination={relocation?.destination_city || claim?.destination_city || '—'}
            amount={claimTotal(claim)}
          />
        </div>
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all duration-200 ${
            accepted ? 'border-brand/40 bg-brand/5 ring-1 ring-brand/10' : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <input type="checkbox" checked={accepted} onChange={(e) => onToggle(e.target.checked)} className="mt-0.5" />
          <span className="select-none text-xs text-slate-700">
            <b className="text-slate-800">I have read and accept this undertaking.</b>
            <span className="mt-0.5 block text-slate-500">Your acceptance (with the date and time) is saved with the claim.</span>
          </span>
        </label>
      </div>

      <div className={`${CARD} flex justify-between`}>
        <button type="button" className={SECONDARY} onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
        <button type="button" className={PRIMARY} onClick={onSubmit} disabled={submitting || !accepted}>
          <Send size={14} /> {submitting ? 'Submitting...' : 'Submit Claim'}
        </button>
      </div>
    </div>
  );
}
