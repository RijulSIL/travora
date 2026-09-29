import { Navigate, Outlet } from 'react-router-dom';

import { hasAnyPermission, hasPermission } from '../services/permissions';
import { selectResolvedRole, useAuthStore } from '../store/authStore';

/**
 * `permission`/`anyOf` checks already account for delegation (see permissions.js
 * DELEGATABLE_PERMISSIONS) — a delegate passes these automatically wherever the
 * delegator's role would grant the same "current queue" permission.
 *
 * `roles` is a literal identity check and can't be partially inherited the way a
 * permission can, so a role-gated route only opens to a delegate when it's explicitly
 * listed in `delegatableRoles` (e.g. Travel Desk, which is HRBP_HR's own current-queue
 * page) — routes like Compliance or Policy Administration deliberately leave this unset.
 */
export default function RoleGuard({ permission, anyOf, roles = [], delegatableRoles = [], children }) {
  const role = useAuthStore(selectResolvedRole);
  const delegatedRoles = useAuthStore((state) => state.profile?.delegated_roles);

  if (roles.length && !roles.includes(role)) {
    const isDelegatedRole = delegatableRoles.length && delegatedRoles?.some((r) => delegatableRoles.includes(r));
    if (!isDelegatedRole) {
      return <Navigate to="/access-denied" replace />;
    }
  }
  if (anyOf?.length) {
    if (!hasAnyPermission(role, anyOf, delegatedRoles)) {
      return <Navigate to="/access-denied" replace />;
    }
  } else if (permission && !hasPermission(role, permission, delegatedRoles)) {
    return <Navigate to="/access-denied" replace />;
  }
  return children || <Outlet />;
}
