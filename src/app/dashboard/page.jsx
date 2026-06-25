'use client';

import PageTabs from '@/components/dashboard/overview/PageTabs';
import OverviewFilters from '@/components/dashboard/overview/OverviewFilters';
import KpiRow from '@/components/dashboard/overview/KpiRow';
import ChannelDonut from '@/components/dashboard/overview/ChannelDonut';
import LocationDonut from '@/components/dashboard/overview/LocationDonut';
import MakeBreakdown from '@/components/dashboard/MakeBreakdown';
import ModelBreakdown from '@/components/dashboard/ModelBreakdown';
import YearBreakdown from '@/components/dashboard/YearBreakdown';
import ConditionBreakdown from '@/components/dashboard/ConditionBreakdown';
// import TopCampaigns from '@/components/dashboard/TopCampaigns';
import CmpTable from '@/components/dashboard/overview/CmpTable';
// import MakesTable from '@/components/dashboard/overview/MakesTable';
// import ProximityBars from '@/components/dashboard/overview/ProximityBars';
// import WarmLeads from '@/components/dashboard/overview/WarmLeads';
import StatusBar from '@/components/dashboard/StatusBar';
import {
  OverviewProvider,
  useOverview,
} from '@/components/dashboard/overview/OverviewDataContext';

const TAB_PAGE_TYPE = {
  all: 'All',
  vdp: 'VDP',
  srp: 'SRP',
  home: 'Homepage',
  other: 'Other',
};

function OverviewBody() {
  const { tab, error, clientKey, from, to, compareEnabled } = useOverview();
  const vdpCompareLayout = tab === 'vdp' && compareEnabled;

  return (
    <>
      <PageTabs />
      <OverviewFilters />

      <div className="content">
        <KpiRow />

        {tab === 'vdp' ? (
          <>
            <div className={vdpCompareLayout ? 'dashboard-full-row' : 'g2'}>
              <ChannelDonut
                clientId={clientKey}
                from={from}
                to={to}
                pageType={TAB_PAGE_TYPE[tab]}
              />
              {!vdpCompareLayout && (
                <LocationDonut
                  clientId={clientKey}
                  from={from}
                  to={to}
                  pageType={TAB_PAGE_TYPE[tab]}
                />
              )}
            </div>
            {vdpCompareLayout && (
              <div className="dashboard-full-row">
                <LocationDonut
                  clientId={clientKey}
                  from={from}
                  to={to}
                  pageType={TAB_PAGE_TYPE[tab]}
                />
              </div>
            )}
          </>
        ) : (
          <div className="dashboard-full-row">
            <ChannelDonut
              clientId={clientKey}
              from={from}
              to={to}
              pageType={TAB_PAGE_TYPE[tab] || 'All'}
            />
          </div>
        )}

        {tab === 'vdp' && (
          <>
            {vdpCompareLayout ? (
              <>
                <div className="dashboard-full-row">
                  <YearBreakdown
                    clientId={clientKey}
                    from={from}
                    to={to}
                    limit={null}
                  />
                </div>
                <div className="dashboard-full-row">
                  <ConditionBreakdown
                    clientId={clientKey}
                    from={from}
                    to={to}
                    limit={null}
                  />
                </div>
              </>
            ) : (
              <div className="dashboard-vdp-half-grid">
                <div className="dashboard-half-row">
                  <YearBreakdown
                    clientId={clientKey}
                    from={from}
                    to={to}
                    limit={null}
                  />
                </div>
                <div className="dashboard-half-row">
                  <ConditionBreakdown
                    clientId={clientKey}
                    from={from}
                    to={to}
                    limit={null}
                  />
                </div>
              </div>
            )}
            <div className="dashboard-full-row">
              <MakeBreakdown
                clientId={clientKey}
                from={from}
                to={to}
              />
            </div>
            <div className="dashboard-full-row">
              <ModelBreakdown
                clientId={clientKey}
                from={from}
                to={to}
              />
            </div>
          </>
        )}

        {/* Campaign breakdown — temporarily hidden; uncomment to restore on all tabs:
        <div className="dashboard-full-row">
          <TopCampaigns clientId={clientKey} from={from} to={to} />
        </div>
        */}

        {(tab === 'all' || tab === 'vdp') && (
          <div className="dashboard-full-row">
            <CmpTable />
          </div>
        )}

        {/* Bottom row — re-enable when ready:
        <div className="g3">
          <MakesTable />
          <ProximityBars />
          <WarmLeads />
        </div>
        */}
      </div>

      <StatusBar
        items={[
          { label: error ? `GA4 error: ${error}` : 'GA4 — connected', color: error ? 'var(--red)' : 'var(--green)' },
          { label: 'Digital Envoy — not connected', color: 'var(--t3)' },
          { label: 'Scrape queue 0', color: 'var(--t3)' },
        ]}
        right="0 active clients"
      />
    </>
  );
}

export default function OverviewPage() {
  return (
    <OverviewProvider>
      <OverviewBody />
    </OverviewProvider>
  );
}
