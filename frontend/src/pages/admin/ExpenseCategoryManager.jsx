import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { canEditPolicy } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

const createEmptyForm = (policyVersionId = '') => ({
  name: '',
  parent_category_id: '',
  bill_mandatory: false,
  gst_invoice_required: false,
  blacklisted_items: '',
  policy_version_id: policyVersionId,
});

function flatten(categories, depth = 0) {
  return categories.flatMap((category) => [
    { ...category, depth },
    ...flatten(category.children || [], depth + 1),
  ]);
}

export default function ExpenseCategoryManager() {
  useSetPageTitle('Expense Categories');
  const [categories, setCategories] = useState([]);
  const [policyVersions, setPolicyVersions] = useState([]);
  const [selectedPolicyVersionId, setSelectedPolicyVersionId] = useState('');
  const [form, setForm] = useState(createEmptyForm());
  const [editingId, setEditingId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const role = useAuthStore((state) => state.user?.role);
  const isViewOnly = !canEditPolicy(role);

  const load = async () => {
    try {
      setLoadError(null);
      const policyResponse = await adminApi.policyVersions();
      const nextSelectedPolicyVersionId =
        selectedPolicyVersionId ||
        policyResponse.data.find((version) => version.status === 'DRAFT')?.id ||
        '';
      const categoryResponse = nextSelectedPolicyVersionId
        ? await adminApi.expenseCategories({ policy_version_id: Number(nextSelectedPolicyVersionId) })
        : { data: [] };

      setCategories(categoryResponse.data);
      setPolicyVersions(policyResponse.data);
      setSelectedPolicyVersionId(nextSelectedPolicyVersionId);
      setForm((current) => ({
        ...current,
        policy_version_id: current.policy_version_id || nextSelectedPolicyVersionId,
      }));
    } catch (error) {
      setLoadError(error);
    }
  };

  useEffect(() => {
    load();
  }, [selectedPolicyVersionId]);

  const rows = flatten(categories).filter(
    (category) =>
      !selectedPolicyVersionId || category.policy_version_id === Number(selectedPolicyVersionId),
  );

  const saveAction = useAsyncAction(async () => {
    const policyVersionId = Number(form.policy_version_id || selectedPolicyVersionId);
    const payload = {
      ...form,
      parent_category_id: form.parent_category_id ? Number(form.parent_category_id) : null,
      policy_version_id: policyVersionId,
      blacklisted_items: form.blacklisted_items
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    };
    if (editingId) await adminApi.updateExpenseCategory(editingId, payload);
    else await adminApi.createExpenseCategory(payload);
    setForm(createEmptyForm(selectedPolicyVersionId));
    setEditingId(null);
    await load();
  });
  const deactivateAction = useAsyncAction(async (id) => {
    await adminApi.deactivateExpenseCategory(id);
    await load();
  });
  const error = loadError || saveAction.error || deactivateAction.error;

  return (
    <>
      <PageHeader
        title=""
        actions={
          <>
            {isViewOnly ? <span className="badge bg-slate-100 text-slate-700">View Only</span> : null}
            {!isViewOnly ? <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setForm(createEmptyForm(selectedPolicyVersionId));
                setEditingId(null);
              }}
            >
              <Plus size={17} />Add Category
            </button> : null}
          </>
        }
      />
      {error ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <section className="panel flex-1 rounded p-4 flex items-center gap-3">
          <label className="text-sm font-semibold text-slate-700 whitespace-nowrap">
            Draft Policy Version:
          </label>
          <select className="field min-w-48 bg-slate-50 py-1.5 text-sm" value={selectedPolicyVersionId} onChange={(event) => { setSelectedPolicyVersionId(event.target.value); setEditingId(null); setForm(createEmptyForm(event.target.value)); }}>
            <option value="">Select draft version</option>
            {policyVersions
              .filter((version) => version.status === 'DRAFT')
              .map((version) => (
                <option key={version.id} value={version.id}>
                  Policy {version.version_number}
                </option>
              ))}
          </select>
        </section>
      </div>
      
      <section className="panel rounded p-1 mb-4">
        <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50/50 rounded border border-transparent">
          <input className="field min-w-[200px] flex-1 text-sm py-1.5" readOnly={isViewOnly} placeholder="Category Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <select className="field min-w-[180px] flex-1 text-sm py-1.5 bg-white" disabled={isViewOnly} value={form.parent_category_id} onChange={(event) => setForm({ ...form, parent_category_id: event.target.value })}>
            <option value="">Root category</option>
            {rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <div className="flex items-center gap-4 px-2">
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600"><input type="checkbox" className="rounded border-slate-300 text-brand focus:ring-brand" disabled={isViewOnly} checked={form.bill_mandatory} onChange={(event) => setForm({ ...form, bill_mandatory: event.target.checked })} />Bill</label>
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600"><input type="checkbox" className="rounded border-slate-300 text-brand focus:ring-brand" disabled={isViewOnly} checked={form.gst_invoice_required} onChange={(event) => setForm({ ...form, gst_invoice_required: event.target.checked })} />GST</label>
          </div>
          <input className="field min-w-[200px] flex-1 text-sm py-1.5" readOnly={isViewOnly} placeholder="Blacklist tags (comma sep)" value={form.blacklisted_items} onChange={(event) => setForm({ ...form, blacklisted_items: event.target.value })} />
          <select className="field min-w-[150px] flex-1 text-sm py-1.5 bg-white" disabled={isViewOnly} value={form.policy_version_id} onChange={(event) => setForm({ ...form, policy_version_id: event.target.value })}>
            {policyVersions
              .filter((version) => version.status === 'DRAFT')
              .map((version) => (
                <option key={version.id} value={version.id}>
                  Policy {version.version_number}
                </option>
              ))}
          </select>
          {!isViewOnly ? <button className="btn-primary shrink-0 h-9 px-4" onClick={saveAction.run} disabled={!form.policy_version_id || saveAction.loading}><Save size={16} className="mr-1.5" />{saveAction.loading ? 'Saving' : 'Save Category'}</button> : null}
        </div>
      </section>
      <section className="panel table-contain overflow-hidden rounded">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr><th className="px-4 py-3">Category</th><th className="px-4 py-3">Bill</th><th className="px-4 py-3">GST</th><th className="px-4 py-3">Blacklist</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((category) => (
              <tr key={category.id} className="border-t border-line hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-3 font-semibold text-slate-800" style={{ paddingLeft: `${16 + category.depth * 24}px` }}>{category.name}</td>
                <td className="px-4 py-3">
                  {category.bill_mandatory ? <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Yes</span> : <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-inset ring-slate-500/20">No</span>}
                </td>
                <td className="px-4 py-3">
                  {category.gst_invoice_required ? <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Yes</span> : <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-inset ring-slate-500/20">No</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{(category.blacklisted_items || []).join(', ') || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {!isViewOnly ? <button className="inline-flex items-center justify-center rounded bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-all" onClick={() => { setForm({ ...category, parent_category_id: category.parent_category_id || '', policy_version_id: category.policy_version_id, blacklisted_items: (category.blacklisted_items || []).join(', ') }); setEditingId(category.id); }}>Edit</button> : null}
                    {!isViewOnly ? <button className="inline-flex items-center justify-center rounded bg-white p-1.5 text-slate-400 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-all" onClick={() => deactivateAction.run(category.id)} disabled={deactivateAction.loading} title="Disable Category"><Trash2 size={15} /></button> : null}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No categories found for this policy version.</td></tr> : null}
          </tbody>
        </table>
      </section>
    </>
  );
}
