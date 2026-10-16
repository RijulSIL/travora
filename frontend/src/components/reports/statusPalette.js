/*
 * Labels and colours for the status charts on Home and the Reports page, so a stage looks the
 * same everywhere and no two stages in one chart share a colour. [label, colour] by status.
 */

export const CLAIM_STAGE = {
  SUBMITTED: ['Submitted', '#3b82f6'],
  IN_APPROVAL: ['In approval', '#8b5cf6'],
  PENDING_EXCEPTION: ['Exception review', '#f59e0b'],
  ON_HOLD: ['On hold', '#64748b'],
  SENT_BACK: ['Sent back', '#ec4899'],
  READY_FOR_PAYMENT: ['Ready to pay', '#0ea5e9'],
  PAID: ['Paid', '#10b981'],
  REJECTED: ['Rejected', '#dc2626'],
  DRAFT: ['Draft', '#94a3b8'],
};

export const TRAVEL_STATUS = {
  PENDING: ['Awaiting approval', '#f59e0b'],
  PENDING_EXCEPTION: ['Exception review', '#a855f7'],
  APPROVED: ['Approved', '#0F6B52'],
  PARTIALLY_BOOKED: ['Partly booked', '#0ea5e9'],
  BOOKED: ['Booked', '#10b981'],
  REJECTED: ['Rejected', '#dc2626'],
  CANCELLED: ['Cancelled', '#94a3b8'],
};

export const TRAVEL_MODES = {
  FLIGHT: ['Flight', '#0F6B52'],
  TRAIN: ['Train', '#2563eb'],
  BUS: ['Bus', '#f59e0b'],
};

const titleCase = (value) =>
  String(value || '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');

/**
 * Rows for every key in `known` (0 when the data has none) plus any key the data has that isn't
 * known yet, biggest first. Keys in `onlyIfAny` show only when they have something.
 * → [{ key, label, value, color }]
 */
export function allRows(data, keyField, valueField, known, onlyIfAny = []) {
  const totals = {};
  (data || []).forEach((r) => {
    totals[r[keyField]] = (totals[r[keyField]] || 0) + Number(r[valueField] || 0);
  });
  return [...new Set([...Object.keys(known), ...Object.keys(totals)])]
    .filter((k) => !onlyIfAny.includes(k) || totals[k])
    .map((k) => ({ key: k, label: known[k]?.[0] || titleCase(k), value: totals[k] || 0, color: known[k]?.[1] || '#64748b' }))
    .sort((a, b) => b.value - a.value);
}
