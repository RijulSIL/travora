import { ChevronRight, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Pill } from '../../components/approvals/ApprovalQueueParts';
import {
  BTN_MAIN,
  BTN_NO,
  CARD,
  Check,
  EYEBROW,
  ErrorNote,
  FIELD,
  LABEL,
  PolicyHead,
  Seg,
  Sheet,
  Toggle,
  VersionBar,
  useCanConfigurePolicy,
  usePolicyVersions,
} from '../../components/policy/PolicyAdminParts';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';

const emptyForm = {
  level_code: '',
  level_name: '',
  air_eligibility: 'NO',
  air_class_allowed: '',
  train_classes_allowed: [],
  local_conveyance_modes: ['Own Vehicle 4W', 'Own Vehicle 2W', 'Hired Taxi', 'Auto/Cab'],
  vehicle_rate_4w: '',
  vehicle_rate_2w: '',
  twin_sharing_mandatory: false,
};
const DEFAULT_MODES = emptyForm.local_conveyance_modes;
// PRD 2.2: "Train class(es) allowed: multi-select from 1AC, 2AC, 3AC, CC, EC, SL"
const TRAIN_CLASS_OPTIONS = ['1AC', '2AC', '3AC', 'CC', 'EC', 'SL'];
const normalizeTrainClass = (code) => {
  const upper = String(code).trim().toUpperCase();
  if (upper === '1A') return '1AC';
  if (upper === '2A') return '2AC';
  if (upper === '3A') return '3AC';
  return upper;
};
const AIR = { YES: ['Flights', 'ok'], CONDITIONAL: ['Flights with approval', 'amber'], NO: ['No flights', 'slate'] };
const AIR_CLASS = { ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Premium economy', BUSINESS: 'Business' };
const rate = (v) => (v == null || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const plain = (v) => (v == null || v === '' ? '' : String(Number(v)));
const toggle = (items, item) => (items.includes(item) ? items.filter((x) => x !== item) : [...items, item]);

function LevelSheet({ level, versionId, versionNumber, readOnly, modes, onSaved, onClose }) {
  const [form, setForm] = useState(emptyForm);
  const [airApprovalRequired, setAirApprovalRequired] = useState(false);
  const [extraMode, setExtraMode] = useState('');

  useEffect(() => {
    if (level) {
      setForm({
        ...emptyForm,
        ...level,
        air_class_allowed: level.air_class_allowed || '',
        vehicle_rate_4w: plain(level.vehicle_rate_4w),
        vehicle_rate_2w: plain(level.vehicle_rate_2w),
        train_classes_allowed: Array.from(new Set((level.train_classes_allowed || []).map(normalizeTrainClass))),
        local_conveyance_modes: level.local_conveyance_modes || [],
      });
      setAirApprovalRequired(Boolean(level.air_eligibility_conditions?.approval_required));
    } else {
      setForm(emptyForm);
      setAirApprovalRequired(false);
    }
  }, [level]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const saveAction = useAsyncAction(async () => {
    const payload = {
      ...form,
      policy_version_id: level ? level.policy_version_id : versionId,
      air_class_allowed: form.air_class_allowed || null,
      air_eligibility_conditions: { approval_required: airApprovalRequired },
      train_classes_allowed: form.train_classes_allowed || [],
      local_conveyance_modes: form.local_conveyance_modes,
      vehicle_rate_4w: form.vehicle_rate_4w || null,
      vehicle_rate_2w: form.vehicle_rate_2w || null,
    };
    delete payload.id;
    if (level) await adminApi.updateImpactLevel(level.id, payload);
    else await adminApi.createImpactLevel(payload);
    await onSaved(level ? level.id : null);
  });
  const deprecateAction = useAsyncAction(async () => {
    await adminApi.deprecateImpactLevel(level.id);
    await onSaved(level.id);
  });
  const allModes = Array.from(new Set([...modes, ...form.local_conveyance_modes]));

  return (
    <Sheet
      label="Level details"
      title={level ? `${readOnly ? '' : 'Edit '}${level.level_code} · ${level.level_name}` : 'Add a level'}
      sub={readOnly ? 'Read-only in this version' : `In draft ${versionNumber}`}
      onClose={level ? onClose : null}
      footer={
        readOnly ? null : (
          <>
            {level && !level.is_deprecated ? (
              <button type="button" className={BTN_NO} disabled={deprecateAction.loading} onClick={() => deprecateAction.run().catch(() => {})}>
                Deprecate
              </button>
            ) : null}
            <button type="button" className={BTN_MAIN} disabled={!form.level_code.trim() || !form.level_name.trim() || saveAction.loading} onClick={() => saveAction.run().catch(() => {})}>
              {saveAction.loading ? 'Saving…' : level ? 'Save level' : 'Add level'}
            </button>
          </>
        )
      }
    >
      <ErrorNote error={saveAction.error || deprecateAction.error} />
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={LABEL} htmlFor="lv-code">
            Code
          </label>
          <input id="lv-code" className={FIELD} readOnly={readOnly} placeholder="e.g. L7" value={form.level_code} onChange={(e) => set({ level_code: e.target.value })} />
        </div>
        <div>
          <label className={LABEL} htmlFor="lv-name">
            Name
          </label>
          <input id="lv-name" className={FIELD} readOnly={readOnly} placeholder="e.g. Intern" value={form.level_name} onChange={(e) => set({ level_name: e.target.value })} />
        </div>
      </div>
      <p className={EYEBROW}>Flights</p>
      <Seg
        label="Flights"
        disabled={readOnly}
        value={form.air_eligibility}
        onChange={(v) => set({ air_eligibility: v })}
        options={[
          { key: 'YES', label: 'Allowed' },
          { key: 'CONDITIONAL', label: 'With approval' },
          { key: 'NO', label: 'Not allowed' },
        ]}
      />
      <div>
        <label className={LABEL} htmlFor="lv-class">
          Class
        </label>
        <select id="lv-class" className={FIELD} disabled={readOnly} value={form.air_class_allowed || ''} onChange={(e) => set({ air_class_allowed: e.target.value })}>
          <option value="">No air class</option>
          <option value="ECONOMY">Economy</option>
          <option value="PREMIUM_ECONOMY">Premium economy</option>
          <option value="BUSINESS">Business</option>
        </select>
      </div>
      <Check checked={airApprovalRequired} onChange={setAirApprovalRequired} disabled={readOnly} title="Flights need manager approval" hint="Asks the manager before a flight is booked" />
      <p className={EYEBROW}>Trains</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Train classes">
        {TRAIN_CLASS_OPTIONS.map((c) => (
          <Toggle key={c} on={form.train_classes_allowed.includes(c)} disabled={readOnly} onClick={() => set({ train_classes_allowed: toggle(form.train_classes_allowed, c) })}>
            {c}
          </Toggle>
        ))}
      </div>
      <p className={EYEBROW}>Local travel</p>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Local travel">
        {allModes.map((m) => (
          <Toggle key={m} on={form.local_conveyance_modes.includes(m)} disabled={readOnly} onClick={() => set({ local_conveyance_modes: toggle(form.local_conveyance_modes, m) })}>
            {m}
          </Toggle>
        ))}
        {!readOnly ? (
          <input
            aria-label="Add a local travel mode"
            className={`${FIELD} h-7 w-[150px] text-xs`}
            placeholder="Another mode, then Enter"
            value={extraMode}
            onChange={(e) => setExtraMode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const m = extraMode.trim();
              if (m && !form.local_conveyance_modes.includes(m)) set({ local_conveyance_modes: [...form.local_conveyance_modes, m] });
              setExtraMode('');
            }}
          />
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={LABEL} htmlFor="lv-4w">
            Own car <small className="font-medium text-slate-400">₹ per km</small>
          </label>
          <input id="lv-4w" inputMode="decimal" className={`${FIELD} font-mono`} readOnly={readOnly} value={form.vehicle_rate_4w} onChange={(e) => set({ vehicle_rate_4w: e.target.value })} />
        </div>
        <div>
          <label className={LABEL} htmlFor="lv-2w">
            Two-wheeler <small className="font-medium text-slate-400">₹ per km</small>
          </label>
          <input id="lv-2w" inputMode="decimal" className={`${FIELD} font-mono`} readOnly={readOnly} value={form.vehicle_rate_2w} onChange={(e) => set({ vehicle_rate_2w: e.target.value })} />
        </div>
      </div>
      <p className={EYEBROW}>Stay</p>
      <Check checked={Boolean(form.twin_sharing_mandatory)} onChange={(v) => set({ twin_sharing_mandatory: v })} disabled={readOnly} title="Twin sharing" hint="Hotel rooms are shared" />
    </Sheet>
  );
}

export default function ImpactLevelMaster() {
  useSetPageTitle('Impact Levels');
  const canConfigure = useCanConfigurePolicy();
  const { versions, version, versionId, setVersionId, error: versionsError } = usePolicyVersions();
  const [levels, setLevels] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const readOnly = !canConfigure || version?.status !== 'DRAFT';

  const load = async () => {
    if (!versionId) return;
    try {
      setLoadError(null);
      setLevels((await adminApi.impactLevels({ policy_version_id: versionId })).data);
    } catch (err) {
      setLoadError(err);
    }
  };
  useEffect(() => {
    setSelected(null);
    load();
  }, [versionId]);

  const onSaved = async (id) => {
    await load();
    setSelected(id);
  };
  const level = levels.find((l) => l.id === selected) || null;
  const modes = Array.from(new Set([...DEFAULT_MODES, ...levels.flatMap((l) => l.local_conveyance_modes || [])]));
  const sorted = [...levels].sort((a, b) => a.level_code.localeCompare(b.level_code, undefined, { numeric: true }));

  return (
    <section className="flex flex-col gap-3.5">
      <PolicyHead title="Impact levels" sub="What each employee level may book: flights, train classes, local travel, per-km rates and whether hotel rooms are shared.">
        {!readOnly ? (
          <button type="button" className={BTN_MAIN} onClick={() => setSelected(null)}>
            <Plus size={15} />
            Add level
          </button>
        ) : null}
      </PolicyHead>
      <VersionBar versions={versions} versionId={versionId} onSelect={setVersionId} canConfigure={canConfigure} />
      <ErrorNote error={versionsError || loadError} />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Levels" className={CARD}>
          <div className="hidden grid-cols-[54px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_120px_16px] gap-3 bg-slate-50 px-4 py-[9px] text-[11px] font-bold text-slate-500 md:grid">
            <span>Level</span>
            <span>Name</span>
            <span>Flights</span>
            <span>Trains</span>
            <span className="text-right">₹/km car · 2W</span>
            <span />
          </div>
          {sorted.map((l) => {
            const [airLabel, airTone] = AIR[l.air_eligibility] || AIR.NO;
            const on = l.id === selected;
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(l.id)}
                className={`grid w-full grid-cols-[54px_minmax(0,1fr)_16px] items-center gap-3 border-t border-slate-100 px-4 py-[11px] text-left first:border-t-0 hover:bg-[#fbfdfc] md:grid-cols-[54px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_120px_16px] ${on ? 'bg-[#f4faf7] shadow-[inset_3px_0_0] shadow-brand' : ''}`}
              >
                <span className="rounded-lg bg-brand/10 py-[3px] text-center text-[12.5px] font-extrabold text-brand">{l.level_code}</span>
                <span className="min-w-0">
                  <b className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink">
                    {l.level_name}
                    {l.is_deprecated ? <Pill>Deprecated</Pill> : null}
                  </b>
                  <span className="block text-xs text-slate-500">
                    {l.twin_sharing_mandatory ? 'Twin sharing · ' : ''}
                    {(l.local_conveyance_modes || []).length} local modes
                  </span>
                </span>
                <span className="hidden md:block">
                  <Pill tone={airTone}>{airLabel}</Pill>
                  {l.air_class_allowed ? <span className="block text-xs text-slate-500">{AIR_CLASS[l.air_class_allowed]}</span> : null}
                </span>
                <span className="hidden flex-wrap gap-1 md:flex">
                  {(l.train_classes_allowed || []).map((t) => (
                    <Pill key={t}>{normalizeTrainClass(t)}</Pill>
                  ))}
                </span>
                <span className="hidden text-right font-mono text-[12.5px] text-ink md:block">
                  {rate(l.vehicle_rate_4w)} · {rate(l.vehicle_rate_2w)}
                </span>
                <ChevronRight size={15} className="text-slate-400" />
              </button>
            );
          })}
          {versionId && levels.length === 0 && !loadError ? <p className="px-4 py-6 text-center text-[13px] text-slate-500">No levels in this version yet.</p> : null}
        </section>
        {readOnly && !level ? (
          <aside className={`${CARD} px-4 py-6 text-center text-[13px] text-slate-500`}>Pick a level to see everything it allows.</aside>
        ) : (
          <LevelSheet level={level} versionId={versionId} versionNumber={version?.version_number} readOnly={readOnly} modes={modes} onSaved={onSaved} onClose={() => setSelected(null)} />
        )}
      </div>
    </section>
  );
}
