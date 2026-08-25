'use client';

import { useEffect, useState } from 'react';
import CalendarRangePicker from '@/components/dashboard/CalendarRangePicker';
import VdpGa4VsBigqCompareTable from '@/components/dashboard/overview/VdpGa4VsBigqCompareTable';
import {
  readStoredOverviewDateRange,
  writeStoredOverviewDateRange,
} from '@/lib/dashboard/dashboardPrefs';

function resolveRange(value) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (value && typeof value === 'object' && value.start && value.end) {
    return {
      from: String(value.start).slice(0, 10),
      to: String(value.end).slice(0, 10),
    };
  }

  const preset = typeof value === 'string' ? value : 'current_month';
  const y = today.getFullYear();
  const m = today.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (preset === '7d') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { from: ymd(start), to: ymd(today) };
  }
  if (preset === '30d') {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { from: ymd(start), to: ymd(today) };
  }
  if (preset === 'last_month') {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { from: ymd(start), to: ymd(end) };
  }

  const start = new Date(y, m, 1);
  return { from: ymd(start), to: ymd(today) };
}

export default function ComparePage() {
  const [dateRange, setDateRange] = useState(() => readStoredOverviewDateRange() || 'current_month');
  const { from, to } = resolveRange(dateRange);

  useEffect(() => {
    writeStoredOverviewDateRange(dateRange);
  }, [dateRange]);

  return (
    <>
      <div className="filters compare-page-filters">
        <span className="f-label">Compare</span>
        <CalendarRangePicker value={dateRange} onChange={setDateRange} />
        <span className="compare-page-cap-note">
          BigQuery VDP data is capped at <strong>today − 2</strong>
        </span>
      </div>

      <div className="content">
        <div className="dashboard-full-row">
          <VdpGa4VsBigqCompareTable from={from} to={to} showExport />
        </div>
      </div>
    </>
  );
}
