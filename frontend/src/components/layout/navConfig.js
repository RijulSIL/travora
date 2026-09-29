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

/** Only reporting managers (and acting delegates) review pending travel requests
 * alongside claims on the same page, so only their "Pending Approvals" tab gets
 * a Claims / Travel Requests submenu. */
const PENDING_APPROVALS_SUBMENU = [
  { to: '/claims/pending?tab=claims', label: 'Claims', badge: 'pending_claims' },
  { to: '/claims/pending?tab=travel', label: 'Travel Requests', badge: 'pending_travel' },
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
      { to: '/claims/pending', label: 'Pending Approvals', icon: 'clock', badge: 'pending', badgeVariant: 'red' },
      { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red' },
      { to: '/claims/my', label: 'My Claims', icon: 'clipboard' },
      NEW_CLAIM_ITEM,
      { to: '/travel-requests', label: 'My Travel Requests', icon: 'plane' },
      { to: '/invoices', label: 'Upload Invoice', icon: 'receipt' },
    ]),
    mobile: ['/dashboard', '/claims/pending', '/hr/exceptions', '/claims/my'],
  },

  GROUP_HEAD_HR: {
    sections: [
      ...S([
        { to: '/dashboard', label: 'Home', icon: 'home', end: true },
        { to: '/claims/pending', label: 'Pending Approvals', icon: 'clock', badge: 'pending', badgeVariant: 'red' },
        { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red' },
        { to: '/compliance', label: 'Compliance', icon: 'chart' },
      ]),
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/claims/pending', '/hr/exceptions', '/compliance'],
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
      },
      { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red' },
      { to: '/team/claims', label: 'My Team Claims', icon: 'users' },
      { to: '/team/spend', label: 'Team Spend', icon: 'chart' },
      { to: '/claims/my', label: 'My Own Claims', icon: 'clipboard' },
      NEW_CLAIM_ITEM,
      { to: '/travel-requests', label: 'My Travel Requests', icon: 'plane' },
      { to: '/invoices', label: 'Upload Invoice', icon: 'receipt' },
    ]),
    mobile: ['/dashboard', '/claims/pending', '/hr/exceptions', '/claims/my'],
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
          },
          { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red' },
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
    mobile: ['/dashboard', '/claims/pending', '/travel-desk', '/admin/policy-versions'],
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
        },
        { to: '/claims/all', label: 'All Claims (view only)', icon: 'clipboard' },
        { to: '/reports', label: 'Reports', icon: 'trend' },
      ]),
      { title: 'My Claims & Travel', items: SELF_SERVICE_ITEMS },
    ],
    mobile: ['/dashboard', '/claims/pending', '/claims/all', '/reports'],
  },

  FINANCE: {
    sections: [
      ...S([
        { to: '/dashboard', label: 'Home', icon: 'home', end: true },
        {
          to: '/finance/payment-queue',
          label: 'Payment Queue',
          icon: 'card',
          badge: 'pending',
          badgeVariant: 'red',
          extra: 'payment_queue_sum',
        },
        { to: '/finance/gst-dashboard', label: 'GST Dashboard', icon: 'chart' },
        { to: '/reports', label: 'Reports', icon: 'trend' },
        { to: '/finance/erp-ledger', label: 'ERP Ledger', icon: 'bank' },
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
    },
    { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red' },
  ],
  HRBP_HR: [
    { to: '/claims/pending', label: 'HR Review Queue', icon: 'clock', badge: 'pending', badgeVariant: 'red' },
    { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red' },
    { to: '/travel-desk', label: 'Travel Desk', icon: 'building', badge: 'travel_desk', badgeVariant: 'red' },
  ],
  PAYROLL: [
    { to: '/claims/pending', label: 'Payroll Queue', icon: 'clock', badge: 'pending', badgeVariant: 'red' },
  ],
  FINANCE: [
    {
      to: '/finance/payment-queue',
      label: 'Payment Queue',
      icon: 'card',
      badge: 'pending',
      badgeVariant: 'red',
      extra: 'payment_queue_sum',
    },
  ],
  CEO: [
    { to: '/claims/pending', label: 'Pending Approvals', icon: 'clock', badge: 'pending', badgeVariant: 'red' },
    { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red' },
  ],
  GROUP_HEAD_HR: [
    { to: '/claims/pending', label: 'Pending Approvals', icon: 'clock', badge: 'pending', badgeVariant: 'red' },
    { to: '/hr/exceptions', label: 'Exception Requests', icon: 'alert', badge: 'exceptions', badgeVariant: 'red' },
  ],
  IT_ADMIN: [],
};

/** Flattens `children` groups (e.g. NEW_CLAIM_ITEM) into their child rows in place — used
 * anywhere paths need to be compared/listed without caring about the expand/collapse
 * grouping, which only matters to the desktop sidebar's own rendering. */
function flattenChildren(items) {
  return items.flatMap((item) => (item.children?.length ? item.children : [item]));
}

export function getNavConfig(role, profile = null) {
  const baseConfig = navByRole[role] || navByRole.EMPLOYEE;
  const delegatedRoles = profile?.delegated_roles || [];
  if (!delegatedRoles.length) return baseConfig;

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
  if (!injected.length) return baseConfig;

  return {
    ...baseConfig,
    sections: [...baseConfig.sections, { title: 'Delegated Access', items: injected }],
  };
}

/** Flat list of nav rows in display order (for mobile tab → label lookup). Groups like
 * NEW_CLAIM_ITEM (which have no `to` of their own) expand to their child rows, since mobile
 * has no inline expand/collapse — each child just becomes its own flat entry. */
export function getFlatNavItems(role, profile = null) {
  const config = getNavConfig(role, profile);
  return flattenChildren((config.sections || []).flatMap((s) => s.items || []));
}
