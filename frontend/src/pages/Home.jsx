import AdminDashboard from './dashboards/AdminDashboard';
import EmployeeDashboard from './dashboards/EmployeeDashboard';
import FinanceDashboard from './dashboards/FinanceDashboard';
import HRBPDashboard from './dashboards/HRBPDashboard';
import ManagerDashboard from './dashboards/ManagerDashboard';
import PayrollDashboard from './dashboards/PayrollDashboard';

import { selectResolvedRole, useAuthStore } from '../store/authStore';

const dashboards = {
  EMPLOYEE: EmployeeDashboard,
  REPORTING_MANAGER: ManagerDashboard,
  HRBP_HR: HRBPDashboard,
  PAYROLL: PayrollDashboard,
  FINANCE: FinanceDashboard,
  IT_ADMIN: AdminDashboard,
};

export default function Home() {
  const role = useAuthStore(selectResolvedRole);
  const Dashboard = dashboards[role] || EmployeeDashboard;
  return <Dashboard />;
}
