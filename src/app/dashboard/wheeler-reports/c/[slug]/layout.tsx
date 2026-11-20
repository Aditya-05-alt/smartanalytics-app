import ClientShell from '@/components/dashboard/wheeler-reports/ClientShell';
import { requireClient } from '@/lib/wheelerReports/auth';
import { userClient } from '@/lib/wheelerReports/supabase/server';

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { viewer, client } = await requireClient(slug);

  let dealers: { slug: string; name: string }[] = [];
  if (viewer.role === 'admin') {
    const sb = await userClient();
    const { data } = await sb
      .from('wheeler_reports_clients')
      .select('slug, name')
      .order('name');
    dealers = data ?? [];
  }

  return (
    <ClientShell
      viewer={{ role: viewer.role }}
      client={{ slug: client.slug, name: client.name }}
      dealers={dealers}
    >
      {children}
    </ClientShell>
  );
}
