import { Outlet } from 'react-router-dom';

import AdminSidebar from './AdminSidebar';

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar />
      <main className="min-w-0 flex-1 overflow-x-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
