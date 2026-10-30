import { ChevronRight, Mail, Plus, Search, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Pill, Tabs } from '../../components/approvals/ApprovalQueueParts';
import { ManagerSetting, MoveTeam, TeamList } from '../../components/admin/ManagerSetting';
import UserImportDialog from '../../components/admin/UserImportDialog';
import { roleAccent, roleChip } from '../../components/layout/roleAccent';
import { BTN_GHOST, BTN_MAIN, BTN_NO, BTN_SM, CARD, EYEBROW, FIELD, LABEL } from '../../components/policy/PolicyAdminParts';
import { CLAIM_STAGE } from '../../components/reports/statusPalette';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useToast from '../../hooks/useToast';
import { usePagination } from '../../hooks/usePagination';
import { adminApi } from '../../services/adminApi';
import { reimbursementApi } from '../../services/reimbursementApi';
import { formatRole } from '../../utils/formatters';

// A role is someone's job; being a manager is the separate Manager setting (is_manager), so
// Reporting Manager is no longer a role. Older CSV files may still say REPORTING_MANAGER — it's
// read as Employee + Manager.
const ROLES = ['EMPLOYEE', 'HRBP_HR', 'PAYROLL', 'FINANCE', 'IT_ADMIN', 'CEO', 'GROUP_HEAD_HR', 'RECRUITER', 'ADMIN'];
const IMPORT_ROLES = [...ROLES, 'REPORTING_MANAGER'];

const CLAIM_KIND = { TRAVEL: 'Travel', GENERAL: 'General', RELOCATION: 'Relocation' };

const CLAIM_TONE = {
  PAID: 'ok',
  READY_FOR_PAYMENT: 'sky',
  SUBMITTED: 'sky',
  IN_APPROVAL: 'sky',
  PENDING_EXCEPTION: 'amber',
  ON_HOLD: 'slate',
  SENT_BACK: 'rose',
  REJECTED: 'rose',
  DRAFT: 'slate',
};

// Everyone added starts with this and sets their own at their first sign-in (backend welcome_service).
const TEMPORARY_PASSWORD = 'Welcome@123';

const EMPTY_CREATE = {
  email: '',
  full_name: '',
  send_welcome_email: true,
  role: 'EMPLOYEE',
  employee_id: '',
  impact_level_id: '',
  reporting_manager_id: '',
  department: '',
  is_manager: false,
};

function localIsoDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The version whose effective window covers today — same rule as the backend's
 * get_active_policy_version, which ignores status (an archived version can still be in force). */
function policyInForce(versions) {
  const today = localIsoDate();
  return (versions || [])
    .filter((v) => v.effective_from && v.effective_from <= today && (!v.effective_to || v.effective_to >= today))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.id - a.id)[0];
}

const initials = (name, email) => {
  const parts = (name || email || 'U').trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
};
const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const errorText = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};
const FILTER = FIELD.replace('w-full', '');
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Avatar({ user, large = false }) {
  return (
    <span
      className={`grid flex-none place-items-center rounded-full font-extrabold text-white ${roleAccent(user.role)} ${large ? 'h-12 w-12 text-base' : 'h-[34px] w-[34px] text-xs'}`}
    >
      {initials(user.full_name, user.email)}
    </span>
  );
}

function RolePill({ role }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${roleChip(role)}`}>{formatRole(role)}</span>;
}

function ManagerPill({ count }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
      Manager{count ? ` · ${count}` : ''}
    </span>
  );
}

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-brand' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

function Fact({ label, children, wide = false }) {
  return (
    <div className={wide ? 'col-span-full' : ''}>
      <span className="block text-[11px] font-semibold text-slate-500">{label}</span>
      <b className="text-[12.5px] font-bold text-ink">{children}</b>
    </div>
  );
}

function Group({ children }) {
  return <div className={`${EYEBROW} col-span-full mt-1`}>{children}</div>;
}

export default function UserManagement() {
  useSetPageTitle('User Management');
  const { showToast } = useToast();
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [delegationEnabled, setDelegationEnabled] = useState(false);
  const [delegationBusy, setDelegationBusy] = useState(false);
  const [impactLevels, setImpactLevels] = useState([]);
  const [activePolicyId, setActivePolicyId] = useState(null);
  const [reportingManagers, setReportingManagers] = useState([]);
  const [officeLocations, setOfficeLocations] = useState([]);
  // The company's departments (Company profile page).
  const [departmentList, setDepartmentList] = useState([]);

  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [managerFilter, setManagerFilter] = useState('');

  // The side panel: null, { mode: 'view' | 'edit', userId }, or { mode: 'add' }.
  const [panel, setPanel] = useState(null);
  const [panelAnim, setPanelAnim] = useState('enter');
  const [leaving, setLeaving] = useState(false);
  const panelRef = useRef(null);
  const leaveTimer = useRef(null);

  const [editForm, setEditForm] = useState({});
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [resending, setResending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [recentClaims, setRecentClaims] = useState(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [reactivating, setReactivating] = useState(null);
  // A manager being deactivated whose people have to be moved first.
  const [moveBeforeDeactivate, setMoveBeforeDeactivate] = useState(null);
  const [movedNote, setMovedNote] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const loadManagers = useCallback(() => {
    adminApi
      .getReportingManagers()
      .then((res) => setReportingManagers(res.data || []))
      .catch(() => {});
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setLoadError('');
      const res = await adminApi.users({ limit: 200 });
      setUsers(res.data || []);
      return res.data || [];
    } catch (err) {
      setUsers((current) => current || []);
      setLoadError(errorText(err, 'Could not load users.'));
    }
  }, []);

  useEffect(() => {
    loadUsers();
    adminApi
      .delegationConfig()
      .then((res) => setDelegationEnabled(Boolean(res.data?.enabled)))
      .catch(() => {});
    Promise.all([adminApi.impactLevels(), adminApi.policyVersions()])
      .then(([levelRes, policyRes]) => {
        setImpactLevels(levelRes.data || []);
        const active = policyInForce(policyRes.data) || (policyRes.data || []).find((p) => p.status === 'ACTIVE');
        if (active) setActivePolicyId(active.id);
      })
      .catch(() => {});
    loadManagers();
    adminApi
      .companyProfile()
      .then((res) => {
        setOfficeLocations(res.data?.office_locations || []);
        setDepartmentList(res.data?.departments || []);
      })
      .catch(() => {});
  }, [loadUsers, loadManagers]);

  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const all = useMemo(() => users || [], [users]);
  const levelsInForce = impactLevels.filter((l) => l.policy_version_id === activePolicyId && !l.is_deprecated);
  const levelById = (id) => (id ? impactLevels.find((l) => l.id === Number(id)) || null : null);
  const ceoLevel = () => levelsInForce.find((l) => l.level_code === 'L1') || [...impactLevels].reverse().find((l) => l.level_code === 'L1');
  const managerName = (user) => {
    if (!user.reporting_manager_id) return null;
    const match = all.find((u) => u.employee_id === user.reporting_manager_id) || reportingManagers.find((m) => m.employee_id === user.reporting_manager_id);
    return match ? match.full_name || match.email : user.reporting_manager_id;
  };
  const departments = [...new Set(all.map((u) => u.department).filter(Boolean))].sort();
  // Active people who report to this user.
  const teamOf = (user) => (user?.employee_id ? all.filter((u) => u.is_active && u.reporting_manager_id === user.employee_id) : []);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (u) =>
        (!q || [u.full_name, u.email, u.employee_id].some((v) => String(v || '').toLowerCase().includes(q))) &&
        (!roleFilter || u.role === roleFilter) &&
        (!deptFilter || u.department === deptFilter) &&
        (!levelFilter || String(u.impact_level_id) === levelFilter) &&
        (!managerFilter || (managerFilter === 'yes') === Boolean(u.is_manager)),
    );
  }, [all, query, roleFilter, deptFilter, levelFilter, managerFilter]);
  const shown = useMemo(() => matching.filter((u) => tab === 'all' || (tab === 'active' ? u.is_active : !u.is_active)), [matching, tab]);
  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(shown);

  const selected = panel && panel.mode !== 'add' ? all.find((u) => u.user_id === panel.userId) : null;
  const panelOpen = Boolean(panel && (panel.mode === 'add' || selected));
  const noLevel = all.filter((u) => !u.impact_level_id).length;

  // Bring the panel into view when it opens below the list (narrow screens); leave the page alone otherwise.
  const panelKey = panel ? `${panel.mode}-${panel.userId ?? ''}` : '';
  useEffect(() => {
    if (!panelKey) return;
    const el = panelRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight - 120) el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [panelKey]);

  const openPanel = (next) => {
    clearTimeout(leaveTimer.current);
    setLeaving(false);
    setPanelAnim(panelOpen ? 'swap' : 'enter');
    setPanelError('');
    setPanel(next);
  };

  const openUser = (user) => {
    openPanel({ mode: 'view', userId: user.user_id });
    setRecentClaims(null);
    reimbursementApi
      .claims({ employee_user_id: user.user_id })
      .then((res) => setRecentClaims((res.data || []).slice(0, 3)))
      .catch(() => setRecentClaims([]));
  };

  const startEdit = () => {
    setEditForm({
      full_name: selected.full_name || '',
      email: selected.email || '',
      employee_id: selected.employee_id || '',
      role: selected.role || 'EMPLOYEE',
      impact_level_id: selected.impact_level_id || '',
      department: selected.department || '',
      office_location: selected.office_location || '',
      reporting_manager_id: selected.reporting_manager_id || '',
      is_manager: Boolean(selected.is_manager),
    });
    setMovedNote('');
    openPanel({ mode: 'edit', userId: selected.user_id });
  };

  const startAdd = () => {
    setCreateForm(EMPTY_CREATE);
    openPanel({ mode: 'add' });
  };

  // Slide the panel out, then remove it.
  const closePanel = () => {
    if (!panelOpen || leaving) return;
    if (reducedMotion()) {
      setPanel(null);
      return;
    }
    setLeaving(true);
    leaveTimer.current = setTimeout(() => {
      setLeaving(false);
      setPanel(null);
    }, 280);
  };

  // The CEO is always level L1 and always a manager.
  const withCeoLevel = (form, role) => {
    const next = { ...form, role };
    if (role === 'CEO') {
      const l1 = ceoLevel();
      if (l1) next.impact_level_id = l1.id;
      next.is_manager = true;
    }
    return next;
  };

  // People were moved off a manager (before turning Manager off or deactivating them).
  const afterTeamMoved = async (user, { name, count, waiting }) => {
    await loadUsers();
    loadManagers();
    const what = `${count} ${count === 1 ? 'person' : 'people'}${waiting ? ` and ${waiting} waiting ${waiting === 1 ? 'item' : 'items'}` : ''}`;
    showToast(`Moved ${what} to ${name}.`, 'success');
    return what;
  };

  const toggleDelegation = async (next) => {
    setDelegationBusy(true);
    try {
      const res = await adminApi.updateDelegationConfig({ enabled: next });
      setDelegationEnabled(Boolean(res.data?.enabled));
      showToast(next ? 'Delegation turned on.' : 'Delegation turned off. Existing handovers are paused.', 'success');
    } catch (err) {
      showToast(errorText(err, 'Could not change delegation.'), 'error');
    } finally {
      setDelegationBusy(false);
    }
  };

  const saveEdit = async () => {
    setSaving(true);
    setPanelError('');
    try {
      // Role changes go through the role endpoint, which records them in the audit log.
      if (editForm.role !== selected.role) await adminApi.changeUserRole(selected.user_id, editForm.role);
      await adminApi.updateUser(selected.user_id, {
        full_name: editForm.full_name.trim() || null,
        email: editForm.email.trim() || null,
        employee_id: editForm.employee_id.trim() || null,
        impact_level_id: editForm.impact_level_id ? Number(editForm.impact_level_id) : null,
        department: editForm.department.trim() || null,
        office_location: editForm.office_location.trim() || null,
        // Blank clears the manager.
        reporting_manager_id: editForm.reporting_manager_id || '',
        is_manager: editForm.role === 'CEO' ? true : editForm.is_manager,
      });
      await loadUsers();
      loadManagers();
      showToast(`Saved ${editForm.full_name.trim() || selected.email}.`, 'success');
      openPanel({ mode: 'view', userId: selected.user_id });
    } catch (err) {
      setPanelError(errorText(err, 'Could not save the changes.'));
      await loadUsers();
    } finally {
      setSaving(false);
    }
  };

  const saveCreate = async (event) => {
    event.preventDefault();
    setSaving(true);
    setPanelError('');
    const payload = {
      email: createForm.email.trim(),
      send_welcome_email: createForm.send_welcome_email,
      full_name: createForm.full_name.trim() || null,
      role: createForm.role,
      employee_id: createForm.employee_id.trim() || null,
      impact_level_id: createForm.impact_level_id ? Number(createForm.impact_level_id) : null,
      reporting_manager_id: createForm.reporting_manager_id || null,
      department: createForm.department.trim() || null,
      is_manager: createForm.role === 'CEO' ? true : createForm.is_manager,
    };
    try {
      const res = await adminApi.createUser(payload);
      const fresh = await loadUsers();
      loadManagers();
      const added = (fresh || []).find((u) => u.user_id === res.data?.id);
      const who = payload.full_name || payload.email;
      if (!payload.send_welcome_email) showToast(`Added ${who}.`, 'success');
      else if (added?.welcome_email_sent_at) showToast(`Added ${who} and sent their welcome email.`, 'success');
      else showToast(`Added ${who}, but the welcome email couldn't be sent — try Resend on their profile.`, 'error');
      if (res.data?.id) openUser({ user_id: res.data.id });
      else closePanel();
    } catch (err) {
      setPanelError(errorText(err, 'Could not add this user.'));
    } finally {
      setSaving(false);
    }
  };

  const resendWelcome = async (user) => {
    setResending(true);
    try {
      await adminApi.resendWelcomeEmail(user.user_id);
      await loadUsers();
      showToast(`Welcome email sent to ${user.email}.`, 'success');
    } catch (err) {
      showToast(errorText(err, 'Could not send the welcome email.'), 'error');
    } finally {
      setResending(false);
    }
  };

  // Why this person can't go back to their recorded manager, or null. The server checks again.
  const managerIssue = (user) => {
    if (!user?.reporting_manager_id) return null;
    const manager = all.find((u) => u.employee_id === user.reporting_manager_id);
    if (!manager) return null;
    const name = manager.full_name || manager.email;
    if (!manager.is_active) return `${name} is deactivated`;
    if (!manager.is_manager) return `${name} isn't a manager any more`;
    return null;
  };
  const openReactivate = (user) => {
    const issue = managerIssue(user);
    setReactivating({ user, issue, managerId: '', saving: false, error: '' });
  };
  const reactivate = async () => {
    const { user, issue, managerId } = reactivating;
    setReactivating((r) => ({ ...r, saving: true, error: '' }));
    try {
      await adminApi.reactivateUser(user.user_id, issue ? { reporting_manager_id: managerId } : {});
      await loadUsers();
      setReactivating(null);
      showToast(`${user.full_name || user.email} can sign in again.`, 'success');
    } catch (err) {
      const text = errorText(err, 'Could not reactivate this user.');
      // The server found a manager problem the page didn't know about: ask for a new manager.
      const needsManager = err?.response?.status === 409 && /Pick a new manager/.test(text);
      setReactivating((r) => ({ ...r, saving: false, error: text, issue: needsManager ? text.replace(/^Pick a new manager for them first — /, '') : r.issue }));
    }
  };

  const deactivate = async (user) => {
    setConfirmDeactivate(null);
    try {
      await adminApi.deactivateUser(user.user_id);
      await loadUsers();
      showToast(`${user.full_name || user.email} is now inactive.`, 'success');
    } catch (err) {
      showToast(errorText(err, 'Could not deactivate this user.'), 'error');
    }
  };

  const levelOptions = (current) =>
    impactLevels
      .filter((l) => (l.policy_version_id === activePolicyId && !l.is_deprecated) || l.id === Number(current))
      .map((l) => (
        <option key={l.id} value={l.id}>
          {l.level_code} · {l.level_name}
          {l.policy_version_id !== activePolicyId ? ' (older policy)' : ''}
        </option>
      ));
  // Anyone can be a manager, whatever their role — just not their own.
  const managerOptions = (selfEmployeeId) =>
    reportingManagers
      .filter((m) => m.employee_id !== selfEmployeeId)
      .map((m) => (
        <option key={m.employee_id} value={m.employee_id}>
          {m.full_name} ({m.employee_id})
        </option>
      ));

  let panelBody = null;
  if (panel?.mode === 'add') {
    panelBody = (
      <form onSubmit={saveCreate} className="contents">
        <PanelHead title="Add user" sub="They sign in with this email and password." onClose={closePanel} />
        <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 px-4 py-3.5 sm:grid-cols-2">
          <Group>Sign-in</Group>
          <label className="block">
            <span className={LABEL}>Full name</span>
            <input className={FIELD} value={createForm.full_name} onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })} />
          </label>
          <label className="block">
            <span className={LABEL}>Work email *</span>
            <input type="email" required className={FIELD} value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
          </label>
          <div className="col-span-full rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
            They start with the password <b className="font-mono text-ink">{TEMPORARY_PASSWORD}</b> and must set their own the first time they sign in.
          </div>
          <Group>Role &amp; level</Group>
          <label className="block">
            <span className={LABEL}>Role</span>
            <select className={FIELD} value={createForm.role} onChange={(e) => setCreateForm(withCeoLevel(createForm, e.target.value))}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {formatRole(r)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-slate-400">CEO is always level L1.</span>
          </label>
          <label className="block">
            <span className={LABEL}>Impact level</span>
            <select className={FIELD} value={createForm.impact_level_id} onChange={(e) => setCreateForm({ ...createForm, impact_level_id: e.target.value })}>
              <option value="">Not set</option>
              {levelOptions(createForm.impact_level_id)}
            </select>
          </label>
          <ManagerSetting
            name={createForm.full_name.trim()}
            value={createForm.role === 'CEO' || createForm.is_manager}
            locked={createForm.role === 'CEO'}
            onChange={(next) => setCreateForm({ ...createForm, is_manager: next })}
          />
          <label className="col-span-full block">
            <span className={LABEL}>Reporting manager</span>
            <select className={FIELD} value={createForm.reporting_manager_id} onChange={(e) => setCreateForm({ ...createForm, reporting_manager_id: e.target.value })}>
              <option value="">None</option>
              {managerOptions(createForm.employee_id)}
            </select>
          </label>
          <Group>Work details</Group>
          <label className="block">
            <span className={LABEL}>Department</span>
            <select className={FIELD} value={createForm.department} onChange={(e) => setCreateForm({ ...createForm, department: e.target.value })}>
              <option value="">Not set</option>
              {departmentList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Employee ID</span>
            <input className={FIELD} placeholder="Optional" value={createForm.employee_id} onChange={(e) => setCreateForm({ ...createForm, employee_id: e.target.value })} />
            <span className="mt-1 block text-[11px] text-slate-400">An employee profile is made if needed.</span>
          </label>
          <label className="col-span-full flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-slate-200 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 flex-none accent-brand"
              checked={createForm.send_welcome_email}
              onChange={(e) => setCreateForm({ ...createForm, send_welcome_email: e.target.checked })}
            />
            <span className="text-[12.5px] font-semibold text-ink">
              Send welcome email
              <span className="mt-0.5 block text-[11.5px] font-medium text-slate-500">
                Emails {createForm.full_name.trim().split(/\s+/)[0] || 'them'} their sign-in details and how to get started.
              </span>
            </span>
          </label>
          {panelError ? <PanelError>{panelError}</PanelError> : null}
        </div>
        <PanelFoot>
          <button type="button" className={BTN_GHOST} onClick={closePanel}>
            Cancel
          </button>
          <button type="submit" className={BTN_MAIN} disabled={saving}>
            <Plus size={14} />
            {saving ? 'Adding…' : 'Add user'}
          </button>
        </PanelFoot>
      </form>
    );
  } else if (panel?.mode === 'edit' && selected) {
    const noProfile = !selected.employee_id;
    const team = teamOf(selected);
    const isCeo = editForm.role === 'CEO';
    // Turning Manager off while people still report to them: move them first.
    const mustMove = selected.is_manager && !isCeo && !editForm.is_manager && team.length > 0;
    panelBody = (
      <>
        <PanelHead title={`Edit ${selected.full_name || selected.email}`} sub={selected.email} onClose={closePanel} />
        <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 px-4 py-3.5 sm:grid-cols-2">
          <label className="col-span-full block">
            <span className={LABEL}>Full name</span>
            <input className={FIELD} value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
          </label>
          <label className="block">
            <span className={LABEL}>Email</span>
            <input type="email" className={FIELD} value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            <span className="mt-1 block text-[11px] text-slate-400">Also their login and where password resets go.</span>
          </label>
          <label className="block">
            <span className={LABEL}>Employee ID</span>
            <input
              className={FIELD}
              disabled={noProfile}
              value={editForm.employee_id}
              onChange={(e) => setEditForm({ ...editForm, employee_id: e.target.value })}
            />
            <span className="mt-1 block text-[11px] text-slate-400">
              Used everywhere as their identifier (manager, claims, trips) — everything follows if you change it. Only do this to fix a genuine mistake.
            </span>
          </label>
          <Group>Role &amp; level</Group>
          <label className="block">
            <span className={LABEL}>Role</span>
            <select className={FIELD} value={editForm.role} onChange={(e) => setEditForm(withCeoLevel(editForm, e.target.value))}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {formatRole(r)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-slate-400">CEO is always level L1.</span>
          </label>
          <ManagerSetting
            name={selected.full_name || selected.email}
            value={isCeo || editForm.is_manager}
            locked={isCeo}
            team={team}
            onChange={(next) => {
              setMovedNote('');
              setEditForm({ ...editForm, is_manager: next });
            }}
          />
          {mustMove ? (
            <MoveTeam
              user={selected}
              team={team}
              managers={reportingManagers}
              errorText={errorText}
              onMoved={async (result) => {
                const what = await afterTeamMoved(selected, result);
                setMovedNote(`Moved ${what} to ${result.name}. Save to finish turning Manager off.`);
              }}
            />
          ) : null}
          {movedNote && !mustMove ? (
            <div className="col-span-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">✓ {movedNote}</div>
          ) : null}
          {noProfile ? (
            <div className="col-span-full rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This account has no employee profile, so its level, manager, department and office can&apos;t be set here.
            </div>
          ) : null}
          <label className="block">
            <span className={LABEL}>Impact level</span>
            <select className={FIELD} disabled={noProfile} value={editForm.impact_level_id} onChange={(e) => setEditForm({ ...editForm, impact_level_id: e.target.value })}>
              <option value="">Not set</option>
              {levelOptions(editForm.impact_level_id)}
            </select>
          </label>
          <label className="col-span-full block">
            <span className={LABEL}>Reporting manager</span>
            <select className={FIELD} disabled={noProfile} value={editForm.reporting_manager_id} onChange={(e) => setEditForm({ ...editForm, reporting_manager_id: e.target.value })}>
              <option value="">None</option>
              {managerOptions(selected?.employee_id)}
            </select>
          </label>
          <Group>Work details</Group>
          <label className="block">
            <span className={LABEL}>Department</span>
            <select className={FIELD} disabled={noProfile} value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}>
              <option value="">Not set</option>
              {/* Someone in a department since taken off the list still sees theirs. */}
              {[...new Set([...departmentList, editForm.department].filter(Boolean))].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Office</span>
            <select className={FIELD} disabled={noProfile} value={editForm.office_location} onChange={(e) => setEditForm({ ...editForm, office_location: e.target.value })}>
              <option value="">Not set</option>
              {[...new Set([...officeLocations, editForm.office_location].filter(Boolean))].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          {panelError ? <PanelError>{panelError}</PanelError> : null}
        </div>
        <PanelFoot>
          <button type="button" className={BTN_GHOST} onClick={() => openPanel({ mode: 'view', userId: selected.user_id })}>
            Cancel
          </button>
          <button type="button" className={BTN_MAIN} onClick={saveEdit} disabled={saving || mustMove} title={mustMove ? 'Move their people first' : undefined}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </PanelFoot>
      </>
    );
  } else if (selected) {
    const level = levelById(selected.impact_level_id);
    const manager = managerName(selected);
    const team = teamOf(selected);
    panelBody = (
      <>
        <PanelHead title="Profile" onClose={closePanel} />
        <div className="flex flex-col gap-3.5 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Avatar user={selected} large />
            <div className="min-w-0">
              <b className="block truncate text-base text-ink">{selected.full_name || selected.email}</b>
              <span className="block truncate text-xs text-slate-500">{selected.email}</span>
              <div className="mt-1 flex flex-wrap gap-[5px]">
                <RolePill role={selected.role} />
                {selected.is_manager ? <ManagerPill /> : null}
                {selected.must_change_password && selected.is_active ? <Pill tone="amber">Waiting for first sign-in</Pill> : null}
                <Pill tone={selected.is_active ? 'ok' : 'slate'}>{selected.is_active ? 'Active' : 'Inactive'}</Pill>
              </div>
            </div>
          </div>
          {selected.must_change_password && selected.is_active ? (
            <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
              <div>
                <b className="text-ink">Hasn&apos;t signed in yet.</b> Their password is still <span className="font-mono">{TEMPORARY_PASSWORD}</span>.{' '}
                {selected.welcome_email_sent_at
                  ? `Welcome email sent ${new Date(selected.welcome_email_sent_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`
                  : 'Their welcome email hasn’t been sent.'}
              </div>
              <div>
                <button type="button" className={BTN_SM} disabled={resending} onClick={() => resendWelcome(selected)}>
                  <Mail size={13} />
                  {resending ? 'Sending…' : selected.welcome_email_sent_at ? 'Resend welcome email' : 'Send welcome email'}
                </button>
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-x-3.5 gap-y-3 sm:grid-cols-2">
            <Fact label="Employee ID">
              <span className="font-mono">{selected.employee_id || '—'}</span>
            </Fact>
            <Fact label="Impact level">
              {level ? (
                <>
                  {level.level_code} · {level.level_name}
                  {level.policy_version_id !== activePolicyId ? <span className="font-semibold text-slate-400"> (older policy)</span> : null}
                </>
              ) : (
                <Pill tone="amber">Not set</Pill>
              )}
            </Fact>
            <Fact label="Department">{selected.department || '—'}</Fact>
            <Fact label="Office">{selected.office_location || '—'}</Fact>
            <Fact label="Reporting manager" wide>
              {manager ? (
                <>
                  {manager} <span className="font-semibold text-slate-400">({selected.reporting_manager_id})</span>
                </>
              ) : (
                '—'
              )}
            </Fact>
          </div>
          {selected.is_manager ? (
            <div>
              <div className={`${EYEBROW} mb-0.5`}>Manager</div>
              <TeamList team={team} />
            </div>
          ) : null}
          <div>
            <div className={`${EYEBROW} mb-1.5`}>Recent claims</div>
            {recentClaims === null ? (
              <Skeleton variant="table" rows={2} columns={1} />
            ) : recentClaims.length ? (
              recentClaims.map((c, i) => (
                <div key={c.id} className={`flex items-center justify-between gap-2.5 py-2 ${i ? 'border-t border-slate-100' : ''}`}>
                  <div className="min-w-0">
                    <b className="block text-[12.5px] text-ink">{c.claim_reference || `Draft #${c.id}`}</b>
                    <span className="text-[11.5px] text-slate-500">
                      {CLAIM_KIND[c.reimbursement_category] || 'Claim'}
                      {c.submitted_at ? ` · ${day(c.submitted_at)}` : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2.5">
                    <Pill tone={CLAIM_TONE[c.status] || 'slate'}>{CLAIM_STAGE[c.status]?.[0] || formatRole(c.status)}</Pill>
                    <span className="font-mono text-xs text-ink">{money(c.compliance_report?.total_claimed)}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-1.5 text-[12.5px] text-slate-500">No claims yet.</p>
            )}
          </div>
        </div>
        <PanelFoot>
          {selected.is_active ? (
            <button
              type="button"
              className={BTN_NO}
              onClick={() => (team.length ? setMoveBeforeDeactivate(selected) : setConfirmDeactivate(selected))}
            >
              Deactivate
            </button>
          ) : (
            <button type="button" className={BTN_GHOST} onClick={() => openReactivate(selected)}>
              Reactivate
            </button>
          )}
          <button type="button" className={BTN_MAIN} onClick={startEdit}>
            Edit
          </button>
        </PanelFoot>
      </>
    );
  }

  const enterAnim = panelAnim === 'swap' ? 'animate-sheet-swap' : 'animate-sheet-up lg:animate-sheet-in';
  const anim = leaving ? 'animate-sheet-down lg:animate-sheet-out pointer-events-none' : enterAnim;

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Users</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">Add people and set their role, manager setting, impact level and reporting manager.</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          {[
            ['People', all.length],
            ['Managers', all.filter((u) => u.is_active && u.is_manager).length],
            ['Active', all.filter((u) => u.is_active).length],
            ['No level set', noLevel, noLevel ? 'text-amber-700' : ''],
          ].map(([label, value, tone]) => (
            <div key={label} className="min-w-[96px] rounded-xl border border-slate-200 bg-white px-3 py-[7px]">
              <b className={`block text-[17px] ${tone || 'text-ink'}`}>{users ? value : '—'}</b>
              <span className="text-[11.5px] font-semibold text-slate-500">{label}</span>
            </div>
          ))}
          <button type="button" className={`${BTN_GHOST} h-auto min-h-[52px] rounded-xl px-4`} onClick={() => setImportOpen(true)}>
            <Upload size={14} />
            Import from CSV
          </button>
          <button type="button" className={`${BTN_MAIN} h-auto min-h-[52px] rounded-xl px-4`} onClick={startAdd}>
            <Plus size={15} />
            Add user
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3.5 rounded-[14px] border border-slate-200 bg-white px-4 py-[11px]">
        <div>
          <b className="text-[13.5px] text-ink">Delegation</b>
          <p className="mt-0.5 max-w-[80ch] text-xs text-slate-500">
            Lets people hand their approvals to someone while they&apos;re away (Profile → Out of office). Turning it off pauses every handover straight away;
            nothing is deleted.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-500">
          {delegationEnabled ? 'On' : 'Off'}
          <Switch checked={delegationEnabled} onChange={toggleDelegation} disabled={delegationBusy} label="Delegation" />
        </span>
      </div>

      {loadError ? (
        <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
          {loadError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-2.5 border-b border-slate-200">
        <div className="-mb-px min-w-0 [&>div]:border-b-0">
          <Tabs
            label="Status"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'active', label: 'Active', count: matching.filter((u) => u.is_active).length },
              { key: 'inactive', label: 'Inactive', count: matching.filter((u) => !u.is_active).length },
              { key: 'all', label: 'All', count: matching.length },
            ]}
          />
        </div>
        <div className="mb-1.5 flex w-full flex-wrap gap-2 lg:w-auto">
          <label className="relative w-full sm:w-[240px]">
            <span className="sr-only">Search users</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${FILTER} w-full pl-8`} placeholder="Search name, email or employee ID" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <select aria-label="Role" className={`${FILTER} min-w-0 flex-1 sm:w-auto sm:flex-none`} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">Any role</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {formatRole(r)}
              </option>
            ))}
          </select>
          <select aria-label="Manager" className={`${FILTER} min-w-0 flex-1 sm:w-auto sm:flex-none`} value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}>
            <option value="">Managers and others</option>
            <option value="yes">Managers only</option>
            <option value="no">Not managers</option>
          </select>
          <select aria-label="Department" className={`${FILTER} min-w-0 flex-1 sm:w-auto sm:flex-none`} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">Any department</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select aria-label="Impact level" className={`${FILTER} w-full sm:w-auto`} value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
            <option value="">Any level</option>
            {levelsInForce.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.level_code} · {l.level_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={`grid items-start gap-3.5 ${panelOpen ? 'lg:grid-cols-[minmax(0,1fr)_400px]' : ''}`}>
        <section aria-label="Users" className={CARD}>
          {users === null ? (
            <div className="p-4">
              <Skeleton variant="table" rows={6} columns={1} />
            </div>
          ) : pageItems.length ? (
            pageItems.map((u, i) => {
              const level = levelById(u.impact_level_id);
              const manager = managerName(u);
              const on = selected?.user_id === u.user_id;
              const wide = panelOpen ? 'hidden' : 'hidden lg:block';
              return (
                <button
                  key={u.user_id}
                  type="button"
                  onClick={() => openUser(u)}
                  aria-current={on || undefined}
                  className={`grid w-full items-center gap-3 border-l-[3px] py-[11px] pl-2.5 pr-4 text-left ${i ? 'border-t border-t-slate-100' : ''} ${
                    on ? 'border-l-brand bg-brand/[0.07]' : 'border-l-transparent hover:bg-slate-50'
                  } ${
                    panelOpen
                      ? 'grid-cols-[18px_minmax(0,1fr)_auto] lg:grid-cols-[18px_minmax(0,1fr)_auto_14px]'
                      : 'grid-cols-[18px_minmax(0,1fr)_auto] lg:grid-cols-[18px_minmax(0,1.5fr)_190px_170px_minmax(0,1fr)_70px_14px]'
                  }`}
                >
                  <span className="text-right font-mono text-[11.5px] font-semibold text-slate-400">{startIndex + i + 1}</span>
                  <span className="flex min-w-0 items-center gap-[11px]">
                    <Avatar user={u} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-bold text-ink">{u.full_name || u.email}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {u.email}
                        {u.employee_id ? (
                          <>
                            {' · '}
                            <span className="font-mono">{u.employee_id}</span>
                          </>
                        ) : null}
                        {u.department ? ` · ${u.department}` : ''}
                        {u.office_location ? ` · ${u.office_location}` : ''}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-wrap justify-end gap-[5px] lg:justify-start">
                    <RolePill role={u.role} />
                    {u.is_manager ? <ManagerPill count={teamOf(u).length} /> : null}
                  </span>
                  <span className={`${wide} truncate`}>
                    {level ? (
                      <span title={level.level_name}>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-ink">{level.level_code}</span>{' '}
                        <span className="text-[11.5px] text-slate-500">{level.level_name}</span>
                      </span>
                    ) : (
                      <Pill tone="amber">No level</Pill>
                    )}
                  </span>
                  <span className={`${wide} truncate text-[12.5px] text-slate-700`}>
                    {manager ? (
                      <>
                        <span className="text-slate-400">Reports to</span> {manager}
                      </>
                    ) : (
                      <span className="text-slate-400">No manager</span>
                    )}
                  </span>
                  <span className={`${wide} text-right`}>
                    <Pill tone={u.is_active ? 'ok' : 'slate'}>{u.is_active ? 'Active' : 'Inactive'}</Pill>
                  </span>
                  <ChevronRight size={14} className="hidden text-slate-400 lg:block" />
                </button>
              );
            })
          ) : (
            <div className="px-4 py-9 text-center text-[13px] text-slate-500">
              <b className="mb-1 block text-sm text-ink">{all.length ? 'Nobody here' : 'No users yet'}</b>
              {all.length ? 'Try another tab, search or filter.' : 'Add someone, or import a CSV file.'}
            </div>
          )}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
        </section>

        {panelOpen ? (
          <aside
            key={panelKey}
            ref={panelRef}
            aria-label={panel.mode === 'add' ? 'Add user' : 'User profile'}
            className={`${CARD} scroll-mt-20 origin-top motion-reduce:animate-none lg:sticky lg:top-[calc(var(--app-nav-h,56px)+12px)] lg:origin-right ${anim}`}
          >
            {panelBody}
          </aside>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(confirmDeactivate)}
        title="Deactivate this user?"
        description={confirmDeactivate ? `${confirmDeactivate.full_name || confirmDeactivate.email} won't be able to sign in. You can reactivate them later from their details here.` : ''}
        confirmLabel="Deactivate"
        confirmVariant="danger"
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() => confirmDeactivate && deactivate(confirmDeactivate)}
      />
      {reactivating ? (
        <div className="fixed inset-0 z-[95] grid grid-cols-[minmax(0,1fr)] place-items-center bg-slate-900/40 p-4" onMouseDown={() => !reactivating.saving && setReactivating(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Reactivate ${reactivating.user.full_name || reactivating.user.email}`}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex w-[min(460px,100%)] min-w-0 animate-sheet-up flex-col gap-3 rounded-[14px] border border-slate-200 bg-white p-4 shadow-[0_30px_60px_-24px_rgba(15,23,42,0.35)] motion-reduce:animate-none"
          >
            <div>
              <b className="text-sm text-ink">Reactivate {reactivating.user.full_name || reactivating.user.email}?</b>
              <p className="mt-0.5 text-xs text-slate-500">They’ll be able to sign in again with their old password. If they’ve forgotten it, they can use Forgot password.</p>
            </div>
            {reactivating.user.reporting_manager_id ? (
              reactivating.issue ? (
                <div className="flex flex-col gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2.5">
                  <p className="text-xs leading-relaxed text-amber-900">
                    <b>Their manager, {managerName(reactivating.user)}, can’t have them any more</b> — {reactivating.issue}. Pick who they’ll report to now.
                  </p>
                  <label className={LABEL} htmlFor="reactivate-manager">
                    New manager
                  </label>
                  <select
                    id="reactivate-manager"
                    className={FIELD}
                    value={reactivating.managerId}
                    onChange={(e) => setReactivating((r) => ({ ...r, managerId: e.target.value, error: '' }))}
                  >
                    <option value="">Choose a manager…</option>
                    {reportingManagers
                      .filter((m) => m.employee_id !== reactivating.user.employee_id && m.employee_id !== reactivating.user.reporting_manager_id)
                      .filter((m) => {
                        const known = all.find((u) => u.employee_id === m.employee_id);
                        return !known || known.is_active;
                      })
                      .map((m) => (
                        <option key={m.employee_id} value={m.employee_id}>
                          {m.full_name} ({m.employee_id})
                        </option>
                      ))}
                  </select>
                </div>
              ) : (
                <p className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-slate-200 px-3 py-2.5 text-xs text-slate-600">
                  Manager: <b className="text-ink">{managerName(reactivating.user)}</b> <Pill tone="ok">Still active ✓</Pill>
                </p>
              )
            ) : (
              <p className="rounded-[10px] border border-slate-200 px-3 py-2.5 text-xs text-slate-600">They don’t report to anyone.</p>
            )}
            {reactivating.error && !reactivating.issue ? (
              <p role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {reactivating.error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN_GHOST} onClick={() => setReactivating(null)} disabled={reactivating.saving}>
                Cancel
              </button>
              <button
                type="button"
                className={BTN_MAIN}
                onClick={reactivate}
                disabled={reactivating.saving || (Boolean(reactivating.issue) && !reactivating.managerId)}
              >
                {reactivating.saving ? 'Reactivating…' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {moveBeforeDeactivate ? (
        <div className="fixed inset-0 z-[95] grid grid-cols-[minmax(0,1fr)] place-items-center bg-slate-900/40 p-4" onMouseDown={() => setMoveBeforeDeactivate(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Move their people first"
            onMouseDown={(e) => e.stopPropagation()}
            className="flex w-[min(460px,100%)] min-w-0 flex-col gap-3 rounded-[14px] border border-slate-200 bg-white p-4 shadow-[0_30px_60px_-24px_rgba(15,23,42,0.35)]"
          >
            <div>
              <b className="text-sm text-ink">Before deactivating {moveBeforeDeactivate.full_name || moveBeforeDeactivate.email}</b>
              <p className="mt-0.5 text-xs text-slate-500">The people who report to them need a new manager first.</p>
            </div>
            <MoveTeam
              user={moveBeforeDeactivate}
              team={teamOf(moveBeforeDeactivate)}
              managers={reportingManagers}
              errorText={errorText}
              onMoved={async (result) => {
                const user = moveBeforeDeactivate;
                await afterTeamMoved(user, result);
                setMoveBeforeDeactivate(null);
                setConfirmDeactivate(user);
              }}
            />
            <div className="flex justify-end">
              <button type="button" className={BTN_GHOST} onClick={() => setMoveBeforeDeactivate(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {importOpen ? (
        <UserImportDialog
          users={all}
          roles={IMPORT_ROLES}
          managerIds={reportingManagers.map((m) => m.employee_id)}
          levels={impactLevels}
          levelsInForce={levelsInForce}
          departments={departmentList}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            loadUsers();
            loadManagers();
            // The import may have added departments.
            adminApi
              .companyProfile()
              .then((res) => setDepartmentList(res.data?.departments || []))
              .catch(() => {});
          }}
        />
      ) : null}
    </section>
  );
}

function PanelHead({ title, sub, onClose }) {
  return (
    <div className="flex items-center justify-between gap-2.5 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0">
        <b className="block truncate text-sm text-ink">{title}</b>
        {sub ? <span className="block truncate text-xs text-slate-500">{sub}</span> : null}
      </div>
      <button type="button" aria-label="Close" className={BTN_SM} onClick={onClose}>
        <X size={13} />
      </button>
    </div>
  );
}

function PanelFoot({ children }) {
  return <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-[11px]">{children}</div>;
}

function PanelError({ children }) {
  return (
    <div role="alert" className="col-span-full rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
      {children}
    </div>
  );
}
