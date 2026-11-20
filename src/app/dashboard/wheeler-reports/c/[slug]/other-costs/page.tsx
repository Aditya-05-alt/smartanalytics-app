import Table, { Card } from '@/components/dashboard/wheeler-reports/Table';
import CostForm from './CostForm';
import DeleteButton from './DeleteButton';
import { requireClient } from '@/lib/wheelerReports/auth';
import { userClient } from '@/lib/wheelerReports/supabase/server';
import { loadStores } from '@/lib/wheelerReports/data';
import { addDays, monthName, monthStart, todayInZone } from '@/lib/wheelerReports/dates';
import { NUM, USD2 } from '@/lib/wheelerReports/format';

export default async function OtherCostsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ month?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { client } = await requireClient(slug);
  const sb = await userClient();
  const thisMonth = monthStart(todayInZone(client.timezone));

  // Months to choose from: the next month and the 12 before it.
  const months: string[] = [];
  let m = monthStart(addDays(thisMonth, 31));
  for (let i = 0; i < 14; i++) { months.push(m); m = monthStart(addDays(m, -1)); }
  const month = sp.month && months.includes(sp.month) ? sp.month : thisMonth;

  const [stores, { data: heads }, { data: costs }] = await Promise.all([
    loadStores(sb, client.id),
    sb.from('wheeler_reports_cost_heads').select('name, client_id').or(`client_id.is.null,client_id.eq.${client.id}`).order('created_at'),
    sb.from('wheeler_reports_other_costs').select('id, store_id, head, amount, created_at').eq('client_id', client.id).eq('month', month).order('created_at', { ascending: false }),
  ]);
  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name ?? 'Unknown store' : 'All stores');
  const list = (costs ?? []).map((c) => ({ ...c, amount: Number(c.amount), store: storeName(c.store_id) }));
  const byStore = [...new Set(list.map((c) => c.store))]
    .sort((a, b) => stores.findIndex((s) => s.name === a) - stores.findIndex((s) => s.name === b))
    .map((s) => ({ store: s, entries: list.filter((c) => c.store === s).length, amount: list.filter((c) => c.store === s).reduce((a, c) => a + c.amount, 0) }));
  const total = { store: 'Total', entries: list.length, amount: list.reduce((a, c) => a + c.amount, 0) };

  return (
    <>
      <main className="wrap narrow">
        <header className="head">
          <div>
            <h1>{client.name} | Other Costs</h1>
            <p className="sub">Costs outside Google Ads and Facebook · they feed the Monthly Marketing Report right away</p>
          </div>
          <form method="get" className="row">
            <label className="field"><span>Month</span>
              <select name="month" defaultValue={month}>{months.map((x) => <option key={x} value={x}>{monthName(x)}</option>)}</select>
            </label>
            <button className="btn ghost" type="submit">Show</button>
          </form>
        </header>

        <Card id="add" title="Add a cost" sub={monthName(month)}>
          <CostForm slug={slug} month={month} stores={stores.map((s) => ({ id: s.id, name: s.name }))}
            heads={[...new Set((heads ?? []).map((h) => h.name))]} />
        </Card>

        <Card id="by-store" title="Other costs by store" sub={monthName(month)}>
          <Table rows={byStore} total={byStore.length ? total : undefined} empty="No other costs added for this month yet." cols={[
            { key: 'store', label: 'Store', left: true },
            { key: 'entries', label: 'Entries', fmt: (v) => NUM(v as number) },
            { key: 'amount', label: 'Amount', bold: true, fmt: (v) => USD2(v as number) },
          ]} />
        </Card>

        <Card id="log" title="All entries" sub="newest first">
          {list.length ? (
            <div className="tbl"><table>
              <thead><tr><th>Cost head</th><th className="l">Store</th><th>Amount</th><th className="l">Added</th><th className="l">Delete</th></tr></thead>
              <tbody>{list.map((c) => (
                <tr key={c.id}>
                  <td>{c.head}</td><td className="l">{c.store}</td><td>{USD2(c.amount)}</td>
                  <td className="l">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: client.timezone })}</td>
                  <td className="l"><DeleteButton slug={slug} id={c.id} label={`${c.head}, ${c.store}`} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="empty">Entries you add appear here.</p>}
        </Card>
      </main>
    </>
  );
}
