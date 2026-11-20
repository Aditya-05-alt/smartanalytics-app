import Link from 'next/link';
import ActionForm from '@/components/dashboard/wheeler-reports/ActionForm';
import { Card } from '@/components/dashboard/wheeler-reports/Table';
import { requireAdmin } from '@/lib/wheelerReports/auth';
import { adminClient } from '@/lib/wheelerReports/supabase/server';
import { createClient, createUser, updateUser } from './actions';

export default async function AdminPage() {
  await requireAdmin();
  const sb = adminClient();
  const [{ data: clients }, { data: users }] = await Promise.all([
    sb.from('wheeler_reports_clients').select('id, slug, name, google_ads_customer_id, meta_ad_account_id').order('name'),
    sb.from('wheeler_reports_profiles').select('user_id, email, role, client_id').order('email'),
  ]);
  const clientOptions = (clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>);

  return (
    <>
      <main className="wrap">
        <header className="head"><div><h1>Clients &amp; users</h1><p className="sub">Wheeler admin</p></div></header>
        <div className="grid">
          <Card id="clients" title="Clients" wide>
            {clients?.length ? (
              <div className="tbl"><table>
                <thead><tr><th>Client</th><th className="l">Google Ads</th><th className="l">Meta Ads</th><th className="l">Open</th></tr></thead>
                <tbody>{clients.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="l">{c.google_ads_customer_id || '–'}</td>
                    <td className="l">{c.meta_ad_account_id ? 'act_' + c.meta_ad_account_id : '–'}</td>
                    <td className="l row">
                      <Link href={`/dashboard/wheeler-reports/c/${c.slug}/report`}>Report</Link> · <Link href={`/dashboard/wheeler-reports/c/${c.slug}/other-costs`}>Other costs</Link> ·{' '}
                      <Link href={`/dashboard/wheeler-reports/c/${c.slug}/data`}>Data &amp; sync</Link> · <Link href={`/dashboard/wheeler-reports/admin/${c.slug}`}>Settings &amp; stores</Link>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <p className="empty">No clients yet.</p>}
            <div className="body">
              <ActionForm action={createClient} submit="Add client">
                <label className="field"><span>Name</span><input name="name" required placeholder="A&L RV Sales" /></label>
                <label className="field"><span>Slug (web address)</span><input name="slug" placeholder="al-rv-sales" pattern="[a-z0-9-]+" /></label>
                <label className="field"><span>Time zone</span><input name="timezone" defaultValue="America/New_York" /></label>
              </ActionForm>
            </div>
          </Card>

          <Card id="users" title="Users" wide>
            <div className="tbl"><table>
              <thead><tr><th>Email</th><th className="l">Access</th></tr></thead>
              <tbody>{(users ?? []).map((u) => (
                <tr key={u.user_id}>
                  <td>{u.email}</td>
                  <td className="l">
                    <ActionForm action={updateUser.bind(null, u.user_id)} submit="Save" className="row">
                      <select name="role" defaultValue={u.role} aria-label={`Role for ${u.email}`}><option value="client">Client user</option><option value="admin">Wheeler admin</option></select>
                      <select name="client_id" defaultValue={u.client_id ?? ''} aria-label={`Client for ${u.email}`}><option value="">No client</option>{clientOptions}</select>
                    </ActionForm>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="body">
              <p className="lbl">Add a user</p>
              <ActionForm action={createUser} submit="Create user">
                <label className="field"><span>Email</span><input name="email" type="email" required /></label>
                <label className="field"><span>Password (10+ characters)</span><input name="password" type="text" minLength={10} required autoComplete="off" /></label>
                <label className="field"><span>Access</span><select name="role" defaultValue="client"><option value="client">Client user</option><option value="admin">Wheeler admin</option></select></label>
                <label className="field"><span>Client</span><select name="client_id" defaultValue=""><option value="">Choose a client</option>{clientOptions}</select></label>
              </ActionForm>
              <p className="note">Client users see their client&apos;s report and can add or delete other costs. Wheeler admins see every client, upload data and run syncs.</p>
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
