import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import TicketPreviewDrawer from '../components/ui/TicketPreviewDrawer';
import { useSetPageTitle } from '../context/PageTitleContext';
import { useAsyncAction } from '../hooks/useAsyncAction';
import useToast from '../hooks/useToast';
import { reimbursementApi } from '../services/reimbursementApi';

function money(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export default function ReimbursementDraft() {
  useSetPageTitle('Reimbursement Form');
  const [searchParams] = useSearchParams();
  const invoiceIds = useMemo(
    () =>
      (searchParams.get('invoiceIds') || '')
        .split(',')
        .map((value) => Number(value))
        .filter(Boolean),
    [searchParams],
  );

  const tripIdsFromUrl = useMemo(() => searchParams.get('tripIds') || '', [searchParams]);

  const { showToast } = useToast();
  const [claim, setClaim] = useState(null);
  const [form, setForm] = useState({
    trip_purpose: '',
    departure_date: '',
    return_date: '',
    office_location: '',
    destination_city: '',
  });

  const [availableTrips, setAvailableTrips] = useState([]);
  const [selectedTripIds, setSelectedTripIds] = useState([]);
  const [preview, setPreview] = useState({ open: false, blob: null, name: '', type: '', title: '' });

  useEffect(() => {
    const parsed = tripIdsFromUrl
      .split(',')
      .map((value) => Number(value))
      .filter(Boolean);
    setSelectedTripIds(parsed);
  }, [tripIdsFromUrl]);

  useEffect(() => {
    let cancelled = false;
    reimbursementApi
      .bookingTripsMy()
      .then((r) => {
        if (!cancelled) setAvailableTrips(r.data || []);
      })
      .catch(() => {
        /* optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleTrip = (tripId, checked) => {
    setSelectedTripIds((prev) =>
      checked ? [...new Set([...prev, tripId])].sort((a, b) => a - b) : prev.filter((x) => x !== tripId),
    );
  };

  const { run: saveDraft, loading, error } = useAsyncAction(async () => {
    const response = await reimbursementApi.saveClaimDraft({
      claim_id: claim?.id,
      invoice_ids: invoiceIds,
      trip_ids: selectedTripIds,
      trip_purpose: form.trip_purpose || null,
      departure_date: form.departure_date || null,
      return_date: form.return_date || null,
      office_location: form.office_location || null,
      destination_city: form.destination_city || null,
      advance_received: '0',
    });
    setClaim(response.data);
  });

  const { run: submitClaim, loading: submitting } = useAsyncAction(async () => {
    if (!claim) return;
    const response = await reimbursementApi.submitClaim(claim.id);
    setClaim(response.data);
  });

  const report = claim?.compliance_report || {};
  const gst = report.gst_summary || {};
  const totalClaimed = report.total_claimed || 0;
  const netPayable = report.net_payable || 0;

  return (
      <section className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-600">
              Confirm trip details and generate the expense summary from reviewed invoices. Link merged travel bookings
              (including desk-assisted trips) below when applicable.
            </p>
          </div>
          <Link className="btn-secondary" to="/invoices">
            Upload more invoices
          </Link>
        </div>

        {!invoiceIds.length && !selectedTripIds.length ? (
          <div className="panel rounded-lg p-5 text-sm text-amber-700">
            No invoices are linked yet and no merged trips selected. Upload invoices via the intake flow or select trips
            from the table below.
          </div>
        ) : null}

        <div className="panel mb-5 rounded-lg p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">Merged travel trips</h2>
            <Link className="text-xs text-brand underline" to="/travel-requests">
              Manage in Travel Requests
            </Link>
          </div>
          {availableTrips.length === 0 ? (
            <p className="text-sm text-slate-500">No trips available yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-slate-500">
                    <th className="py-2 pr-3">Link</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Route</th>
                    <th className="py-2 pr-3">Ref</th>
                    <th className="py-2 pr-3">Tag</th>
                    <th className="py-2">Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {availableTrips.map((t) => (
                    <tr key={t.id} className="border-b border-line/70">
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          checked={selectedTripIds.includes(t.id)}
                          onChange={(e) => toggleTrip(t.id, e.target.checked)}
                        />
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">{t.travel_date}</td>
                      <td className="py-2 pr-3">
                        {t.from_city} → {t.to_city}
                      </td>
                      <td className="py-2 pr-3">
                        {t.provider} · {t.reference_id}
                      </td>
                      <td className="py-2 pr-3">
                        {t.booked_by_travel_desk ? <span className="badge badge-submitted text-[10px]">Desk booked</span> : null}
                      </td>
                      <td className="py-2">
                        {t.desk_ticket_id ? (
                          <button
                            type="button"
                            className="text-xs text-brand underline"
                            onClick={async () => {
                              try {
                                const resp = await reimbursementApi.travelTicketFileBlob(t.desk_ticket_id);
                                const name = `${t.reference_id}-ticket.bin`;
                                setPreview({
                                  open: true,
                                  blob: resp.data,
                                  name,
                                  type: resp.headers['content-type'] || '',
                                  title: `Trip ${t.reference_id}`,
                                });
                              } catch {
                                showToast('Could not preview ticket', 'error');
                              }
                            }}
                          >
                            View ticket
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
          <div>
            <div className="panel rounded-lg p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">Trip Details</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Trip Purpose</span>
                  <input
                    className="field"
                    value={form.trip_purpose}
                    onChange={(event) => setForm({ ...form, trip_purpose: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Office Location</span>
                  <input
                    className="field"
                    value={form.office_location}
                    onChange={(event) => setForm({ ...form, office_location: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Departure Date</span>
                  <input
                    className="field"
                    type="date"
                    value={form.departure_date}
                    onChange={(event) => setForm({ ...form, departure_date: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Return Date</span>
                  <input
                    className="field"
                    type="date"
                    value={form.return_date}
                    onChange={(event) => setForm({ ...form, return_date: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Destination City</span>
                  <input
                    className="field"
                    value={form.destination_city}
                    onChange={(event) => setForm({ ...form, destination_city: event.target.value })}
                  />
                </label>
              </div>
              <div className="mt-5 flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  {invoiceIds.length} invoice{invoiceIds.length > 1 ? 's' : ''} linked
                  {selectedTripIds.length ? ` · ${selectedTripIds.length} trip(s) linked` : ''}
                  {claim?.destination_city_group ? ` · City Group ${claim.destination_city_group}` : ''}
                </span>
                <button
                  className="btn-primary"
                  disabled={loading || (!invoiceIds.length && !selectedTripIds.length)}
                  onClick={saveDraft}
                >
                  Generate Summary
                </button>
              </div>
              {error ? <div className="mt-3 text-sm text-red-600">{error.message}</div> : null}
            </div>

            <div className="panel mt-5 rounded-lg p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Expense Summary</h2>
              {claim?.expenses?.length ? (
                <div className="divide-y divide-line">
                  {claim.expenses.map((expense) => (
                    <div key={expense.id} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <div className="font-medium text-ink">{expense.category_name}</div>
                        <div className="text-xs text-slate-500">
                          {expense.cap_amount ? `Cap: ₹${money(expense.cap_amount)}` : 'No cap configured'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">₹{money(expense.amount)}</div>
                        <div
                          className={
                            expense.policy_status === 'OK'
                              ? 'text-xs text-emerald-600'
                              : 'text-xs text-red-600'
                          }
                        >
                          {expense.policy_status === 'OK' ? 'Within policy' : expense.policy_status}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between pt-4 text-sm font-semibold">
                    <span>Total Claimed</span>
                    <span>₹{money(totalClaimed)}</span>
                  </div>
                  {Number(claim?.advance_received) > 0 ? (
                    <div className="mt-2 flex justify-between text-sm text-slate-500">
                      <span>Less: Advance Received</span>
                      <span>- ₹{money(claim.advance_received)}</span>
                    </div>
                  ) : null}
                  <div className="mt-3 flex justify-between text-base font-bold text-ink">
                    <span>Net Payable</span>
                    <span>₹{money(netPayable)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500">Generate the summary to auto-populate expenses.</div>
              )}
            </div>
          </div>

          <aside className="space-y-5">
            <div className="panel rounded-lg p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">GST Summary</h2>
              {[
                ['Total Taxable Value', gst.total_taxable_value],
                ['CGST', gst.cgst],
                ['SGST', gst.sgst],
                ['IGST', gst.igst],
                ['Grand Total', gst.grand_total],
                ['ITC Eligible', gst.itc_eligible_amount],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-1 text-sm">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-medium">₹{money(value)}</span>
                </div>
              ))}
            </div>

            <div className="panel rounded-lg p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Policy Compliance</h2>
              {report.exceptions?.length ? (
                <div className="space-y-2">
                  {report.exceptions.map((exception) => (
                    <div key={exception.category_name} className="rounded bg-red-50 p-3 text-sm text-red-700">
                      {exception.category_name} is {exception.policy_status}.
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-emerald-700">No policy exceptions detected.</div>
              )}
            </div>

            <button className="btn-primary w-full" disabled={!claim || submitting} onClick={submitClaim}>
              {claim?.status === 'SUBMITTED' ? 'Submitted' : 'Submit Claim'}
            </button>
          </aside>
        </div>

        <TicketPreviewDrawer
          open={preview.open}
          onClose={() => setPreview((p) => ({ ...p, open: false }))}
          blob={preview.blob}
          contentType={preview.type}
          filename={preview.name}
          title={preview.title}
        />
      </section>
  );
}
