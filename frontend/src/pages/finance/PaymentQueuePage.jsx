import { useEffect, useMemo, useState } from 'react';

import { useSetPageTitle } from '../../context/PageTitleContext';
import { reimbursementApi } from '../../services/reimbursementApi';

const money = (v) =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaymentQueuePage() {
  useSetPageTitle('Payment Queue');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  const [utr, setUtr] = useState('');
  const [amountToPay, setAmountToPay] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reimbursementApi.pendingApprovals();
      const list = (res.data || []).filter((item) => item.sla_bucket != null);
      setRows(list);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to load payment queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openModal = (row) => {
    setActive(row);
    setUtr('');
    setAmountToPay(String(Number(row.net_payable || 0).toFixed(2)));
  };

  const approvedAmount = useMemo(() => Number(active?.net_payable || 0), [active]);
  const changedAmount = Number(amountToPay || 0) !== approvedAmount;

  const submitPayment = async () => {
    if (!active) return;
    setSaving(true);
    setError('');
    try {
      await reimbursementApi.recordClaimPayment(active.claim_id, {
        utr_reference: utr,
        amount: Number(amountToPay),
      });
      await reimbursementApi.erpPost({ claim_id: active.claim_id });
      setActive(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Payment failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-ink">Finance payment queue</h2>
        <p className="text-sm text-slate-600">All claims currently READY_FOR_PAYMENT.</p>
      </div>
      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Claim Ref</th>
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">Dept</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Net Payable</th>
              <th className="px-3 py-2 text-left">Submitted</th>
              <th className="px-3 py-2 text-left">SLA</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={8}>
                  Loading queue...
                </td>
              </tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr key={row.claim_id} className="border-t border-line">
                  <td className="px-3 py-2">{row.claim_reference}</td>
                  <td className="px-3 py-2">{row.employee_name || row.employee_label}</td>
                  <td className="px-3 py-2">{row.department || '—'}</td>
                  <td className="px-3 py-2 text-right">₹{money(row.amount)}</td>
                  <td className="px-3 py-2 text-right font-semibold">₹{money(row.net_payable)}</td>
                  <td className="px-3 py-2">{row.submitted_at ? new Date(row.submitted_at).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2">{row.sla_remaining_label}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="btn-primary text-xs" onClick={() => openModal(row)}>
                      Process Payment
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={8}>
                  No claims in payment queue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {active ? (
        <div className="rounded-lg border border-line bg-white p-4">
          <div className="text-sm font-semibold">
            Claim: {active.claim_reference} &nbsp; Employee: {active.employee_name || active.employee_label}
          </div>
          <div className="my-3 h-px bg-line" />
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Total Claimed:</span>
              <span>₹{money(active.amount)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>Approved Amount:</span>
              <span>₹{money(active.net_payable)}</span>
            </div>
          </div>
          <div className="my-3 h-px bg-line" />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              UTR Reference
              <input className="mt-1 w-full rounded border border-line px-3 py-2" value={utr} onChange={(e) => setUtr(e.target.value)} />
            </label>
            <label className="text-sm">
              Amount to Pay
              <input
                className="mt-1 w-full rounded border border-line px-3 py-2"
                value={amountToPay}
                onChange={(e) => setAmountToPay(e.target.value)}
              />
            </label>
          </div>
          {changedAmount ? (
            <p className="mt-2 text-xs text-amber-700">Amount differs from approved amount and may be rejected by API validation.</p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary text-sm" onClick={() => setActive(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn-primary text-sm" onClick={submitPayment} disabled={saving || !utr.trim()}>
              {saving ? 'Processing...' : 'Record Payment & Post to ERP'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
