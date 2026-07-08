'use client';

import StatusBar from '@/components/dashboard/StatusBar';
import { INVENTORY_REPORT_SECTION_ORDER } from '@/lib/inventory/inventoryReport';
import InventoryBreakdownBlock from './InventoryBreakdownBlock';
import InventoryList from './InventoryList';
import InventoryReportFilters from './InventoryReportFilters';
import {
  InventoryReportProvider,
  useInventoryReport,
} from './InventoryReportContext';

function InventoryReportContent() {
  const { sections, inventoryList, loading, error, meta } = useInventoryReport();

  const statusItems = error
    ? [{ label: `Inventory report · ${error}`, color: 'var(--red)' }]
    : [
        {
          label: meta?.source === 'sample'
            ? 'Inventory report · sample data (Supabase not configured)'
            : [
                'Inventory report',
                meta?.pullDate ? `snapshot ${meta.pullDate}` : null,
                meta?.allDealers ? 'All Dealers' : null,
                meta?.rowCount != null ? `${meta.rowCount} units` : null,
              ]
                .filter(Boolean)
                .join(' · '),
          color: 'var(--t3)',
        },
      ];

  return (
    <>
      <InventoryReportFilters />

      <div className="content inventory-report-content">
        {error && (
          <div className="donut-err" role="alert">
            {error}
          </div>
        )}
        {loading && !sections ? (
          <div className="local-empty-state">
            <p className="local-empty-title">Loading inventory report…</p>
          </div>
        ) : (
          INVENTORY_REPORT_SECTION_ORDER.map((key) => {
            const block = sections?.[key];
            if (!block) return null;
            return (
              <div key={key} className="inventory-report-section">
                <InventoryBreakdownBlock
                  title={block.title}
                  labelHeader={block.labelHeader}
                  rows={block.rows}
                  totalUnits={block.totalUnits}
                  totalValue={block.totalValue}
                  centerLabel="UNITS"
                />
              </div>
            );
          })
        )}

        {!loading && inventoryList && (
          <div className="inventory-report-section inventory-report-list-section">
            <InventoryList list={inventoryList} />
          </div>
        )}
      </div>

      <StatusBar items={statusItems} />
    </>
  );
}

export default function InventoryReportBody() {
  return (
    <InventoryReportProvider>
      <InventoryReportContent />
    </InventoryReportProvider>
  );
}
