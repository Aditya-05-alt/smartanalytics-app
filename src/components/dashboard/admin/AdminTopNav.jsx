'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  // { href: '/dashboard/admin', label: 'Providers' },
  { href: '/dashboard/admin/pipeline', label: 'Pipeline' },
  // { href: '/dashboard/admin/ga4-daily', label: 'GA4 Page Views' },
  { href: '/reports/date-wise-views', label: 'Date-wise Views' },
];

export default function AdminTopNav() {
  const pathname = usePathname();

  return (
    <nav className="admin-topnav" aria-label="Admin sections">
      {LINKS.map((link) => {
        const active =
          link.href === '/reports/date-wise-views'
            ? pathname.startsWith('/reports')
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`admin-topnav-link ${active ? 'active' : ''}`}
            prefetch={false}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
