import { Save, Star, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { hasPermission } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

const emptyForm = {
  city_name: '',
  group_type: '',
  effective_from: '2026-04-27',
  effective_to: '',
};

const emptyTierForm = { code: '', display_name: '' };

export default function CityGroupClassification() {
  useSetPageTitle('City Groups');
  const [cities, setCities] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [tierForm, setTierForm] = useState(emptyTierForm);
  // In-progress display-name edits per tier id, before "Save" is clicked.
  const [tierNameDrafts, setTierNameDrafts] = useState({});
  const [loadError, setLoadError] = useState(null);
  // The actual configure_policy permission, not a hardcoded role list — see ImpactLevelMaster.jsx.
  const permissions = useAuthStore((state) => state.profile?.permissions);
  const isViewOnly = !hasPermission(permissions, 'configure_policy');

  const load = async () => {
    try {
      setLoadError(null);
      const [cityRes, tierRes] = await Promise.all([adminApi.cityGroups(), adminApi.cityGroupTiers()]);
      setCities(cityRes.data);
      setTiers(tierRes.data);
      setForm((current) => (current.group_type ? current : { ...current, group_type: tierRes.data.find((t) => !t.is_deprecated)?.code || '' }));
    } catch (error) {
      setLoadError(error);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const saveAction = useAsyncAction(async () => {
    const payload = { ...form, effective_to: form.effective_to || null };
    if (editingId) await adminApi.updateCityGroup(editingId, payload);
    else await adminApi.createCityGroup(payload);
    setForm({ ...emptyForm, group_type: form.group_type });
    setEditingId(null);
    await load();
  });
  const deleteAction = useAsyncAction(async (id) => {
    await adminApi.deleteCityGroup(id);
    await load();
  });

  // Every tier write carries BOTH display_name and is_default (the backend's update schema
  // requires both together) — this merges in just the field a given action actually changes.
  const saveTier = (tier, overrides) =>
    adminApi.updateCityGroupTier(tier.id, {
      display_name: tier.display_name,
      is_default: tier.is_default,
      ...overrides,
    });
  const renameTierAction = useAsyncAction(async (tier) => {
    await saveTier(tier, { display_name: tierNameDrafts[tier.id] });
    setTierNameDrafts((current) => {
      const next = { ...current };
      delete next[tier.id];
      return next;
    });
    await load();
  });
  const setDefaultTierAction = useAsyncAction(async (tier) => {
    await saveTier(tier, { is_default: true });
    await load();
  });
  const deprecateTierAction = useAsyncAction(async (tierId) => {
    await adminApi.deprecateCityGroupTier(tierId);
    await load();
  });
  const addTierAction = useAsyncAction(async () => {
    await adminApi.createCityGroupTier(tierForm);
    setTierForm(emptyTierForm);
    await load();
  });

  const error =
    loadError ||
    saveAction.error ||
    deleteAction.error ||
    renameTierAction.error ||
    setDefaultTierAction.error ||
    deprecateTierAction.error ||
    addTierAction.error;

  const activeTiers = tiers.filter((tier) => !tier.is_deprecated);
  // Deprecated tiers still get a column below so existing city assignments to them stay visible
  // — only the "Add New City" dropdown and the "set as default" action exclude them.
  const grouped = tiers.map((tier) => ({
    tier,
    rows: cities.filter((city) => city.group_type === tier.code),
  }));

  return (
    <>
      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}

      <section className="panel p-6 mb-6">
        <div className="mb-5 border-b border-line pb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">City Group Tiers</h2>
            <p className="text-sm text-slate-500 mt-1">Add as many tiers as you need. The default tier is what an unclassified city falls back to.</p>
          </div>
          {isViewOnly ? <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">View Only</span> : null}
        </div>
        <div className="divide-y divide-slate-100">
          {tiers.map((tier) => {
            const draft = tierNameDrafts[tier.id] ?? tier.display_name;
            const dirty = draft !== tier.display_name;
            return (
              <div key={tier.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="inline-flex items-center justify-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 min-w-[3rem] text-center">{tier.code}</span>
                <input
                  className="field flex-1 min-w-48 text-slate-900"
                  readOnly={isViewOnly}
                  value={draft}
                  onChange={(event) => setTierNameDrafts({ ...tierNameDrafts, [tier.id]: event.target.value })}
                />
                {dirty && !isViewOnly ? (
                  <button className="btn-secondary h-8 px-3 text-[11px] font-bold" onClick={() => renameTierAction.run(tier)} disabled={renameTierAction.loading}>
                    <Save size={14} />Save
                  </button>
                ) : null}
                <button
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${tier.is_default ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                  disabled={isViewOnly || tier.is_default || tier.is_deprecated}
                  onClick={() => setDefaultTierAction.run(tier)}
                  title={tier.is_default ? 'Default tier' : 'Set as default'}
                >
                  <Star size={12} fill={tier.is_default ? 'currentColor' : 'none'} />
                  {tier.is_default ? 'Default' : 'Set default'}
                </button>
                {tier.is_deprecated ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">Deprecated</span>
                ) : !isViewOnly ? (
                  <button
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    onClick={() => deprecateTierAction.run(tier.id)}
                    disabled={deprecateTierAction.loading || tier.is_default}
                    title={tier.is_default ? "Can't deprecate the default tier" : 'Deprecate'}
                  >
                    <Trash size={16} />
                  </button>
                ) : null}
              </div>
            );
          })}
          {tiers.length === 0 ? <div className="py-4 text-center text-sm text-slate-400 italic">No tiers configured yet.</div> : null}
        </div>
        {!isViewOnly ? (
          <div className="mt-4 grid gap-3 md:grid-cols-12 items-end border-t border-line pt-4">
            <div className="md:col-span-3">
              <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">New Tier Code</label>
              <input className="field w-full text-slate-900" placeholder="e.g. D" value={tierForm.code} onChange={(event) => setTierForm({ ...tierForm, code: event.target.value })} />
            </div>
            <div className="md:col-span-6">
              <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">Display Name</label>
              <input className="field w-full text-slate-900" placeholder="e.g. Tier D — Smaller Towns" value={tierForm.display_name} onChange={(event) => setTierForm({ ...tierForm, display_name: event.target.value })} />
            </div>
            <div className="md:col-span-3">
              <button className="btn-primary w-full justify-center h-10 shadow-sm" onClick={addTierAction.run} disabled={addTierAction.loading || !tierForm.code.trim() || !tierForm.display_name.trim()}>
                {addTierAction.loading ? 'Adding…' : 'Add Tier'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel p-6 mb-6">
        <div className="mb-5 border-b border-line pb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{editingId ? 'Edit City Classification' : 'Add New City'}</h2>
          {isViewOnly ? <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">View Only</span> : null}
        </div>

        <div className="grid gap-5 md:grid-cols-12 items-end">
          <div className="md:col-span-3">
            <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">City Name</label>
            <input className="field w-full text-slate-900" readOnly={isViewOnly} placeholder="e.g. Mumbai" value={form.city_name} onChange={(event) => setForm({ ...form, city_name: event.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">Group</label>
            <select className="field w-full text-slate-900" disabled={isViewOnly} value={form.group_type} onChange={(event) => setForm({ ...form, group_type: event.target.value })}>
              {activeTiers.map((tier) => (
                <option key={tier.id} value={tier.code}>{tier.code}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">Effective From</label>
            <input className="field w-full text-slate-900" readOnly={isViewOnly} type="date" value={form.effective_from} onChange={(event) => setForm({ ...form, effective_from: event.target.value })} />
          </div>
          <div className="md:col-span-3">
            <label className="mb-1.5 block text-[12px] font-bold text-slate-600 uppercase tracking-wider">Effective To</label>
            <input className="field w-full text-slate-900" readOnly={isViewOnly} type="date" value={form.effective_to} onChange={(event) => setForm({ ...form, effective_to: event.target.value })} />
          </div>
          <div className="md:col-span-1">
            {!isViewOnly ? <button className="btn-primary w-full justify-center h-10 shadow-sm" onClick={saveAction.run} disabled={saveAction.loading}><Save size={16} />{saveAction.loading ? '' : 'Save'}</button> : null}
          </div>
        </div>
      </section>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {grouped.map(({ tier, rows }) => (
          <section key={tier.id} className="panel overflow-hidden flex flex-col">
            <div className="bg-slate-50/80 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">{tier.display_name}{tier.is_deprecated ? ' (Deprecated)' : ''}</h3>
              <span className="bg-white text-slate-600 text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-sm border border-slate-200/60">{rows.length} cities</span>
            </div>
            <div className="divide-y divide-slate-100 flex-1 overflow-auto max-h-[500px]">
              {rows.map((city) => (
                <div
                  key={city.id}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-sm hover:bg-slate-50 transition-colors group"
                >
                  <button
                    disabled={isViewOnly}
                    className="flex flex-1 flex-col items-start text-left"
                    onClick={() => {
                      setForm({ ...city, effective_to: city.effective_to || '' });
                      setEditingId(city.id);
                    }}
                  >
                    <span className="font-bold text-slate-900 group-hover:text-brand transition-colors">{city.city_name}</span>
                    <span className="text-[11px] text-slate-500 font-medium mt-0.5">Since {city.effective_from}</span>
                  </button>
                  {!isViewOnly ? (
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 opacity-0 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
                      onClick={(e) => { e.stopPropagation(); deleteAction.run(city.id); }}
                      disabled={deleteAction.loading}
                      title="Delete"
                    >
                      <Trash size={16} />
                    </button>
                  ) : null}
                </div>
              ))}
              {rows.length === 0 && <div className="p-6 text-center text-sm text-slate-400 italic">No cities classified in this tier.</div>}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
