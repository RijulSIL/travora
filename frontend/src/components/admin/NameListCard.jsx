import { Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Pill } from '../approvals/ApprovalQueueParts';
import { BTN_GHOST, BTN_MAIN, BTN_SM, CARD, CardHead, FIELD } from '../policy/PolicyAdminParts';

/*
 * A list of names on the Company profile page — offices or departments — with people counts,
 * rename, remove (with Undo) and add. Changes are saved with the page's Save button.
 *
 * `items` is [{ name, original, listed }]: `original` is the name people's records have (null
 * for a brand-new one), so the page can send renames; `listed` is whether it was on the saved
 * list when the page loaded.
 */

export const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (name) => String(name || '').trim().replace(/\s+/g, ' ');
export const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

// People per name, matched ignoring capitals and spaces (records may differ slightly).
export const countFor = (counts, name) =>
  name ? Object.entries(counts || {}).reduce((sum, [k, n]) => sum + (nameKey(k) === nameKey(name) ? Number(n) : 0), 0) : 0;

const TONES = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-300 bg-amber-50 text-amber-900',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
};

export function UsedIn({ items, note }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500">
      Used in:
      {items.length ? items.map((item) => <Pill key={item} tone="brand">{item}</Pill>) : <Pill>Not used anywhere else yet</Pill>}
      {note ? <span>· {note}</span> : null}
    </div>
  );
}

export default function NameListCard({ title, sub, noun, items, onChange, counts, moves, usedIn, placeholder, children }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState(null);
  const article = /^[aeiou]/i.test(noun) ? 'an' : 'a';

  const peopleIn = (item) => countFor(counts, item.original);
  const total = items.reduce((sum, item) => sum + peopleIn(item), 0);
  const taken = (name, except) => items.find((item, i) => i !== except && nameKey(item.name) === nameKey(name));

  const add = () => {
    const name = clean(newName);
    if (!name) return;
    const clash = taken(name);
    if (clash) {
      setMessage({ tone: 'rose', text: `There's already ${article} ${noun} called ${clash.name}.` });
      return;
    }
    // If people are already in an office or department by this name, keep their records linked.
    const existing = Object.keys(counts || {}).find((k) => nameKey(k) === nameKey(name));
    onChange([...items, { name, original: existing || null, listed: false }]);
    setNewName('');
    setMessage(null);
  };

  const rename = (index) => {
    const name = clean(draft);
    const item = items[index];
    if (!name) return;
    const clash = taken(name, index);
    if (clash) {
      setMessage({ tone: 'rose', text: `There's already ${article} ${noun} called ${clash.name}.` });
      return;
    }
    onChange(items.map((it, i) => (i === index ? { ...it, name } : it)));
    setEditing(null);
    const n = peopleIn(item);
    setMessage(
      item.original && n && name !== item.original
        ? { tone: 'green', text: `✓ ${item.original} → ${name}. When you save, ${moves(n)}.` }
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
        ? `${item.name} will be taken off the list when you save. The ${people(n)} in it keep it on their record until you change them in User management.`
        : `${item.name} will be removed when you save.`,
      undo: () => {
        onChange((current) => [...current.slice(0, index), item, ...current.slice(index)]);
        setMessage(null);
      },
    });
  };

  return (
    <section className={CARD} aria-label={title}>
      <CardHead title={title} sub={sub}>
        <span className="whitespace-nowrap text-[11.5px] font-bold text-slate-500">
          {items.length} {items.length === 1 ? noun : `${noun}s`} · {people(total)}
        </span>
      </CardHead>
      <div className="flex flex-col gap-3 px-4 py-3.5">
        {children}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(205px,1fr))] gap-2" aria-label={title}>
          {items.map((item, index) => {
            const n = peopleIn(item);
            const rowKey = `${item.original || 'new'}-${index}`;
            if (editing === index) {
              return (
                <li key={rowKey} className="flex min-w-0 items-center gap-1.5 rounded-[11px] border border-slate-200 bg-white px-2 py-[7px]">
                  <input
                    autoFocus
                    aria-label={`${noun} name`}
                    className={`${FIELD} !h-[30px] min-w-0 flex-1 px-2`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(index);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <button type="button" className={`${BTN_MAIN} !h-[30px] !px-2.5 !text-xs`} onClick={() => rename(index)}>
                    Rename
                  </button>
                  <button type="button" aria-label="Cancel" className="grid h-7 w-7 flex-none place-items-center rounded-lg text-slate-400 hover:bg-slate-100" onClick={() => setEditing(null)}>
                    <X size={14} />
                  </button>
                </li>
              );
            }
            const isNew = !item.listed;
            return (
              <li
                key={rowKey}
                className={`flex min-w-0 items-center gap-1.5 rounded-[11px] border py-[7px] pl-3 pr-2 ${isNew ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}
              >
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[13px] text-ink" title={item.name}>
                    {item.name}
                  </b>
                  <span className={`text-[11.5px] ${n ? 'text-slate-500' : 'text-slate-400'}`}>
                    {n ? people(n) : 'Nobody yet'}
                    {item.original && item.original !== item.name ? ` · was ${item.original}` : ''}
                    {isNew ? ' · new' : ''}
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

        <div className="flex flex-wrap gap-2">
          <input
            aria-label={`New ${noun}`}
            className={`${FIELD} min-w-[160px] flex-1`}
            placeholder={placeholder}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          <button type="button" className={BTN_GHOST} onClick={add}>
            <Plus size={15} /> Add {noun}
          </button>
        </div>

        {message ? (
          <div role="status" className={`flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2.5 text-xs leading-relaxed ${TONES[message.tone]}`}>
            <span className="min-w-0 flex-1">{message.text}</span>
            {message.undo ? (
              <button type="button" className={BTN_SM} onClick={message.undo}>
                Undo
              </button>
            ) : null}
          </div>
        ) : null}

        <UsedIn items={usedIn} />
      </div>
    </section>
  );
}
