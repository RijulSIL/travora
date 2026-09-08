import { useEffect, useState } from 'react';

import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';
import { formatCurrency } from '../../utils/formatters';

export default function TeamSpend() {
  useSetPageTitle('Team Spend');
  const [spendData, setSpendData] = useState({ total_spend: 0, by_category: {} });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await reimbursementApi.teamSpend();
        if (cancelled) return;
        setSpendData(res.data || { total_spend: 0, by_category: {} });
      } catch (e) {
        setError(e?.response?.data?.detail || e.message || 'Failed to load spend data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = Object.entries(spendData.by_category || {}).sort((a, b) => b[1] - a[1]);
  const maxSpend = categories.length > 0 ? categories[0][1] : 0;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <p className="text-sm text-slate-600">
          Summary of reimbursement spend for your team.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : null}
      
      {error ? (
        <div className="panel rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="space-y-6">
          {/* Total Spend Card */}
          <div className="panel rounded-lg border border-slate-200 bg-white p-6 text-center">
            <h2 className="text-sm font-medium text-slate-600">Total Team Spend</h2>
            <p className="mt-2 text-4xl font-bold text-ink">{formatCurrency(spendData.total_spend)}</p>
          </div>

          {/* Breakdown by Category */}
          <div className="panel rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="mb-4 text-lg font-bold text-ink">Breakdown by Category</h2>
            
            {categories.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No spend data available.</p>
            ) : (
              <div className="space-y-4">
                {categories.map(([category, amount]) => {
                  const percentage = maxSpend > 0 ? (amount / maxSpend) * 100 : 0;
                  return (
                    <div key={category}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-slate-700">{category}</span>
                        <span className="font-bold text-ink">{formatCurrency(amount)}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5">
                        <div 
                          className="bg-blue-600 h-2.5 rounded-full" 
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
