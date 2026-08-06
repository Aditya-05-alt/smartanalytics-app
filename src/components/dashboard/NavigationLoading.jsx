'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const NavigationLoadingContext = createContext(null);

function isInternalNavClick(event) {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  const anchor = event.target?.closest?.('a[href]');
  if (!anchor) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;

  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false;
  }
  if (/^https?:\/\//i.test(href)) {
    try {
      if (new URL(href).origin !== window.location.origin) return false;
    } catch {
      return false;
    }
  }

  try {
    const next = new URL(href, window.location.origin);
    const currentPath = window.location.pathname;
    const currentSearch = window.location.search;
    if (next.pathname === currentPath && next.search === currentSearch) return false;
  } catch {
    return false;
  }

  return true;
}

export function NavigationLoadingProvider({ children }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navPending, setNavPending] = useState(false);
  const dataLoadsRef = useRef(0);
  const [dataPending, setDataPending] = useState(false);

  const start = useCallback(() => setNavPending(true), []);
  const stop = useCallback(() => setNavPending(false), []);

  const beginData = useCallback(() => {
    dataLoadsRef.current += 1;
    setDataPending(true);
  }, []);

  const endData = useCallback(() => {
    dataLoadsRef.current = Math.max(0, dataLoadsRef.current - 1);
    if (dataLoadsRef.current === 0) setDataPending(false);
  }, []);

  // Route changes clear nav-only pending; in-page data loads keep the line via dataPending.
  useEffect(() => {
    setNavPending(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    const onClick = (event) => {
      if (isInternalNavClick(event)) setNavPending(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Safety: clear nav pending if navigation stalls.
  useEffect(() => {
    if (!navPending) return undefined;
    const timer = window.setTimeout(() => setNavPending(false), 12000);
    return () => window.clearTimeout(timer);
  }, [navPending]);

  const pending = navPending || dataPending;

  const value = useMemo(
    () => ({ pending, start, stop, beginData, endData }),
    [pending, start, stop, beginData, endData]
  );

  return (
    <NavigationLoadingContext.Provider value={value}>
      {children}
      {pending ? (
        <div className="nav-progress" role="progressbar" aria-label="Loading page" aria-busy="true">
          <div className="nav-progress-bar" />
        </div>
      ) : null}
    </NavigationLoadingContext.Provider>
  );
}

export function useNavigationLoading() {
  const ctx = useContext(NavigationLoadingContext);
  if (!ctx) {
    return {
      pending: false,
      start: () => {},
      stop: () => {},
      beginData: () => {},
      endData: () => {},
    };
  }
  return ctx;
}
