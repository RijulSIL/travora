import { ArrowDown, ArrowUp, GripVertical, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Pill } from '../../components/approvals/ApprovalQueueParts';
import {
  CLAIM_CATEGORIES,
  CLAIM_EXCEPTION_FLOW,
  CLAIM_EXCEPTIONS,
  CLAIM_SUBMIT_EXCEPTIONS,
  DEADLINE_MODES,
  DEPARTMENT_HEAD,
  EXCEPTION_FLOW_DEFAULTS,
  EXCEPTION_FLOW_KEYS,
  EXCEPTION_FLOWS,
  EXCEPTION_KEYS,
  FLOW_NAMES,
  HEAD_FLOWS,
  MAX_STEPS,
  ROLE_NAMES,
  ROLE_SHORT,
  ROLES_WORTH_WARNING_ABOUT,
  STANDALONE_DEFAULTS,
  STEP_ROLES,
  errorMessage,
  exceptionFlowInUse,
  rolesCoveredByConfig,
  sanitizeAutoApprove,
  sanitizeMaxDays,
  sanitizeSlaHours,
} from '../../components/admin/approvalMatrix';
import { BTN_GHOST, BTN_SM, CARD, EYEBROW, FIELD } from '../../components/policy/PolicyAdminParts';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { adminApi } from '../../services/adminApi';
import { canEditWorkflowConfig } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';
import { formatRole } from '../../utils/formatters';

// The relocation prior-approval check: a step list like the others, plus an on/off switch.
const PRIOR = 'RELOCATION_PRIOR_APPROVAL';
const STAGE_FLOWS = ['CLAIMS', 'TRAVEL_REQUEST', 'RELOCATION_REQUEST', PRIOR];
const FILTER = FIELD.replace('w-full', '');
const j = (x) => JSON.stringify(x ?? null);

// Which Department heads tick covers a flow: claims, travel requests, or both exception flows.
const headFlowOf = (key) =>
  key === 'CLAIMS' ? 'claims' : key === 'TRAVEL_REQUEST' ? 'travel_requests' : EXCEPTION_FLOW_KEYS.includes(key) ? 'exceptions' : null;
// The route keys kept in exception_chains: the two shared exception flows and Policy versions.
const ROUTE_KEYS = [...EXCEPTION_FLOW_KEYS, 'POLICY_APPROVAL'];

/** The config exactly as it will be saved: steps numbered, hours and amounts cleaned up, empty entries dropped. */
function normalize(cfg) {
  const stageList = (list) =>
    (list || []).map((s, i) => ({
      ...s,
      number: i + 1,
      route_role: STEP_ROLES.includes(s.route_role) ? s.route_role : 'HRBP_HR',
      sla_hours: sanitizeSlaHours(s.sla_hours),
    }));
  const overrides = {};
  for (const key of ['TRAVEL', 'GENERAL', 'RELOCATION', 'TRAVEL_REQUEST', 'RELOCATION_REQUEST', PRIOR]) {
    const list = cfg.category_overrides?.[key]?.stages;
    if (list?.length) overrides[key] = { stages: stageList(list) };
  }
  // Switched off is the only state worth storing; on is the default.
  if (cfg.category_overrides?.[PRIOR]?.enabled === false) overrides[PRIOR] = { ...overrides[PRIOR], enabled: false };
  // Only the shared exception routes and Policy versions are kept; per-type chains from before the
  // shared routes are dropped (a config that still has them loads the shared defaults).
  const stored = cfg.exception_chains || {};
  const chains = {
    ...Object.fromEntries(EXCEPTION_FLOW_KEYS.map((k) => [k, stored[k]?.length ? stored[k] : EXCEPTION_FLOW_DEFAULTS[k]])),
    POLICY_APPROVAL: stored.POLICY_APPROVAL?.length ? stored.POLICY_APPROVAL : ['HRBP_HR'],
  };
  const heads = {};
  for (const [dept, h] of Object.entries(cfg.department_heads || {})) {
    if (!h?.head_user_id) continue;
    heads[dept] = {
      head_user_id: Number(h.head_user_id),
      claims: Boolean(h.claims),
      travel_requests: Boolean(h.travel_requests),
      exceptions: Boolean(h.exceptions),
    };
  }
  return {
    stages: stageList(cfg.stages),
    category_overrides: overrides,
    submission: {
      max_working_days_after_return: sanitizeMaxDays(cfg.submission?.max_working_days_after_return),
      deadline_mode: DEADLINE_MODES.includes(cfg.submission?.deadline_mode) ? cfg.submission.deadline_mode : 'hard_block',
    },
    auto_approve_below_amount: sanitizeAutoApprove(cfg.auto_approve_below_amount ?? '2000.00'),
    exception_chains: chains,
    exception_enabled: cfg.exception_enabled || {},
    exception_submission_mode: cfg.exception_submission_mode || {},
    // One SLA per route step, trimmed or padded to the route's length.
    exception_sla_hours: Object.fromEntries(
      Object.entries(chains).map(([key, chain]) => [key, (chain || []).map((_, i) => sanitizeSlaHours(cfg.exception_sla_hours?.[key]?.[i] ?? 48))]),
    ),
    department_heads: heads,
  };
}

/** Plain names of what differs between two configs, for the save bar and the dots in the list. */
function changedParts(a, b) {
  const out = [];
  if (j(a.stages) !== j(b.stages) || ['TRAVEL', 'GENERAL', 'RELOCATION'].some((k) => j(a.category_overrides[k]) !== j(b.category_overrides[k]))) out.push('CLAIMS');
  // Ahead of the exception flows: ticking Exceptions changes both at once.
  if (j(a.department_heads) !== j(b.department_heads)) out.push('DEPARTMENT_HEADS');
  ['TRAVEL_REQUEST', 'RELOCATION_REQUEST', PRIOR].forEach((k) => {
    if (j(a.category_overrides[k]) !== j(b.category_overrides[k])) out.push(k);
  });
  ROUTE_KEYS.forEach((k) => {
    // An exception flow also changes when one of its types is switched or set to Allow/Block.
    const types = Object.keys(EXCEPTION_FLOWS[k]?.types || {});
    if (
      j(a.exception_chains[k]) !== j(b.exception_chains[k]) ||
      j(a.exception_sla_hours[k]) !== j(b.exception_sla_hours[k]) ||
      types.some(
        (t) =>
          (a.exception_enabled[t] !== false) !== (b.exception_enabled[t] !== false) ||
          (a.exception_submission_mode[t] || 'ALLOW') !== (b.exception_submission_mode[t] || 'ALLOW'),
      )
    )
      out.push(k);
  });
  if (j(a.submission) !== j(b.submission) || a.auto_approve_below_amount !== b.auto_approve_below_amount) out.push('SUBMISSION');
  return out;
}
const changeName = (k) => (k === 'DEPARTMENT_HEADS' ? 'Department heads' : k === 'SUBMISSION' ? 'Submission rules' : FLOW_NAMES[k]);

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-brand' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

function Segmented({ label, options, value, onChange, disabled }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-[10px] bg-slate-100 p-[3px]">
      {options.map(([v, text, danger]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={`rounded-[7px] px-2.5 py-[5px] text-xs font-bold disabled:cursor-not-allowed ${
            value === v ? `bg-white shadow-sm ${danger ? 'text-rose-700' : 'text-ink'}` : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Option({ title, children, control }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3.5 rounded-xl border border-slate-200 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <b className="text-[13px] text-ink">{title}</b>
        <p className="mt-0.5 max-w-[62ch] text-xs text-slate-500">{children}</p>
      </div>
      {control}
    </div>
  );
}

function Warn({ children }) {
  return <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{children}</div>;
}

export default function WorkflowConfig() {
  useSetPageTitle('Approval Matrix');
  const permissions = useAuthStore((s) => s.profile?.permissions);
  const canEdit = canEditWorkflowConfig(permissions);
  const { showToast } = useToast();

  const [cfg, setCfg] = useState(null);
  const [base, setBase] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(null);
  const [people, setPeople] = useState([]);
  const [knownDepartments, setKnownDepartments] = useState([]);
  const [departmentSizes, setDepartmentSizes] = useState({});
  // Which roles hold approve_claims / approve_exception / approve_policy (Role permissions). null
  // means unknown (not allowed to read it, or it failed): offer every role, as before.
  const [eligible, setEligible] = useState({ claim: null, exception: null, policy: null });

  const [sel, setSel] = useState('CLAIMS');
  const [cat, setCat] = useState('DEFAULT');
  const [query, setQuery] = useState('');
  // Drag to reorder steps: a step only becomes draggable while its grip is held (so text in its
  // inputs can still be selected); dropAt is the gap it would land in (0 = before the first).
  const [armed, setArmed] = useState(null);
  const [dragFrom, setDragFrom] = useState(null);
  const [dropAt, setDropAt] = useState(null);

  const load = async () => {
    try {
      setLoadError('');
      const res = await adminApi.workflowConfig();
      const loaded = normalize(res.data?.config || {});
      setCfg(loaded);
      setBase(loaded);
    } catch (err) {
      setLoadError(errorMessage(err) || 'Could not load the approval matrix.');
    }
  };

  useEffect(() => {
    load();
    adminApi
      .permissionMatrix()
      .then((res) => {
        const byRole = res.data?.config?.permissions || {};
        const holding = (perm) => new Set(Object.entries(byRole).filter(([, perms]) => (perms || []).includes(perm)).map(([role]) => role));
        setEligible({ claim: holding('approve_claims'), exception: holding('approve_exception'), policy: holding('approve_policy') });
      })
      .catch(() => {});
    adminApi
      .departmentHeadCandidates()
      .then((res) => {
        setPeople(res.data?.people || []);
        setKnownDepartments(res.data?.departments || []);
        setDepartmentSizes(res.data?.department_sizes || {});
      })
      .catch(() => {});
  }, []);

  const changes = useMemo(() => (cfg && base ? changedParts(normalize(cfg), base) : []), [cfg, base]);
  // The company's departments (Company profile), plus any already given a head here.
  const departments = useMemo(
    () => [...new Set([...knownDepartments, ...Object.keys(cfg?.department_heads || {})])],
    [knownDepartments, cfg],
  );

  if (!cfg) {
    return (
      <section className="flex flex-col gap-3.5">
        <h1 className="text-xl font-extrabold text-ink">Approval matrix</h1>
        {loadError ? (
          <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
            {loadError}
          </div>
        ) : (
          <Skeleton variant="table" rows={6} columns={1} />
        )}
      </section>
    );
  }

  const isOn = (k) => cfg.exception_enabled[k] !== false;
  const typesOf = (flow) => Object.keys(EXCEPTION_FLOWS[flow].types);
  const flowOn = (flow) => exceptionFlowInUse(cfg, flow);
  const priorOn = cfg.category_overrides[PRIOR]?.enabled !== false;
  const modeOf = (k) => cfg.exception_submission_mode[k] || 'ALLOW';
  const chainOf = (k) => (cfg.exception_chains[k] || []).map((role, i) => ({ route_role: role, sla_hours: cfg.exception_sla_hours[k]?.[i] ?? 48 }));
  const stagesOf = (k, category = cat) =>
    k === 'CLAIMS'
      ? category === 'DEFAULT'
        ? cfg.stages
        : cfg.category_overrides[category]?.stages || cfg.stages
      : cfg.category_overrides[k]?.stages || STANDALONE_DEFAULTS[k];
  const listOf = (k) => (STAGE_FLOWS.includes(k) ? stagesOf(k) : chainOf(k));
  const summary = (list) => list.map((s) => ROLE_SHORT[s.route_role] || formatRole(s.route_role)).join(' → ');
  const headsFor = (flow) => departments.filter((d) => cfg.department_heads[d]?.head_user_id && cfg.department_heads[d]?.[flow]);
  const personName = (id) => {
    const p = people.find((x) => x.user_id === Number(id));
    return p ? p.name : `User #${id}`;
  };

  const update = (fn) => setCfg((current) => fn(structuredClone(current)));

  // Writes a step list back to wherever the selected flow keeps it.
  const writeList = (draft, key, next) => {
    if (key === 'CLAIMS') {
      if (cat === 'DEFAULT') draft.stages = next;
      else draft.category_overrides[cat] = { stages: next };
    } else if (STAGE_FLOWS.includes(key)) {
      draft.category_overrides[key] = { ...draft.category_overrides[key], stages: next };
    } else {
      draft.exception_chains[key] = next.map((s) => s.route_role);
      draft.exception_sla_hours[key] = next.map((s) => sanitizeSlaHours(s.sla_hours));
    }
  };
  const changeList = (fn) =>
    update((draft) => {
      const current = STAGE_FLOWS.includes(sel) ? structuredClone(stagesOf(sel)) : chainOf(sel);
      writeList(draft, sel, fn(current));
      return draft;
    });

  // Keeps a real "Department head" step in a flow while any department has it ticked: added at
  // the default spot (just before Finance on claims, last elsewhere) the first time, removed
  // when no department needs it. Returns the lists that are already full, if any.
  const syncHeadSteps = (draft, flow) => {
    const needed = departments.some((d) => draft.department_heads[d]?.head_user_id && draft.department_heads[d]?.[flow]);
    const full = [];
    const fix = (list, beforeFinance, name) => {
      const has = list.some((s) => s.route_role === DEPARTMENT_HEAD);
      if (needed && !has) {
        if (list.length >= MAX_STEPS) {
          full.push(name);
          return list;
        }
        const at = beforeFinance ? list.map((s) => s.route_role).lastIndexOf('FINANCE') : -1;
        const next = [...list];
        next.splice(at >= 0 ? at : next.length, 0, { label: 'Department head approval', route_role: DEPARTMENT_HEAD, sla_hours: 48 });
        return next;
      }
      return !needed && has ? list.filter((s) => s.route_role !== DEPARTMENT_HEAD) : list;
    };
    if (flow === 'claims') {
      draft.stages = fix(draft.stages, true, 'Claims');
      ['TRAVEL', 'GENERAL', 'RELOCATION'].forEach((c) => {
        if (draft.category_overrides[c]) draft.category_overrides[c] = { stages: fix(draft.category_overrides[c].stages, true, `${c.toLowerCase()} claims`) };
      });
    } else if (flow === 'travel_requests') {
      const current = draft.category_overrides.TRAVEL_REQUEST?.stages || STANDALONE_DEFAULTS.TRAVEL_REQUEST;
      const next = fix(current, false, 'Travel requests');
      if (next !== current) draft.category_overrides.TRAVEL_REQUEST = { stages: next };
    } else {
      // Both shared exception flows.
      EXCEPTION_FLOW_KEYS.forEach((k) => {
        const current = (draft.exception_chains[k] || []).map((role, i) => ({ route_role: role, sla_hours: draft.exception_sla_hours[k]?.[i] ?? 48 }));
        const next = fix(current, false, FLOW_NAMES[k]);
        if (next !== current) {
          draft.exception_chains[k] = next.map((s) => s.route_role);
          draft.exception_sla_hours[k] = next.map((s) => sanitizeSlaHours(s.sla_hours));
        }
      });
    }
    return full;
  };

  const setHead = (dept, userId) =>
    update((draft) => {
      if (!userId) delete draft.department_heads[dept];
      else draft.department_heads[dept] = { claims: false, travel_requests: false, exceptions: false, ...draft.department_heads[dept], head_user_id: Number(userId) };
      HEAD_FLOWS.forEach(([flow]) => syncHeadSteps(draft, flow));
      return draft;
    });
  const setHeadFlow = (dept, flow, on) => {
    const draft = structuredClone(cfg);
    draft.department_heads[dept] = { ...draft.department_heads[dept], [flow]: on };
    const full = syncHeadSteps(draft, flow);
    if (on && full.length) {
      showToast(`${full.join(', ')} already ${full.length === 1 ? 'has' : 'have'} ${MAX_STEPS} steps. Remove one first.`, 'error');
      return;
    }
    setCfg(draft);
  };

  const discard = () => {
    setCfg(base);
    setSaveError('');
  };

  const doSave = async (config) => {
    setConfirmDrop(null);
    setSaving(true);
    setSaveError('');
    try {
      const res = await adminApi.updateWorkflowConfig(config);
      const saved = normalize(res.data?.config || config);
      setCfg(saved);
      setBase(saved);
      const reassigned = res.data?.reassigned || {};
      const parts = [];
      if (reassigned.claims) parts.push(`${reassigned.claims} claim step${reassigned.claims > 1 ? 's' : ''}`);
      if (reassigned.travel_request) parts.push(`${reassigned.travel_request} travel request${reassigned.travel_request > 1 ? 's' : ''}`);
      if (reassigned.exceptions) parts.push(`${reassigned.exceptions} exception approval${reassigned.exceptions > 1 ? 's' : ''}`);
      showToast(parts.length ? `Approval matrix saved. Moved to the new approver: ${parts.join(', ')}.` : 'Approval matrix saved.', 'success');
    } catch (err) {
      setSaveError(errorMessage(err) || 'Could not save the approval matrix.');
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    const config = normalize(cfg);
    const before = rolesCoveredByConfig(base);
    const after = rolesCoveredByConfig(config);
    const dropped = ROLES_WORTH_WARNING_ABOUT.filter((r) => before.has(r) && !after.has(r));
    if (dropped.length) setConfirmDrop({ config, dropped });
    else doSave(config);
  };

  // ---- Left-hand list ----
  const q = query.trim().toLowerCase();
  const groups = [
    {
      title: 'Approvals',
      items: [
        ['CLAIMS', summary(cfg.stages), ['TRAVEL', 'GENERAL', 'RELOCATION'].some((c) => cfg.category_overrides[c]) ? <Pill tone="brand">Custom by category</Pill> : null],
        ['TRAVEL_REQUEST', summary(stagesOf('TRAVEL_REQUEST')), cfg.category_overrides.TRAVEL_REQUEST ? null : <Pill>Default</Pill>],
        ['RELOCATION_REQUEST', summary(stagesOf('RELOCATION_REQUEST')), cfg.category_overrides.RELOCATION_REQUEST ? null : <Pill>Default</Pill>],
        [PRIOR, priorOn ? summary(stagesOf(PRIOR)) : 'Switched off', !priorOn ? <Pill>Off</Pill> : cfg.category_overrides[PRIOR]?.stages ? null : <Pill>Default</Pill>],
        ['POLICY_APPROVAL', summary(chainOf('POLICY_APPROVAL')), null],
      ],
    },
    {
      title: 'Exception flows',
      items: EXCEPTION_FLOW_KEYS.map((k) => {
        const on = typesOf(k).filter(isOn).length;
        return [
          k,
          on ? summary(chainOf(k)) : 'Every exception switched off',
          !on ? <Pill>Off</Pill> : on < typesOf(k).length ? <Pill>{`${on}/${typesOf(k).length} on`}</Pill> : null,
        ];
      }),
    },
  ];
  // A flow is found by its own name or by the name of any exception type it covers.
  const matchesQuery = (k) =>
    !q || FLOW_NAMES[k].toLowerCase().includes(q) || Object.values(EXCEPTION_FLOWS[k]?.types || {}).some((name) => name.toLowerCase().includes(q));

  // ---- Editor for the selected flow ----
  const stageBased = STAGE_FLOWS.includes(sel);
  const isPolicy = sel === 'POLICY_APPROVAL';
  const isException = EXCEPTION_FLOW_KEYS.includes(sel);
  const exceptionFlowOff = isException && !flowOn(sel);
  const list = listOf(sel);
  const roleEligible = sel === 'RELOCATION_REQUEST' || sel === PRIOR ? null : stageBased ? eligible.claim : isPolicy ? eligible.policy : eligible.exception;
  const headFlow = headFlowOf(sel);
  const headDepts = headFlow ? headsFor(headFlow) : [];
  const customRoute = sel === 'CLAIMS' ? cat !== 'DEFAULT' && Boolean(cfg.category_overrides[cat]) : stageBased && Boolean(cfg.category_overrides[sel]?.stages);
  const catName = CLAIM_CATEGORIES.find(([v]) => v === cat)?.[1];
  const description =
    sel === 'CLAIMS'
      ? 'Every claim goes through these steps in order. There must be a Finance step.'
      : sel === 'TRAVEL_REQUEST'
        ? 'A trip request goes through these steps before the Travel Desk books it.'
        : sel === 'RELOCATION_REQUEST'
          ? 'Someone without relocation approval asks for it here; once the last step approves, they can raise relocation claims (which then follow Claims → Relocation).'
          : sel === PRIOR
            ? 'When an employee uploads a relocation approval given outside the app, these steps check the document before they can claim against it. Every approver on the route can open the upload.'
          : isPolicy
            ? 'A new policy version needs these approvals before it can take effect.'
            : sel === CLAIM_EXCEPTION_FLOW
              ? 'A claim with any switched-on exception below goes to these approvers instead of the Claims route: one request listing every exception, and each approver accepts, rejects or sends back each one. After the last step it goes to Finance.'
              : 'A travel request with any switched-on exception below goes to these approvers instead of the Travel requests route, with one approve or reject for the whole request. After the last step it goes to the Travel Desk.';
  const roleOptions = (current) =>
    STEP_ROLES.filter((r) => (r === DEPARTMENT_HEAD ? headFlow !== null || current === r : !roleEligible || roleEligible.has(r) || r === current));
  const noFinance = sel === 'CLAIMS' && !list.some((s) => s.route_role === 'FINANCE');
  const noName = stageBased && list.some((s) => !String(s.label || '').trim());
  const headSteps = list.filter((s) => s.route_role === DEPARTMENT_HEAD).length;

  return (
    <section className={`flex flex-col gap-3.5 ${changes.length && canEdit ? 'pb-24' : ''}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Approval matrix</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">Who approves what, in what order, and how long each step has.</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          {[
            ['Approval flows', groups.reduce((n, g) => n + g.items.length, 0)],
            ['Exceptions on', `${EXCEPTION_KEYS.filter(isOn).length} / ${EXCEPTION_KEYS.length}`],
            ['Block a claim', Object.keys(CLAIM_EXCEPTIONS).filter((k) => CLAIM_SUBMIT_EXCEPTIONS.has(k) && isOn(k) && modeOf(k) === 'BLOCK').length],
          ].map(([label, value]) => (
            <div key={label} className="min-w-[96px] rounded-xl border border-slate-200 bg-white px-3 py-[7px]">
              <b className="block text-[17px] text-ink">{value}</b>
              <span className="text-[11.5px] font-semibold text-slate-500">{label}</span>
            </div>
          ))}
          {!canEdit ? <span className="self-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">View only</span> : null}
        </div>
      </div>

      {saveError ? (
        <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
          {saveError}
        </div>
      ) : null}

      <div className="grid items-start gap-3.5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside aria-label="Approval flows" className={`${CARD} flex max-h-[360px] flex-col lg:sticky lg:top-[calc(var(--app-nav-h,56px)+12px)] lg:max-h-[calc(100vh-var(--app-nav-h,56px)-24px)]`}>
          <label className="relative border-b border-slate-100 p-2.5">
            <span className="sr-only">Find a flow or exception</span>
            <Search size={14} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${FILTER} w-full pl-8`} placeholder="Find a flow or exception" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="overflow-y-auto">
            {groups.map((group) => {
              const items = group.items.filter(([k]) => matchesQuery(k));
              if (!items.length) return null;
              return (
                <div key={group.title}>
                  <div className={`${EYEBROW} flex justify-between px-3.5 pb-1 pt-2.5`}>
                    <span>{group.title}</span>
                    <span>{items.length}</span>
                  </div>
                  {items.map(([k, line, tag]) => {
                    const off = k === PRIOR ? !priorOn : EXCEPTION_FLOW_KEYS.includes(k) && !flowOn(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        aria-current={sel === k || undefined}
                        onClick={() => setSel(k)}
                        className={`block w-full border-l-[3px] py-2 pl-[11px] pr-3.5 text-left ${sel === k ? 'border-l-brand bg-brand/[0.07]' : 'border-l-transparent hover:bg-slate-50'}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className={`flex min-w-0 items-center gap-1.5 text-[13px] font-bold ${off ? 'text-slate-400' : 'text-ink'}`}>
                            {changes.includes(k) ? <span title="Unsaved change" className="h-1.5 w-1.5 flex-none rounded-full bg-amber-500" /> : null}
                            <span className="truncate">{FLOW_NAMES[k]}</span>
                          </span>
                          {tag}
                        </span>
                        <span className={`mt-0.5 block truncate text-[11.5px] ${off ? 'text-slate-400' : 'text-slate-500'}`}>{line}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-3.5">
          <section aria-label={FLOW_NAMES[sel]} className={CARD}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
              <div>
                <h2 className="text-base font-extrabold text-ink">{FLOW_NAMES[sel]}</h2>
                <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-normal text-slate-500">{description}</p>
              </div>
              <Pill tone={exceptionFlowOff || (sel === PRIOR && !priorOn) ? 'slate' : 'brand'}>
                {list.length} step{list.length === 1 ? '' : 's'}
              </Pill>
            </div>
            <div className="flex flex-col gap-3.5 px-4 py-3.5">
              {sel === 'CLAIMS' ? (
                <Option
                  title="Applies to"
                  control={
                    <div className="flex flex-wrap items-center gap-2">
                      {customRoute && canEdit ? (
                        <button
                          type="button"
                          className={BTN_SM}
                          onClick={() =>
                            update((d) => {
                              delete d.category_overrides[cat];
                              return d;
                            })
                          }
                        >
                          Use the shared route
                        </button>
                      ) : null}
                      <Segmented label="Claim category" options={CLAIM_CATEGORIES} value={cat} onChange={setCat} />
                    </div>
                  }
                >
                  {cat === 'DEFAULT'
                    ? 'The shared route every claim uses unless its category has its own.'
                    : customRoute
                      ? `${catName} claims have their own route.`
                      : `${catName} claims use the shared route. Change a step to give them their own.`}
                </Option>
              ) : null}
              {sel === PRIOR ? (
                <Option
                  title="Check uploaded approvals"
                  control={
                    <Switch
                      label="Check uploaded relocation approvals"
                      checked={priorOn}
                      disabled={!canEdit}
                      onChange={(on) =>
                        update((d) => {
                          const rest = { ...d.category_overrides[PRIOR] };
                          if (on) delete rest.enabled;
                          else rest.enabled = false;
                          if (Object.keys(rest).length) d.category_overrides[PRIOR] = rest;
                          else delete d.category_overrides[PRIOR];
                          return d;
                        })
                      }
                    />
                  }
                >
                  {priorOn
                    ? 'On: an uploaded approval waits for these steps before the employee can claim.'
                    : 'Off: an uploaded approval counts straight away and the employee can claim at once.'}
                </Option>
              ) : null}
              {sel === 'TRAVEL_REQUEST' || sel === 'RELOCATION_REQUEST' || sel === PRIOR ? (
                <Option
                  title={customRoute ? 'Custom route' : 'Default route'}
                  control={
                    customRoute && canEdit ? (
                      <button
                        type="button"
                        className={BTN_SM}
                        onClick={() =>
                          update((d) => {
                            const { enabled } = d.category_overrides[sel] || {};
                            if (enabled === false) d.category_overrides[sel] = { enabled };
                            else delete d.category_overrides[sel];
                            return d;
                          })
                        }
                      >
                        Back to default
                      </button>
                    ) : null
                  }
                >
                  {customRoute ? 'Set up for this flow.' : 'The built-in steps. Change one to make your own.'}
                </Option>
              ) : null}
              {exceptionFlowOff ? (
                <Warn>Every exception type below is switched off, so nothing goes through this route right now.</Warn>
              ) : null}

              <div>
                <div
                  className={`${EYEBROW} hidden gap-2.5 px-[11px] pb-1.5 sm:grid ${
                    stageBased ? 'sm:grid-cols-[48px_minmax(0,1.2fr)_minmax(0,1fr)_128px_92px]' : 'sm:grid-cols-[48px_minmax(0,1fr)_128px_92px]'
                  }`}
                >
                  <span>#</span>
                  {stageBased ? <span>Step</span> : null}
                  <span>Approver</span>
                  <span className="text-right">Time to act</span>
                  <span />
                </div>
                <ol className={`flex flex-col ${exceptionFlowOff || (sel === PRIOR && !priorOn) ? 'opacity-50' : ''}`}>
                  {list.map((step, i) => {
                    const head = step.route_role === DEPARTMENT_HEAD;
                    const dropLine = <span aria-hidden className="my-0.5 block h-[3px] rounded-full bg-brand" />;
                    return (
                      <li
                        key={`${sel}-${cat}-${i}`}
                        className={`flex flex-col ${dragFrom === i ? 'opacity-40' : ''}`}
                        draggable={canEdit && armed === i}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(i));
                          setDragFrom(i);
                        }}
                        onDragOver={(e) => {
                          if (dragFrom === null) return;
                          e.preventDefault();
                          const box = e.currentTarget.getBoundingClientRect();
                          setDropAt(e.clientY < box.top + box.height / 2 ? i : i + 1);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = dragFrom;
                          const to = dropAt;
                          if (from !== null && to !== null && to !== from && to !== from + 1) {
                            changeList((l) => {
                              const [moved] = l.splice(from, 1);
                              l.splice(to > from ? to - 1 : to, 0, moved);
                              return l;
                            });
                          }
                          setDragFrom(null);
                          setDropAt(null);
                          setArmed(null);
                        }}
                        onDragEnd={() => {
                          setDragFrom(null);
                          setDropAt(null);
                          setArmed(null);
                        }}
                      >
                        {i ? <span aria-hidden className="ml-[34px] h-3.5 w-0.5 bg-slate-200" /> : null}
                        {dragFrom !== null && dropAt === i && dropAt !== dragFrom && dropAt !== dragFrom + 1 ? dropLine : null}
                        <div
                          className={`grid grid-cols-[48px_minmax(0,1fr)] items-center gap-2.5 rounded-xl border px-2.5 py-[9px] ${
                            stageBased ? 'sm:grid-cols-[48px_minmax(0,1.2fr)_minmax(0,1fr)_128px_auto]' : 'sm:grid-cols-[48px_minmax(0,1fr)_128px_auto]'
                          } ${head ? 'border-dashed border-[#b7d3c8] bg-[#f7fbf9]' : 'border-slate-200 bg-white'}`}
                        >
                          <span className="flex items-center gap-0.5">
                            {canEdit ? (
                              <span
                                role="button"
                                tabIndex={-1}
                                aria-label={`Drag step ${i + 1} to reorder`}
                                title="Drag to reorder"
                                onPointerDown={() => setArmed(i)}
                                onPointerUp={() => setArmed(null)}
                                className="grid h-7 w-4 cursor-grab place-items-center text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                              >
                                <GripVertical size={15} />
                              </span>
                            ) : (
                              <span className="w-4" />
                            )}
                            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-xs font-extrabold text-brand">{i + 1}</span>
                          </span>
                          {stageBased ? (
                            <input
                              aria-label={`Step ${i + 1} name`}
                              className={FIELD}
                              placeholder="Step name"
                              disabled={!canEdit}
                              value={step.label ?? ''}
                              onChange={(e) =>
                                changeList((l) => {
                                  l[i] = { ...l[i], label: e.target.value };
                                  return l;
                                })
                              }
                            />
                          ) : null}
                          <select
                            aria-label={`Step ${i + 1} approver`}
                            className={`${FIELD} col-start-2 sm:col-start-auto`}
                            disabled={!canEdit}
                            value={step.route_role}
                            onChange={(e) =>
                              changeList((l) => {
                                l[i] = { ...l[i], route_role: e.target.value };
                                return l;
                              })
                            }
                          >
                            {roleOptions(step.route_role).map((r) => (
                              <option key={r} value={r}>
                                {ROLE_NAMES[r]}
                                {r !== DEPARTMENT_HEAD && roleEligible && !roleEligible.has(r) ? ' (no longer eligible)' : ''}
                              </option>
                            ))}
                          </select>
                          <label className="relative col-start-2 block sm:col-start-auto">
                            <span className="sr-only">Step {i + 1} working hours to act</span>
                            <input
                              type="number"
                              min="1"
                              className={`${FIELD} pr-14 text-right`}
                              disabled={!canEdit || isPolicy}
                              value={step.sla_hours ?? 48}
                              onChange={(e) =>
                                changeList((l) => {
                                  const n = Number(e.target.value);
                                  l[i] = { ...l[i], sla_hours: Number.isFinite(n) && n >= 1 ? Math.floor(n) : l[i].sla_hours };
                                  return l;
                                })
                              }
                            />
                            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400">work hrs</span>
                          </label>
                          {canEdit ? (
                            <span className="col-start-2 flex gap-1 sm:col-start-auto">
                              <button
                                type="button"
                                aria-label={`Move step ${i + 1} up`}
                                className={`${BTN_SM} w-7 px-0`}
                                disabled={i === 0}
                                onClick={() =>
                                  changeList((l) => {
                                    [l[i - 1], l[i]] = [l[i], l[i - 1]];
                                    return l;
                                  })
                                }
                              >
                                <ArrowUp size={12} />
                              </button>
                              <button
                                type="button"
                                aria-label={`Move step ${i + 1} down`}
                                className={`${BTN_SM} w-7 px-0`}
                                disabled={i === list.length - 1}
                                onClick={() =>
                                  changeList((l) => {
                                    [l[i], l[i + 1]] = [l[i + 1], l[i]];
                                    return l;
                                  })
                                }
                              >
                                <ArrowDown size={12} />
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove step ${i + 1}`}
                                className={`${BTN_SM} w-7 px-0 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700`}
                                disabled={list.length <= 1}
                                onClick={() => changeList((l) => l.filter((_, idx) => idx !== i))}
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ) : null}
                          {head ? (
                            <span className="col-start-2 col-end-[-1] text-[11.5px] font-semibold text-brand">
                              {headDepts.length
                                ? `Only for ${headDepts.join(', ')}. Everyone else skips this step.`
                                : 'No department has this ticked yet, so everyone skips this step.'}
                            </span>
                          ) : null}
                        </div>
                        {dragFrom !== null && i === list.length - 1 && dropAt === list.length && dragFrom !== list.length - 1 ? dropLine : null}
                      </li>
                    );
                  })}
                </ol>
              </div>

              {noFinance ? <Warn>Claims need a Finance step, otherwise nobody pays them. Add one before saving.</Warn> : null}
              {noName ? <Warn>Every step needs a name.</Warn> : null}
              {headSteps > 1 ? <Warn>There&apos;s more than one Department head step here; the head would be asked more than once.</Warn> : null}
              {canEdit ? (
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <button
                    type="button"
                    className={BTN_GHOST}
                    disabled={list.length >= MAX_STEPS}
                    onClick={() => changeList((l) => [...l, { label: 'New step', route_role: 'HRBP_HR', sla_hours: 48 }])}
                  >
                    <Plus size={14} />
                    Add step
                  </button>
                  <span className="text-xs text-slate-500">
                    {list.length}/{MAX_STEPS} steps
                  </span>
                </div>
              ) : null}
              {!isPolicy ? (
                <p className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                  Hours count working time only; weekends and Holiday calendar days are skipped. If someone misses their time, it passes to the next step. The
                  last step can&apos;t pass it on, so it gets a reminder every 4 working hours instead.
                </p>
              ) : null}
            </div>
          </section>

          {isException ? (
            <section aria-label={`${FLOW_NAMES[sel]}: exception types`} className={CARD}>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
                <div>
                  <h2 className="text-[14.5px] font-extrabold text-ink">Exception types</h2>
                  <p className="mt-0.5 max-w-[72ch] text-[12.5px] leading-normal text-slate-500">
                    {sel === CLAIM_EXCEPTION_FLOW
                      ? 'Each one is checked on every claim and, when it happens, goes through the route above. Switch one off to stop flagging it; Block stops the claim being submitted with it at all.'
                      : 'Each one is checked on every travel request and, when it happens, goes through the route above. Switch one off to stop flagging it.'}
                  </p>
                </div>
                <Pill tone={exceptionFlowOff ? 'slate' : 'brand'}>
                  {typesOf(sel).filter(isOn).length}/{typesOf(sel).length} on
                </Pill>
              </div>
              <div className="flex flex-col gap-2 px-4 py-3.5">
                {typesOf(sel).map((type) => {
                  const on = isOn(type);
                  const allowBlock = CLAIM_SUBMIT_EXCEPTIONS.has(type) && on;
                  return (
                    <Option
                      key={type}
                      title={EXCEPTION_FLOWS[sel].types[type]}
                      control={
                        <span className="flex flex-wrap items-center gap-2.5">
                          {allowBlock ? (
                            <Segmented
                              label={`${EXCEPTION_FLOWS[sel].types[type]}: when it's on a claim`}
                              disabled={!canEdit}
                              options={[
                                ['ALLOW', 'Allow with a reason'],
                                ['BLOCK', 'Block the claim', true],
                              ]}
                              value={modeOf(type)}
                              onChange={(v) =>
                                update((d) => {
                                  d.exception_submission_mode[type] = v;
                                  return d;
                                })
                              }
                            />
                          ) : null}
                          <Switch
                            label={`Switch ${EXCEPTION_FLOWS[sel].types[type]} on or off`}
                            checked={on}
                            disabled={!canEdit}
                            onChange={(next) =>
                              update((d) => {
                                d.exception_enabled[type] = next;
                                return d;
                              })
                            }
                          />
                        </span>
                      }
                    >
                      {!on
                        ? 'Off: never flagged — anything that would trip it goes through without approval.'
                        : allowBlock && modeOf(type) === 'BLOCK'
                          ? "Blocks the claim: it can't be submitted with this expense, even with a reason."
                          : sel === CLAIM_EXCEPTION_FLOW
                            ? 'On: the employee gives a reason and it goes through the route above with the claim.'
                            : 'On: the request goes through the route above.'}
                    </Option>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section aria-label="Department heads" className={CARD}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
              <div>
                <h2 className="text-[14.5px] font-extrabold text-ink">Department heads</h2>
                <p className="mt-0.5 max-w-[72ch] text-[12.5px] leading-normal text-slate-500">
                  Pick a head for a department and tick where they must also approve. Ticking adds a <b className="text-ink">Department head</b> step to that
                  flow (first placed just before Finance on claims, last elsewhere); move it to any position like other steps. Departments left unticked skip
                  that step.
                </p>
              </div>
              {changes.includes('DEPARTMENT_HEADS') ? <Pill tone="amber">Changed</Pill> : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
                <thead>
                  <tr className={`${EYEBROW} text-left`}>
                    <th className="border-b border-slate-200 bg-slate-50 px-3 py-2">Department</th>
                    <th className="border-b border-slate-200 bg-slate-50 px-3 py-2">Head</th>
                    {HEAD_FLOWS.map(([flow, label]) => (
                      <th key={flow} className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-center">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {departments.map((dept) => {
                    const h = cfg.department_heads[dept] || {};
                    const count = departmentSizes[dept] || 0;
                    const active = h.head_user_id && HEAD_FLOWS.some(([flow]) => h[flow]);
                    return (
                      <tr key={dept} className={active ? 'bg-[#f7fbf9]' : ''}>
                        <td className="border-t border-slate-100 px-3 py-2">
                          <b className="text-ink">{dept}</b>
                          <span className="block text-[11.5px] text-slate-500">
                            {count} {count === 1 ? 'person' : 'people'}
                          </span>
                        </td>
                        <td className="border-t border-slate-100 px-3 py-2">
                          <select
                            aria-label={`Head of ${dept}`}
                            className={`${FIELD} min-w-[180px]`}
                            disabled={!canEdit}
                            value={h.head_user_id || ''}
                            onChange={(e) => setHead(dept, e.target.value)}
                          >
                            <option value="">No head set</option>
                            {h.head_user_id && !people.some((p) => p.user_id === Number(h.head_user_id)) ? (
                              <option value={h.head_user_id}>{personName(h.head_user_id)}</option>
                            ) : null}
                            {people.map((p) => (
                              <option key={p.user_id} value={p.user_id}>
                                {p.name}
                                {p.department ? ` · ${p.department}` : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        {HEAD_FLOWS.map(([flow, label]) => (
                          <td key={flow} className="border-t border-slate-100 px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              aria-label={`${dept}: ${label}`}
                              title={h.head_user_id ? '' : 'Pick a head first'}
                              className="h-4 w-4 accent-brand disabled:opacity-35"
                              disabled={!canEdit || !h.head_user_id}
                              checked={Boolean(h[flow])}
                              onChange={(e) => setHeadFlow(dept, flow, e.target.checked)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
              If the person asking is the head themselves, or the head is already their reporting manager, this step is skipped so nobody approves twice.
            </p>
          </section>

          <section aria-label="Claim submission rules" className={CARD}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
              <div>
                <h2 className="text-[14.5px] font-extrabold text-ink">Claim submission rules</h2>
                <p className="mt-0.5 text-[12.5px] text-slate-500">Apply to every claim.</p>
              </div>
              {changes.includes('SUBMISSION') ? <Pill tone="amber">Changed</Pill> : null}
            </div>
            <div className="grid grid-cols-1 gap-3 px-4 py-3.5 md:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-700">
                Submit within
                <input
                  type="number"
                  min="1"
                  className={FIELD}
                  disabled={!canEdit}
                  value={cfg.submission.max_working_days_after_return}
                  onChange={(e) =>
                    update((d) => {
                      d.submission.max_working_days_after_return = sanitizeMaxDays(e.target.value);
                      return d;
                    })
                  }
                />
                <span className="text-[11.5px] font-medium text-slate-500">Working days after the trip ends.</span>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-700">
                After the deadline
                <select
                  className={FIELD}
                  disabled={!canEdit}
                  value={cfg.submission.deadline_mode}
                  onChange={(e) =>
                    update((d) => {
                      d.submission.deadline_mode = e.target.value;
                      return d;
                    })
                  }
                >
                  <option value="hard_block">Block the claim</option>
                  <option value="soft_warning">Allow, with a warning</option>
                </select>
                <span className="text-[11.5px] font-medium text-slate-500">Whether a late claim can still be submitted.</span>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-700">
                Auto-approve up to
                <span className="relative block">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-bold text-slate-400">₹</span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    className={`${FIELD} pl-6`}
                    disabled={!canEdit}
                    value={cfg.auto_approve_below_amount}
                    onChange={(e) =>
                      update((d) => {
                        d.auto_approve_below_amount = e.target.value;
                        return d;
                      })
                    }
                    onBlur={(e) =>
                      update((d) => {
                        d.auto_approve_below_amount = sanitizeAutoApprove(e.target.value);
                        return d;
                      })
                    }
                  />
                </span>
                <span className="text-[11.5px] font-medium text-slate-500">
                  {Number(cfg.auto_approve_below_amount) > 0 ? 'Claims of this amount or less skip the approval steps.' : 'Off: ₹0 means every claim goes through the steps.'}
                </span>
              </label>
            </div>
          </section>
        </div>
      </div>

      {canEdit && changes.length ? (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+76px)] left-1/2 z-40 flex w-[min(720px,calc(100%-32px))] -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-[14px] bg-ink py-2.5 pl-4 pr-3 text-white shadow-[0_20px_40px_-16px_rgba(15,23,42,0.5)] md:bottom-4"
        >
          <div className="min-w-0">
            <b className="block text-[13px]">
              {changes.length} unsaved change{changes.length === 1 ? '' : 's'}
            </b>
            <span className="block truncate text-xs text-slate-300">
              {changes.slice(0, 4).map(changeName).join(', ')}
              {changes.length > 4 ? ` and ${changes.length - 4} more` : ''}
            </span>
          </div>
          <span className="flex gap-2">
            <button type="button" className={`${BTN_GHOST} border-slate-600 bg-transparent text-slate-200 hover:bg-white/10`} onClick={discard} disabled={saving}>
              Discard
            </button>
            <button
              type="button"
              className="inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-white bg-white px-[13px] text-[12.5px] font-bold text-ink hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmDrop)}
        title="Save anyway?"
        description={
          confirmDrop
            ? `After this save, ${confirmDrop.dropped.map((r) => ROLE_NAMES[r]).join(', ')} won't be on any approval step or exception route. Anyone with ${
                confirmDrop.dropped.length > 1 ? 'these roles' : 'this role'
              } loses Pending approvals and Exception requests entirely.`
            : ''
        }
        confirmLabel="Save anyway"
        confirmVariant="danger"
        onCancel={() => setConfirmDrop(null)}
        onConfirm={() => confirmDrop && doSave(confirmDrop.config)}
      />
    </section>
  );
}
