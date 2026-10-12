import { CheckCircle, GitCompare, Plus, Send, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { hasPermission } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

const formatValue = (v, key) => {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  
  if (key && (key.includes('rate') || key.includes('amount') || key.includes('limit'))) {
    const n = Number(v);
    if (!Number.isNaN(n)) return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
  return String(v);
};

function DiffCard({ row }) {
  const getBadge = (tag) => {
    if (tag === 'ADDED') return <span className="bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 px-2 py-0.5 rounded-full text-[10px] font-bold">ADDED</span>;
    if (tag === 'REMOVED') return <span className="bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/10 px-2 py-0.5 rounded-full text-[10px] font-bold">REMOVED</span>;
    return <span className="bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 px-2 py-0.5 rounded-full text-[10px] font-bold">MODIFIED</span>;
  };

  return (
    <div className="rounded-lg border border-slate-100 bg-white p-4 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-bold text-slate-900">{row.label}</h4>
          <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase mt-0.5">{row.key}</p>
        </div>
        {getBadge(row.tag)}
      </div>
      
      {row.tag === 'MODIFIED' ? (
        <div className="flex items-center gap-3 bg-slate-50 rounded-md p-2.5 border border-slate-100/50">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Previous</div>
            <div className="text-sm text-red-600 font-medium truncate line-through decoration-red-300" title={row.oldValue}>{row.oldValue}</div>
          </div>
          <div className="text-slate-300 flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">New Value</div>
            <div className="text-sm text-emerald-600 font-bold truncate" title={row.newValue}>{row.newValue}</div>
          </div>
        </div>
      ) : row.tag === 'ADDED' ? (
        <div className="bg-emerald-50/50 rounded-md p-2.5 border border-emerald-100/50">
          <div className="text-sm text-emerald-700 font-medium truncate" title={row.newValue}>{row.newValue}</div>
        </div>
      ) : (
        <div className="bg-red-50/50 rounded-md p-2.5 border border-red-100/50">
          <div className="text-sm text-red-700 font-medium truncate" title={row.oldValue}>{row.oldValue}</div>
        </div>
      )}
    </div>
  );
}

function renderDiffRows(items = [], labelBuilder) {
  return items.map((item, idx) => {
    const before = item.before || {};
    const after = item.after || {};
    const label = labelBuilder(item);
    
    if (item.change_type === 'ADDED') {
      return { id: `${label}-${idx}`, label, key: 'Entire Configuration', oldValue: '-', newValue: 'New Ruleset Created', tag: 'ADDED' };
    }
    if (item.change_type === 'REMOVED') {
      return { id: `${label}-${idx}`, label, key: 'Entire Configuration', oldValue: 'Existing Ruleset', newValue: 'Ruleset Removed', tag: 'REMOVED' };
    }
    
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
    
    return keys.map((key) => ({
      id: `${label}-${key}-${idx}`,
      label,
      key: key.replace(/_/g, ' ').toUpperCase(),
      oldValue: formatValue(before[key], key),
      newValue: formatValue(after[key], key),
      tag: 'MODIFIED',
    }));
  }).flat();
}

export default function PolicyVersionManager() {
  useSetPageTitle('Policy Versions');
  const navigate = useNavigate();
  const [versions, setVersions] = useState([]);
  const [diff, setDiff] = useState(null);
  // No effective_from here — it's never drafted upfront, and stays unset even once approved.
  // HRBP picks it afterwards via a separate schedule step (see PolicyVersion's docstring for
  // why: it closes a real bug where two drafts with independently pre-set future dates,
  // approved out of that order, could corrupt an archived version's date range).
  const [form, setForm] = useState({ version_number: '', effective_to: '' });
  const [loadError, setLoadError] = useState(null);
  // The actual configure_policy permission, not a hardcoded role list — matches the backend's
  // real write gate (_WRITE_ADMIN_POLICY), so toggling it off in the Permission Matrix now
  // correctly switches this page to read-only instead of showing edit controls that would 403.
  const permissions = useAuthStore((state) => state.profile?.permissions);
  const isViewOnly = !hasPermission(permissions, 'configure_policy');
  // Approving a submitted version is gated by the separate, admin-editable "approve_policy"
  // permission — see permission_config_service.py / admin/policy.py's approve_policy_version
  // endpoint. Must track the backend check, not a hardcoded role.
  const canApprovePolicy = hasPermission(permissions, 'approve_policy');

  // versionId -> required_role of whichever approval-chain stage is currently PENDING. A
  // multi-stage chain (see Approval Matrix's "Policy Approval" workflow type) means whoever
  // generally holds approve_policy isn't necessarily who can act right now — this is what
  // actually decides whether clicking Approve/Reject will succeed or 403.
  const [pendingStageByVersion, setPendingStageByVersion] = useState({});
  // Local in-progress edits to a version's effective_from, keyed by version id, before the
  // Schedule/Save Date button is clicked — kept separate from `versions` so typing doesn't need
  // a round trip.
  const [scheduleEdits, setScheduleEdits] = useState({});
  const todayStr = new Date().toISOString().slice(0, 10);

  const load = async () => {
    try {
      setLoadError(null);
      const loaded = (await adminApi.policyVersions()).data;
      setVersions(loaded);

      const pending = loaded.filter((v) => v.status === 'PENDING_HRBP');
      const entries = await Promise.all(
        pending.map(async (v) => {
          try {
            const chain = (await adminApi.policyApprovalChain(v.id)).data;
            const active = chain.find((row) => row.status === 'PENDING');
            return [v.id, active?.required_role ?? null];
          } catch {
            return [v.id, null];
          }
        }),
      );
      setPendingStageByVersion(Object.fromEntries(entries));
    } catch (error) {
      setLoadError(error);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const createAction = useAsyncAction(async () => {
    await adminApi.createPolicyVersion({ ...form, effective_to: form.effective_to || null });
    setForm({ version_number: '', effective_to: '' });
    await load();
  });

  const diffAction = useAsyncAction(async () => {
    if (versions.length < 2) return;
    const response = await adminApi.diffPolicyVersions(versions[0].id, versions[versions.length - 1].id);
    setDiff(response.data);
  });

  const submitAction = useAsyncAction(async (id) => {
    await adminApi.submitPolicyVersion(id);
    await load();
  });
  const approveAction = useAsyncAction(async (id) => {
    await adminApi.approvePolicyVersion(id);
    await load();
  });
  // Sends a submitted version back to DRAFT instead of leaving it stuck pending forever —
  // the only two outcomes that existed before this (approve it, or leave it pending with no
  // way to edit or delete it). Reuses the same approve_policy + MFA gate as approving, since
  // whoever can approve a version should also be able to send it back.
  const rejectAction = useAsyncAction(async (id, reason) => {
    await adminApi.rejectPolicyVersion(id, reason);
    await load();
  });
  // Picks (or later moves) a fully-approved version's effective_from — only possible while it's
  // still unset or still in the future (enforce_immutability on the backend cuts this off the
  // moment the date actually arrives).
  const scheduleAction = useAsyncAction(async (id, newDate) => {
    await adminApi.schedulePolicyVersion(id, newDate);
    setScheduleEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await load();
  });
  const error = loadError || createAction.error || diffAction.error || submitAction.error || approveAction.error || rejectAction.error || scheduleAction.error;

  return (
    <>
      <PageHeader
        title=""
        actions={
          <>
            {isViewOnly ? <span className="badge bg-slate-100 text-slate-700">View Only</span> : null}
            <button type="button" className="btn-secondary" onClick={diffAction.run} disabled={diffAction.loading}>
              <GitCompare size={17} />
              Diff
            </button>
          </>
        }
      />
      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}
      <section className="panel rounded-lg shadow-sm border border-slate-100 p-6 mb-6">
        <div className="mb-5 border-b border-line pb-4">
          <h2 className="text-lg font-bold text-slate-900">Create New Draft Version</h2>
          <p className="text-sm text-slate-500 mt-1">Initialize a new policy version to start making changes to impact levels or expense limits.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-12 items-end">
          <div className="md:col-span-4">
            <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">Version Number</label>
            <input className="field w-full text-slate-900" readOnly={isViewOnly} placeholder="e.g. v2.0" value={form.version_number} onChange={(event) => setForm({ ...form, version_number: event.target.value })} />
          </div>
          <div className="md:col-span-4">
            <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">Effective To (optional)</label>
            <input className="field w-full text-slate-900" readOnly={isViewOnly} type="date" value={form.effective_to} onChange={(event) => setForm({ ...form, effective_to: event.target.value })} />
          </div>
          <div className="md:col-span-4">
            {!isViewOnly ? <button className="btn-primary w-full justify-center h-10 shadow-sm" onClick={createAction.run} disabled={createAction.loading}><Plus size={16} />{createAction.loading ? 'Creating...' : 'Create Draft'}</button> : null}
          </div>
        </div>
        {/* No "Effective From" field — it's never drafted upfront. Once this version is fully
            approved, HRBP picks the date separately (and can still move it right up until it
            arrives), so two drafts can never be approved out of an intended date order and
            corrupt an archived version's range. */}
        <p className="mt-3 text-xs text-slate-500">
          Effective From isn&apos;t set here — once this version is approved, HRBP schedules the date it takes effect (editable until that date arrives).
        </p>
      </section>

      <section className="panel table-contain mt-6 overflow-hidden rounded-lg shadow-sm border border-slate-100">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-4">Version</th>
              <th className="px-5 py-4">Effective Dates</th>
              <th className="px-5 py-4 text-center">Status</th>
              <th className="px-5 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {versions.map((version) => {
              // Fully approved (status ACTIVE) but no date picked yet — HRBP must make an
              // explicit schedule_policy_version call before this governs anything system-wide.
              const isAwaitingSchedule = version.status === 'ACTIVE' && !version.effective_from;
              // Fully approved AND dated, but that date hasn't arrived yet — HRBP can still move
              // it. Once effective_from is reached, enforce_immutability locks it and this
              // reverts to a plain ACTIVE row.
              const isScheduled = version.status === 'ACTIVE' && version.effective_from && version.effective_from > todayStr;
              const badgeClass = isAwaitingSchedule
                ? 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/20'
                : isScheduled
                  ? 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20'
                  : version.status === 'ACTIVE'
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
                    : version.status === 'DRAFT'
                      ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20'
                      : 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20';
              const scheduleDraft = scheduleEdits[version.id] ?? (version.effective_from || '');
              const scheduleDirty = (isScheduled || isAwaitingSchedule) && scheduleDraft && scheduleDraft !== version.effective_from;
              return (
              <tr key={version.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-5 py-4 text-center font-bold text-slate-900">{version.version_number}</td>
                <td className="px-5 py-4 text-center font-medium text-slate-600">
                  {(isScheduled || isAwaitingSchedule) && !isViewOnly ? (
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="date"
                        className="field h-8 w-36 text-xs"
                        min={todayStr}
                        value={scheduleDraft}
                        onChange={(event) => setScheduleEdits({ ...scheduleEdits, [version.id]: event.target.value })}
                      />
                      {version.effective_from ? (
                        <>
                          <span className="text-slate-400">to</span>
                          <span>{version.effective_to || 'Present'}</span>
                        </>
                      ) : null}
                      {scheduleDirty ? (
                        <button
                          className="btn-primary h-7 px-2 text-[10px] font-bold"
                          onClick={() => scheduleAction.run(version.id, scheduleDraft)}
                          disabled={scheduleAction.loading}
                        >
                          {isAwaitingSchedule ? 'Schedule' : 'Save Date'}
                        </button>
                      ) : null}
                    </div>
                  ) : version.effective_from ? (
                    <>{version.effective_from} <span className="text-slate-400 mx-1">to</span> {version.effective_to || 'Present'}</>
                  ) : (
                    <span className="text-slate-400 italic">{version.status === 'ACTIVE' ? 'Awaiting schedule' : 'Scheduled after approval'}</span>
                  )}
                </td>
                <td className="px-5 py-4 text-center">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeClass}`}>
                    {isAwaitingSchedule ? 'AWAITING SCHEDULE' : isScheduled ? 'SCHEDULED' : version.status}
                  </span>
                  {version.status === 'PENDING_HRBP' && pendingStageByVersion[version.id] ? (
                    <div className="mt-1 text-[10px] font-semibold text-slate-400">
                      Awaiting: {pendingStageByVersion[version.id]}
                    </div>
                  ) : null}
                  {isScheduled ? (
                    <div className="mt-1 text-[10px] font-semibold text-slate-400">
                      Starts {version.effective_from}
                    </div>
                  ) : null}
                </td>
                <td className="px-5 py-4 text-center">
                  <div className="flex justify-center gap-2">
                    {version.status === 'DRAFT' && !isViewOnly ? (
                      <>
                        <button className="btn-secondary h-8 px-3 text-[11px] font-bold" onClick={() => navigate(`/admin/impact-levels?versionId=${version.id}`)}>Edit Levels</button>
                        <button className="btn-secondary h-8 px-3 text-[11px] font-bold" onClick={() => navigate(`/admin/expense-limits?versionId=${version.id}`)}>Edit Limits</button>
                      </>
                    ) : null}
                    {!isViewOnly && version.status === 'DRAFT' ? <button className="btn-primary h-8 px-3 text-[11px] font-bold bg-slate-800 hover:bg-slate-700" onClick={() => submitAction.run(version.id)} disabled={submitAction.loading}><Send size={14} />Submit for Review</button> : null}
                    {!isViewOnly && version.status === 'PENDING_HRBP' && canApprovePolicy ? <button className="btn-primary h-8 px-3 text-[11px] font-bold bg-brand hover:bg-brand/90" onClick={() => approveAction.run(version.id)} disabled={approveAction.loading}><CheckCircle size={14} />Approve Policy</button> : null}
                    {!isViewOnly && version.status === 'PENDING_HRBP' && canApprovePolicy ? (
                      <button
                        className="btn-secondary h-8 px-3 text-[11px] font-bold text-red-600 hover:bg-red-50"
                        onClick={() => {
                          const reason = window.prompt('Reason for sending this version back to draft (required):');
                          if (reason && reason.trim()) rejectAction.run(version.id, reason.trim());
                        }}
                        disabled={rejectAction.loading}
                      >
                        <XCircle size={14} />Reject
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
              );
            })}
            {versions.length === 0 && (
              <tr>
                <td colSpan="4" className="px-5 py-8 text-center text-slate-500 italic">No policy versions found. Create a draft to get started.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {diff ? (
        <section className="panel mt-8 rounded-lg shadow-sm border border-slate-100 p-6 bg-slate-50/50">
          <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Version Diff Analysis</h2>
              <p className="text-sm text-slate-500 mt-1">Comparing the current active policy with the latest draft version.</p>
            </div>
          </div>
          
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-200/60">
                <div className="h-2.5 w-2.5 rounded-full bg-brand"></div>
                <h3 className="font-bold text-slate-800">Impact Level Changes</h3>
              </div>
              <div className="space-y-3">
                {renderDiffRows(diff.impact_levels, (item) => item.key).length === 0 ? (
                  <div className="text-sm text-slate-400 italic py-4 text-center border border-dashed border-slate-200 rounded-lg">No modifications to impact levels.</div>
                ) : renderDiffRows(diff.impact_levels, (item) => item.key).map((row) => (
                  <DiffCard key={row.id} row={row} />
                ))}
              </div>
            </div>
            
            <div>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-200/60">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500"></div>
                <h3 className="font-bold text-slate-800">Expense Limit Changes</h3>
              </div>
              <div className="space-y-3">
                {renderDiffRows(diff.expense_limits, (item) => `${item.key?.[0] || '-'} / Tier ${item.key?.[1] || '-'}`).length === 0 ? (
                  <div className="text-sm text-slate-400 italic py-4 text-center border border-dashed border-slate-200 rounded-lg">No modifications to expense limits.</div>
                ) : renderDiffRows(diff.expense_limits, (item) => `${item.key?.[0] || '-'} / Tier ${item.key?.[1] || '-'}`).map((row) => (
                  <DiffCard key={row.id} row={row} />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
