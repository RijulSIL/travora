import { Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';

/*
 * The company's departments, on the Company profile page. Used by User management, the CSV
 * import, the Approval matrix's department heads and Team budgets. Changes are saved with the
 * page's Save button: renaming moves the people in a department (and its head and team budget)
 * to the new name; removing only takes it off the list — people already in it keep it.
 *
 * `items` is [{ name, original }]: `original` is the name it had when the page loaded (null for
 * one added since), so the page can send the renames.
 */

const key = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (name) => String(name || '').trim().replace(/\s+/g, ' ');

export default function DepartmentsCard({ items, onChange, counts }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState(null);

  // People per department, matched ignoring capitals and spaces (records may differ slightly).
  const peopleIn = (item) =>
    item.original ? Object.entries(counts || {}).reduce((sum, [name, n]) => sum + (key(name) === key(item.original) ? Number(n) : 0), 0) : 0;
  const total = items.reduce((sum, item) => sum + peopleIn(item), 0);
  const taken = (name, except) => items.find((item, i) => i !== except && key(item.name) === key(name));
  const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

  const add = () => {
    const name = clean(newName);
    if (!name) return;
    const clash = taken(name);
    if (clash) {
      setMessage({ tone: 'rose', text: `There's already a department called ${clash.name}.` });
      return;
    }
    onChange([...items, { name, original: null }]);
    setNewName('');
    setMessage(null);
  };

  const rename = (index) => {
    const name = clean(draft);
    const item = items[index];
    if (!name) return;
    const clash = taken(name, index);
    if (clash) {
      setMessage({ tone: 'rose', text: `There's already a department called ${clash.name}.` });
      return;
    }
    onChange(items.map((it, i) => (i === index ? { ...it, name } : it)));
    setEditing(null);
    const n = peopleIn(item);
    setMessage(
      item.original && n && name !== item.original
        ? { tone: 'green', text: `${item.original} → ${name}. When you save, the ${people(n)} in it, its department head and its team budget move to the new name.` }
        : null,
    );
  };

  const remove = (index) => {
    const item = items[index];
    const n = peopleIn(item);
    onChange(items.filter((_, i) => i !== index));
    setEditing(null);
    setMessage({
      tone: 'amber',
      text: n
        ? `${item.name} will be removed from the lists when you save. The ${people(n)} in it keep it until you change them in User management.`
        : `${item.name} will be removed when you save.`,
      undo: () => {
        onChange((current) => [...current.slice(0, index), item, ...current.slice(index)]);
        setMessage(null);
      },
    });
  };

  const tones = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-300 bg-amber-50 text-amber-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
  };

  return (
    <section className="panel p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Departments</h2>
          <p className="mt-1 text-sm text-slate-500">The departments people can be put in. Used in User management, the CSV import, the Approval matrix and Team budgets.</p>
        </div>
        <span className="text-xs font-semibold text-slate-500">
          {items.length} departments · {people(total)}
        </span>
      </div>

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2" aria-label="Departments">
        {items.map((item, index) => {
          const n = peopleIn(item);
          if (editing === index) {
            return (
              <li key={`${item.original || 'new'}-${index}`} className="flex min-w-0 items-center gap-2 rounded-[11px] border border-slate-200 bg-white px-2.5 py-2">
                <input
                  autoFocus
                  aria-label="Department name"
                  className="field h-[30px] min-w-0 flex-1 px-2 text-sm text-slate-900"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename(index);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
                <button type="button" className="btn-primary h-[30px] px-2.5 text-xs" onClick={() => rename(index)}>
                  Rename
                </button>
                <button type="button" aria-label="Cancel" className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100" onClick={() => setEditing(null)}>
                  <X size={14} />
                </button>
              </li>
            );
          }
          return (
            <li
              key={`${item.original || 'new'}-${index}`}
              className={`flex min-w-0 items-center gap-2 rounded-[11px] border px-3 py-2 ${item.original ? 'border-slate-200 bg-white' : 'border-emerald-300 bg-emerald-50/60'}`}
            >
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[13px] text-slate-900">{item.name}</b>
                <span className={`text-[11.5px] ${n ? 'text-slate-500' : 'text-slate-400'}`}>
                  {n ? people(n) : 'Nobody yet'}
                  {item.original && item.original !== item.name ? ` · was ${item.original}` : ''}
                  {!item.original ? ' · new' : ''}
                </span>
              </div>
              <button
                type="button"
                aria-label={`Rename ${item.name}`}
                className="grid h-7 w-7 flex-none place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => {
                  setDraft(item.name);
                  setEditing(index);
                  setMessage(null);
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                className="grid h-7 w-7 flex-none place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => remove(index)}
              >
                <X size={14} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label="New department"
          className="field min-w-[200px] flex-1 text-slate-900"
          placeholder="New department, e.g. Procurement"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button type="button" className="btn-secondary" onClick={add}>
          <Plus size={15} /> Add department
        </button>
      </div>

      {message ? (
        <div role="status" className={`mt-3 rounded-[10px] border px-3 py-2.5 text-xs leading-relaxed ${tones[message.tone]}`}>
          {message.tone === 'green' ? '✓ ' : ''}
          {message.text}
          {message.undo ? (
            <div className="mt-2">
              <button type="button" className="btn-secondary h-7 px-2.5 text-xs" onClick={message.undo}>
                Undo
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
