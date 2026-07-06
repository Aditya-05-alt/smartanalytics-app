'use client';

import { usePathname } from 'next/navigation';
import { ClientProvider } from '@/components/dashboard/ClientContext';
import TopBar from '@/components/dashboard/TopBar';
import SideBar from '@/components/dashboard/SideBar';
import LoginStsTracker from '@/components/telemetry/LoginStsTracker';
import InactivityTimeout from '@/components/auth/InactivityTimeout';

export default function DashboardChrome({ children }) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith('/dashboard/admin');

  return (
    <ClientProvider>
      {!isAdminRoute && <LoginStsTracker />}
      {!isAdminRoute && <InactivityTimeout />}
      <div className="dash-root">
        <TopBar />
        <div className={`dash-layout ${isAdminRoute ? 'dash-layout--admin' : ''}`}>
          {!isAdminRoute && <SideBar />}
          <main className="page-shell">{children}</main>
        </div>
      </div>
    </ClientProvider>
  );
}
