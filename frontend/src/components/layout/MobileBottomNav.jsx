import { MoreHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { useAuthStore } from '../../store/authStore';
import { hasAnyPermission } from '../../services/permissions';
import { getFlatNavItems, getNavConfig } from './navConfig';
import MobileMoreSheet from './MobileMoreSheet';

export default function MobileBottomNav({ role }) {
  const profile = useAuthStore((state) => state.profile);
  const [moreOpen, setMoreOpen] = useState(false);
  const config = getNavConfig(role, profile);
  const primary = useMemo(() => {
    return getFlatNavItems(role, profile).filter((item) => {
      if (!item.anyOf?.length) return true;
      return hasAnyPermission(role, item.anyOf);
    });
  }, [role]);
  const mobileItems = useMemo(
    () => config.mobile.map((path) => primary.find((i) => i.to === path)).filter(Boolean).slice(0, 4),
    [config.mobile, primary],
  );
  const moreItems = useMemo(
    () => primary.filter((item) => !mobileItems.some((p) => p.to === item.to)),
    [primary, mobileItems],
  );

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-[60] border-t border-line bg-white md:hidden">
        <div className="grid grid-cols-5">
          {mobileItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] ${isActive ? 'text-brand' : 'text-slate-600'}`
              }
            >
              <span>{item.emoji}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] text-slate-600"
            onClick={() => setMoreOpen(true)}
          >
            <MoreHorizontal size={16} />
            <span>More</span>
          </button>
        </div>
      </nav>
      <MobileMoreSheet open={moreOpen} items={moreItems} onClose={() => setMoreOpen(false)} />
    </>
  );
}
