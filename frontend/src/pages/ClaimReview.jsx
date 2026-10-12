import { useNavigate, useParams } from 'react-router-dom';

import ClaimReviewModal from '../components/claims/ClaimReviewModal';
import { hasAnyPermission } from '../services/permissions';
import { useAuthStore } from '../store/authStore';

// Reached when a claim review link is opened directly (e.g. from a notification or a
// bookmarked/shared URL) rather than from within the Pending Approvals queue, where it
// instead opens as a modal in place — see ClaimReviewModal.
export default function ClaimReview() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.profile?.permissions);
  const approverPerms = ['approve_claims', 'process_payments'];
  const isApprover = hasAnyPermission(permissions, approverPerms);
  const backTo = isApprover ? '/claims/pending' : '/claims/my';

  return <ClaimReviewModal claimId={claimId} onClose={() => navigate(backTo)} />;
}
