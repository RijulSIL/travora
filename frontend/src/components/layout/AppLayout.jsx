import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';

import { PageTitleProvider } from '../../context/PageTitleContext';
import AppNavbar from './AppNavbar';
import MobileBottomNav from './MobileBottomNav';
import AppSidebar from './AppSidebar';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const role = useAuthStore(selectResolvedRole);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <PageTitleProvider>
      <div className="min-h-screen" style={{ background: '#f8f9fb' }}>
        <AppNavbar onOpenSidebar={() => setMobileOpen(true)} />

        {/* Mobile sidebar (hidden on desktop, shown on mobile when hamburger tapped) */}
        <AppSidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

        {/* Main content — full-width, offset by navbar height (14 + ~2.75rem tabs = ~6.25rem) */}
        <main className="relative min-w-0 mx-auto max-w-7xl px-4 pb-20 pt-[7.5rem] md:px-6 md:pb-6 md:pt-[7.5rem]">
          <Outlet />
        </main>

        <MobileBottomNav role={role} />
      </div>
    </PageTitleProvider>
  );
}
