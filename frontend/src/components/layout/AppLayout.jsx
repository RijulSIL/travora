import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';

import { PageTitleProvider } from '../../context/PageTitleContext';
import AppNavbar from './AppNavbar';
import MobileBottomNav from './MobileBottomNav';
import AppSidebar from './AppSidebar';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';

const SIDEBAR_COLLAPSED_KEY = 'travora.sidebarCollapsed';

function loadCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const role = useAuthStore(selectResolvedRole);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* private browsing / blocked storage — collapse state just won't persist */
    }
  }, [collapsed]);

  return (
    <PageTitleProvider>
      <div className="flex min-h-screen" style={{ background: '#f8f9fb' }}>
        {/* Desktop collapsible rail; also renders the mobile off-canvas sheet */}
        <AppSidebar
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <AppNavbar onOpenSidebar={() => setMobileOpen(true)} />

          {/* Content column is nearly the full width next to the sidebar, capped so lines
              don't get absurdly wide on an ultra-wide monitor — below md, margins would eat
              too much of a phone screen, so it's full-width with a small fixed padding instead. */}
          <main className="relative min-w-0 w-full px-4 pb-20 pt-4 md:mx-auto md:w-[95%] md:max-w-[1600px] md:px-0 md:pb-6">
            <Outlet />
          </main>
        </div>

        <MobileBottomNav role={role} />
      </div>
    </PageTitleProvider>
  );
}
