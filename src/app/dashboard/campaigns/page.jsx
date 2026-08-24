'use client';

import '@/app/campaigns.css';
import CampaignsView from '@/components/campaigns/CampaignsView';
import CalendarRangePicker from '@/components/dashboard/CalendarRangePicker';
import { OverviewProvider, useOverview } from '@/components/dashboard/overview/OverviewDataContext';

function CampaignsFilters() {
  const { dateRange, setDateRange } = useOverview();

  return (
    <div className="filters campaigns-filters">
      <div className="filters-row">
        <CalendarRangePicker value={dateRange} onChange={setDateRange} />
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  return (
    <OverviewProvider>
      <CampaignsFilters />
      <div className="content">
        <CampaignsView />
      </div>
    </OverviewProvider>
  );
}
