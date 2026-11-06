'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CalendarRangePicker, { resolveRangePickerValue } from '../CalendarRangePicker';
import styles from './EventTracking.module.css';

/** Combined channel groups (same set and colors as VDP Analysis); anything else is Other. */
const CHANNEL_GROUPS = [
  { name: 'Paid Search', color: '#2F6FB1' },
  { name: 'Organic Search', color: '#5FA01F' },
  { name: 'Paid Social', color: '#D9822B' },
  { name: 'Direct', color: '#6B7280' },
  { name: 'Cross-network', color: '#8A5CB8' },
  { name: 'Organic Social', color: '#E8B04A' },
  { name: 'Referral', color: '#2E9C9C' },
  { name: 'Other', color: '#B8BEC9' },
];
const CHANNELS = CHANNEL_GROUPS.map((group) => group.name);
const CHANNEL_COLORS = Object.fromEntries(CHANNEL_GROUPS.map((group) => [group.name, group.color]));

function channelGroup(channel) {
  return CHANNELS.includes(channel) ? channel : 'Other';
}

/** First day with Event Tracking data; the picker runs from here to today. */
const MIN_DATE = '2026-10-01';
/** The dealer table scrolls after this many rows. */
const DEALER_ROWS_SHOWN = 15;
const DEALER_COLUMNS = [
  { key: 'name', label: 'Dealer' },
  { key: 'users', label: 'Users' },
  { key: 'views', label: 'VDP views' },
  { key: 'events', label: 'Form events' },
  { key: 'vdpPerEvent', label: 'VDP / Event' },
  { key: 'eventPct', label: 'Event %' },
];

const EVENT_TYPES = [
  'contact_us_submit',
  'check_availability_submit',
  'trade_value_submit',
  'financing_submit',
  'other_form_submit',
  'custom_form_submit',
  'parts_submit',
  'service_submit',
];
const MISSING_USERS_LISTED = 5;

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/** "October 2026" for a whole calendar month, otherwise "Oct 1 – Nov 5, 2026". */
function rangeLabelOf(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  if (start.getDate() === 1 && isoDate(monthEnd) === to) {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(start);
  }
  const short = (date, withYear) =>
    date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  if (from === to) return short(start, true);
  return `${short(start, start.getFullYear() !== end.getFullYear())} – ${short(end, true)}`;
}

/** API dealer -> combined channel groups in the [value, 0, 0] series shape used below. */
function toDealerData(apiDealer) {
  const usersByGroup = {};
  const viewsByGroup = {};
  for (const row of apiDealer.rows || []) {
    const group = channelGroup(row.name);
    usersByGroup[group] = (usersByGroup[group] || 0) + (Number(row.users) || 0);
    viewsByGroup[group] = (viewsByGroup[group] || 0) + (Number(row.views) || 0);
  }
  const eventsByChannel = Object.fromEntries(
    CHANNELS.map((group) => [
      group,
      Object.fromEntries(EVENT_TYPES.map((type) => [type, [0, 0, 0]])),
    ])
  );
  for (const [channel, counts] of Object.entries(apiDealer.eventsByChannel || {})) {
    const group = eventsByChannel[channelGroup(channel)];
    for (const type of EVENT_TYPES) group[type][0] += Number(counts?.[type]) || 0;
  }

  const rows = CHANNELS.map((group) => ({
    name: group,
    users: [usersByGroup[group] || 0, 0, 0],
    views: [viewsByGroup[group] || 0, 0, 0],
    events: [EVENT_TYPES.reduce((sum, type) => sum + eventsByChannel[group][type][0], 0), 0, 0],
  }));

  return {
    name: apiDealer.name,
    rows,
    eventsByChannel,
    eventTotals: Object.fromEntries(
      EVENT_TYPES.map((type) => [type, [Number(apiDealer.eventTotals?.[type]) || 0, 0, 0]])
    ),
  };
}

function sumSeries(series) {
  return [series.reduce((sum, values) => sum + (Number(values?.[0]) || 0), 0), 0, 0];
}

function aggregateEvents(eventsByChannel, channelName = '') {
  const totals = Object.fromEntries(EVENT_TYPES.map((type) => [type, [0, 0, 0]]));
  Object.entries(eventsByChannel).forEach(([channel, events]) => {
    if (channelName && channel !== channelName) return;
    EVENT_TYPES.forEach((type) => {
      events[type].forEach((value, period) => {
        totals[type][period] += value;
      });
    });
  });
  return totals;
}

// Per-event totals straight from the totals RPC; falls back to summing the channel split.
function dealerEventTotals(dealer) {
  return dealer.eventTotals || aggregateEvents(dealer.eventsByChannel);
}

function aggregateDealerEvents(dealers, channelName = '') {
  const totals = Object.fromEntries(EVENT_TYPES.map((type) => [type, [0, 0, 0]]));
  dealers.forEach((dealer) => {
    Object.entries(dealer.eventsByChannel).forEach(([channel, events]) => {
      if (channelName && channel !== channelName) return;
      EVENT_TYPES.forEach((type) => {
        events[type].forEach((value, period) => {
          totals[type][period] += value;
        });
      });
    });
  });
  return totals;
}

function sumEventTypes(eventTotals, selectedEvent = '') {
  const eventTypes = selectedEvent ? [selectedEvent] : EVENT_TYPES;
  return [0, 1, 2].map((period) =>
    eventTypes.reduce((sum, type) => sum + eventTotals[type][period], 0)
  );
}

function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function formatRatio(value) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function EventCell({ values, onClick }) {
  return (
    <td className={`${styles.numeric} ${styles.currentCell}`}>
      <button type="button" className={styles.eventLink} onClick={onClick}>
        {formatNumber(values[0])}
      </button>
    </td>
  );
}

export default function EventTracking() {
  const maxDate = useMemo(() => isoDate(new Date()), []);
  // Default: the last 5 complete days, which the daily crons pre-load (forms, users, VDP).
  const [range, setRange] = useState(() => {
    const day = (offset) => {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      return isoDate(date);
    };
    return { preset: 'custom', start: day(5), end: day(1) };
  });
  const resolvedRange = resolveRangePickerValue(range);
  const from = resolvedRange?.start && resolvedRange.start > MIN_DATE ? resolvedRange.start : MIN_DATE;
  const to = resolvedRange?.end && resolvedRange.end < maxDate ? resolvedRange.end : maxDate;
  const rangeLabel = rangeLabelOf(from, to);
  const [dealerSort, setDealerSort] = useState({ key: 'events', dir: 'desc' });
  const dealerScrollRef = useRef(null);
  const [dealerScrollHeight, setDealerScrollHeight] = useState(null);
  const [dealerName, setDealerName] = useState('');
  const [channelName, setChannelName] = useState('');
  const [eventType, setEventType] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsChannel, setDetailsChannel] = useState('');
  const [dealerData, setDealerData] = useState([]);
  const [dealerTableMetrics, setDealerTableMetrics] = useState({});
  const [dataLoading, setDataLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState({ percent: 0, step: '' });
  const [dataError, setDataError] = useState('');
  const [usersMissingFor, setUsersMissingFor] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setDataLoading(true);
    setDataError('');
    const report = (percent, step) => {
      if (!cancelled) setLoadProgress({ percent: Math.round(percent), step });
    };
    const fetchJson = async (url, init) => {
      const response = await fetch(url, { credentials: 'same-origin', ...init });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Event Tracking request failed (${response.status})`);
      }
      return result;
    };
    (async () => {
      try {
        const query = new URLSearchParams({ from, to });

        // Progress: users check 0-5%, GA4 users per chunk 5-85%, dashboard data to 100%.
        report(0, 'Checking GA4 users…');
        const { missing = [], chunkSize = 10 } = await fetchJson(
          `/api/dashboard/event-tracking/users?${query}`
        );
        report(5, 'Checking GA4 users…');
        if (missing.length) {
          const chunks = [];
          for (let i = 0; i < missing.length; i += chunkSize) {
            chunks.push(missing.slice(i, i + chunkSize));
          }
          let done = 0;
          report(5, `Fetching GA4 users for ${missing.length} dealers…`);
          await Promise.all(
            chunks.map(async (clientIds) => {
              await fetchJson(`/api/dashboard/event-tracking/users?${query}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientIds }),
              }).catch(() => null);
              done += 1;
              report(5 + (80 * done) / chunks.length, `Fetching GA4 users for ${missing.length} dealers…`);
            })
          );
        }
        if (cancelled) return;

        report(missing.length ? 88 : 30, 'Loading users, VDP views and form events…');
        const result = await fetchJson(`/api/dashboard/event-tracking?${query}`);
        report(100, 'Done');
        const loaded = Array.isArray(result.dealers) ? result.dealers : [];
        if (cancelled) return;
        setDealerData(loaded.map(toDealerData));
        setDealerTableMetrics(
          Object.fromEntries(
            loaded.map((dealer) => [
              dealer.name,
              { users: Number(dealer.users) || 0, views: Number(dealer.views) || 0 },
            ])
          )
        );
        setUsersMissingFor(loaded.filter((dealer) => dealer.usersMissing).map((d) => d.name));
      } catch (error) {
        if (!cancelled) setDataError(error?.message || 'Failed to load Event Tracking data');
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const availableDealerNames = useMemo(() => dealerData.map((dealer) => dealer.name), [dealerData]);
  const selectedDealer = dealerData.find((dealer) => dealer.name === dealerName);
  const dealers = useMemo(
    () => (selectedDealer ? [selectedDealer] : dealerData),
    [dealerData, selectedDealer]
  );
  const allRows = useMemo(() => {
    const rowsByChannel = new Map();
    dealers.forEach((dealer) => {
      dealer.rows.forEach((row) => {
        const existing = rowsByChannel.get(row.name);
        if (!existing) {
          rowsByChannel.set(row.name, {
            name: row.name,
            users: [...row.users],
            views: [...row.views],
            events: [...row.events],
          });
          return;
        }
        ['users', 'views', 'events'].forEach((metric) => {
          row[metric].forEach((value, period) => {
            existing[metric][period] += value;
          });
        });
      });
    });
    return [...rowsByChannel.values()];
  }, [dealers]);

  const eventTotalsByChannel = useMemo(() => {
    const totals = {};
    allRows.forEach((row) => {
      totals[row.name] = aggregateDealerEvents(dealers, row.name);
    });
    return totals;
  }, [allRows, dealers]);

  const visibleRows = channelName
    ? allRows.filter((row) => row.name === channelName)
    : allRows;
  const channelEvents = useMemo(
    () => aggregateDealerEvents(dealers, channelName),
    [channelName, dealers]
  );
  const eventValues = sumEventTypes(channelEvents, eventType);
  const dealerSummary = dealers.reduce(
    (totals, dealer) => {
      const metrics = dealerTableMetrics[dealer.name];
      totals.users += metrics?.users || 0;
      totals.views += metrics?.views || 0;
      return totals;
    },
    { users: 0, views: 0 }
  );
  const summaryUserValues = [dealerSummary.users, 0, 0];
  const summaryViewValues = [dealerSummary.views, 0, 0];
  const viewValues = sumSeries(visibleRows.map((row) => row.views));
  const channelUserValues = sumSeries(allRows.map((row) => row.users));
  const userValues = channelName
    ? sumSeries(visibleRows.map((row) => row.users))
    : summaryUserValues;
  const eventChannelNames = allRows.map((row) => row.name);
  const detailsData = useMemo(() => {
    return aggregateDealerEvents(dealers, detailsChannel || channelName);
  }, [channelName, dealers, detailsChannel]);
  const detailChannels = detailsChannel || channelName
    ? [detailsChannel || channelName]
    : eventChannelNames;
  const detailEvents = sumEventTypes(detailsData);
  const channelRows = visibleRows;
  const dealerRows = useMemo(() => {
    if (dealerName) return [];
    return dealerData.map((dealer) => {
      const metrics = dealerTableMetrics[dealer.name] || { users: 0, views: 0 };
      const views = [metrics.views, 0, 0];
      const eventsByType = channelName
        ? aggregateEvents(dealer.eventsByChannel, channelName)
        : dealerEventTotals(dealer);
      const events = sumEventTypes(eventsByType, eventType);
      const users = [metrics.users, 0, 0];
      return {
        dealer,
        users,
        views,
        events,
        sortValues: {
          name: dealer.name,
          users: users[0],
          views: views[0],
          events: events[0],
          // No events / no views: the ratio is meaningless, so it sorts last either way.
          vdpPerEvent: events[0] > 0 ? views[0] / events[0] : null,
          eventPct: views[0] > 0 ? events[0] / views[0] : null,
        },
      };
    });
  }, [channelName, dealerData, dealerName, dealerTableMetrics, eventType]);
  const sortedDealerRows = useMemo(() => {
    const { key, dir } = dealerSort;
    const sign = dir === 'asc' ? 1 : -1;
    return [...dealerRows].sort((a, b) => {
      const av = a.sortValues[key];
      const bv = b.sortValues[key];
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      const diff = key === 'name' ? String(av).localeCompare(String(bv)) : av - bv;
      return sign * diff || a.dealer.name.localeCompare(b.dealer.name);
    });
  }, [dealerRows, dealerSort]);
  const sortDealersBy = (key) =>
    setDealerSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' }
    );

  // Cap the dealer table at DEALER_ROWS_SHOWN rows using the rendered header/row heights.
  useLayoutEffect(() => {
    const scroller = dealerScrollRef.current;
    const header = scroller?.querySelector('thead');
    const row = scroller?.querySelector('tbody tr');
    if (!header || !row) return;
    setDealerScrollHeight(header.offsetHeight + row.offsetHeight * DEALER_ROWS_SHOWN + 1);
  }, [dealerRows.length, dataLoading]);

  const openDetails = (channel = '') => {
    setDetailsChannel(channel);
    setDetailsOpen(true);
  };
  const chooseDealer = (name) => {
    setDealerName(name);
    setChannelName('');
    setDetailsChannel('');
  };

  const metrics = [
    { label: 'Users', values: summaryUserValues, formatter: formatNumber },
    { label: 'VDP views', values: summaryViewValues, formatter: formatNumber },
    { label: 'Form events', values: eventValues, formatter: formatNumber, clickable: true },
    {
      label: 'VDP views per event',
      values: viewValues.map((value, period) => ratio(value, eventValues[period])),
      formatter: formatRatio,
    },
    {
      label: 'Event % of VDP',
      values: viewValues.map((value, period) =>
        value > 0 ? (eventValues[period] / value) * 100 : 0
      ),
      formatter: formatPercent,
    },
  ];

  return (
    <div className={styles.page} aria-busy={dataLoading}>
      {dataLoading && (
        <div className={styles.loadingOverlay} role="status" aria-live="polite">
          <div className={styles.loadingCard}>
            <span className={styles.spinner} aria-hidden="true" />
            <strong>Loading {rangeLabel}… {loadProgress.percent}%</strong>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={loadProgress.percent}
            >
              <div className={styles.progressFill} style={{ width: `${loadProgress.percent}%` }} />
            </div>
            <span>{loadProgress.step || 'Starting…'}</span>
            <span className={styles.loadingHint}>
              A new date range can take up to ~20 seconds the first time.
            </span>
          </div>
        </div>
      )}
      <div className={styles.toolbar}>
        <label className={styles.selectWrap}>
          <span className={styles.srOnly}>Dealer</span>
          <select
            className={styles.select}
            value={dealerName}
            onChange={(event) => chooseDealer(event.target.value)}
          >
            <option value="">All Dealers</option>
            {availableDealerNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className={styles.selectWrap}>
          <span className={styles.srOnly}>Channel</span>
          <select
            className={styles.select}
            value={channelName}
            onChange={(event) => setChannelName(event.target.value)}
          >
            <option value="">All Channels</option>
            {CHANNELS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className={styles.selectWrap}>
          <span className={styles.srOnly}>Form event</span>
          <select
            className={styles.select}
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
          >
            <option value="">All Form Events</option>
            {EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <div className={styles.periods}>
          <span className={styles.periodLabel}>Reporting period</span>
          <CalendarRangePicker
            value={range}
            onChange={setRange}
            minDate={MIN_DATE}
            maxDate={maxDate}
          />
        </div>
      </div>

      <header className={styles.heading}>
        <div>
          <h1>Event Tracking{dealerName ? ` — ${dealerName}` : ''}</h1>
          <p>
            Users, VDP views and form events by channel.{' '}
            <span className={styles.sampleLabel}>
              {dataLoading
                ? 'Loading Event Tracking data…'
                : `${rangeLabel} · ${dealerData.length} dealers · Users: GA4 total users · VDP: smart_final_data`}
            </span>
          </p>
        </div>
        {dealerName && (
          <button type="button" className={styles.backButton} onClick={() => chooseDealer('')}>
            ← All dealers
          </button>
        )}
      </header>

      {dataError && (
        <p className={styles.dataError} role="alert">
          Could not load Event Tracking data: {dataError}
        </p>
      )}
      {!dataLoading && usersMissingFor.length > 0 && (
        <p className={styles.dataError} role="alert">
          GA4 total users could not be loaded for {usersMissingFor.length} dealer(s) (
          {usersMissingFor.slice(0, MISSING_USERS_LISTED).join(', ')}
          {usersMissingFor.length > MISSING_USERS_LISTED ? ', …' : ''}) for {rangeLabel}.
          Reload the page to retry.
        </p>
      )}

      <section className={styles.kpis} aria-label="Event tracking summary">
        {metrics.map((metric, index) => (
          <button
            type="button"
            key={metric.label}
            className={`${styles.kpi} ${index > 2 ? styles.kpiHighlighted : ''} ${
              metric.clickable ? styles.kpiClickable : ''
            }`}
            onClick={metric.clickable ? () => openDetails(channelName) : undefined}
            disabled={!metric.clickable}
          >
            <span className={styles.kpiLabel}>{metric.label}</span>
            <span className={styles.kpiValue}>
              {metric.formatter(metric.values[0] ?? 0)}
            </span>
            <span className={styles.kpiHint}>{rangeLabel}</span>
            {metric.clickable && <span className={styles.kpiHint}>See events by type ›</span>}
          </button>
        ))}
      </section>

      {detailsOpen && (
        <section className={styles.card} aria-label="Form event details">
          <div className={styles.cardHeader}>
            <div>
              <h2>Form events by type{dealerName ? ` — ${dealerName}` : ''}</h2>
              <p>{rangeLabel}</p>
            </div>
            <div className={styles.detailControls}>
              <label className={styles.selectWrap}>
                <span className={styles.srOnly}>Filter event details by channel</span>
                <select
                  className={styles.select}
                  value={detailsChannel}
                  onChange={(event) => setDetailsChannel(event.target.value)}
                >
                  <option value="">All Channels</option>
                  {eventChannelNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setDetailsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>{rangeLabel}</th>
                </tr>
              </thead>
              <tbody>
                {EVENT_TYPES.filter((type) => !eventType || eventType === type)
                  .sort((a, b) => detailsData[b][0] - detailsData[a][0])
                  .map((type) => {
                    const values = detailsData[type];
                    return (
                      <tr key={type}>
                        <th scope="row" className={styles.rowLabel}><code>{type}</code></th>
                        <td className={styles.currentCell}>{formatNumber(values[0])}</td>
                      </tr>
                    );
                  })}
                <tr className={styles.totalRow}>
                  <th scope="row" className={styles.rowLabel}>All form events</th>
                  <td>{formatNumber(detailEvents[0])}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.subsectionHeader}>
            <h3>Event × channel — {rangeLabel}</h3>
          </div>
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.matrix}`}>
              <thead>
                <tr>
                  <th>Event</th>
                  {detailChannels.map((name) => <th key={name}>{name}</th>)}
                </tr>
              </thead>
              <tbody>
                {EVENT_TYPES.filter((type) => !eventType || eventType === type).map((type) => (
                  <tr key={type}>
                    <th scope="row" className={styles.rowLabel}><code>{type}</code></th>
                    {detailChannels.map((name) => {
                      const values = dealers.reduce(
                        (sum, dealer) => {
                          const series = dealer.eventsByChannel[name]?.[type] || [0, 0, 0];
                          series.forEach((value, period) => { sum[period] += value; });
                          return sum;
                        },
                        [0, 0, 0]
                      );
                      return <MatrixCell key={name} values={values} />;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!dealerName && !channelName && (
            <>
              <div className={styles.subsectionHeader}>
                <h3>Dealer × event — {rangeLabel}</h3>
                <span className={styles.badge}>Select a dealer to see its channels</span>
              </div>
              <div className={styles.tableScroll}>
                <table className={`${styles.table} ${styles.matrix}`}>
                  <thead>
                    <tr>
                      <th>Dealer</th>
                      {EVENT_TYPES.filter((type) => !eventType || eventType === type).map((type) => (
                        <th key={type}>{type.replace('_submit', '')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dealerData.map((dealer) => {
                      const totals = dealerEventTotals(dealer);
                      return (
                        <tr key={dealer.name}>
                          <th scope="row" className={styles.rowLabel}>
                            <button
                              type="button"
                              className={styles.rowButton}
                              onClick={() => chooseDealer(dealer.name)}
                            >
                              {dealer.name}
                            </button>
                          </th>
                          {EVENT_TYPES.filter((type) => !eventType || eventType === type).map((type) => (
                            <MatrixCell key={type} values={totals[type]} />
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className={styles.notes}>
            Form events are GA4 submit events (smart_events_data), counted by the session channel.
          </p>
        </section>
      )}

      {!dealerName && (
        <section className={`${styles.card} ${styles.dealerCard}`}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Dealers — {rangeLabel}</h2>
              <p>
                {dealerRows.length} dealers · Click a column to sort · Select a dealer to see its
                channels
              </p>
            </div>
            <span className={styles.badge}>{rangeLabel}</span>
          </div>
          <div
            ref={dealerScrollRef}
            className={styles.tableScroll}
            style={dealerScrollHeight ? { maxHeight: dealerScrollHeight } : undefined}
          >
            <table className={`${styles.table} ${styles.dealerTable}`}>
              <thead>
                <tr>
                  {DEALER_COLUMNS.map((column) => {
                    const active = dealerSort.key === column.key;
                    return (
                      <th
                        key={column.key}
                        aria-sort={
                          active ? (dealerSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button
                          type="button"
                          className={`${styles.sortButton} ${active ? styles.sortActive : ''}`}
                          onClick={() => sortDealersBy(column.key)}
                        >
                          {column.label}
                          <span className={styles.sortIcon} aria-hidden="true">
                            {active ? (dealerSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedDealerRows.map(({ dealer, users, views, events }) => (
                  <tr key={dealer.name}>
                    <th scope="row" className={styles.rowLabel}>
                      <button
                        type="button"
                        className={styles.rowButton}
                        onClick={() => chooseDealer(dealer.name)}
                      >
                        {dealer.name}
                      </button>
                    </th>
                    <td className={styles.numeric}>{formatNumber(users[0])}</td>
                    <td className={styles.numeric}>{formatNumber(views[0])}</td>
                    <td className={styles.numeric}>
                      <button
                        type="button"
                        className={styles.eventLink}
                        onClick={() => {
                          chooseDealer(dealer.name);
                          openDetails(channelName);
                        }}
                      >
                        {formatNumber(events[0])}
                      </button>
                    </td>
                    <td className={`${styles.numeric} ${styles.currentCell}`}>
                      {formatRatio(ratio(views[0], events[0]) ?? 0)}
                    </td>
                    <td className={styles.numeric}>
                      {views[0] > 0 ? formatPercent((events[0] / views[0]) * 100) : '0.00%'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Users, VDP views and events by channel — {dealerName || 'all dealers'}</h2>
            <p>Click a form-event value to see its breakdown</p>
          </div>
          <span className={styles.badge}>{rangeLabel}</span>
        </div>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.channelTable}`}>
            <thead>
              <tr>
                <th>Channel</th>
                <GroupHeader label={`Users · ${rangeLabel}`} />
                <GroupHeader label={`VDP views · ${rangeLabel}`} />
                <GroupHeader label={`Form events · ${rangeLabel}`} />
                <GroupHeader label="VDP / Event" highlight />
                <GroupHeader label="Event %" highlight />
              </tr>
            </thead>
            <tbody>
              {channelRows.map((row) => {
                const events = sumEventTypes(eventTotalsByChannel[row.name], eventType);
                const viewPerEvent = row.views.map((value, period) =>
                  ratio(value, events[period])
                );
                const eventPercent = row.views.map((value, period) =>
                  value > 0 ? (events[period] / value) * 100 : 0
                );
                return (
                  <tr key={row.name}>
                    <th scope="row" className={styles.rowLabel}>
                      <span
                        className={styles.channelSwatch}
                        style={{ background: CHANNEL_COLORS[row.name] }}
                        aria-hidden="true"
                      />
                      {row.name}
                    </th>
                    <SeriesCells values={row.users} formatter={formatNumber} />
                    <SeriesCells values={row.views} formatter={formatNumber} />
                    <EventCell
                      values={events}
                      onClick={() => openDetails(row.name)}
                    />
                    <SeriesCells
                      values={viewPerEvent}
                      formatter={formatRatio}
                      highlight
                    />
                    <SeriesCells values={eventPercent} formatter={formatPercent} highlight />
                  </tr>
                );
              })}
              <tr className={styles.totalRow}>
                <th scope="row" className={styles.rowLabel}>All channels</th>
                <SeriesCells values={userValues} formatter={formatNumber} />
                <SeriesCells values={viewValues} formatter={formatNumber} />
                <SeriesCells
                  values={eventValues}
                  formatter={formatNumber}
                  clickable
                  onClick={() => openDetails(channelName)}
                />
                <SeriesCells
                  values={viewValues.map((value, period) => ratio(value, eventValues[period]))}
                  formatter={formatRatio}
                  highlight
                />
                <SeriesCells
                  values={viewValues.map((value, period) =>
                    value > 0 ? (eventValues[period] / value) * 100 : 0
                  )}
                  formatter={formatPercent}
                  highlight
                />
              </tr>
              {!channelName && (
                <tr className={styles.sumRow}>
                  <th scope="row" className={styles.rowLabel}>Sum of channels (users)</th>
                  <td className={styles.numeric}>{formatNumber(channelUserValues[0])}</td>
                  <td colSpan="4" className={styles.noteCell}>
                    Channel users are GA4 total users per channel; one user can appear in more
                    than one channel, so channels can add up to more than the overall total.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={styles.notes}>
          <b>VDP / Event</b> = VDP views divided by form events (lower is better).{' '}
          <b>Event %</b> = form events divided by VDP views. Users are GA4 total users
          for the selected period (not summed across pages or days). Form events come from GA4 submit events.
        </p>
      </section>

    </div>
  );
}

function GroupHeader({ label, highlight = false }) {
  return (
    <th className={`${styles.groupHeader} ${highlight ? styles.groupHighlight : ''}`}>
      {label}
    </th>
  );
}

function SeriesCells({ values, formatter, highlight = false, clickable = false, onClick }) {
  const value = values[0] ?? 0;
  return (
    <td
      className={`${styles.numeric} ${styles.currentCell} ${
        highlight ? styles.highlightCell : ''
      }`}
    >
      {clickable ? (
        <button type="button" className={styles.eventLink} onClick={onClick}>
          {formatter(value)}
        </button>
      ) : (
        formatter(value)
      )}
    </td>
  );
}

function MatrixCell({ values }) {
  return <td className={styles.numeric}>{formatNumber(values[0])}</td>;
}
