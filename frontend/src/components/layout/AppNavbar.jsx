import { Bell, ChevronDown, LogOut, Menu } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import { usePageTitle } from '../../context/PageTitleContext';
import { hasAnyPermission } from '../../services/permissions';
import api from '../../services/api';
import { reimbursementApi } from '../../services/reimbursementApi';
import { clearSession, selectResolvedRole, useAuthStore } from '../../store/authStore';
import { getFlatNavItems } from './navConfig';
import NotificationPanel from '../ui/NotificationPanel';
import { ROLE_LABELS } from '../../utils/formatters';

import {
  Home, Clock, AlertTriangle, Users, TrendingUp, CheckSquare,
  Plane, Receipt, PlusCircle, Settings, Map,
  DollarSign, Folder, Mail, Calendar, Building, User, History, ClipboardList
} from 'lucide-react';

const ICON_MAP = {
  '🏠': Home, '📋': ClipboardList, '⏳': Clock, '🚨': AlertTriangle,
  '👥': Users, '📊': TrendingUp, '✅': CheckSquare, '✈️': Plane,
  '➕': PlusCircle, '🧾': Receipt, '⚙️': Settings, '🏙️': Map,
  '💰': DollarSign, '📂': Folder, '📧': Mail, '📅': Calendar,
  '🏢': Building, '📈': TrendingUp, '💳': Receipt, '🏦': Building,
  '👤': User, '📜': History,
};

const ROLE_DOT = {
  EMPLOYEE: 'bg-blue-500',
  REPORTING_MANAGER: 'bg-amber-500',
  HRBP_HR: 'bg-purple-500',
  PAYROLL: 'bg-orange-500',
  FINANCE: 'bg-green-500',
  IT_ADMIN: 'bg-red-500',
  CEO: 'bg-indigo-500',
  GROUP_HEAD_HR: 'bg-purple-500',
};

function NavBadge({ children }) {
  if (children == null || children === '' || children === 0) return null;
  return (
    <span className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
      {children}
    </span>
  );
}

export default function AppNavbar({ onOpenSidebar }) {
  const navigate = useNavigate();
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const role = useAuthStore(selectResolvedRole);

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];
  const roleLabel = ROLE_LABELS[role] || role?.replace(/_/g, ' ') || '—';
  const roleDot = ROLE_DOT[role] || 'bg-slate-400';

  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  // Build nav items from config
  const allNavItems = useMemo(() => {
    return getFlatNavItems(role, profile).filter((item) => {
      if (!item.anyOf?.length) return true;
      return hasAnyPermission(role, item.anyOf);
    });
  }, [role, profile]);

  // Split: first 6 as primary tabs, rest into "More" dropdown
  const MAX_TABS = 6;
  const primaryTabs = allNavItems.slice(0, MAX_TABS);
  const moreTabs = allNavItems.slice(MAX_TABS);

  // Badge resolution
  function resolveBadge(item) {
    if (item.badge === 'pending') return profile?.pending_approvals_count;
    if (item.badge === 'exceptions') return profile?.exception_requests_pending_count;
    return null;
  }

  // Notification refresh
  const refresh = async () => {
    try {
      const [countRes, listRes] = await Promise.all([
        reimbursementApi.notificationsUnreadCount(),
        reimbursementApi.notifications({ limit: 20 }),
      ]);
      setCount(countRes.data?.count || 0);
      setItems(listRes.data || []);
    } catch {
      setCount(0);
      setItems([]);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, []);

  // Close "More" dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreOpen]);

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* proceed with local logout */
    }
    clearSession();
    navigate('/', { replace: true });
  };

  const handleSelectNotification = async (item) => {
    if (!item.is_read) await reimbursementApi.markNotificationRead(item.sqlid);
    setOpen(false);
    refresh();
    navigate(item.link || '/dashboard');
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-white border-b border-slate-200/70 shadow-sm">
      {/* ── Row 1: Brand bar ── */}
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        {/* Mobile hamburger */}
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden"
          aria-label="Open menu"
          onClick={onOpenSidebar}
        >
          <Menu size={20} />
        </button>

        {/* Brand */}
        <NavLink to="/dashboard" className="flex shrink-0 items-center gap-2.5">
          <img src="/companylogo.png" alt="Company Logo" className="h-10 w-auto object-contain rounded" />
        </NavLink>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side controls */}
        <div className="flex items-center gap-2">
          {/* Notifications */}
          <button
            type="button"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
            aria-label="Notifications"
            onClick={() => setOpen((v) => !v)}
          >
            <Bell size={18} />
            {count > 0 ? (
              <span className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white" aria-hidden="true">
                {count}
              </span>
            ) : null}
          </button>
          {open ? (
            <NotificationPanel
              items={items}
              onMarkAllRead={async () => {
                await reimbursementApi.markAllNotificationsRead();
                refresh();
              }}
              onSelect={handleSelectNotification}
            />
          ) : null}

          {/* Divider */}
          <div className="hidden h-7 w-px bg-slate-200 md:block" />

          {/* User info */}
          <div className="hidden items-center gap-2.5 md:flex">
            <div className="flex flex-col items-end">
              <span className="max-w-[140px] truncate text-[13px] font-semibold text-ink">{firstName}</span>
              <span className="flex items-center gap-1 mt-0.5">
                <span className={`h-1.5 w-1.5 rounded-full ${roleDot}`} />
                <span className="text-[10px] font-medium text-slate-400">{roleLabel}</span>
              </span>
            </div>
          </div>

          <NavLink
            to="/profile"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/70 bg-white px-3 text-[12px] font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <User size={13} />
            <span className="hidden sm:inline">Profile</span>
          </NavLink>

          {/* Logout */}
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/70 bg-white px-3 text-[12px] font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            onClick={handleLogout}
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>

      {/* ── Row 2: Navigation tabs ── */}
      <nav className="hidden md:block border-t border-slate-100 bg-slate-50/50">
        <div className="flex items-center px-6">
          {primaryTabs.map((item) => {
            const IconComponent = ICON_MAP[item.emoji];
            const badge = resolveBadge(item);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}
              >
                {IconComponent ? <IconComponent size={15} className="shrink-0 opacity-60" /> : null}
                <span>{item.label}</span>
                <NavBadge>{badge}</NavBadge>
              </NavLink>
            );
          })}

          {/* More dropdown */}
          {moreTabs.length > 0 ? (
            <div className="relative" ref={moreRef}>
              <button
                type="button"
                className="nav-tab"
                onClick={() => setMoreOpen((v) => !v)}
              >
                <span>More</span>
                <ChevronDown size={14} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
              </button>
              {moreOpen ? (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-xl border border-slate-200/70 bg-white py-2 shadow-lg">
                  {moreTabs.map((item) => {
                    const IconComponent = ICON_MAP[item.emoji];
                    const badge = resolveBadge(item);
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={() => setMoreOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium transition-colors ${isActive ? 'text-brand bg-brand/5' : 'text-slate-600 hover:bg-slate-50 hover:text-ink'}`
                        }
                      >
                        {IconComponent ? <IconComponent size={15} className="shrink-0 opacity-50" /> : null}
                        <span className="flex-1">{item.label}</span>
                        <NavBadge>{badge}</NavBadge>
                      </NavLink>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
