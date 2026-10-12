import { Navigate, Outlet } from 'react-router-dom';

import { hasAnyPermission, hasPermission } from '../services/permissions';
import { useAuthStore } from '../store/authStore';

/**
 * `permission`/`anyOf` are checked against `profile.permissions` — this viewer's own
 * effective, already delegation-merged permission list computed server-side (see
 * me_service.build_me_profile) from the admin-editable role->permission matrix. A delegate
 * passes these automatically wherever the delegator's role would grant the same "current
 * queue" permission, with no separate delegation handling needed here.
 */
export default function RoleGuard({ permission, anyOf, children }) {
  const permissions = useAuthStore((state) => state.profile?.permissions);

  if (anyOf?.length) {
    if (!hasAnyPermission(permissions, anyOf)) {
      return <Navigate to="/access-denied" replace />;
    }
  } else if (permission && !hasPermission(permissions, permission)) {
    return <Navigate to="/access-denied" replace />;
  }
  return children || <Outlet />;
}
