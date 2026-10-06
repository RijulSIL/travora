import { ArrowDown, ArrowUp, Plus, Save, Trash2, GripVertical } from 'lucide-react';
import { useEffect, useState } from 'react';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import useToast from '../../hooks/useToast';
import { adminApi } from '../../services/adminApi';
import { canEditWorkflowConfig } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

const DEADLINE_MODES = ['hard_block', 'soft_warning'];
const DEFAULT_MAX_DAYS = 5;

// The only exception types ever actually raised against a travel request rather than a
// claim — the dropdown below groups these into their own "Travel Requests" optgroup instead of
// mixing them in with the claim exception types, so the label here stays plain (no inline
// "(Travel Request)" suffix needed — the optgroup heading already says so).
const TRAVEL_REQUEST_EXCEPTION_KEYS = new Set([
  'AIR_TRAVEL_UNLOCK',
  'FLIGHT_ADVANCE_BOOKING_OVERRIDE',
  'TRAIN_ADVANCE_BOOKING_OVERRIDE',
  'TRAVEL_REQUEST_LEAD_TIME_OVERRIDE',
]);

const EXCEPTION_TYPES = {
  "AIR_TRAVEL_UNLOCK": "Exception: Air Travel Unlock",
  "TRAIN_TATKAL": "Exception: Train Tatkal",
  "FLIGHT_ADVANCE_BOOKING_OVERRIDE": "Exception: Flight Advance Booking",
  "TRAIN_ADVANCE_BOOKING_OVERRIDE": "Exception: Train Advance Booking",
  "TRAVEL_REQUEST_LEAD_TIME_OVERRIDE": "Exception: Travel Request Lead Time (Other Modes)",
  "FLIGHT_COST_DELTA": "Exception: Flight Cost Delta",
  "ROOM_RENT_DEVIATION": "Exception: Room Rent Deviation",
  "FOOD_DEVIATION": "Exception: Food & Meals Deviation",
  "INCIDENTAL_DEVIATION": "Exception: Incidental Expenses Deviation",
  "AIR_TRAVEL_L5_L6": "Exception: Air Travel L5/L6",
  "HIRED_TAXI_UNAUTHORIZED": "Exception: Unauthorized Hired Taxi",
  "MODE_DEVIATION": "Exception: Travel Mode Deviation",
  "DAY_VISIT_EXTERNAL_MEETING": "Exception: Day Visit External Meeting Expenses",
  // The one editable route for any expense category without its own dedicated rule above
  // (Office Supplies, Telecom, ...) — every such category's generic deviation type is routed
  // through this chain by the backend's _chain_for_type fallback.
  "POLICY_EXCEPTION_GENERAL": "Exception: Other Category Deviation (Default)",
};

function sanitizeMaxWorkingDaysAfterReturn(raw) {
  if (raw === '' || raw === undefined || raw === null) return DEFAULT_MAX_DAYS;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_DAYS;
  return Math.floor(n);
}

function sanitizeSlaHours(raw) {
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.floor(raw)
      : parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 1) return 48;
  return n;
}

function sanitizeAutoApproveAmount(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return '0.00';
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return '0.00';
  return n.toFixed(2);
}

// Only claim categories — Travel Request approval is a separate top-level "Workflow Type"
// now (see selectedWorkflow === 'TRAVEL_REQUEST'), not nested under this claim-only selector,
// since it was being mixed in with claim categories here and that was confusing: a travel
// request isn't a claim category, it's a wholly different approval flow (pre-trip, not
// reimbursement).
const STAGE_CATEGORIES = [
  { value: 'DEFAULT', label: 'Default (all categories)' },
  { value: 'TRAVEL', label: 'Travel claims' },
  { value: 'GENERAL', label: 'General reimbursements' },
  { value: 'REALLOCATION', label: 'Reallocations' },
];

// Travel requests have their own approval chain, separate from claim reimbursement — no
// finance stage required (there's no payment here), and the "shared default" they fall back to
// when unconfigured is a single Reporting Manager step, not the claim stages list.
const TRAVEL_REQUEST_DEFAULT_STAGES = [
  { number: 1, label: 'Manager Review', route_role: 'REPORTING_MANAGER', sla_hours: 48 },
];

const ALLOWED_STAGE_ROLES = ['REPORTING_MANAGER', 'HRBP_HR', 'PAYROLL', 'FINANCE', 'CEO', 'GROUP_HEAD_HR', 'IT_ADMIN'];

function sanitizeStageRoles(stageList) {
  return (stageList || []).map((s) => ({
    ...s,
    route_role: ALLOWED_STAGE_ROLES.includes(s.route_role) ? s.route_role : 'HRBP_HR',
  }));
}

// Every role token that ever appears in a stage/chain, for the "you're about to remove this
// role from the matrix entirely" save-time warning below. REPORTING_MANAGER is included even
// though it's relative-to-employee — see workflow_service.get_approver_scope's identical
// reasoning: a user holding that role is still the kind of user this token routes to.
const ROLES_WORTH_WARNING_ABOUT = ['REPORTING_MANAGER', 'HRBP_HR', 'PAYROLL', 'FINANCE', 'CEO', 'GROUP_HEAD_HR'];

function roleLabel(role) {
  return String(role || '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

/** Every route_role/chain-role token present anywhere in a full workflow config — stages,
 * every category override (incl. TRAVEL_REQUEST), and exception_chains. Used to diff
 * before-vs-after on save: a role dropping out of this set entirely means anyone holding that
 * role loses every approval-queue nav item and the Exception Requests page (see
 * get_approver_scope / navConfig.js's applyApproverScope) — worth a confirmation, since nothing
 * else here would otherwise catch "admin meant to edit one stage but deleted the role instead." */
function rolesCoveredByConfig(config) {
  const roles = new Set();
  const addStages = (list) => (list || []).forEach((s) => s?.route_role && roles.add(s.route_role));
  addStages(config.stages);
  for (const override of Object.values(config.category_overrides || {})) {
    addStages(override?.stages);
  }
  for (const chain of Object.values(config.exception_chains || {})) {
    (chain || []).forEach((r) => roles.add(r));
  }
  return roles;
}

function errorMessage(err) {
  if (!err) return '';
  const d = err.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join('; ') || err.message;
  return err.message;
}

export default function WorkflowConfig() {
  useSetPageTitle('Workflow Configuration');
  const role = useAuthStore((s) => s.user?.role);
  const isViewOnly = !canEditWorkflowConfig(role);
  const { showToast } = useToast();
  const [selectedWorkflow, setSelectedWorkflow] = useState('STANDARD');
  const [selectedCategory, setSelectedCategory] = useState('DEFAULT');
  const [stages, setStages] = useState([]);
  const [categoryOverrides, setCategoryOverrides] = useState({});
  const [exceptionChains, setExceptionChains] = useState({});
  // Per-type on/off switch — a disabled type is never flagged/blocked anywhere it would
  // otherwise apply (travel-request creation, flight/train search, claim submission, ...);
  // missing from this map means enabled, same as a fresh deployment with nothing configured.
  const [exceptionEnabled, setExceptionEnabled] = useState({});
  // What a category override "falls back to" when unconfigured — every claim category shares
  // the main `stages` list, but Travel Request has its own, unrelated default.
  const defaultStagesForCategory = (category) =>
    category === 'TRAVEL_REQUEST' ? TRAVEL_REQUEST_DEFAULT_STAGES : stages;
  // Travel Request approval is stored the same way as a claim category override
  // (category_overrides.TRAVEL_REQUEST) — it's just surfaced as its own top-level "Workflow
  // Type" instead of nested in the claim "Applies to" selector, so it behaves exactly like one
  // throughout the stage editor below, just keyed by 'TRAVEL_REQUEST' instead of selectedCategory.
  const isTravelRequestWorkflow = selectedWorkflow === 'TRAVEL_REQUEST';
  const isCategoryOverride = (selectedWorkflow === 'STANDARD' && selectedCategory !== 'DEFAULT') || isTravelRequestWorkflow;
  const overrideKey = isTravelRequestWorkflow ? 'TRAVEL_REQUEST' : selectedCategory;
  // Claim and Travel Request stages are full {label, route_role, sla_hours} objects with
  // editable label/SLA — exception chains are just a bare ordered list of roles, so those two
  // fields stay fixed/disabled for them.
  const isStageBasedWorkflow = selectedWorkflow === 'STANDARD' || isTravelRequestWorkflow;
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [submission, setSubmission] = useState({
    max_working_days_after_return: 5,
    deadline_mode: 'hard_block',
  });
  const [autoApprove, setAutoApprove] = useState('2000.00');
  const [loadError, setLoadError] = useState(null);
  // Snapshot of the config exactly as last loaded from the server — diffed against what's
  // about to be saved so we can warn before a role silently drops out of the matrix entirely.
  const [lastLoadedConfig, setLastLoadedConfig] = useState(null);

  const load = async () => {
    try {
      setLoadError(null);
      const res = await adminApi.workflowConfig();
      const cfg = res.data?.config || {};
      setLastLoadedConfig(cfg);


      setStages(sanitizeStageRoles(cfg.stages || []));

      const loadedOverrides = cfg.category_overrides || {};
      const sanitizedOverrides = {};
      for (const cat of ['TRAVEL', 'GENERAL', 'REALLOCATION', 'TRAVEL_REQUEST']) {
        if (loadedOverrides[cat]?.stages?.length) {
          sanitizedOverrides[cat] = { stages: sanitizeStageRoles(loadedOverrides[cat].stages) };
        }
      }
      setCategoryOverrides(sanitizedOverrides);
      setSelectedCategory('DEFAULT');
      setExceptionChains(cfg.exception_chains || {});
      setExceptionEnabled(cfg.exception_enabled || {});

      const sub = cfg.submission || {};
      setSubmission({
        max_working_days_after_return: sanitizeMaxWorkingDaysAfterReturn(
          sub.max_working_days_after_return,
        ),
        deadline_mode: DEADLINE_MODES.includes(sub.deadline_mode)
          ? sub.deadline_mode
          : 'hard_block',
      });
      setAutoApprove(sanitizeAutoApproveAmount(cfg.auto_approve_below_amount ?? '2000.00'));
    } catch (err) {
      setLoadError(err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveAction = useAsyncAction(async () => {
    const normalizeStages = (list) =>
      list.map((s, idx) => ({ ...s, number: idx + 1, sla_hours: sanitizeSlaHours(s.sla_hours) }));

    const category_overrides = {};
    for (const [cat, override] of Object.entries(categoryOverrides)) {
      if (override?.stages?.length) {
        category_overrides[cat] = { stages: normalizeStages(override.stages) };
      }
    }

    const config = {
      stages: normalizeStages(stages),
      category_overrides,
      submission: {
        max_working_days_after_return: sanitizeMaxWorkingDaysAfterReturn(
          submission.max_working_days_after_return,
        ),
        deadline_mode: DEADLINE_MODES.includes(submission.deadline_mode)
          ? submission.deadline_mode
          : 'hard_block',
      },
      auto_approve_below_amount: sanitizeAutoApproveAmount(autoApprove),
      exception_chains: exceptionChains,
      exception_enabled: exceptionEnabled,
    };

    if (lastLoadedConfig) {
      const before = rolesCoveredByConfig(lastLoadedConfig);
      const after = rolesCoveredByConfig(config);
      const dropped = ROLES_WORTH_WARNING_ABOUT.filter((r) => before.has(r) && !after.has(r));
      if (dropped.length) {
        const names = dropped.map(roleLabel).join(', ');
        const proceed = window.confirm(
          `After this save, ${names} will no longer be assigned to any claim stage, travel-request stage, or exception chain anywhere in the Approval Matrix. Anyone holding ${dropped.length > 1 ? 'these roles' : 'this role'} will lose access to Pending Approvals and Exception Requests entirely.\n\nSave anyway?`
        );
        if (!proceed) return;
      }
    }

    const res = await adminApi.updateWorkflowConfig(config);
    await load();

    const reassigned = res.data?.reassigned || {};
    const totalReassigned = Object.values(reassigned).reduce((sum, n) => sum + (n || 0), 0);
    if (totalReassigned > 0) {
      const parts = [];
      if (reassigned.claims) parts.push(`${reassigned.claims} claim stage${reassigned.claims > 1 ? 's' : ''}`);
      if (reassigned.travel_request) parts.push(`${reassigned.travel_request} travel request${reassigned.travel_request > 1 ? 's' : ''}`);
      if (reassigned.exceptions) parts.push(`${reassigned.exceptions} exception approval${reassigned.exceptions > 1 ? 's' : ''}`);
      showToast(
        `Workflow configuration saved. Reassigned to the new approver: ${parts.join(', ')}.`,
        'success'
      );
    } else {
      showToast('Workflow configuration saved.', 'success');
    }
  });

  const displayError = loadError || saveAction.error;

  return (
    <>
      <PageHeader
        title=""
        actions={
          <>
            {isViewOnly ? <span className="badge bg-slate-100 text-slate-700">View Only</span> : null}
            {!isViewOnly ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => saveAction.run()}
                disabled={saveAction.loading}
              >
                <Save size={17} />
                {saveAction.loading ? 'Saving…' : 'Save Changes'}
              </button>
            ) : null}
          </>
        }
      />
      {displayError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage(displayError)}
        </div>
      ) : null}

      <section className="panel mb-4 flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm font-semibold text-slate-700">
            Workflow Type:
          </label>
          <select className="field min-w-64 bg-slate-50 py-1.5 text-sm" value={selectedWorkflow} onChange={(event) => setSelectedWorkflow(event.target.value)}>
            <option value="STANDARD">Claim Approval</option>
            <option value="TRAVEL_REQUEST">Travel Request Approval</option>
            <optgroup label="Exception Workflows — Claims">
              {Object.entries(EXCEPTION_TYPES)
                .filter(([key]) => !TRAVEL_REQUEST_EXCEPTION_KEYS.has(key))
                .map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
            </optgroup>
            <optgroup label="Exception Workflows — Travel Requests">
              {Object.entries(EXCEPTION_TYPES)
                .filter(([key]) => TRAVEL_REQUEST_EXCEPTION_KEYS.has(key))
                .map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
            </optgroup>
          </select>
          {selectedWorkflow === 'STANDARD' ? (
            <>
              <label className="text-sm font-semibold text-slate-700">Applies to:</label>
              <select
                className="field min-w-56 bg-slate-50 py-1.5 text-sm"
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
              >
                {STAGE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      </section>

      {isCategoryOverride ? (
        <section className="panel mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          {categoryOverrides[overrideKey]?.stages?.length ? (
            <span className="badge bg-brand/10 text-brand">
              Custom route configured{isTravelRequestWorkflow ? '' : ' for this category'}
            </span>
          ) : (
            <span className="badge bg-slate-100 text-slate-700">Using the shared default route below</span>
          )}
          {!isViewOnly && categoryOverrides[overrideKey]?.stages?.length ? (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() =>
                setCategoryOverrides((prev) => {
                  const next = { ...prev };
                  delete next[overrideKey];
                  return next;
                })
              }
            >
              Reset to shared default
            </button>
          ) : null}
        </section>
      ) : null}

      {!isStageBasedWorkflow ? (
        <section className="panel mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="text-sm font-semibold text-ink">
              {exceptionEnabled[selectedWorkflow] === false ? 'Exception disabled' : 'Exception enabled'}
            </div>
            <p className="text-xs text-slate-500">
              {exceptionEnabled[selectedWorkflow] === false
                ? "This condition is never flagged — a request or claim that would otherwise trip it goes through untouched, with no approval needed."
                : 'This condition is actively checked and routes through the approval chain below whenever it fires.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={exceptionEnabled[selectedWorkflow] !== false}
            aria-label="Toggle this exception on or off"
            disabled={isViewOnly}
            onClick={() =>
              setExceptionEnabled((prev) => {
                const currentlyEnabled = prev[selectedWorkflow] !== false;
                return { ...prev, [selectedWorkflow]: !currentlyEnabled };
              })
            }
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              exceptionEnabled[selectedWorkflow] === false ? 'bg-slate-300' : 'bg-brand'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                exceptionEnabled[selectedWorkflow] === false ? 'left-0.5' : 'left-[22px]'
              }`}
            />
          </button>
        </section>
      ) : null}

      <section className="panel p-4">
        <h2 className="mb-3 text-base font-semibold text-ink">
          {selectedWorkflow === 'STANDARD'
            ? `Approval Stages — ${STAGE_CATEGORIES.find((c) => c.value === selectedCategory)?.label}`
            : isTravelRequestWorkflow
              ? 'Approval Stages — Travel Requests'
              : EXCEPTION_TYPES[selectedWorkflow]}
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          {isTravelRequestWorkflow
            ? 'Stages run in order. Maximum 6 stages.'
            : 'Stages run in order. Finance must be the final stage. Maximum 6 stages.'}
        </p>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Approver Role</th>
              <th className="px-4 py-3">SLA (hours)</th>
              {!isViewOnly ? <th className="px-4 py-3 w-32">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const currentStages = isCategoryOverride
                ? categoryOverrides[overrideKey]?.stages?.length
                  ? categoryOverrides[overrideKey].stages
                  : defaultStagesForCategory(overrideKey)
                : selectedWorkflow === 'STANDARD'
                  ? stages
                  : (exceptionChains[selectedWorkflow] || []).map((r, i) => ({
                      label: `Exception Approval ${i + 1}`,
                      route_role: r,
                      sla_hours: 48,
                    }));

              const updateCurrentStages = (newStages) => {
                if (isCategoryOverride) {
                  setCategoryOverrides((prev) => ({ ...prev, [overrideKey]: { stages: newStages } }));
                } else if (selectedWorkflow === 'STANDARD') {
                  setStages(newStages);
                } else {
                  setExceptionChains({
                    ...exceptionChains,
                    [selectedWorkflow]: newStages.map(s => s.route_role),
                  });
                }
              };

              return currentStages.map((stage, idx) => (
                <tr
                  key={idx}
                  className={`border-t border-line transition-colors hover:bg-slate-50/50 ${draggedIdx === idx ? 'opacity-50 bg-slate-100' : ''} ${!isViewOnly ? 'cursor-move' : ''}`}
                  draggable={!isViewOnly}
                  onDragStart={() => setDraggedIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedIdx === null || draggedIdx === idx) return;
                    const n = [...currentStages];
                    const item = n[draggedIdx];
                    n.splice(draggedIdx, 1);
                    n.splice(idx, 0, item);
                    updateCurrentStages(n);
                    setDraggedIdx(null);
                  }}
                >
                  <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-3">
                    {!isViewOnly && <GripVertical className="text-slate-300 cursor-move hover:text-slate-500 transition-colors" size={16} />}
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand shadow-sm">
                      {idx + 1}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    className="w-full rounded-lg border border-transparent bg-slate-50 px-3 py-1.5 text-sm hover:border-slate-200 focus:border-brand focus:bg-white focus:ring-1 focus:ring-brand/30 transition-all outline-none disabled:opacity-50 disabled:bg-slate-100 disabled:text-slate-500"
                    disabled={isViewOnly || !isStageBasedWorkflow}
                    value={stage.label ?? ''}
                    placeholder="Stage Label"
                    onChange={(e) => {
                      const next = [...currentStages];
                      next[idx] = { ...next[idx], label: e.target.value };
                      updateCurrentStages(next);
                    }}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <select
                    className="w-full rounded-lg border border-transparent bg-slate-50 px-3 py-1.5 text-sm hover:border-slate-200 focus:border-brand focus:bg-white focus:ring-1 focus:ring-brand/30 transition-all outline-none disabled:opacity-50"
                    disabled={isViewOnly}
                    value={stage.route_role ?? 'HRBP_HR'}
                    onChange={(e) => {
                      const next = [...currentStages];
                      next[idx] = { ...next[idx], route_role: e.target.value };
                      updateCurrentStages(next);
                    }}
                  >
                    <option value="REPORTING_MANAGER">Reporting Manager</option>
                    <option value="HRBP_HR">HRBP / HR</option>
                    <option value="PAYROLL">Payroll</option>
                    <option value="FINANCE">Finance</option>
                    <option value="CEO">CEO</option>
                    <option value="GROUP_HEAD_HR">Group Head HR</option>
                    <option value="IT_ADMIN">IT Admin</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <input
                      className="w-20 text-center rounded-lg border border-transparent bg-slate-50 px-3 py-1.5 text-sm hover:border-slate-200 focus:border-brand focus:bg-white focus:ring-1 focus:ring-brand/30 transition-all outline-none disabled:opacity-50 disabled:bg-slate-100 disabled:text-slate-500"
                      type="number"
                      min="1"
                      disabled={isViewOnly || !isStageBasedWorkflow}
                      value={stage.sla_hours ?? ''}
                      onChange={(e) => {
                        const next = [...currentStages];
                        const v = e.target.value;
                        const n = v === '' ? NaN : Number(v);
                        next[idx] = {
                          ...next[idx],
                          sla_hours:
                            Number.isFinite(n) && n >= 1 ? Math.floor(n) : sanitizeSlaHours(next[idx].sla_hours),
                        };
                        updateCurrentStages(next);
                      }}
                    />
                    <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">hrs</span>
                  </div>
                </td>
                {!isViewOnly ? (
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <div className="flex flex-col bg-slate-50 rounded-lg border border-slate-200 overflow-hidden shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]">
                        <button
                          type="button"
                          className="p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 transition-colors"
                          disabled={idx === 0}
                          onClick={() => {
                            const n = [...currentStages];
                            [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
                            updateCurrentStages(n);
                          }}
                        >
                          <ArrowUp size={12} />
                        </button>
                        <div className="h-px w-full bg-slate-200"></div>
                        <button
                          type="button"
                          className="p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 transition-colors"
                          disabled={idx === currentStages.length - 1}
                          onClick={() => {
                            const n = [...currentStages];
                            [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]];
                            updateCurrentStages(n);
                          }}
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="ml-2 p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 transition-colors"
                        disabled={currentStages.length <= 1}
                        title="Remove stage"
                        onClick={() => updateCurrentStages(currentStages.filter((_, i) => i !== idx))}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
              ));
            })()}
          </tbody>
        </table>
        {!isViewOnly && (() => {
          const activeStages = isCategoryOverride
            ? categoryOverrides[overrideKey]?.stages?.length
              ? categoryOverrides[overrideKey].stages
              : defaultStagesForCategory(overrideKey)
            : selectedWorkflow === 'STANDARD'
              ? stages
              : exceptionChains[selectedWorkflow] || [];
          return activeStages.length < 6;
        })() ? (
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() => {
              const newStage = { label: 'New Stage', route_role: 'HRBP_HR', sla_hours: 48 };
              if (isCategoryOverride) {
                const base = categoryOverrides[overrideKey]?.stages?.length
                  ? categoryOverrides[overrideKey].stages
                  : defaultStagesForCategory(overrideKey);
                setCategoryOverrides((prev) => ({ ...prev, [overrideKey]: { stages: [...base, newStage] } }));
              } else if (selectedWorkflow === 'STANDARD') {
                setStages([...stages, newStage]);
              } else {
                setExceptionChains({
                  ...exceptionChains,
                  [selectedWorkflow]: [...(exceptionChains[selectedWorkflow] || []), 'HRBP_HR']
                });
              }
            }}
          >
            <Plus size={15} /> Add Stage
          </button>
        ) : null}
      </section>

      <section className="panel mt-4 p-6">
        <div className="mb-5">
          <h2 className="text-[15px] font-bold text-ink">Claim Submission Rules</h2>
          <p className="mt-1 text-xs text-slate-500">Configure global deadlines and auto-approval thresholds.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5 shadow-sm transition-all hover:shadow-md">
            <label className="text-sm">
              <span className="mb-2 block font-semibold text-slate-700">Max working days after return</span>
              <input
                className="field w-full bg-white"
                type="number"
                min="1"
                readOnly={isViewOnly}
                value={submission.max_working_days_after_return ?? ''}
                onChange={(e) =>
                  setSubmission({
                    ...submission,
                    max_working_days_after_return: sanitizeMaxWorkingDaysAfterReturn(e.target.value),
                  })
                }
              />
              <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                Employees must submit within this many working days of returning.
              </p>
            </label>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5 shadow-sm transition-all hover:shadow-md">
            <label className="text-sm">
              <span className="mb-2 block font-semibold text-slate-700">Deadline mode</span>
              <select
                className="field w-full bg-white"
                disabled={isViewOnly}
                value={submission.deadline_mode ?? 'hard_block'}
                onChange={(e) =>
                  setSubmission({ ...submission, deadline_mode: e.target.value })
                }
              >
                <option value="hard_block">Hard Block (Reject after deadline)</option>
                <option value="soft_warning">Soft Warning (Show warning)</option>
              </select>
              <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                Choose whether to strictly reject late claims or just warn the submitter.
              </p>
            </label>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5 shadow-sm transition-all hover:shadow-md">
            <label className="text-sm">
              <span className="mb-2 block font-semibold text-slate-700">Auto-approve threshold (₹)</span>
              <input
                className="field w-full bg-white"
                type="number"
                min="0"
                step="100"
                readOnly={isViewOnly}
                value={autoApprove}
                onChange={(e) => setAutoApprove(e.target.value)}
              />
              <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                Claims below this amount skip the approval chain and are auto-approved.
              </p>
            </label>
          </div>
        </div>
      </section>
    </>
  );
}
