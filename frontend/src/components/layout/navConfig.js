/**
 * Single source for desktop sidebar + mobile bottom bar.
 * - sections: grouped rows (optional section title for dividers / labels).
 * - items: badge/extra keys are resolved in AppSidebar from profile (counts, totals).
 * - anyOf: optional permission gate per link (see AppSidebar).
 * - mobile: up to four primary tab paths; remaining items go to “More”.
 */

function S(items) {
  return [{ title: null, items }];
}

export const navByRole = {
  EMPLOYEE: {
    sections: S([
      { to: '/dashboard', label: 'Home', emoji: '🏠', end: true },
      { to: '/claims/my', label: 'My Claims', emoji: '📋' },
      { to: '/claims/new', label: 'New Claim', emoji: '➕' },
      { to: '/travel-requests', label: 'My Travel Requests', emoji: '✈️' },
      { to: '/invoices', label: 'Upload Invoice', emoji: '🧾' },
    ]),
    mobile: ['/dashboard', '/claims/my', '/travel-requests', '/invoices'],
  },

  CEO: {
    sections: S([
      { to: '/dashboard', label: 'Home', emoji: '🏠', end: true },
      { to: '/claims/pending', label: 'Pending Approvals', emoji: '⏳', badge: 'pending', badgeVariant: 'red' },
      { to: '/hr/exceptions', label: 'Exception Requests', emoji: '🚨', badge: 'exceptions', badgeVariant: 'red' },
      { to: '/claims/my', label: 'My Claims', emoji: '📋' },
      { to: '/claims/new', label: 'New Claim', emoji: '➕' },
      { to: '/travel-requests', label: 'My Travel Requests', emoji: '✈️' },
      { to: '/invoices', label: 'Upload Invoice', emoji: '🧾' },
    ]),
    mobile: ['/dashboard', '/claims/pending', '/hr/exceptions', '/claims/my'],
  },

  GROUP_HEAD_HR: {
    sections: S([
      { to: '/dashboard', label: 'Home', emoji: '🏠', end: true },
      { to: '/claims/pending', label: 'Pending Approvals', emoji: '⏳', badge: 'pending', badgeVariant: 'red' },
      { to: '/hr/exceptions', label: 'Exception Requests', emoji: '🚨', badge: 'exceptions', badgeVariant: 'red' },
      { to: '/compliance', label: 'Compliance', emoji: '📊' },
    ]),
    mobile: ['/dashboard', '/claims/pending', '/hr/exceptions', '/compliance'],
  },

  REPORTING_MANAGER: {
    sections: S([
      { to: '/dashboard', label: 'Home', emoji: '🏠', end: true },
      {
        to: '/claims/pending',
        label: 'Pending Approvals',
        emoji: '⏳',
        badge: 'pending',
        badgeVariant: 'red',
      },
      { to: '/hr/exceptions', label: 'Exception Requests', emoji: '🚨', badge: 'exceptions', badgeVariant: 'red' },
      { to: '/team/claims', label: 'My Team Claims', emoji: '👥' },
      { to: '/team/spend', label: 'Team Spend', emoji: '📊' },
      { to: '/admin/workflow-config', label: 'Approval matrix', emoji: '✅' },
      { to: '/claims/my', label: 'My Own Claims', emoji: '📋' },
      { to: '/travel-requests', label: 'My Travel Requests', emoji: '✈️' },
    ]),
    mobile: ['/dashboard', '/claims/pending', '/hr/exceptions', '/claims/my'],
  },

  HRBP_HR: {
    sections: [
      {
        title: null,
        items: [
          { to: '/dashboard', label: 'Home', emoji: '🏠', end: true },
          {
            to: '/claims/pending',
            label: 'HR Review Queue',
            emoji: '⏳',
            badge: 'pending',
            badgeVariant: 'red',
          },
          { to: '/hr/exceptions', label: 'Exception Requests', emoji: '🚨', badge: 'exceptions', badgeVariant: 'red' },
          { to: '/travel-desk', label: 'Travel Desk', emoji: '🏢' },
          { to: '/compliance', label: 'Compliance', emoji: '📊' },
          { to: '/reports', label: 'Compliance Reports', emoji: '📈' },
        ],
      },
      {
        title: 'Admin Console',
        items: [
          { to: '/admin/policy-versions', label: 'Policy Versions', emoji: '⚙️' },
          { to: '/admin/impact-levels', label: 'Impact Levels', emoji: '📊' },
          { to: '/admin/city-groups', label: 'City Groups', emoji: '🏙️' },
          { to: '/admin/expense-limits', label: 'Expense Limits', emoji: '💰' },
          { to: '/admin/expense-categories', label: 'Expense Categories', emoji: '📂' },
          { to: '/admin/workflow-config', label: 'Approval Matrix', emoji: '✅' },
        ],
      },
    ],
    mobile: ['/dashboard', '/claims/pending', '/travel-desk', '/admin/policy-versions'],
  },

  PAYROLL: {
    sections: S([
      { to: '/dashboard', label: 'Home', emoji: '🏠', end: true },
      {
        to: '/claims/pending',
        label: 'Payroll Queue',
        emoji: '⏳',
        badge: 'pending',
        badgeVariant: 'red',
      },
      { to: '/claims/all', label: 'All Claims (view only)', emoji: '📋' },
      { to: '/reports', label: 'Reports', emoji: '📈' },
    ]),
    mobile: ['/dashboard', '/claims/pending', '/claims/all', '/reports'],
  },

  FINANCE: {
    sections: S([
      { to: '/dashboard', label: 'Home', emoji: '🏠', end: true },
      {
        to: '/finance/payment-queue',
        label: 'Payment Queue',
        emoji: '💳',
        badge: 'pending',
        badgeVariant: 'red',
        extra: 'payment_queue_sum',
      },
      { to: '/finance/gst-dashboard', label: 'GST Dashboard', emoji: '📊' },
      { to: '/reports', label: 'Reports', emoji: '📈' },
      { to: '/finance/erp-ledger', label: 'ERP Ledger', emoji: '🏦' },
      { to: '/claims/all', label: 'All Claims (view only)', emoji: '📋' },
    ]),
    mobile: ['/dashboard', '/finance/payment-queue', '/finance/gst-dashboard', '/reports'],
  },

  IT_ADMIN: {
    sections: S([
      { to: '/dashboard', label: 'Home', emoji: '🏠', end: true },
      { to: '/admin/users', label: 'User Management', emoji: '👤' },
      { to: '/admin/policy-versions', label: 'Policy Versions', emoji: '⚙️' },
      { to: '/admin/city-groups', label: 'City Groups', emoji: '🏙️' },
      { to: '/admin/impact-levels', label: 'Impact Levels', emoji: '📊' },
      { to: '/admin/expense-limits', label: 'Expense Limits', emoji: '💰' },
      { to: '/admin/expense-categories', label: 'Expense Categories', emoji: '📂' },
      { to: '/admin/workflow-config', label: 'Approval Matrix', emoji: '✅' },
      { to: '/admin/notification-templates', label: 'Notification Templates', emoji: '📧' },
      { to: '/admin/holiday-calendar', label: 'Holiday Calendar', emoji: '📅' },
      { to: '/reports', label: 'Reports', emoji: '📈' },
      {
        to: '/admin/company-profile',
        label: 'Company Profile',
        emoji: '🏢',
        anyOf: ['view_sensitive_admin'],
      },
      { to: '/admin/audit-logs', label: 'Audit Logs', emoji: '📜' },
    ]),
    mobile: ['/dashboard', '/admin/users', '/admin/policy-versions', '/admin/audit-logs'],
  },
};

navByRole.HRBP = navByRole.HRBP_HR;

export function getNavConfig(role, profile = null) {
  const baseConfig = navByRole[role] || navByRole.EMPLOYEE;
  
  if (profile?.is_acting_delegate && role === 'EMPLOYEE') {
    const newConfig = { ...baseConfig, sections: [...baseConfig.sections] };
    const firstSection = { ...newConfig.sections[0], items: [...newConfig.sections[0].items] };
    
    // Inject at position 1 (after Home)
    firstSection.items.splice(1, 0, 
      { to: '/claims/pending', label: 'Pending Approvals', emoji: '⏳', badge: 'pending', badgeVariant: 'red' },
      { to: '/hr/exceptions', label: 'Exception Requests', emoji: '🚨', badge: 'exceptions', badgeVariant: 'red' }
    );
    newConfig.sections[0] = firstSection;
    
    // Also inject into mobile nav
    newConfig.mobile = ['/dashboard', '/claims/pending', '/hr/exceptions', '/claims/my'];
    return newConfig;
  }
  
  return baseConfig;
}

/** Flat list of nav rows in display order (for mobile tab → label lookup). */
export function getFlatNavItems(role, profile = null) {
  const config = getNavConfig(role, profile);
  return (config.sections || []).flatMap((s) => s.items || []);
}
