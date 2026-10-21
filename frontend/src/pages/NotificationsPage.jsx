import { Check, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Tabs } from '../components/approvals/ApprovalQueueParts';
import { BTN_GHOST, CARD } from '../components/policy/PolicyAdminParts';
import { KIND, dayLabel, kindOf, timeOf } from '../components/ui/notificationKinds';
import Pagination from '../components/ui/Pagination';
import Skeleton from '../components/ui/Skeleton';
import { useSetPageTitle } from '../context/PageTitleContext';
import { usePagination } from '../hooks/usePagination';
import { reimbursementApi } from '../services/reimbursementApi';

// Where opening the notification takes you, from its link.
function destination(link) {
  if (!link) return 'Open';
  if (link.startsWith('/claims/travel/new') || link.startsWith('/claims/general/new')) return 'New claim';
  if (link.startsWith('/claims/pending')) return 'Open approvals';
  if (link.startsWith('/claims')) return 'Open claim';
  if (link.startsWith('/travel-requests')) return 'Open travel request';
  if (link.startsWith('/hr/exceptions')) return 'Open exceptions';
  if (link.startsWith('/invoices')) return 'Open invoices';
  return 'Open';
}

export default function NotificationsPage() {
  useSetPageTitle('Notifications');
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [kind, setKind] = useState('');
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    reimbursementApi
      .notifications({ limit: 100 })
      .then((res) => setItems(res.data || []))
      .catch(() => setError('Could not load your notifications.'))
      .finally(() => setLoading(false));
  }, []);

  const unread = items.filter((i) => !i.is_read).length;
  const base = tab === 'unread' ? items.filter((i) => !i.is_read) : items;
  const kinds = Object.keys(KIND).filter((k) => items.some((i) => i.category === k));
  const shown = useMemo(() => (kind ? base.filter((i) => i.category === kind) : base), [base, kind]);
  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(shown);
  const now = new Date();

  const open = async (item) => {
    if (!item.is_read) {
      setItems((list) => list.map((i) => (i.sqlid === item.sqlid ? { ...i, is_read: true } : i)));
      try {
        await reimbursementApi.markNotificationRead(item.sqlid);
      } catch {
        /* still go where it points */
      }
    }
    navigate(item.link || '/dashboard');
  };
  const markAll = async () => {
    setMarkingAll(true);
    setError('');
    try {
      await reimbursementApi.markAllNotificationsRead();
      setItems((list) => list.map((i) => ({ ...i, is_read: true })));
    } catch {
      setError('Could not mark them as read. Try again.');
    } finally {
      setMarkingAll(false);
    }
  };

  let lastDay = '';
  return (
    <section className="mx-auto flex max-w-[980px] flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Notifications</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">Updates on your claims, travel requests and approvals.</p>
        </div>
        <button type="button" className={BTN_GHOST} disabled={!unread || markingAll} onClick={markAll}>
          <Check size={15} />
          {markingAll ? 'Marking…' : 'Mark all as read'}
        </button>
      </div>
      {error ? (
        <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
          {error}
        </div>
      ) : null}

      <Tabs
        label="Notifications"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setPage(1);
        }}
        tabs={[
          { key: 'all', label: 'All', count: items.length },
          { key: 'unread', label: 'Unread', count: unread, hot: unread > 0 },
        ]}
      />
      {kinds.length ? (
        <div role="group" aria-label="Kind" className="flex flex-wrap items-center gap-1.5">
          {[['', 'Everything'], ...kinds.map((k) => [k, kindOf(k)[0]])].map(([k, label]) => {
            const on = kind === k;
            const count = k ? base.filter((i) => i.category === k).length : null;
            return (
              <button
                key={k || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => setKind(k)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-[11px] py-1 text-xs font-bold ${on ? 'border-ink bg-ink text-white' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-700'}`}
              >
                {k ? <i className={`h-2 w-2 rounded-full ${kindOf(k)[2]}`} /> : null}
                {label}
                {count != null ? <span>{count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <section aria-label="Notification list" className={CARD}>
        {loading ? (
          <div className="p-4">
            <Skeleton variant="table" rows={5} columns={1} />
          </div>
        ) : pageItems.length ? (
          pageItems.map((item, index) => {
            const date = new Date(item.created_at);
            const [, tone, , Icon] = kindOf(item.category);
            const label = dayLabel(date, now);
            const header = label !== lastDay;
            lastDay = label;
            return (
              <div key={item.sqlid}>
                {header ? <div className={`bg-slate-50 px-4 py-2 text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-slate-400 ${index ? 'border-t border-slate-100' : ''}`}>{label}</div> : null}
                <button
                  type="button"
                  onClick={() => open(item)}
                  className={`grid w-full grid-cols-[34px_minmax(0,1fr)] items-start gap-3 px-4 py-3 text-left hover:bg-[#fbfdfc] sm:grid-cols-[34px_minmax(0,1fr)_auto] ${header ? '' : 'border-t border-slate-100'}`}
                >
                  <span className={`grid h-[34px] w-[34px] place-items-center rounded-[10px] ${tone}`}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[13.5px] text-ink ${item.is_read ? 'font-semibold' : 'font-extrabold'}`}>{item.title}</span>
                    {item.body ? <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">{item.body}</span> : null}
                  </span>
                  <span className="col-start-2 flex items-center gap-3 text-[11.5px] text-slate-400 sm:col-start-auto sm:flex-col sm:items-end sm:gap-1.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      {!item.is_read ? <span aria-label="Unread" className="h-2 w-2 rounded-full bg-brand" /> : null}
                      {timeOf(date)}
                    </span>
                    <span className="inline-flex items-center whitespace-nowrap font-bold text-brand">
                      {destination(item.link)}
                      <ChevronRight size={13} />
                    </span>
                  </span>
                </button>
              </div>
            );
          })
        ) : (
          <div className="px-4 py-9 text-center text-[13px] text-slate-500">
            <b className="mb-1 block text-sm text-ink">{tab === 'unread' ? 'You’re all caught up' : 'No notifications yet'}</b>
            {tab === 'unread' ? 'Nothing unread here.' : 'Updates about your claims and travel show up here.'}
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
      </section>
    </section>
  );
}
