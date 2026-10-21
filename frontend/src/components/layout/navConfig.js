/**
 * Single source for desktop sidebar + mobile bottom bar.
 * - sections: grouped rows (optional section title for dividers / labels).
 * - items: badge/extra keys are resolved in AppSidebar from profile (counts, totals).
 * - anyOf: permission gate per link, checked against profile.permissions (see AppSidebar) —
 *   every non-baseline item MUST carry the same anyOf as its route's RoleGuard in App.jsx, or
 *   toggling that permission off in the Role Permissions admin page won't hide the link even
 *   though the page itself correctly starts rejecting the viewer. scopeGate is a second,
 *   independent filter on top (see scopeAllows) — an item can have either, both, or neither.
 * - mobile: up to four primary tab paths; remaining items go to “More”.
 * - icon: semantic key resolved to a lucide-react component via NAV_ICON_MAP (see navIcons.js).
 */

import { hasAnyPermission } from '../../services/permissions';

function S(items) {
  return [{ title: null, items }];
}

// Matches App.jsx's claims/pending route (RoleGuard anyOf=[...]) exactly.
const APPROVAL_QUEUE_PERMISSIONS = ['approve_claims', 'process_payments', 'approve_exception'];
// Matches App.jsx's hr/exceptions route exactly.
const EXCEPTION_QUEUE_PERMISSIONS = ['approve_claims', 'configure_policy', 'approve_exception'];
// Matches the outer /admin RoleGuard that Policy Versions / Impact Levels / City Groups /
// Expense Limits / Expense Categories fall back to (they have no narrower, page-specific gate).
const ADMIN_READONLY_PERMISSIONS = ['configure_policy', 'view_admin_readonly'];

/** The travel-request approval chain is admin-configurable (see WorkflowConfig's "Travel
 * Request Approval" workflow type) and can route a stage to any of REPORTING_MANAGER, HRBP_HR,
 * PAYROLL, CEO or GROUP_HEAD_HR — not just the reporting manager, which is all this used to
 * ever be. Every one of those roles' "Pending Approvals"-style entry below gets this same
 * Claims / Travel Requests submenu so whichever role a stage is actually routed to can reach
 * it, instead of only Reporting Manager being able to see travel requests at all. */
const PENDING_APPROVALS_SUBMENU = [
  { to: '/claims/pending?tab=claims', label: 'Claims', icon: 'clipboard', badge: 'pending_claims', scopeGate: 'claims' },
  { to: '/claims/pending?tab=travel', label: 'Travel Requests', icon: 'plane', badge: 'pending_travel', scopeGate: 'travel_request' },
  { to: '/claims/pending?tab=relocation', label: 'Relocation', icon: 'relocation', badge: 'pending_relocation', scopeGate: 'relocation' },
];

/** Relocation approvals as a flat entry, for roles without the claim-approval permissions that
 * gate the shared "Pending Approvals" item (Recruiter) or without that item at all (Finance).
 * Gated only by the live Approval Matrix (Relocation Approval workflow) — the relocation queue
 * itself isn't permission-gated, its stage roles decide who can act (see api/v1/relocation.py). */
function relocationApprovalsItem() {
  return {
    to: '/claims/pending?tab=relocation',
    label: 'Relocation Approvals',
    icon: 'relocation',
    badge: 'pending_relocation',
    badgeVariant: 'red',
    scopeGate: 'relocation',
  };
}

/** Builds the "Pending Approvals"-style entry shared by every role that can land on this queue —
 * same path/submenu/scope everywhere, only the label differs per role ("HR Review Queue",
 * "Payroll Queue", ...). A single builder keeps that shared shape (and its anyOf) from drifting
 * out of sync across roles, which is exactly how this item ended up ungated in the first place. */
function pendingApprovalsItem(label) {
  return {
    to: '/claims/pending',
    label,
    icon: 'clock',
    badge: 'pending',
    badgeVariant: 'red',
    submenu: PENDING_APPROVALS_SUBMENU,
    scopeGate: 'approvals',
    anyOf: APPROVAL_QUEUE_PERMISSIONS,
  };
}

function exceptionRequestsItem() {
  return {
    to: '/hr/exceptions',
    label: 'Exception Requests',
    icon: 'alert',
    badge: 'exceptions',
    badgeVariant: 'red',
    scopeGate: 'exceptions',
    anyOf: EXCEPTION_QUEUE_PERMISSIONS,
  };
}

/** Shared by HRBP_HR's "Policy Administration" section and IT_ADMIN's own list — both fall back
 * to the same outer /admin gate (no page-specific permission exists for these five). */
function policyAdminItems() {
  return [
    { to: '/admin/policy-versions', label: 'Policy Versions', icon: 'settings', anyOf: ADMIN_READONLY_PERMISSIONS },
    { to: '/admin/impact-levels', label: 'Impact Levels', icon: 'chart', anyOf: ADMIN_READONLY_PERMISSIONS },
    { to: '/admin/city-groups', label: 'City Groups', icon: 'city', anyOf: ADMIN_READONLY_PERMISSIONS },
    { to: '/admin/travel-options', label: 'Travel Options', icon: 'plane', anyOf: ADMIN_READONLY_PERMISSIONS },
    { to: '/admin/expense-limits', label: 'Expense Limits', icon: 'money', anyOf: ADMIN_READONLY_PERMISSIONS },
    { to: '/admin/expense-categories', label: 'Expense Categories', icon: 'folder', anyOf: ADMIN_READONLY_PERMISSIONS },
  ];
}

/** "New Claim" expands in place to let the employee pick which claim flow to start —
 * see AppSidebar's NavRow, which renders `children` as an expandable group instead of a
 * plain link when present. `getFlatNavItems` below flattens this to two rows for mobile,
 * where there's no room to expand inline. Relocation isn't a separate entry point here —
 * it's a Travel Claim with trip purpose Relocation (see ClaimRelocationSteps.jsx). */
const NEW_CLAIM_ITEM = {
  label: 'New Claim',
  icon: 'add',
  children: [
    { to: '/claims/travel/new', label: 'Travel Claim', icon: 'plane' },
    { to: '/claims/general/new', label: 'General Reimbursement', icon: 'clipboard' },
  ],
};

/** Every role gets these regardless of permission level, alongside their own role-specific pages.
 * No anyOf needed — gated only by submit_claim/view_self, the two baseline permissions every
 * role always holds and that can never be configured away (see permission_config_service.py). */
const SELF_SERVICE_ITEMS = [
  { to: '/claims/my', label: 'My Claims', icon: 'clipboard' },
  NEW_CLAIM_ITEM,
  { to: '/travel-requests', label: 'My Travel Requests', icon: 'plane' },
  { to: '/invoices', label: 'Upload Invoice', icon: 'receipt' },
];

export const navByRole = {
  EMPLOYEE: {
    sections: S([
      { to: '/dashboard', label: 'Home', icon: 'home', end: true },
      { to: '/claims/my', label: 'My Claims', icon: 'clipboard' },
      NEW_CLAIM_ITEM,
      { to: '/travel-requests', label: 'My Travel Requests', icon: 'plane' },
      { to: '/invoices', label: 'Upload Invoice', icon: 'receipt' },
    ]),
    mobile: ['/dashboard', '/claims/my', '/travel-requests', '/invoices'],
  },

  CEO: {
    sections: S([
      { to: '/dashboard', label: 'Home', icon: 'home', end: true },
      pendingApprovalsItem('Pending Approvals'),
      exceptionRequestsItem(),
      { to: '/claims/my', label: 'My Claims', icon: 'clipboard' },
      NEW_CLAIM_ITEM,
      { to: '/travel-requests', label: 'My Travel Requests', icon: 'plane' },
      { to: '/invoices', label: 'Upload Invoice', icon: 'receipt' },
    ]),
    // See REPORTING_MANAGER below — "Pending Approvals" expands to its Claims/Travel Requests
    // submenu now, so mobile needs the explicit ?tab= path to still match a flattened item.
    mobile: ['/dashboard', '/claims/pending?tab=claims', '/hr/exceptions', '/claims/my'],
  },

  GROUP_HEAD_HR: {
    sections: [
      ...S([
        { to: '/dashboard', label: 'Home', icon: 'home', end: true },
        pendingApprovalsItem('Pending Approvals'),
        exceptionRequestsItem(),
        { to: '/compliance', label: 'Compliance', icon: 'chart', anyOf: ['view_reports'] },
      ]),
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/claims/pending?tab=claims', '/hr/exceptions', '/compliance'],
  },

  REPORTING_MANAGER: {
    sections: S([
      { to: '/dashboard', label: 'Home', icon: 'home', end: true },
      pendingApprovalsItem('Pending Approvals'),
      exceptionRequestsItem(),
      { to: '/team/claims', label: 'My Team Claims', icon: 'users', anyOf: ['view_team_claims'] },
      { to: '/team/spend', label: 'Team Spend', icon: 'chart', anyOf: ['view_team_claims'] },
      { to: '/claims/my', label: 'My Own Claims', icon: 'clipboard' },
      NEW_CLAIM_ITEM,
      { to: '/travel-requests', label: 'My Travel Requests', icon: 'plane' },
      { to: '/invoices', label: 'Upload Invoice', icon: 'receipt' },
    ]),
    // "Pending Approvals" no longer has a flat entry of its own now that it always expands to
    // its Claims/Travel Requests submenu (see flattenChildren) — the bottom bar's primary tab
    // defaults to the Claims half; Travel Requests still reaches mobile via the "More" sheet.
    mobile: ['/dashboard', '/claims/pending?tab=claims', '/hr/exceptions', '/claims/my'],
  },

  HRBP_HR: {
    sections: [
      {
        title: null,
        items: [
          { to: '/dashboard', label: 'Home', icon: 'home', end: true },
          pendingApprovalsItem('HR Review Queue'),
          exceptionRequestsItem(),
          { to: '/travel-desk', label: 'Travel Desk', icon: 'building', badge: 'travel_desk', badgeVariant: 'red', anyOf: ['view_travel_desk'] },
          { to: '/compliance', label: 'Compliance', icon: 'chart', anyOf: ['view_reports'] },
          { to: '/reports', label: 'Compliance Reports', icon: 'trend', anyOf: ['view_reports'] },
        ],
      },
      {
        title: 'Policy Administration',
        items: policyAdminItems(),
      },
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/claims/pending?tab=claims', '/travel-desk', '/admin/policy-versions'],
  },

  PAYROLL: {
    sections: [
      ...S([
        { to: '/dashboard', label: 'Home', icon: 'home', end: true },
        pendingApprovalsItem('Payroll Queue'),
        { to: '/claims/all', label: 'All Claims (view only)', icon: 'clipboard', anyOf: ['view_reports', 'process_payments'] },
        { to: '/reports', label: 'Reports', icon: 'trend', anyOf: ['view_reports'] },
      ]),
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/claims/pending?tab=claims', '/claims/all', '/reports'],
  },

  FINANCE: {
    sections: [
      ...S([
        { to: '/dashboard', label: 'Home', icon: 'home', end: true },
        {
          to: '/finance/payment-queue',
          label: 'Payment Queue',
          icon: 'card',
          // 'pending_claims', not the combined 'pending' — this page (PaymentQueuePage.jsx)
          // only ever lists claims (it calls the same pendingApprovals() endpoint as the Claims
          // tab), never travel requests. Using the combined claims+travel count here made the
          // badge show a phantom count whenever Finance had a pending travel-request approval
          // but zero claims actually in the payment queue.
          badge: 'pending_claims',
          badgeVariant: 'red',
          extra: 'payment_queue_sum',
          anyOf: ['view_reports'],
        },
        // Finance doesn't get a stage in the default Travel Request approval chain, but an
        // admin can route a travel-request stage to FINANCE in the Approval Matrix — without
        // this, there'd be no nav path to that queue at all. scopeGate hides it unless that's
        // actually configured (see navConfig's scopeAllows / get_approver_scope).
        {
          to: '/claims/pending?tab=travel',
          label: 'Travel Request Approvals',
          icon: 'plane',
          badge: 'pending_travel',
          badgeVariant: 'red',
          scopeGate: 'travel_request',
          anyOf: APPROVAL_QUEUE_PERMISSIONS,
        },
        relocationApprovalsItem(),
        { to: '/finance/gst-dashboard', label: 'GST Dashboard', icon: 'chart', anyOf: ['view_reports'] },
        { to: '/reports', label: 'Reports', icon: 'trend', anyOf: ['view_reports'] },
        { to: '/finance/erp-ledger', label: 'ERP Ledger', icon: 'bank', anyOf: ['view_reports'] },
        { to: '/finance/advances', label: 'Advances', icon: 'money', anyOf: ['process_advances'] },
        { to: '/claims/all', label: 'All Claims (view only)', icon: 'clipboard', anyOf: ['view_reports', 'process_payments'] },
      ]),
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/finance/payment-queue', '/finance/gst-dashboard', '/reports'],
  },

  IT_ADMIN: {
    sections: [
      ...S([
        { to: '/dashboard', label: 'Home', icon: 'home', end: true },
        { to: '/admin/users', label: 'User Management', icon: 'user', anyOf: ['manage_users'] },
        ...policyAdminItems(),
        { to: '/admin/team-budgets', label: 'Team Budgets', icon: 'money', anyOf: ['manage_team_budgets'] },
        { to: '/admin/workflow-config', label: 'Approval Matrix', icon: 'check', anyOf: ['view_workflow_config', 'edit_workflow_config'] },
        { to: '/admin/permission-matrix', label: 'Role Permissions', icon: 'settings', anyOf: ['view_permission_matrix', 'edit_permission_matrix'] },
        { to: '/admin/notification-templates', label: 'Notification Templates', icon: 'mail', anyOf: ['view_notification_templates', 'edit_notification_templates'] },
        { to: '/admin/holiday-calendar', label: 'Holiday Calendar', icon: 'calendar', anyOf: ['manage_holiday_calendar'] },
        { to: '/reports', label: 'Reports', icon: 'trend', anyOf: ['view_reports'] },
        {
          to: '/admin/company-profile',
          label: 'Company Profile',
          icon: 'building',
          anyOf: ['view_sensitive_admin'],
        },
        { to: '/admin/audit-logs', label: 'Audit Logs', icon: 'history', anyOf: ['export_audit'] },
      ]),
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/admin/users', '/admin/policy-versions', '/admin/audit-logs'],
  },

  // An employee who also approves relocation requests (Relocation Approval workflow's first
  // stage by default, pooled — any Recruiter can act).
  RECRUITER: {
    sections: [
      ...S([
        { to: '/dashboard', label: 'Home', icon: 'home', end: true },
        relocationApprovalsItem(),
      ]),
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/claims/pending?tab=relocation', '/claims/my', '/travel-requests'],
  },
};

navByRole.HRBP = navByRole.HRBP_HR;

/**
 * The nav items a delegate temporarily gains for each role they're covering for — must
 * match backend's DELEGATABLE_PERMISSIONS coverage: only the "current queue" page(s) for
 * that role, never its admin/config/report pages (e.g. HRBP_HR's own nav also has Policy
 * Administration and Compliance Reports, but those are deliberately left out here). Each entry
 * still carries the same anyOf as its non-delegated counterpart above — a delegate only
 * actually gains the route-level permission if that permission is itself delegatable (see
 * permission_config_service.DELEGATION_ELIGIBLE_PERMISSIONS); where it isn't (e.g. Travel Desk's
 * view_travel_desk), the anyOf correctly keeps this link hidden instead of showing a dead one.
 */
const DELEGATABLE_NAV_BY_ROLE = {
  REPORTING_MANAGER: [pendingApprovalsItem('Pending Approvals'), exceptionRequestsItem()],
  HRBP_HR: [
    pendingApprovalsItem('HR Review Queue'),
    exceptionRequestsItem(),
    { to: '/travel-desk', label: 'Travel Desk', icon: 'building', badge: 'travel_desk', badgeVariant: 'red', anyOf: ['view_travel_desk'] },
  ],
  PAYROLL: [pendingApprovalsItem('Payroll Queue')],
  FINANCE: [
    {
      to: '/finance/payment-queue',
      label: 'Payment Queue',
      icon: 'card',
      badge: 'pending_claims',
      badgeVariant: 'red',
      extra: 'payment_queue_sum',
      anyOf: ['view_reports'],
    },
    {
      to: '/claims/pending?tab=travel',
      label: 'Travel Request Approvals',
      icon: 'plane',
      badge: 'pending_travel',
      badgeVariant: 'red',
      scopeGate: 'travel_request',
      anyOf: APPROVAL_QUEUE_PERMISSIONS,
    },
  ],
  CEO: [pendingApprovalsItem('Pending Approvals'), exceptionRequestsItem()],
  GROUP_HEAD_HR: [pendingApprovalsItem('Pending Approvals'), exceptionRequestsItem()],
  IT_ADMIN: [],
  RECRUITER: [],
};

/**
 * Every nav item gated by a permission that's now admin-configurable (see
 * permission_config_service.py / the Role Permissions admin page) rather than hardcoded to a
 * fixed set of roles. A role's own hardcoded entry above (if any) always wins — this list only
 * fills the gap for a role an admin has *newly* granted the permission to, so it actually gets a
 * nav entry instead of the permission working everywhere except the sidebar. See `getNavConfig`'s
 * second injection pass.
 */
const CONFIGURABLE_NAV_ITEMS = [
  { to: '/team/claims', label: 'Team Claims', icon: 'users', anyOf: ['view_team_claims'] },
  { to: '/team/spend', label: 'Team Spend', icon: 'chart', anyOf: ['view_team_claims'] },
  {
    to: '/travel-desk',
    label: 'Travel Desk',
    icon: 'building',
    badge: 'travel_desk',
    badgeVariant: 'red',
    anyOf: ['view_travel_desk'],
  },
  { to: '/admin/team-budgets', label: 'Team Budgets', icon: 'money', anyOf: ['manage_team_budgets'] },
  {
    to: '/admin/notification-templates',
    label: 'Notification Templates',
    icon: 'mail',
    anyOf: ['view_notification_templates', 'edit_notification_templates'],
  },
  {
    to: '/admin/holiday-calendar',
    label: 'Holiday Calendar',
    icon: 'calendar',
    anyOf: ['manage_holiday_calendar'],
  },
  { to: '/finance/advances', label: 'Advances', icon: 'money', anyOf: ['process_advances'] },
  { to: '/compliance', label: 'Compliance', icon: 'chart', anyOf: ['view_reports'] },
  {
    to: '/admin/permission-matrix',
    label: 'Role Permissions',
    icon: 'settings',
    anyOf: ['view_permission_matrix', 'edit_permission_matrix'],
  },
  pendingApprovalsItem('Pending Approvals'),
  exceptionRequestsItem(),
];

/** The manager pages someone gets from having people report to them. */
const TEAM_PATHS = new Set(['/claims/pending', '/hr/exceptions', '/team/claims', '/team/spend']);

/** Flattens `children`/`submenu` groups (e.g. NEW_CLAIM_ITEM, Pending Approvals' Claims/Travel
 * split) into their child rows in place — used anywhere paths need to be compared/listed
 * without caring about the expand/collapse grouping, which only matters to the desktop
 * sidebar's own rendering (mobile has no room to expand inline, so each child becomes its
 * own flat row there instead). */
function flattenChildren(items) {
  return items.flatMap((item) => {
    const options = item.children?.length ? item.children : item.submenu;
    return options?.length ? options : [item];
  });
}

/** Does `scope` (profile.approver_scope — already the delegation-merged superset computed
 * server-side, see me_service.build_me_profile) satisfy this item's gate? Items with no
 * scopeGate are always shown (e.g. Payment Queue, which always has a finance stage — see
 * _validate_stage_list's require_finance_stage). */
function scopeAllows(scopeGate, scope) {
  if (!scopeGate) return true;
  if (!scope) return true; // profile not loaded yet — show everything rather than flash-hide
  if (scopeGate === 'approvals') return Boolean(scope.claims || scope.travel_request || scope.relocation);
  if (scopeGate === 'claims') return Boolean(scope.claims);
  if (scopeGate === 'travel_request') return Boolean(scope.travel_request);
  if (scopeGate === 'relocation') return Boolean(scope.relocation);
  if (scopeGate === 'exceptions') return Boolean(scope.exceptions?.length);
  return true;
}

/** Does the viewer's own permission list satisfy this item's anyOf gate? Items with no anyOf are
 * always shown (baseline self-service pages, Home). Mirrors scopeAllows' "don't know yet ⇒ show"
 * rule for a still-loading profile, so nothing flashes hidden before `/me` resolves. */
function permissionAllows(anyOf, permissions) {
  if (!anyOf?.length) return true;
  if (!permissions) return true;
  return hasAnyPermission(permissions, anyOf);
}

/** Hides any nav item (and, for an item with a submenu, each submenu entry individually) that
 * the viewer's role currently has nothing to do per the live Approval Matrix (scopeGate) or no
 * longer holds the permission for per the live Role Permissions config (anyOf) — checked
 * uniformly for every item, whether it's one of a role's own hardcoded entries, a delegated
 * item, or one injected by CONFIGURABLE_NAV_ITEMS. Replaces hardcoded per-role nav lists that
 * never re-checked anything once an admin changed what a role could actually do. */
function applyNavFilters(items, scope, permissions) {
  const result = [];
  for (const item of items) {
    if (!scopeAllows(item.scopeGate, scope)) continue;
    if (!permissionAllows(item.anyOf, permissions)) continue;
    if (item.submenu?.length) {
      const submenu = item.submenu.filter((sub) => scopeAllows(sub.scopeGate, scope) && permissionAllows(sub.anyOf, permissions));
      if (!submenu.length) continue; // nothing left for this role to expand to
      result.push({ ...item, submenu });
      continue;
    }
    result.push(item);
  }
  return result;
}

function applyNavFiltersToSections(sections, scope, permissions) {
  return (sections || []).map((section) => ({
    ...section,
    items: applyNavFilters(section.items || [], scope, permissions),
  }));
}

export function getNavConfig(role, profile = null) {
  const baseConfig = navByRole[role] || navByRole.EMPLOYEE;
  const delegatedRoles = profile?.delegated_roles || [];
  const scope = profile?.approver_scope;
  const permissions = profile?.permissions;

  const existingPaths = new Set(
    flattenChildren((baseConfig.sections || []).flatMap((s) => s.items || [])).map((item) => item.to)
  );

  const delegated = [];
  for (const delegatorRole of delegatedRoles) {
    for (const item of DELEGATABLE_NAV_BY_ROLE[delegatorRole] || []) {
      if (existingPaths.has(item.to)) continue;
      existingPaths.add(item.to);
      delegated.push(item);
    }
  }

  // A role an admin has newly granted a permission to (via the Role Permissions page) gets the
  // matching nav entry here, same as a role that already held it hardcoded above — otherwise the
  // permission would work everywhere (route guard, backend) except the sidebar never showing it.
  // Checked against every candidate path a submenu item expands to (not just its parent `to`), so
  // a role that already has the item under a different label/grouping isn't given a duplicate.
  const permissionGranted = [];
  if (permissions?.length) {
    for (const item of CONFIGURABLE_NAV_ITEMS) {
      if (!hasAnyPermission(permissions, item.anyOf)) continue;
      const candidatePaths = item.submenu?.length ? item.submenu.map((sub) => sub.to) : [item.to];
      if (candidatePaths.some((path) => existingPaths.has(path))) continue;
      candidatePaths.forEach((path) => existingPaths.add(path));
      permissionGranted.push(item);
    }
  }

  // The Manager setting (on top of any role, see backend rbac.is_manager) — the manager pages it
  // brings get their own "My Team" heading.
  const teamItems = profile?.is_manager ? permissionGranted.filter((item) => TEAM_PATHS.has(item.to)) : [];
  const otherGranted = permissionGranted.filter((item) => !teamItems.includes(item));

  const sections = [...baseConfig.sections];
  if (teamItems.length) sections.push({ title: 'My Team', items: teamItems });
  if (delegated.length) sections.push({ title: 'Delegated Access', items: delegated });
  if (otherGranted.length) sections.push({ title: 'Additional Access', items: otherGranted });

  // An Employee with the Manager setting gets the old Reporting Manager phone tabs (approvals first).
  const mobile = profile?.is_manager && role === 'EMPLOYEE' ? navByRole.REPORTING_MANAGER.mobile : baseConfig.mobile;
  return { ...baseConfig, mobile, sections: applyNavFiltersToSections(sections, scope, permissions) };
}

/** Flat list of nav rows in display order (for mobile tab → label lookup). Groups like
 * NEW_CLAIM_ITEM (which have no `to` of their own) expand to their child rows, since mobile
 * has no inline expand/collapse — each child just becomes its own flat entry. */
export function getFlatNavItems(role, profile = null) {
  const config = getNavConfig(role, profile);
  return flattenChildren((config.sections || []).flatMap((s) => s.items || []));
}
