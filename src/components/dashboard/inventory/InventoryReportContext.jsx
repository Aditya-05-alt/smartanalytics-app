'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useClient } from '@/components/dashboard/ClientContext';
import {
  fetchInventoryReport,
  inventoryReportExcludesAllDealers,
  resolveInventoryReportClientId,
} from '@/lib/inventory/inventoryReport';
import {
  DEFAULT_INVENTORY_FILTERS,
  mergeInventoryFilterOptions,
  normalizeInventoryFilters,
} from '@/lib/inventory/inventoryReportFilters';
import {
  defaultInventoryReportDate,
  normalizeInventoryReportDate,
  readStoredInventoryReportDate,
  writeStoredInventoryReportDate,
} from '@/lib/inventory/inventoryReportPrefs';

const InventoryReportContext = createContext(null);

export function InventoryReportProvider({ children }) {
  const { client, config, dealers, pickClient, isAllDealer } = useClient();

  const [reportDate, setReportDateState] = useState(
    () => readStoredInventoryReportDate() || defaultInventoryReportDate(),
  );
  const [filters, setFiltersState] = useState(DEFAULT_INVENTORY_FILTERS);
  const [sections, setSections] = useState(null);
  const [inventoryList, setInventoryList] = useState(null);
  const [rpcFilterOptions, setRpcFilterOptions] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const setReportDate = useCallback((next) => {
    const normalized = normalizeInventoryReportDate(next);
    setReportDateState(normalized);
    writeStoredInventoryReportDate(normalized);
  }, []);

  const setFilter = useCallback((key, value) => {
    setFiltersState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState(DEFAULT_INVENTORY_FILTERS);
  }, []);

  const filterOptions = useMemo(
    () => mergeInventoryFilterOptions(rpcFilterOptions, config),
    [rpcFilterOptions, config],
  );

  const clientId = useMemo(
    () => resolveInventoryReportClientId(client, dealers),
    [client, dealers],
  );

  useEffect(() => {
    if (!inventoryReportExcludesAllDealers() || !isAllDealer) return;
    const first = dealers.find((d) => d?.id);
    if (first) pickClient(first);
  }, [isAllDealer, dealers, pickClient]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchInventoryReport({
      clientId,
      reportDate,
      filters: normalizeInventoryFilters(filters),
    })
      .then((result) => {
        if (cancelled) return;
        if (result.ready) {
          setSections(result.sections ?? {});
          setInventoryList(result.inventoryList ?? null);
          setRpcFilterOptions(result.filterOptions ?? null);
          setMeta(result.meta ?? null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load inventory report.');
          setSections({});
          setInventoryList({ rows: [], totalUnits: 0, totalValue: 0, averagePrice: 0 });
          setRpcFilterOptions(null);
          setMeta(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, reportDate, filters]);

  const value = useMemo(
    () => ({
      reportDate,
      setReportDate,
      filters,
      setFilter,
      clearFilters,
      filterOptions,
      sections,
      inventoryList,
      meta,
      error,
      loading,
      showLocationFilter: config?.showLoc !== false,
      typeHeader: config?.typeH || 'Type',
    }),
    [
      reportDate,
      setReportDate,
      filters,
      setFilter,
      clearFilters,
      filterOptions,
      sections,
      inventoryList,
      meta,
      error,
      loading,
      config,
    ],
  );

  return (
    <InventoryReportContext.Provider value={value}>
      {children}
    </InventoryReportContext.Provider>
  );
}

export function useInventoryReport() {
  const ctx = useContext(InventoryReportContext);
  if (!ctx) {
    throw new Error('useInventoryReport must be used within InventoryReportProvider');
  }
  return ctx;
}
