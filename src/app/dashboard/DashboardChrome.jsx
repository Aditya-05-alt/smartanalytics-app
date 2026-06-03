'use client';

import { usePathname } from 'next/navigation';
import { ClientProvider } from '@/components/dashboard/ClientContext';
import TopBar from '@/components/dashboard/TopBar';
import SideBar from '@/components/dashboard/SideBar';

export default function DashboardChrome({ children }) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith('/dashboard/admin');

  return (
    <ClientProvider>
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
