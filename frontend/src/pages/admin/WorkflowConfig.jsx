import { ArrowDown, ArrowUp, Plus, Save, Trash2, GripVertical } from 'lucide-react';
import { useEffect, useState } from 'react';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { canEditWorkflowConfig } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

const DEADLINE_MODES = ['hard_block', 'soft_warning'];
const DEFAULT_MAX_DAYS = 5;

const EXCEPTION_TYPES = {
  "AIR_TRAVEL_UNLOCK": "Exception: Air Travel Unlock",
  "TRAIN_TATKAL": "Exception: Train Tatkal",
  "FLIGHT_ADVANCE_BOOKING_OVERRIDE": "Exception: Flight Advance Booking",
  "FLIGHT_COST_DELTA": "Exception: Flight Cost Delta",
  "ROOM_RENT_DEVIATION": "Exception: Room Rent Deviation",
  "HOTEL/ACCOMMODATION_DEVIATION": "Exception: Accommodation Deviation",
  "HOTEL_DEVIATION": "Exception: Hotel Deviation",
  "ACCOMMODATION_DEVIATION": "Exception: Accommodation Deviation (Alt)",
  "AIR_TRAVEL_L5_L6": "Exception: Air Travel L5/L6",
  "HIRED_TAXI_UNAUTHORIZED": "Exception: Unauthorized Hired Taxi",
  "MODE_DEVIATION": "Exception: Travel Mode Deviation",
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
  const [selectedWorkflow, setSelectedWorkflow] = useState('STANDARD');
  const [stages, setStages] = useState([]);
  const [exceptionChains, setExceptionChains] = useState({});
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [submission, setSubmission] = useState({
    max_working_days_after_return: 5,
    deadline_mode: 'hard_block',
  });
  const [autoApprove, setAutoApprove] = useState('2000.00');
  const [loadError, setLoadError] = useState(null);

  const load = async () => {
    try {
      setLoadError(null);
      const res = await adminApi.workflowConfig();
      const cfg = res.data?.config || {};


      const loadedStages = cfg.stages || [];

      const allowedRoles = ['REPORTING_MANAGER', 'HRBP_HR', 'PAYROLL', 'FINANCE'];
      const sanitizedStages = loadedStages.map((s) => ({
        ...s,
        route_role: allowedRoles.includes(s.route_role) ? s.route_role : 'HRBP_HR',
      }));
      setStages(sanitizedStages);
      setExceptionChains(cfg.exception_chains || {});

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
    const config = {
      stages: stages.map((s, idx) => ({
        ...s,
        number: idx + 1,
        sla_hours: sanitizeSlaHours(s.sla_hours),
      })),
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
    };
    await adminApi.updateWorkflowConfig(config);
    await load();
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
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage(displayError)}
        </div>
      ) : null}

      <section className="panel mb-4 flex flex-wrap items-center justify-between gap-4 rounded p-4">
        <div className="flex items-center gap-4">
          <label className="text-sm font-semibold text-slate-700">
            Workflow Type:
          </label>
          <select className="field min-w-64 bg-slate-50 py-1.5 text-sm" value={selectedWorkflow} onChange={(event) => setSelectedWorkflow(event.target.value)}>
            <option value="STANDARD">Standard Claim Approval</option>
            <optgroup label="Exception Workflows">
              {Object.entries(EXCEPTION_TYPES).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </optgroup>
          </select>
        </div>
      </section>

      <section className="panel rounded p-4">
        <h2 className="mb-3 text-base font-semibold text-ink">{selectedWorkflow === 'STANDARD' ? 'Approval Stages' : EXCEPTION_TYPES[selectedWorkflow]}</h2>
        <p className="mb-3 text-xs text-slate-500">
          Stages run in order. Finance must be the final stage. Maximum 6 stages.
        </p>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
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
              const currentStages = selectedWorkflow === 'STANDARD' ? stages : (exceptionChains[selectedWorkflow] || []).map((r, i) => ({
                label: `Exception Approval ${i + 1}`,
                route_role: r,
                sla_hours: 48,
              }));

              const updateCurrentStages = (newStages) => {
                if (selectedWorkflow === 'STANDARD') {
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
                  <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {!isViewOnly && <GripVertical className="text-slate-300 cursor-move hover:text-slate-500 transition-colors" size={16} />}
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand shadow-sm">
                      {idx + 1}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <input
                    className="w-full rounded-md border border-transparent bg-slate-50 px-3 py-1.5 text-sm hover:border-slate-200 focus:border-brand focus:bg-white focus:ring-1 focus:ring-brand/30 transition-all outline-none disabled:opacity-50 disabled:bg-slate-100 disabled:text-slate-500"
                    disabled={isViewOnly || selectedWorkflow !== 'STANDARD'}
                    value={stage.label ?? ''}
                    placeholder="Stage Label"
                    onChange={(e) => {
                      const next = [...currentStages];
                      next[idx] = { ...next[idx], label: e.target.value };
                      updateCurrentStages(next);
                    }}
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    className="w-full rounded-md border border-transparent bg-slate-50 px-3 py-1.5 text-sm hover:border-slate-200 focus:border-brand focus:bg-white focus:ring-1 focus:ring-brand/30 transition-all outline-none disabled:opacity-50"
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
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      className="w-20 text-center rounded-md border border-transparent bg-slate-50 px-3 py-1.5 text-sm hover:border-slate-200 focus:border-brand focus:bg-white focus:ring-1 focus:ring-brand/30 transition-all outline-none disabled:opacity-50 disabled:bg-slate-100 disabled:text-slate-500"
                      type="number"
                      min="1"
                      disabled={isViewOnly || selectedWorkflow !== 'STANDARD'}
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
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <div className="flex flex-col bg-slate-50 rounded border border-slate-200 overflow-hidden shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]">
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
                          disabled={idx === stages.length - 1}
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
                        className="ml-2 p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 transition-colors"
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
        {!isViewOnly && (selectedWorkflow === 'STANDARD' ? stages.length < 6 : (exceptionChains[selectedWorkflow]?.length || 0) < 6) ? (
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() => {
              if (selectedWorkflow === 'STANDARD') {
                setStages([...stages, { label: 'New Stage', route_role: 'HRBP_HR', sla_hours: 48 }]);
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

      <section className="panel mt-4 rounded p-6">
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
