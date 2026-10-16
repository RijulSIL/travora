import { ChevronRight, Plus, Search, Star } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Pill } from '../../components/approvals/ApprovalQueueParts';
import {
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
  Seg,
  Sheet,
  fmtDate,
  todayIso,
  useCanConfigurePolicy,
} from '../../components/policy/PolicyAdminParts';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';

const emptyCity = (groupType) => ({ city_name: '', group_type: groupType, effective_from: todayIso(), effective_to: '' });

function CitySheet({ city, tiers, tierCode, readOnly, onSaved, onClose }) {
  const activeTiers = tiers.filter((t) => !t.is_deprecated);
  const [form, setForm] = useState(emptyCity(tierCode));
  useEffect(() => {
    const usable = tiers.filter((t) => !t.is_deprecated);
    setForm(city ? { ...city, effective_to: city.effective_to || '' } : emptyCity(usable.some((t) => t.code === tierCode) ? tierCode : usable[0]?.code || ''));
  }, [city, tierCode, tiers]);
  // A classification can't change once its start date has arrived (the backend locks it), so
  // only future-dated ones are editable.
  const locked = Boolean(city) && city.effective_from <= todayIso();
  const ro = readOnly || locked;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const tierName = (code) => tiers.find((t) => t.code === code)?.display_name || code;

  const saveAction = useAsyncAction(async () => {
    const payload = { city_name: form.city_name.trim(), group_type: form.group_type, effective_from: form.effective_from, effective_to: form.effective_to || null };
    if (city) await adminApi.updateCityGroup(city.id, payload);
    else await adminApi.createCityGroup(payload);
    await onSaved();
  });
  const deleteAction = useAsyncAction(async () => {
    await adminApi.deleteCityGroup(city.id);
    await onSaved();
  });

  return (
    <Sheet
      label="City details"
      title={city ? city.city_name : 'Add a city'}
      sub={city ? `In ${tierName(city.group_type)}` : 'Put a city in a group'}
      onClose={city ? onClose : null}
      footer={
        ro ? null : (
          <>
            {city ? (
              <button type="button" className={BTN_NO} disabled={deleteAction.loading} onClick={() => deleteAction.run().catch(() => {})}>
                Remove
              </button>
            ) : null}
            <button type="button" className={BTN_MAIN} disabled={!form.city_name.trim() || !form.group_type || !form.effective_from || saveAction.loading} onClick={() => saveAction.run().catch(() => {})}>
              {saveAction.loading ? 'Saving…' : city ? 'Save city' : 'Add city'}
            </button>
          </>
        )
      }
    >
      <ErrorNote error={saveAction.error || deleteAction.error} />
      {locked && !readOnly ? (
        <p className="rounded-[10px] border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          This has been in use since {fmtDate(city.effective_from)}, so it can&apos;t be changed or removed.
        </p>
      ) : null}
      <div>
        <label className={LABEL} htmlFor="city-name">
          City
        </label>
        <input id="city-name" className={FIELD} readOnly={ro} placeholder="e.g. Nagpur" value={form.city_name} onChange={(e) => set({ city_name: e.target.value })} />
      </div>
      <div>
        <span className={LABEL}>Group</span>
        <Seg label="Group" disabled={ro} value={form.group_type} onChange={(v) => set({ group_type: v })} options={(ro ? tiers : activeTiers).map((t) => ({ key: t.code, label: t.code }))} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={LABEL} htmlFor="city-from">
            From
          </label>
          <input id="city-from" type="date" className={FIELD} readOnly={ro} value={form.effective_from} onChange={(e) => set({ effective_from: e.target.value })} />
        </div>
        <div>
          <label className={LABEL} htmlFor="city-to">
            Until <small className="font-medium text-slate-400">(optional)</small>
          </label>
          <input id="city-to" type="date" className={FIELD} readOnly={ro} value={form.effective_to} onChange={(e) => set({ effective_to: e.target.value })} />
        </div>
      </div>
    </Sheet>
  );
}

function NewTierSheet({ onSaved, onClose }) {
  const [form, setForm] = useState({ code: '', display_name: '' });
  const addAction = useAsyncAction(async () => {
    await adminApi.createCityGroupTier({ code: form.code.trim(), display_name: form.display_name.trim() });
    await onSaved(form.code.trim());
  });
  return (
    <Sheet
      label="New group"
      title="New group"
      sub="Cities in it get their own caps on Expense limits"
      onClose={onClose}
      footer={
        <button type="button" className={BTN_MAIN} disabled={!form.code.trim() || !form.display_name.trim() || addAction.loading} onClick={() => addAction.run().catch(() => {})}>
          {addAction.loading ? 'Adding…' : 'Add group'}
        </button>
      }
    >
      <ErrorNote error={addAction.error} />
      <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2.5">
        <div>
          <label className={LABEL} htmlFor="tier-code">
            Code
          </label>
          <input id="tier-code" className={FIELD} placeholder="e.g. D" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </div>
        <div>
          <label className={LABEL} htmlFor="tier-name">
            Name
          </label>
          <input id="tier-name" className={FIELD} placeholder="e.g. Group D — Smaller towns" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </div>
      </div>
      <p className="text-xs text-slate-500">The code can&apos;t be changed later; the name can.</p>
    </Sheet>
  );
}

export default function CityGroupClassification() {
  useSetPageTitle('City Groups');
  const isViewOnly = !useCanConfigurePolicy();
  const [cities, setCities] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [tierCode, setTierCode] = useState(null);
  const [cityId, setCityId] = useState(null);
  const [query, setQuery] = useState('');
  const [newTier, setNewTier] = useState(false);
  const [rename, setRename] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = async () => {
    try {
      setLoadError(null);
      const [cityRes, tierRes] = await Promise.all([adminApi.cityGroups(), adminApi.cityGroupTiers()]);
      setCities(cityRes.data);
      setTiers(tierRes.data);
      setTierCode((current) => current || tierRes.data.find((t) => !t.is_deprecated)?.code || tierRes.data[0]?.code || null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useEffect(() => {
    load();
  }, []);

  // Every tier write carries BOTH display_name and is_default (the backend's update schema
  // requires both together) — this merges in just the field a given action changes.
  const saveTier = (tier, overrides) => adminApi.updateCityGroupTier(tier.id, { display_name: tier.display_name, is_default: tier.is_default, ...overrides });
  const renameAction = useAsyncAction(async (tier, name) => {
    await saveTier(tier, { display_name: name });
    setRename(null);
    await load();
  });
  const defaultAction = useAsyncAction(async (tier) => {
    await saveTier(tier, { is_default: true });
    await load();
  });
  const deprecateAction = useAsyncAction(async (tier) => {
    await adminApi.deprecateCityGroupTier(tier.id);
    await load();
  });
  const error = loadError || renameAction.error || defaultAction.error || deprecateAction.error;

  const tier = tiers.find((t) => t.code === tierCode);
  const inTier = cities.filter((c) => c.group_type === tierCode);
  const q = query.trim().toLowerCase();
  const shown = inTier.filter((c) => !q || c.city_name.toLowerCase().includes(q)).sort((a, b) => a.city_name.localeCompare(b.city_name));
  const city = cities.find((c) => c.id === cityId) || null;

  return (
    <section className="flex flex-col gap-3.5">
      <PolicyHead title="City groups" sub="Which group each city is in decides the hotel, food and day-visit caps there. A city that isn't listed falls into the default group.">
        {!isViewOnly ? (
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() => {
              setNewTier(true);
              setCityId(null);
            }}
          >
            <Plus size={15} />
            New group
          </button>
        ) : null}
      </PolicyHead>
      <ErrorNote error={error} />

      <div role="group" aria-label="Groups" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {tiers.map((t) => {
          const n = cities.filter((c) => c.group_type === t.code).length;
          const on = t.code === tierCode;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setTierCode(t.code);
                setCityId(null);
                setRename(null);
              }}
              className={`flex flex-col gap-1 rounded-[14px] border bg-white px-3.5 py-3 text-left ${on ? 'border-brand bg-[#f4faf7] ring-1 ring-inset ring-brand' : 'border-slate-200 hover:bg-slate-50'}`}
            >
              <span className="flex items-center justify-between gap-1.5">
                <b className="text-[13px] text-ink">{t.display_name}</b>
                <Pill>{t.code}</Pill>
              </span>
              <span className="text-xl font-bold text-ink">{n}</span>
              <span className="text-xs text-slate-500">
                {n === 1 ? 'city' : 'cities'}
                {t.is_default ? (
                  <b className="text-amber-700">
                    {' '}
                    · <Star size={11} className="inline -translate-y-px fill-current" /> Default for unlisted cities
                  </b>
                ) : null}
                {t.is_deprecated ? ' · Deprecated' : ''}
              </span>
            </button>
          );
        })}
      </div>

      {tier ? (
        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-label={tier.display_name} className={CARD}>
            <CardHead title={tier.display_name} sub={tier.is_default ? 'Default group: every city not listed anywhere lands here too' : `${inTier.length} ${inTier.length === 1 ? 'city' : 'cities'}`}>
              <label className="relative">
                <span className="sr-only">Search cities</span>
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className={`${FIELD} h-8 w-[200px] pl-8`} placeholder="Search cities" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              {!isViewOnly && !tier.is_default && !tier.is_deprecated ? (
                <button type="button" className={BTN_SM} disabled={defaultAction.loading} onClick={() => defaultAction.run(tier).catch(() => {})}>
                  <Star size={12} />
                  Make default
                </button>
              ) : null}
              {!isViewOnly && rename == null ? (
                <button type="button" className={BTN_SM} onClick={() => setRename(tier.display_name)}>
                  Rename
                </button>
              ) : null}
              {!isViewOnly && !tier.is_default && !tier.is_deprecated ? (
                <button type="button" className={`${BTN_SM} text-rose-700`} disabled={deprecateAction.loading} title="Stops it being offered for new cities; existing ones keep it" onClick={() => deprecateAction.run(tier).catch(() => {})}>
                  Deprecate
                </button>
              ) : null}
            </CardHead>
            {rename != null ? (
              <form
                className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  renameAction.run(tier, rename.trim()).catch(() => {});
                }}
              >
                <label className="sr-only" htmlFor="tier-rename">
                  Group name
                </label>
                <input id="tier-rename" className={`${FIELD} h-8 max-w-[320px] flex-1`} value={rename} onChange={(e) => setRename(e.target.value)} autoFocus />
                <button type="submit" className={`${BTN_MAIN} h-8`} disabled={!rename.trim() || rename.trim() === tier.display_name || renameAction.loading}>
                  Save name
                </button>
                <button type="button" className={`${BTN_GHOST} h-8`} onClick={() => setRename(null)}>
                  Cancel
                </button>
              </form>
            ) : null}
            {shown.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={c.id === cityId}
                    onClick={() => {
                      setCityId(c.id);
                      setNewTier(false);
                    }}
                    className={`flex items-center justify-between gap-2 border-r border-t border-slate-100 px-4 py-2.5 text-left hover:bg-[#fbfdfc] ${c.id === cityId ? 'bg-[#f4faf7]' : ''}`}
                  >
                    <span className="min-w-0">
                      <b className="block truncate text-[13px] text-ink">{c.city_name}</b>
                      <span className="text-xs text-slate-500">
                        since {fmtDate(c.effective_from)}
                        {c.effective_to ? ` · until ${fmtDate(c.effective_to)}` : ''}
                      </span>
                    </span>
                    <ChevronRight size={14} className="shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-4 py-7 text-center text-[13px] text-slate-500">
                {q ? 'No city matches that search.' : tier.is_default ? 'No city is listed here by name. Every unlisted city still falls into this group.' : 'No cities in this group yet.'}
              </p>
            )}
          </section>
          {newTier && !isViewOnly ? (
            <NewTierSheet
              onClose={() => setNewTier(false)}
              onSaved={async (code) => {
                setNewTier(false);
                await load();
                setTierCode(code);
              }}
            />
          ) : isViewOnly && !city ? (
            <aside className={`${CARD} px-4 py-6 text-center text-[13px] text-slate-500`}>Pick a city to see its details.</aside>
          ) : (
            <CitySheet
              city={city}
              tiers={tiers}
              tierCode={tierCode}
              readOnly={isViewOnly}
              onClose={() => setCityId(null)}
              onSaved={async () => {
                setCityId(null);
                await load();
              }}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}
