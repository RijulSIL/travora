import { Check, Plus, Search, UserX, X, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { adminApi } from '../../services/adminApi';
import { reimbursementApi } from '../../services/reimbursementApi';
import Skeleton from '../../components/ui/Skeleton';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

const roles = ['EMPLOYEE', 'REPORTING_MANAGER', 'HRBP_HR', 'PAYROLL', 'FINANCE', 'IT_ADMIN', 'CEO', 'GROUP_HEAD_HR'];

const departmentsList = [
  'Engineering',
  'Human Resources',
  'Finance',
  'Sales',
  'Marketing',
  'Operations',
  'IT',
  'Legal',
  'Customer Support',
  'Design',
  'Product',
];

const emptyCreateForm = {
  email: '',
  full_name: '',
  password: '',
  role: 'EMPLOYEE',
  employee_id: '',
  impact_level_id: '',
  reporting_manager_id: '',
  department: '',
};

const getInitials = (name, email) => {
  if (name) {
    const parts = name.trim().split(' ');
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }
  return email ? email.substring(0, 2).toUpperCase() : 'U';
};

export default function UserManagement() {
  useSetPageTitle('User Management');
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ department: '', impact_level_id: '', role: '' });
  const [roleDrafts, setRoleDrafts] = useState({});
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importFile, setImportFile] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [recentClaims, setRecentClaims] = useState([]);
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [impactLevels, setImpactLevels] = useState([]);
  const [activePolicyId, setActivePolicyId] = useState(null);
  const [reportingManagers, setReportingManagers] = useState([]);
  const [officeLocations, setOfficeLocations] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});

  const loadUsers = useCallback(async () => {
    try {
      setLoadError(null);
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const response = await adminApi.users(params);
      setUsers(response.data);


    } catch (error) {
      setLoadError(error);
    }
  }, [filters]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    (async () => {
      try {
        const [impactRes, policyRes] = await Promise.all([
          adminApi.impactLevels(),
          adminApi.policyVersions()
        ]);
        setImpactLevels(impactRes.data);
        const activePolicy = policyRes.data.find(p => p.status === 'ACTIVE');
        if (activePolicy) setActivePolicyId(activePolicy.id);
      } catch (err) {
        console.error('Failed to load impact levels/policies', err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await adminApi.getReportingManagers();
        setReportingManagers(res.data);
      } catch (err) {
        console.error('Failed to load reporting managers', err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await adminApi.companyProfile();
        if (res.data && res.data.office_locations) {
          setOfficeLocations(res.data.office_locations);
        }
      } catch (err) {
        console.error('Failed to load office locations', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (createOpen || importOpen || selectedUser) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [createOpen, importOpen, selectedUser]);

  const roleAction = useAsyncAction(async (user, role) => {
    await adminApi.changeUserRole(user.user_id, role);
    if (role === 'CEO') {
      const l1 = [...impactLevels].reverse().find(l => l.level_code === 'L1');
      if (l1 && user.impact_level_id !== l1.id) {
        await adminApi.updateUser(user.user_id, { impact_level_id: l1.id });
      }
    }
    await loadUsers();
  });

  const deactivateAction = useAsyncAction(async (user) => {
    await adminApi.deactivateUser(user.user_id);
    await loadUsers();
  });
  const searchAction = useAsyncAction(loadUsers);

  const createUserAction = useAsyncAction(async () => {
    const payload = {
      email: createForm.email.trim(),
      password: createForm.password,
      full_name: createForm.full_name.trim() || null,
      role: createForm.role,
      employee_id: createForm.employee_id.trim() || null,
      impact_level_id: createForm.impact_level_id ? Number(createForm.impact_level_id) : null,
      reporting_manager_id: createForm.reporting_manager_id || null,
      department: createForm.department.trim() || null,
    };
    await adminApi.createUser(payload);
    setStatus(`Created user ${payload.email}`);
    setCreateForm(emptyCreateForm);
    setCreateOpen(false);
    await loadUsers();
  });
  const updateUserAction = useAsyncAction(async () => {
    const payload = {
      full_name: editForm.full_name.trim() || null,
      role: editForm.role,
      impact_level_id: editForm.impact_level_id ? Number(editForm.impact_level_id) : null,
      department: editForm.department.trim() || null,
      office_location: editForm.office_location.trim() || null,
      reporting_manager_id: editForm.reporting_manager_id || null,
    };
    await adminApi.updateUser(selectedUser.user_id, payload);
    setStatus(`Updated user ${selectedUser.email}`);
    setIsEditing(false);
    await loadUsers();
    setSelectedUser({ ...selectedUser, ...payload });
  });
  const importAction = useAsyncAction(async () => {
    if (!importFile) return;
    const formData = new FormData();
    formData.append('file', importFile);
    await adminApi.bulkImportUsers(formData);
    setStatus('Bulk import completed');
    setImportOpen(false);
    setImportRows([]);
    setImportFile(null);
    await loadUsers();
  });

  const openProfile = async (user) => {
    setSelectedUser(user);
    setIsEditing(false);
    setEditForm({
      full_name: user.full_name || '',
      role: user.role || 'EMPLOYEE',
      impact_level_id: user.impact_level_id || '',
      department: user.department || '',
      office_location: user.office_location || '',
      reporting_manager_id: user.reporting_manager_id || '',
    });
    const res = await reimbursementApi.claims({ employee_user_id: user.user_id });
    setRecentClaims((res.data || []).slice(0, 3));
  };

  const error =
    loadError ||
    roleAction.error ||
    deactivateAction.error ||
    searchAction.error ||
    createUserAction.error;

  const roleDraftKey = (user) => user.user_id;
  const selectedRole = (user) => roleDrafts[roleDraftKey(user)] || user.role || 'EMPLOYEE';
  const setSelectedRole = (user, role) => {
    setRoleDrafts((current) => ({ ...current, [roleDraftKey(user)]: role }));
  };

  return (
    <>
      <PageHeader
        title=""
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setImportOpen(true)}>
              Import from CSV
            </button>
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={17} aria-hidden="true" />
              Create User
            </button>
          </>
        }
      />
      <section className="panel rounded p-1 mb-4">
        <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50/50 rounded border border-transparent">
          <div className="flex-1 min-w-[200px] flex items-center bg-white rounded-md border border-slate-200 px-3 py-1.5 focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand transition-all">
            <Search className="text-slate-400 h-4 w-4 mr-2" />
            <input 
              className="w-full bg-transparent border-none p-0 text-sm focus:ring-0 text-slate-900 placeholder:text-slate-400" 
              placeholder="Search by department..." 
              value={filters.department} 
              onChange={(event) => setFilters({ ...filters, department: event.target.value })} 
              onKeyDown={(e) => e.key === 'Enter' && searchAction.run()}
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <input 
              className="field w-full text-sm py-1.5" 
              placeholder="Impact Level ID" 
              value={filters.impact_level_id} 
              onChange={(event) => setFilters({ ...filters, impact_level_id: event.target.value })} 
              onKeyDown={(e) => e.key === 'Enter' && searchAction.run()}
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <select 
              className="field w-full bg-white text-sm py-1.5" 
              value={filters.role} 
              onChange={(event) => setFilters({ ...filters, role: event.target.value })}
            >
              <option value="">Any role</option>
              {roles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </div>
          <button className="btn-primary shrink-0 h-9" onClick={searchAction.run} disabled={searchAction.loading}>
            Search
          </button>
        </div>
        {status ? <div className="px-4 pb-3 text-sm font-medium text-emerald-600">{status}</div> : null}
        {error ? <div className="mx-4 mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}
      </section>
      <section className="panel table-contain mt-4 overflow-hidden rounded">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3 text-center">Impact Level</th>
              <th className="px-4 py-3">Office</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const currentRole = selectedRole(user);
              const isRoleChanged = currentRole !== (user.role || 'EMPLOYEE');
              return (
                <tr key={user.user_id} className="border-t border-line text-slate-900 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-bold text-brand">
                        {getInitials(user.full_name, user.email)}
                      </div>
                      <div>
                        <button className="font-bold text-left text-ink hover:text-brand hover:underline" onClick={() => openProfile(user)}>
                          {user.full_name || user.email}
                        </button>
                        <div className="text-[11px] text-slate-500 mt-0.5">{user.employee_id || 'Standalone'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3">
                    {user.department ? (
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                        {user.department}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="relative inline-block w-full max-w-[160px]">
                      <select 
                        className={`w-full appearance-none rounded border px-3 py-1.5 text-xs font-semibold outline-none transition-colors cursor-pointer pr-8 ${
                          isRoleChanged
                            ? 'border-amber-300 bg-amber-50 text-amber-800 shadow-sm'
                            : 'border-transparent bg-slate-100 text-slate-700 hover:bg-slate-200 hover:border-slate-300 focus:border-brand focus:bg-white focus:ring-1 focus:ring-brand'
                        }`} 
                        value={currentRole} 
                        onChange={(event) => setSelectedRole(user, event.target.value)}
                      >
                        {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                      <ChevronDown size={14} className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors ${isRoleChanged ? 'text-amber-500' : 'text-slate-400'}`} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">{user.impact_level_id || <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-3">{user.office_location || <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-3">
                    {user.is_active ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-inset ring-slate-500/20">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button 
                        className="inline-flex items-center justify-center gap-1.5 rounded bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:shadow-none transition-all" 
                        onClick={() => roleAction.run(user, currentRole)} 
                        disabled={roleAction.loading || !isRoleChanged}
                      >
                        <Check size={14} className={isRoleChanged ? 'text-emerald-600' : 'text-slate-400'} />
                        Save
                      </button>
                      <button 
                        className="inline-flex items-center justify-center rounded bg-white p-1.5 text-slate-400 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-all" 
                        onClick={() => setConfirmDeactivate(user)} 
                        disabled={deactivateAction.loading}
                        title="Deactivate User"
                      >
                        <UserX size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

          </tbody>
        </table>
      </section>
      {createOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <form
            className="panel w-full max-w-2xl rounded p-6 shadow-lg max-h-[90vh] overflow-y-auto"
            onSubmit={(event) => {
              event.preventDefault();
              createUserAction.run();
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Create User</h2>
              <button
                type="button"
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                onClick={() => {
                  setCreateOpen(false);
                  setCreateForm(emptyCreateForm);
                }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="create-email">
                  Email
                </label>
                <input
                  id="create-email"
                  type="email"
                  required
                  className="field w-full"
                  value={createForm.email}
                  onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="create-fullname">
                  Full name
                </label>
                <input
                  id="create-fullname"
                  type="text"
                  className="field w-full"
                  value={createForm.full_name}
                  onChange={(event) => setCreateForm({ ...createForm, full_name: event.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="create-password">
                  Password
                </label>
                <input
                  id="create-password"
                  type="password"
                  required
                  minLength={8}
                  className="field w-full"
                  value={createForm.password}
                  onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })}
                />
                <p className="mt-1 text-xs text-slate-500">Minimum 8 characters.</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="create-role">
                  Role
                </label>
                <select
                  id="create-role"
                  className="field w-full"
                  value={createForm.role}
                  onChange={(event) => {
                    const newRole = event.target.value;
                    let nextForm = { ...createForm, role: newRole };
                    if (newRole === 'CEO') {
                      const l1 = [...impactLevels].reverse().find(l => l.level_code === 'L1');
                      if (l1) nextForm.impact_level_id = l1.id;
                    }
                    setCreateForm(nextForm);
                  }}
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="create-employee-id">
                  Employee ID (optional)
                </label>
                <input
                  id="create-employee-id"
                  type="text"
                  className="field w-full"
                  value={createForm.employee_id}
                  onChange={(event) => setCreateForm({ ...createForm, employee_id: event.target.value })}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Optional. A matching employee profile will be created if needed.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="create-impact-level">
                  Impact Level (optional)
                </label>
                <select
                  id="create-impact-level"
                  className="field w-full"
                  value={createForm.impact_level_id}
                  onChange={(event) => setCreateForm({ ...createForm, impact_level_id: event.target.value })}
                >
                  <option value="">Select Impact Level</option>
                  {impactLevels
                    .filter(l => l.policy_version_id === activePolicyId && !l.is_deprecated)
                    .map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.level_code} - {level.level_name} (ID: {level.id})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Optional. Select the impact level for this user.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="create-reporting-manager">
                  Reporting Manager (optional)
                </label>
                <select
                  id="create-reporting-manager"
                  className="field w-full"
                  value={createForm.reporting_manager_id}
                  onChange={(event) => setCreateForm({ ...createForm, reporting_manager_id: event.target.value })}
                >
                  <option value="">Select Manager</option>
                  {reportingManagers.map((mgr) => (
                    <option key={mgr.employee_id} value={mgr.employee_id}>
                      {mgr.full_name} ({mgr.employee_id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="create-department">
                  Department (optional)
                </label>
                <select
                  id="create-department"
                  className="field w-full"
                  value={createForm.department}
                  onChange={(event) => setCreateForm({ ...createForm, department: event.target.value })}
                >
                  <option value="">Select Department</option>
                  {departmentsList.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {createUserAction.error ? (
              <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {createUserAction.error.response?.data?.detail || createUserAction.error.message}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setCreateOpen(false);
                  setCreateForm(emptyCreateForm);
                }}
              >
                Cancel
              </button>
              <button className="btn-primary" type="submit" disabled={createUserAction.loading}>
                <Plus size={16} aria-hidden="true" />
                {createUserAction.loading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {importOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <div className="panel w-full max-w-3xl rounded p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Import Users from CSV</h2>
              <button className="btn-secondary h-8 px-2" onClick={() => setImportOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="mb-3 text-sm text-slate-600">
              Template headers: employee_id, full_name, email, role, department, office_location, impact_level_id
            </div>
            <div className="mb-3">
              <button
                className="btn-secondary"
                onClick={() => {
                  const csv =
                    'employee_id,full_name,email,role,department,office_location,impact_level_id\nEMP001,Sample User,sample@company.com,EMPLOYEE,Engineering,Bengaluru,9\n';
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'users_import_template.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download Template
              </button>
            </div>
            <input
              className="field"
              type="file"
              accept=".csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setImportFile(file || null);
                if (!file) return;
                const text = await file.text();
                const lines = text.split('\n').filter(Boolean);
                const [header, ...body] = lines;
                const columns = header.split(',').map((x) => x.trim());
                setImportRows(
                  body.map((line, idx) => {
                    const vals = line.split(',');
                    const row = {};
                    columns.forEach((col, cIdx) => {
                      row[col] = (vals[cIdx] || '').trim();
                    });
                    const missing = ['employee_id', 'full_name', 'email', 'role', 'department', 'office_location'].filter((col) => !row[col]);
                    return { ...row, __row: idx + 2, __error: missing.length ? `Missing: ${missing.join(', ')}` : '' };
                  }),
                );
              }}
            />
            <div className="mt-3 max-h-64 overflow-auto rounded border border-line">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Row</th>
                    <th className="px-3 py-2 text-left">Employee ID</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Role</th>
                    <th className="px-3 py-2 text-left">Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row) => (
                    <tr key={row.__row} className={`border-t border-line ${row.__error ? 'bg-red-50' : ''}`}>
                      <td className="px-3 py-2">{row.__row}</td>
                      <td className="px-3 py-2">{row.employee_id}</td>
                      <td className="px-3 py-2">{row.full_name}</td>
                      <td className="px-3 py-2">{row.email}</td>
                      <td className="px-3 py-2">{row.role}</td>
                      <td className="px-3 py-2 text-xs">{row.__error || 'OK'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setImportOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={importAction.run} disabled={importAction.loading || !importFile}>
                {importAction.loading ? 'Importing...' : 'Confirm Import'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {selectedUser ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40" onClick={() => setSelectedUser(null)}>
          <div className="absolute right-0 top-0 h-full w-full max-w-xl overflow-auto bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">User Profile</h2>
              <button className="btn-secondary h-8 px-2" onClick={() => setSelectedUser(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              {isEditing ? (
                <div className="space-y-4 text-sm">
                  <div>
                    <label className="mb-1.5 block font-medium text-slate-700">Name</label>
                    <input className="field w-full text-slate-900" value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-medium text-slate-700">Role</label>
                    <select className="field w-full text-slate-900" value={editForm.role} onChange={(e) => {
                      const newRole = e.target.value;
                      let nextForm = { ...editForm, role: newRole };
                      if (newRole === 'CEO') {
                        const l1 = [...impactLevels].reverse().find(l => l.level_code === 'L1');
                        if (l1) nextForm.impact_level_id = l1.id;
                      }
                      setEditForm(nextForm);
                    }}>
                      {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-medium text-slate-700">Impact Level</label>
                    <select className="field w-full text-slate-900" value={editForm.impact_level_id} onChange={(e) => setEditForm({ ...editForm, impact_level_id: e.target.value })}>
                      <option value="">Select Impact Level</option>
                      {impactLevels
                        .filter(l => (l.policy_version_id === activePolicyId && !l.is_deprecated) || l.id === editForm.impact_level_id)
                        .map((level) => (
                        <option key={level.id} value={level.id}>
                          {level.level_code} - {level.level_name} {level.policy_version_id !== activePolicyId ? '(Legacy)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-medium text-slate-700">Department</label>
                    <select className="field w-full text-slate-900" value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}>
                      <option value="">Select Department</option>
                      {departmentsList.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-medium text-slate-700">Office Location</label>
                    <select className="field w-full text-slate-900" value={editForm.office_location} onChange={(e) => setEditForm({ ...editForm, office_location: e.target.value })}>
                      <option value="">Select Office</option>
                      {officeLocations.map(office => <option key={office} value={office}>{office}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-medium text-slate-700">Reporting Manager</label>
                    <select className="field w-full text-slate-900" value={editForm.reporting_manager_id} onChange={(e) => setEditForm({ ...editForm, reporting_manager_id: e.target.value })}>
                      <option value="">Select Manager</option>
                      {reportingManagers.map((mgr) => (
                        <option key={mgr.employee_id} value={mgr.employee_id}>
                          {mgr.full_name} ({mgr.employee_id})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="flex items-center gap-4 rounded-xl bg-slate-50 p-5 border border-slate-100">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xl font-bold text-brand ring-4 ring-white shadow-sm">
                      {getInitials(selectedUser.full_name, selectedUser.email)}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{selectedUser.full_name || 'No Name Provided'}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                        <span className="font-semibold text-slate-700">{selectedUser.role}</span>
                        <span className="text-slate-300">•</span>
                        <span>{selectedUser.email}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-x-6 gap-y-6 text-sm px-1">
                    <div>
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Employee ID</span>
                      <span className="mt-1 block font-medium text-slate-900">{selectedUser.employee_id || '-'}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Status</span>
                      <span className="mt-1 block">
                        {selectedUser.is_active ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Active</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-inset ring-slate-500/20">Inactive</span>
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Department</span>
                      <span className="mt-1 block font-medium text-slate-900">{selectedUser.department || '-'}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Office Location</span>
                      <span className="mt-1 block font-medium text-slate-900">{selectedUser.office_location || '-'}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Impact Level</span>
                      <span className="mt-1 block font-medium text-slate-900">{selectedUser.impact_level_id || '-'}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Reporting Manager</span>
                      <span className="mt-1 block font-medium text-slate-900">{selectedUser.reporting_manager_id || '-'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-8 border-t border-line pt-6">
              <h3 className="mb-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1">Recent Claims</h3>
              <div className="space-y-2">
                {selectedUser && recentClaims.length === 0 ? <Skeleton variant="table" rows={3} columns={1} /> : null}
                {recentClaims.map((claim) => (
                  <div key={claim.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm transition-colors hover:border-brand/30">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-slate-900">#{claim.id}</span>
                      <span className="text-slate-400">|</span>
                      <span className="text-slate-600 font-medium">{claim.claim_reference || 'Draft'}</span>
                    </div>
                    <div>
                      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
                        {claim.status}
                      </span>
                    </div>
                  </div>
                ))}
                {recentClaims.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    No recent claims found.
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-8 flex gap-3 border-t border-line pt-6">
              {isEditing ? (
                <>
                  <button className="btn-primary" onClick={updateUserAction.run} disabled={updateUserAction.loading}>
                    {updateUserAction.loading ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button className="btn-secondary" onClick={() => setIsEditing(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-primary" onClick={() => setIsEditing(true)}>
                    Edit Profile
                  </button>
                  <button
                    className="btn-secondary text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    onClick={() => setConfirmDeactivate(selectedUser)}
                    disabled={deactivateAction.loading}
                  >
                    Deactivate Account
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(confirmDeactivate)}
        title="Deactivate User"
        description="Are you sure you want to deactivate this user account?"
        confirmLabel="Yes, Deactivate"
        confirmVariant="danger"
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() => {
          if (confirmDeactivate) deactivateAction.run(confirmDeactivate);
          setConfirmDeactivate(null);
        }}
      />
    </>
  );
}

