import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSetPageTitle } from '../context/PageTitleContext';
import { reimbursementApi } from '../services/reimbursementApi';

const PAGE_SIZE = 10;

export default function NotificationsPage() {
  useSetPageTitle('Notifications');
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);

  const load = async () => {
    const res = await reimbursementApi.notifications({ limit: 100 });
    setItems(res.data || []);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => (category ? items.filter((item) => item.category === category) : items),
    [items, category],
  );
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const open = async (item) => {
    if (!item.is_read) await reimbursementApi.markNotificationRead(item.sqlid);
    navigate(item.link || '/dashboard');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-ink">Notifications</h2>
        <select className="rounded border border-line px-2 py-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          <option value="APPROVAL_REQUIRED">Approval required</option>
          <option value="CLAIM_UPDATE">Claim update</option>
          <option value="PAYMENT">Payment</option>
          <option value="SLA_BREACH">SLA breach</option>
          <option value="EXCEPTION">Exception</option>
          <option value="SYSTEM">System</option>
        </select>
      </div>
      <div className="rounded border border-line bg-white">
        {paginated.map((item) => (
          <button key={item.sqlid} className="w-full border-b border-line px-4 py-3 text-left hover:bg-slate-50" onClick={() => open(item)}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">{item.title}</div>
              {!item.is_read ? <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">New</span> : null}
            </div>
            <div className="text-xs text-slate-600">{item.body || '—'}</div>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button className="btn-secondary text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Prev
        </button>
        <span className="text-xs text-slate-600">
          {page}/{totalPages}
        </span>
        <button className="btn-secondary text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
