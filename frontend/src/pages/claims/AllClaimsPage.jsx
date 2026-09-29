import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import ClaimStatusBadge from '../../components/ui/ClaimStatusBadge';
import ReimbursementCategoryBadge from '../../components/ui/ReimbursementCategoryBadge';
import PageHeader from '../../components/ui/PageHeader';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { usePagination } from '../../hooks/usePagination';
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
    category: '',
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
    if (filters.category && (c.reimbursement_category || 'TRAVEL') !== filters.category) return false;
    const subDate = c.submitted_at ? String(c.submitted_at).slice(0, 10) : '';
    if (filters.from_date && subDate && subDate < filters.from_date) return false;
    if (filters.to_date && subDate && subDate > filters.to_date) return false;
    return true;
  });

  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(filtered);

  return (
    <div className="space-y-4">
      <PageHeader title="" />
      {error ? (
        <div className="panel rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      <section className="panel rounded p-4">
        <div className="grid gap-3 md:grid-cols-5">
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
          <select
            className="field"
            value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          >
            <option value="">All categories</option>
            <option value="TRAVEL">Travel</option>
            <option value="GENERAL">General</option>
            <option value="REALLOCATION">Reallocation</option>
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
              setFilters({ status: '', category: '', department: '', from_date: '', to_date: '', employee: '' })
            }
          >
            Reset
          </button>
        </div>
      </section>

      <section className="panel table-contain mt-4 overflow-hidden rounded">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-center text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">S. No</th>
              <th className="px-4 py-3">Claim Ref</th>
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Net Payable</th>
              <th className="px-4 py-3">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-6">
                  <Skeleton variant="table" rows={5} columns={8} />
                </td>
              </tr>
            ) : (
              pageItems.map((claim, index) => {
                const report = claim.compliance_report || {};
                return (
                  <tr
                    key={claim.id}
                    className="cursor-pointer border-t border-line hover:bg-slate-50"
                    onClick={() => navigate(`/claims/${claim.id}`)}
                  >
                    <td className="px-4 py-3 text-center text-slate-500">{startIndex + index + 1}</td>
                    <td className="px-4 py-3 text-center font-medium">{claim.claim_reference || `CLM-${claim.id}`}</td>
                    <td className="px-4 py-3 text-center">{claim.employee_id || '-'}</td>
                    <td className="px-4 py-3 text-center"><ReimbursementCategoryBadge category={claim.reimbursement_category} /></td>
                    <td className="px-4 py-3 text-center"><ClaimStatusBadge status={claim.status} /></td>
                    <td className="px-4 py-3 text-center">{formatCurrency(report.total_claimed || 0)}</td>
                    <td className="px-4 py-3 text-center">{formatCurrency(report.net_payable || 0)}</td>
                    <td className="px-4 py-3 text-center">{claim.submitted_at ? formatDate(claim.submitted_at) : '-'}</td>
                  </tr>
                );
              })
            )}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-4 text-center text-slate-500">
                  No claims found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} startIndex={startIndex} />
      </section>
    </div>
  );
}
