import { BarChart3, Users } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import AppLayout from './components/layout/AppLayout';
import ApprovalScopeGuard from './components/ApprovalScopeGuard';
import ProtectedRoute from './components/ProtectedRoute';
import RoleGuard from './components/RoleGuard';
import PageLoader from './components/ui/PageLoader';
import ToastContainer from './components/ui/Toast';
import ParticleBackground from './components/ui/ParticleBackground';
import PublicIndex from './pages/PublicIndex';
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage'));
const AgentBookingPage = lazy(() => import('./pages/public/AgentBookingPage'));
const AccessDenied = lazy(() => import('./pages/AccessDenied'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ClaimReview = lazy(() => import('./pages/ClaimReview'));
const ComingSoon = lazy(() => import('./pages/ComingSoon'));
const Home = lazy(() => import('./pages/Home'));
const FinanceGstPage = lazy(() => import('./pages/finance/FinanceGstPage'));
const ErpLedgerPage = lazy(() => import('./pages/finance/ErpLedgerPage'));
const PaymentQueuePage = lazy(() => import('./pages/finance/PaymentQueuePage'));
const AdvancesPage = lazy(() => import('./pages/finance/AdvancesPage'));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'));
const InvoiceReview = lazy(() => import('./pages/InvoiceReview'));
const InvoiceUpload = lazy(() => import('./pages/InvoiceUpload'));
const ArchivedInvoices = lazy(() => import('./pages/ArchivedInvoices'));
const MyClaims = lazy(() => import('./pages/MyClaims'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const PendingApprovals = lazy(() => import('./pages/PendingApprovals'));
const AllClaimsPage = lazy(() => import('./pages/claims/AllClaimsPage'));
const ClaimDetail = lazy(() => import('./pages/claims/ClaimDetail'));
const TravelClaimWizard = lazy(() => import('./pages/claims/TravelClaimWizard'));
const GeneralReimbursementWizard = lazy(() => import('./pages/claims/GeneralReimbursementWizard'));
const TravelDeskPage = lazy(() => import('./pages/travel/TravelDeskPage'));
const TravelRequestsPage = lazy(() => import('./pages/travel/TravelRequestsPage'));
const CityGroupClassification = lazy(() => import('./pages/admin/CityGroupClassification'));
const CompanyProfile = lazy(() => import('./pages/admin/CompanyProfile'));
const AuditLogs = lazy(() => import('./pages/admin/AuditLogs'));
const ExpenseCategoryManager = lazy(() => import('./pages/admin/ExpenseCategoryManager'));
const ExpenseLimitsMatrix = lazy(() => import('./pages/admin/ExpenseLimitsMatrix'));
const ImpactLevelMaster = lazy(() => import('./pages/admin/ImpactLevelMaster'));
const TravelOptions = lazy(() => import('./pages/admin/TravelOptions'));
const PolicyVersionManager = lazy(() => import('./pages/admin/PolicyVersionManager'));
const TeamBudgets = lazy(() => import('./pages/admin/TeamBudgets'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const NotificationTemplates = lazy(() => import('./pages/admin/NotificationTemplates'));
const WorkflowConfig = lazy(() => import('./pages/admin/WorkflowConfig'));
const HolidayCalendar = lazy(() => import('./pages/admin/HolidayCalendar'));
const PermissionMatrix = lazy(() => import('./pages/admin/PermissionMatrix'));
const ComplianceDashboard = lazy(() => import('./pages/ComplianceDashboard'));
const ExceptionRequestsPage = lazy(() => import('./pages/hr/ExceptionRequestsPage'));
const TeamClaims = lazy(() => import('./pages/team/TeamClaims'));
const TeamSpend = lazy(() => import('./pages/team/TeamSpend'));

export default function App() {
  return (
    <>
      <ParticleBackground />
      <ToastContainer />
      <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<PublicIndex />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        {/* Public, unauthenticated travel-agent booking link — no app shell, no login; the token
            in the URL is the only credential (see public_travel_booking.py). */}
        <Route path="/book/:token" element={<AgentBookingPage />} />
        <Route path="/reset-password" element={<Navigate to="/forgot-password" replace />} />
        <Route path="/access-denied" element={<AccessDenied />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="dashboard" element={<Home />} />
            <Route path="profile" element={<ProfilePage />} />

            <Route element={<RoleGuard permission="submit_claim" />}>
              <Route path="invoices" element={<InvoiceUpload />} />
              <Route path="invoices/archived" element={<ArchivedInvoices />} />
              <Route path="invoices/:invoiceId/review" element={<InvoiceReview />} />
              <Route path="claims/travel/new" element={<TravelClaimWizard key="travel" />} />
              <Route path="claims/travel/:id/edit" element={<TravelClaimWizard key="travel" />} />
              {/* Relocation claims have their own form; the wizard shares its invoice and submit steps. */}
              <Route path="claims/relocation/new" element={<TravelClaimWizard key="relocation" relocation />} />
              <Route path="claims/relocation/:id/edit" element={<TravelClaimWizard key="relocation" relocation />} />
              <Route path="claims/general/new" element={<GeneralReimbursementWizard />} />
              <Route path="claims/general/:id/edit" element={<GeneralReimbursementWizard />} />
              <Route path="claims/my" element={<MyClaims />} />
              <Route path="travel-requests" element={<TravelRequestsPage />} />
            </Route>

            <Route element={<RoleGuard permission="view_team_claims" />}>
              <Route path="team/claims" element={<TeamClaims />} />
              <Route path="team/spend" element={<TeamSpend />} />
            </Route>

            <Route element={<RoleGuard anyOf={['submit_claim', 'view_reports', 'process_payments']} />}>
              <Route path="claims/:id" element={<ClaimDetail />} />
            </Route>

            <Route element={<RoleGuard permission="view_travel_desk" />}>
              <Route path="travel-desk" element={<TravelDeskPage />} />
            </Route>

            <Route
              element={
                <RoleGuard
                  anyOf={['approve_claims', 'process_payments', 'approve_exception']}
                  orScope="relocation"
                />
              }
            >
              <Route element={<ApprovalScopeGuard area="pending-approvals" />}>
                <Route path="claims/pending" element={<PendingApprovals />} />
              </Route>
            </Route>

            <Route path="claims/:claimId/review" element={<ClaimReview />} />
            <Route path="notifications" element={<NotificationsPage />} />

            <Route element={<RoleGuard permission="manage_users" />}>
              <Route path="admin/users" element={<UserManagement />} />
            </Route>

            {/* These each carry their own specific permission guard already, so they're
                deliberately NOT nested under the configure_policy/view_admin_readonly gate
                below — that nesting used to mean an IT_ADMIN who lost configure_policy (e.g. by
                unchecking it in the Permission Matrix editor) lost access to every admin page
                AT ONCE, including the Permission Matrix editor itself, with no self-service way
                back in. Keeping these as independent top-level routes (same pattern as
                admin/users above) means losing configure_policy only affects the pages that
                actually need it — recovery via Role Permissions always stays reachable. */}
            <Route
              path="admin/team-budgets"
              element={
                <RoleGuard permission="manage_team_budgets">
                  <TeamBudgets />
                </RoleGuard>
              }
            />
            <Route
              path="admin/workflow-config"
              element={
                <RoleGuard anyOf={['view_workflow_config', 'edit_workflow_config']}>
                  <WorkflowConfig />
                </RoleGuard>
              }
            />
            <Route
              path="admin/notification-templates"
              element={
                <RoleGuard anyOf={['view_notification_templates', 'edit_notification_templates']}>
                  <NotificationTemplates />
                </RoleGuard>
              }
            />
            <Route element={<RoleGuard permission="manage_holiday_calendar" />}>
              <Route path="admin/holiday-calendar" element={<HolidayCalendar />} />
            </Route>
            <Route
              path="admin/permission-matrix"
              element={
                <RoleGuard anyOf={['view_permission_matrix', 'edit_permission_matrix']}>
                  <PermissionMatrix />
                </RoleGuard>
              }
            />

            {/* Admin: generic read-only (workflow/policy viewers); bank details only with view_sensitive_admin */}
            {/* Policy versions and what's in them: also open to whoever a submitted version is
                waiting on (approver_scope.policy), so they can review and decide it. */}
            <Route element={<RoleGuard anyOf={['configure_policy', 'view_admin_readonly']} orScope="policy" />}>
              <Route path="admin/policy-versions" element={<PolicyVersionManager />} />
              <Route path="admin/expense-limits" element={<ExpenseLimitsMatrix />} />
              <Route path="admin/impact-levels" element={<ImpactLevelMaster />} />
            </Route>
            <Route element={<RoleGuard anyOf={['configure_policy', 'view_admin_readonly']} />}>
              <Route path="admin" element={<Outlet />}>
                {/* IT Admin's Home already shows the system snapshot this page used to. */}
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="expense-categories" element={<ExpenseCategoryManager />} />
                <Route path="city-groups" element={<CityGroupClassification />} />
                <Route path="travel-options" element={<TravelOptions />} />
              </Route>
            </Route>

            <Route element={<RoleGuard anyOf={['export_audit']} />}>
              <Route path="admin/audit-logs" element={<AuditLogs />} />
            </Route>

            <Route element={<RoleGuard anyOf={['view_sensitive_admin']} />}>
              <Route path="admin/company-profile" element={<CompanyProfile />} />
            </Route>

            <Route
              path="team/claims"
              element={
                <ComingSoon
                  icon={Users}
                  title="My Team Claims (placeholder)"
                  description="Manager team claims are not implemented yet. This link is shown for navigation alignment only."
                />
              }
            />
            <Route
              path="team/spend"
              element={
                <ComingSoon
                  icon={BarChart3}
                  title="Team Spend (placeholder)"
                  description="Team spend analytics are not implemented yet. This link is shown for navigation alignment only."
                />
              }
            />
            <Route
              element={
                <RoleGuard anyOf={['approve_claims', 'configure_policy', 'approve_exception']} />
              }
            >
              <Route element={<ApprovalScopeGuard area="exceptions" />}>
                <Route path="hr/exceptions" element={<ExceptionRequestsPage />} />
              </Route>
            </Route>
            <Route element={<RoleGuard permission="view_reports" />}>
              <Route path="compliance" element={<ComplianceDashboard />} />
              <Route path="compliance/reports" element={<Navigate to="/compliance" replace />} />
            </Route>
 
            <Route element={<RoleGuard anyOf={['view_reports', 'process_payments']} />}>
              <Route path="claims/all" element={<AllClaimsPage />} />
            </Route>
            {/* process_payments is also held by PAYROLL (see the Permission Matrix), but
                record_claim_payment itself has always been Finance-only — same rule as the
                GST dashboard and ERP ledger above, so the page isn't shown to someone whose
                "Pay" button would only ever come back 403. */}
            <Route element={<RoleGuard permission="process_payments" roles={['FINANCE']} />}>
              <Route path="finance/payment-queue" element={<PaymentQueuePage />} />
            </Route>
            <Route element={<RoleGuard permission="view_reports" />}>
              <Route path="reports" element={<ReportsPage />} />
              <Route path="finance/reports" element={<Navigate to="/reports" replace />} />
            </Route>
            {/* Finance's own tools; the server keeps their APIs to the Finance role too. */}
            <Route element={<RoleGuard permission="view_reports" roles={['FINANCE']} />}>
              <Route path="finance/gst-dashboard" element={<FinanceGstPage />} />
              <Route path="finance/erp-ledger" element={<ErpLedgerPage />} />
            </Route>
            {/* Advances are Finance-only, deliberately stricter than the other finance/
                routes above (no view_reports fallback, no delegation) — see advances_api.py. */}
            <Route element={<RoleGuard permission="process_advances" />}>
              <Route path="finance/advances" element={<AdvancesPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}
