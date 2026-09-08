/** Default when JWT/profile omit role (should be rare). */
export const DEFAULT_RESOLVED_ROLE = 'EMPLOYEE';

/**
 * Single source of truth for role resolution: profile from /me, then session user from login/refresh.
 * Matches RoleGuard / AppLayout fallback chain (with explicit default).
 */
export function selectResolvedRole(state) {
  return state.profile?.role ?? state.user?.role ?? DEFAULT_RESOLVED_ROLE;
}
