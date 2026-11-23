import Table, { Card } from '@/components/dashboard/wheeler-reports/Table';
import ReportNavLink from '@/components/dashboard/wheeler-reports/ReportNavLink';
import { requireClient } from '@/lib/wheelerReports/auth';
import { loadReportRows } from '@/lib/wheelerReports/data';
import { channelFor, googleGroupFor, SHARED_LABEL } from '@/lib/wheelerReports/campaigns';
import { formGroup, isGoogleAds, isMeta, sourceBucket, type SourceKey, SOURCE_COLUMNS } from '@/lib/wheelerReports/leadSources';
import { isISODate, rangeLabel } from '@/lib/wheelerReports/dates';
import { userClient } from '@/lib/wheelerReports/supabase/server';
import type { AdStat, Lead } from '@/lib/wheelerReports/types';

type SP = Promise<{
  from?: string;
  to?: string;
  store?: string;
  channel?: string;
  source?: string;
  form?: string;
  campaign?: string;
  group?: string;
  lead_type?: string;
}>;

const CHANNELS = {
  facebook: { label: 'Facebook', match: isMeta },
  google: { label: 'Google Ads', match: isGoogleAds },
  all: { label: 'All sources', match: () => true },
} as const;

type ChannelKey = keyof typeof CHANNELS;

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(SOURCE_COLUMNS.map((c) => [c.key, c.label]));

function leadName(contactName: string | undefined) {
  const n = (contactName || '').trim();
  return n || '—';
}

function resolveGoogleAd(campaign: string, google: AdStat[]) {
  const raw = campaign.trim();
  if (!raw) return null;
  const byId = google.find((a) => a.campaign_id === raw);
  if (byId) return byId;
  const low = raw.toLowerCase();
  return google.find((a) => a.campaign_name.toLowerCase() === low) ?? null;
}

function groupForLead(campaign: string, google: AdStat[]) {
  const ad = resolveGoogleAd(campaign, google);
  if (ad?.campaign_group) return ad.campaign_group;
  const raw = campaign.trim();
  if (raw.includes('|')) return googleGroupFor(raw, channelFor(raw));
  return null;
}

function campaignLabelOf(l: Lead, campaignNameById: Map<string, string>) {
  const camp = (l.campaign || '').trim();
  return (camp && campaignNameById.get(camp)) || camp || '';
}

export default async function ReportLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SP;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { client } = await requireClient(slug);

  const from = isISODate(sp.from) ? sp.from! : '';
  const to = isISODate(sp.to) ? sp.to! : '';
  const store = (sp.store || '').trim();
  const channelKey = (sp.channel && sp.channel in CHANNELS ? sp.channel : 'all') as ChannelKey;
  const channel = CHANNELS[channelKey];
  const sourceKey = (sp.source || '').trim() as SourceKey | '';
  const form = (sp.form || '').trim();
  const campaign = (sp.campaign || '').trim();
  const group = (sp.group || '').trim();
  const leadType = (sp.lead_type || '').trim();

  const reportHref = `/dashboard/wheeler-reports/c/${slug}/report${from && to ? `?from=${from}&to=${to}` : ''}`;

  if (!from || !to) {
    return (
      <main className="wrap">
        <header className="head">
          <div>
            <h1>{client.name} | Leads</h1>
            <p className="sub">Pick a date range on the report, then open a lead count.</p>
          </div>
          <ReportNavLink className="btn ghost" href={reportHref}>← Back to report</ReportNavLink>
        </header>
        <p className="empty">Missing date range.</p>
      </main>
    );
  }

  const sb = await userClient();
  const { stores, leads, ads } = await loadReportRows(sb, client.id, from, to);
  const nameOf = (id: string | null) => stores.find((s) => s.id === id)?.name ?? SHARED_LABEL;
  const google = ads.filter((a) => a.platform === 'google');

  const campaignNameById = new Map<string, string>();
  for (const a of ads) {
    if (!a.campaign_id || !a.campaign_name) continue;
    if (!campaignNameById.has(a.campaign_id)) campaignNameById.set(a.campaign_id, a.campaign_name);
  }

  const filtered = leads
    .filter(channel.match)
    .filter((l) => {
      if (!store || store === 'All stores') return true;
      return nameOf(l.store_id) === store;
    })
    .filter((l) => !sourceKey || sourceBucket(l) === sourceKey)
    .filter((l) => {
      if (!form || form === 'All forms') return true;
      return formGroup(l.form) === form;
    })
    .filter((l) => {
      if (!campaign || campaign === 'All Facebook') return true;
      const label = campaignLabelOf(l, campaignNameById);
      return label === campaign || l.campaign === campaign;
    })
    .filter((l) => {
      if (!group || group === 'All campaigns') return true;
      return groupForLead(l.campaign, google) === group;
    })
    .filter((l) => {
      if (!leadType) return true;
      if (leadType === 'unlock_price') return l.lead_type === 'unlock_price';
      if (leadType === 'financing') return l.lead_type === 'financing';
      if (leadType === 'other') return l.lead_type !== 'unlock_price' && l.lead_type !== 'financing';
      return true;
    })
    .sort((a, b) => (a.lead_date < b.lead_date ? 1 : a.lead_date > b.lead_date ? -1 : 0));

  const namedCount = filtered.filter((l) => (l.contact_name || '').trim()).length;
  const rows = filtered.map((l) => {
    const camp = (l.campaign || '').trim();
    const campaignLabel = (camp && campaignNameById.get(camp)) || camp || '—';
    return {
      name: leadName(l.contact_name),
      date: l.lead_date,
      store: nameOf(l.store_id),
      form: l.form || '—',
      source: l.source || '—',
      medium: l.medium || '—',
      campaign: campaignLabel,
      type: l.lead_type || '—',
    };
  });

  const bits = [
    channel.label,
    store || null,
    sourceKey ? (SOURCE_LABEL[sourceKey] || sourceKey) : null,
    form && form !== 'All forms' ? form : null,
    campaign && campaign !== 'All Facebook' ? campaign : null,
    group && group !== 'All campaigns' ? group : null,
    leadType === 'unlock_price' ? 'Price unlock' : leadType === 'financing' ? 'Payment calc' : leadType === 'other' ? 'Other forms' : null,
    rangeLabel(from, to),
    `${rows.length} lead${rows.length === 1 ? '' : 's'}`,
  ].filter(Boolean);
  const needsNames = rows.length > 0 && namedCount === 0;

  return (
    <main className="wrap wr-leads-page">
      <header className="head">
        <div>
          <h1>{client.name} | Leads</h1>
          <p className="sub">{bits.join(' · ')}</p>
        </div>
        <ReportNavLink className="btn ghost" href={reportHref}>← Back to report</ReportNavLink>
      </header>

      {needsNames && (
        <div className="alert" role="note">
          Person names are not available for these leads — they come from GA4/Meta counts, which do not include contact name.
          To show names, upload the Scout lead export on Data &amp; sync (First Name / Last Name).
        </div>
      )}

      <Card id="leads-list" title="Leads" sub={bits.slice(0, -2).join(' · ') || 'All'} wide>
        <Table
          rows={rows}
          empty="No website leads for this filter and date range."
          bodyScrollRows={18}
          cols={[
            { key: 'name', label: 'Name', left: true, bold: true },
            { key: 'date', label: 'Date', left: true },
            { key: 'store', label: 'Store', left: true },
            { key: 'form', label: 'Form', left: true },
            { key: 'source', label: 'Source', left: true },
            { key: 'medium', label: 'Medium', left: true },
            { key: 'campaign', label: 'Campaign', left: true },
            { key: 'type', label: 'Type', left: true },
          ]}
        />
      </Card>
    </main>
  );
}
