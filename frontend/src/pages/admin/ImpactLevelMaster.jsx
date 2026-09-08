import { Plus, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { canEditPolicy } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

const emptyForm = {
  level_code: '',
  level_name: '',
  air_eligibility: 'NO',
  air_class_allowed: '',
  air_eligibility_conditions: {},
  train_classes_allowed: [],
  local_conveyance_modes: [],
  vehicle_rate_4w: '',
  vehicle_rate_2w: '',
  twin_sharing_mandatory: false,
  policy_version_id: null,
};

const defaultTrainClasses = '3A,CC,SL';
const defaultConveyanceModes = 'Own Vehicle 4W,Own Vehicle 2W,Hired Taxi,Auto/Cab';

export default function ImpactLevelMaster() {
  useSetPageTitle('Impact Levels');
  const [searchParams, setSearchParams] = useSearchParams();
  const [levels, setLevels] = useState([]);
  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [airApprovalRequired, setAirApprovalRequired] = useState(false);
  const [trainClassesText, setTrainClassesText] = useState(defaultTrainClasses);
  const [conveyanceText, setConveyanceText] = useState(defaultConveyanceModes);
  const [editingId, setEditingId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const role = useAuthStore((state) => state.user?.role);
  const selectedVersion = versions.find((v) => String(v.id) === String(selectedVersionId));
  const isViewOnly = !canEditPolicy(role) || (selectedVersionId && selectedVersion?.status !== 'DRAFT');

  const load = async () => {
    try {
      setLoadError(null);
      const [versionsResponse, levelsResponse] = await Promise.all([
        adminApi.policyVersions(),
        selectedVersionId
          ? adminApi.impactLevels({ policy_version_id: Number(selectedVersionId) })
          : adminApi.impactLevels(),
      ]);
      setVersions(versionsResponse.data);
      setLevels(levelsResponse.data);
      if (!selectedVersionId) {
        const firstDraft = versionsResponse.data.find((version) => version.status === 'DRAFT');
        if (firstDraft) {
          setSelectedVersionId(String(firstDraft.id));
        }
      }
    } catch (error) {
      setLoadError(error);
    }
  };
  useEffect(() => {
    if (!selectedVersionId) {
      const versionFromQuery = searchParams.get('versionId');
      if (versionFromQuery) {
        setSelectedVersionId(versionFromQuery);
      }
    }
  }, [searchParams, selectedVersionId]);
  useEffect(() => {
    load();
  }, [selectedVersionId]);

  useEffect(() => {
    if (selectedVersionId) {
      const next = new URLSearchParams(searchParams);
      next.set('versionId', selectedVersionId);
      setSearchParams(next, { replace: true });
      setForm((current) => ({ ...current, policy_version_id: Number(selectedVersionId) }));
    }
  }, [searchParams, selectedVersionId, setSearchParams]);

  const resetForm = () => {
    setForm({
      ...emptyForm,
      policy_version_id: selectedVersionId ? Number(selectedVersionId) : null,
    });
    setAirApprovalRequired(false);
    setTrainClassesText(defaultTrainClasses);
    setConveyanceText(defaultConveyanceModes);
    setEditingId(null);
  };

  const saveAction = useAsyncAction(async () => {
    if (!selectedVersionId) {
      throw new Error('Select a draft policy version first');
    }
    const trainClassesAllowed = trainClassesText
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const localConveyanceModes = conveyanceText
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const payload = {
      ...form,
      policy_version_id: Number(selectedVersionId),
      air_class_allowed: form.air_class_allowed || null,
      air_eligibility_conditions: { approval_required: airApprovalRequired },
      train_classes_allowed: trainClassesAllowed,
      local_conveyance_modes: localConveyanceModes,
      vehicle_rate_4w: form.vehicle_rate_4w || null,
      vehicle_rate_2w: form.vehicle_rate_2w || null,
    };
    if (editingId) await adminApi.updateImpactLevel(editingId, payload);
    else await adminApi.createImpactLevel(payload);
    resetForm();
    await load();
  });
  const deprecateAction = useAsyncAction(async (id) => {
    await adminApi.deprecateImpactLevel(id);
    await load();
  });
  const error = loadError || saveAction.error || deprecateAction.error;

  return (
    <>
      <PageHeader
        title=""
        actions={
          <>
            {isViewOnly ? <span className="badge bg-slate-100 text-slate-700">View Only</span> : null}
            {!isViewOnly ? (
              <button type="button" className="btn-secondary" onClick={resetForm}>
                <Plus size={17} />Add Level
              </button>
            ) : null}
          </>
        }
      />
      {error ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}
      <section className="panel mb-4 rounded p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm text-slate-600">
            Policy Version
            <select className="field mt-1" value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)}>
              <option value="">Select version</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.version_number} ({version.status})
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section className="panel rounded-lg shadow-sm border border-slate-100 p-6 mb-6">
        <div className="mb-5 border-b border-line pb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{editingId ? `Edit Impact Level: ${form.level_code}` : 'Add New Impact Level'}</h2>
            <p className="text-sm text-slate-500 mt-1">Configure travel allowances and rates for this employee level.</p>
          </div>
          {!isViewOnly && (
            <button className="btn-primary" onClick={saveAction.run} disabled={saveAction.loading}>
              <Save size={16} />
              {saveAction.loading ? 'Saving...' : 'Save Configuration'}
            </button>
          )}
        </div>

        <div className="grid gap-x-6 gap-y-5 lg:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wider">Level Code</label>
            <input className="field w-full text-slate-900" placeholder="e.g. L1" readOnly={isViewOnly} value={form.level_code} onChange={(event) => setForm({ ...form, level_code: event.target.value })} />
          </div>
          <div className="lg:col-span-3">
            <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wider">Level Name</label>
            <input className="field w-full text-slate-900" placeholder="e.g. CXO / Director" value={form.level_name} onChange={(event) => setForm({ ...form, level_name: event.target.value })} />
          </div>

          <div className="col-span-full border-t border-slate-100 my-2 pt-4">
            <h3 className="text-sm font-bold text-slate-800 mb-4">Travel Eligibility</h3>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wider">Air Eligibility</label>
            <select className="field w-full text-slate-900" value={form.air_eligibility} onChange={(event) => setForm({ ...form, air_eligibility: event.target.value })}>
              <option>YES</option>
              <option>NO</option>
              <option>CONDITIONAL</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wider">Air Class</label>
            <select className="field w-full text-slate-900" value={form.air_class_allowed || ''} onChange={(event) => setForm({ ...form, air_class_allowed: event.target.value })}>
              <option value="">No air class</option>
              <option value="ECONOMY">Economy</option>
              <option value="PREMIUM_ECONOMY">Premium Economy</option>
              <option value="BUSINESS">Business</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wider">4W Rate (₹/km)</label>
            <input className="field w-full text-slate-900" placeholder="e.g. 20.00" value={form.vehicle_rate_4w} onChange={(event) => setForm({ ...form, vehicle_rate_4w: event.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wider">2W Rate (₹/km)</label>
            <input className="field w-full text-slate-900" placeholder="e.g. 10.00" value={form.vehicle_rate_2w} onChange={(event) => setForm({ ...form, vehicle_rate_2w: event.target.value })} />
          </div>

          <div className="col-span-full grid gap-6 lg:grid-cols-2 mt-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wider">Train Classes</label>
              <textarea className="field w-full min-h-[100px] text-sm text-slate-900" placeholder="3A, CC, SL (comma-separated)" value={trainClassesText} onChange={(event) => setTrainClassesText(event.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wider">Local Conveyance Modes</label>
              <textarea className="field w-full min-h-[100px] text-sm text-slate-900" placeholder="Own Vehicle 4W, Hired Taxi (comma-separated)" value={conveyanceText} onChange={(event) => setConveyanceText(event.target.value)} />
            </div>
          </div>

          <div className="col-span-full mt-2 rounded-lg bg-slate-50 border border-slate-200 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8">
            <label className="flex items-center gap-3 text-sm font-bold text-slate-800 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" disabled={isViewOnly} checked={Boolean(airApprovalRequired)} onChange={(event) => setAirApprovalRequired(event.target.checked)} />
              Require Air Travel Approval
              <span className="text-xs text-slate-500 font-medium ml-1">(Flights require manager approval)</span>
            </label>
            <label className="flex items-center gap-3 text-sm font-bold text-slate-800 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" disabled={isViewOnly} checked={Boolean(form.twin_sharing_mandatory)} onChange={(event) => setForm({ ...form, twin_sharing_mandatory: event.target.checked })} />
              Require Twin Sharing
              <span className="text-xs text-slate-500 font-medium ml-1">(Enforces shared accommodations)</span>
            </label>
          </div>
        </div>
      </section>
      <section className="panel table-contain mt-6 overflow-x-auto rounded-lg shadow-sm border border-slate-100">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-4">Code</th>
              <th className="px-5 py-4">Name</th>
              <th className="px-5 py-4">Air Rules</th>
              <th className="px-5 py-4">Ground / Conveyance</th>
              <th className="px-5 py-4 text-center">Twin Sharing</th>
              <th className="px-5 py-4 text-center">Rates per KM (4W / 2W)</th>
              <th className="px-5 py-4 text-center">Status</th>
              <th className="px-5 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {levels.map((level) => (
              <tr key={level.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-5 py-4 font-bold text-slate-900">{level.level_code}</td>
                <td className="px-5 py-4 font-semibold text-slate-700">{level.level_name}</td>
                <td className="px-5 py-4">
                  <div className="flex flex-col">
                    <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${level.air_eligibility === 'YES' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20' : level.air_eligibility === 'NO' ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/10' : 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20'}`}>{level.air_eligibility}</span>
                    {level.air_class_allowed && <span className="mt-1 text-xs text-slate-500">{level.air_class_allowed.replace('_', ' ')}</span>}
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="max-w-[250px] truncate text-xs text-slate-600" title={(level.train_classes_allowed || []).join(', ')}>
                    <strong className="text-slate-800">Train:</strong> {(level.train_classes_allowed || []).join(', ') || '-'}
                  </div>
                  <div className="max-w-[250px] truncate mt-1 text-xs text-slate-600" title={(level.local_conveyance_modes || []).join(', ')}>
                    <strong className="text-slate-800">Local:</strong> {(level.local_conveyance_modes || []).join(', ') || '-'}
                  </div>
                </td>
                <td className="px-5 py-4 text-center">
                  {level.twin_sharing_mandatory ? <span className="font-semibold text-slate-700">Yes</span> : <span className="text-slate-400">No</span>}
                </td>
                <td className="px-5 py-4 text-center font-mono text-xs">
                  <span className="text-slate-900">₹{level.vehicle_rate_4w || '0'}</span>
                  <span className="text-slate-300 mx-1">/</span>
                  <span className="text-slate-600">₹{level.vehicle_rate_2w || '0'}</span>
                </td>
                <td className="px-5 py-4 text-center">
                  {level.is_deprecated ? (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-500">Deprecated</span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Active</span>
                  )}
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    {!isViewOnly && (
                      <button className="btn-secondary h-8 px-3 text-xs font-medium text-slate-700" onClick={() => {
                        setForm({
                          ...level,
                          air_class_allowed: level.air_class_allowed || '',
                          vehicle_rate_4w: level.vehicle_rate_4w ?? '',
                          vehicle_rate_2w: level.vehicle_rate_2w ?? '',
                        });
                        setAirApprovalRequired(level.air_eligibility_conditions?.approval_required || false);
                        setTrainClassesText((level.train_classes_allowed || []).join(','));
                        setConveyanceText((level.local_conveyance_modes || []).join(','));
                        setEditingId(level.id);
                      }}>Edit</button>
                    )}
                    {!isViewOnly && !level.is_deprecated && (
                      <button className="btn-secondary h-8 px-3 text-xs font-medium text-red-600 hover:bg-red-50 hover:border-red-200" onClick={() => deprecateAction.run(level.id)} disabled={deprecateAction.loading}>Deprecate</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
