'use client';

import { useClient } from '../ClientContext';

const TABS = [
  { id: 'all',   label: 'All',      icon: '📊' },
  { id: 'vdp',   icon: '🚗' },
  { id: 'srp',   label: 'SRP',      icon: '🔍' },
  { id: 'home',  label: 'Homepage', icon: '🏠' },
  { id: 'other', label: 'Other',    icon: '📄' },
];

export default function PageTabs({ active, onChange, comparing, onToggleCmp }) {
  const { config } = useClient();

  return (
    <div className="page-tabs">
      {TABS.map((t) => {
        const label = t.id === 'vdp' ? config.vdpLabel : t.label;
        return (
          <button
            key={t.id}
            type="button"
            className={`pt ${active === t.id ? 'active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            <span>{t.icon}</span>
            <span>{label}</span>
          </button>
        );
      })}
      <div className="pt-right">
        <div
          onClick={onToggleCmp}
          role="button"
          tabIndex={0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            background: comparing ? 'var(--bld)' : 'var(--s3)',
            border: `1px solid ${comparing ? 'var(--blb)' : 'var(--bd)'}`,
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 500,
            color: comparing ? 'var(--blue)' : 'var(--t3)',
            cursor: 'pointer',
            transition: 'all .15s',
          }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: comparing ? 'var(--blue)' : 'var(--t3)',
              transition: 'background .2s',
            }}
          />
          <span>{comparing ? 'Comparing: Apr vs Mar vs LY' : 'Compare periods'}</span>
        </div>
      </div>
    </div>
  );
}
