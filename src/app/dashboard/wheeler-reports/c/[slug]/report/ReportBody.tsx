import Table, { Card } from '@/components/dashboard/wheeler-reports/Table';
import { userClient } from '@/lib/wheelerReports/supabase/server';
import { loadReportRows } from '@/lib/wheelerReports/data';
import { buildReport } from '@/lib/wheelerReports/report';
import { SHARED_LABEL } from '@/lib/wheelerReports/campaigns';
import { SOURCE_COLUMNS } from '@/lib/wheelerReports/leadSources';
import { monthName, rangeLabel } from '@/lib/wheelerReports/dates';
import { NUM, PCT, USD, USD2 } from '@/lib/wheelerReports/format';

/** Heavy tables — streamed under Suspense so the report shell paints immediately. */
export default async function ReportBody({
  clientId,
  from,
  to,
}: {
  clientId: string;
  from: string;
  to: string;
}) {
  const sb = await userClient();
  const rows = await loadReportRows(sb, clientId, from, to);
  const r = buildReport({ ...rows, from, to });
  const k = r.kpis;
  const adsMonths = r.basis.filter((b) => b.kind === 'ads').map((b) => monthName(b.month).split(' ')[0]);
  const mediaMonths = r.basis.filter((b) => b.kind === 'media').map((b) => monthName(b.month).split(' ')[0]);
  const total = <T,>(list: T[]) => ({ rows: list.slice(0, -1), total: list[list.length - 1] });

  return (
    <>
      <div className="alert" role="note">
        {mediaMonths.length > 0 && <>Total spend for {mediaMonths.join(', ')} is the media spend entered per store plus other costs. </>}
        {adsMonths.length > 0 && <>Total spend for {adsMonths.join(', ')} is Google Ads + Meta Ads spend plus other costs (no media spend entered). </>}
        Google Ads data: {r.coverage.google ? rangeLabel(r.coverage.google.from < from ? from : r.coverage.google.from, r.coverage.google.to > to ? to : r.coverage.google.to) : <b>none for these dates</b>}.{' '}
        Meta Ads data: {r.coverage.meta ? rangeLabel(r.coverage.meta.from < from ? from : r.coverage.meta.from, r.coverage.meta.to > to ? to : r.coverage.meta.to) : <b>none for these dates</b>}.{' '}
        Leads: {r.coverage.leads ? rangeLabel(r.coverage.leads.from, r.coverage.leads.to) : <b>none for these dates</b>}.
      </div>

      <section className="kpis" aria-label="Totals">
        <div className="kpi"><span className="v">{USD(k.total_spend)}</span><span className="l">Total spend</span></div>
        <div className="kpi"><span className="v">{NUM(k.leads)}</span><span className="l">Total leads</span></div>
        <div className="kpi"><span className="v">{k.sales == null ? '—' : NUM(k.sales)}</span><span className="l">Total sales</span>{k.sales == null && <span className="n">Waiting on wheeler_reports_sales data</span>}</div>
        <div className="kpi"><span className="v">{USD2(k.cost_per_lead)}</span><span className="l">Cost per lead</span></div>
        <div className="kpi"><span className="v">{k.cost_per_sale == null ? '—' : USD2(k.cost_per_sale)}</span><span className="l">Cost per sale</span>{k.sales == null && <span className="n">Waiting on wheeler_reports_sales data</span>}</div>
      </section>
      <section className="kpis ch" aria-label="Google Ads and Meta Ads">
        <div className="kpi"><span className="v">{k.google_spend == null ? '—' : USD(k.google_spend)}</span><span className="l">Google spend</span></div>
        <div className="kpi"><span className="v">{NUM(k.google_leads)}</span><span className="l">Google leads</span></div>
        <div className="kpi"><span className="v">{k.google_cpl == null ? '—' : USD2(k.google_cpl)}</span><span className="l">Google cost per lead</span></div>
        <div className="kpi fb"><span className="v">{k.meta_spend == null ? '—' : USD(k.meta_spend)}</span><span className="l">Facebook spend</span>{k.meta_spend == null && <span className="n">Waiting on Meta Ads data</span>}</div>
        <div className="kpi fb"><span className="v">{NUM(k.meta_leads)}</span><span className="l">Facebook leads</span></div>
        <div className="kpi fb"><span className="v">{k.meta_cpl == null ? '—' : USD2(k.meta_cpl)}</span><span className="l">Facebook cost per lead</span></div>
      </section>

      <div className="grid">
        <Card id="t-leads" title="1. Leads by store" sub="full source break-up, website leads" wide>
          <Table {...total(r.leadsByStore)} cols={[
            { key: 'store', label: 'Store', left: true },
            { key: 'total_spend', label: 'Total spend', fmt: (v) => USD2(v as number) },
            { key: 'leads', label: 'Leads', bold: true, fmt: (v) => NUM(v as number) },
            ...SOURCE_COLUMNS.map((c) => ({ key: c.key, label: c.label, fmt: (v: unknown) => NUM(v as number) })),
            { key: 'share', label: '% of leads', fmt: (v) => PCT(v as number) },
          ]} />
        </Card>

        <Card id="t-fb" title="2. Facebook leads by store" sub="spend from Meta Ads, leads mapped to each store">
          <Table {...total(r.metaByStore)} sharedLabel={SHARED_LABEL} cols={[
            { key: 'store', label: 'Store', left: true },
            { key: 'spend', label: 'Spend', fmt: (v) => USD2(v as number) },
            { key: 'leads', label: 'Leads', bold: true, fmt: (v) => NUM(v as number) },
            { key: 'cost_per_lead', label: 'Cost / lead', fmt: (v) => USD(v as number) },
          ]} />
        </Card>

        <Card id="t-google" title="3. Google leads by store" sub="spend, leads and cost per lead">
          <Table {...total(r.googleByStore)} sharedLabel={SHARED_LABEL} cols={[
            { key: 'store', label: 'Store', left: true },
            { key: 'spend', label: 'Spend', fmt: (v) => USD(v as number) },
            { key: 'leads', label: 'Leads', bold: true, fmt: (v) => NUM(v as number) },
            { key: 'cost_per_lead', label: 'Cost / lead', bold: true, fmt: (v) => USD(v as number) },
          ]} />
        </Card>

        <Card id="t-group" title="Google Ads by campaign group" sub="cost, traffic, impression share and leads" wide>
          <Table {...total(r.googleByGroup)} bodyScrollRows={10} cols={[
            { key: 'group', label: 'Campaign group', left: true },
            { key: 'campaigns', label: 'Campaigns', fmt: (v) => NUM(v as number) },
            { key: 'cost', label: 'Cost', fmt: (v) => USD(v as number) },
            { key: 'impressions', label: 'Impr.', fmt: (v) => NUM(v as number) },
            { key: 'clicks', label: 'Clicks', fmt: (v) => NUM(v as number) },
            { key: 'cpc', label: 'CPC', fmt: (v) => USD2(v as number) },
            { key: 'ctr', label: 'CTR', fmt: (v) => PCT(v as number, 1) },
            { key: 'search_is', label: 'Search IS', fmt: (v) => PCT(v as number, 1) },
            { key: 'leads', label: 'Leads', bold: true, fmt: (v) => NUM(v as number) },
            { key: 'cost_per_lead', label: 'Cost / lead', bold: true, fmt: (v) => USD2(v as number) },
          ]} />
        </Card>

        <Card id="t-fbc" title="Facebook by campaign" sub="Meta Ads spend and leads by campaign" wide>
          <Table {...total(r.metaByCampaign)} cols={[
            { key: 'campaign', label: 'Campaign', left: true },
            { key: 'type', label: 'Type', left: true },
            { key: 'spend', label: 'Spend', fmt: (v) => USD2(v as number) },
            { key: 'impressions', label: 'Impr.', fmt: (v) => NUM(v as number) },
            { key: 'clicks', label: 'Clicks', fmt: (v) => NUM(v as number) },
            { key: 'ctr', label: 'CTR', fmt: (v) => PCT(v as number, 1) },
            { key: 'platform_leads', label: 'Meta leads', fmt: (v) => NUM(v as number) },
            { key: 'leads', label: 'Website leads', bold: true, fmt: (v) => NUM(v as number) },
            { key: 'cost_per_lead', label: 'Cost / lead', fmt: (v) => USD2(v as number) },
            { key: 'price_unlock', label: 'Price unlock', fmt: (v) => NUM(v as number) },
            { key: 'payment_calc', label: 'Payment calc', fmt: (v) => NUM(v as number) },
            { key: 'other_forms', label: 'Other forms', fmt: (v) => NUM(v as number) },
          ]} />
        </Card>

        <Card id="t-other" title="Other costs" sub="client-provided, by store">
          <Table {...total(r.otherByStore)} empty="No other costs for these dates." cols={[
            { key: 'store', label: 'Store', left: true },
            { key: 'entries', label: 'Entries', fmt: (v) => NUM(v as number) },
            { key: 'amount', label: 'Cost', bold: true, fmt: (v) => USD2(v as number) },
          ]} />
        </Card>

        <Card id="t-head" title="Other costs by cost head" sub="client-provided, all stores">
          <Table {...total(r.otherByHead)} empty="No other costs for these dates." cols={[
            { key: 'head', label: 'Cost head', left: true },
            { key: 'stores', label: 'Stores', fmt: (v) => NUM(v as number) },
            { key: 'entries', label: 'Entries', fmt: (v) => NUM(v as number) },
            { key: 'amount', label: 'Amount', bold: true, fmt: (v) => USD2(v as number) },
            { key: 'share', label: 'Share', fmt: (v) => PCT(v as number) },
          ]} />
        </Card>

        <Card id="t-form" title="4. Leads by form" sub="website form fills">
          <Table {...total(r.leadsByForm)} cols={[
            { key: 'form', label: 'Form', left: true },
            { key: 'leads', label: 'Leads', bold: true, fmt: (v) => NUM(v as number) },
            { key: 'share', label: '% of leads', fmt: (v) => PCT(v as number) },
          ]} />
        </Card>

        <Card id="t-sales" title="5. Sales by store" sub="units sold, cost per sale and close rate">
          {r.coverage.sales ? (
            <Table {...total(r.salesByStore)} cols={[
              { key: 'store', label: 'Store', left: true },
              { key: 'units', label: 'Sales', bold: true, fmt: (v) => NUM(v as number) },
              { key: 'total_spend', label: 'Total spend', fmt: (v) => USD(v as number) },
              { key: 'cost_per_sale', label: 'Cost / sale', bold: true, fmt: (v) => USD(v as number) },
              { key: 'close_rate', label: 'Close rate', fmt: (v) => PCT(v as number, 1) },
            ]} />
          ) : <p className="empty">Waiting on wheeler_reports_sales data for these dates.</p>}
        </Card>
      </div>
    </>
  );
}

export function ReportBodyFallback() {
  return (
    <div className="wr-report-pending" aria-busy="true">
      <div className="kpis">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="kpi">
            <div className="wr-skel" style={{ width: 72, height: 10, marginBottom: 10 }} />
            <div className="wr-skel" style={{ width: 110, height: 22 }} />
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="bar">
          <div className="wr-skel" style={{ width: 160, height: 12 }} />
        </div>
        <div className="body">
          <div className="wr-skel" style={{ width: '100%', height: 180 }} />
        </div>
      </div>
    </div>
  );
}
