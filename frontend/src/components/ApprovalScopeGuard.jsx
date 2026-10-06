import { Navigate, Outlet, useSearchParams } from 'react-router-dom';

import { selectResolvedRole, useAuthStore } from '../store/authStore';

/**
 * RoleGuard's `anyOf`/`permission` checks are a coarse, static allowlist — "this role COULD
 * approve something" (e.g. every REPORTING_MANAGER has `approve_stage_1`). This guard is the
 * finer, live check on top of that: "is it actually configured that way right now" per the
 * Approval Matrix (profile.approver_scope, computed server-side by
 * workflow_service.get_approver_scope). Without this, a Reporting Manager could open the
 * travel-request queue purely because Reporting Managers can approve claims in general, even
 * when the live config currently routes travel requests to a different role entirely — the
 * page would just render an empty table instead of actually being inaccessible.
 */
export default function ApprovalScopeGuard({ area, children }) {
  const profile = useAuthStore((state) => state.profile);
  const role = useAuthStore(selectResolvedRole);
  const [searchParams] = useSearchParams();
  const scope = profile?.approver_scope;

  // IT_ADMIN reaches these routes via the shared 'configure_policy' permission for oversight
  // (same reason they have view_sensitive_admin/export_audit elsewhere) — they're never meant
  // to BE a configured approver in any chain, so approver_scope would always be empty for them
  // and this guard would otherwise lock out the one role actually allowed to administer this.
  if (role === 'IT_ADMIN') return children || <Outlet />;

  // No scope data at all (profile still loading, or the degraded post-refresh-failure profile
  // that ProtectedRoute builds without approver_scope) — don't block on missing data, same
  // "undefined scope ⇒ don't hide" rule navConfig's applyApproverScope already follows.
  if (!scope) return children || <Outlet />;

  const isActingDelegate = Boolean(profile?.is_acting_delegate);
  if (isActingDelegate) return children || <Outlet />;

  if (area === 'exceptions') {
    if (scope.exceptions?.length) return children || <Outlet />;
    return <Navigate to="/access-denied" replace />;
  }

  if (area === 'pending-approvals') {
    const requestedTab = searchParams.get('tab') === 'travel' ? 'travel' : 'claims';

    // Finance's claims stage (the Finance / Payment stage) is handled exclusively through the
    // dedicated Payment Queue page — approve_claim_stage rejects a Finance-stage approval
    // outright and tells the caller to use the payment endpoint instead, and Finance's own nav
    // never links to this generic Claims tab. scope.claims is still correctly `true` for
    // Finance (they do hold a real claim stage — see get_approver_scope), but that's a signal
    // for Payment Queue's badge/filters, not permission to open this particular tab.
    if (role === 'FINANCE' && requestedTab === 'claims') {
      return <Navigate to="/access-denied" replace />;
    }

    const hasRequestedTab = requestedTab === 'travel' ? scope.travel_request : scope.claims;
    if (hasRequestedTab) return children || <Outlet />;
    return <Navigate to="/access-denied" replace />;
  }

  return children || <Outlet />;
}
