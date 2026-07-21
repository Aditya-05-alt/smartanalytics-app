'use client';

import PageTabs from '@/components/dashboard/overview/PageTabs';
import OverviewFilters from '@/components/dashboard/overview/OverviewFilters';
import KpiRow from '@/components/dashboard/overview/KpiRow';
import ChannelDonut from '@/components/dashboard/overview/ChannelDonut';
import LocationBreakdown from '@/components/dashboard/LocationBreakdown';
import MakeBreakdown from '@/components/dashboard/MakeBreakdown';
import TypeBreakdown from '@/components/dashboard/TypeBreakdown';
import ModelBreakdown from '@/components/dashboard/ModelBreakdown';
import YearBreakdown from '@/components/dashboard/YearBreakdown';
import ConditionBreakdown from '@/components/dashboard/ConditionBreakdown';
// import TopCampaigns from '@/components/dashboard/TopCampaigns';
import CmpTable from '@/components/dashboard/overview/CmpTable';
// import MakesTable from '@/components/dashboard/overview/MakesTable';
// import ProximityBars from '@/components/dashboard/overview/ProximityBars';
// import WarmLeads from '@/components/dashboard/overview/WarmLeads';
import AllDealerChannelTable from '@/components/dashboard/overview/AllDealerChannelTable';
import { AllDealerMatrixProvider } from '@/components/dashboard/overview/AllDealerMatrixContext';
import { useClient } from '@/components/dashboard/ClientContext';
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

function AllDealerOverviewBody() {
  return (
    <AllDealerMatrixProvider>
      <PageTabs />
      <OverviewFilters />
      <AllDealerChannelTable />
    </AllDealerMatrixProvider>
  );
}

function DealerOverviewBody() {
  const { tab, clientKey, from, to, compareEnabled } = useOverview();
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
                <LocationBreakdown
                  clientId={clientKey}
                  from={from}
                  to={to}
                />
              )}
            </div>
            {vdpCompareLayout && (
              <div className="dashboard-full-row">
                <LocationBreakdown
                  clientId={clientKey}
                  from={from}
                  to={to}
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
              <TypeBreakdown
                clientId={clientKey}
                from={from}
                to={to}
              />
            </div>
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
    </>
  );
}

function OverviewBody() {
  const { isAllDealer } = useClient();
  if (isAllDealer) return <AllDealerOverviewBody />;
  return <DealerOverviewBody />;
}

export default function OverviewPage() {
  return (
    <OverviewProvider>
      <OverviewBody />
    </OverviewProvider>
  );
}
