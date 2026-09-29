import { Bell, ChevronDown, LogOut, Menu, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import api from '../../services/api';
import { reimbursementApi } from '../../services/reimbursementApi';
import { clearSession, selectResolvedRole, useAuthStore } from '../../store/authStore';
import NotificationPanel from '../ui/NotificationPanel';
import { ROLE_LABELS } from '../../utils/formatters';

const ROLE_ACCENT = {
  EMPLOYEE: 'bg-blue-500',
  REPORTING_MANAGER: 'bg-amber-500',
  HRBP_HR: 'bg-purple-500',
  PAYROLL: 'bg-orange-500',
  FINANCE: 'bg-green-500',
  IT_ADMIN: 'bg-red-500',
  CEO: 'bg-indigo-500',
  GROUP_HEAD_HR: 'bg-purple-500',
};

export default function AppNavbar({ onOpenSidebar }) {
  const navigate = useNavigate();
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const role = useAuthStore(selectResolvedRole);

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];
  const roleLabel = ROLE_LABELS[role] || role?.replace(/_/g, ' ') || '—';
  const roleAccent = ROLE_ACCENT[role] || 'bg-slate-400';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'U';

  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

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

  // Close user-menu dropdown on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userMenuOpen]);

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
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200/70 shadow-sm">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        {/* Mobile hamburger (desktop nav lives in the sidebar instead) */}
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden"
          aria-label="Open menu"
          onClick={onOpenSidebar}
        >
          <Menu size={20} />
        </button>

        {/* Brand — desktop shows it in the sidebar header instead */}
        <NavLink to="/dashboard" className="flex shrink-0 items-center gap-2.5 md:hidden">
          <img src="/assets/travoralogo.png" alt="Travora" className="h-10 w-auto object-contain" />
        </NavLink>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side controls */}
        <div className="flex items-center gap-1.5">
          {/* Notifications */}
          <div className="relative">
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
          </div>

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-slate-100"
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-label="Account menu"
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white ${roleAccent}`}>
                {initial}
              </span>
              <span className="hidden flex-col items-start leading-tight md:flex">
                <span className="max-w-[120px] truncate text-[13px] font-semibold text-ink">{firstName}</span>
                <span className="text-[10px] font-medium text-slate-400">{roleLabel}</span>
              </span>
              <ChevronDown
                size={14}
                className={`hidden shrink-0 text-slate-400 transition-transform md:block ${userMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {userMenuOpen ? (
              <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-slate-200/70 bg-white py-2 shadow-lg">
                <div className="border-b border-slate-100 px-4 py-2.5">
                  <div className="truncate text-sm font-semibold text-ink">{displayName}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${roleAccent}`} />
                    <span className="text-xs text-slate-500">{roleLabel}</span>
                  </div>
                </div>
                <NavLink
                  to="/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-ink"
                >
                  <User size={15} className="text-slate-400" />
                  Profile
                </NavLink>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50"
                >
                  <LogOut size={15} />
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
