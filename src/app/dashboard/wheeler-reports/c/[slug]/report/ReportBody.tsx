import Table, { Card } from '@/components/dashboard/wheeler-reports/Table';
import LeadCountLink from '@/components/dashboard/wheeler-reports/LeadCountLink';
import { userClient } from '@/lib/wheelerReports/supabase/server';
import { loadReportRows } from '@/lib/wheelerReports/data';
import { buildReport } from '@/lib/wheelerReports/report';
import { SHARED_LABEL } from '@/lib/wheelerReports/campaigns';
import { SOURCE_COLUMNS } from '@/lib/wheelerReports/leadSources';
import { monthName, rangeLabel } from '@/lib/wheelerReports/dates';
import { NUM, PCT, USD, USD2 } from '@/lib/wheelerReports/format';
import { leadsHref, type LeadsHrefFilters } from '@/lib/wheelerReports/leadsHref';
import { filterRowsByLocation } from '@/lib/wheelerReports/filterByLocation';

function link(slug: string, from: string, to: string, count: unknown, filters: LeadsHrefFilters = {}, enabled = true) {
  const label = NUM(count as number);
  if (!enabled) return label;
  return <LeadCountLink href={leadsHref(slug, from, to, filters)}>{label}</LeadCountLink>;
}

function storeFilter(store: unknown): { filters: LeadsHrefFilters; ok: boolean } {
  const s = String(store ?? '');
  if (!s || s === SHARED_LABEL) return { filters: {}, ok: false };
  return { filters: { store: s }, ok: true };
}

/** Heavy tables — streamed under Suspense so the report shell paints immediately. */
export default async function ReportBody({
  clientId,
  slug,
  from,
  to,
  locations = [],
}: {
  clientId: string;
  slug: string;
  from: string;
  to: string;
  /** Selected store names; empty = all locations. */
  locations?: string[];
}) {
  const sb = await userClient();
  const raw = await loadReportRows(sb, clientId, from, to);
  const rows = filterRowsByLocation(raw, locations);
  const r = buildReport({ ...rows, from, to });
  const k = r.kpis;
  const adsMonths = r.basis.filter((b) => b.kind === 'ads').map((b) => monthName(b.month).split(' ')[0]);
  const mediaMonths = r.basis.filter((b) => b.kind === 'media').map((b) => monthName(b.month).split(' ')[0]);
  const total = <T,>(list: T[]) => ({ rows: list.slice(0, -1), total: list[list.length - 1] });
  const locStore = locations.length === 1 ? locations[0] : undefined;
  const withLoc = (filters: LeadsHrefFilters): LeadsHrefFilters =>
    locStore && !filters.store ? { ...filters, store: locStore } : filters;
  const L = (count: unknown, filters: LeadsHrefFilters = {}, enabled = true) =>
    link(slug, from, to, count, withLoc(filters), enabled);

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
        <div className="kpi"><span className="v">{L(k.leads, { channel: 'all', store: 'All stores' })}</span><span className="l">Total leads</span></div>
        <div className="kpi"><span className="v">{k.sales == null ? '—' : NUM(k.sales)}</span><span className="l">Total sales</span>{k.sales == null && <span className="n">Waiting on wheeler_reports_sales data</span>}</div>
        <div className="kpi"><span className="v">{USD2(k.cost_per_lead)}</span><span className="l">Cost per lead</span></div>
        <div className="kpi"><span className="v">{k.cost_per_sale == null ? '—' : USD2(k.cost_per_sale)}</span><span className="l">Cost per sale</span>{k.sales == null && <span className="n">Waiting on wheeler_reports_sales data</span>}</div>
      </section>
      <section className="kpis ch" aria-label="Google Ads and Meta Ads">
        <div className="kpi"><span className="v">{k.google_spend == null ? '—' : USD(k.google_spend)}</span><span className="l">Google spend</span></div>
        <div className="kpi"><span className="v">{L(k.google_leads, { channel: 'google', store: 'All stores' })}</span><span className="l">Google leads</span></div>
        <div className="kpi"><span className="v">{k.google_cpl == null ? '—' : USD2(k.google_cpl)}</span><span className="l">Google cost per lead</span></div>
        <div className="kpi fb"><span className="v">{k.meta_spend == null ? '—' : USD(k.meta_spend)}</span><span className="l">Facebook spend</span>{k.meta_spend == null && <span className="n">Waiting on Meta Ads data</span>}</div>
        <div className="kpi fb"><span className="v">{L(k.meta_leads, { channel: 'facebook', store: 'All stores' })}</span><span className="l">Facebook leads</span></div>
        <div className="kpi fb"><span className="v">{k.meta_cpl == null ? '—' : USD2(k.meta_cpl)}</span><span className="l">Facebook cost per lead</span></div>
      </section>

      <div className="grid">
        <Card id="t-leads" title="1. Leads by store" sub="full source break-up, website leads — click any lead count" wide>
          <Table {...total(r.leadsByStore)} cols={[
            { key: 'store', label: 'Store', left: true },
            { key: 'total_spend', label: 'Total spend', fmt: (v) => USD2(v as number) },
            {
              key: 'leads', label: 'Leads', bold: true,
              fmt: (v, row) => { const s = storeFilter(row.store); return L(v, { ...s.filters, channel: 'all' }, s.ok || String(row.store) === 'All stores'); },
            },
            ...SOURCE_COLUMNS.map((c) => ({
              key: c.key,
              label: c.label,
              fmt: (v: unknown, row: Record<string, unknown>) => {
                const s = storeFilter(row.store);
                return L(v, { ...s.filters, channel: 'all', source: c.key }, s.ok || String(row.store) === 'All stores');
              },
            })),
            { key: 'share', label: '% of leads', fmt: (v) => PCT(v as number) },
          ]} />
        </Card>

        <Card id="t-fb" title="2. Facebook leads by store" sub="spend from Meta Ads — click a lead count">
          <Table {...total(r.metaByStore)} sharedLabel={SHARED_LABEL} cols={[
            { key: 'store', label: 'Store', left: true },
            { key: 'spend', label: 'Spend', fmt: (v) => USD2(v as number) },
            {
              key: 'leads', label: 'Leads', bold: true,
              fmt: (v, row) => { const s = storeFilter(row.store); return L(v, { ...s.filters, channel: 'facebook' }, s.ok || String(row.store) === 'All stores'); },
            },
            { key: 'cost_per_lead', label: 'Cost / lead', fmt: (v) => USD(v as number) },
          ]} />
        </Card>

        <Card id="t-google" title="3. Google leads by store" sub="spend, leads and cost per lead — click a lead count">
          <Table {...total(r.googleByStore)} sharedLabel={SHARED_LABEL} cols={[
            { key: 'store', label: 'Store', left: true },
            { key: 'spend', label: 'Spend', fmt: (v) => USD(v as number) },
            {
              key: 'leads', label: 'Leads', bold: true,
              fmt: (v, row) => { const s = storeFilter(row.store); return L(v, { ...s.filters, channel: 'google' }, s.ok || String(row.store) === 'All stores'); },
            },
            { key: 'cost_per_lead', label: 'Cost / lead', bold: true, fmt: (v) => USD(v as number) },
          ]} />
        </Card>

        <Card id="t-group" title="Google Ads by campaign group" sub="cost, traffic, impression share and leads — click a lead count" wide>
          <Table {...total(r.googleByGroup)} bodyScrollRows={10} cols={[
            { key: 'group', label: 'Campaign group', left: true },
            { key: 'campaigns', label: 'Campaigns', fmt: (v) => NUM(v as number) },
            { key: 'cost', label: 'Cost', fmt: (v) => USD(v as number) },
            { key: 'impressions', label: 'Impr.', fmt: (v) => NUM(v as number) },
            { key: 'clicks', label: 'Clicks', fmt: (v) => NUM(v as number) },
            { key: 'cpc', label: 'CPC', fmt: (v) => USD2(v as number) },
            { key: 'ctr', label: 'CTR', fmt: (v) => PCT(v as number, 1) },
            { key: 'search_is', label: 'Search IS', fmt: (v) => PCT(v as number, 1) },
            { key: 'leads', label: 'Leads', bold: true, fmt: (v, row) => L(v, { channel: 'google', group: String(row.group ?? '') }) },
            { key: 'cost_per_lead', label: 'Cost / lead', bold: true, fmt: (v) => USD2(v as number) },
          ]} />
        </Card>

        <Card id="t-fbc" title="Facebook by campaign" sub="Meta Ads spend and leads by campaign — click any lead count" wide>
          <Table {...total(r.metaByCampaign)} cols={[
            { key: 'campaign', label: 'Campaign', left: true },
            { key: 'type', label: 'Type', left: true },
            { key: 'spend', label: 'Spend', fmt: (v) => USD2(v as number) },
            { key: 'impressions', label: 'Impr.', fmt: (v) => NUM(v as number) },
            { key: 'clicks', label: 'Clicks', fmt: (v) => NUM(v as number) },
            { key: 'ctr', label: 'CTR', fmt: (v) => PCT(v as number, 1) },
            { key: 'platform_leads', label: 'Meta leads', fmt: (v, row) => L(v, { channel: 'facebook', campaign: String(row.campaign ?? '') }) },
            { key: 'leads', label: 'Website leads', bold: true, fmt: (v, row) => L(v, { channel: 'facebook', campaign: String(row.campaign ?? '') }) },
            { key: 'cost_per_lead', label: 'Cost / lead', fmt: (v) => USD2(v as number) },
            { key: 'price_unlock', label: 'Price unlock', fmt: (v, row) => L(v, { channel: 'facebook', campaign: String(row.campaign ?? ''), leadType: 'unlock_price' }) },
            { key: 'payment_calc', label: 'Payment calc', fmt: (v, row) => L(v, { channel: 'facebook', campaign: String(row.campaign ?? ''), leadType: 'financing' }) },
            { key: 'other_forms', label: 'Other forms', fmt: (v, row) => L(v, { channel: 'facebook', campaign: String(row.campaign ?? ''), leadType: 'other' }) },
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

        <Card id="t-form" title="4. Leads by form" sub="website form fills — click a lead count">
          <Table {...total(r.leadsByForm)} cols={[
            { key: 'form', label: 'Form', left: true },
            { key: 'leads', label: 'Leads', bold: true, fmt: (v, row) => L(v, { channel: 'all', form: String(row.form ?? '') }) },
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
