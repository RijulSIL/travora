export const routeMeta = [
  { prefix: '/invoices', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Upload Invoice', href: '/invoices' }] },
  { prefix: '/notifications', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Notifications', href: '/notifications' }] },
  { prefix: '/claims/all', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Claims', href: '/claims/all' }] },
  { prefix: '/claims/my', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Claims', href: '/claims/my' }] },
  { prefix: '/claims/', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Claims', href: '/claims/my' }] },
  { prefix: '/admin/', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Admin Console', href: '/admin' }] },
  { prefix: '/finance/', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Finance', href: '/finance/payment-queue' }] },
  { prefix: '/travel', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Travel', href: '/travel-requests' }] },
  { prefix: '/compliance', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Compliance', href: '/compliance' }] },
  { prefix: '/reports', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Reports', href: '/reports' }] },
  { prefix: '/hr/', crumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'HR', href: '/hr/exceptions' }] },
];

export function getBreadcrumbs(pathname) {
  const match = routeMeta.find((m) => pathname.startsWith(m.prefix));
  return match?.crumbs || [];
}
