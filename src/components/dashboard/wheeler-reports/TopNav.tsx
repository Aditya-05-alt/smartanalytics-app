'use client';

import { usePathname } from 'next/navigation';
import type { Viewer } from '@/lib/wheelerReports/auth';
import { useFreezeNav } from './FreezeContext';

type Dealer = { slug: string; name: string };

type Props = {
  viewer: Pick<Viewer, 'role'>;
  client?: Dealer;
  dealers?: Dealer[];
};

type Tab = 'report' | 'other-costs' | 'data';

function tabFromPath(path: string | null): Tab | null {
  if (!path) return null;
  if (path.includes('/other-costs')) return 'other-costs';
  if (path.includes('/data')) return 'data';
  if (path.includes('/report')) return 'report';
  return null;
}

export default function TopNav({ viewer, client, dealers = [] }: Props) {
  const pathname = usePathname();
  const { tab, navigate, navigateDealer } = useFreezeNav();
  const isAdmin = viewer.role === 'admin';
  const current = tab ?? tabFromPath(pathname);

  if (!client) return null;

  const base = `/dashboard/wheeler-reports/c/${client.slug}`;
  const tabs: { key: Tab; href: string; label: string }[] = [
    { key: 'report', href: `${base}/report`, label: 'Report' },
    { key: 'other-costs', href: `${base}/other-costs`, label: 'Other costs' },
    { key: 'data', href: `${base}/data`, label: 'Data & sync' },
  ];

  const switchDealer = (slug: string) => {
    if (!slug || slug === client.slug) return;
    const section = current ?? 'report';
    navigateDealer(`/dashboard/wheeler-reports/c/${slug}/${section}`);
  };

  return (
    <header className="topnav">
      {isAdmin && dealers.length > 0 && (
        <label className="wr-dealer-switch">
          <span className="wr-dealer-switch-label">Dealer</span>
          <select
            aria-label="Switch dealer"
            value={client.slug}
            onChange={(e) => switchDealer(e.target.value)}
          >
            {dealers.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <nav aria-label="Main">
        {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className="chip topnav-tab"
              aria-current={current === t.key ? 'page' : undefined}
              onClick={() => {
                if (current === t.key) return;
                navigate(t.href);
              }}
            >
              {t.label}
            </button>
          ))}
      </nav>
    </header>
  );
}
