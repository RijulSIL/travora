import { NavLink } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import {
  Home,
  Clock,
  AlertTriangle,
  Users,
  TrendingUp,
  CheckSquare,
  FileText,
  Plane,
  Receipt,
  PlusCircle,
  Settings,
  Map,
  DollarSign,
  Folder,
  Mail,
  Calendar,
  Building,
  User,
  History,
  ClipboardList
} from 'lucide-react';

import { hasAnyPermission } from '../../services/permissions';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';
import { getNavConfig } from './navConfig';

const ICON_MAP = {
  '🏠': Home,
  '📋': ClipboardList,
  '⏳': Clock,
  '🚨': AlertTriangle,
  '👥': Users,
  '📊': TrendingUp,
  '✅': CheckSquare,
  '✈️': Plane,
  '➕': PlusCircle,
  '🧾': Receipt,
  '⚙️': Settings,
  '🏙️': Map,
  '💰': DollarSign,
  '📂': Folder,
  '📧': Mail,
  '📅': Calendar,
  '🏢': Building,
  '📈': TrendingUp,
  '💳': Receipt,
  '🏦': Building,
  '👤': User,
  '📜': History,
};

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

function NavRow({ to, end, emoji, label, onNavigate, badge, badgeVariant, extra }) {
  const IconComponent = ICON_MAP[emoji];

  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          'group mb-1 flex min-h-[2.5rem] items-center gap-3 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-150 border-l-2',
          isActive
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
      ) : (
        <span aria-hidden="true" className="shrink-0">{emoji}</span>
      )}
      <span className="flex flex-1 flex-wrap items-center gap-1">
        <span>{label}</span>
        {badge != null ? <NavBadge variant={badgeVariant}>{badge}</NavBadge> : null}
        {extra ? <span className="ml-auto text-xs font-normal text-slate-500">{extra}</span> : null}
      </span>
    </NavLink>
  );
}


function resolveBadge(item, profile) {
  if (item.badge === 'pending') return profile?.pending_approvals_count;
  if (item.badge === 'exceptions') return profile?.exception_requests_pending_count;
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
          return hasAnyPermission(role, item.anyOf);
        });
        if (!items.length) return null;

        return (
          <div key={section.title ?? `section-${sIdx}`}>
            {section.title ? (
              <>
                <div className="my-2 border-t border-line" />
                <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {section.title}
                </div>
              </>
            ) : null}
            {items.map((item) => (
              <NavRow
                key={`${item.to}-${item.label}`}
                to={item.to}
                end={item.end}
                emoji={item.emoji}
                label={item.label}
                onNavigate={onNavigate}
                badge={resolveBadge(item, profile)}
                badgeVariant={item.badgeVariant}
                extra={resolveExtra(item, profile)}
              />
            ))}
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
      {/* Desktop sidebar removed — nav is now horizontal top tabs */}

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
