import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import PageHeader from '../../components/ui/PageHeader';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';
import { formatCurrency, formatDate } from '../../utils/formatters';

export default function AllClaimsPage() {
  useSetPageTitle('All Claims');
  const navigate = useNavigate();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    department: '',
    from_date: '',
    to_date: '',
    employee: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await reimbursementApi.claims({ all_claims: true });
      setClaims(res.data || []);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Failed to load claims');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = claims.filter((c) => {
    if (filters.status && c.status !== filters.status) return false;
    const subDate = c.submitted_at ? String(c.submitted_at).slice(0, 10) : '';
    if (filters.from_date && subDate && subDate < filters.from_date) return false;
    if (filters.to_date && subDate && subDate > filters.to_date) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader title="" />
      {error ? (
        <div className="panel rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      <section className="panel rounded p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <select
            className="field"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">All status</option>
            {['DRAFT', 'SUBMITTED', 'IN_APPROVAL', 'READY_FOR_PAYMENT', 'SENT_BACK', 'REJECTED', 'PAID'].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
          <input
            className="field"
            type="date"
            placeholder="From date"
            value={filters.from_date}
            onChange={(e) => setFilters({ ...filters, from_date: e.target.value })}
          />
          <input
            className="field"
            type="date"
            placeholder="To date"
            value={filters.to_date}
            onChange={(e) => setFilters({ ...filters, to_date: e.target.value })}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              setFilters({ status: '', department: '', from_date: '', to_date: '', employee: '' })
            }
          >
            Reset
          </button>
        </div>
      </section>

      <section className="panel table-contain mt-4 overflow-hidden rounded">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Claim Ref</th>
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Net Payable</th>
              <th className="px-4 py-3">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6">
                  <Skeleton variant="table" rows={5} columns={6} />
                </td>
              </tr>
            ) : (
              filtered.map((claim) => {
                const report = claim.compliance_report || {};
                return (
                  <tr
                    key={claim.id}
                    className="cursor-pointer border-t border-line hover:bg-slate-50"
                    onClick={() => navigate(`/claims/${claim.id}`)}
                  >
                    <td className="px-4 py-3 font-medium">{claim.claim_reference || `CLM-${claim.id}`}</td>
                    <td className="px-4 py-3">{claim.employee_id || '-'}</td>
                    <td className="px-4 py-3">{claim.status}</td>
                    <td className="px-4 py-3">{formatCurrency(report.total_claimed || 0)}</td>
                    <td className="px-4 py-3">{formatCurrency(report.net_payable || 0)}</td>
                    <td className="px-4 py-3">{claim.submitted_at ? formatDate(claim.submitted_at) : '-'}</td>
                  </tr>
                );
              })
            )}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-slate-500">
                  No claims found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
