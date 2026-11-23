'use client';

import type { ReactNode } from 'react';
import { useContext } from 'react';
import { useRouter } from 'next/navigation';
import { FreezeNavContext } from './FreezeContext';

/** Soft-nav for report ↔ leads within the cached report panel. */
export default function ReportNavLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const freeze = useContext(FreezeNavContext);

  return (
    <a
      className={className}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (freeze) {
          freeze.invalidate(['report']);
          freeze.navigate(href);
        } else {
          router.push(href);
        }
      }}
    >
      {children}
    </a>
  );
}
