'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import OverviewFilters from '@/components/dashboard/overview/OverviewFilters';
import KpiRow from '@/components/dashboard/overview/KpiRow';
import ChannelDonut from '@/components/dashboard/overview/ChannelDonut';
import MakeBreakdown from '@/components/dashboard/MakeBreakdown';
import TypeBreakdown from '@/components/dashboard/TypeBreakdown';
import ModelBreakdown from '@/components/dashboard/ModelBreakdown';
import YearBreakdown from '@/components/dashboard/YearBreakdown';
import ConditionBreakdown from '@/components/dashboard/ConditionBreakdown';
import CmpTable from '@/components/dashboard/overview/CmpTable';
import VdpPageTitleChannelTable from '@/components/dashboard/overview/VdpPageTitleChannelTable';
import { useClient } from '@/components/dashboard/ClientContext';
import {
  OverviewProvider,
  useOverview,
} from '@/components/dashboard/overview/OverviewDataContext';
import { VdpLabProvider } from '@/components/dashboard/overview/VdpLabContext';

/**
 * VDP Lab — location filter is in the same room as make/year/type/condition.
 * Channel uses get_ga4_channel_breakdown_lab with p_locations (soft match).
 * Location chart slot kept empty. Live /dashboard untouched.
 */
function VdpLabBody() {
  const { isAllDealer } = useClient();
  const { setTab, clientKey, from, to, compareEnabled } = useOverview();
  const vdpCompareLayout = compareEnabled;

  useEffect(() => {
    setTab('vdp');
  }, [setTab]);

  if (isAllDealer) {
    return (
      <div className="content" style={{ padding: '1.25rem' }}>
        <div className="vdp-lab-banner">
          <strong>VDP Lab</strong> — pick a single dealer (not All Dealers) to test the VDP
          clone.
        </div>
        <p style={{ color: 'var(--t3)', fontSize: 13 }}>
          <Link href="/dashboard" style={{ color: 'var(--acc)' }}>
            ← Back to live Overview
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="vdp-lab-banner">
        <div>
          <strong>VDP Lab</strong> — Location filter is wired like Make/Year/Type into
          Channel (lab RPC). Location chart empty. Live Overview unchanged.
        </div>
        <Link href="/dashboard" className="vdp-lab-banner-link">
          Live Overview →
        </Link>
      </div>

      <OverviewFilters />

      <div className="content">
        <KpiRow />

        <div className={vdpCompareLayout ? 'dashboard-full-row' : 'g2'}>
          <ChannelDonut
            clientId={clientKey}
            from={from}
            to={to}
            pageType="VDP"
          />
          {/* Location Breakdown chart intentionally empty on Lab */}
          {!vdpCompareLayout && <div aria-hidden="true" />}
        </div>

        {vdpCompareLayout ? (
          <>
            <div className="dashboard-full-row">
              <YearBreakdown clientId={clientKey} from={from} to={to} limit={null} />
            </div>
            <div className="dashboard-full-row">
              <ConditionBreakdown clientId={clientKey} from={from} to={to} limit={null} />
            </div>
          </>
        ) : (
          <div className="dashboard-vdp-half-grid">
            <div className="dashboard-half-row">
              <YearBreakdown clientId={clientKey} from={from} to={to} limit={null} />
            </div>
            <div className="dashboard-half-row">
              <ConditionBreakdown clientId={clientKey} from={from} to={to} limit={null} />
            </div>
          </div>
        )}

        <div className="dashboard-full-row">
          <TypeBreakdown clientId={clientKey} from={from} to={to} />
        </div>
        <div className="dashboard-full-row">
          <MakeBreakdown clientId={clientKey} from={from} to={to} />
        </div>
        <div className="dashboard-full-row">
          <ModelBreakdown clientId={clientKey} from={from} to={to} />
        </div>
        <div className="dashboard-full-row">
          <VdpPageTitleChannelTable
            clientId={clientKey}
            from={from}
            to={to}
            limit={10}
          />
        </div>
        <div className="dashboard-full-row">
          <CmpTable />
        </div>
      </div>
    </>
  );
}

export default function VdpLabPage() {
  return (
    <VdpLabProvider>
      <OverviewProvider>
        <VdpLabBody />
      </OverviewProvider>
    </VdpLabProvider>
  );
}
