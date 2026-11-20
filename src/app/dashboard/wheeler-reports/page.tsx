import Link from 'next/link';
import { requireViewer } from '@/lib/wheelerReports/auth';
import { userClient } from '@/lib/wheelerReports/supabase/server';
import NewClientButton from '@/components/dashboard/wheeler-reports/NewClientButton';

export default async function WheelerReportsHome() {
  const viewer = await requireViewer();
  const sb = await userClient();
  const isAdmin = viewer.role === 'admin';

  let clients: { id: string; slug: string; name: string }[] = [];
  if (isAdmin) {
    const { data } = await sb.from('wheeler_reports_clients').select('id, slug, name').order('name');
    clients = data ?? [];
  } else if (viewer.clientId) {
    const { data } = await sb
      .from('wheeler_reports_clients')
      .select('id, slug, name')
      .eq('id', viewer.clientId)
      .maybeSingle();
    if (data) clients = [data];
  }

  return (
    <main className="wrap">
      <header className="head">
        <div>
          <h1>Media Cost</h1>
          <p className="sub">Pick a dealer to open their monthly marketing report.</p>
        </div>
        {isAdmin && <NewClientButton />}
      </header>

      {!clients.length ? (
        <div className="card">
          <div className="body">
            <p className="empty" style={{ padding: 0 }}>
              {isAdmin
                ? 'No clients yet. Use New client to add one.'
                : `Your account (${viewer.email}) isn’t linked to a client. Ask Wheeler to add you.`}
            </p>
          </div>
        </div>
      ) : (
        <div className="wr-client-grid">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/wheeler-reports/c/${c.slug}/report`}
              className="wr-client-card"
            >
              <span className="wr-client-name">{c.name}</span>
              <span className="wr-client-open">Open report →</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
