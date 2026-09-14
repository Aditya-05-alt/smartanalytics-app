'use client';

import { VdpLabProvider } from '@/components/dashboard/overview/VdpLabContext';
import IndustryChannelTrendsLab from '@/components/dashboard/vdp-lab/IndustryChannelTrendsLab';

/**
 * Compare — industry VDP channel trends (MoM / YoY).
 * Replaces the old side-by-side dealer compare with the VDP Lab trends UI.
 */
export default function ComparePage() {
  return (
    <VdpLabProvider>
      <div className="vdp-lab-page">
        <IndustryChannelTrendsLab />
      </div>
    </VdpLabProvider>
  );
}
