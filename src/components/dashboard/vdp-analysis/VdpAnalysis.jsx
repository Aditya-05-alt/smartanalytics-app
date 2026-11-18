'use client';

import { useEffect, useMemo, useState } from 'react';
import CalendarRangePicker, { resolveRangePickerValue } from '../CalendarRangePicker';
import FilterDropdown from '../FilterDropdown';
import styles from './VdpAnalysis.module.css';

/** Channel groups as returned by get_vdp_analysis (same names and colors as Event Tracking). */
const CHANNELS = [
  { key: 'PSo', name: 'Paid Social', color: '#D9822B' },
  { key: 'PS', name: 'Paid Search', color: '#2F6FB1' },
  { key: 'OS', name: 'Organic Search', color: '#5FA01F' },
  { key: 'DI', name: 'Direct', color: '#6B7280' },
  { key: 'CN', name: 'Cross-network', color: '#8A5CB8' },
  { key: 'SO', name: 'Organic Social', color: '#E8B04A' },
  { key: 'RE', name: 'Referral', color: '#2E9C9C' },
  { key: 'OT', name: 'Other', color: '#B8BEC9' },
];

const CONDITION_OPTIONS = [
  { value: 'all', label: 'New + Used' },
  { value: 'N', label: 'New' },
  { value: 'U', label: 'Used' },
];

/** Earliest month with VDP Analysis tables; latest = UTC today − 2 (same settle as daily sync). */
const RANGE_MIN = '2026-10-01';
function settledMaxIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}
const RANGE_MAX = settledMaxIso();
const DEFAULT_RANGE = {
  preset: 'custom',
  start: `${RANGE_MAX.slice(0, 8)}01`,
  end: RANGE_MAX,
};
const clampDate = (date) => (date < RANGE_MIN ? RANGE_MIN : date > RANGE_MAX ? RANGE_MAX : date);

const INVENTORY_FILTERS = [
  { key: 'all', label: 'All units' },
  { key: 'dep', label: 'One channel 70%+' },
  { key: 'zero', label: 'No VDP views' },
  { key: 'low', label: 'Bottom 10%' },
];

const fmt = (value) => Math.round(Number(value) || 0).toLocaleString('en-US');
const pct = (value) => `${Math.round(Number(value) || 0)}%`;
const ratio = (value, total) => (total ? value / total : 0);
const filterByCondition = (units, condition) =>
  units.filter((unit) => condition === 'all' || unit.condition === condition);

/** API dealer payload -> units in the shape the tables use. */
function toDealerInventory(payload) {
  const units = (payload?.units || []).map((unit, index) => {
    const channelViews = CHANNELS.map((channel) => Number(unit.channels?.[channel.name]) || 0);
    const views = channelViews.reduce((sum, value) => sum + value, 0);
    const maxChannelViews = Math.max(...channelViews);
    return {
      id: unit.id,
      vin: unit.vin,
      url: unit.url,
      condition: unit.condition === 'N' ? 'N' : 'U',
      year: unit.year || '',
      make: unit.make || '',
      model: unit.model || '',
      days: Number(unit.daysInStock) || Number(unit.daysListed) || 0,
      daysListed: Number(unit.daysListed) || 0,
      channelViews,
      views,
      topChannel: views ? channelViews.indexOf(maxChannelViews) : -1,
      topShare: views ? (maxChannelViews / views) * 100 : 0,
      channelCount: channelViews.filter(Boolean).length,
      unitIndex: index,
    };
  });
  const pageViews = payload?.channelPageViews || {};
  return {
    units,
    snapshotDays: Number(payload?.snapshotDays) || 0,
    unmatchedViews: Number(payload?.viewsUnmatched) || 0,
    connerFrom: payload?.connerFrom || null,
    pageViewShare: CHANNELS.map((channel) =>
      ratio(Number(pageViews[channel.name]?.vdp) || 0, Number(pageViews[channel.name]?.all) || 0)
    ),
  };
}

/** `snapshotDays` turns unit-days in the feed into average daily in-stock units. */
function getStats(units, snapshotDays) {
  const count = units.length;
  const inStock = snapshotDays
    ? units.reduce((sum, unit) => sum + unit.daysListed, 0) / snapshotDays
    : count;
  const views = units.reduce((sum, unit) => sum + unit.views, 0);
  const viewed = units.filter((unit) => unit.views > 0).length;
  const sortedViews = units.map((unit) => unit.views).sort((a, b) => a - b);
  const median = sortedViews[Math.floor(count / 2)] || 0;
  const dependent = units.filter((unit) => unit.views >= 10 && unit.topShare >= 70).length;
  const topCount = Math.ceil(count * 0.2);
  const topViews = sortedViews.slice(-topCount).reduce((sum, value) => sum + value, 0);
  return {
    count,
    inStock,
    views,
    viewed,
    zero: count - viewed,
    median,
    perUnit: ratio(views, inStock),
    dependent,
    topShare: ratio(topViews, views) * 100,
  };
}

function Kpis({ stats, extra }) {
  const cards = [
    { label: 'In-stock units', value: fmt(stats.inStock), detail: `Average daily, from feed · ${fmt(stats.count)} listed in range` },
    { label: 'VDP views', value: fmt(stats.views), detail: extra || 'On in-stock units' },
    {
      label: 'VDP views per in-stock unit',
      value: fmt(stats.perUnit),
      detail: `Median unit: ${fmt(stats.median)}`,
    },
    {
      label: 'Units with a VDP view',
      value: pct(ratio(stats.viewed, stats.count) * 100),
      detail: `${fmt(stats.viewed)} of ${fmt(stats.count)} units listed`,
    },
    {
      label: 'Units with no VDP views',
      value: fmt(stats.zero),
      detail: `${pct(ratio(stats.zero, stats.count) * 100)} of units listed`,
    },
    { label: 'Top 20% of units get', value: pct(stats.topShare), detail: 'Of all VDP views' },
  ];

  return (
    <div className={styles.kpis}>
      {cards.map((card) => (
        <article className={styles.kpi} key={card.label}>
          <div className={styles.kpiLabel}>{card.label}</div>
          <div className={styles.kpiValue}>{card.value}</div>
          <div className={styles.kpiDetail}>{card.detail}</div>
        </article>
      ))}
    </div>
  );
}

/** Must match the fixed row heights in .tableScrollLimited (VdpAnalysis.module.css). */
const HEAD_ROW_HEIGHT = 30;
const BODY_ROW_HEIGHT = 38;

/** limitRows: show that many body rows (plus the total row) and scroll the rest under a pinned header. */
function Table({ children, className = '', limitRows = 0, headRows = 1 }) {
  const style = limitRows
    ? { maxHeight: headRows * HEAD_ROW_HEIGHT + (limitRows + 1) * BODY_ROW_HEIGHT }
    : undefined;
  return (
    <div className={`${styles.tableScroll} ${limitRows ? styles.tableScrollLimited : ''}`} style={style}>
      <table className={`${styles.table} ${className}`}>{children}</table>
    </div>
  );
}

function SplitHead({ labels }) {
  return (
    <thead>
      <tr>
        <th className={styles.first} rowSpan={2}>{labels[0]}</th>
        {labels.slice(1).map((label) => <th className={styles.groupHead} colSpan={2} key={label}>{label}</th>)}
      </tr>
      <tr>{labels.slice(1).flatMap((label) => [
        <th key={`${label}-new`}>New</th>,
        <th key={`${label}-used`}>Used</th>,
      ])}</tr>
    </thead>
  );
}

function Pair({ newValue, usedValue, format = fmt }) {
  return (
    <>
      <td className={styles.pairStart}>{format(newValue)}</td>
      <td>{format(usedValue)}</td>
    </>
  );
}

function Panel({ title, description, action, children, className = '' }) {
  return (
    <section className={`${styles.panel} ${className}`}>
      <header className={styles.panelHeader}>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function MixBar({ unit }) {
  return (
    <div className={styles.mixBar}>
      {unit.channelViews.map((views, index) => views > 0 && (
        <span
          key={CHANNELS[index].key}
          title={`${CHANNELS[index].name}: ${fmt(views)}`}
          style={{ width: `${ratio(views, unit.views) * 100}%`, background: CHANNELS[index].color }}
        />
      ))}
    </div>
  );
}

function DetailInsights({ stats, reach, units }) {
  const social = reach.find((item) => item.channel.key === 'PSo');
  const organic = reach.find((item) => item.channel.key === 'OS');
  const search = reach.find((item) => item.channel.key === 'PS');
  const count = units.length;
  const insights = [];

  if (social && ratio(social.views, stats.views) > 0.25) {
    insights.push({
      tone: 'warning',
      icon: '!',
      title: `Paid Social delivers ${pct(ratio(social.views, stats.views) * 100)} of VDP views and leads on ${fmt(social.lead)} units (${pct(ratio(social.lead, count) * 100)} of the lot)`,
      detail: `Its views are concentrated on units the catalog ads push: ${fmt(social.perReached)} views per unit it reaches, against ${fmt(search?.perReached || 0)} for Paid Search. ${pct(social.pageViewShare * 100)} of Paid Social page views are VDPs.`,
    });
  }
  insights.push({
    tone: 'warning',
    icon: '%',
    title: `${fmt(stats.dependent)} units (${pct(ratio(stats.dependent, count) * 100)}) get 70%+ of their views from one channel`,
    detail: 'If that channel pauses or its budget moves, those units lose most of their exposure. Use the "One channel 70%+" filter below to see them.',
  });
  if (stats.zero) {
    const longStockNoViews = units.filter((unit) => !unit.views && unit.days > 14).length;
    insights.push({
      tone: 'bad',
      icon: '0',
      title: `${fmt(stats.zero)} in-stock units had no VDP views`,
      detail: `${fmt(longStockNoViews)} have been in stock for more than 14 days. Check that they are live on the site and in the ad feeds.`,
    });
  }
  if (organic) {
    insights.push({
      tone: 'info',
      icon: '↗',
      title: `Organic Search reached ${pct(ratio(organic.reached, count) * 100)} of the lot`,
      detail: `Units it never reached (${fmt(count - organic.reached)}) are worth checking for thin or duplicate VDP content.`,
    });
  }
  insights.push({
    tone: 'info',
    icon: '≈',
    title: `Top 20% of units take ${pct(stats.topShare)} of VDP views`,
    detail: `The median unit got ${fmt(stats.median)} views against an average of ${fmt(stats.perUnit)}.`,
  });

  return (
    <div className={styles.insights}>
      {insights.map((item, index) => (
        <article className={`${styles.insight} ${styles[`insight_${item.tone}`]}`} key={`${item.icon}-${index}`}>
          <span className={styles.insightIcon}>{item.icon}</span>
          <div><strong>{item.title}</strong><span>{item.detail}</span></div>
        </article>
      ))}
    </div>
  );
}

const EMPTY_INVENTORY = toDealerInventory(null);
/** Table rows shown before the table scrolls. */
const VISIBLE_ROWS = 15;

/** One condition bucket from get_vdp_analysis_summary, in the shape getStats() returns. */
function fromSummary(stats) {
  const inStock = Number(stats?.inStock) || 0;
  const views = Number(stats?.views) || 0;
  return {
    count: Number(stats?.count) || 0,
    inStock,
    views,
    viewed: Number(stats?.viewed) || 0,
    zero: Number(stats?.zero) || 0,
    median: Number(stats?.median) || 0,
    dependent: Number(stats?.dependent) || 0,
    topShare: Number(stats?.topShare) || 0,
    perUnit: ratio(views, inStock),
    topChannel: CHANNELS.find((channel) => channel.name === stats?.topChannel) || CHANNELS[CHANNELS.length - 1],
    topChannelShare: Number(stats?.topChannelShare) || 0,
  };
}

/** Each load is one request with no progress events, so the percent eases toward 95% until it finishes. */
function useLoadPercent(active) {
  const [percent, setPercent] = useState(0);
  useEffect(() => {
    if (!active) {
      setPercent(100);
      return undefined;
    }
    setPercent(0);
    const timer = setInterval(() => {
      setPercent((value) => Math.min(95, value + Math.max(0.5, (95 - value) * 0.08)));
    }, 120);
    return () => clearInterval(timer);
  }, [active]);
  return Math.round(percent);
}

async function fetchVdpAnalysis(params) {
  const response = await fetch(`/api/dashboard/vdp-analysis?${new URLSearchParams(params)}`, { credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `VDP Analysis request failed (${response.status})`);
  return result;
}

export default function VdpAnalysis() {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const resolvedRange = resolveRangePickerValue(range);
  const from = clampDate(resolvedRange?.start || RANGE_MIN);
  const to = clampDate(resolvedRange?.end || RANGE_MAX);
  const [summary, setSummary] = useState({ dealers: [], total: null });
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [detail, setDetail] = useState({ key: '', inventory: EMPTY_INVENTORY });
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  /** Selected dealer's GA4 client id; '' = All dealers. */
  const [dealer, setDealer] = useState('');
  const [condition, setCondition] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('');
  const [sort, setSort] = useState({ key: 'views', direction: -1 });

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError('');
    fetchVdpAnalysis({ from, to })
      .then((result) => { if (!cancelled) setSummary({ dealers: result.dealers || [], total: result.total || null }); })
      .catch((error) => { if (!cancelled) setSummaryError(error?.message || 'Failed to load VDP Analysis'); })
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const detailKey = dealer ? `${dealer}|${from}|${to}` : '';
  useEffect(() => {
    if (!detailKey) return undefined;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError('');
    fetchVdpAnalysis({ clientId: dealer, from, to })
      .then((result) => { if (!cancelled) setDetail({ key: detailKey, inventory: toDealerInventory(result) }); })
      .catch((error) => { if (!cancelled) setDetailError(error?.message || 'Failed to load dealer'); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [dealer, detailKey, from, to]);

  const loading = summaryLoading || (Boolean(dealer) && detailLoading);
  const loadPercent = useLoadPercent(loading);
  const loadError = summaryError || (dealer ? detailError : '');
  const dealerInventory = dealer && detail.key === detailKey ? detail.inventory : EMPTY_INVENTORY;
  const dealerName = summary.dealers.find((item) => item.clientId === dealer)?.name || dealer;
  const dealerOptions = useMemo(() => [
    { value: 'All', label: 'All Dealers' },
    ...summary.dealers.map((item) => ({ value: item.clientId, label: item.name })),
  ], [summary]);

  const currentUnits = useMemo(
    () => (dealer ? filterByCondition(dealerInventory.units, condition) : []),
    [condition, dealer, dealerInventory]
  );
  const stats = useMemo(
    () => (dealer ? getStats(currentUnits, dealerInventory.snapshotDays) : fromSummary(summary.total?.[condition])),
    [condition, currentUnits, dealer, dealerInventory, summary]
  );
  const dealerRows = useMemo(() => summary.dealers
    .map((item) => ({ clientId: item.clientId, name: item.name, ...fromSummary(item.stats?.[condition]) }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.perUnit - a.perUnit), [condition, summary]);

  const reach = useMemo(() => CHANNELS.map((channel, index) => {
    const reachedUnits = currentUnits.filter((unit) => unit.channelViews[index] > 0);
    const views = reachedUnits.reduce((sum, unit) => sum + unit.channelViews[index], 0);
    return {
      channel,
      index,
      reached: reachedUnits.length,
      views,
      perReached: ratio(views, reachedUnits.length),
      lead: currentUnits.filter((unit) => unit.views > 0 && ratio(unit.channelViews[index], unit.views) >= 0.5).length,
      pageViewShare: dealerInventory.pageViewShare[index] || 0,
    };
  }).filter((item) => item.views > 0).sort((a, b) => b.reached - a.reached), [currentUnits, dealerInventory]);

  const filteredUnits = useMemo(() => {
    let rows = [...currentUnits];
    const bottomThreshold = [...rows].sort((a, b) => a.views - b.views)[Math.floor(rows.length * 0.1)]?.views || 0;
    if (unitFilter === 'dep') rows = rows.filter((unit) => unit.views >= 10 && unit.topShare >= 70);
    if (unitFilter === 'zero') rows = rows.filter((unit) => unit.views === 0);
    if (unitFilter === 'low') rows = rows.filter((unit) => unit.views > 0 && unit.views <= bottomThreshold);
    if (channelFilter !== '') {
      rows = rows.filter((unit) => unit.views && ratio(unit.channelViews[Number(channelFilter)], unit.views) >= 0.5);
    }
    const sortValue = {
      views: (unit) => unit.views,
      days: (unit) => unit.days,
      channels: (unit) => unit.channelCount,
      share: (unit) => unit.topShare,
      perDay: (unit) => ratio(unit.views, unit.daysListed),
    }[sort.key];
    return rows.sort((a, b) => (sortValue(a) - sortValue(b)) * sort.direction);
  }, [channelFilter, currentUnits, sort, unitFilter]);

  function chooseDealer(name) {
    setDealer(name);
    setUnitFilter('all');
    setChannelFilter('');
  }

  function toggleSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key ? -current.direction : -1,
    }));
  }

  function downloadUnits() {
    const rows = [
      ['Condition', 'Year', 'Make', 'Model', 'Unit ID', 'Days in stock', 'VDP views', 'Views per day', 'Channels', 'Top channel share'],
      ...filteredUnits.map((unit) => [
        unit.condition === 'N' ? 'New' : 'Used',
        unit.year,
        unit.make,
        unit.model,
        unit.id,
        unit.days,
        unit.views,
        ratio(unit.views, unit.daysListed).toFixed(1),
        unit.channelCount,
        `${unit.topShare.toFixed(1)}%`,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${dealerName}-vdp-analysis-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderSplitTable() {
    if (!dealer) {
      const totalNew = fromSummary(summary.total?.N);
      const totalUsed = fromSummary(summary.total?.U);
      return (
        <Table limitRows={VISIBLE_ROWS} headRows={2}>
          <SplitHead labels={['Dealer', 'In-stock units', 'VDP views', 'VDP views / unit', 'Units with 0 views']} />
          <tbody>
            {summary.dealers.map((item) => {
              const newStats = fromSummary(item.stats?.N);
              const usedStats = fromSummary(item.stats?.U);
              return (
                <tr key={item.clientId}>
                  <td className={styles.first}><button className={styles.rowLink} onClick={() => chooseDealer(item.clientId)}>{item.name}</button></td>
                  <Pair newValue={newStats.inStock} usedValue={usedStats.inStock} />
                  <Pair newValue={newStats.views} usedValue={usedStats.views} />
                  <Pair newValue={newStats.perUnit} usedValue={usedStats.perUnit} format={(value) => <strong>{fmt(value)}</strong>} />
                  <Pair newValue={newStats.zero} usedValue={usedStats.zero} />
                </tr>
              );
            })}
            <tr className={styles.totalRow}>
              <td className={styles.first}>All dealers ({fmt(summary.dealers.length)})</td>
              <Pair newValue={totalNew.inStock} usedValue={totalUsed.inStock} />
              <Pair newValue={totalNew.views} usedValue={totalUsed.views} />
              <Pair newValue={totalNew.perUnit} usedValue={totalUsed.perUnit} />
              <Pair newValue={totalNew.zero} usedValue={totalUsed.zero} />
            </tr>
          </tbody>
        </Table>
      );
    }

    const newUnits = dealerInventory.units.filter((unit) => unit.condition === 'N');
    const usedUnits = dealerInventory.units.filter((unit) => unit.condition === 'U');
    const newStats = getStats(newUnits, dealerInventory.snapshotDays);
    const usedStats = getStats(usedUnits, dealerInventory.snapshotDays);
    return (
      <Table>
        <SplitHead labels={['Channel', 'VDP views', 'Units reached', '% of units reached', 'VDP views / unit']} />
        <tbody>
          {CHANNELS.map((channel, index) => {
            const newViews = newUnits.reduce((sum, unit) => sum + unit.channelViews[index], 0);
            const usedViews = usedUnits.reduce((sum, unit) => sum + unit.channelViews[index], 0);
            if (!newViews && !usedViews) return null;
            const newReached = newUnits.filter((unit) => unit.channelViews[index] > 0).length;
            const usedReached = usedUnits.filter((unit) => unit.channelViews[index] > 0).length;
            return (
              <tr key={channel.key}>
                <td className={styles.first}><ChannelMark channel={channel} />{channel.name}</td>
                <Pair newValue={newViews} usedValue={usedViews} />
                <Pair newValue={newReached} usedValue={usedReached} />
                <Pair newValue={ratio(newReached, newUnits.length) * 100} usedValue={ratio(usedReached, usedUnits.length) * 100} format={pct} />
                <Pair newValue={ratio(newViews, newStats.inStock)} usedValue={ratio(usedViews, usedStats.inStock)} />
              </tr>
            );
          })}
          <tr className={styles.totalRow}>
            <td className={styles.first}>All channels</td>
            <Pair newValue={newStats.views} usedValue={usedStats.views} />
            <Pair newValue={newStats.viewed} usedValue={usedStats.viewed} />
            <Pair newValue={ratio(newStats.viewed, newStats.count) * 100} usedValue={ratio(usedStats.viewed, usedStats.count) * 100} format={pct} />
            <Pair newValue={newStats.perUnit} usedValue={usedStats.perUnit} />
          </tr>
        </tbody>
      </Table>
    );
  }

  function renderAllDealers() {
    const totals = stats;

    return (
      <Panel title="VDP views per in-stock unit — all dealers" description={`${fmt(dealerRows.length)} dealers with inventory feed data. Select a dealer to see every unit.`} action={<span className={styles.badge}>Inventory from feed · average daily in-stock</span>}>
        <Table limitRows={VISIBLE_ROWS}>
          <thead><tr>
            <th className={styles.first}>Dealer</th><th>In-stock units</th><th>VDP views</th><th>VDP views / unit</th><th>Median views / unit</th><th>Units viewed</th><th>Units with 0 views</th><th>Top 20% of units get</th><th>Units 70%+ one channel</th><th className={styles.alignLeft}>Largest channel</th>
          </tr></thead>
          <tbody>
            {dealerRows.map((row) => (
              <tr key={row.clientId} className={styles.clickableRow} onClick={() => chooseDealer(row.clientId)}>
                <td className={styles.first}><button className={styles.rowLink} onClick={() => chooseDealer(row.clientId)}>{row.name}</button></td>
                <td>{fmt(row.inStock)}</td><td>{fmt(row.views)}</td><td><strong>{fmt(row.perUnit)}</strong></td><td>{fmt(row.median)}</td>
                <td>{pct(ratio(row.viewed, row.count) * 100)}</td><td>{fmt(row.zero)}</td><td>{pct(row.topShare)}</td><td>{pct(ratio(row.dependent, row.count) * 100)}</td>
                <td className={styles.alignLeft}><span className={styles.channelFlag} style={{ background: `${row.topChannel.color}2E`, borderColor: `${row.topChannel.color}80` }}><i style={{ background: row.topChannel.color }} />{row.topChannel.name} · {pct(row.topChannelShare)}</span></td>
              </tr>
            ))}
            <tr className={styles.totalRow}>
              <td className={styles.first}>All dealers ({fmt(dealerRows.length)})</td><td>{fmt(totals.inStock)}</td><td>{fmt(totals.views)}</td><td>{fmt(totals.perUnit)}</td><td>{fmt(totals.median)}</td>
              <td>{pct(ratio(totals.viewed, totals.count) * 100)}</td><td>{fmt(totals.zero)}</td><td>{pct(totals.topShare)}</td><td>{pct(ratio(totals.dependent, totals.count) * 100)}</td><td />
            </tr>
          </tbody>
        </Table>
      </Panel>
    );
  }

  function renderDealerDetails() {
    const buckets = [
      { label: '0 views', count: currentUnits.filter((unit) => unit.views === 0).length, tone: 'zero' },
      { label: '1–25', count: currentUnits.filter((unit) => unit.views > 0 && unit.views <= 25).length, tone: 'low' },
      { label: '26–100', count: currentUnits.filter((unit) => unit.views > 25 && unit.views <= 100).length, tone: 'mid' },
      { label: '101–250', count: currentUnits.filter((unit) => unit.views > 100 && unit.views <= 250).length, tone: 'mid' },
      { label: '251–500', count: currentUnits.filter((unit) => unit.views > 250 && unit.views <= 500).length, tone: 'high' },
      { label: '501–1,000', count: currentUnits.filter((unit) => unit.views > 500 && unit.views <= 1000).length, tone: 'high' },
      { label: '1,000+', count: currentUnits.filter((unit) => unit.views > 1000).length, tone: 'high' },
    ];
    const maxBucket = Math.max(...buckets.map((bucket) => bucket.count), 1);
    const over100 = currentUnits.filter((unit) => unit.views > 100).length;

    return (
      <>
        <Panel title="Unique VDPs reached by channel" description="How many different in-stock units each channel brought a viewer to, and how much each channel leans on vehicle pages.">
          <Table>
            <thead><tr><th className={styles.first}>Channel</th><th>Units reached</th><th>% of inventory reached</th><th>VDP views</th><th>Share of VDP views</th><th>Views per unit reached</th><th>Lead channel on</th><th>VDP % of page views</th></tr></thead>
            <tbody>
              {reach.map((item) => (
                <tr key={item.channel.key}>
                  <td className={styles.first}><ChannelMark channel={item.channel} />{item.channel.name}</td>
                  <td><strong>{fmt(item.reached)}</strong></td><td>{pct(ratio(item.reached, currentUnits.length) * 100)}</td>
                  <td>{fmt(item.views)}</td><td>{pct(ratio(item.views, stats.views) * 100)}</td><td>{fmt(item.perReached)}</td><td>{fmt(item.lead)} units</td><td>{pct(item.pageViewShare * 100)}</td>
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <td className={styles.first}>All channels</td><td>{fmt(stats.viewed)}</td><td>{pct(ratio(stats.viewed, currentUnits.length) * 100)}</td>
                <td>{fmt(stats.views)}</td><td>100%</td><td>{fmt(ratio(stats.views, stats.viewed))}</td>
                <td>{fmt(currentUnits.filter((unit) => unit.views > 0 && unit.topShare >= 50).length)} units</td><td>—</td>
              </tr>
            </tbody>
          </Table>
          <div className={styles.notes}><strong>Units reached</strong> = distinct in-stock units with at least one VDP view from that channel. <strong>Lead channel on</strong> = units where that channel delivered 50%+ of its VDP views. <strong>VDP % of page views</strong> = the channel&apos;s VDP views ÷ all its page views.</div>
        </Panel>

        <div className={styles.twoColumn}>
          <Panel title="Units by VDP views" description="How evenly views spread across the lot." className={styles.histogramPanel}>
            <div className={styles.histogram}>
              {buckets.map((bucket) => (
                <div className={styles.histogramRow} key={bucket.label}>
                  <span className={styles.histogramLabel}>{bucket.label}</span>
                  <div className={styles.track}>
                    <span className={styles[`track_${bucket.tone}`]} style={{ width: `${Math.max(ratio(bucket.count, maxBucket) * 100, bucket.count ? 1.5 : 0)}%` }} />
                  </div>
                  <span className={styles.histogramCount}><strong>{fmt(bucket.count)}</strong> units <em>{pct(ratio(bucket.count, currentUnits.length) * 100)}</em></span>
                </div>
              ))}
            </div>
            <footer className={styles.histogramFooter}>
              <span>Median unit <strong>{fmt(stats.median)}</strong> views</span>
              <span><strong>{fmt(over100)}</strong> units ({pct(ratio(over100, currentUnits.length) * 100)}) above 100 views</span>
              <span><strong>{fmt(stats.zero)}</strong> with none</span>
            </footer>
          </Panel>
          <Panel title="What stands out" description="Generated from this dealer's numbers for the selected range.">
            <DetailInsights stats={stats} reach={reach} units={currentUnits} />
          </Panel>
        </div>

        <Panel
          title="Every unit"
          description={`${fmt(filteredUnits.length)} units match`}
          action={<button className={styles.exportButton} onClick={downloadUnits}>Download CSV</button>}
        >
          <div className={styles.unitTools}>
            <div className={styles.chips}>
              {INVENTORY_FILTERS.map((filter) => (
                <button key={filter.key} type="button" className={`${styles.chip} ${unitFilter === filter.key ? styles.chipSelected : ''}`} aria-pressed={unitFilter === filter.key} onClick={() => setUnitFilter(filter.key)}>{filter.label}</button>
              ))}
            </div>
            <select className={styles.select} value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} aria-label="Filter by leading channel">
              <option value="">Any channel</option>
              {reach.map((item) => <option value={item.index} key={item.channel.key}>Mostly {item.channel.name} (50%+)</option>)}
            </select>
          </div>
          <div className={styles.legend}>{CHANNELS.map((channel) => <span key={channel.key}><i style={{ background: channel.color }} />{channel.name}</span>)}</div>
          <Table>
            <thead><tr>
              <th className={`${styles.first} ${styles.alignLeft}`}>Unit</th>
              <SortableHeader label="Days in stock" sortKey="days" sort={sort} onSort={toggleSort} />
              <SortableHeader label="VDP views" sortKey="views" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Views / day listed" sortKey="perDay" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Channels" sortKey="channels" sort={sort} onSort={toggleSort} />
              <th className={styles.alignLeft}>Channel mix</th>
              <SortableHeader label="Top channel share" sortKey="share" sort={sort} onSort={toggleSort} />
              <th className={styles.alignLeft}>Flag</th>
            </tr></thead>
            <tbody>
              {filteredUnits.slice(0, 60).map((unit) => {
                const bottomThreshold = [...currentUnits].map((item) => item.views).sort((a, b) => a - b)[Math.floor(currentUnits.length * 0.1)] || 0;
                const flag = unit.views === 0
                  ? <span className={`${styles.flag} ${styles.flagZero}`}>No views</span>
                  : unit.views >= 10 && unit.topShare >= 70
                    ? <span className={`${styles.flag} ${styles.flagDependent}`}>{CHANNELS[unit.topChannel].name} {pct(unit.topShare)}</span>
                    : unit.views <= bottomThreshold
                      ? <span className={`${styles.flag} ${styles.flagLow}`}>Bottom 10%</span>
                      : null;
                return (
                  <tr key={`${unit.id}-${unit.unitIndex}`}>
                    <td className={styles.first}><span className={`${styles.condition} ${unit.condition === 'N' ? styles.conditionNew : styles.conditionUsed}`}>{unit.condition === 'N' ? 'NEW' : 'USED'}</span>{unit.year} {unit.make} {unit.model} <span className={styles.muted}>#{unit.id}</span></td>
                    <td>{unit.days}</td><td><strong>{fmt(unit.views)}</strong></td><td>{ratio(unit.views, unit.daysListed).toFixed(1)}</td><td>{unit.channelCount}</td>
                    <td className={styles.alignLeft}><MixBar unit={unit} /></td>
                    <td>{unit.views ? `${CHANNELS[unit.topChannel].name} · ${pct(unit.topShare)}` : '—'}</td><td className={styles.alignLeft}>{flag}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <footer className={styles.panelFooter}>{filteredUnits.length > 60 ? `Showing 60 of ${fmt(filteredUnits.length)} units. Download the CSV for the full list.` : `${fmt(filteredUnits.length)} units.`}</footer>
        </Panel>
        <div className={styles.notesPanel}>
          <strong>VDP views</strong> are Final VDP views (same VDP URL rules as the Overview page), matched to a unit by stock number. <strong>In-stock units</strong> = average units in the inventory feed per day across the range{dealerInventory.connerFrom ? ` (Hoot feed before ${dealerInventory.connerFrom}, Conner from then on)` : ''}. <strong>VDP views per in-stock unit</strong> = VDP views on in-stock units ÷ in-stock units. Views on units not in the feed that day ({fmt(dealerInventory.unmatchedViews)}) are counted separately so they don&apos;t inflate the ratio. Channels split each page&apos;s views by its GA4 channel mix. <strong>Days in stock</strong> = days since the unit first appeared in the feed.
        </div>
      </>
    );
  }

  return (
    <div className={styles.root} aria-busy={loading}>
      {loading && (
        <div
          className={`adc-table-overlay ${styles.loadingOverlay}`}
          role="status"
          aria-live="polite"
          aria-label={`Loading ${loadPercent}%`}
        >
          <div className="adc-table-loader dealer-compare-loader">
            <span className="adc-table-spinner" aria-hidden />
            <span className="adc-table-loader-text">Loading {loadPercent}%</span>
          </div>
        </div>
      )}
      <div className="filters">
        <span className="f-label">Filter</span>
        <FilterDropdown
          options={dealerOptions}
          value={dealer || 'All'}
          onChange={(value) => chooseDealer(value === 'All' ? '' : value)}
        />
        <FilterDropdown
          options={CONDITION_OPTIONS}
          defaultAll="all"
          value={condition}
          onChange={setCondition}
        />
        <div className="f-right">
          <span className="f-label">Date range</span>
          <CalendarRangePicker value={range} onChange={setRange} minDate={RANGE_MIN} maxDate={RANGE_MAX} />
        </div>
      </div>
      {loading && (
        <div className="adc-nav-progress" role="progressbar" aria-label="Loading" aria-busy="true">
          <div className="adc-nav-progress-bar" />
        </div>
      )}

      <div className={`content ${styles.page}`}>
      <div className={styles.heading}>
        <div>
          <h1>VDP Analysis{dealer ? ` — ${dealerName}` : ''}</h1>
          <p>{dealer ? 'Every in-stock unit: VDP views by channel and how concentrated they are.' : 'VDP views measured against in-stock inventory from each dealer\u2019s feed.'}</p>
        </div>
      </div>
      {loadError && <p className={styles.statusNote} role="alert">Could not load VDP Analysis: {loadError}</p>}

      <Kpis stats={stats} extra={dealer ? `${fmt(dealerInventory.unmatchedViews)} more on sold / unmatched URLs` : undefined} />

      <Panel
        title={dealer ? `New vs Used by channel — ${dealerName}` : 'New vs Used — all dealers'}
        description={dealer ? `${fmt(dealerInventory.units.filter((unit) => unit.condition === 'N').length)} new and ${fmt(dealerInventory.units.filter((unit) => unit.condition === 'U').length)} used units listed in range.` : 'Inventory and VDP views for new and used units side by side.'}
        action={<span className={styles.badge}>Always shows both · ignores the New/Used switch</span>}
      >
        {renderSplitTable()}
      </Panel>

      {dealer ? renderDealerDetails() : renderAllDealers()}
      </div>
    </div>
  );
}

function ChannelMark({ channel }) {
  return <span className={styles.channelMark} style={{ background: channel.color }} aria-hidden="true" />;
}

function SortableHeader({ label, sortKey, sort, onSort }) {
  return (
    <th className={styles.sortable} aria-sort={sort.key === sortKey ? (sort.direction < 0 ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => onSort(sortKey)}>{label}{sort.key === sortKey ? (sort.direction < 0 ? ' ▾' : ' ▴') : ''}</button>
    </th>
  );
}
