import { ChevronDown } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';

import { hasAnyPermission } from '../../services/permissions';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';
import { getNavConfig } from './navConfig';
import { NAV_ICON_MAP } from './navIcons';

function NavBadge({ children, variant = 'red' }) {
  if (children == null || children === '' || children === 0) return null;
  const cls =
    variant === 'red'
      ? 'bg-red-50 text-red-600 border-red-100'
      : variant === 'slate'
        ? 'bg-slate-50 text-slate-600 border-slate-100'
        : 'bg-amber-50 text-amber-600 border-amber-100';
  return (
    <span
      className={`ml-1.5 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${cls}`}
    >
      {children}
    </span>
  );
}

function NavRow({ to, end, icon, label, onNavigate, badge, badgeVariant, extra }) {
  const IconComponent = NAV_ICON_MAP[icon];
  // NavLink's own isActive only ever compares pathname, so it can't tell apart two rows
  // that share a pathname but differ by query string (e.g. /claims/pending?tab=claims vs
  // ?tab=travel) — override with an exact match instead whenever `to` carries a query string.
  const location = useLocation();
  const hasQuery = to?.includes('?');
  const exactActive = hasQuery && `${location.pathname}${location.search}` === to;

  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          'group mb-1 flex items-center gap-3 overflow-hidden rounded-lg px-3.5 text-sm font-medium border-l-2 transition-all duration-200',
          extra ? 'min-h-10 py-2' : 'h-10',
          (hasQuery ? exactActive : isActive)
            ? 'bg-brand/10 text-brand border-brand font-semibold shadow-sm'
            : 'text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900',
        ].join(' ')
      }
    >
      {IconComponent ? (
        <IconComponent
          size={18}
          className="shrink-0 text-slate-400 group-hover:text-slate-600 group-[.text-brand]:text-brand transition-colors duration-150"
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <span className="flex items-center gap-1 whitespace-nowrap">
          <span className="truncate">{label}</span>
          {badge != null ? <NavBadge variant={badgeVariant}>{badge}</NavBadge> : null}
        </span>
        {extra ? <span className="truncate text-xs font-normal text-slate-500">{extra}</span> : null}
      </span>
    </NavLink>
  );
}


/** An expandable nav row (e.g. "New Claim", or "Pending Approvals" split into Claims/Travel
 * Requests) — hovering reveals its `options` as indented rows underneath (click still toggles
 * it too, so keyboard/touch users who can't hover aren't locked out). Auto-expands when the
 * current route matches one of its children, so the selected option stays visible on
 * reload/deep-link, and stays open on mouse-leave in that case rather than snapping shut under
 * the option you're currently on. `badge` is the parent row's own count (e.g. total pending
 * across both children) — the children get their own badges resolved by the caller per-option. */
function NavGroup({ icon, label, options, onNavigate, badge, badgeVariant }) {
  const location = useLocation();
  const childIsActive = options.some((child) => location.pathname + location.search === child.to);
  const [open, setOpen] = useState(childIsActive);
  const IconComponent = NAV_ICON_MAP[icon];

  useEffect(() => {
    if (childIsActive) setOpen(true);
  }, [childIsActive]);

  return (
    <div
      className="mb-1"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(childIsActive)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={[
          'group flex h-10 w-full items-center gap-3 overflow-hidden rounded-lg border-l-2 px-3.5 text-sm font-medium transition-all duration-200',
          childIsActive
            ? 'border-brand bg-brand/5 text-brand font-semibold'
            : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900',
        ].join(' ')}
      >
        {IconComponent ? (
          <IconComponent size={18} className="shrink-0 text-slate-400 group-hover:text-slate-600" />
        ) : null}
        <span className="flex flex-1 items-center gap-1 truncate text-left">
          <span className="truncate">{label}</span>
          {badge != null ? <NavBadge variant={badgeVariant}>{badge}</NavBadge> : null}
        </span>
        <ChevronDown
          size={15}
          className={`flex-none text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-40' : 'max-h-0'}`}>
        <div className="ml-4 mt-1 space-y-1 border-l border-line pl-3">
          {options.map((child) => (
            <NavRow
              key={child.to}
              to={child.to}
              icon={child.icon}
              label={child.label}
              badge={child.resolvedBadge}
              badgeVariant={child.badgeVariant}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function resolveBadge(item, profile) {
  if (item.badge === 'pending') return profile?.pending_approvals_count;
  if (item.badge === 'pending_claims') return profile?.pending_claims_count;
  if (item.badge === 'pending_travel') return profile?.pending_travel_requests_count;
  if (item.badge === 'exceptions') return profile?.exception_requests_pending_count;
  if (item.badge === 'travel_desk') return profile?.travel_desk_queue_count;
  return null;
}

function resolveExtra(item, profile) {
  if (item.extra === 'payment_queue_sum') {
    const payTotal = profile?.payment_queue_total_inr;
    return payTotal != null
      ? `Σ ₹${Number(payTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
      : null;
  }
  return null;
}

function SidebarBody({ onNavigate }) {
  const profile = useAuthStore((state) => state.profile);
  const role = useAuthStore(selectResolvedRole);
  const config = useMemo(() => getNavConfig(role, profile), [role, profile]);

  return (
    <div className="px-1 py-2">
      {config.sections.map((section, sIdx) => {
        const items = (section.items || []).filter((item) => {
          if (!item.anyOf?.length) return true;
          return hasAnyPermission(role, item.anyOf, profile?.delegated_roles);
        });
        if (!items.length) return null;

        return (
          <div key={section.title ?? `section-${sIdx}`}>
            {section.title ? (
              <>
                <div className="my-2 border-t border-line" />
                <div className="whitespace-nowrap px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {section.title}
                </div>
              </>
            ) : null}
            {items.map((item) => {
              const groupOptions = item.children?.length ? item.children : item.submenu;
              return groupOptions?.length ? (
                <NavGroup
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  options={groupOptions.map((child) => ({
                    ...child,
                    resolvedBadge: resolveBadge(child, profile),
                  }))}
                  onNavigate={onNavigate}
                  badge={resolveBadge(item, profile)}
                  badgeVariant={item.badgeVariant}
                />
              ) : (
                <NavRow
                  key={`${item.to}-${item.label}`}
                  to={item.to}
                  end={item.end}
                  icon={item.icon}
                  label={item.label}
                  onNavigate={onNavigate}
                  badge={resolveBadge(item, profile)}
                  badgeVariant={item.badgeVariant}
                  extra={resolveExtra(item, profile)}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function AppSidebar({ mobileOpen, onClose }) {
  const onNavigate = () => onClose();

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onClose]);

  const inner = (
    <div className="flex h-full flex-col overflow-y-auto px-2 pb-6 pt-3">
      <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Navigation</div>
      <SidebarBody onNavigate={onNavigate} />
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-64 flex-none flex-col border-r border-line bg-white md:flex">
        <div className="flex h-24 flex-none items-center gap-2 border-b border-slate-100 px-1.5">
          <NavLink to="/dashboard" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <img src="/assets/travoralogo.png" alt="Travora" className="h-20 w-auto flex-none object-contain" />
          </NavLink>
        </div>

        <div className="flex-1 overflow-y-auto">
          <SidebarBody onNavigate={() => {}} />
        </div>
      </aside>

      {mobileOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-900/40 md:hidden"
            aria-label="Close menu"
            onClick={onClose}
          />
          <aside className="fixed bottom-0 left-0 top-14 z-50 w-[min(18rem,calc(100vw-2.5rem))] overflow-y-auto border-r border-line bg-white shadow-lg md:hidden">
            {inner}
          </aside>
        </>
      ) : null}
    </>
  );
}
