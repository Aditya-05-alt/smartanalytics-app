import { DEALER_CATEGORY_OPTIONS } from '@/lib/dealers/fields';
import { ALL_DEALER_ID } from '@/lib/dashboard/allDealers';

/** Empty compare-side selection. */
export const EMPTY_COMPARE_SELECTION = Object.freeze({
  type: 'none', // 'none' | 'all' | 'category' | 'dealers'
  category: null,
  dealerIds: [],
});

export function createDealerSelection(dealerIds) {
  const ids = [...new Set((dealerIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { ...EMPTY_COMPARE_SELECTION };
  return { type: 'dealers', category: null, dealerIds: ids };
}

export function createAllSelection() {
  return { type: 'all', category: null, dealerIds: [] };
}

export function createCategorySelection(category) {
  const cat = String(category || '').trim();
  if (!cat) return { ...EMPTY_COMPARE_SELECTION };
  return { type: 'category', category: cat, dealerIds: [] };
}

export function isSelectionReady(selection) {
  if (!selection || selection.type === 'none') return false;
  if (selection.type === 'all' || selection.type === 'category') return true;
  return selection.type === 'dealers' && selection.dealerIds?.length > 0;
}

export function selectionKey(selection) {
  if (!selection || selection.type === 'none') return 'none';
  if (selection.type === 'all') return 'all';
  if (selection.type === 'category') return `cat:${selection.category || ''}`;
  return `d:${[...(selection.dealerIds || [])].sort().join(',')}`;
}

/** Dealers that have a GA4 customer id (required for channel fetch). */
export function dealersWithGa4(dealers) {
  return (dealers || []).filter((d) => d?.ga4CustomerId);
}

/**
 * Resolve a compare selection to concrete dealer objects.
 * @param {{ type: string, category?: string|null, dealerIds?: string[] }} selection
 * @param {object[]} dealers — full selectable list (not All Dealers sentinel)
 * @param {{ pageType?: string }} [opts] — when pageType is VDP, All Dealers respects showAllDealersVdp
 */
export function resolveSelectionDealers(selection, dealers, opts = {}) {
  const pageType = String(opts.pageType || 'VDP').toUpperCase();
  let list = dealersWithGa4(dealers);

  // Match Overview All Dealers inclusion toggles for portfolio aggregates.
  if (selection?.type === 'all' || selection?.type === 'category') {
    if (pageType === 'VDP') {
      list = list.filter((d) => d.showAllDealersVdp !== false);
    } else if (pageType === 'ALL') {
      list = list.filter((d) => d.showAllDealersAll !== false);
    } else if (pageType === 'SRP') {
      list = list.filter((d) => d.showAllDealersSrp !== false);
    }
  }

  if (!selection || selection.type === 'none') return [];
  if (selection.type === 'all') return list;
  if (selection.type === 'category') {
    const cat = selection.category;
    return list.filter((d) => d.dealerCategory === cat);
  }
  if (selection.type === 'dealers') {
    const idSet = new Set((selection.dealerIds || []).map(String));
    return dealersWithGa4(dealers).filter((d) => idSet.has(String(d.id)));
  }
  return [];
}

export function selectionLabel(selection, dealers = [], opts = {}) {
  if (!selection || selection.type === 'none') return '';
  if (selection.type === 'all') return 'All Dealers';
  if (selection.type === 'category') {
    const resolved = resolveSelectionDealers(selection, dealers, opts);
    const n = resolved.length;
    return n > 0 ? `All ${selection.category} (${n})` : `All ${selection.category}`;
  }
  const ids = selection.dealerIds || [];
  if (ids.length === 1) {
    const d = (dealers || []).find((x) => String(x.id) === String(ids[0]));
    return d?.name || '1 dealer';
  }
  if (ids.length > 1) return `${ids.length} dealers`;
  return '';
}

/** Categories that appear in the current dealer list (stable order). */
export function categoriesPresentInDealers(dealers) {
  const present = new Set(
    (dealers || []).map((d) => d.dealerCategory).filter(Boolean)
  );
  return DEALER_CATEGORY_OPTIONS.filter((c) => present.has(c));
}

export function selectionFromDealer(dealer) {
  if (!dealer?.id || String(dealer.id) === ALL_DEALER_ID) {
    return { ...EMPTY_COMPARE_SELECTION };
  }
  return createDealerSelection([dealer.id]);
}
