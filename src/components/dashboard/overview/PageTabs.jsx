'use client';

import { useClient } from '../ClientContext';
import { useOverview } from './OverviewDataContext';

const TABS = [
  { id: 'vdp',   icon: '🚗' },
  { id: 'srp',   label: 'SRP',      icon: '🔍' },
  { id: 'home',  label: 'Homepage', icon: '🏠' },
  { id: 'all',   label: 'All',      icon: '📊' },
  { id: 'other', label: 'Other',    icon: '📄' },
];

export default function PageTabs() {
  const { config } = useClient();
  const { tab, setTab } = useOverview();

  return (
    <div className="page-tabs">
      {TABS.map((t) => {
        const label = t.id === 'vdp' ? config.vdpLabel : t.label;
        return (
          <button
            key={t.id}
            type="button"
            className={`pt ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span>{t.icon}</span>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
