import { Bell, ChevronDown, LogOut, Menu, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import api, { currentRefreshToken } from '../../services/api';
import { reimbursementApi } from '../../services/reimbursementApi';
import { clearSession, selectResolvedRole, useAuthStore } from '../../store/authStore';
import NotificationPanel from '../ui/NotificationPanel';
import { ROLE_LABELS, showsManager } from '../../utils/formatters';
import { roleAccent } from './roleAccent';

export default function AppNavbar({ onOpenSidebar }) {
  const navigate = useNavigate();
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const role = useAuthStore(selectResolvedRole);

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];
  const roleLabel = `${ROLE_LABELS[role] || role?.replace(/_/g, ' ') || '—'}${showsManager(role, profile?.is_manager) ? ' · Manager' : ''}`;
  const accent = roleAccent(role);
  const initial = displayName.trim().charAt(0).toUpperCase() || 'U';

  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const bellRef = useRef(null);
  const [scrolledAway, setScrolledAway] = useState(false);

  // Slides away while scrolling down, comes back on any scroll up (or near the top). Small
  // movements are ignored so it doesn't flicker on trackpad jitter.
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - last;
        if (y < 56) setScrolledAway(false);
        else if (delta > 6) setScrolledAway(true);
        else if (delta < -6) setScrolledAway(false);
        if (Math.abs(delta) > 6 || y < 56) last = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  // Stays put while the notifications or account menu is open.
  const hidden = scrolledAway && !open && !userMenuOpen;
  // Lets things that stick below the bar (e.g. the Travel Desk side panel) move up with it.
  useEffect(() => {
    document.documentElement.style.setProperty('--app-nav-h', hidden ? '0px' : '56px');
  }, [hidden]);

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

  // Close the notifications panel on outside click or Esc
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleLogout = async () => {
    try {
      // Send the saved token too: logout cancels it as well as the cookie's, which can differ.
      const token = currentRefreshToken();
      await api.post('/auth/logout', {}, { headers: token ? { 'X-Refresh-Token': token } : {} });
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
    <header
      className={`sticky top-0 z-50 bg-white border-b border-slate-200/70 shadow-sm transition-transform duration-200 ease-out focus-within:translate-y-0 motion-reduce:transition-none ${hidden ? '-translate-y-full' : ''}`}
    >
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
          <img src="/assets/travora-si-logo.png" alt="Travora" className="h-10 w-auto object-contain" />
        </NavLink>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side controls */}
        <div className="flex items-center gap-1.5">
          {/* Notifications */}
          <div className="relative" ref={bellRef}>
            <button
              type="button"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              aria-label="Notifications"
              aria-expanded={open}
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
                count={count}
                onMarkAllRead={async () => {
                  await reimbursementApi.markAllNotificationsRead();
                  refresh();
                }}
                onSelect={handleSelectNotification}
                onClose={() => setOpen(false)}
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
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white ${accent}`}>
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
                    <span className={`h-1.5 w-1.5 rounded-full ${accent}`} />
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
