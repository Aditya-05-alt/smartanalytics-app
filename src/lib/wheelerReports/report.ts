// Builds every table of the monthly marketing report for a date range.
// Pure function: give it the rows, get the numbers. Covered by tests/report.test.ts.
//
// Spend rules
// - Every spend row (ad platform, media, other cost) is spread evenly over the days it covers,
//   and only the part inside the selected dates counts.
// - Total spend for a month = that month's media spend per store, when it has been entered,
//   otherwise Google Ads + Meta Ads spend. Client "other costs" are added on top either way.
import { daysIncl, monthEnd, monthsIn, overlapDays, prorate } from './dates';
import { SHARED_LABEL, channelFor, googleGroupFor } from './campaigns';
import { SOURCE_COLUMNS, type SourceKey, formGroup, isExcludedLeadSource, isGoogleAds, isMeta, sourceBucket } from './leadSources';
import type { AdStat, Lead, MediaSpend, OtherCost, Sale, Store } from './types';

export type ReportInput = {
  stores: Pick<Store, 'id' | 'name' | 'sort'>[];
  leads: Lead[];
  ads: AdStat[];
  media: MediaSpend[];
  sales: Sale[];
  other: OtherCost[];
  from: string;
  to: string;
};

export const ALL = 'All stores';
export const UNASSIGNED = 'Unassigned store';

const div = (a: number, b: number) => (b ? a / b : null);
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);

export function buildReport(input: ReportInput) {
  const { from, to } = input;
  const stores = [...input.stores].sort((a, b) => a.sort - b.sort);
  const nameOf = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name ?? UNASSIGNED : UNASSIGNED);

  const leads = input.leads.filter((l) => l.lead_date >= from && l.lead_date <= to);
  const ads = input.ads.filter((a) => overlapDays(a.date_from, a.date_to, from, to) > 0);
  const share = (a: AdStat) => prorate(a.date_from, a.date_to, from, to);
  const google = ads.filter((a) => a.platform === 'google');
  const meta = ads.filter((a) => a.platform === 'meta');
  // Store list for tables: RV Trader is excluded from this pool; Unassigned only when
  // remaining leads (incl. Facebook) lack a store.
  const storeLeadPool = leads.filter((l) => !isExcludedLeadSource(l));
  const storeLabels = [...stores.map((s) => s.name), ...(storeLeadPool.some((l) => !l.store_id) ? [UNASSIGNED] : [])];

  // ----- Total spend by store, month by month ---------------------------------
  const spend: Record<string, number> = Object.fromEntries([...storeLabels, ALL].map((s) => [s, 0]));
  const basis: { month: string; kind: 'media' | 'ads' }[] = [];
  for (const m of monthsIn(from, to)) {
    const mEnd = monthEnd(m), mFrom = from > m ? from : m, mTo = to < mEnd ? to : mEnd;
    const monthShare = overlapDays(m, mEnd, mFrom, mTo) / daysIncl(m, mEnd);
    const media = input.media.filter((r) => r.month === m);
    if (media.length) {
      basis.push({ month: m, kind: 'media' });
      for (const r of media) { const v = r.amount * monthShare; spend[nameOf(r.store_id)] = (spend[nameOf(r.store_id)] || 0) + v; spend[ALL] += v; }
    } else {
      basis.push({ month: m, kind: 'ads' });
      for (const a of ads) {
        const v = a.cost * prorate(a.date_from, a.date_to, mFrom, mTo);
        if (!v) continue;
        if (a.store_id) spend[nameOf(a.store_id)] = (spend[nameOf(a.store_id)] || 0) + v;
        spend[ALL] += v;
      }
    }
    for (const c of input.other.filter((r) => r.month === m)) {
      const v = c.amount * monthShare;
      if (c.store_id) spend[nameOf(c.store_id)] = (spend[nameOf(c.store_id)] || 0) + v;
      spend[ALL] += v;
    }
  }

  // ----- Leads by store and source -------------------------------------------
  // RV Trader stays at 0 in this table; Facebook website leads are counted per store.
  const empty = () => Object.fromEntries(SOURCE_COLUMNS.map((c) => [c.key, 0])) as Record<SourceKey, number>;
  const bySource: Record<string, Record<SourceKey, number>> = Object.fromEntries([...storeLabels, ALL].map((s) => [s, empty()]));
  for (const l of storeLeadPool) {
    const k = sourceBucket(l);
    if (k === 'rv_trader') continue;
    bySource[nameOf(l.store_id)][k]++;
    bySource[ALL][k]++;
  }
  const leadCount = (s: string) => sum(SOURCE_COLUMNS as unknown as { key: SourceKey }[], (c) => bySource[s][c.key]);
  const leadsTotal = leadCount(ALL);
  const leadsByStore = [...storeLabels, ALL].map((s) => ({
    store: s, total_spend: spend[s] || 0, leads: leadCount(s), ...bySource[s], share: div(leadCount(s), leadsTotal) ?? 0,
  }));

  // ----- Google Ads by store -------------------------------------------------
  // Leads may carry either the Google campaign id or the campaign name (GA4/UTM).
  const googleById = new Map(google.map((a) => [a.campaign_id, a]));
  const googleByName = new Map<string, AdStat>();
  for (const a of google) {
    const key = a.campaign_name.trim().toLowerCase();
    if (key && !googleByName.has(key)) googleByName.set(key, a);
  }
  const resolveGoogleAd = (campaign: string) => {
    const raw = campaign.trim();
    if (!raw) return null;
    const exact = googleById.get(raw) ?? googleByName.get(raw.toLowerCase());
    if (exact) return exact;
    // Soft name match: lead tag is contained in an ads name, or the reverse.
    const low = raw.toLowerCase();
    if (!/^\d+$/.test(raw) && low.includes('|')) {
      for (const [name, ad] of googleByName) {
        if (name.includes(low) || low.includes(name)) return ad;
      }
    }
    return null;
  };
  const groupForLead = (campaign: string) => {
    const ad = resolveGoogleAd(campaign);
    if (ad?.campaign_group) return ad.campaign_group;
    const raw = campaign.trim();
    // Fall back to Wheeler naming convention when the lead only has a campaign name.
    if (raw.includes('|')) return googleGroupFor(raw, channelFor(raw));
    return null;
  };
  const sharedGoogle = new Set(google.filter((a) => !a.store_id).map((a) => a.campaign_id));
  const gLeads = leads.filter(isGoogleAds);
  const gStoreOf = (l: Lead) => {
    const ad = resolveGoogleAd(l.campaign);
    if (ad && sharedGoogle.has(ad.campaign_id)) return SHARED_LABEL;
    if (sharedGoogle.has(l.campaign)) return SHARED_LABEL;
    return nameOf(l.store_id);
  };
  const gLabels = [...stores.map((s) => s.name), ...(gLeads.some((l) => !l.store_id) ? [UNASSIGNED] : []), SHARED_LABEL];
  const googleByStore = [...gLabels, ALL].map((s) => {
    const sp = s === ALL ? sum(google, (a) => a.cost * share(a)) : sum(google.filter((a) => (a.store_id ? nameOf(a.store_id) : SHARED_LABEL) === s), (a) => a.cost * share(a));
    const n = s === ALL ? gLeads.length : gLeads.filter((l) => gStoreOf(l) === s).length;
    return { store: s, spend: sp, leads: n, cost_per_lead: div(sp, n) };
  }).filter((r) => r.store === ALL || r.store !== SHARED_LABEL || r.spend || r.leads);

  // ----- Google Ads by campaign group -----------------------------------------
  type Agg = { campaigns: Set<string>; cost: number; impressions: number; clicks: number; isImpr: number; isElig: number; leads: number };
  const newAgg = (): Agg => ({ campaigns: new Set(), cost: 0, impressions: 0, clicks: 0, isImpr: 0, isElig: 0, leads: 0 });
  const groups: Record<string, Agg> = {};
  const allG = newAgg();
  const addIS = (g: Agg, a: AdStat, f: number) => {
    const is = a.search_impression_share;
    if (is != null && is > 0) { g.isImpr += a.impressions * f; g.isElig += (a.impressions * f) / is; }
  };
  for (const a of google) {
    const f = share(a);
    for (const g of [groups[a.campaign_group] ??= newAgg(), allG]) {
      g.campaigns.add(a.campaign_id); g.cost += a.cost * f; g.impressions += a.impressions * f; g.clicks += a.clicks * f;
    }
    addIS(groups[a.campaign_group], a, f);
    if (a.channel === 'Search') addIS(allG, a, f);
  }
  for (const l of gLeads) {
    const g = groupForLead(l.campaign);
    if (g) (groups[g] ??= newAgg()).leads++;
    allG.leads++;
  }
  const groupRow = (group: string, g: Agg) => ({
    group, campaigns: g.campaigns.size, cost: g.cost, impressions: Math.round(g.impressions), clicks: Math.round(g.clicks),
    cpc: div(g.cost, g.clicks), ctr: div(g.clicks, g.impressions), search_is: g.isElig ? g.isImpr / g.isElig : null,
    leads: g.leads, cost_per_lead: div(g.cost, g.leads),
  });
  const googleByGroup = [
    ...Object.entries(groups).sort((a, b) => b[1].cost - a[1].cost).map(([k, g]) => groupRow(k, g)),
    groupRow('All campaigns', allG),
  ];

  // ----- Meta (Facebook / Instagram) -----------------------------------------
  const fbLeads = leads.filter(isMeta);
  const metaPlatformLeads = (rows: AdStat[]) =>
    Math.round(sum(rows, (a) => (a.platform_leads ?? 0) * share(a)));
  const metaHasPlatformLeads = meta.some((a) => (a.platform_leads ?? 0) > 0);
  const metaByStore = [...storeLabels, SHARED_LABEL, ALL].map((s) => {
    const rows = s === ALL ? meta : meta.filter((a) => (a.store_id ? nameOf(a.store_id) : SHARED_LABEL) === s);
    const sp = sum(rows, (a) => a.cost * share(a));
    // Prefer Meta platform lead actions when present (seed / API); else website Facebook leads.
    const n = metaHasPlatformLeads
      ? metaPlatformLeads(rows)
      : s === ALL
        ? fbLeads.length
        : s === SHARED_LABEL
          ? 0
          : fbLeads.filter((l) => nameOf(l.store_id) === s).length;
    return { store: s, spend: sp, leads: n, cost_per_lead: div(sp, n) };
  }).filter((r) => r.store !== SHARED_LABEL || r.spend);

  const typeOfLead = (l: Lead) => { const m = l.medium.toLowerCase(); return m === 'cpc' || m === 'paid' ? 'Paid' : m === 'referral' ? 'Referral' : 'Organic'; };
  type MetaAgg = { name: string; type: string; spend: number | null; impressions: number; clicks: number; platform_leads: number; leads: Lead[] };
  const camps = new Map<string, MetaAgg>();
  for (const a of meta) {
    const c = camps.get(a.campaign_id) ?? { name: a.campaign_name || 'Meta campaign ' + a.campaign_id, type: 'Paid', spend: 0, impressions: 0, clicks: 0, platform_leads: 0, leads: [] };
    const f = share(a);
    c.spend = (c.spend ?? 0) + a.cost * f; c.impressions += a.impressions * f; c.clicks += a.clicks * f; c.platform_leads += (a.platform_leads ?? 0) * f;
    camps.set(a.campaign_id, c);
  }
  // Map website FB leads onto Meta campaigns by campaign id, then by store's Meta campaign.
  const metaIdByStore = new Map<string, string>();
  for (const a of meta) {
    if (a.store_id && !metaIdByStore.has(a.store_id)) metaIdByStore.set(a.store_id, a.campaign_id);
  }
  for (const l of fbLeads) {
    const id = l.campaign.trim();
    const byStore = l.store_id ? metaIdByStore.get(l.store_id) : undefined;
    const key = id && camps.has(id) ? id : byStore && camps.has(byStore) ? byStore : id ? 'utm:' + id : 'none:' + typeOfLead(l);
    const c = camps.get(key) ?? {
      name: id ? (/^\d{6,}$/.test(id) ? 'Meta campaign ' + id : id) : typeOfLead(l) === 'Paid' ? 'Paid, no campaign tagged' : typeOfLead(l) === 'Referral' ? 'facebook.com referral' : 'Organic, no campaign tagged',
      type: typeOfLead(l), spend: null, impressions: 0, clicks: 0, platform_leads: 0, leads: [],
    };
    c.leads.push(l);
    camps.set(key, c);
  }
  const metaLeadCount = (c: Pick<MetaAgg, 'platform_leads' | 'leads'>) =>
    metaHasPlatformLeads ? Math.round(c.platform_leads) : c.leads.length;
  const metaRow = (c: Pick<MetaAgg, 'name' | 'type' | 'spend' | 'impressions' | 'clicks' | 'platform_leads' | 'leads'>) => {
    const leadN = metaLeadCount(c);
    return {
      campaign: c.name, type: c.type, spend: c.spend, impressions: Math.round(c.impressions), clicks: Math.round(c.clicks),
      ctr: div(c.clicks, c.impressions), cpc: c.spend == null ? null : div(c.spend, c.clicks), platform_leads: Math.round(c.platform_leads),
      leads: c.leads.length, share: div(c.leads.length, fbLeads.length) ?? 0,
      cost_per_lead: c.spend == null ? null : div(c.spend, leadN),
      price_unlock: c.leads.filter((l) => l.lead_type === 'unlock_price').length,
      payment_calc: c.leads.filter((l) => l.lead_type === 'financing').length,
      other_forms: c.leads.filter((l) => l.lead_type !== 'unlock_price' && l.lead_type !== 'financing').length,
    };
  };
  const metaList = [...camps.values()];
  const metaByCampaign = [
    ...metaList.map(metaRow).filter((r) => r.leads || r.spend || r.platform_leads).sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0) || b.leads - a.leads),
    metaRow({ name: 'All Facebook', type: '', spend: sum(meta, (a) => a.cost * share(a)), impressions: sum(metaList, (c) => c.impressions), clicks: sum(metaList, (c) => c.clicks), platform_leads: sum(metaList, (c) => c.platform_leads), leads: fbLeads }),
  ];

  // ----- Other costs -----------------------------------------------------------
  const otherRows = input.other
    .map((c) => ({ ...c, part: overlapDays(c.month, monthEnd(c.month), from, to) / daysIncl(c.month, monthEnd(c.month)) }))
    .filter((c) => c.part > 0);
  const otherStoreNames = [...new Set(otherRows.map((c) => (c.store_id ? nameOf(c.store_id) : ALL + ' (shared)')))]
    .sort((a, b) => storeLabels.indexOf(a) - storeLabels.indexOf(b));
  const otherByStore = [
    ...otherStoreNames.map((s) => {
      const cs = otherRows.filter((c) => (c.store_id ? nameOf(c.store_id) : ALL + ' (shared)') === s);
      return { store: s, entries: cs.length, amount: sum(cs, (c) => c.amount * c.part) };
    }),
    { store: ALL, entries: otherRows.length, amount: sum(otherRows, (c) => c.amount * c.part) },
  ];
  const otherTotal = sum(otherRows, (c) => c.amount * c.part);
  const heads = [...new Set(otherRows.map((c) => c.head))];
  const otherByHead = [
    ...heads.map((h) => {
      const cs = otherRows.filter((c) => c.head === h);
      const amount = sum(cs, (c) => c.amount * c.part);
      return { head: h, stores: new Set(cs.map((c) => c.store_id ?? 'all')).size, entries: cs.length, amount, share: div(amount, otherTotal) ?? 0 };
    }).sort((a, b) => b.amount - a.amount),
    { head: 'All cost heads', stores: new Set(otherRows.map((c) => c.store_id ?? 'all')).size, entries: otherRows.length, amount: otherTotal, share: otherTotal ? 1 : 0 },
  ];

  // ----- Leads by form ---------------------------------------------------------
  const forms = new Map<string, number>();
  for (const l of leads) forms.set(formGroup(l.form), (forms.get(formGroup(l.form)) || 0) + 1);
  const leadsByForm = [
    ...[...forms.entries()].sort((a, b) => b[1] - a[1]).map(([form, n]) => ({ form, leads: n, share: div(n, leads.length) ?? 0 })),
    { form: 'All forms', leads: leads.length, share: leads.length ? 1 : 0 },
  ];

  // ----- Sales -----------------------------------------------------------------
  // Sales entered for a period (usually a month) are spread evenly over it, like spend.
  const sales = input.sales.filter((s) => overlapDays(s.date_from, s.date_to, from, to) > 0);
  const salesShare = (s: Sale) => s.units * prorate(s.date_from, s.date_to, from, to);
  const salesByStore = [...stores.map((s) => s.name), ALL].map((s) => {
    const units = sum(sales.filter((x) => s === ALL || nameOf(x.store_id) === s), salesShare);
    return { store: s, units, total_spend: spend[s] || 0, cost_per_sale: div(spend[s] || 0, units), leads: leadCount(s), close_rate: div(units, leadCount(s)) };
  });

  // ----- Headline figures ------------------------------------------------------
  const gSpend = sum(google, (a) => a.cost * share(a));
  const mSpend = sum(meta, (a) => a.cost * share(a));
  const units = sum(sales, salesShare);
  const kpis = {
    total_spend: spend[ALL], leads: leadsTotal, cost_per_lead: div(spend[ALL], leadsTotal),
    sales: sales.length ? units : null, cost_per_sale: sales.length ? div(spend[ALL], units) : null,
    google_spend: google.length ? gSpend : null, google_leads: gLeads.length, google_cpl: google.length ? div(gSpend, gLeads.length) : null,
    meta_spend: meta.length ? mSpend : null,
    meta_leads: metaHasPlatformLeads ? metaPlatformLeads(meta) : fbLeads.length,
    meta_cpl: meta.length
      ? div(mSpend, metaHasPlatformLeads ? metaPlatformLeads(meta) : fbLeads.length)
      : null,
  };

  // What data the range has, so the page can say what is missing.
  const span = (rows: { date_from: string; date_to: string }[]) =>
    rows.length ? { from: rows.reduce((a, r) => (r.date_from < a ? r.date_from : a), rows[0].date_from), to: rows.reduce((a, r) => (r.date_to > a ? r.date_to : a), rows[0].date_to) } : null;
  const coverage = {
    google: span(google),
    meta: span(meta),
    leads: leads.length ? { from: leads.reduce((a, l) => (l.lead_date < a ? l.lead_date : a), leads[0].lead_date), to: leads.reduce((a, l) => (l.lead_date > a ? l.lead_date : a), leads[0].lead_date) } : null,
    sales: sales.length > 0,
  };

  return { from, to, basis, kpis, leadsByStore, googleByStore, googleByGroup, metaByStore, metaByCampaign, otherByStore, otherByHead, leadsByForm, salesByStore, coverage };
}

export type Report = ReturnType<typeof buildReport>;
