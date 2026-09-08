import { useEffect, useState } from 'react';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { adminApi } from '../../services/adminApi';

const statLabels = {
  active_policy_version: 'Active Policy Version',
  total_employees: 'Total Employees',
  pending_hrbp_approvals: 'Pending HRBP Approvals',
  impact_level_count: 'Impact Level Count',
};

export default function Dashboard() {
  useSetPageTitle('Dashboard');
  const [stats, setStats] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.dashboardStats()
      .then((response) => setStats(response.data))
      .catch((requestError) => setError(requestError))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {error ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.response?.data?.detail || error.message}</div> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Object.entries(statLabels).map(([key, label]) => (
          <section key={key} className="panel rounded p-4">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-2 text-3xl font-semibold text-ink">{loading ? '...' : (stats[key] ?? '-')}</div>
          </section>
        ))}
      </div>
    </>
  );
}
