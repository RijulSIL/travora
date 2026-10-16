import { AlertTriangle, ChevronDown, Plus, Search } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { BTN_OK, BTN_PLAIN, Pill, Tabs } from '../../components/approvals/ApprovalQueueParts';
import { DetailBox, Empty, Figure, Modal, day, errorText, money } from '../../components/finance/FinanceParts';
import { BTN_GHOST, BTN_MAIN, CARD, FIELD, LABEL } from '../../components/policy/PolicyAdminParts';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Pagination from '../../components/ui/Pagination';
import Skeleton from '../../components/ui/Skeleton';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { usePagination } from '../../hooks/usePagination';
import { reimbursementApi } from '../../services/reimbursementApi';

const INPUT = 'h-8 rounded-[10px] border border-slate-200 bg-white px-2.5 text-[12.5px] text-ink outline-none focus:border-brand';
const ACTIVE_COLS = 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_150px_auto]';
const SETTLED_COLS = 'lg:grid-cols-[minmax(0,1.2fr)_140px_140px_140px_110px_16px]';

function Problem({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-700">
      <AlertTriangle size={13} className="shrink-0" /> {children}
    </p>
  );
}

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
  // Set when granting hits a 409 because the employee already has an active advance; the grant
  // form's values stay as they are, so confirming just resubmits with confirm_merge.
  const [mergeConfirm, setMergeConfirm] = useState(null);
  // Settling works on the employee's pooled outstanding balance, not one grant.
  const [settleModal, setSettleModal] = useState(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setRows((await reimbursementApi.listAdvances()).data || []);
    } catch (err) {
      setError(errorText(err, 'Failed to load advances'));
    } finally {
      setLoading(false);
    }
  };
  const loadArchived = async () => {
    setArchivedLoading(true);
    setArchivedError('');
    try {
      setArchivedRows((await reimbursementApi.listArchivedAdvances()).data || []);
    } catch (err) {
      setArchivedError(errorText(err, 'Failed to load settled advances'));
    } finally {
      setArchivedLoading(false);
    }
  };
  useEffect(() => {
    // Both load on open so the Settled tab's count is right before it's ever opened.
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
    // Editing corrects the originally granted figure; the backend shifts the remaining balance by
    // the same difference, so anything already settled off this grant stays settled.
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
        await reimbursementApi.updateAdvance(modal.row.id, { amount: Number(amount), purpose: purpose.trim() || null });
        setModal(null);
        // Lowering a grant can clear the employee's balance, which moves them to Settled.
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
      setFormError(errorText(err, 'Could not save this advance'));
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
      await reimbursementApi.settleAdvance(settleModal.row.employee_user_id, { amount: Number(settleAmount), note: settleNote.trim() || null });
      setSettleModal(null);
      // A full settlement moves the employee to Settled; refresh both lists.
      await Promise.all([load(), loadArchived()]);
    } catch (err) {
      setSettleError(errorText(err, 'Could not settle this advance'));
    } finally {
      setSettling(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filteredRows = useMemo(() => (q ? rows.filter((r) => [r.employee_name, r.employee_id, r.department, r.purpose].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))) : rows), [rows, q]);
  const filteredArchived = useMemo(() => (q ? archivedRows.filter((r) => [r.employee_name, r.employee_id, r.department].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))) : archivedRows), [archivedRows, q]);
  const activePage = usePagination(filteredRows);
  const settledPage = usePagination(filteredArchived);
  const settleOver = settleModal && Number(settleAmount) > Number(settleModal.row.employee_outstanding_total);

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Advances</h1>
          <p className="mt-0.5 max-w-[72ch] text-[13px] text-slate-500">Cash given to employees before they spend it. When their claims are paid, the advance is used first, until none is left.</p>
        </div>
        <button type="button" className={BTN_MAIN} onClick={openGrantModal}>
          <Plus size={15} />
          Grant advance
        </button>
      </div>

      <Tabs
        label="Advances"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'active', label: 'Active', count: rows.length },
          { key: 'archived', label: 'Settled', count: archivedRows.length },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5">
        <label className="relative w-full max-w-[320px]">
          <span className="sr-only">Search</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${INPUT} w-full pl-8`} placeholder={tab === 'active' ? 'Search by employee, department or purpose' : 'Search by employee or department'} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {tab === 'active' ? (
        <>
          {error ? (
            <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
              {error}
            </div>
          ) : null}
          <section aria-label="Active advances" className={CARD}>
            <div className={`hidden gap-3.5 bg-slate-50 px-4 py-[9px] text-[11px] font-bold text-slate-500 lg:grid ${ACTIVE_COLS}`}>
              <span>Employee</span>
              <span>Purpose</span>
              <span className="text-right">Left to use</span>
              <span />
            </div>
            {loading ? (
              <div className="p-4">
                <Skeleton variant="table" rows={4} columns={4} />
              </div>
            ) : filteredRows.length ? (
              activePage.pageItems.map((row) => (
                <div key={row.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 border-t border-slate-100 px-4 py-3 first:border-t-0 ${ACTIVE_COLS}`}>
                  <div className="min-w-0">
                    <b className="block truncate text-[13.5px] text-ink">{row.employee_name || '—'}</b>
                    <span className="text-xs text-slate-500">
                      {row.employee_id}
                      {row.department ? ` · ${row.department}` : ''}
                    </span>
                  </div>
                  <div className="col-span-2 min-w-0 lg:col-span-1">
                    <b className="block truncate text-[13px] text-ink">{row.purpose || 'No purpose given'}</b>
                    <span className="text-xs text-slate-500">
                      Granted {money(row.granted_amount)} on {day(row.created_at)}
                      {row.created_by_name ? ` by ${row.created_by_name}` : ''}
                      {Number(row.settled_amount) > 0 ? ` · ${money(row.settled_amount)} settled` : ''}
                    </span>
                  </div>
                  <div className="row-start-1 text-right lg:row-start-auto">
                    <b className="block font-mono text-[13.5px] font-semibold tabular-nums text-ink">{money(row.employee_outstanding_total)}</b>
                    <span className="text-xs text-slate-500">left in total</span>
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-1.5 lg:col-span-1 lg:justify-end">
                    <button type="button" className={BTN_PLAIN} onClick={() => openEditModal(row)}>
                      Edit
                    </button>
                    <button type="button" className={BTN_OK} disabled={Number(row.employee_outstanding_total) <= 0} onClick={() => openSettleModal(row)}>
                      Settle up
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <Empty title={rows.length ? 'Nothing matches that search' : 'No active advances'}>{rows.length ? 'Try a different name or purpose.' : 'Advances you grant show here, with what’s left to use, until it’s all used or settled.'}</Empty>
            )}
            <Pagination {...activePage} onPageChange={activePage.setPage} />
          </section>
        </>
      ) : (
        <>
          {archivedError ? (
            <div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
              {archivedError}
            </div>
          ) : null}
          <section aria-label="Settled advances" className={CARD}>
            <div className={`hidden gap-3.5 bg-slate-50 px-4 py-[9px] text-[11px] font-bold text-slate-500 lg:grid ${SETTLED_COLS}`}>
              <span>Employee</span>
              <span className="text-right">Granted</span>
              <span className="text-right">Used on claims</span>
              <span className="text-right">Settled directly</span>
              <span>Settled on</span>
              <span />
            </div>
            {archivedLoading ? (
              <div className="p-4">
                <Skeleton variant="table" rows={4} columns={5} />
              </div>
            ) : filteredArchived.length ? (
              settledPage.pageItems.map((row) => {
                const open = expandedId === row.employee_user_id;
                return (
                  <Fragment key={row.employee_user_id}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpandedId(open ? null : row.employee_user_id)}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-t border-slate-100 px-4 py-3 text-left first:border-t-0 hover:bg-[#fbfdfc] ${SETTLED_COLS} ${open ? 'bg-[#f4faf7]' : ''}`}
                    >
                      <span className="min-w-0">
                        <b className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-ink">
                          {row.employee_name || '—'} <Pill tone="ok">Settled</Pill>
                        </b>
                        <span className="text-xs text-slate-500">
                          {row.employee_id}
                          {row.department ? ` · ${row.department}` : ''}
                          <span className="lg:hidden"> · settled {day(row.settled_at)}</span>
                        </span>
                      </span>
                      <span className="text-right font-mono text-[13px] font-semibold tabular-nums text-ink">{money(row.total_granted)}</span>
                      <span className="hidden text-right font-mono text-[13px] tabular-nums text-ink lg:block">{money(row.consumed_via_claims)}</span>
                      <span className="hidden text-right font-mono text-[13px] tabular-nums text-ink lg:block">{money(row.consumed_via_settlement)}</span>
                      <span className="hidden text-xs text-slate-500 lg:block">{day(row.settled_at)}</span>
                      <ChevronDown size={14} className={`hidden text-slate-400 transition-transform lg:block ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open ? (
                      <div className="grid gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3.5 lg:grid-cols-2">
                        <DetailBox title="Grants">
                          {row.grants.map((g) => (
                            <Figure
                              key={g.id}
                              label={
                                <>
                                  <b className="block font-semibold text-ink">{g.purpose || 'No purpose given'}</b>
                                  {day(g.created_at)} · by {g.created_by_name || '—'}
                                </>
                              }
                            >
                              {money(g.granted_amount)}
                            </Figure>
                          ))}
                        </DetailBox>
                        <DetailBox title="How it was used">
                          {row.claims_used.map((c) => (
                            <Figure
                              key={c.claim_reference}
                              label={
                                <>
                                  <b className="block font-semibold text-ink">{c.claim_reference}</b>
                                  paid {day(c.payment_recorded_at)}
                                </>
                              }
                            >
                              {money(c.amount_deducted)}
                            </Figure>
                          ))}
                          {Number(row.consumed_via_settlement) > 0 ? <Figure label="Settled directly">{money(row.consumed_via_settlement)}</Figure> : null}
                          {!row.claims_used.length && Number(row.consumed_via_settlement) <= 0 ? <span className="text-xs text-slate-400">No usage recorded.</span> : null}
                        </DetailBox>
                      </div>
                    ) : null}
                  </Fragment>
                );
              })
            ) : (
              <Empty title={archivedRows.length ? 'Nothing matches that search' : 'No settled advances yet'}>{archivedRows.length ? 'Try a different name.' : 'Advances move here once an employee has none left to use.'}</Empty>
            )}
            <Pagination {...settledPage} onPageChange={settledPage.setPage} />
          </section>
        </>
      )}

      {modal ? (
        <Modal
          title={modal.mode === 'grant' ? 'Grant advance' : 'Edit advance'}
          sub={modal.mode === 'grant' ? 'Used first when their claims are paid' : `${modal.row.employee_name} (${modal.row.employee_id})`}
          busy={saving}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className={BTN_GHOST} onClick={() => setModal(null)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className={BTN_MAIN} onClick={submit} disabled={saving || !amount || Number(amount) <= 0 || (modal.mode === 'grant' && !identifier.trim())}>
                {saving ? 'Saving…' : modal.mode === 'grant' ? 'Grant advance' : 'Save changes'}
              </button>
            </>
          }
        >
          {modal.mode === 'grant' ? (
            <div>
              <label className={LABEL} htmlFor="adv-who">
                Employee ID or email
              </label>
              <input id="adv-who" className={FIELD} value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. 003 or name@company.com" />
            </div>
          ) : null}
          <div>
            <label className={LABEL} htmlFor="adv-amount">
              {modal.mode === 'grant' ? 'Amount' : 'Amount granted'}
            </label>
            <input id="adv-amount" className={`${FIELD} font-mono`} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {modal.mode === 'edit' && Number(modal.row.settled_amount) > 0 ? (
              <p className="mt-1 text-xs text-slate-500">{money(modal.row.settled_amount)} already settled off this grant stays settled; this only corrects the original figure.</p>
            ) : null}
          </div>
          <div>
            <label className={LABEL} htmlFor="adv-purpose">
              Purpose <small className="font-medium text-slate-400">(optional)</small>
            </label>
            <input id="adv-purpose" className={FIELD} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Delhi trip advance" />
          </div>
          {modal.mode === 'grant' ? <p className="text-xs text-slate-500">If they already have an advance left, you&apos;ll be asked whether to add this to it.</p> : null}
          <Problem>{formError}</Problem>
        </Modal>
      ) : null}

      {settleModal ? (
        <Modal
          title="Settle up"
          sub={`${settleModal.row.employee_name} (${settleModal.row.employee_id})`}
          busy={settling}
          onClose={() => setSettleModal(null)}
          footer={
            <>
              <button type="button" className={BTN_GHOST} onClick={() => setSettleModal(null)} disabled={settling}>
                Cancel
              </button>
              <button type="button" className={BTN_MAIN} onClick={submitSettle} disabled={settling || !settleAmount || Number(settleAmount) <= 0 || settleOver}>
                {settling ? 'Settling…' : 'Settle up'}
              </button>
            </>
          }
        >
          <Figure label="Left to use" strong>
            {money(settleModal.row.employee_outstanding_total)}
          </Figure>
          <div>
            <label className={LABEL} htmlFor="settle-amount">
              Amount to settle <small className="font-medium text-slate-400">paid back in cash, or written off</small>
            </label>
            <input id="settle-amount" className={`${FIELD} font-mono ${settleOver ? 'border-rose-400' : ''}`} type="number" min="0" step="0.01" max={settleModal.row.employee_outstanding_total} value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} />
            {settleOver ? <p className="mt-1 text-xs text-rose-700">That&apos;s more than they have left ({money(settleModal.row.employee_outstanding_total)}).</p> : null}
          </div>
          <div>
            <label className={LABEL} htmlFor="settle-note">
              Note <small className="font-medium text-slate-400">(optional)</small>
            </label>
            <input id="settle-note" className={FIELD} value={settleNote} onChange={(e) => setSettleNote(e.target.value)} placeholder="e.g. Repaid in cash on 30 Sep" />
          </div>
          <Problem>{settleError}</Problem>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={Boolean(mergeConfirm)}
        title="Add to existing advance?"
        description={mergeConfirm?.message}
        confirmLabel="Add to advance"
        confirmVariant="primary"
        onConfirm={confirmMergeGrant}
        onCancel={() => setMergeConfirm(null)}
      />
    </section>
  );
}
