import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import useToast from '../../hooks/useToast';
import { adminApi } from '../../services/adminApi';
import { canEditPolicy } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-brand' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function TeamBudgets() {
  useSetPageTitle('Team Budgets');
  const role = useAuthStore((state) => state.user?.role);
  const isViewOnly = !canEditPolicy(role);

  const [enabled, setEnabled] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [managers, setManagers] = useState([]);
  const [options, setOptions] = useState({ departments: [], managers: [] });
  const [loadError, setLoadError] = useState(null);

  const [newDept, setNewDept] = useState('');
  const [newDeptAmount, setNewDeptAmount] = useState('');
  const [newManagerId, setNewManagerId] = useState('');
  const [newManagerAmount, setNewManagerAmount] = useState('');
  const [rowDrafts, setRowDrafts] = useState({});

  const load = async () => {
    try {
      setLoadError(null);
      const [configRes, deptRes, mgrRes, optRes] = await Promise.all([
        adminApi.budgetConfig(),
        adminApi.departmentBudgets(),
        adminApi.managerBudgets(),
        adminApi.budgetOptions(),
      ]);
      setEnabled(Boolean(configRes.data?.enabled));
      setDepartments(deptRes.data || []);
      setManagers(mgrRes.data || []);
      setOptions(optRes.data || { departments: [], managers: [] });
    } catch (error) {
      setLoadError(error);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const { showToast } = useToast();

  const toggleAction = useAsyncAction(async (next) => {
    const res = await adminApi.updateBudgetConfig({ enabled: next });
    setEnabled(Boolean(res.data?.enabled));
    showToast(next ? 'Team budgets enabled.' : 'Team budgets disabled — hidden from managers.', 'success');
  });

  const addDeptAction = useAsyncAction(async () => {
    if (!newDept || !newDeptAmount) return;
    await adminApi.upsertDepartmentBudget({ department: newDept, monthly_amount: newDeptAmount });
    setNewDept('');
    setNewDeptAmount('');
    await load();
    showToast('Department budget saved.', 'success');
  });

  const saveDeptRowAction = useAsyncAction(async (row) => {
    const amount = rowDrafts[`dept-${row.id}`] ?? row.monthly_amount;
    await adminApi.upsertDepartmentBudget({ department: row.department, monthly_amount: amount });
    await load();
    showToast('Department budget updated.', 'success');
  });

  const deleteDeptAction = useAsyncAction(async (id) => {
    await adminApi.deleteDepartmentBudget(id);
    await load();
    showToast('Department budget removed.', 'success');
  });

  const addManagerAction = useAsyncAction(async () => {
    if (!newManagerId || !newManagerAmount) return;
    await adminApi.upsertManagerBudget({ manager_user_id: Number(newManagerId), monthly_amount: newManagerAmount });
    setNewManagerId('');
    setNewManagerAmount('');
    await load();
    showToast('Manager override saved.', 'success');
  });

  const saveManagerRowAction = useAsyncAction(async (row) => {
    const amount = rowDrafts[`mgr-${row.id}`] ?? row.monthly_amount;
    await adminApi.upsertManagerBudget({ manager_user_id: row.manager_user_id, monthly_amount: amount });
    await load();
    showToast('Manager override updated.', 'success');
  });

  const deleteManagerAction = useAsyncAction(async (id) => {
    await adminApi.deleteManagerBudget(id);
    await load();
    showToast('Manager override removed.', 'success');
  });

  const error = loadError || toggleAction.error || addDeptAction.error || addManagerAction.error;
  const availableDepartments = options.departments.filter((d) => !departments.some((row) => row.department === d));
  const availableManagers = options.managers.filter((m) => !managers.some((row) => row.manager_user_id === m.user_id));

  return (
    <>
      <PageHeader
        title=""
        actions={isViewOnly ? <span className="badge bg-slate-100 text-slate-700">View Only</span> : null}
      />
      {error ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error.response?.data?.detail || error.message}
        </div>
      ) : null}

      <section className="panel mb-6 flex flex-wrap items-center justify-between gap-4 rounded p-5">
        <div>
          <h3 className="text-[15px] font-bold text-ink">Team budgets</h3>
          <p className="mt-1 max-w-xl text-xs text-slate-500">
            When enabled, reporting managers see a monthly team spend-vs-budget chart on their home dashboard,
            resolved from the manager override or department default below. When disabled, all budget figures
            and this chart are hidden from every manager.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500">{enabled ? 'Enabled' : 'Disabled'}</span>
          <ToggleSwitch checked={enabled} onChange={toggleAction.run} disabled={isViewOnly || toggleAction.loading} />
        </div>
      </section>

      <section className="panel mb-6 overflow-hidden rounded">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-[15px] font-bold text-ink">Department budgets</h3>
          <p className="text-xs text-slate-400 mt-0.5">Default monthly budget applied to a manager by their own department, unless a manager override exists.</p>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="px-5 py-3">Department</th>
              <th className="px-5 py-3">Monthly Budget</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((row) => (
              <tr key={row.id} className="border-b border-slate-50 last:border-none">
                <td className="px-5 py-3 font-medium text-ink">{row.department}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 w-36">
                    <span className="text-[10px] font-semibold text-slate-400">₹</span>
                    <input
                      className="w-full bg-transparent p-0 text-xs focus:ring-0 border-none outline-none text-slate-700"
                      readOnly={isViewOnly}
                      defaultValue={row.monthly_amount}
                      onChange={(e) => setRowDrafts((c) => ({ ...c, [`dept-${row.id}`]: e.target.value }))}
                    />
                  </div>
                </td>
                <td className="px-5 py-3 text-right">
                  {!isViewOnly ? (
                    <div className="inline-flex items-center gap-2">
                      <button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={saveDeptRowAction.loading} onClick={() => saveDeptRowAction.run(row)}>
                        <Save size={13} />
                      </button>
                      <button type="button" className="btn-secondary h-8 px-3 text-xs text-red-600 hover:bg-red-50 hover:border-red-200" disabled={deleteDeptAction.loading} onClick={() => deleteDeptAction.run(row.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {!departments.length ? (
              <tr><td colSpan={3} className="px-5 py-6 text-center text-sm text-slate-400">No department budgets configured yet.</td></tr>
            ) : null}
            {!isViewOnly && availableDepartments.length ? (
              <tr className="bg-slate-50/40">
                <td className="px-5 py-3">
                  <select className="field text-sm py-1.5 bg-white" value={newDept} onChange={(e) => setNewDept(e.target.value)}>
                    <option value="">Select department…</option>
                    {availableDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 w-36">
                    <span className="text-[10px] font-semibold text-slate-400">₹</span>
                    <input className="w-full bg-transparent p-0 text-xs focus:ring-0 border-none outline-none text-slate-700" placeholder="0.00" value={newDeptAmount} onChange={(e) => setNewDeptAmount(e.target.value)} />
                  </div>
                </td>
                <td className="px-5 py-3 text-right">
                  <button type="button" className="btn-primary h-8 px-3 text-xs" disabled={!newDept || !newDeptAmount || addDeptAction.loading} onClick={addDeptAction.run}>
                    <Plus size={13} /> Add
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="panel overflow-hidden rounded">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-[15px] font-bold text-ink">Manager overrides</h3>
          <p className="text-xs text-slate-400 mt-0.5">Takes precedence over the department default for this specific reporting manager.</p>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="px-5 py-3">Manager</th>
              <th className="px-5 py-3">Department</th>
              <th className="px-5 py-3">Monthly Budget</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {managers.map((row) => (
              <tr key={row.id} className="border-b border-slate-50 last:border-none">
                <td className="px-5 py-3">
                  <div className="font-medium text-ink">{row.manager_name}</div>
                  <div className="text-xs text-slate-400">{row.manager_email}</div>
                </td>
                <td className="px-5 py-3 text-slate-500">{row.department || '—'}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 w-36">
                    <span className="text-[10px] font-semibold text-slate-400">₹</span>
                    <input
                      className="w-full bg-transparent p-0 text-xs focus:ring-0 border-none outline-none text-slate-700"
                      readOnly={isViewOnly}
                      defaultValue={row.monthly_amount}
                      onChange={(e) => setRowDrafts((c) => ({ ...c, [`mgr-${row.id}`]: e.target.value }))}
                    />
                  </div>
                </td>
                <td className="px-5 py-3 text-right">
                  {!isViewOnly ? (
                    <div className="inline-flex items-center gap-2">
                      <button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={saveManagerRowAction.loading} onClick={() => saveManagerRowAction.run(row)}>
                        <Save size={13} />
                      </button>
                      <button type="button" className="btn-secondary h-8 px-3 text-xs text-red-600 hover:bg-red-50 hover:border-red-200" disabled={deleteManagerAction.loading} onClick={() => deleteManagerAction.run(row.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {!managers.length ? (
              <tr><td colSpan={4} className="px-5 py-6 text-center text-sm text-slate-400">No manager overrides configured yet.</td></tr>
            ) : null}
            {!isViewOnly && availableManagers.length ? (
              <tr className="bg-slate-50/40">
                <td className="px-5 py-3" colSpan={2}>
                  <select className="field text-sm py-1.5 bg-white w-full" value={newManagerId} onChange={(e) => setNewManagerId(e.target.value)}>
                    <option value="">Select manager…</option>
                    {availableManagers.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name} ({m.email}){m.department ? ` — ${m.department}` : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 w-36">
                    <span className="text-[10px] font-semibold text-slate-400">₹</span>
                    <input className="w-full bg-transparent p-0 text-xs focus:ring-0 border-none outline-none text-slate-700" placeholder="0.00" value={newManagerAmount} onChange={(e) => setNewManagerAmount(e.target.value)} />
                  </div>
                </td>
                <td className="px-5 py-3 text-right">
                  <button type="button" className="btn-primary h-8 px-3 text-xs" disabled={!newManagerId || !newManagerAmount || addManagerAction.loading} onClick={addManagerAction.run}>
                    <Plus size={13} /> Add
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}
