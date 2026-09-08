import { Save, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { canEditPolicy } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

const emptyForm = {
  city_name: '',
  group_type: 'C',
  effective_from: '2026-04-27',
  effective_to: '',
};

export default function CityGroupClassification() {
  useSetPageTitle('City Groups');
  const [cities, setCities] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const role = useAuthStore((state) => state.user?.role);
  const isViewOnly = !canEditPolicy(role);

  const load = async () => {
    try {
      setLoadError(null);
      setCities((await adminApi.cityGroups()).data);
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
    setForm(emptyForm);
    setEditingId(null);
    await load();
  });
  const deleteAction = useAsyncAction(async (id) => {
    await adminApi.deleteCityGroup(id);
    await load();
  });
  const error = loadError || saveAction.error || deleteAction.error;

  const grouped = ['A', 'B', 'C'].map((group) => ({
    group,
    rows: cities.filter((city) => city.group_type === group),
  }));

  return (
    <>
      {error ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}
      <section className="panel rounded-lg p-6 shadow-sm border border-slate-100 mb-6">
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
              <option>A</option>
              <option>B</option>
              <option>C</option>
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
        {grouped.map(({ group, rows }) => (
          <section key={group} className="panel rounded-lg shadow-sm border border-slate-100 overflow-hidden flex flex-col bg-white">
            <div className="bg-slate-50/80 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">Tier {group} Cities</h3>
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
