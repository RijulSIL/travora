import { ArrowLeftRight, Check as CheckIcon, Plus, Send, Undo2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Pill } from '../../components/approvals/ApprovalQueueParts';
import {
  BTN_DARK,
  BTN_GHOST,
  BTN_MAIN,
  BTN_NO,
  BTN_SM,
  CARD,
  CardHead,
  ErrorNote,
  FIELD,
  LABEL,
  PolicyHead,
  fmtDate,
  todayIso,
  useCanConfigurePolicy,
  versionPhase,
} from '../../components/policy/PolicyAdminParts';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { hasPermission } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';
import { formatRole } from '../../utils/formatters';

const STAGES = ['Draft', 'In review', 'Approved', 'Scheduled', 'In effect', 'Archived'];
const AIR = { YES: 'Allowed', CONDITIONAL: 'With approval', NO: 'Not allowed' };
const AIR_CLASS = { ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Premium economy', BUSINESS: 'Business' };
const CAP_FIELDS = { hotel: 'Hotel', food: 'Food', incidental: 'Incidentals', day_visit: 'Day visit' };

const yesNo = (v) => (v ? 'Yes' : 'No');
const list = (v) => (v && v.length ? v.join(', ') : 'None');
const money = (v) => (v == null || v === '' ? 'Not set' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const LEVEL_FIELDS = {
  level_name: ['Name', String],
  air_eligibility: ['Flights', (v) => AIR[v] || v],
  air_class_allowed: ['Air class', (v) => AIR_CLASS[v] || 'None'],
  air_eligibility_conditions: ['Flight approval needed', (v) => yesNo(v?.approval_required)],
  train_classes_allowed: ['Trains', list],
  local_conveyance_modes: ['Local travel', list],
  vehicle_rate_4w: ['Own car ₹/km', money],
  vehicle_rate_2w: ['Two-wheeler ₹/km', money],
  twin_sharing_mandatory: ['Twin sharing', yesNo],
  is_deprecated: ['Deprecated', yesNo],
};
const CATEGORY_FIELDS = {
  parent: ['Sits under', (v) => v || 'Top level'],
  bill_mandatory: ['Bill needed', yesNo],
  gst_invoice_required: ['GST invoice needed', yesNo],
  blacklisted_items: ['Never allowed', list],
  notes: ['Note', (v) => v || 'None'],
  is_active: ['Turned on', yesNo],
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Turns the diff API's entries into "what · field · was · now" lines. */
function diffLines(diff, levelName, tierName) {
  const out = { levels: [], limits: [], categories: [] };
  const whole = (entry, what, kind) => ({ what, field: kind, was: entry.change_type === 'added' ? 'Not there' : 'There', now: entry.change_type === 'added' ? 'Added' : 'Removed' });
  (diff.impact_levels || []).forEach((e) => {
    const what = `${e.key}${levelName(e.key) ? ` · ${levelName(e.key)}` : ''}`;
    if (e.change_type !== 'modified') return out.levels.push(whole(e, what, 'Whole level'));
    Object.entries(LEVEL_FIELDS).forEach(([k, [label, show]]) => {
      if (k === 'air_eligibility_conditions' ? Boolean(e.before[k]?.approval_required) !== Boolean(e.after[k]?.approval_required) : !same(e.before[k], e.after[k])) {
        out.levels.push({ what, field: label, was: show(e.before[k]), now: show(e.after[k]) });
      }
    });
  });
  (diff.expense_limits || []).forEach((e) => {
    const [code, group] = e.key;
    const what = `${code}${levelName(code) ? ` · ${levelName(code)}` : ''}`;
    if (e.change_type !== 'modified') return out.limits.push(whole(e, what, `${tierName(group)} · all caps`));
    Object.entries(CAP_FIELDS).forEach(([k, label]) => {
      if (Number(e.before[`${k}_cap`] ?? NaN) !== Number(e.after[`${k}_cap`] ?? NaN) && !(e.before[`${k}_cap`] == null && e.after[`${k}_cap`] == null)) {
        out.limits.push({ what, field: `${tierName(group)} · ${label} cap`, was: money(e.before[`${k}_cap`]), now: money(e.after[`${k}_cap`]) });
      }
      if (Boolean(e.before[`${k}_is_hard_block`]) !== Boolean(e.after[`${k}_is_hard_block`])) {
        const tag = (v) => (v ? 'Strict' : 'Flagged');
        out.limits.push({ what, field: `${tierName(group)} · ${label}`, was: tag(e.before[`${k}_is_hard_block`]), now: tag(e.after[`${k}_is_hard_block`]) });
      }
    });
  });
  (diff.expense_categories || []).forEach((e) => {
    if (e.change_type !== 'modified') return out.categories.push(whole(e, e.key, 'Whole category'));
    Object.entries(CATEGORY_FIELDS).forEach(([k, [label, show]]) => {
      if (!same(e.before[k], e.after[k])) out.categories.push({ what: e.key, field: label, was: show(e.before[k]), now: show(e.after[k]) });
    });
  });
  return out;
}

function Steps({ phase }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11.5px] font-bold" aria-label={`Stage: ${phase.label}`}>
      {STAGES.map((stage, i) => {
        const cls =
          i < phase.step
            ? 'bg-emerald-50 text-emerald-700'
            : i === phase.step
              ? phase.key === 'live'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600'
                : phase.key === 'archived'
                  ? 'bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200'
                  : 'bg-amber-50 text-amber-700'
              : 'bg-slate-100 text-slate-400';
        return (
          <Fragment key={stage}>
            {i ? <span className="text-slate-300">›</span> : null}
            <span className={`rounded-full px-2 py-0.5 ${cls}`}>{stage}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

function CompareCard({ versions, initialFrom, initialTo }) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [state, setState] = useState({ loading: true, error: null, lines: null });

  useEffect(() => {
    if (!from || !to || from === to) {
      setState({ loading: false, error: null, lines: null });
      return undefined;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([adminApi.diffPolicyVersions(from, to), adminApi.impactLevels({ policy_version_id: to }), adminApi.impactLevels({ policy_version_id: from }), adminApi.cityGroupTiers()])
      .then(([diff, toLevels, fromLevels, tiers]) => {
        if (!live) return;
        const names = Object.fromEntries([...fromLevels.data, ...toLevels.data].map((l) => [l.level_code, l.level_name]));
        const tierNames = Object.fromEntries(tiers.data.map((t) => [t.code, t.display_name]));
        setState({ loading: false, error: null, lines: diffLines(diff.data, (code) => names[code], (code) => tierNames[code] || `Group ${code}`) });
      })
      .catch((error) => live && setState({ loading: false, error, lines: null }));
    return () => {
      live = false;
    };
  }, [from, to]);

  const name = (id) => versions.find((v) => v.id === id)?.version_number;
  const sections = [
    ['levels', 'Impact levels'],
    ['limits', 'Expense limits'],
    ['categories', 'Expense categories'],
  ];
  const quiet = state.lines ? sections.filter(([k]) => !state.lines[k].length).map(([, l]) => l) : [];
  const picker = (label, value, onChange) => (
    <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600">
      {label}
      <select className={`${FIELD} h-8 w-auto`} value={value || ''} onChange={(e) => onChange(Number(e.target.value))}>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.version_number}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section aria-label="Compare versions" className={CARD}>
      <CardHead title={`Compare ${name(from) || ''} → ${name(to) || ''}`} sub="Only what actually changed, by level and city group">
        {picker('From', from, setFrom)}
        {picker('To', to, setTo)}
      </CardHead>
      <ErrorNote error={state.error} />
      {from === to ? <p className="px-4 py-5 text-[13px] text-slate-500">Pick two different versions.</p> : null}
      {state.loading ? <p className="px-4 py-5 text-[13px] text-slate-500">Comparing…</p> : null}
      {!state.loading && state.lines ? (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_110px_110px] gap-2.5 bg-slate-50 px-4 py-2.5 text-[11px] font-bold text-slate-500">
              <span>What</span>
              <span>Field</span>
              <span>Was</span>
              <span>Now</span>
            </div>
            {sections.map(([key, title]) =>
              state.lines[key].length ? (
                <div key={key}>
                  <p className="border-t border-slate-100 px-4 pb-1 pt-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400">{title}</p>
                  {state.lines[key].map((line, i) => (
                    <div key={`${line.what}-${line.field}-${i}`} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_110px_110px] items-center gap-2.5 border-t border-slate-100 px-4 py-2.5 text-[12.5px]">
                      <b className="text-ink">{line.what}</b>
                      <span className="text-slate-600">{line.field}</span>
                      <span className="text-rose-700 line-through">{line.was}</span>
                      <span className="font-bold text-emerald-700">{line.now}</span>
                    </div>
                  ))}
                </div>
              ) : null,
            )}
            {quiet.length ? <p className="border-t border-slate-100 px-4 py-2.5 text-[12.5px] text-slate-500">{quiet.map((l, i) => (i ? l.toLowerCase() : l)).join(' and ')}: no changes</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function VersionCard({ version, versions, isViewOnly, canApprovePolicy, pendingRole, actions }) {
  const navigate = useNavigate();
  const phase = versionPhase(version, versions);
  const today = todayIso();
  const [date, setDate] = useState(version.effective_from || '');
  const [sendBack, setSendBack] = useState(false);
  const [reason, setReason] = useState('');
  const canSchedule = !isViewOnly && (phase.key === 'approved' || phase.key === 'scheduled');
  const draft = phase.key === 'draft';

  let dates;
  if (phase.key === 'live') dates = `In effect since ${fmtDate(version.effective_from)} · ${phase.next ? `${phase.next.version_number} replaces it on ${fmtDate(phase.next.effective_from)}` : 'stays in effect until a newer version starts'}`;
  else if (phase.key === 'archived') dates = `Was in effect ${fmtDate(version.effective_from)} – ${fmtDate(phase.next.effective_from)} · replaced by ${phase.next.version_number}`;
  else if (phase.key === 'scheduled') dates = `Takes effect ${fmtDate(version.effective_from)} · you can move the date until then`;
  else if (phase.key === 'approved') dates = 'Approved · pick the date it takes effect';
  else if (phase.key === 'review') dates = `Submitted for approval${pendingRole ? ` · waiting on ${formatRole(pendingRole)}` : ''}`;
  else dates = `Created ${fmtDate(version.created_at)} · start date is set after approval`;

  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3.5 border-t border-slate-100 px-4 py-3.5 first:border-t-0 sm:grid-cols-[56px_minmax(0,1fr)_auto]">
      <div className={`grid h-[52px] w-[52px] place-items-center rounded-[14px] text-[15px] font-extrabold ${draft ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-ink'}`}>{version.version_number}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-[7px] text-[13.5px] font-bold text-ink">
          Policy {version.version_number} <Pill tone={phase.tone}>{phase.label}</Pill>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">{dates}</p>
        <Steps phase={phase} />
        {sendBack ? (
          <div className="mt-2.5 flex flex-col gap-2 rounded-[10px] border border-rose-200 bg-rose-50/50 p-2.5">
            <label className={LABEL} htmlFor={`reason-${version.id}`}>
              Why are you sending it back?
            </label>
            <textarea id={`reason-${version.id}`} className={`${FIELD} h-16 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Hotel caps look wrong, please revise." />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN_NO} disabled={!reason.trim() || actions.reject.loading} onClick={() => actions.reject.run(version.id, reason.trim()).then(() => setSendBack(false)).catch(() => {})}>
                <Undo2 size={14} />
                Send back to draft
              </button>
              <button type="button" className={BTN_GHOST} onClick={() => setSendBack(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="col-span-2 flex flex-wrap justify-start gap-1.5 sm:col-span-1 sm:justify-end">
        {draft && !isViewOnly ? (
          <>
            <button type="button" className={BTN_SM} onClick={() => navigate(`/admin/impact-levels?versionId=${version.id}`)}>
              Edit levels
            </button>
            <button type="button" className={BTN_SM} onClick={() => navigate(`/admin/expense-limits?versionId=${version.id}`)}>
              Edit caps
            </button>
            <button type="button" className={BTN_SM} onClick={() => navigate(`/admin/expense-categories?versionId=${version.id}`)}>
              Edit categories
            </button>
            <button type="button" className={`${BTN_DARK} h-7 rounded-lg px-2.5 text-[11.5px]`} disabled={actions.submit.loading} onClick={() => actions.submit.run(version.id).catch(() => {})}>
              <Send size={12} />
              Submit for review
            </button>
          </>
        ) : null}
        {phase.key === 'review' && !isViewOnly && canApprovePolicy && !sendBack ? (
          <>
            <button type="button" className={`${BTN_MAIN} h-7 rounded-lg px-2.5 text-[11.5px]`} disabled={actions.approve.loading} onClick={() => actions.approve.run(version.id).catch(() => {})}>
              <CheckIcon size={13} />
              Approve
            </button>
            <button type="button" className={`${BTN_NO} h-7 rounded-lg px-2.5 text-[11.5px]`} onClick={() => setSendBack(true)}>
              <Undo2 size={13} />
              Send back
            </button>
          </>
        ) : null}
        {canSchedule ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="sr-only" htmlFor={`start-${version.id}`}>
              Start date for {version.version_number}
            </label>
            <input id={`start-${version.id}`} type="date" min={today} className={`${FIELD} h-7 w-[150px] text-xs`} value={date} onChange={(e) => setDate(e.target.value)} />
            <button type="button" className={`${BTN_MAIN} h-7 rounded-lg px-2.5 text-[11.5px]`} disabled={!date || date === version.effective_from || actions.schedule.loading} onClick={() => actions.schedule.run(version.id, date).catch(() => {})}>
              {version.effective_from ? 'Move start date' : 'Set start date'}
            </button>
          </div>
        ) : null}
        {!(draft && !isViewOnly) && !(phase.key === 'review' && !isViewOnly && canApprovePolicy) && !canSchedule ? <Pill>Read-only</Pill> : null}
      </div>
    </div>
  );
}

export default function PolicyVersionManager() {
  useSetPageTitle('Policy Versions');
  const [versions, setVersions] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [pendingStageByVersion, setPendingStageByVersion] = useState({});
  const [compare, setCompare] = useState(false);
  const [newDraft, setNewDraft] = useState(null);
  const permissions = useAuthStore((state) => state.profile?.permissions);
  const isViewOnly = !useCanConfigurePolicy();
  // Approving a submitted version is gated by the separate approve_policy permission (see
  // admin/policy.py's approve endpoint); whose turn it is comes from the approval chain.
  const canApprovePolicy = hasPermission(permissions, 'approve_policy');

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
            return [v.id, chain.find((row) => row.status === 'PENDING')?.required_role ?? null];
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

  const createAction = useAsyncAction(async (versionNumber) => {
    await adminApi.createPolicyVersion({ version_number: versionNumber, effective_to: null });
    setNewDraft(null);
    await load();
  });
  const actions = {
    submit: useAsyncAction(async (id) => {
      await adminApi.submitPolicyVersion(id);
      await load();
    }),
    approve: useAsyncAction(async (id) => {
      await adminApi.approvePolicyVersion(id);
      await load();
    }),
    // Sends a submitted version back to DRAFT with a reason, instead of leaving it stuck pending.
    reject: useAsyncAction(async (id, reason) => {
      await adminApi.rejectPolicyVersion(id, reason);
      await load();
    }),
    // Picks (or moves) an approved version's start date; the backend locks it once that date arrives.
    schedule: useAsyncAction(async (id, newDate) => {
      await adminApi.schedulePolicyVersion(id, newDate);
      await load();
    }),
  };
  const error = loadError || createAction.error || Object.values(actions).find((a) => a.error)?.error;

  const newestFirst = useMemo(() => [...versions].sort((a, b) => b.id - a.id), [versions]);
  const live = versions.find((v) => versionPhase(v, versions).key === 'live');
  const compareTo = versions.find((v) => v.status === 'DRAFT' && v.id !== live?.id) || newestFirst.find((v) => v.id !== live?.id);
  const compareFrom = live || newestFirst[1];

  return (
    <section className="flex flex-col gap-3.5">
      <PolicyHead title="Policy versions" sub="Every change to levels, caps and categories happens in a draft version, goes for approval, then takes effect on the date you set.">
        <button type="button" className={BTN_GHOST} aria-pressed={compare} disabled={versions.length < 2} onClick={() => setCompare((c) => !c)}>
          <ArrowLeftRight size={15} />
          {compare ? 'Hide comparison' : 'Compare versions'}
        </button>
        {!isViewOnly ? (
          <button type="button" className={BTN_MAIN} onClick={() => setNewDraft((d) => (d == null ? '' : null))}>
            <Plus size={15} />
            New draft
          </button>
        ) : null}
      </PolicyHead>
      <ErrorNote error={error} />

      {newDraft != null ? (
        <form
          aria-label="New draft"
          className={`${CARD} flex flex-wrap items-end gap-3 px-4 py-3.5`}
          onSubmit={(e) => {
            e.preventDefault();
            createAction.run(newDraft.trim()).catch(() => {});
          }}
        >
          <div className="min-w-[180px] flex-1">
            <label className={LABEL} htmlFor="new-version">
              Version number
            </label>
            <input id="new-version" className={FIELD} placeholder="e.g. 3.0" value={newDraft} onChange={(e) => setNewDraft(e.target.value)} autoFocus />
          </div>
          <p className="basis-full text-xs text-slate-500 sm:order-last">It starts as a copy of the latest approved version. You pick the date it takes effect after it&apos;s approved.</p>
          <button type="submit" className={BTN_MAIN} disabled={!newDraft.trim() || createAction.loading}>
            {createAction.loading ? 'Creating…' : 'Create draft'}
          </button>
          <button type="button" className={BTN_GHOST} onClick={() => setNewDraft(null)}>
            Cancel
          </button>
        </form>
      ) : null}

      <section aria-label="Versions" className={CARD}>
        {newestFirst.map((version) => (
          <VersionCard
            key={`${version.id}-${version.effective_from}-${version.status}`}
            version={version}
            versions={versions}
            isViewOnly={isViewOnly}
            canApprovePolicy={canApprovePolicy}
            pendingRole={pendingStageByVersion[version.id]}
            actions={actions}
          />
        ))}
        {versions.length === 0 && !loadError ? <p className="px-4 py-6 text-center text-[13px] text-slate-500">No policy versions yet. Create a draft to get started.</p> : null}
        <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3.5 border-t border-slate-100 bg-slate-50 px-4 py-3.5 sm:grid-cols-[56px_minmax(0,1fr)]">
          <div className="grid h-[52px] w-[52px] place-items-center rounded-[14px] border border-dashed border-slate-200 bg-white text-slate-400">—</div>
          <div>
            <p className="text-[13px] font-bold text-ink">How a version moves along</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Submit a draft → its approvers approve or send it back with a reason → once approved, pick the date it starts (you can move it until that date) → it comes into effect on that day, and the version it replaces is archived.
            </p>
          </div>
        </div>
      </section>

      {compare && compareFrom && compareTo ? <CompareCard versions={newestFirst} initialFrom={compareFrom.id} initialTo={compareTo.id} /> : null}
    </section>
  );
}
