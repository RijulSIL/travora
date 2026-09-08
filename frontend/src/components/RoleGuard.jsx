import { Navigate, Outlet } from 'react-router-dom';

import { hasAnyPermission, hasPermission } from '../services/permissions';
import { selectResolvedRole, useAuthStore } from '../store/authStore';

export default function RoleGuard({ permission, anyOf, roles = [], allowDelegate, children }) {
  const role = useAuthStore(selectResolvedRole);
  const profile = useAuthStore((state) => state.profile);
  
  if (allowDelegate && profile?.is_acting_delegate) {
    return children || <Outlet />;
  }

  if (roles.length && !roles.includes(role)) {
    return <Navigate to="/access-denied" replace />;
  }
  if (anyOf?.length) {
    if (!hasAnyPermission(role, anyOf)) {
      return <Navigate to="/access-denied" replace />;
    }
  } else if (permission && !hasPermission(role, permission)) {
    return <Navigate to="/access-denied" replace />;
  }
  return children || <Outlet />;
}
