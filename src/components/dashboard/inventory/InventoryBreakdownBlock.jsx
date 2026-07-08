'use client';

import { useMemo, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/dashboard/Panel';
import BreakdownDonut from '@/components/dashboard/overview/BreakdownDonut';
import { formatViewsK } from '@/lib/format/viewsK';
import { formatInventoryUnits } from '@/lib/inventory/formatInventory';
import { rowsToInventoryDonutData } from '@/lib/inventory/inventoryDonutData';
import InventoryBreakdownTable from './InventoryBreakdownTable';

function ChartModeToggle({ mode, onChange }) {
  return (
    <div className="make-breakdown-head-controls">
      <div className="chart-mode" role="group" aria-label="Chart type">
        <button
          type="button"
          className={`cm-btn ${mode === 'donut' ? 'active' : ''}`}
          onClick={() => onChange('donut')}
          aria-pressed={mode === 'donut'}
        >
          Donut
        </button>
        <button
          type="button"
          className={`cm-btn ${mode === 'bar' ? 'active' : ''}`}
          onClick={() => onChange('bar')}
          aria-pressed={mode === 'bar'}
        >
          Bar
        </button>
      </div>
    </div>
  );
}

export default function InventoryBreakdownBlock({
  title,
  labelHeader,
  rows = [],
  totalUnits = 0,
  totalValue = 0,
  centerLabel = 'UNITS',
}) {
  const [chartMode, setChartMode] = useState('donut');

  const donutData = useMemo(() => rowsToInventoryDonutData(rows), [rows]);

  const total = useMemo(
    () => donutData.reduce((sum, row) => sum + row.value, 0),
    [donutData]
  );

  const maxBar = useMemo(
    () => Math.max(...donutData.map((row) => row.value), 1),
    [donutData]
  );

  return (
    <Panel className="breakdown-donut-panel inventory-condition-block dashboard-full-row">
      <PanelHeader title={title}>
        <ChartModeToggle mode={chartMode} onChange={setChartMode} />
      </PanelHeader>
      <PanelBody className="breakdown-donut-body">
        <div className="inventory-condition-split">
          <div className="inventory-condition-chart-col">
            {chartMode === 'donut' ? (
              <div className="inventory-condition-donut-center">
                <BreakdownDonut
                  embedded
                  hideList
                  data={donutData}
                  centerLabel={centerLabel}
                  centerValue={formatViewsK(total)}
                  totalViews={total}
                  size={280}
                  stroke={28}
                  sliceTooltipUnit="units"
                  pctDecimals={1}
                />
              </div>
            ) : (
              <div className="make-breakdown-bars inventory-condition-bars">
                {donutData.map((row) => {
                  const heightPct = Math.max((row.value / maxBar) * 100, 4);
                  return (
                    <div key={row.name} className="make-breakdown-bar-col">
                      <div
                        className="make-breakdown-bar-v"
                        style={{
                          height: `${heightPct}%`,
                          background: row.color,
                          minHeight: 8,
                        }}
                      >
                        <span className="make-breakdown-bar-tip">
                          {formatInventoryUnits(row.value)}
                        </span>
                      </div>
                      <span className="make-breakdown-bar-label" title={row.name}>
                        {row.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <InventoryBreakdownTable
            rows={rows}
            totalUnits={totalUnits}
            totalValue={totalValue}
            labelHeader={labelHeader}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}
