import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { formatRole } from '../../utils/formatters';

/*
 * The whole organisation as a reporting tree (Admin → User Management → Org chart): each box shows
 * a person's name, level and role; click a name to open them (edit there); the + under a manager
 * adds someone reporting to them. It's drawn from the users list the page already holds, so adding
 * or editing someone updates the chart at once — new people flash briefly where they land.
 */

const CSS = `
.orgchart ul { display: flex; justify-content: center; padding-top: 22px; position: relative; margin: 0; list-style: none; }
.orgchart li { position: relative; display: flex; flex-direction: column; align-items: center; padding: 22px 8px 0; }
.orgchart li::before, .orgchart li::after { content: ''; position: absolute; top: 0; right: 50%; width: 50%; height: 22px; border-top: 2px solid var(--org-line); }
.orgchart li::after { right: auto; left: 50%; border-left: 2px solid var(--org-line); }
.orgchart li:only-child::before, .orgchart li:only-child::after { display: none; }
.orgchart li:only-child { padding-top: 0; }
.orgchart li:first-child::before, .orgchart li:last-child::after { border: 0 none; }
.orgchart li:last-child::before { border-right: 2px solid var(--org-line); border-radius: 0 8px 0 0; }
.orgchart li:first-child::after { border-radius: 8px 0 0 0; }
.orgchart ul ul::before { content: ''; position: absolute; top: 0; left: 50%; height: 22px; border-left: 2px solid var(--org-line); }
.orgchart > ul { padding-top: 0; }
.orgchart > ul > li { padding-top: 0; }
.orgchart > ul > li::before, .orgchart > ul > li::after { display: none; }
.orgchart { --org-line: #cbd5e1; }
@keyframes org-new { 0% { box-shadow: 0 0 0 0 rgba(15, 107, 82, .55); } 100% { box-shadow: 0 0 0 14px rgba(15, 107, 82, 0); } }
.org-new { animation: org-new 1.1s ease-out 3; }
@media (prefers-reduced-motion: reduce) { .org-new { animation: none; outline: 2px solid #0f6b52; } }
`;

const byRoleThenName = (a, b) => {
  if ((a.role === 'CEO') !== (b.role === 'CEO')) return a.role === 'CEO' ? -1 : 1;
  return String(a.full_name || a.email).localeCompare(String(b.full_name || b.email));
};

/** { roots, children, ancestors } — the reporting tree built from each person's manager. */
function buildTree(users) {
  const byEmp = new Map(users.filter((u) => u.employee_id).map((u) => [u.employee_id, u]));
  const children = new Map();
  const roots = [];
  for (const u of users) {
    const parent = u.reporting_manager_id ? byEmp.get(u.reporting_manager_id) : null;
    if (parent && parent.user_id !== u.user_id) {
      if (!children.has(parent.user_id)) children.set(parent.user_id, []);
      children.get(parent.user_id).push(u);
    } else {
      roots.push(u);
    }
  }
  for (const list of children.values()) list.sort(byRoleThenName);
  roots.sort(byRoleThenName);
  // A reporting loop would leave its members unreachable from any root: put them on the chart too.
  const seen = new Set();
  const walk = (u) => {
    if (seen.has(u.user_id)) return;
    seen.add(u.user_id);
    (children.get(u.user_id) || []).forEach(walk);
  };
  roots.forEach(walk);
  for (const u of users) {
    if (!seen.has(u.user_id)) {
      roots.push(u);
      walk(u);
    }
  }
  const parentOf = new Map();
  for (const [pid, list] of children) list.forEach((c) => parentOf.set(c.user_id, pid));
  return { roots, children, parentOf };
}

function Card({ user, level, selected, fresh, match, count, onOpen }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Open ${user.full_name || user.email}`}
      onClick={() => onOpen(user)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(user);
        }
      }}
      className={`w-[196px] cursor-pointer rounded-xl border bg-white px-3 py-2.5 text-center shadow-sm transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
        selected ? 'border-brand ring-2 ring-brand/25' : match ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200 hover:border-brand/50 hover:shadow-md'
      } ${user.is_active ? '' : 'opacity-55'} ${fresh ? 'org-new' : ''}`}
    >
      <div className="truncate text-[13.5px] font-extrabold text-ink">{user.full_name || user.email}</div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
        {level ? (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink" title={level.level_name}>
            {level.level_code}
          </span>
        ) : (
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-700">No level</span>
        )}
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10.5px] font-bold text-brand">{formatRole(user.role)}</span>
      </div>
      {user.department || !user.is_active || count ? (
        <div className="mt-1 truncate text-[11px] text-slate-500">
          {[user.department, !user.is_active ? 'Inactive' : null, count ? `${count} in team` : null].filter(Boolean).join(' · ')}
        </div>
      ) : null}
    </div>
  );
}

export default function OrgChart({ users, levelById, selectedId, onOpen, onAddUnder }) {
  const [showInactive, setShowInactive] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [fresh, setFresh] = useState(() => new Set());
  const known = useRef(null);

  const visible = useMemo(() => (showInactive ? users : users.filter((u) => u.is_active)), [users, showInactive]);
  const { roots, children, parentOf } = useMemo(() => buildTree(visible), [visible]);

  // Anyone who wasn't here a moment ago (just added, or just moved here) flashes.
  useEffect(() => {
    const ids = new Set(visible.map((u) => u.user_id));
    if (known.current) {
      const added = [...ids].filter((id) => !known.current.has(id));
      if (added.length) {
        setFresh(new Set(added));
        setCollapsed((prev) => {
          // Make sure a new person isn't hidden inside a collapsed branch.
          const next = new Set(prev);
          for (const id of added) {
            let p = parentOf.get(id);
            while (p != null) {
              next.delete(p);
              p = parentOf.get(p);
            }
          }
          return next;
        });
        const t = setTimeout(() => setFresh(new Set()), 3600);
        known.current = ids;
        return () => clearTimeout(t);
      }
    }
    known.current = ids;
    return undefined;
  }, [visible, parentOf]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? new Set(visible.filter((u) => [u.full_name, u.email, u.employee_id].some((v) => String(v || '').toLowerCase().includes(q))).map((u) => u.user_id)) : new Set()),
    [visible, q],
  );
  // While searching, branches that lead to a match are open.
  const forcedOpen = useMemo(() => {
    const open = new Set();
    for (const id of matches) {
      let p = parentOf.get(id);
      while (p != null) {
        open.add(p);
        p = parentOf.get(p);
      }
    }
    return open;
  }, [matches, parentOf]);

  const countBelow = (id) => {
    let n = 0;
    const stack = [...(children.get(id) || [])];
    while (stack.length) {
      const u = stack.pop();
      n += 1;
      stack.push(...(children.get(u.user_id) || []));
    }
    return n;
  };
  const managers = [...children.keys()];
  const allCollapsed = managers.length > 0 && managers.every((id) => collapsed.has(id));
  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNode = (u) => {
    const kids = children.get(u.user_id) || [];
    const isCollapsed = kids.length > 0 && collapsed.has(u.user_id) && !forcedOpen.has(u.user_id);
    const canAdd = u.is_active && (u.is_manager || u.role === 'CEO') && u.employee_id;
    return (
      <li key={u.user_id}>
        <Card
          user={u}
          level={levelById(u.impact_level_id)}
          selected={selectedId === u.user_id}
          fresh={fresh.has(u.user_id)}
          match={matches.has(u.user_id)}
          count={kids.length ? countBelow(u.user_id) : 0}
          onOpen={onOpen}
        />
        <div className="mt-1 flex items-center gap-1">
          {kids.length ? (
            <button
              type="button"
              onClick={() => toggle(u.user_id)}
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? 'Show' : 'Hide'} ${u.full_name || u.email}'s team`}
              className="inline-flex h-6 items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              {kids.length}
            </button>
          ) : null}
          {canAdd ? (
            <button
              type="button"
              onClick={() => onAddUnder(u)}
              aria-label={`Add someone who reports to ${u.full_name || u.email}`}
              title="Add someone who reports to them"
              className="inline-grid h-6 w-6 place-items-center rounded-full border border-dashed border-slate-300 bg-white text-slate-500 hover:border-brand hover:text-brand"
            >
              <Plus size={12} />
            </button>
          ) : null}
        </div>
        {kids.length && !isCollapsed ? <ul>{kids.map(renderNode)}</ul> : null}
      </li>
    );
  };

  return (
    <div>
      <style>{CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 px-4 py-3">
        <label className="relative w-full sm:w-[260px]">
          <span className="sr-only">Find someone in the chart</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="h-8 w-full rounded-[10px] border border-slate-200 bg-white pl-8 pr-2 text-[12.5px] outline-none focus:border-brand"
            placeholder="Find someone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-600">
          <span className="text-slate-500">{visible.length} people</span>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
          </label>
          <button
            type="button"
            className="h-8 rounded-[10px] border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-700 hover:bg-slate-50"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(managers))}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      </div>
      {visible.length ? (
        <div className="orgchart overflow-auto px-4 pb-8 pt-6" tabIndex={0} aria-label="Organisation chart">
          <div className="mx-auto w-max min-w-full">
            <ul>{roots.map(renderNode)}</ul>
          </div>
        </div>
      ) : (
        <div className="px-4 py-9 text-center text-[13px] text-slate-500">
          <b className="mb-1 block text-sm text-ink">Nobody to show yet</b>
          Add someone to start the chart.
        </div>
      )}
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11.5px] text-slate-500">
        Click a box to open and edit that person. The + under a manager adds someone who reports to them. People with no manager set appear at the top.
      </p>
    </div>
  );
}
