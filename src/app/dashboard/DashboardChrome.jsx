'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ClientProvider, useClient } from '@/components/dashboard/ClientContext';
import TopBar from '@/components/dashboard/TopBar';
import SideBar from '@/components/dashboard/SideBar';
import { NavigationLoadingProvider } from '@/components/dashboard/NavigationLoading';
import LoginStsTracker from '@/components/telemetry/LoginStsTracker';
import InactivityTimeout from '@/components/auth/InactivityTimeout';
import {
  canAccessReport,
  firstAllowedReportHref,
  reportKeyFromPathname,
} from '@/lib/access/permissions';

function DashboardContent({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { access, accessLoading } = useClient();
  const isAdminRoute = pathname?.startsWith('/dashboard/admin');
  const reportKey = isAdminRoute ? null : reportKeyFromPathname(pathname);
  const denied =
    !isAdminRoute &&
    !accessLoading &&
    reportKey &&
    !canAccessReport(access, reportKey);

  useEffect(() => {
    if (denied) router.replace(firstAllowedReportHref(access));
  }, [access, denied, router]);

  return (
    <>
      {!isAdminRoute && <LoginStsTracker />}
      {!isAdminRoute && <InactivityTimeout />}
      <Suspense fallback={null}>
        <NavigationLoadingProvider>
          <div className="dash-root">
            <TopBar />
            <div className={`dash-layout ${isAdminRoute ? 'dash-layout--admin' : ''}`}>
              {!isAdminRoute && <SideBar />}
              <main className="page-shell">
                {denied ? (
                  <p className="ga4-count-meta">Redirecting to an allowed report…</p>
                ) : (
                  children
                )}
              </main>
            </div>
          </div>
        </NavigationLoadingProvider>
      </Suspense>
    </>
  );
}

export default function DashboardChrome({ children }) {
  return (
    <ClientProvider>
      <DashboardContent>{children}</DashboardContent>
    </ClientProvider>
  );
}
