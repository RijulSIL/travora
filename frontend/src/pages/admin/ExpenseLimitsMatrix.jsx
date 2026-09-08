import { Save, Lock, Unlock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { canEditPolicy } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

const fields = ['hotel', 'food', 'incidental', 'day_visit'];

export default function ExpenseLimitsMatrix() {
  useSetPageTitle('Expense Limits');
  const [searchParams, setSearchParams] = useSearchParams();
  const [levels, setLevels] = useState([]);
  const [limits, setLimits] = useState([]);
  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [drafts, setDrafts] = useState({});
  const [loadError, setLoadError] = useState(null);
  const role = useAuthStore((state) => state.user?.role);
  const selectedVersion = versions.find((v) => String(v.id) === String(selectedVersionId));
  const isViewOnly = !canEditPolicy(role) || (selectedVersionId && selectedVersion?.status !== 'DRAFT');

  const load = async () => {
    try {
      setLoadError(null);
      const [versionResponse, levelResponse, limitResponse] = await Promise.all([
        adminApi.policyVersions(),
        selectedVersionId
          ? adminApi.impactLevels({ policy_version_id: Number(selectedVersionId) })
          : adminApi.impactLevels(),
        selectedVersionId
          ? adminApi.expenseLimits({ policy_version_id: Number(selectedVersionId) })
          : adminApi.expenseLimits(),
      ]);
      setVersions(versionResponse.data);
      setLevels(levelResponse.data);
      setLimits(limitResponse.data);
      if (!selectedVersionId) {
        const firstDraft = versionResponse.data.find((version) => version.status === 'DRAFT');
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
    if (!selectedVersionId) return;
    const next = new URLSearchParams(searchParams);
    next.set('versionId', selectedVersionId);
    setSearchParams(next, { replace: true });
  }, [searchParams, selectedVersionId, setSearchParams]);

  const byKey = useMemo(() => {
    const map = new Map();
    limits.forEach((limit) => map.set(`${limit.impact_level_id}:${limit.city_group}`, limit));
    return map;
  }, [limits]);

  const updateDraft = (limit, field, value) => {
    const key = `${limit.impact_level_id}:${limit.city_group}`;
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] || limit), [field]: value } }));
  };

  const saveAction = useAsyncAction(async () => {
    if (!selectedVersionId) {
      throw new Error('Select a draft policy version first');
    }
    await Promise.all(
      Object.values(drafts).map((limit) =>
        limit.id
          ? adminApi.updateExpenseLimit(limit.id, { ...limit, policy_version_id: Number(selectedVersionId) })
          : adminApi.createExpenseLimit({ ...limit, policy_version_id: Number(selectedVersionId) }),
      ),
    );
    setDrafts({});
    await load();
  });
  const error = loadError || saveAction.error;

  return (
    <>
      <PageHeader
        title=""
        actions={
          <>
            {isViewOnly ? <span className="badge bg-slate-100 text-slate-700">View Only</span> : null}
            {!isViewOnly ? (
              <button type="button" className="btn-primary" onClick={saveAction.run} disabled={saveAction.loading}>
                <Save size={17} />
                {saveAction.loading ? 'Saving' : 'Save Changes'}
              </button>
            ) : null}
          </>
        }
      />
      {error ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}
      <section className="panel mb-4 flex flex-wrap items-center justify-between gap-4 rounded p-4">
        <div className="flex items-center gap-4">
          <label className="text-sm font-semibold text-slate-700">
            Policy Version:
          </label>
          <select className="field min-w-64 bg-slate-50 py-1.5 text-sm" value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)}>
            <option value="">Select version</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.version_number} ({version.status})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-slate-50 px-3 py-1.5 rounded border border-slate-200">
          <Lock size={14} className="text-red-500" />
          <span>= Hard Block (Expense cannot exceed limit)</span>
        </div>
      </section>
      <section className="panel table-contain overflow-auto rounded">
        <table className="min-w-max w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th rowSpan={2} className="sticky left-0 z-20 bg-slate-50 px-4 py-3 align-bottom border-b border-r border-slate-200 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)]">Impact Level</th>
              {['A', 'B', 'C'].map((group, idx) => (
                <th key={group} colSpan={4} className={`border-b border-l border-slate-200 px-3 py-2 text-center bg-slate-100/50 ${idx < 2 ? 'border-r-2 border-r-slate-300' : ''}`}>
                  City Group {group}
                </th>
              ))}
            </tr>
            <tr>
              {['A', 'B', 'C'].flatMap((group, gIdx) => fields.map((field) => (
                <th key={`${group}-${field}`} className={`px-2 py-2 text-center border-b border-slate-200 bg-slate-50 ${field === 'hotel' ? 'border-l border-slate-200' : ''} ${field === 'day_visit' && gIdx < 2 ? 'border-r-2 border-r-slate-300' : ''}`}>
                  {field.replace('_', ' ')}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {levels.map((level) => (
              <tr key={level.id} className="border-t border-line hover:bg-slate-50/50 transition-colors group">
                <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-4 py-2 font-medium border-r border-slate-200 text-slate-700 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)] transition-colors">{level.level_code}</td>
                {['A', 'B', 'C'].flatMap((group) => {
                  const key = `${level.id}:${group}`;
                  const limit =
                    drafts[key] ||
                    byKey.get(key) ||
                    {
                      policy_version_id: Number(selectedVersionId || level.policy_version_id),
                      impact_level_id: level.id,
                      city_group: group,
                    };
                  return fields.map((field) => (
                    <td key={`${key}-${field}`} className={`px-2 py-1.5 ${field === 'hotel' ? 'border-l border-slate-100' : ''} ${field === 'day_visit' && group !== 'C' ? 'border-r-2 border-r-slate-300' : ''}`}>
                      <div className="flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand/30 hover:border-slate-300 transition-colors shadow-sm">
                        <span className="text-[10px] font-semibold text-slate-400">₹</span>
                        <input 
                          className="w-20 bg-transparent p-0 text-xs text-right focus:ring-0 border-none outline-none text-slate-700" 
                          readOnly={isViewOnly} 
                          value={limit[`${field}_cap`] || ''} 
                          placeholder="0.00"
                          onChange={(event) => updateDraft(limit, `${field}_cap`, event.target.value || null)} 
                        />
                        <div className="h-3 w-px bg-slate-200 mx-1"></div>
                        <button
                          type="button"
                          disabled={isViewOnly}
                          className="flex items-center justify-center outline-none disabled:opacity-50"
                          title="Hard Block Toggle"
                          onClick={() => updateDraft(limit, `${field}_is_hard_block`, !limit[`${field}_is_hard_block`])}
                        >
                          {limit[`${field}_is_hard_block`] ? (
                            <Lock size={14} className="text-red-500" />
                          ) : (
                            <Unlock size={14} className="text-slate-300 hover:text-slate-400 transition-colors" />
                          )}
                        </button>
                      </div>
                    </td>
                  ));
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
