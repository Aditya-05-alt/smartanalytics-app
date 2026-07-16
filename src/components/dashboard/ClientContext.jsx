'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import { usePathname } from 'next/navigation';
import { CATEGORIES } from '@/lib/data/categories';
import { createClient } from '@/lib/supabase/client';
import {
  dealerScopeFromPathname,
  readStoredDealerIdForScope,
  resolveDealerForScope,
  writeStoredDealerIdForScope,
} from '@/lib/dashboard/dashboardPrefs';
import { ALL_DEALER_CLIENT, isAllDealerClient } from '@/lib/dashboard/allDealers';
import { DEFAULT_ACCESS } from '@/lib/access/permissions';

const ClientContext = createContext(null);

const FALLBACK_CATEGORY = 'rv';

function normalizeRow(row) {
  return {
    id: row.id,
    name: row.customer_name || 'Unnamed dealer',
    hootId: row.hoot_id || null,
    hootUrl: row.hoot_url || null,
    ga4CustomerId: row.ga4_customer_id || null,
    websitePlatform: row.website_platform || null,
    isActive: row.is_active !== false,
    category: FALLBACK_CATEGORY,
  };
}

export function ClientProvider({ children }) {
  const pathname = usePathname();
  const dealerScope = useMemo(
    () => dealerScopeFromPathname(pathname),
    [pathname],
  );

  const [dealers, setDealers] = useState([]);
  const [client, setClient] = useState(ALL_DEALER_CLIENT);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDealers() {
      let resolvedAccess = DEFAULT_ACCESS;
      try {
        const accessResponse = await fetch('/api/auth/access', {
          credentials: 'same-origin',
        });
        const accessJson = await accessResponse.json();
        if (accessResponse.ok && accessJson?.access) {
          resolvedAccess = accessJson.access;
        }
      } catch {
        // Preserve legacy full access if the access endpoint is unavailable.
      }
      if (!cancelled) setAccess(resolvedAccess);

      const supabase = createClient();
      if (!supabase) {
        if (!cancelled) {
          setError('Supabase is not configured.');
          setLoading(false);
        }
        return;
      }

      let dealerQuery = supabase
        .from('smart_hoot_config')
        .select(
          'id, customer_name, hoot_id, hoot_url, ga4_customer_id, website_platform, is_active'
        )
        .eq('is_active', true)
        .order('customer_name', { ascending: true });

      if (resolvedAccess.role === 'user' && !resolvedAccess.allDealers) {
        if (!resolvedAccess.dealerIds.length) {
          if (!cancelled) {
            setDealers([]);
            setLoading(false);
          }
          return;
        }
        dealerQuery = dealerQuery.in('id', resolvedAccess.dealerIds);
      }

      const { data, error: fetchError } = await dealerQuery;

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const list = (data || [])
        .filter((r) => r && r.customer_name)
        .map(normalizeRow);

      setDealers(list);
      setLoading(false);
    }

    loadDealers();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dealers.length) return;
    const storedId = readStoredDealerIdForScope(dealerScope);
    const resolved = resolveDealerForScope(dealers, dealerScope, storedId);
    setClient(
      access?.role === 'user' && !access.allDealers && isAllDealerClient(resolved)
        ? dealers[0]
        : resolved
    );
  }, [dealers, dealerScope, access]);

  const pickClient = useCallback((c) => {
    setClient(c);
    if (c?.id != null) writeStoredDealerIdForScope(dealerScope, c.id);
  }, [dealerScope]);

  const isAllDealer = isAllDealerClient(client);

  const config = useMemo(() => {
    const key = client?.category || FALLBACK_CATEGORY;
    return CATEGORIES[key] || CATEGORIES.rv;
  }, [client]);

  const value = useMemo(
    () => ({
      client,
      config,
      pickClient,
      dealers,
      loading,
      error,
      access,
      accessLoading: access == null,
      canUseAllDealers: access?.role !== 'user' || access.allDealers,
      isAllDealer,
      allDealerClient: ALL_DEALER_CLIENT,
    }),
    [client, config, pickClient, dealers, loading, error, access, isAllDealer]
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient() {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClient must be used inside <ClientProvider>');
  return ctx;
}
