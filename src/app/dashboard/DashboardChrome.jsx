'use client';

import { usePathname } from 'next/navigation';
import { ClientProvider } from '@/components/dashboard/ClientContext';
import TopBar from '@/components/dashboard/TopBar';
import SideBar from '@/components/dashboard/SideBar';

export default function DashboardChrome({ children }) {
  const pathname = usePathname();
  const isAdmin =
    pathname?.startsWith('/dashboard/admin') || pathname?.startsWith('/reports');

  return (
    <ClientProvider>
      <div className="dash-root">
        <TopBar />
        <div
          className={`dash-layout ${
            pathname?.startsWith('/dashboard/admin') ? 'dash-layout--admin' : ''
          } ${pathname?.startsWith('/reports') ? 'dash-layout--reports' : ''}`}
        >
          {!pathname?.startsWith('/dashboard/admin') && !pathname?.startsWith('/reports') && (
            <SideBar />
          )}
          <main className="page-shell">{children}</main>
        </div>
      </div>
    </ClientProvider>
  );
}
