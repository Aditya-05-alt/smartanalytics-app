'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState, useEffect } from 'react';
import { useClient } from './ClientContext';
import { useDropdown } from './useDropdown';
import { CATEGORIES } from '@/lib/data/categories';
import { signOutAction } from '@/lib/auth/actions';
import { createClient } from '@/lib/supabase/client';
import ThemeToggle from '@/components/ui/ThemeToggle';

const NAV = [
  // { id: 'overview',    href: '/dashboard',              label: 'Overview' },
  // { id: 'health',      href: '/dashboard/health',       label: 'Portfolio Health' },
  // { id: 'attribution', href: '/dashboard/attribution',  label: 'Attribution' },
  // { id: 'local',       href: '/dashboard/local',        label: 'Local Intel' },
  // { id: 'reports',     href: '/reports/date-wise-views', label: 'Date-wise Views' },
  { id: 'admin', href: '/dashboard/admin/pipeline', label: 'Admin' },
];

const PAGE_SIZE = 5;

function ClientPicker() {
  const { client, pickClient, dealers, loading, error } = useClient();
  const { open, toggle, close, ref } = useDropdown();

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dealers;
    return dealers.filter((d) => d.name.toLowerCase().includes(q));
  }, [dealers, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);

  const pageItems = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  useEffect(() => {
    setPage(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setPage(0);
    }
  }, [open]);

  const currentColor =
    CATEGORIES[client?.category]?.color || 'var(--acc, #4EE09C)';

  const buttonLabel = client?.name || (loading ? 'Loading dealers…' : 'Select dealer');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="client-pick" onClick={toggle} role="button" tabIndex={0}>
        <div className="cp-dot" style={{ background: currentColor }} />
        <span className="cp-name">{buttonLabel}</span>
        <span className="cp-arr">▼</span>
      </div>
      {open && (
        <div className="client-dropdown animate-fade-in">
          <div className="cd-search-wrap">
            <input
              type="text"
              className="cd-search"
              placeholder="Search dealers…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>

          <div className="cd-list">
            {loading && <div className="cd-empty">Loading dealers…</div>}
            {!loading && error && (
              <div className="cd-empty cd-error">Failed to load: {error}</div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="cd-empty">No dealers match “{query}”.</div>
            )}
            {!loading &&
              !error &&
              pageItems.map((c) => {
                const selected = client?.id === c.id;
                return (
                  <div
                    key={c.id}
                    className={`cd-item ${selected ? 'sel' : ''}`}
                    onClick={() => {
                      pickClient(c);
                      close();
                    }}
                  >
                    <div className="cd-dot" style={{ background: currentColor }} />
                    <span className="cd-name">{c.name}</span>
                    {selected && (
                      <span
                        className="cd-badge"
                        style={{ background: 'var(--gd)', color: 'var(--green)' }}
                      >
                        Active
                      </span>
                    )}
                  </div>
                );
              })}
          </div>

          {!loading && !error && filtered.length > PAGE_SIZE && (
            <div className="cd-pager">
              <button
                type="button"
                className="cd-pg-btn"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
              >
                ‹ Prev
              </button>
              <span className="cd-pg-info">
                {safePage + 1} / {totalPages}
                <span className="cd-pg-count">· {filtered.length} dealers</span>
              </span>
              <button
                type="button"
                className="cd-pg-btn"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
              >
                Next ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function userInitials(label) {
  const text = String(label || '').trim();
  if (!text) return 'U';
  if (text.includes('@')) return text.slice(0, 2).toUpperCase();
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  }
  return text.slice(0, 2).toUpperCase();
}

function UserAccountMenu() {
  const { open, toggle, close, ref } = useDropdown();
  const [displayName, setDisplayName] = useState('Account');

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setDisplayName('Demo User');
      return undefined;
    }

    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const user = data?.user;
      const name =
        user?.user_metadata?.full_name
        || user?.user_metadata?.name
        || user?.email?.split('@')[0]
        || 'Account';
      setDisplayName(name);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const initials = useMemo(() => userInitials(displayName), [displayName]);

  return (
    <div ref={ref} className="tb-user-menu">
      <button
        type="button"
        className="tb-user-trigger"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="tb-avatar">{initials}</span>
        <span className="tb-user-name">{displayName}</span>
        <span className="cp-arr">▼</span>
      </button>
      {open && (
        <div className="tb-user-dropdown animate-fade-in" role="menu">
          <div className="tb-user-dropdown-label">{displayName}</div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="tb-user-dropdown-item"
              role="menuitem"
              onClick={close}
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  const pathname = usePathname();
  const hideDealerPicker =
    pathname?.startsWith('/dashboard/admin') || pathname?.startsWith('/reports');

  const activeId = useMemo(() => {
    if (pathname.startsWith('/dashboard/admin')) return 'admin';
    // if (pathname === '/dashboard') return 'overview';
    // if (pathname.startsWith('/reports')) return 'reports';
    // const seg = pathname.replace('/dashboard/', '').split('/')[0];
    // return seg || 'overview';
    return 'admin';
  }, [pathname]);

  return (
    <header className="topbar">
      <Link href="/dashboard/admin/pipeline" className="logo" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 26, height: 26, background: 'var(--acc)',
            borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            boxShadow: '0 6px 18px -6px rgba(200,232,122,.4)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 12L6 7L9 10L13 4" stroke="#14171C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span
          className="font-display"
          style={{ fontSize: 15, fontWeight: 700, color: 'var(--t)', letterSpacing: '-0.01em' }}
        >
          SmartAnalytics
        </span>
      </Link>

      {!hideDealerPicker && (
        <>
          <div className="tb-div" />
          <ClientPicker />
        </>
      )}

      <nav className="topbar-right" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        {NAV.map((n) => (
          <Link
            key={n.id}
            href={n.href}
            className={`tb-btn ${activeId === n.id ? 'active' : ''}`}
            prefetch={false}
          >
            {n.label}
          </Link>
        ))}
        <div className="tb-div" />
        <ThemeToggle variant="icon" />
        <UserAccountMenu />
      </nav>
    </header>
  );
}
