'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/dashboard/Panel';
import CalendarRangePicker, { resolveRangePickerValue } from '@/components/dashboard/CalendarRangePicker';
import { useClient } from '@/components/dashboard/ClientContext';
import { useOverview } from '@/components/dashboard/overview/OverviewDataContext';
import {
  fetchAllDealersChannelMatrix,
  sliceMapForRow,
} from '@/lib/api/allDealerChannelMatrix';
import { colorForChannel } from '@/lib/ga4/channelDisplay';
import { toCalendarISO } from '@/lib/ga4/dateRange';

const TAB_PAGE_TYPE = {
  vdp: 'VDP',
  all: 'ALL',
};

const TAB_LABEL = {
  vdp: 'VDP',
  all: 'All Pages',
};

function resolvePickerRange(value) {
  const resolved = resolveRangePickerValue(value);
  if (resolved?.start && resolved?.end) {
    return { from: resolved.start, to: resolved.end };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: toCalendarISO(from), to: toCalendarISO(today) };
}

function ChannelHeader({ name, index }) {
  const color = colorForChannel(name, index);
  return (
    <div className="adc-col-head" title={name}>
      <span className="adc-col-swatch" style={{ background: color }} />
      <span className="adc-col-label">{name}</span>
    </div>
  );
}

function ChannelCell({ slice }) {
  if (!slice || !(Number(slice.value) > 0)) {
    return <span className="adc-cell-empty">—</span>;
  }

  return (
    <div className="adc-cell">
      <span className="adc-cell-views">{Number(slice.value).toLocaleString()}</span>
    </div>
  );
}

export default function AllDealerChannelTable() {
  const { dealers, loading: dealersLoading } = useClient();
  const { tab } = useOverview();
  const [dateRange, setDateRange] = useState('current_month');
  const [matrixRows, setMatrixRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const cancelRef = useRef(false);

  const { from, to } = useMemo(() => resolvePickerRange(dateRange), [dateRange]);
  const pageTypeFilter = TAB_PAGE_TYPE[tab] || 'ALL';
  const panelTitle = `${TAB_LABEL[tab] || 'Page'} views by channel — all dealers`;

  const loadMatrix = useCallback(async () => {
    if (!dealers?.length || !from || !to) {
      setMatrixRows([]);
      setColumns([]);
      return;
    }

    cancelRef.current = false;
    setLoading(true);
    setError(null);
    setProgress(null);

    try {
      const result = await fetchAllDealersChannelMatrix({
        dealers,
        from,
        to,
        pageTypeFilter,
        onProgress: setProgress,
        onPartial: (partial) => {
          if (!cancelRef.current) {
            setMatrixRows(partial.rows || []);
            setColumns(partial.columns || []);
            setError(null);
          }
        },
        onCancelCheck: () => cancelRef.current,
      });

      if (cancelRef.current) return;

      setMatrixRows(result.rows || []);
      setColumns(result.columns || []);
      setError(result.warning || null);
    } catch (err) {
      if (!cancelRef.current) {
        setError(err?.message || 'Failed to load dealer channel data.');
      }
    } finally {
      if (!cancelRef.current) {
        setLoading(false);
        setProgress(null);
      }
    }
  }, [dealers, from, to, pageTypeFilter]);

  useEffect(() => {
    if (dealersLoading) return undefined;
    loadMatrix();
    return () => {
      cancelRef.current = true;
    };
  }, [dealersLoading, loadMatrix]);

  const showEmpty = !loading && !error && matrixRows.length === 0;

  return (
    <>
      <div className="filters all-dealer-filters">
        <span className="f-label">Date range</span>
        <CalendarRangePicker value={dateRange} onChange={setDateRange} />
        {loading && (
          <span className="data-updating-badge" role="status">
            <span className="data-updating-dot" aria-hidden />
            {progress?.total > 1
              ? `Loading dealers ${progress.completed}/${progress.total} batches…`
              : 'Loading channel matrix…'}
          </span>
        )}
      </div>

      <div className="content all-dealer-overview-content">
        <Panel className="all-dealer-channel-panel">
          <PanelHeader
            title={panelTitle}
            badge={{
              label: 'Channel combinations',
              bg: 'var(--s3)',
              color: 'var(--t2)',
            }}
          />
          <PanelBody className="all-dealer-channel-body">
            {error && (
              <div className="donut-err" role="alert">
                {error}
              </div>
            )}
            {showEmpty && !dealersLoading && (
              <div className="local-empty-state">
                <p className="local-empty-title">No dealer channel data</p>
                <p className="local-empty-sub">
                  Adjust the date range or confirm dealers have GA4 IDs configured.
                </p>
              </div>
            )}
            {(loading || matrixRows.length > 0) && (
              <div className="adc-table-wrap">
                <table className="tbl adc-table">
                  <thead>
                    <tr>
                      <th className="adc-th-dealer">Dealers</th>
                      <th className="adc-th-total">Total Views</th>
                      {columns.map((name, index) => (
                        <th key={name} className="adc-th-channel">
                          <ChannelHeader name={name} index={index} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((row) => {
                      const sliceMap = sliceMapForRow(row);
                      return (
                        <tr key={row.dealer.id}>
                          <td className="adc-td-dealer">
                            <span className="adc-dealer-name" title={row.dealer.name}>
                              {row.dealer.name}
                            </span>
                            {row.error && (
                              <span className="adc-dealer-err" title={row.error}>
                                !
                              </span>
                            )}
                          </td>
                          <td className="adc-td-total">
                            {!row.error && row.total > 0 ? (
                              <span className="adc-total-views">
                                {row.total.toLocaleString()}
                              </span>
                            ) : (
                              <span className="adc-cell-empty">—</span>
                            )}
                          </td>
                          {columns.map((colName) => (
                            <td key={`${row.dealer.id}-${colName}`} className="adc-td-channel">
                              <ChannelCell slice={sliceMap.get(colName)} />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {loading && matrixRows.length === 0 && (
                      <tr>
                        <td colSpan={Math.max(columns.length + 2, 3)} className="adc-loading-row">
                          Loading channel breakdown…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
