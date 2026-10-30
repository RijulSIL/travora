import { ChevronDown, ClipboardList, Plane, Plus, Truck } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';

import { hasAnyPermission } from '../../services/permissions';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';
import { getNavConfig } from './navConfig';
import { NAV_ICON_MAP } from './navIcons';

function NavBadge({ children, variant = 'red' }) {
  if (children == null || children === '' || children === 0) return null;
  const cls = variant === 'red' ? 'bg-rose-50 text-rose-700' : variant === 'slate' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700';
  return (
    <span className={`ml-auto inline-grid h-[18px] min-w-[20px] shrink-0 place-items-center rounded-full px-1.5 text-[10.5px] font-extrabold ${cls}`}>
      {children}
    </span>
  );
}

const ROW =
  'group relative mb-0.5 flex w-full items-center gap-[11px] rounded-[9px] px-2.5 text-left text-[13px] transition-colors duration-150';
const ROW_IDLE = 'font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900';
const ROW_ACTIVE =
  "bg-brand/10 font-extrabold text-brand before:absolute before:-left-2.5 before:top-[9px] before:bottom-[9px] before:w-[3px] before:rounded-r before:bg-brand before:content-['']";

function NavRow({ to, end, icon, label, onNavigate, badge, badgeVariant, extra, small = false }) {
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
        [ROW, extra ? 'min-h-[38px] py-1.5' : small ? 'h-8 text-[12.5px]' : 'h-[38px]', (hasQuery ? exactActive : isActive) ? ROW_ACTIVE : ROW_IDLE].join(' ')
      }
    >
      {({ isActive }) => {
        const active = hasQuery ? exactActive : isActive;
        return (
          <>
            {IconComponent ? (
              <IconComponent
                size={small ? 16 : 18}
                className={`shrink-0 transition-colors ${active ? 'text-brand' : 'text-slate-400 group-hover:text-slate-600'}`}
              />
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <span className="truncate">{label}</span>
              {extra ? <span className="truncate text-[11px] font-medium text-slate-500">{extra}</span> : null}
            </span>
            {badge != null ? <NavBadge variant={badgeVariant}>{badge}</NavBadge> : null}
          </>
        );
      }}
    </NavLink>
  );
}

/** A row with sub-pages (e.g. "Pending Approvals" → Claims / Travel Requests / Relocation).
 * Click opens or closes it; it opens on its own when you're on one of its pages, so the page
 * you're on stays visible. `badge` is the parent's own count; children get theirs per option. */
function NavGroup({ icon, label, options, onNavigate, badge, badgeVariant }) {
  const location = useLocation();
  const childIsActive = options.some((child) => location.pathname + location.search === child.to);
  const [open, setOpen] = useState(childIsActive);
  const IconComponent = NAV_ICON_MAP[icon];

  useEffect(() => {
    if (childIsActive) setOpen(true);
  }, [childIsActive]);

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`${ROW} h-[38px] ${childIsActive ? 'font-extrabold text-brand' : ROW_IDLE}`}
      >
        {IconComponent ? (
          <IconComponent size={18} className={`shrink-0 ${childIsActive ? 'text-brand' : 'text-slate-400 group-hover:text-slate-600'}`} />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge != null ? <NavBadge variant={badgeVariant}>{badge}</NavBadge> : null}
        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="mb-1 ml-[21px] border-l border-slate-200 pl-2.5">
          {options.map((child) => (
            <NavRow
              key={child.to}
              to={child.to}
              icon={child.icon}
              label={child.label}
              badge={child.resolvedBadge}
              badgeVariant={child.badgeVariant}
              onNavigate={onNavigate}
              small
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function resolveBadge(item, profile) {
  if (item.badge === 'pending') return profile?.pending_approvals_count;
  if (item.badge === 'pending_claims') return profile?.pending_claims_count;
  if (item.badge === 'pending_travel') return profile?.pending_travel_requests_count;
  if (item.badge === 'pending_relocation') return profile?.pending_relocation_count;
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

/** The small label a link is grouped under, by page — so every role's links read in tidy
 * groups (Approvals, Team, Claims, Travel, …) without each role's nav list having to spell
 * them out. Sections that already carry a title (e.g. "Policy Administration") keep it. */
function groupFor(to) {
  const path = String(to || '').split('?')[0];
  if (path === '/dashboard') return null;
  if (path === '/claims/pending' || path === '/hr/exceptions' || path === '/finance/payment-queue' || path === '/travel-desk') {
    return 'Approvals';
  }
  if (path.startsWith('/team/')) return 'Team';
  if (path === '/claims/my' || path === '/invoices' || path === '/claims/all') return 'Claims';
  if (path === '/travel-requests') return 'Travel';
  if (path === '/compliance' || path === '/reports' || path.startsWith('/finance/')) return 'Reports & finance';
  if (path.startsWith('/admin/')) return 'Administration';
  return null;
}

function isNewClaimItem(item) {
  return Boolean(item.children?.length) && item.children.some((c) => c.to === '/claims/travel/new');
}

/** Splits an untitled section into labelled groups (in order of first appearance; each group
 * keeps its links' own order). A titled section stays as it is. */
function toGroups(section) {
  if (section.title) return [{ title: section.title, items: section.items }];
  const groups = [];
  const byTitle = new Map();
  section.items.forEach((item) => {
    const title = groupFor(item.to ?? item.submenu?.[0]?.to);
    if (!byTitle.has(title)) {
      const g = { title, items: [] };
      byTitle.set(title, g);
      groups.push(g);
    }
    byTitle.get(title).items.push(item);
  });
  return groups;
}

const NEW_CLAIM_HINTS = {
  '/claims/travel/new': { icon: Plane, hint: 'Expenses from a business trip' },
  '/claims/general/new': { icon: ClipboardList, hint: "Anything that isn't a trip" },
  '/claims/relocation/new': { icon: Truck, hint: 'Moving to a new posting' },
};

/** "New claim" as a button with a small menu (Travel claim / General reimbursement / Relocation claim). */
function NewClaimButton({ options, onNavigate }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative mx-3 mb-3 mt-1" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-[38px] w-full items-center justify-center gap-2 rounded-[10px] bg-brand text-[13px] font-extrabold text-white shadow-[0_6px_14px_rgba(15,107,82,.22)] transition-colors hover:bg-brand/90"
      >
        <Plus size={16} strokeWidth={3} /> New claim
      </button>
      {open ? (
        <div role="menu" className="absolute inset-x-0 top-[44px] z-30 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_14px_34px_rgba(15,23,42,.16)]">
          {options.map((opt) => {
            const meta = NEW_CLAIM_HINTS[opt.to] || {};
            const Icon = meta.icon || NAV_ICON_MAP[opt.icon] || Plus;
            return (
              <button
                key={opt.to}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                  navigate(opt.to);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-bold text-ink">{opt.label}</span>
                  {meta.hint ? <span className="block text-[11px] text-slate-500">{meta.hint}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SidebarBody({ onNavigate }) {
  const profile = useAuthStore((state) => state.profile);
  const role = useAuthStore(selectResolvedRole);
  const config = useMemo(() => getNavConfig(role, profile), [role, profile]);

  const visible = (item) => !item.anyOf?.length || hasAnyPermission(profile?.permissions, item.anyOf);
  const allItems = config.sections.flatMap((s) => s.items || []);
  const newClaim = allItems.find(isNewClaimItem);

  return (
    <>
      {newClaim ? <NewClaimButton options={newClaim.children} onNavigate={onNavigate} /> : null}
      <nav className="px-2.5 pb-3" aria-label="Main">
        {config.sections.flatMap((section, sIdx) => {
          const items = (section.items || []).filter((item) => visible(item) && !isNewClaimItem(item));
          if (!items.length) return [];
          return toGroups({ ...section, items }).map((group, gIdx) => (
            <div key={`${section.title ?? `s${sIdx}`}-${group.title ?? gIdx}`} className={sIdx === 0 && gIdx === 0 ? '' : 'mt-3'}>
              {group.title ? (
                <div className="px-2.5 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-400">{group.title}</div>
              ) : null}
              {group.items.map((item) => {
                const groupOptions = item.children?.length ? item.children : item.submenu;
                return groupOptions?.length ? (
                  <NavGroup
                    key={item.label}
                    icon={item.icon}
                    label={item.label}
                    options={groupOptions.map((child) => ({ ...child, resolvedBadge: resolveBadge(child, profile) }))}
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
          ));
        })}
      </nav>
    </>
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

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 flex-none flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-[92px] flex-none items-center justify-center px-3">
          <NavLink to="/dashboard" className="flex min-w-0 items-center" aria-label="Travora home">
            <img src="/assets/travora-si-logo.png" alt="Travora" className="h-[72px] w-auto max-w-full flex-none object-contain" />
          </NavLink>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarBody onNavigate={() => {}} />
        </div>
      </aside>

      {mobileOpen ? (
        <>
          <button type="button" className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" aria-label="Close menu" onClick={onClose} />
          <aside className="fixed bottom-0 left-0 top-14 z-50 flex w-[min(18rem,calc(100vw-2.5rem))] flex-col border-r border-slate-200 bg-white shadow-lg md:hidden">
            <div className="min-h-0 flex-1 overflow-y-auto pt-3">
              <SidebarBody onNavigate={onNavigate} />
            </div>
              </aside>
        </>
      ) : null}
    </>
  );
}
