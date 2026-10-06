/**
 * Single source for desktop sidebar + mobile bottom bar.
 * - sections: grouped rows (optional section title for dividers / labels).
 * - items: badge/extra keys are resolved in AppSidebar from profile (counts, totals).
 * - anyOf: optional permission gate per link (see AppSidebar).
 * - mobile: up to four primary tab paths; remaining items go to “More”.
 * - icon: semantic key resolved to a lucide-react component via NAV_ICON_MAP (see navIcons.js).
 */

function S(items) {
  return [{ title: null, items }];
}

/** The travel-request approval chain is admin-configurable (see WorkflowConfig's "Travel
 * Request Approval" workflow type) and can route a stage to any of REPORTING_MANAGER, HRBP_HR,
 * PAYROLL, CEO or GROUP_HEAD_HR — not just the reporting manager, which is all this used to
 * ever be. Every one of those roles' "Pending Approvals"-style entry below gets this same
 * Claims / Travel Requests submenu so whichever role a stage is actually routed to can reach
 * it, instead of only Reporting Manager being able to see travel requests at all. */
const PENDING_APPROVALS_SUBMENU = [
  { to: '/claims/pending?tab=claims', label: 'Claims', icon: 'clipboard', badge: 'pending_claims', scopeGate: 'claims' },
  { to: '/claims/pending?tab=travel', label: 'Travel Requests', icon: 'plane', badge: 'pending_travel', scopeGate: 'travel_request' },
];

/** "New Claim" expands in place to let the employee pick which claim flow to start —
 * see AppSidebar's NavRow, which renders `children` as an expandable group instead of a
 * plain link when present. `getFlatNavItems` below flattens this to two rows for mobile,
 * where there's no room to expand inline. Reallocation isn't a separate entry point here —
 * a Reallocation-tagged invoice is picked up by the General Reimbursement wizard alongside
 * General ones (see GeneralReimbursementWizard.jsx's visibleInvoices filter). */
const NEW_CLAIM_ITEM = {
  label: 'New Claim',
  icon: 'add',
  children: [
    { to: '/claims/travel/new', label: 'Travel Claim', icon: 'plane' },
    { to: '/claims/general/new', label: 'General Reimbursement', icon: 'clipboard' },
  ],
};

/** Every role gets these regardless of permission level, alongside their own role-specific pages. */
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
      {
        to: '/claims/pending',
        label: 'Pending Approvals',
        icon: 'clock',
        badge: 'pending',
        badgeVariant: 'red',
        submenu: PENDING_APPROVALS_SUBMENU,
        scopeGate: 'approvals',
      },
      { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red', scopeGate: 'exceptions' },
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
        {
          to: '/claims/pending',
          label: 'Pending Approvals',
          icon: 'clock',
          badge: 'pending',
          badgeVariant: 'red',
          submenu: PENDING_APPROVALS_SUBMENU,
          scopeGate: 'approvals',
        },
        { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red', scopeGate: 'exceptions' },
        { to: '/compliance', label: 'Compliance', icon: 'chart' },
      ]),
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/claims/pending?tab=claims', '/hr/exceptions', '/compliance'],
  },

  REPORTING_MANAGER: {
    sections: S([
      { to: '/dashboard', label: 'Home', icon: 'home', end: true },
      {
        to: '/claims/pending',
        label: 'Pending Approvals',
        icon: 'clock',
        badge: 'pending',
        badgeVariant: 'red',
        submenu: PENDING_APPROVALS_SUBMENU,
        scopeGate: 'approvals',
      },
      { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red', scopeGate: 'exceptions' },
      { to: '/team/claims', label: 'My Team Claims', icon: 'users' },
      { to: '/team/spend', label: 'Team Spend', icon: 'chart' },
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
          {
            to: '/claims/pending',
            label: 'HR Review Queue',
            icon: 'clock',
            badge: 'pending',
            badgeVariant: 'red',
            submenu: PENDING_APPROVALS_SUBMENU,
            scopeGate: 'approvals',
          },
          { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red', scopeGate: 'exceptions' },
          { to: '/travel-desk', label: 'Travel Desk', icon: 'building', badge: 'travel_desk', badgeVariant: 'red' },
          { to: '/compliance', label: 'Compliance', icon: 'chart' },
          { to: '/reports', label: 'Compliance Reports', icon: 'trend' },
        ],
      },
      {
        title: 'Policy Administration',
        items: [
          { to: '/admin/policy-versions', label: 'Policy Versions', icon: 'settings' },
          { to: '/admin/impact-levels', label: 'Impact Levels', icon: 'chart' },
          { to: '/admin/city-groups', label: 'City Groups', icon: 'city' },
          { to: '/admin/expense-limits', label: 'Expense Limits', icon: 'money' },
          { to: '/admin/expense-categories', label: 'Expense Categories', icon: 'folder' },
        ],
      },
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/claims/pending?tab=claims', '/travel-desk', '/admin/policy-versions'],
  },

  PAYROLL: {
    sections: [
      ...S([
        { to: '/dashboard', label: 'Home', icon: 'home', end: true },
        {
          to: '/claims/pending',
          label: 'Payroll Queue',
          icon: 'clock',
          badge: 'pending',
          badgeVariant: 'red',
          submenu: PENDING_APPROVALS_SUBMENU,
          scopeGate: 'approvals',
        },
        { to: '/claims/all', label: 'All Claims (view only)', icon: 'clipboard' },
        { to: '/reports', label: 'Reports', icon: 'trend' },
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
        },
        // Finance doesn't get a stage in the default Travel Request approval chain, but an
        // admin can route a travel-request stage to FINANCE in the Approval Matrix — without
        // this, there'd be no nav path to that queue at all. scopeGate hides it unless that's
        // actually configured (see navConfig's applyApproverScope / get_approver_scope).
        {
          to: '/claims/pending?tab=travel',
          label: 'Travel Request Approvals',
          icon: 'plane',
          badge: 'pending_travel',
          badgeVariant: 'red',
          scopeGate: 'travel_request',
        },
        { to: '/finance/gst-dashboard', label: 'GST Dashboard', icon: 'chart' },
        { to: '/reports', label: 'Reports', icon: 'trend' },
        { to: '/finance/erp-ledger', label: 'ERP Ledger', icon: 'bank' },
        { to: '/finance/advances', label: 'Advances', icon: 'money' },
        { to: '/claims/all', label: 'All Claims (view only)', icon: 'clipboard' },
      ]),
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/finance/payment-queue', '/finance/gst-dashboard', '/reports'],
  },

  IT_ADMIN: {
    sections: [
      ...S([
        { to: '/dashboard', label: 'Home', icon: 'home', end: true },
        { to: '/admin/users', label: 'User Management', icon: 'user' },
        { to: '/admin/policy-versions', label: 'Policy Versions', icon: 'settings' },
        { to: '/admin/city-groups', label: 'City Groups', icon: 'city' },
        { to: '/admin/impact-levels', label: 'Impact Levels', icon: 'chart' },
        { to: '/admin/expense-limits', label: 'Expense Limits', icon: 'money' },
        { to: '/admin/expense-categories', label: 'Expense Categories', icon: 'folder' },
        { to: '/admin/team-budgets', label: 'Team Budgets', icon: 'money' },
        { to: '/admin/workflow-config', label: 'Approval Matrix', icon: 'check' },
        { to: '/admin/notification-templates', label: 'Notification Templates', icon: 'mail' },
        { to: '/admin/holiday-calendar', label: 'Holiday Calendar', icon: 'calendar' },
        { to: '/reports', label: 'Reports', icon: 'trend' },
        {
          to: '/admin/company-profile',
          label: 'Company Profile',
          icon: 'building',
          anyOf: ['view_sensitive_admin'],
        },
        { to: '/admin/audit-logs', label: 'Audit Logs', icon: 'history' },
      ]),
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/admin/users', '/admin/policy-versions', '/admin/audit-logs'],
  },
};

navByRole.HRBP = navByRole.HRBP_HR;

/**
 * The nav items a delegate temporarily gains for each role they're covering for — must
 * match backend's DELEGATABLE_PERMISSIONS coverage: only the "current queue" page(s) for
 * that role, never its admin/config/report pages (e.g. HRBP_HR's own nav also has Policy
 * Administration and Compliance Reports, but those are deliberately left out here).
 */
const DELEGATABLE_NAV_BY_ROLE = {
  REPORTING_MANAGER: [
    {
      to: '/claims/pending',
      label: 'Pending Approvals',
      icon: 'clock',
      badge: 'pending',
      badgeVariant: 'red',
      submenu: PENDING_APPROVALS_SUBMENU,
      scopeGate: 'approvals',
    },
    { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red', scopeGate: 'exceptions' },
  ],
  HRBP_HR: [
    {
      to: '/claims/pending',
      label: 'HR Review Queue',
      icon: 'clock',
      badge: 'pending',
      badgeVariant: 'red',
      submenu: PENDING_APPROVALS_SUBMENU,
      scopeGate: 'approvals',
    },
    { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red', scopeGate: 'exceptions' },
    { to: '/travel-desk', label: 'Travel Desk', icon: 'building', badge: 'travel_desk', badgeVariant: 'red' },
  ],
  PAYROLL: [
    {
      to: '/claims/pending',
      label: 'Payroll Queue',
      icon: 'clock',
      badge: 'pending',
      badgeVariant: 'red',
      submenu: PENDING_APPROVALS_SUBMENU,
      scopeGate: 'approvals',
    },
  ],
  FINANCE: [
    {
      to: '/finance/payment-queue',
      label: 'Payment Queue',
      icon: 'card',
      badge: 'pending_claims',
      badgeVariant: 'red',
      extra: 'payment_queue_sum',
    },
    {
      to: '/claims/pending?tab=travel',
      label: 'Travel Request Approvals',
      icon: 'plane',
      badge: 'pending_travel',
      badgeVariant: 'red',
      scopeGate: 'travel_request',
    },
  ],
  CEO: [
    {
      to: '/claims/pending',
      label: 'Pending Approvals',
      icon: 'clock',
      badge: 'pending',
      badgeVariant: 'red',
      submenu: PENDING_APPROVALS_SUBMENU,
      scopeGate: 'approvals',
    },
    { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red', scopeGate: 'exceptions' },
  ],
  GROUP_HEAD_HR: [
    {
      to: '/claims/pending',
      label: 'Pending Approvals',
      icon: 'clock',
      badge: 'pending',
      badgeVariant: 'red',
      submenu: PENDING_APPROVALS_SUBMENU,
      scopeGate: 'approvals',
    },
    { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red', scopeGate: 'exceptions' },
  ],
  IT_ADMIN: [],
};

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
  if (scopeGate === 'approvals') return Boolean(scope.claims || scope.travel_request);
  if (scopeGate === 'claims') return Boolean(scope.claims);
  if (scopeGate === 'travel_request') return Boolean(scope.travel_request);
  if (scopeGate === 'exceptions') return Boolean(scope.exceptions?.length);
  return true;
}

/** Hides any nav item (and, for an item with a submenu, each submenu entry individually) that
 * the viewer's role currently has nothing to do per the live Approval Matrix — see
 * workflow_service.get_approver_scope. Replaces hardcoded per-role nav lists, which kept going
 * stale every time an admin reconfigured who approves what. */
function applyApproverScope(items, scope) {
  const result = [];
  for (const item of items) {
    if (!scopeAllows(item.scopeGate, scope)) continue;
    if (item.submenu?.length) {
      const submenu = item.submenu.filter((sub) => scopeAllows(sub.scopeGate, scope));
      if (!submenu.length) continue; // nothing left for this role to expand to
      result.push({ ...item, submenu });
      continue;
    }
    result.push(item);
  }
  return result;
}

function applyApproverScopeToSections(sections, scope) {
  return (sections || []).map((section) => ({
    ...section,
    items: applyApproverScope(section.items || [], scope),
  }));
}

export function getNavConfig(role, profile = null) {
  const baseConfig = navByRole[role] || navByRole.EMPLOYEE;
  const delegatedRoles = profile?.delegated_roles || [];
  const scope = profile?.approver_scope;

  if (!delegatedRoles.length) {
    return { ...baseConfig, sections: applyApproverScopeToSections(baseConfig.sections, scope) };
  }

  const existingPaths = new Set(
    flattenChildren((baseConfig.sections || []).flatMap((s) => s.items || [])).map((item) => item.to)
  );
  const injected = [];
  for (const delegatorRole of delegatedRoles) {
    for (const item of DELEGATABLE_NAV_BY_ROLE[delegatorRole] || []) {
      if (existingPaths.has(item.to)) continue;
      existingPaths.add(item.to);
      injected.push(item);
    }
  }

  const sections = injected.length
    ? [...baseConfig.sections, { title: 'Delegated Access', items: injected }]
    : baseConfig.sections;

  return { ...baseConfig, sections: applyApproverScopeToSections(sections, scope) };
}

/** Flat list of nav rows in display order (for mobile tab → label lookup). Groups like
 * NEW_CLAIM_ITEM (which have no `to` of their own) expand to their child rows, since mobile
 * has no inline expand/collapse — each child just becomes its own flat entry. */
export function getFlatNavItems(role, profile = null) {
  const config = getNavConfig(role, profile);
  return flattenChildren((config.sections || []).flatMap((s) => s.items || []));
}
