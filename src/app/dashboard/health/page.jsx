'use client';

import { useState, useMemo } from 'react';
import HealthSummary from '@/components/dashboard/health/HealthSummary';
import HealthBoard from '@/components/dashboard/health/HealthBoard';
import FilterDropdown from '@/components/dashboard/FilterDropdown';
import DateRange from '@/components/dashboard/DateRange';
import StatusBar from '@/components/dashboard/StatusBar';
import { HEALTH_DEALERS } from '@/lib/data/dealers';

const CHAN_OPTS = [
  { value: 'All',         label: 'All Channels'   },
  { value: 'Organic',     label: 'Organic Search' },
  { value: 'Paid Search', label: 'Paid Search'    },
  { value: 'Direct',      label: 'Direct'         },
  { value: 'Paid Social', label: 'Paid Social'    },
];
const CAT_OPTS = [
  { value: 'All',         label: 'All Categories' },
  { value: 'rv',          label: '🚐 RV'          },
  { value: 'auto',        label: '🚗 Auto'        },
  { value: 'powersports', label: '🏍 Powersports' },
  { value: 'marine',      label: '⛵ Marine'      },
];

export default function HealthPage() {
  const [chan, setChan]   = useState('All');
  const [cat, setCat]     = useState('All');
  const [sort, setSort]   = useState('mom');
  const [range, setRange] = useState('mtd');

  const filtered = useMemo(() => {
    let list = HEALTH_DEALERS;
    if (cat !== 'All') list = list.filter((d) => d.cat === cat);
    if (chan !== 'All') {
      list = list.filter((d) =>
        d.channels.some((c) => c.toLowerCase().includes(chan.toLowerCase()))
      );
    }
    return list;
  }, [cat, chan]);

  const buckets = useMemo(() => {
    const sorter = {
      mom: (a, b) => a.delta - b.delta,
      yoy: (a, b) => {
        const yA = a.ly > 0 ? (a.cur - a.ly) / a.ly : 0;
        const yB = b.ly > 0 ? (b.cur - b.ly) / b.ly : 0;
        return yA - yB;
      },
      abs: (a, b) => b.cur - a.cur,
    }[sort];

    const down = filtered.filter((d) => d.delta <= -10).slice().sort(sorter);
    const ok   = filtered.filter((d) => d.delta > -10 && d.delta < 10).slice().sort(sorter);
    const up   = filtered.filter((d) => d.delta >= 10).slice().sort((a, b) => b.delta - a.delta);
    return { down, ok, up };
  }, [filtered, sort]);

  const counts = {
    total: filtered.length,
    down: buckets.down.length,
    ok: buckets.ok.length,
    up: buckets.up.length,
  };

  return (
    <>
      <div className="filters">
        <span className="f-label">Portfolio Health</span>
        <FilterDropdown options={CHAN_OPTS} value={chan} onChange={setChan} />
        <FilterDropdown options={CAT_OPTS}  value={cat}  onChange={setCat}  />
        <div className={`hf-sort ${sort === 'mom' ? 'active' : ''}`} onClick={() => setSort('mom')}>Sort: MoM</div>
        <div className={`hf-sort ${sort === 'yoy' ? 'active' : ''}`} onClick={() => setSort('yoy')}>Sort: YoY</div>
        <div className={`hf-sort ${sort === 'abs' ? 'active' : ''}`} onClick={() => setSort('abs')}>Sort: Volume</div>
        <div className="f-right">
          <DateRange value={range} onChange={setRange} options={['mtd', '7d', '30d']} />
        </div>
      </div>

      <div className="content">
        <HealthSummary counts={counts} />
        <HealthBoard down={buckets.down} ok={buckets.ok} up={buckets.up} />
      </div>

      <StatusBar
        items={[
          { label: `${counts.down} dealers need attention`, color: 'var(--red)' },
          { label: '3 GA4 connection issues', color: 'var(--yellow)' },
        ]}
        right="Last updated: 2:14 AM today"
      />
    </>
  );
}
