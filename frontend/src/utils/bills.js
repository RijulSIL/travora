import { formatDate } from './formatters';

/*
 * Naming a bill in a list by what it is ("Marina Bay Hotel · 07/11/2026") rather than its file
 * name, which is often meaningless ("DEMO-INV-1028 (1) (1).pdf"). vendor_name and invoice_date
 * come from what was read off the bill (the invoices API sends them with each bill).
 */

/** The bill's vendor when one was read, else its file name. */
export const billName = (invoice) => invoice?.vendor_name || invoice?.original_filename || 'Bill';

/** The invoice date as DD/MM/YYYY, or ''. */
export const billDate = (invoice) => formatDate(invoice?.invoice_date);

/** Whether a bill matches a search: vendor, file name, invoice date or amount ("4480", "4,480"). */
export function billMatches(invoice, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const amount = invoice?.total_amount != null && invoice.total_amount !== '' ? Number(invoice.total_amount) : null;
  const text = [
    invoice?.vendor_name,
    invoice?.original_filename,
    billDate(invoice),
    amount != null && Number.isFinite(amount) ? `${amount} ${amount.toFixed(2)} ${amount.toLocaleString('en-IN')}` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const asNumber = q.replace(/[₹,\s]/g, '');
  return text.includes(q) || (asNumber !== '' && /^[\d.]+$/.test(asNumber) && text.includes(asNumber));
}
