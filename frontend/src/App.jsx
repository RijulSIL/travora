import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/ProtectedRoute';
import RoleGuard from './components/RoleGuard';
import PageLoader from './components/ui/PageLoader';
import ToastContainer from './components/ui/Toast';
import ParticleBackground from './components/ui/ParticleBackground';
import PublicIndex from './pages/PublicIndex';
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage'));
const AccessDenied = lazy(() => import('./pages/AccessDenied'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ClaimReview = lazy(() => import('./pages/ClaimReview'));
const ComingSoon = lazy(() => import('./pages/ComingSoon'));
const Home = lazy(() => import('./pages/Home'));
const FinanceGstPage = lazy(() => import('./pages/finance/FinanceGstPage'));
const ErpLedgerPage = lazy(() => import('./pages/finance/ErpLedgerPage'));
const PaymentQueuePage = lazy(() => import('./pages/finance/PaymentQueuePage'));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'));
const InvoiceReview = lazy(() => import('./pages/InvoiceReview'));
const InvoiceUpload = lazy(() => import('./pages/InvoiceUpload'));
const MyClaims = lazy(() => import('./pages/MyClaims'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const PendingApprovals = lazy(() => import('./pages/PendingApprovals'));
const AllClaimsPage = lazy(() => import('./pages/claims/AllClaimsPage'));
const ClaimDetail = lazy(() => import('./pages/claims/ClaimDetail'));
const ClaimWizard = lazy(() => import('./pages/claims/ClaimWizard'));
const TravelDeskPage = lazy(() => import('./pages/travel/TravelDeskPage'));
const TravelRequestsPage = lazy(() => import('./pages/travel/TravelRequestsPage'));
const CityGroupClassification = lazy(() => import('./pages/admin/CityGroupClassification'));
const CompanyProfile = lazy(() => import('./pages/admin/CompanyProfile'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const AuditLogs = lazy(() => import('./pages/admin/AuditLogs'));
const ExpenseCategoryManager = lazy(() => import('./pages/admin/ExpenseCategoryManager'));
const ExpenseLimitsMatrix = lazy(() => import('./pages/admin/ExpenseLimitsMatrix'));
const ImpactLevelMaster = lazy(() => import('./pages/admin/ImpactLevelMaster'));
const PolicyVersionManager = lazy(() => import('./pages/admin/PolicyVersionManager'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const NotificationTemplates = lazy(() => import('./pages/admin/NotificationTemplates'));
const WorkflowConfig = lazy(() => import('./pages/admin/WorkflowConfig'));
const HolidayCalendar = lazy(() => import('./pages/admin/HolidayCalendar'));
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
        <Route path="/reset-password" element={<Navigate to="/forgot-password" replace />} />
        <Route path="/access-denied" element={<AccessDenied />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="dashboard" element={<Home />} />
            <Route path="profile" element={<ProfilePage />} />

            <Route element={<RoleGuard permission="submit_claim" />}>
              <Route path="invoices" element={<InvoiceUpload />} />
              <Route path="invoices/:invoiceId/review" element={<InvoiceReview />} />
              <Route path="claims/draft" element={<Navigate to="/claims/new" replace />} />
              <Route path="claims/new" element={<ClaimWizard />} />
              <Route path="claims/:id/edit" element={<ClaimWizard />} />
              <Route path="claims/my" element={<MyClaims />} />
              <Route path="travel-requests" element={<TravelRequestsPage />} />
            </Route>

            <Route element={<RoleGuard roles={['REPORTING_MANAGER']} />}>
              <Route path="team/claims" element={<TeamClaims />} />
              <Route path="team/spend" element={<TeamSpend />} />
            </Route>

            <Route element={<RoleGuard anyOf={['submit_claim', 'view_reports', 'process_payments']} />}>
              <Route path="claims/:id" element={<ClaimDetail />} />
            </Route>

            <Route element={<RoleGuard roles={['HRBP_HR', 'HRBP']} />}>
              <Route path="travel-desk" element={<TravelDeskPage />} />
            </Route>

            <Route
              element={
                <RoleGuard
                  allowDelegate
                  anyOf={['approve_stage_1', 'approve_stage_2', 'approve_stage_3', 'approve_stage_4', 'process_payments', 'approve_exception']}
                />
              }
            >
              <Route path="claims/pending" element={<PendingApprovals />} />
            </Route>

            <Route path="claims/:claimId/review" element={<ClaimReview />} />
            <Route path="notifications" element={<NotificationsPage />} />

            <Route element={<RoleGuard permission="manage_users" />}>
              <Route path="admin/users" element={<UserManagement />} />
            </Route>

            {/* Admin: generic read-only (workflow/policy viewers); bank details only with view_sensitive_admin */}
            <Route element={<RoleGuard anyOf={['configure_policy', 'view_admin_readonly']} />}>
              <Route path="admin" element={<Outlet />}>
                <Route index element={<Dashboard />} />
                <Route path="policy-versions" element={<PolicyVersionManager />} />
                <Route path="expense-limits" element={<ExpenseLimitsMatrix />} />
                <Route path="expense-categories" element={<ExpenseCategoryManager />} />
                <Route path="impact-levels" element={<ImpactLevelMaster />} />
                <Route path="city-groups" element={<CityGroupClassification />} />
                <Route
                  path="workflow-config"
                  element={
                    <RoleGuard anyOf={['configure_policy', 'view_workflow_config']}>
                      <WorkflowConfig />
                    </RoleGuard>
                  }
                />
                <Route
                  path="notification-templates"
                  element={
                    <RoleGuard roles={['IT_ADMIN']}>
                      <NotificationTemplates />
                    </RoleGuard>
                  }
                />
                <Route element={<RoleGuard roles={['IT_ADMIN']} />}>
                  <Route path="holiday-calendar" element={<HolidayCalendar />} />
                </Route>
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
                  emoji="👥"
                  title="My Team Claims (placeholder)"
                  description="Manager team claims are not implemented yet. This link is shown for navigation alignment only."
                />
              }
            />
            <Route
              path="team/spend"
              element={
                <ComingSoon
                  emoji="📊"
                  title="Team Spend (placeholder)"
                  description="Team spend analytics are not implemented yet. This link is shown for navigation alignment only."
                />
              }
            />
            <Route
              element={
                <RoleGuard
                  allowDelegate
                  anyOf={['approve_stage_2', 'approve_stage_4', 'configure_policy', 'approve_exception']}
                />
              }
            >
              <Route path="hr/exceptions" element={<ExceptionRequestsPage />} />
            </Route>
            <Route element={<RoleGuard roles={['HRBP_HR', 'HRBP']} />}>
              <Route path="compliance" element={<ComplianceDashboard />} />
              <Route path="compliance/reports" element={<Navigate to="/compliance" replace />} />
            </Route>

            <Route element={<RoleGuard anyOf={['view_reports', 'process_payments']} />}>
              <Route path="claims/all" element={<AllClaimsPage />} />
            </Route>
            <Route element={<RoleGuard permission="view_reports" />}>
              <Route path="finance/payment-queue" element={<PaymentQueuePage />} />
              <Route path="finance/gst-dashboard" element={<FinanceGstPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="finance/reports" element={<Navigate to="/reports" replace />} />
              <Route path="finance/erp-ledger" element={<ErpLedgerPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}
