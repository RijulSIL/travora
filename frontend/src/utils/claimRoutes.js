// Travel Claim and General Reimbursement are separate wizard pages/routes (see
// TravelClaimWizard.jsx / GeneralReimbursementWizard.jsx) — these helpers pick the right
// one from a claim's own reimbursement_category so callers don't duplicate the branch.
// Relocation claims are raised from the Travel Claim wizard with trip purpose "Relocation"
// (see ClaimRelocationSteps.jsx), so they share its route.
export function claimCategorySegment(category) {
  return category === 'TRAVEL' || category === 'RELOCATION' ? 'travel' : 'general';
}

export function claimEditPath(claim) {
  return `/claims/${claimCategorySegment(claim?.reimbursement_category)}/${claim.id}/edit`;
}

/** New-claim path for a category, with optional query params (e.g. { invoiceIds: '1,2' }). */
export function claimNewPath(category, params = {}) {
  const query = new URLSearchParams(category === 'RELOCATION' ? { purpose: 'Relocation', ...params } : params);
  const search = query.toString();
  return `/claims/${claimCategorySegment(category)}/new${search ? `?${search}` : ''}`;
}
