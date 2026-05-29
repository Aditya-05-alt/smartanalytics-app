import { ClientProvider } from '@/components/dashboard/ClientContext';
import TopBar from '@/components/dashboard/TopBar';
import SideBar from '@/components/dashboard/SideBar';

export default function DashboardLayout({ children }) {
  return (
    <ClientProvider>
      <div className="dash-root">
        <TopBar />
        <div className="dash-layout">
          <SideBar />
          <main className="page-shell">{children}</main>
        </div>
      </div>
    </ClientProvider>
  );
}
