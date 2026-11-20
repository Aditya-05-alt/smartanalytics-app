'use client';

import { useEffect, useState } from 'react';

function useLoadPercent(active: boolean) {
  const [percent, setPercent] = useState(0);
  useEffect(() => {
    if (!active) {
      setPercent(100);
      return undefined;
    }
    setPercent(0);
    const timer = setInterval(() => {
      setPercent((value) => Math.min(95, value + Math.max(0.5, (95 - value) * 0.08)));
    }, 120);
    return () => clearInterval(timer);
  }, [active]);
  return Math.round(percent);
}

/** Same freeze overlay as VDP Analysis (adc-table-overlay + % loader). */
export default function FreezeScreen({ active = true }: { active?: boolean }) {
  const loadPercent = useLoadPercent(active);
  if (!active) return null;

  return (
    <>
      <div className="adc-nav-progress wr-nav-progress" role="progressbar" aria-label="Loading" aria-busy="true">
        <div className="adc-nav-progress-bar" />
      </div>
      <div
        className="adc-table-overlay wr-loading-overlay"
        role="status"
        aria-live="polite"
        aria-label={`Loading ${loadPercent}%`}
      >
        <div className="adc-table-loader dealer-compare-loader">
          <span className="adc-table-spinner" aria-hidden />
          <span className="adc-table-loader-text">Loading {loadPercent}%</span>
        </div>
      </div>
    </>
  );
}
