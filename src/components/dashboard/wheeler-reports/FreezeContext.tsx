'use client';

import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import FreezeScreen from './FreezeScreen';

type Tab = 'report' | 'other-costs' | 'data';

type NavApi = {
  tab: Tab | null;
  navigate: (href: string) => void;
  /** Full client switch with freeze loader. */
  navigateDealer: (href: string) => void;
  /** Drop cached tab UI so the next paint / refresh shows fresh server data. */
  invalidate: (tabs?: Tab[]) => void;
};

export const FreezeNavContext = createContext<NavApi | null>(null);
const DEALER_SWITCH_KEY = 'wr-dealer-switching';

export function useFreezeNav() {
  const ctx = useContext(FreezeNavContext);
  if (!ctx) throw new Error('useFreezeNav must be used inside FreezeProvider');
  return ctx;
}

function tabFromPath(path: string | null): Tab | null {
  if (!path) return null;
  if (path.includes('/other-costs')) return 'other-costs';
  if (path.includes('/data')) return 'data';
  if (path.includes('/report')) return 'report';
  return null;
}

function readDealerSwitchFlag() {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(DEALER_SWITCH_KEY) === '1';
  } catch {
    return false;
  }
}

function isRouteLoading(node: ReactNode) {
  return (
    isValidElement(node) &&
    (node.props as { 'data-wr-loading'?: string })['data-wr-loading'] === '1'
  );
}

export function FreezeProvider({
  header,
  children,
}: {
  header?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const pathTab = tabFromPath(pathname);
  const [optimisticTab, setOptimisticTab] = useState<Tab | null>(null);
  const [dealerLoading, setDealerLoading] = useState(readDealerSwitchFlag);
  const tab = optimisticTab ?? pathTab;

  // Persist each tab's last UI so switching back is instant (no remount / no loader).
  const cacheRef = useRef<Partial<Record<Tab, ReactNode>>>({});
  const [, bump] = useState(0);
  if (pathTab != null && !dealerLoading && !isRouteLoading(children)) {
    cacheRef.current[pathTab] = children;
  }

  useEffect(() => {
    if (optimisticTab && pathTab === optimisticTab) setOptimisticTab(null);
  }, [pathTab, optimisticTab]);

  useEffect(() => {
    if (!pathname) return;
    const m = pathname.match(/^(.*\/wheeler-reports\/c\/[^/]+)/);
    if (!m) return;
    const base = m[1];
    router.prefetch(`${base}/report`);
    router.prefetch(`${base}/other-costs`);
    router.prefetch(`${base}/data`);
  }, [pathname, router]);

  // Clear dealer loader once the new client route has painted.
  useEffect(() => {
    if (!dealerLoading) return;
    try {
      sessionStorage.removeItem(DEALER_SWITCH_KEY);
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => setDealerLoading(false), 500);
    return () => window.clearTimeout(t);
  }, [dealerLoading, pathname]);

  const navigate = useCallback(
    (href: string) => {
      const next = tabFromPath(href);
      if (next) {
        setOptimisticTab(next);
        if (cacheRef.current[next]) bump((n) => n + 1);
      }
      router.push(href);
    },
    [router],
  );

  const navigateDealer = useCallback(
    (href: string) => {
      try {
        sessionStorage.setItem(DEALER_SWITCH_KEY, '1');
      } catch {
        /* ignore */
      }
      setDealerLoading(true);
      cacheRef.current = {};
      router.push(href);
    },
    [router],
  );

  const invalidate = useCallback((tabs?: Tab[]) => {
    if (!tabs?.length) {
      cacheRef.current = {};
    } else {
      for (const t of tabs) delete cacheRef.current[t];
    }
    bump((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ tab, navigate, navigateDealer, invalidate }),
    [tab, navigate, navigateDealer, invalidate],
  );
  const cached = cacheRef.current;
  const keys = Object.keys(cached) as Tab[];
  const show = tab ?? pathTab;
  const waiting = Boolean(show && !cached[show]);

  return (
    <FreezeNavContext.Provider value={value}>
      {header}
      <div className="wr-body">
        <FreezeScreen active={dealerLoading || waiting} />
        {keys.map((k) => (
          <div
            key={k}
            className="wr-tab-panel"
            data-active={show === k ? 'true' : 'false'}
            aria-hidden={show !== k}
          >
            {cached[k]}
          </div>
        ))}
        {show && !cached[show] && pathTab === show && !isRouteLoading(children) ? children : null}
      </div>
    </FreezeNavContext.Provider>
  );
}
