// Travel Claim and General Reimbursement are separate wizard pages/routes (see
// TravelClaimWizard.jsx / GeneralReimbursementWizard.jsx) — these helpers pick the right
// one from a claim's own reimbursement_category so callers don't duplicate the branch.
// Reallocation isn't a trip either, so it shares the General wizard/route rather than
// getting a third entry point — see GeneralReimbursementWizard.jsx's visibleInvoices filter.
export function claimCategorySegment(category) {
  return category === 'TRAVEL' ? 'travel' : 'general';
}

export function claimEditPath(claim) {
  return `/claims/${claimCategorySegment(claim?.reimbursement_category)}/${claim.id}/edit`;
}

export function claimNewPath(category) {
  return `/claims/${claimCategorySegment(category)}/new`;
}
