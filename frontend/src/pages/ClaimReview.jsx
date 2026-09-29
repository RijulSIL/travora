import { useNavigate, useParams } from 'react-router-dom';

import ClaimReviewModal from '../components/claims/ClaimReviewModal';
import { hasAnyPermission } from '../services/permissions';
import { selectResolvedRole, useAuthStore } from '../store/authStore';

// Reached when a claim review link is opened directly (e.g. from a notification or a
// bookmarked/shared URL) rather than from within the Pending Approvals queue, where it
// instead opens as a modal in place — see ClaimReviewModal.
export default function ClaimReview() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const role = useAuthStore(selectResolvedRole);
  const delegatedRoles = useAuthStore((s) => s.profile?.delegated_roles);
  const approverPerms = ['approve_stage_1', 'approve_stage_2', 'approve_stage_3', 'process_payments'];
  const isApprover = hasAnyPermission(role, approverPerms, delegatedRoles);
  const backTo = isApprover ? '/claims/pending' : '/claims/my';

  return <ClaimReviewModal claimId={claimId} onClose={() => navigate(backTo)} />;
}
