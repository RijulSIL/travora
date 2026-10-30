// Travel Claim, General Reimbursement and Relocation Claim are separate wizard routes (relocation
// shares TravelClaimWizard.jsx in its `relocation` mode, see ClaimRelocationSteps.jsx) — these
// helpers pick the right one from a claim's own reimbursement_category so callers don't
// duplicate the branch.
export function claimCategorySegment(category) {
  if (category === 'RELOCATION') return 'relocation';
  return category === 'TRAVEL' ? 'travel' : 'general';
}

export function claimEditPath(claim) {
  return `/claims/${claimCategorySegment(claim?.reimbursement_category)}/${claim.id}/edit`;
}

/** New-claim path for a category, with optional query params (e.g. { invoiceIds: '1,2' }). */
export function claimNewPath(category, params = {}) {
  const search = new URLSearchParams(params).toString();
  return `/claims/${claimCategorySegment(category)}/new${search ? `?${search}` : ''}`;
}
