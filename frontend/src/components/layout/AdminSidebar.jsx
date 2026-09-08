import {
  Building2,
  Gauge,
  Landmark,
  Layers,
  MapPinned,
  ReceiptText,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { hasAnyPermission, hasPermission } from '../../services/permissions';
import { useAuthStore } from '../../store/authStore';

const links = [
  { to: '/admin', label: 'Dashboard', icon: Gauge, permission: 'configure_policy' },
  { to: '/admin/users', label: 'User Management', icon: Users, permission: 'manage_users' },
  {
    to: '/admin/policy-versions',
    label: 'Policy Versions',
    icon: Layers,
    permission: 'configure_policy',
  },
  {
    to: '/admin/impact-levels',
    label: 'Impact Levels',
    icon: Landmark,
    permission: 'configure_policy',
    roles: ['HRBP_HR', 'IT_ADMIN'],
  },
  {
    to: '/admin/city-groups',
    label: 'City Groups',
    icon: MapPinned,
    permission: 'configure_policy',
    roles: ['HRBP_HR', 'IT_ADMIN'],
  },
  { to: '/admin/expense-limits', label: 'Expense Limits', icon: SlidersHorizontal, permission: 'configure_policy' },
  { to: '/admin/expense-categories', label: 'Expense Categories', icon: ReceiptText, permission: 'configure_policy' },
  {
    to: '/admin/company-profile',
    label: 'Company Profile',
    icon: Building2,
    anyOf: ['view_sensitive_admin'],
  },
];

export default function AdminSidebar() {
  const role = useAuthStore((state) => state.user?.role);
  const visibleLinks = links.filter((link) => {
    if (link.anyOf?.length) {
      if (!hasAnyPermission(role, link.anyOf)) return false;
    } else if (!hasPermission(role, link.permission)) {
      return false;
    }
    return !link.roles || link.roles.includes(role);
  });

  return (
    <aside className="h-screen w-64 shrink-0 border-r border-line bg-white">
      <div className="border-b border-line px-5 py-4">
        <div className="text-sm font-semibold uppercase tracking-wide text-brand">Travora Admin</div>
        <div className="mt-1 text-xs text-slate-500">{role || 'No role'}</div>
      </div>
      <nav className="p-3">
        {visibleLinks.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/admin'}
              className={({ isActive }) =>
                [
                  'mb-1 flex h-10 items-center gap-3 rounded px-3 text-sm',
                  isActive ? 'bg-brand text-white' : 'text-slate-700 hover:bg-slate-100',
                ].join(' ')
              }
            >
              <Icon size={17} aria-hidden="true" />
              <span>{link.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
