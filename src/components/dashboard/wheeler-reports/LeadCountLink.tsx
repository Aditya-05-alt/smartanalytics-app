'use client';

import type { ReactNode } from 'react';
import { useContext } from 'react';
import { useRouter } from 'next/navigation';
import { FreezeNavContext } from './FreezeContext';

/** Soft-nav inside the report freeze panel — no full Smart Analytics reload. */
export default function LeadCountLink({
  href,
  children,
}: {
  href: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const freeze = useContext(FreezeNavContext);
  if (!href) return <>{children}</>;

  return (
    <a
      className="wr-lead-link"
      href={href}
      title="Open leads"
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
