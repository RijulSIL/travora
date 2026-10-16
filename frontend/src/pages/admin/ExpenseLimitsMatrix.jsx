import { Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { BTN_GHOST, BTN_MAIN, CARD, ErrorNote, PolicyHead, Seg, VersionBar, useCanConfigurePolicy, usePolicyVersions } from '../../components/policy/PolicyAdminParts';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';

const FIELDS = [
  ['hotel', 'Hotel'],
  ['food', 'Food'],
  ['incidental', 'Incidentals'],
  ['day_visit', 'Day visit'],
];
const plain = (v) => (v == null || v === '' ? '' : String(Number(v)));
const changed = (a, b) => (a == null || a === '' ? null : Number(a)) !== (b == null || b === '' ? null : Number(b));

function CapCell({ label, value, strict, dirty, readOnly, onValue, onStrict }) {
  return (
    <div className={`flex items-center overflow-hidden rounded-[9px] border bg-white ${dirty ? 'border-amber-400 ring-2 ring-amber-400/20' : 'border-slate-200'}`}>
      <span className="pl-2.5 pr-1.5 text-xs text-slate-400">₹</span>
      <input
        aria-label={label}
        inputMode="decimal"
        readOnly={readOnly}
        className="h-8 w-full min-w-0 bg-transparent pr-1.5 text-right font-mono text-[12.5px] text-ink outline-none read-only:text-slate-700"
        placeholder="No cap"
        value={value}
        onChange={(e) => onValue(e.target.value)}
      />
      <button
        type="button"
        aria-label={`${label}: ${strict ? 'strict' : 'flagged'}`}
        aria-pressed={strict}
        disabled={readOnly}
        title={readOnly ? undefined : 'Switch between strict and flagged'}
        onClick={onStrict}
        className={`inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap border-l border-slate-200 px-2 text-[11px] font-extrabold disabled:cursor-default ${strict ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-400'}`}
      >
        {strict ? <Lock size={10} /> : null}
        {strict ? 'Strict' : 'Flagged'}
      </button>
    </div>
  );
}

export default function ExpenseLimitsMatrix() {
  useSetPageTitle('Expense Limits');
  const canConfigure = useCanConfigurePolicy();
  const { versions, version, versionId, setVersionId, error: versionsError } = usePolicyVersions();
  const [levels, setLevels] = useState([]);
  const [limits, setLimits] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [cities, setCities] = useState([]);
  const [tierCode, setTierCode] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [startEmpty, setStartEmpty] = useState({});
  const [loadError, setLoadError] = useState(null);
  const readOnly = !canConfigure || version?.status !== 'DRAFT';

  const load = async () => {
    if (!versionId) return;
    try {
      setLoadError(null);
      const [levelRes, limitRes, tierRes, cityRes] = await Promise.all([
        adminApi.impactLevels({ policy_version_id: versionId }),
        adminApi.expenseLimits({ policy_version_id: versionId }),
        adminApi.cityGroupTiers(),
        adminApi.cityGroups(),
      ]);
      setLevels(levelRes.data);
      setLimits(limitRes.data);
      setTiers(tierRes.data);
      setCities(cityRes.data);
      setTierCode((current) => current || tierRes.data[0]?.code || null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useEffect(() => {
    setDrafts({});
    setStartEmpty({});
    load();
  }, [versionId]);

  const byKey = useMemo(() => new Map(limits.map((l) => [`${l.impact_level_id}:${l.city_group}`, l])), [limits]);
  const sortedLevels = [...levels].sort((a, b) => a.level_code.localeCompare(b.level_code, undefined, { numeric: true }));
  const rowFor = (level, code) => {
    const key = `${level.id}:${code}`;
    return drafts[key] || byKey.get(key) || { policy_version_id: versionId, impact_level_id: level.id, city_group: code };
  };
  const edit = (level, code, patch) => {
    const key = `${level.id}:${code}`;
    const saved = byKey.get(key);
    // Caps are kept as typed text while editing ("3200", not the API's "3200.00").
    const base = saved
      ? { ...saved, ...Object.fromEntries(FIELDS.map(([f]) => [`${f}_cap`, plain(saved[`${f}_cap`])])) }
      : { policy_version_id: versionId, impact_level_id: level.id, city_group: code };
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] || base), ...patch } }));
  };
  const isDirty = (key, field) => {
    const d = drafts[key];
    if (!d) return false;
    const saved = byKey.get(key) || {};
    return changed(d[`${field}_cap`], saved[`${field}_cap`]) || Boolean(d[`${field}_is_hard_block`]) !== Boolean(saved[`${field}_is_hard_block`]);
  };
  const dirtyCount = Object.keys(drafts).reduce((n, key) => n + FIELDS.filter(([f]) => isDirty(key, f)).length, 0);
  const copyFrom = (source) =>
    sortedLevels.forEach((level) => {
      const from = rowFor(level, source);
      edit(level, tierCode, Object.fromEntries(FIELDS.flatMap(([f]) => [[`${f}_cap`, plain(from[`${f}_cap`])], [`${f}_is_hard_block`, Boolean(from[`${f}_is_hard_block`])]])));
    });

  const saveAction = useAsyncAction(async () => {
    const changedKeys = Object.keys(drafts).filter((key) => FIELDS.some(([f]) => isDirty(key, f)));
    await Promise.all(
      changedKeys.map((key) => {
        const limit = drafts[key];
        const payload = { ...limit, policy_version_id: versionId };
        FIELDS.forEach(([f]) => {
          payload[`${f}_cap`] = limit[`${f}_cap`] === '' || limit[`${f}_cap`] == null ? null : limit[`${f}_cap`];
          payload[`${f}_is_hard_block`] = Boolean(limit[`${f}_is_hard_block`]);
        });
        return limit.id ? adminApi.updateExpenseLimit(limit.id, payload) : adminApi.createExpenseLimit(payload);
      }),
    );
    setDrafts({});
    await load();
  });

  const tier = tiers.find((t) => t.code === tierCode);
  const tierHasCaps = (code) => limits.some((l) => l.city_group === code) || Object.values(drafts).some((d) => d.city_group === code);
  const showGrid = tier && (tierHasCaps(tier.code) || startEmpty[tier.code]);
  const tierCities = cities.filter((c) => c.group_type === tierCode).map((c) => c.city_name);
  const otherWithCaps = tiers.find((t) => t.code !== tierCode && limits.some((l) => l.city_group === t.code));

  return (
    <section className="flex flex-col gap-3.5 pb-2">
      <PolicyHead
        title="Expense limits"
        sub={
          <>
            The most each level can claim per expense, in each city group. <b>Strict</b> caps can&apos;t be exceeded without an exception; <b>Flagged</b> ones can, but are flagged for review.
          </>
        }
      />
      <VersionBar versions={versions} versionId={versionId} onSelect={setVersionId} canConfigure={canConfigure} />
      <ErrorNote error={versionsError || loadError || saveAction.error} />
      {tiers.length ? (
        <div className="overflow-x-auto">
          <Seg
            label="City group"
            value={tierCode}
            onChange={setTierCode}
            options={tiers.map((t) => ({ key: t.code, label: `${t.display_name}${t.is_deprecated ? ' (deprecated)' : ''}${tierHasCaps(t.code) ? '' : ' · not set'}` }))}
          />
        </div>
      ) : null}

      {tier && showGrid ? (
        <section aria-label={`Caps for ${tier.display_name}`} className={`${CARD} overflow-x-auto`}>
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[170px_repeat(4,minmax(150px,1fr))] items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-4 py-[9px] text-[11px] font-bold text-slate-500">
              <span>Level</span>
              {FIELDS.map(([f, label]) => (
                <span key={f}>
                  {label} <small className="font-medium text-slate-400">₹{readOnly ? '' : ' · click the tag to switch'}</small>
                </span>
              ))}
            </div>
            {sortedLevels.map((level) => {
              const key = `${level.id}:${tier.code}`;
              const row = rowFor(level, tier.code);
              return (
                <div key={level.id} className="grid grid-cols-[170px_repeat(4,minmax(150px,1fr))] items-center gap-2.5 border-t border-slate-100 px-4 py-2 first:border-t-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-11 shrink-0 rounded-lg bg-brand/10 py-[3px] text-center text-[12.5px] font-extrabold text-brand">{level.level_code}</span>
                    <span className="truncate text-xs text-slate-500" title={level.level_name}>
                      {level.level_name}
                    </span>
                  </span>
                  {FIELDS.map(([f, label]) => (
                    <CapCell
                      key={f}
                      label={`${level.level_code} ${label}`}
                      value={drafts[key] ? drafts[key][`${f}_cap`] ?? '' : plain(row[`${f}_cap`])}
                      strict={Boolean(row[`${f}_is_hard_block`])}
                      dirty={isDirty(key, f)}
                      readOnly={readOnly}
                      onValue={(v) => edit(level, tier.code, { [`${f}_cap`]: v })}
                      onStrict={() => edit(level, tier.code, { [`${f}_is_hard_block`]: !row[`${f}_is_hard_block`] })}
                    />
                  ))}
                </div>
              );
            })}
            {sortedLevels.length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-slate-500">Add impact levels to this version first.</p> : null}
          </div>
        </section>
      ) : null}

      {tier && !showGrid ? (
        <section className={`${CARD} px-4 py-8 text-center text-[13px] text-slate-500`}>
          <b className="mb-1 block text-sm text-ink">No caps set for {tier.display_name}</b>
          Cities in this group ({tierCities.length ? tierCities.join(', ') : 'none listed'}) have no hotel, food or day-visit limits yet.
          {!readOnly ? (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" className={BTN_MAIN} onClick={() => setStartEmpty((s) => ({ ...s, [tier.code]: true }))}>
                Set caps for this group
              </button>
              {otherWithCaps ? (
                <button type="button" className={BTN_GHOST} onClick={() => copyFrom(otherWithCaps.code)}>
                  Copy from {otherWithCaps.display_name}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {dirtyCount ? (
        <div role="status" className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2.5 rounded-xl bg-ink px-3.5 py-2.5 text-[13px] text-white shadow-[0_10px_24px_rgba(15,23,42,.25)]">
          <span>
            {dirtyCount} change{dirtyCount > 1 ? 's' : ''} not saved yet
          </span>
          <span className="flex gap-2">
            <button type="button" className={`${BTN_GHOST} h-7 rounded-lg px-2.5 text-[11.5px]`} onClick={() => setDrafts({})}>
              Undo
            </button>
            <button type="button" className={`${BTN_MAIN} h-7 rounded-lg px-2.5 text-[11.5px]`} disabled={saveAction.loading} onClick={() => saveAction.run().catch(() => {})}>
              {saveAction.loading ? 'Saving…' : 'Save changes'}
            </button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
