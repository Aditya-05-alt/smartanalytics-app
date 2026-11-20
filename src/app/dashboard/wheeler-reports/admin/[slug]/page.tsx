import { notFound } from 'next/navigation';
import ActionForm from '@/components/dashboard/wheeler-reports/ActionForm';
import { Card } from '@/components/dashboard/wheeler-reports/Table';
import { requireAdmin } from '@/lib/wheelerReports/auth';
import { adminClient } from '@/lib/wheelerReports/supabase/server';
import { loadStores } from '@/lib/wheelerReports/data';
import type { Client } from '@/lib/wheelerReports/types';
import { deleteStore, saveStore, updateClient } from '../actions';

export default async function ClientSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAdmin();
  const sb = adminClient();
  const { data } = await sb.from('wheeler_reports_clients').select('*').eq('slug', slug).maybeSingle();
  if (!data) notFound();
  const client = data as Client;
  const stores = await loadStores(sb, client.id);

  const StoreFields = ({ s }: { s?: (typeof stores)[number] }) => (
    <>
      <label className="field"><span>Store name</span><input name="name" defaultValue={s?.name} required placeholder="Jackson, TN" /></label>
      <label className="field"><span>Order</span><input name="sort" type="number" defaultValue={s?.sort ?? stores.length + 1} style={{ width: '5rem' }} /></label>
      <label className="field"><span>Words in campaign names (comma-separated)</span><input name="campaign_terms" defaultValue={s?.campaign_terms.join(', ')} placeholder="jackson" /></label>
      <label className="field"><span>Lead export locations (comma-separated)</span><input name="lead_locations" defaultValue={s?.lead_locations.join(', ')} placeholder="Jackson" /></label>
    </>
  );

  return (
    <>
      <main className="wrap">
        <header className="head"><div><h1>{client.name} | Settings &amp; stores</h1><p className="sub">Wheeler admin</p></div></header>
        <div className="grid">
          <Card id="settings" title="Client and ad accounts" wide>
            <div className="body">
              <ActionForm action={updateClient.bind(null, client.id)} submit="Save">
                <label className="field"><span>Name</span><input name="name" defaultValue={client.name} required /></label>
                <label className="field"><span>Time zone</span><input name="timezone" defaultValue={client.timezone} /></label>
                <label className="field"><span>Google Ads customer ID</span><input name="google_ads_customer_id" defaultValue={client.google_ads_customer_id ?? ''} placeholder="123-456-7890" /></label>
                <label className="field"><span>Meta ad account ID</span><input name="meta_ad_account_id" defaultValue={client.meta_ad_account_id ?? ''} placeholder="act_1234567890" /></label>
              </ActionForm>
              <p className="note">The Google Ads account must sit under the manager (MCC) account set in GOOGLE_ADS_LOGIN_CUSTOMER_ID, and the Meta System User must have the ad account assigned.</p>
            </div>
          </Card>

          <Card id="stores" title="Stores" sub="how campaigns and leads are matched to a store" wide>
            <div className="body">
              {stores.map((s) => (
                <div key={s.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
                  <ActionForm action={saveStore.bind(null, client.id, s.id)} submit="Save"><StoreFields s={s} /></ActionForm>
                  <ActionForm action={deleteStore.bind(null, s.id)} submit="Delete store" className="row"><span className="note">Deleting a store un-assigns its leads and campaigns.</span></ActionForm>
                </div>
              ))}
              <p className="lbl">Add a store</p>
              <ActionForm action={saveStore.bind(null, client.id, null)} submit="Add store"><StoreFields /></ActionForm>
              <p className="note">A campaign belongs to the first store (by order) whose word appears in its name; &quot;All Locations&quot; campaigns and names with no match are shared. Leads belong to the store whose location matches the export&apos;s Location column.</p>
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
