import { NavLink } from 'react-router-dom';

import { NAV_ICON_MAP } from './navIcons';

export default function MobileMoreSheet({ open, items, onClose }) {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[70] bg-slate-900/40 md:hidden"
        aria-label="Close more menu"
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-0 right-0 z-[80] rounded-t-2xl border border-line bg-white p-4 md:hidden">
        <div className="mb-3 text-sm font-semibold text-slate-700">More</div>
        <div className="grid gap-2">
          {items.map((item) => {
            const IconComponent = NAV_ICON_MAP[item.icon];
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className="flex items-center min-h-[44px] rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                {IconComponent ? <IconComponent size={16} className="mr-2 shrink-0" /> : null}
                {item.label}
              </NavLink>
            );
          })}
        </div>
      </div>
    </>
  );
}
