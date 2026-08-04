'use client';

import { useEffect, useMemo, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/dashboard/Panel';
import ChartTopNSelect from '@/components/dashboard/ChartTopNSelect';
import { useOverview } from '@/components/dashboard/overview/OverviewDataContext';
import { useBreakdownFetch } from '@/hooks/useBreakdownFetch';
import { fetchVdpPageTitleByChannel } from '@/lib/api/dashboardApi';

const CHANNEL_COLS = [
  { key: 'organic_search', label: 'Organic search', type: 'number' },
  { key: 'direct', label: 'Direct', type: 'number' },
  { key: 'paid_search', label: 'Paid search', type: 'number' },
  { key: 'facebook', label: 'Facebook', type: 'number' },
  { key: 'referral', label: 'Referral', type: 'number' },
];

const ALL_COLS = [
  { key: 'page_title', label: 'Page title', type: 'string', thClass: 'vdp-pt-th-title' },
  ...CHANNEL_COLS.map((col) => ({ ...col, thClass: 'vdp-pt-th-num' })),
  { key: 'total_views', label: 'Total', type: 'number', thClass: 'vdp-pt-th-num' },
];

function hasGarbledScript(title) {
  // Reject non-printable-ASCII letters (Chinese / Greek / Cyrillic / Arabic / …)
  return /[^\t\n\r\x20-\x7E]/.test(String(title || ''));
}

function normalizeRows(data) {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list.map((row) => {
    let title = String(row.page_title || '').trim();
    // Safety: never show raw path/URL or non-English script titles
    if (
      !title ||
      title.startsWith('/') ||
      /^https?:\/\//i.test(title) ||
      hasGarbledScript(title)
    ) {
      title = humanizePathLabel(row.page_path) || 'Untitled';
    }
    return {
      page_title: title,
      page_path: row.page_path ? String(row.page_path) : '',
      page_url: row.page_url ? String(row.page_url) : '',
      organic_search: Number(row.organic_search) || 0,
      direct: Number(row.direct) || 0,
      paid_search: Number(row.paid_search) || 0,
      facebook: Number(row.facebook) || 0,
      referral: Number(row.referral) || 0,
      total_views: Number(row.total_views) || 0,
      rank: Number(row.rank) || 0,
    };
  });
}

/** Turn /en/new/.../2025-sea-doo-switch-fish-... into a readable label. */
function humanizePathLabel(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  const segment = raw.replace(/\/+$/, '').split('/').filter(Boolean).pop() || raw;
  return segment
    .replace(/[-_]+/g, ' ')
    .replace(/\s+for sale\s*/gi, ' ')
    .replace(/\b(inventory|product|en|fr|vehicles?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatViews(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '—';
  return v.toLocaleString();
}

function compareRows(a, b, key, type, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  if (type === 'number') {
    return (Number(a[key]) - Number(b[key])) * mul;
  }
  return String(a[key] || '').localeCompare(String(b[key] || ''), undefined, {
    sensitivity: 'base',
  }) * mul;
}

function SortHeader({ col, sortKey, sortDir, onSort }) {
  const active = sortKey === col.key;
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <th className={col.thClass} aria-sort={ariaSort}>
      <button
        type="button"
        className={`vdp-pt-sort-btn${active ? ' is-active' : ''}`}
        onClick={() => onSort(col.key)}
      >
        <span>{col.label}</span>
        <span className="vdp-pt-sort-icons" aria-hidden="true">
          <span className={active && sortDir === 'asc' ? 'is-on' : ''}>▲</span>
          <span className={active && sortDir === 'desc' ? 'is-on' : ''}>▼</span>
        </span>
      </button>
    </th>
  );
}

export default function VdpPageTitleChannelTable({
  clientId,
  from,
  to,
  limit = 10,
}) {
  const { tab, vdpFilters, beginBreakdownLoad, endBreakdownLoad } = useOverview();
  const [topN, setTopN] = useState(limit ?? 10);
  const [sortKey, setSortKey] = useState('total_views');
  const [sortDir, setSortDir] = useState('desc');
  const enabled = Boolean(clientId && from && to && tab === 'vdp');

  const { rows, loading, error } = useBreakdownFetch({
    enabled,
    clientId,
    from,
    to,
    topN,
    vdpFilters,
    tab,
    fetchFn: fetchVdpPageTitleByChannel,
    normalize: normalizeRows,
    errorMessage: 'Failed to load VDP page titles.',
  });

  useEffect(() => {
    if (!enabled) return undefined;
    if (loading) beginBreakdownLoad?.();
    else endBreakdownLoad?.();
    return () => {
      endBreakdownLoad?.();
    };
  }, [enabled, loading, beginBreakdownLoad, endBreakdownLoad]);

  const sortedRows = useMemo(() => {
    const col = ALL_COLS.find((c) => c.key === sortKey) || ALL_COLS[ALL_COLS.length - 1];
    return [...rows].sort((a, b) => compareRows(a, b, col.key, col.type, sortDir));
  }, [rows, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'page_title' ? 'asc' : 'desc');
  }

  return (
    <Panel className="vdp-page-title-panel cmp-table-panel">
      <PanelHeader title="VDP Pages by Channel">
        <div className="make-breakdown-head-controls">
          <ChartTopNSelect
            value={topN}
            onChange={setTopN}
            ariaLabel="Show top VDP pages"
          />
        </div>
      </PanelHeader>
      <PanelBody>
        {error ? <div className="cmp-table-error">{error}</div> : null}

        <div className="cmp-table-wrap vdp-page-title-wrap">
          <table className="cmp-tbl vdp-page-title-tbl">
            <thead>
              <tr>
                {ALL_COLS.map((col) => (
                  <SortHeader
                    key={col.key}
                    col={col}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={ALL_COLS.length} className="cmp-table-loading">
                    Loading page titles…
                  </td>
                </tr>
              ) : null}

              {!loading && !error && rows.length === 0 ? (
                <tr>
                  <td colSpan={ALL_COLS.length} className="cmp-table-loading">
                    No VDP page titles for this period.
                  </td>
                </tr>
              ) : null}

              {sortedRows.map((row) => {
                const href = row.page_url || '';
                const isHttp = href.startsWith('http');
                return (
                  <tr key={`${row.rank}-${row.page_path}`}>
                    <td className="vdp-pt-td-title">
                      {isHttp ? (
                        <a
                          href={href}
                          title={row.page_title}
                          className="vdp-pt-link"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row.page_title}
                        </a>
                      ) : (
                        <span title={row.page_title}>{row.page_title}</span>
                      )}
                    </td>
                    {CHANNEL_COLS.map((col) => (
                      <td key={col.key} className="vdp-pt-td-num">
                        {formatViews(row[col.key])}
                      </td>
                    ))}
                    <td className="vdp-pt-td-num vdp-pt-td-total">
                      {formatViews(row.total_views)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PanelBody>
    </Panel>
  );
}
