'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './EventTracking.module.css';

const CHANNELS = [
  'Organic Search',
  'Paid Search',
  'Direct',
  'Paid Social',
  'Paid Video',
  'Cross-network',
  'Organic Social',
  'Organic Video',
  'Referral',
  'Email',
  'Affiliates',
  'Paid Other',
  'AI Assistant',
  'Unassigned',
  'Display',
  'SMS',
  'Audio',
];

const DEALER_NAMES = [
  'Sky River RV',
  "Gerzeny's RV",
  'A&L RV Sales',
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
const ZERO_SERIES = [0, 0, 0];
const ZERO_DEALERS = DEALER_NAMES.map((name) => ({
  name,
  rows: CHANNELS.map((channelName) => ({
    name: channelName,
    users: [...ZERO_SERIES],
    views: [...ZERO_SERIES],
    events: [...ZERO_SERIES],
  })),
  totalUsers: [...ZERO_SERIES],
  eventsByChannel: Object.fromEntries(
    CHANNELS.map((channelName) => [
      channelName,
      Object.fromEntries(EVENT_TYPES.map((eventType) => [eventType, [...ZERO_SERIES]])),
    ])
  ),
}));

function dateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLastMonthDateRange(now = new Date()) {
  const lastMonthFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthTo = new Date(now.getFullYear(), now.getMonth(), 0);

  const from = dateOnly(lastMonthFrom);
  const to = dateOnly(lastMonthTo);

  // The aggregation RPC has three period slots; place the selected month in its first slot.
  return {
    currentFrom: from,
    currentTo: to,
    previousFrom: from,
    previousTo: to,
    averageFrom: from,
    averageTo: to,
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
  const now = new Date();
  const lastMonthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const [dealerName, setDealerName] = useState('');
  const [channelName, setChannelName] = useState('');
  const [eventType, setEventType] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsChannel, setDetailsChannel] = useState('');
  const [baseDealerData, setDealerData] = useState(ZERO_DEALERS);
  const [dealerTableMetrics, setDealerTableMetrics] = useState({});
  const [availableDealerNames, setAvailableDealerNames] = useState(DEALER_NAMES);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [channelRowsByDealer, setChannelRowsByDealer] = useState({});
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState('');
  const [usersMissingFor, setUsersMissingFor] = useState([]);
  const [eventsByDealer, setEventsByDealer] = useState({});
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams(getLastMonthDateRange());

    async function loadEvents() {
      try {
        const response = await fetch(`/api/dashboard/event-tracking/events?${query}`, {
          credentials: 'same-origin',
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || `Events request failed (${response.status})`);
        }
        const byDealer = Object.fromEntries(
          (Array.isArray(result.dealers) ? result.dealers : []).map((dealer) => [
            dealer.name,
            dealer,
          ])
        );
        if (!cancelled) setEventsByDealer(byDealer);
      } catch (error) {
        if (!cancelled) setEventsError(error?.message || 'Failed to load form events');
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    }

    async function loadChannels() {
      try {
        const response = await fetch(`/api/dashboard/event-tracking/channels?${query}`, {
          credentials: 'same-origin',
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || `Channel request failed (${response.status})`);
        }
        const byDealer = Object.fromEntries(
          (Array.isArray(result.dealers) ? result.dealers : []).map((dealer) => [
            dealer.name,
            dealer.rows || [],
          ])
        );
        if (!cancelled) setChannelRowsByDealer(byDealer);
      } catch (error) {
        if (!cancelled) setChannelsError(error?.message || 'Failed to load channel metrics');
      } finally {
        if (!cancelled) setChannelsLoading(false);
      }
    }

    async function loadMetrics() {
      try {
        const response = await fetch(`/api/dashboard/event-tracking?${query}`, {
          credentials: 'same-origin',
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || `Event Tracking request failed (${response.status})`);
        }

        const loadedDealers = Array.isArray(result.dealers) ? result.dealers : [];
        const tableMetrics = Object.fromEntries(
          loadedDealers.map((dealer) => [
            dealer.name,
            {
              users: Number(dealer.users) || 0,
              views: Number(dealer.views) || 0,
            },
          ])
        );
        const allowedNames = Array.isArray(result.availableDealerNames)
          ? result.availableDealerNames
          : loadedDealers.map((dealer) => dealer.name);
        const normalizedDealers = ZERO_DEALERS.filter((dealer) =>
          allowedNames.includes(dealer.name)
        ).map((zeroDealer) => {
          const loaded = loadedDealers.find((dealer) => dealer.name === zeroDealer.name);
          if (!loaded) return zeroDealer;

          const channelRows = new Map(
            (loaded.rows || []).map((row) => [row.name, row])
          );
          zeroDealer.rows.forEach((row) => {
            if (!channelRows.has(row.name)) channelRows.set(row.name, row);
          });
          return {
            ...zeroDealer,
            ...loaded,
            rows: [...channelRows.values()],
          };
        });

        if (!cancelled) {
          setUsersMissingFor(
            loadedDealers.filter((dealer) => dealer.usersMissing).map((dealer) => dealer.name)
          );
          setAvailableDealerNames(allowedNames);
          setDealerTableMetrics(tableMetrics);
          setDealerData(normalizedDealers);
        }
      } catch (error) {
        if (!cancelled) setDataError(error?.message || 'Failed to load Event Tracking metrics');
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    }

    loadMetrics();
    loadChannels();
    loadEvents();
    return () => {
      cancelled = true;
    };
  }, []);

  const dealerData = useMemo(
    () =>
      baseDealerData.map((baseDealer) => {
        let dealer = baseDealer;
        const loadedRows = channelRowsByDealer[dealer.name];
        if (loadedRows) {
          const rowsByName = new Map(dealer.rows.map((row) => [row.name, row]));
          loadedRows.forEach((row) => rowsByName.set(row.name, row));
          dealer = { ...dealer, rows: [...rowsByName.values()] };
        }

        const loadedEvents = eventsByDealer[dealer.name];
        if (!loadedEvents) return dealer;
        const channelEventMaps = loadedEvents.eventsByChannel || {};
        const channelNames = new Set([...CHANNELS, ...Object.keys(channelEventMaps)]);
        const eventsByChannel = {};
        channelNames.forEach((channel) => {
          eventsByChannel[channel] = Object.fromEntries(
            EVENT_TYPES.map((type) => [type, [channelEventMaps[channel]?.[type] || 0, 0, 0]])
          );
        });
        const rowsByName = new Map(dealer.rows.map((row) => [row.name, row]));
        channelNames.forEach((channel) => {
          const total = EVENT_TYPES.reduce(
            (sum, type) => sum + eventsByChannel[channel][type][0],
            0
          );
          const row = rowsByName.get(channel);
          if (row) rowsByName.set(channel, { ...row, events: [total, 0, 0] });
          else if (total > 0) {
            rowsByName.set(channel, {
              name: channel,
              users: [0, 0, 0],
              views: [0, 0, 0],
              events: [total, 0, 0],
            });
          }
        });
        const eventTotals = Object.fromEntries(
          EVENT_TYPES.map((type) => [type, [loadedEvents.eventTotals?.[type] || 0, 0, 0]])
        );
        return { ...dealer, rows: [...rowsByName.values()], eventsByChannel, eventTotals };
      }),
    [baseDealerData, channelRowsByDealer, eventsByDealer]
  );
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
  const channelRows = [...visibleRows].sort((a, b) => {
    const aEvents = sumEventTypes(eventTotalsByChannel[a.name], eventType)[0];
    const bEvents = sumEventTypes(eventTotalsByChannel[b.name], eventType)[0];
    return bEvents - aEvents;
  });
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
      return { dealer, users, views, events };
    }).sort((a, b) => b.events[0] - a.events[0]);
  }, [channelName, dealerData, dealerName, dealerTableMetrics, eventType]);

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
    <div className={styles.page}>
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
          <span className={styles.periodPill}>{lastMonthLabel}</span>
        </div>
      </div>

      <header className={styles.heading}>
        <div>
          <h1>Event Tracking{dealerName ? ` — ${dealerName}` : ''}</h1>
          <p>
            Users, VDP views and form events by channel.{' '}
            <span className={styles.sampleLabel}>
              {dataLoading || channelsLoading || eventsLoading
                ? 'Loading Users and VDP data…'
                : `Last month · Users: smart_ga4_page_data · VDP: smart_final_data`}
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
          Could not load Users and VDP data: {dataError}
        </p>
      )}
      {usersMissingFor.length > 0 && (
        <p className={styles.dataError} role="alert">
          GA4 total users have not been synced for {usersMissingFor.join(', ')} ({lastMonthLabel}).
          Run the smart-ga4-total-users function.
        </p>
      )}
      {eventsError && (
        <p className={styles.dataError} role="alert">
          Could not load form events: {eventsError}
        </p>
      )}
      {channelsError && (
        <p className={styles.dataError} role="alert">
          Could not load channel breakdown: {channelsError}
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
            <span className={styles.kpiHint}>{lastMonthLabel}</span>
            {metric.clickable && <span className={styles.kpiHint}>See events by type ›</span>}
          </button>
        ))}
      </section>

      {detailsOpen && (
        <section className={styles.card} aria-label="Form event details">
          <div className={styles.cardHeader}>
            <div>
              <h2>Form events by type{dealerName ? ` — ${dealerName}` : ''}</h2>
              <p>{lastMonthLabel}</p>
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
                  <th>{lastMonthLabel}</th>
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
            <h3>Event × channel — {lastMonthLabel}</h3>
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
                <h3>Dealer × event — {lastMonthLabel}</h3>
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
              <h2>Dealers — {lastMonthLabel}</h2>
              <p>Select a dealer to see its channels</p>
            </div>
            <span className={styles.badge}>{lastMonthLabel}</span>
          </div>
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.dealerTable}`}>
              <thead>
                <tr>
                  <th>Dealer</th><th>Users</th><th>VDP views</th><th>Form events</th>
                  <th>VDP / Event</th><th>Event %</th>
                </tr>
              </thead>
              <tbody>
                {dealerRows.map(({ dealer, users, views, events }) => (
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
          <span className={styles.badge}>{lastMonthLabel}</span>
        </div>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.channelTable}`}>
            <thead>
              <tr>
                <th>Channel</th>
                <GroupHeader label={`Users · ${lastMonthLabel}`} />
                <GroupHeader label={`VDP views · ${lastMonthLabel}`} />
                <GroupHeader label={`Form events · ${lastMonthLabel}`} />
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
                    <th scope="row" className={styles.rowLabel}>{row.name}</th>
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
          for the month (not summed across pages). Form events come from GA4 submit events.
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
