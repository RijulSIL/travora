import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import PageHeader from '../../components/ui/PageHeader';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import useToast from '../../hooks/useToast';
import { adminApi } from '../../services/adminApi';
import { hasPermission } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

// Matches permission_config_service.py's _IT_ADMIN_RECOVERY_PERMISSIONS — duplicated here only
// for the save-time confirmation prompt; the server re-validates this regardless (422 otherwise),
// this is just a friendlier heads-up before that round trip.
const IT_ADMIN_RECOVERY_PERMISSIONS = ['manage_users', 'view_permission_matrix', 'edit_permission_matrix'];

function labelize(token) {
  // Reporting Manager is no longer a role: its row is what the Manager setting (User management)
  // adds on top of anyone's role.
  if (token === 'REPORTING_MANAGER') return 'Manager';
  return String(token || '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function RoleCell({ role }) {
  return (
    <td className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-ink whitespace-nowrap">
      {labelize(role)}
      {role === 'REPORTING_MANAGER' ? <small className="block text-[11px] font-medium text-slate-500">Added to anyone with Manager = Yes</small> : null}
    </td>
  );
}

function errorMessage(err) {
  if (!err) return '';
  const d = err.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join('; ') || err.message;
  return err.message;
}

export default function PermissionMatrix() {
  useSetPageTitle('Role Permissions');
  const viewerPermissions = useAuthStore((s) => s.profile?.permissions);
  const isViewOnly = !hasPermission(viewerPermissions, 'edit_permission_matrix');
  const { showToast } = useToast();

  const [catalog, setCatalog] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [delegatable, setDelegatable] = useState({});
  const [loadError, setLoadError] = useState(null);
  // Snapshot of the config exactly as last loaded — diffed against what's about to be saved so we
  // can warn before IT_ADMIN loses the ability to administer users or fix this page itself.
  const [lastLoadedConfig, setLastLoadedConfig] = useState(null);

  const load = async () => {
    try {
      setLoadError(null);
      const res = await adminApi.permissionMatrix();
      const cfg = res.data?.config || { permissions: {}, delegatable_permissions: {} };
      setLastLoadedConfig(cfg);
      setCatalog(res.data?.catalog || null);
      setPermissions(cfg.permissions || {});
      setDelegatable(cfg.delegatable_permissions || {});
    } catch (err) {
      setLoadError(err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const togglePermission = (role, perm) => {
    if (isViewOnly) return;
    setPermissions((prev) => {
      const current = prev[role] || [];
      const has = current.includes(perm);
      const next = has ? current.filter((p) => p !== perm) : [...current, perm];
      return { ...prev, [role]: next };
    });
    // A permission that's no longer held can't stay delegatable either — keep the two grids
    // consistent immediately rather than only catching it server-side at save time.
    setDelegatable((prev) => {
      const current = prev[role] || [];
      if (!current.includes(perm)) return prev;
      const current2 = permissions[role] || [];
      if (!current2.includes(perm)) return prev; // already not held — nothing to strip
      return { ...prev, [role]: current.filter((p) => p !== perm) };
    });
  };

  const toggleDelegatable = (role, perm) => {
    if (isViewOnly) return;
    if (!(permissions[role] || []).includes(perm)) return; // can't delegate what the role doesn't hold
    setDelegatable((prev) => {
      const current = prev[role] || [];
      const has = current.includes(perm);
      const next = has ? current.filter((p) => p !== perm) : [...current, perm];
      return { ...prev, [role]: next };
    });
  };

  const saveAction = useAsyncAction(async () => {
    const config = {
      permissions: Object.fromEntries(
        Object.entries(permissions).map(([role, perms]) => [role, [...new Set(perms)].sort()])
      ),
      delegatable_permissions: Object.fromEntries(
        Object.entries(delegatable).map(([role, perms]) => [role, [...new Set(perms)].sort()])
      ),
    };

    if (lastLoadedConfig) {
      const before = new Set(lastLoadedConfig.permissions?.IT_ADMIN || []);
      const after = new Set(config.permissions.IT_ADMIN || []);
      const losing = IT_ADMIN_RECOVERY_PERMISSIONS.filter((p) => before.has(p) && !after.has(p));
      if (losing.length) {
        const proceed = window.confirm(
          `This save removes ${losing.map(labelize).join(', ')} from IT Admin. Without ${losing.length > 1 ? 'these' : 'this'}, no one could manage users or fix this page again.\n\nSave anyway?`
        );
        if (!proceed) return;
      }
    }

    await adminApi.updatePermissionMatrix(config);
    await load();
    showToast('Permission matrix saved.', 'success');
  });

  const displayError = loadError || saveAction.error;
  const roles = catalog?.roles || [];
  const baselinePerms = catalog?.baseline_permissions || [];
  const togglablePerms = (catalog?.permissions || []).filter((p) => !baselinePerms.includes(p));
  const delegationEligible = catalog?.delegation_eligible_permissions || [];

  return (
    <>
      <PageHeader
        title=""
        actions={
          <>
            {isViewOnly ? <span className="badge bg-slate-100 text-slate-700">View Only</span> : null}
            {!isViewOnly ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => saveAction.run()}
                disabled={saveAction.loading}
              >
                <Save size={17} />
                {saveAction.loading ? 'Saving…' : 'Save Changes'}
              </button>
            ) : null}
          </>
        }
      />
      {displayError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage(displayError)}
        </div>
      ) : null}

      <section className="panel mb-4 p-4">
        <h2 className="mb-1 text-base font-semibold text-ink">Page &amp; Feature Access</h2>
        <p className="mb-3 text-xs text-slate-500">
          Every permission below controls both backend access and sidebar visibility for that
          page/feature. <span className="font-semibold">Submit Claim</span> and{' '}
          <span className="font-semibold">View Self</span> aren&apos;t shown — every role always
          has them, and they can&apos;t be configured away.
        </p>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="sticky left-0 z-10 bg-white px-3 py-2">Role</th>
                {togglablePerms.map((perm) => (
                  <th key={perm} className="px-2 py-2 text-center font-bold whitespace-nowrap" title={perm}>
                    {labelize(perm)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role} className="border-t border-line hover:bg-slate-50/50">
                  <RoleCell role={role} />
                  {togglablePerms.map((perm) => (
                    <td key={perm} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        disabled={isViewOnly}
                        checked={(permissions[role] || []).includes(perm)}
                        onChange={() => togglePermission(role, perm)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="mb-1 text-base font-semibold text-ink">Delegatable Permissions</h2>
        <p className="mb-3 text-xs text-slate-500">
          When a role is unavailable (leave, travel), another user can temporarily cover its
          current-queue work via Delegation — restricted to approval/payment actions only, never
          admin, config, or reports. A permission can only be marked delegatable here if the role
          already holds it above.
        </p>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="sticky left-0 z-10 bg-white px-3 py-2">Role</th>
                {delegationEligible.map((perm) => (
                  <th key={perm} className="px-2 py-2 text-center font-bold whitespace-nowrap" title={perm}>
                    {labelize(perm)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role} className="border-t border-line hover:bg-slate-50/50">
                  <RoleCell role={role} />
                  {delegationEligible.map((perm) => {
                    const held = (permissions[role] || []).includes(perm);
                    return (
                      <td key={perm} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          disabled={isViewOnly || !held}
                          title={held ? undefined : `${labelize(role)} doesn't hold this permission`}
                          checked={held && (delegatable[role] || []).includes(perm)}
                          onChange={() => toggleDelegatable(role, perm)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
