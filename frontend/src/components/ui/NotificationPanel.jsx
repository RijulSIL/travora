import { ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { dayLabel, kindOf, timeOf } from './notificationKinds';

/** The bell's drop-down: latest notifications grouped by day, with Mark all read and a link to the full page. */
export default function NotificationPanel({ items, count, onMarkAllRead, onSelect, onClose }) {
  const [marking, setMarking] = useState(false);
  const now = new Date();
  // Newest first, grouped under Today / Yesterday / the date.
  const groups = [];
  items.forEach((item) => {
    const date = new Date(item.created_at);
    const label = dayLabel(date, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push({ item, date });
    else groups.push({ label, items: [{ item, date }] });
  });

  const markAll = async () => {
    setMarking(true);
    try {
      await onMarkAllRead();
    } catch {
      /* leave them unread; the button comes back so they can try again */
    } finally {
      setMarking(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="fixed inset-x-2 top-[60px] z-50 flex max-h-[min(640px,calc(100vh-76px))] flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-[0_24px_48px_-20px_rgba(15,23,42,0.28)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[400px]"
    >
      <div className="flex items-center justify-between gap-2.5 border-b border-slate-100 px-3.5 py-3">
        <h2 className="flex items-center gap-2 text-[14.5px] font-extrabold text-ink">
          Notifications
          {count > 0 ? <span className="rounded-full bg-rose-50 px-2 py-px text-[11px] font-bold text-rose-700">{count} unread</span> : null}
        </h2>
        <button
          type="button"
          onClick={markAll}
          disabled={!count || marking}
          className="inline-flex items-center gap-1.5 rounded-[7px] px-1.5 py-1 text-xs font-bold text-brand hover:bg-brand/10 disabled:cursor-default disabled:bg-transparent disabled:text-slate-400"
        >
          <Check size={14} />
          {marking ? 'Marking…' : 'Mark all read'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {groups.length ? (
          groups.map((group, gi) => (
            // One block per day, so each day's sticky header is pushed out by the next one.
            <section key={group.label} aria-label={group.label}>
              <div className={`sticky top-0 z-[1] bg-slate-50 px-3.5 py-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400 ${gi ? 'border-t border-slate-100' : ''}`}>
                {group.label}
              </div>
              {group.items.map(({ item, date }, i) => {
                const [, tone, , Icon] = kindOf(item.category);
                return (
                  <button
                    key={item.sqlid}
                    type="button"
                    onClick={() => onSelect(item)}
                    className={`grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-[11px] px-3.5 py-[11px] text-left hover:bg-[#fbfdfc] ${i ? 'border-t border-slate-100' : ''} ${item.is_read ? 'bg-white' : 'bg-[#f7fbf9]'}`}
                  >
                    <span className={`grid h-8 w-8 place-items-center rounded-[9px] ${tone}`}>
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[13px] leading-snug text-ink ${item.is_read ? 'font-semibold' : 'font-extrabold'}`}>{item.title}</span>
                      {item.body ? <span className="mt-0.5 line-clamp-2 text-xs leading-[1.45] text-slate-500">{item.body}</span> : null}
                    </span>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap pt-0.5 text-[11px] text-slate-400">
                      {!item.is_read ? <span aria-label="Unread" className="h-[7px] w-[7px] rounded-full bg-brand" /> : null}
                      {timeOf(date)}
                    </span>
                  </button>
                );
              })}
            </section>
          ))
        ) : (
          <div className="px-5 py-9 text-center text-[13px] text-slate-500">
            <b className="mb-1 block text-sm text-ink">No notifications yet</b>
            Updates about your claims and travel show up here.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3.5 py-2.5 text-xs text-slate-500">
        <span>{items.length ? `Latest ${items.length}` : ''}</span>
        <Link to="/notifications" onClick={onClose} className="inline-flex items-center gap-1 font-bold text-brand hover:underline">
          See all notifications
          <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
