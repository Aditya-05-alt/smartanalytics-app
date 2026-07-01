'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import { CATEGORIES } from '@/lib/data/categories';
import { createClient } from '@/lib/supabase/client';
import {
  readStoredDealerId,
  resolveDealerFromList,
  writeStoredDealerId,
} from '@/lib/dashboard/dashboardPrefs';
import { ALL_DEALER_CLIENT, isAllDealerClient } from '@/lib/dashboard/allDealers';

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
  const [dealers, setDealers] = useState([]);
  const [client, setClient] = useState(ALL_DEALER_CLIENT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDealers() {
      const supabase = createClient();
      if (!supabase) {
        if (!cancelled) {
          setError('Supabase is not configured.');
          setLoading(false);
        }
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('smart_hoot_config')
        .select(
          'id, customer_name, hoot_id, hoot_url, ga4_customer_id, website_platform, is_active'
        )
        .eq('is_active', true)
        .order('customer_name', { ascending: true });

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const list = (data || [])
        .filter((r) => r && r.customer_name)
        .map(normalizeRow);

      const storedId = readStoredDealerId();
      const initialClient = resolveDealerFromList(list, storedId);

      setDealers(list);
      setClient(initialClient);
      setLoading(false);
    }

    loadDealers();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickClient = useCallback((c) => {
    setClient(c);
    if (c?.id != null) writeStoredDealerId(c.id);
  }, []);

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
      isAllDealer,
      allDealerClient: ALL_DEALER_CLIENT,
    }),
    [client, config, pickClient, dealers, loading, error, isAllDealer]
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient() {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClient must be used inside <ClientProvider>');
  return ctx;
}
