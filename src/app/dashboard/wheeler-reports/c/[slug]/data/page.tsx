import ActionForm from '@/components/dashboard/wheeler-reports/ActionForm';
import { Card } from '@/components/dashboard/wheeler-reports/Table';
import { requireClient } from '@/lib/wheelerReports/auth';
import { adminClient } from '@/lib/wheelerReports/supabase/server';
import { loadStores } from '@/lib/wheelerReports/data';
import { env } from '@/lib/wheelerReports/env';
import { addDays, monthEnd, monthName, monthStart, todayInZone } from '@/lib/wheelerReports/dates';
import { saveMonthly, syncNow, uploadGoogleReport, uploadLeads } from './actions';

export default async function DataPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ month?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { client } = await requireClient(slug);
  const sb = adminClient();

  const thisMonth = monthStart(todayInZone(client.timezone));
  const months: string[] = [];
  for (let m = thisMonth, i = 0; i < 13; i++, m = monthStart(addDays(m, -1))) months.push(m);
  const month = sp.month && /^\d{4}-\d{2}-01$/.test(sp.month) ? sp.month : thisMonth;
  const end = monthEnd(month);

  const [stores, { data: media }, { data: sales }, { data: manual }, { count: metaApi }, { data: runs }] = await Promise.all([
    loadStores(sb, client.id),
    sb.from('wheeler_reports_media_spend').select('store_id, amount').eq('client_id', client.id).eq('month', month),
    sb.from('wheeler_reports_sales').select('store_id, units').eq('client_id', client.id).eq('date_from', month).eq('date_to', end),
    sb.from('wheeler_reports_ad_stats').select('store_id, cost').eq('client_id', client.id).eq('platform', 'meta').eq('source', 'manual').eq('date_from', month).eq('date_to', end),
    sb.from('wheeler_reports_ad_stats').select('id', { count: 'exact', head: true }).eq('client_id', client.id).eq('platform', 'meta').eq('source', 'api').gte('date_from', month).lte('date_to', end),
    sb.from('wheeler_reports_sync_runs').select('kind, started_at, status, rows, message').eq('client_id', client.id).order('started_at', { ascending: false }).limit(15),
  ]);
  const get = (rows: { store_id: string; [k: string]: unknown }[] | null, id: string, col: string) => {
    const r = rows?.find((x) => x.store_id === id);
    return r ? String(r[col]) : '';
  };
  const googleReady = !!client.google_ads_customer_id && env.google.configured();
  const metaReady = !!client.meta_ad_account_id && env.meta.configured();

  return (
    <>
      <main className="wrap">
        <header className="head">
          <div>
            <h1>{client.name} | Data &amp; sync</h1>
            <p className="sub">Everything saved here shows in the report right away.</p>
          </div>
        </header>

        <div className="grid">
          <Card id="sync" title="Ad platforms (API)" sub="runs automatically every few hours">
            <div className="body">
              <p className="note">
                Google Ads: {googleReady ? <span className="msg-ok">connected (customer {client.google_ads_customer_id})</span>
                  : <span className="msg-warn">{client.google_ads_customer_id ? 'API keys missing on the server' : 'no customer ID set'}</span>}.{' '}
                Meta Ads: {metaReady ? <span className="msg-ok">connected (act_{client.meta_ad_account_id})</span>
                  : <span className="msg-warn">{client.meta_ad_account_id ? 'API token missing on the server' : 'no ad account ID set'}</span>}.
                {' '}Set the IDs under Clients &amp; users.
              </p>
              <ActionForm action={syncNow.bind(null, slug)} submit="Sync now">
                <label className="field"><span>Platform</span>
                  <select name="platform" defaultValue="google"><option value="google">Google Ads</option><option value="meta">Meta Ads</option></select>
                </label>
                <label className="field"><span>From (optional)</span><input type="date" name="from" /></label>
                <label className="field"><span>To (optional)</span><input type="date" name="to" /></label>
              </ActionForm>
              <p className="note">Without dates it syncs the last {env.syncLookbackDays()} days. Synced days replace uploaded or hand-entered figures for the same dates.</p>
            </div>
          </Card>

          <Card id="leads" title="Upload lead export" sub="Scout website leads, CSV">
            <div className="body">
              <ActionForm action={uploadLeads.bind(null, slug)} submit="Upload leads">
                <label className="field" style={{ gridColumn: '1 / -1' }}><span>Lead export (.csv)</span><input type="file" name="file" accept=".csv,text/csv" required /></label>
                <label className="field"><span>Keep from (optional)</span><input type="date" name="from" /></label>
                <label className="field"><span>Keep to (optional)</span><input type="date" name="to" /></label>
              </ActionForm>
              <p className="note">Leads are matched by Lead ID, so uploading an overlapping export again updates leads instead of adding duplicates. Names, emails and phones are not stored.</p>
            </div>
          </Card>

          <Card id="google-upload" title="Upload Google Ads report" sub="when the API isn't connected">
            <div className="body">
              <ActionForm action={uploadGoogleReport.bind(null, slug)} submit="Upload report">
                <label className="field" style={{ gridColumn: '1 / -1' }}><span>Campaign report (.xlsx or .csv)</span><input type="file" name="file" accept=".xlsx,.csv" required /></label>
                <label className="field"><span>From (if not in the file)</span><input type="date" name="from" /></label>
                <label className="field"><span>To (if not in the file)</span><input type="date" name="to" /></label>
              </ActionForm>
              <p className="note">Use the Google Ads &quot;Campaign report&quot; with Cost, Impr., Clicks, Search impr. share and Campaign ID. It replaces any Google Ads figures for the same dates.</p>
            </div>
          </Card>

          <Card id="monthly" title="Monthly figures by store" sub={monthName(month)} wide>
            <div className="body">
              <form method="get" className="row">
                <label className="field"><span>Month</span>
                  <select name="month" defaultValue={month}>{months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select>
                </label>
                <button className="btn ghost" type="submit">Show</button>
              </form>
              <ActionForm action={saveMonthly.bind(null, slug)} submit={`Save ${monthName(month)}`} className="">
                <input type="hidden" name="month" value={month} />
                <div className="tbl"><table>
                  <thead><tr><th>Store</th><th>Total media spend ($)</th><th>Facebook spend ($)</th><th>Sales (units)</th></tr></thead>
                  <tbody>{stores.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td><input name={`media_${s.id}`} type="number" min="0" step="0.01" defaultValue={get(media, s.id, 'amount')} aria-label={`Media spend, ${s.name}`} style={{ width: '9rem' }} /></td>
                      <td>{metaApi ? <span className="note">from Meta API</span>
                        : <input name={`fb_${s.id}`} type="number" min="0" step="0.01" defaultValue={get(manual, s.id, 'cost')} aria-label={`Facebook spend, ${s.name}`} style={{ width: '9rem' }} />}</td>
                      <td><input name={`sales_${s.id}`} type="number" min="0" step="1" defaultValue={get(sales, s.id, 'units')} aria-label={`Sales, ${s.name}`} style={{ width: '7rem' }} /></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </ActionForm>
              <p className="note">Leave a cell empty to clear it. Total media spend, when entered, is used as the month&apos;s Total spend instead of Google + Meta spend. Facebook spend here is only for months the Meta API doesn&apos;t cover. Monthly sales are spread evenly over the month when fewer days are selected.</p>
            </div>
          </Card>

          <Card id="runs" title="Recent imports and syncs" wide>
            {runs?.length ? (
              <div className="tbl"><table>
                <thead><tr><th>When</th><th className="l">What</th><th className="l">Result</th><th>Rows</th><th className="l">Details</th></tr></thead>
                <tbody>{runs.map((r, i) => (
                  <tr key={i}>
                    <td>{new Date(r.started_at).toLocaleString('en-US', { timeZone: client.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="l">{({ google: 'Google Ads sync', meta: 'Meta Ads sync', leads_upload: 'Lead upload', google_upload: 'Google Ads upload' } as Record<string, string>)[r.kind] ?? r.kind}</td>
                    <td className={'l ' + (r.status === 'ok' ? 'msg-ok' : r.status === 'error' ? 'msg-err' : '')}>{r.status}</td>
                    <td>{r.rows ?? '–'}</td>
                    <td className="l" style={{ whiteSpace: 'normal', minWidth: '18rem' }}>{r.message}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <p className="empty">Nothing imported yet.</p>}
          </Card>
        </div>
      </main>
    </>
  );
}
