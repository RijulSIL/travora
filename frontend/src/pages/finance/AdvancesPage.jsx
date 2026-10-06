import { AlertTriangle, ChevronDown, HandCoins, IndianRupee, Pencil, Plus, Search, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import { usePagination } from '../../hooks/usePagination';
import { reimbursementApi } from '../../services/reimbursementApi';

const money = (v) =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDate = (v) => (v ? new Date(v).toLocaleDateString() : '—');

export default function AdvancesPage() {
  useSetPageTitle('Advances');
  const [tab, setTab] = useState('active');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [archivedRows, setArchivedRows] = useState([]);
  const [archivedLoading, setArchivedLoading] = useState(true);
  const [archivedError, setArchivedError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const [search, setSearch] = useState('');

  // modal = null | { mode: 'grant' } | { mode: 'edit', row }
  const [modal, setModal] = useState(null);
  const [identifier, setIdentifier] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Set when granting hits a 409 because the employee already has an active advance — holds
  // the confirmation message from the backend; the grant form's own state (identifier/amount/
  // purpose) is left untouched underneath so confirming can just resubmit with confirm_merge.
  const [mergeConfirm, setMergeConfirm] = useState(null);

  // settleModal = null | { row } — kept separate from `modal` since it settles the employee's
  // pooled outstanding balance, not one specific grant's amount/purpose.
  const [settleModal, setSettleModal] = useState(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState('');

  useBodyScrollLock(Boolean(modal) || Boolean(settleModal));

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reimbursementApi.listAdvances();
      setRows(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to load advances');
    } finally {
      setLoading(false);
    }
  };

  const loadArchived = async () => {
    setArchivedLoading(true);
    setArchivedError('');
    try {
      const res = await reimbursementApi.listArchivedAdvances();
      setArchivedRows(res.data || []);
    } catch (err) {
      setArchivedError(err?.response?.data?.detail || 'Failed to load settled advances');
    } finally {
      setArchivedLoading(false);
    }
  };

  useEffect(() => {
    // Both load eagerly on mount — the Settled tab's count badge needs the real number even
    // before it's ever been opened, not just a stale 0 from an array nothing has populated yet.
    load();
    loadArchived();
  }, []);

  const openGrantModal = () => {
    setIdentifier('');
    setAmount('');
    setPurpose('');
    setFormError('');
    setModal({ mode: 'grant' });
  };

  const openEditModal = (row) => {
    setIdentifier('');
    // Editing corrects the originally-granted figure, not what's currently left — the backend
    // shifts the remaining balance by the same delta, so any amount already settled off this
    // grant stays settled instead of being wiped back to the full new amount.
    setAmount(String(row.granted_amount));
    setPurpose(row.purpose || '');
    setFormError('');
    setModal({ mode: 'edit', row });
  };

  const grantAdvance = async (confirmMerge) => {
    await reimbursementApi.grantAdvance({
      employee_identifier: identifier.trim(),
      amount: Number(amount),
      purpose: purpose.trim() || null,
      confirm_merge: confirmMerge,
    });
    setModal(null);
    await Promise.all([load(), loadArchived()]);
  };

  const submit = async () => {
    if (!amount || Number(amount) <= 0) return;
    if (modal.mode === 'grant' && !identifier.trim()) return;
    setSaving(true);
    setFormError('');
    try {
      if (modal.mode === 'grant') {
        await grantAdvance(false);
      } else {
        await reimbursementApi.updateAdvance(modal.row.id, {
          amount: Number(amount),
          purpose: purpose.trim() || null,
        });
        setModal(null);
        // Editing a grant's amount down can be enough to zero out the employee's outstanding
        // balance too, so refresh both lists rather than just the active one.
        await Promise.all([load(), loadArchived()]);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (modal.mode === 'grant' && err?.response?.status === 409 && detail?.code === 'existing_active_advance') {
        setModal(null);
        setMergeConfirm({ message: detail.message });
      } else {
        setFormError((typeof detail === 'string' && detail) || 'Could not save this advance');
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmMergeGrant = async () => {
    setMergeConfirm(null);
    setSaving(true);
    setFormError('');
    try {
      await grantAdvance(true);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setFormError((typeof detail === 'string' && detail) || 'Could not save this advance');
      setModal({ mode: 'grant' });
    } finally {
      setSaving(false);
    }
  };

  const openSettleModal = (row) => {
    setSettleAmount(String(row.employee_outstanding_total));
    setSettleNote('');
    setSettleError('');
    setSettleModal({ row });
  };

  const submitSettle = async () => {
    const outstanding = Number(settleModal.row.employee_outstanding_total);
    if (!settleAmount || Number(settleAmount) <= 0 || Number(settleAmount) > outstanding) return;
    setSettling(true);
    setSettleError('');
    try {
      await reimbursementApi.settleAdvance(settleModal.row.employee_user_id, {
        amount: Number(settleAmount),
        note: settleNote.trim() || null,
      });
      setSettleModal(null);
      // A full settlement can move the employee straight to the archive — refresh both lists
      // so they don't seem to vanish from Active without reappearing anywhere.
      await Promise.all([load(), loadArchived()]);
    } catch (err) {
      setSettleError(err?.response?.data?.detail || 'Could not settle this advance');
    } finally {
      setSettling(false);
    }
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.employee_name, r.employee_id, r.department, r.purpose]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const filteredArchivedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archivedRows;
    return archivedRows.filter((r) =>
      [r.employee_name, r.employee_id, r.department].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [archivedRows, search]);

  const { page, setPage, totalPages, pageItems, startIndex, pageSize, total } = usePagination(filteredRows);
  const {
    page: archivedPage,
    setPage: setArchivedPage,
    totalPages: archivedTotalPages,
    pageItems: archivedPageItems,
    startIndex: archivedStartIndex,
    pageSize: archivedPageSize,
    total: archivedTotal,
  } = usePagination(filteredArchivedRows);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-ink">Advances</h2>
          <p className="mt-1 text-sm text-slate-600">
            Grant a cash advance to an employee. It&apos;s netted off automatically at claim-payment
            time until fully drawn down — nothing to track manually.
          </p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={openGrantModal}>
          <Plus size={16} />
          Grant advance
        </button>
      </div>

      <div className="inline-flex rounded-xl bg-slate-200/60 p-1 shadow-inner">
        <button
          type="button"
          className={`rounded-lg px-5 py-2 text-xs font-bold transition-all duration-200 ${
            tab === 'active' ? 'bg-white text-brand shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
          onClick={() => setTab('active')}
        >
          Active ({rows.length})
        </button>
        <button
          type="button"
          className={`rounded-lg px-5 py-2 text-xs font-bold transition-all duration-200 ${
            tab === 'archived' ? 'bg-white text-brand shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
          onClick={() => setTab('archived')}
        >
          Settled ({archivedRows.length})
        </button>
      </div>

      <div className="panel p-4">
        <label className="relative block max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="field !pl-9"
            placeholder="Search by employee, department, or purpose"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {tab === 'active' ? (
        <>
          {error ? (
            <div className="panel rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          ) : null}

          <div className="panel overflow-hidden rounded-2xl">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50/70 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5 whitespace-nowrap">S. No</th>
                    <th className="px-5 py-3.5">Employee</th>
                    <th className="px-5 py-3.5">Department</th>
                    <th className="px-5 py-3.5">Purpose</th>
                    <th className="px-5 py-3.5">Granted Amount</th>
                    <th className="px-5 py-3.5">Settled Amount</th>
                    <th className="px-5 py-3.5">Outstanding (Total)</th>
                    <th className="px-5 py-3.5">Granted By</th>
                    <th className="px-5 py-3.5">Date</th>
                    <th className="px-5 py-3.5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="px-5 py-6" colSpan={10}>
                        <Skeleton variant="table" rows={4} columns={10} />
                      </td>
                    </tr>
                  ) : filteredRows.length ? (
                    pageItems.map((row, index) => (
                      <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors duration-150">
                        <td className="px-5 py-4 text-center text-slate-500">{startIndex + index + 1}</td>
                        <td className="px-5 py-4 text-center font-semibold text-slate-900">
                          {row.employee_name || '—'}
                          <div className="text-xs font-normal text-slate-400">{row.employee_id}</div>
                        </td>
                        <td className="px-5 py-4 text-center text-slate-600">{row.department || '—'}</td>
                        <td className="px-5 py-4 text-center text-slate-600">{row.purpose || '—'}</td>
                        <td className="px-5 py-4 text-center font-mono text-slate-700">₹{money(row.granted_amount)}</td>
                        <td className="px-5 py-4 text-center font-mono text-slate-700">
                          {Number(row.settled_amount) > 0 ? `₹${money(row.settled_amount)}` : '—'}
                        </td>
                        <td className="px-5 py-4 text-center font-mono font-bold text-slate-900">
                          ₹{money(row.employee_outstanding_total)}
                        </td>
                        <td className="px-5 py-4 text-center text-slate-600">{row.created_by_name || '—'}</td>
                        <td className="px-5 py-4 text-center text-slate-600">{formatDate(row.created_at)}</td>
                        <td className="px-5 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
                              onClick={() => openEditModal(row)}
                            >
                              <Pencil size={13} />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              disabled={Number(row.employee_outstanding_total) <= 0}
                              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-all shadow-sm disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-50"
                              onClick={() => openSettleModal(row)}
                            >
                              <HandCoins size={13} />
                              <span>Settle Up</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-5 py-5" colSpan={10}>
                        <EmptyState
                          icon={IndianRupee}
                          title="No advances yet"
                          description="Advances granted to employees will appear here."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              total={total}
              pageSize={pageSize}
              startIndex={startIndex}
            />
          </div>
        </>
      ) : (
        <>
          {archivedError ? (
            <div className="panel rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {archivedError}
            </div>
          ) : null}

          <div className="panel overflow-hidden rounded-2xl">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50/70 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5 whitespace-nowrap">S. No</th>
                    <th className="px-5 py-3.5">Employee</th>
                    <th className="px-5 py-3.5">Department</th>
                    <th className="px-5 py-3.5">Total Granted</th>
                    <th className="px-5 py-3.5">Via Claims</th>
                    <th className="px-5 py-3.5">Via Settlement</th>
                    <th className="px-5 py-3.5">Settled On</th>
                    <th className="px-5 py-3.5">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedLoading ? (
                    <tr>
                      <td className="px-5 py-6" colSpan={8}>
                        <Skeleton variant="table" rows={4} columns={8} />
                      </td>
                    </tr>
                  ) : filteredArchivedRows.length ? (
                    archivedPageItems.map((row, index) => {
                      const isExpanded = expandedId === row.employee_user_id;
                      return (
                        <Fragment key={row.employee_user_id}>
                          <tr className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors duration-150">
                            <td className="px-5 py-4 text-center text-slate-500">{archivedStartIndex + index + 1}</td>
                            <td className="px-5 py-4 text-center font-semibold text-slate-900">
                              {row.employee_name || '—'}
                              <div className="text-xs font-normal text-slate-400">{row.employee_id}</div>
                            </td>
                            <td className="px-5 py-4 text-center text-slate-600">{row.department || '—'}</td>
                            <td className="px-5 py-4 text-center font-mono text-slate-700">₹{money(row.total_granted)}</td>
                            <td className="px-5 py-4 text-center font-mono text-slate-700">₹{money(row.consumed_via_claims)}</td>
                            <td className="px-5 py-4 text-center font-mono text-slate-700">
                              ₹{money(row.consumed_via_settlement)}
                            </td>
                            <td className="px-5 py-4 text-center text-slate-600">{formatDate(row.settled_at)}</td>
                            <td className="px-5 py-4 text-center">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors duration-150"
                                onClick={() => setExpandedId(isExpanded ? null : row.employee_user_id)}
                              >
                                <span>{isExpanded ? 'Hide' : 'Details'}</span>
                                <ChevronDown
                                  size={14}
                                  className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                />
                              </button>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="border-t border-slate-100 bg-slate-50/40">
                              <td colSpan={8} className="px-5 py-4">
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm">
                                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                      Grants
                                    </p>
                                    <div className="space-y-2">
                                      {row.grants.map((g) => (
                                        <div key={g.id} className="flex items-start justify-between gap-3 text-xs">
                                          <div>
                                            <div className="font-semibold text-slate-700">{g.purpose || 'No purpose given'}</div>
                                            <div className="text-slate-400">
                                              {formatDate(g.created_at)} · by {g.created_by_name || '—'}
                                            </div>
                                          </div>
                                          <span className="whitespace-nowrap font-mono font-bold text-slate-800">
                                            ₹{money(g.granted_amount)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm">
                                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                      How it was used
                                    </p>
                                    <div className="space-y-2">
                                      {row.claims_used.map((c) => (
                                        <div key={c.claim_reference} className="flex items-start justify-between gap-3 text-xs">
                                          <div>
                                            <div className="font-semibold text-slate-700">{c.claim_reference}</div>
                                            <div className="text-slate-400">Paid {formatDate(c.payment_recorded_at)}</div>
                                          </div>
                                          <span className="whitespace-nowrap font-mono font-bold text-slate-800">
                                            ₹{money(c.amount_deducted)}
                                          </span>
                                        </div>
                                      ))}
                                      {Number(row.consumed_via_settlement) > 0 ? (
                                        <div className="flex items-start justify-between gap-3 text-xs">
                                          <div className="font-semibold text-slate-700">Settled directly</div>
                                          <span className="whitespace-nowrap font-mono font-bold text-slate-800">
                                            ₹{money(row.consumed_via_settlement)}
                                          </span>
                                        </div>
                                      ) : null}
                                      {!row.claims_used.length && Number(row.consumed_via_settlement) <= 0 ? (
                                        <p className="text-xs text-slate-400">No usage recorded.</p>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="px-5 py-5" colSpan={8}>
                        <EmptyState
                          icon={IndianRupee}
                          title="No settled advances yet"
                          description="Advances move here once an employee's outstanding balance reaches zero."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={archivedPage}
              totalPages={archivedTotalPages}
              onPageChange={setArchivedPage}
              total={archivedTotal}
              pageSize={archivedPageSize}
              startIndex={archivedStartIndex}
            />
          </div>
        </>
      )}

      {modal
        ? createPortal(
            <div
              className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/55 p-4 backdrop-blur-[1px]"
              onClick={() => !saving && setModal(null)}
            >
              <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-line px-5 py-4">
                  <h3 className="text-sm font-bold text-ink">
                    {modal.mode === 'grant' ? 'Grant advance' : 'Edit advance'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    disabled={saving}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="space-y-3.5 p-5">
                  {modal.mode === 'grant' ? (
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-500">Employee ID or Email</label>
                      <input
                        className="field w-full"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="e.g. 003 or name@company.com"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-500">Employee</label>
                      <p className="text-sm font-semibold text-slate-800">
                        {modal.row.employee_name} <span className="font-normal text-slate-400">({modal.row.employee_id})</span>
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-500">
                      {modal.mode === 'grant' ? 'Amount' : 'Granted Amount'}
                    </label>
                    <input
                      className="field w-full"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    {modal.mode === 'edit' && Number(modal.row.settled_amount) > 0 ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        ₹{money(modal.row.settled_amount)} already settled off this grant will stay settled —
                        this only corrects the original figure.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-500">Purpose (optional)</label>
                    <input
                      className="field w-full"
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      placeholder="e.g. Delhi trip advance"
                    />
                  </div>
                  {formError ? (
                    <p className="flex items-center gap-1.5 text-xs text-red-700">
                      <AlertTriangle size={13} className="flex-none" /> {formError}
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2.5 pt-1">
                    <button className="btn-secondary" onClick={() => setModal(null)} disabled={saving}>
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      onClick={submit}
                      disabled={
                        saving ||
                        !amount ||
                        Number(amount) <= 0 ||
                        (modal.mode === 'grant' && !identifier.trim())
                      }
                    >
                      {saving ? 'Saving...' : modal.mode === 'grant' ? 'Grant advance' : 'Save changes'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {settleModal
        ? createPortal(
            <div
              className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/55 p-4 backdrop-blur-[1px]"
              onClick={() => !settling && setSettleModal(null)}
            >
              <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-line px-5 py-4">
                  <h3 className="text-sm font-bold text-ink">Settle up advance</h3>
                  <button
                    type="button"
                    onClick={() => setSettleModal(null)}
                    disabled={settling}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="space-y-3.5 p-5">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-500">Employee</label>
                    <p className="text-sm font-semibold text-slate-800">
                      {settleModal.row.employee_name}{' '}
                      <span className="font-normal text-slate-400">({settleModal.row.employee_id})</span>
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm">
                    <span className="font-semibold text-slate-600">Outstanding</span>
                    <span className="font-mono font-bold text-slate-900">
                      ₹{money(settleModal.row.employee_outstanding_total)}
                    </span>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-500">
                      Amount to settle (e.g. paid back in cash, or written off)
                    </label>
                    <input
                      className="field w-full"
                      type="number"
                      min="0"
                      step="0.01"
                      max={settleModal.row.employee_outstanding_total}
                      value={settleAmount}
                      onChange={(e) => setSettleAmount(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-500">Note (optional)</label>
                    <input
                      className="field w-full"
                      value={settleNote}
                      onChange={(e) => setSettleNote(e.target.value)}
                      placeholder="e.g. Repaid in cash on 30 Sep"
                    />
                  </div>
                  {settleError ? (
                    <p className="flex items-center gap-1.5 text-xs text-red-700">
                      <AlertTriangle size={13} className="flex-none" /> {settleError}
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2.5 pt-1">
                    <button className="btn-secondary" onClick={() => setSettleModal(null)} disabled={settling}>
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      onClick={submitSettle}
                      disabled={
                        settling ||
                        !settleAmount ||
                        Number(settleAmount) <= 0 ||
                        Number(settleAmount) > Number(settleModal.row.employee_outstanding_total)
                      }
                    >
                      {settling ? 'Settling...' : 'Settle up'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <ConfirmDialog
        open={Boolean(mergeConfirm)}
        title="Add to existing advance?"
        description={mergeConfirm?.message}
        confirmLabel="Add to advance"
        confirmVariant="primary"
        onConfirm={confirmMergeGrant}
        onCancel={() => setMergeConfirm(null)}
      />
    </div>
  );
}
