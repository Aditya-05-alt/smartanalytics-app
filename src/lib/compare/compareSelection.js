import { DEALER_CATEGORY_OPTIONS } from '@/lib/dealers/fields';
import { ALL_DEALER_ID } from '@/lib/dashboard/allDealers';

/** Empty compare-side selection. */
export const EMPTY_COMPARE_SELECTION = Object.freeze({
  type: 'none', // 'none' | 'all' | 'category' | 'dealers'
  category: null,
  categories: [],
  dealerIds: [],
});

export function createDealerSelection(dealerIds) {
  const ids = [...new Set((dealerIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { ...EMPTY_COMPARE_SELECTION };
  return { type: 'dealers', category: null, categories: [], dealerIds: ids };
}

export function createAllSelection() {
  return { type: 'all', category: null, categories: [], dealerIds: [] };
}

/** Normalize one or many category labels → unique non-empty list. */
export function normalizeCategoryList(categoryOrList) {
  const raw = Array.isArray(categoryOrList)
    ? categoryOrList
    : categoryOrList
      ? [categoryOrList]
      : [];
  return [...new Set(raw.map((c) => String(c || '').trim()).filter(Boolean))];
}

/** Categories stored on a category selection (supports legacy single `category`). */
export function selectionCategories(selection) {
  if (!selection || selection.type !== 'category') return [];
  if (Array.isArray(selection.categories) && selection.categories.length) {
    return normalizeCategoryList(selection.categories);
  }
  if (selection.category) return normalizeCategoryList(selection.category);
  return [];
}

export function createCategorySelection(categoryOrList) {
  const cats = normalizeCategoryList(categoryOrList);
  if (!cats.length) return { ...EMPTY_COMPARE_SELECTION };
  return {
    type: 'category',
    category: cats.length === 1 ? cats[0] : null,
    categories: cats,
    dealerIds: [],
  };
}

export function isSelectionReady(selection) {
  if (!selection || selection.type === 'none') return false;
  if (selection.type === 'all') return true;
  if (selection.type === 'category') return selectionCategories(selection).length > 0;
  return selection.type === 'dealers' && selection.dealerIds?.length > 0;
}

export function selectionKey(selection) {
  if (!selection || selection.type === 'none') return 'none';
  if (selection.type === 'all') return 'all';
  if (selection.type === 'category') {
    return `cat:${selectionCategories(selection).slice().sort().join(',')}`;
  }
  return `d:${[...(selection.dealerIds || [])].sort().join(',')}`;
}

/** Dealers that have a GA4 customer id (required for channel fetch). */
export function dealersWithGa4(dealers) {
  return (dealers || []).filter((d) => d?.ga4CustomerId);
}

/**
 * Resolve a compare selection to concrete dealer objects.
 * @param {{ type: string, category?: string|null, categories?: string[], dealerIds?: string[] }} selection
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
    const catSet = new Set(selectionCategories(selection));
    if (!catSet.size) return [];
    return list.filter((d) => catSet.has(d.dealerCategory));
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
    const cats = selectionCategories(selection);
    const resolved = resolveSelectionDealers(selection, dealers, opts);
    const n = resolved.length;
    if (cats.length === 1) {
      return n > 0 ? `All ${cats[0]} (${n})` : `All ${cats[0]}`;
    }
    if (cats.length > 1) {
      return n > 0
        ? `${cats.length} categories (${n})`
        : `${cats.length} categories`;
    }
    return '';
  }
  const ids = selection.dealerIds || [];
  if (ids.length === 1) {
    const d = (dealers || []).find((x) => String(x.id) === String(ids[0]));
    return d?.name || '1 dealer';
  }
  if (ids.length > 1) return `${ids.length} dealers`;
  return '';
}

/** Dealer display names for a selection (All / Category stay as one label). */
export function selectionDealerNames(selection, dealers = []) {
  if (!selection || selection.type === 'none') return [];
  if (selection.type === 'all') return ['All Dealers'];
  if (selection.type === 'category') {
    const cats = selectionCategories(selection);
    if (!cats.length) return ['Category'];
    if (cats.length === 1) return [`All ${cats[0]}`];
    return cats.map((c) => `All ${c}`);
  }
  if (selection.type !== 'dealers') return [];
  return (selection.dealerIds || [])
    .map((id) => {
      const d = (dealers || []).find((x) => String(x.id) === String(id));
      return d?.name || null;
    })
    .filter(Boolean);
}

/**
 * Header summary: "Moix Rv vs Sky River, Gerzeny's, Southland…"
 * @param {number} [maxRightNames=5]
 */
export function compareVsSummary(
  leftSelection,
  rightSelection,
  dealers = [],
  maxRightNames = 5
) {
  const leftNames = selectionDealerNames(leftSelection, dealers);
  const rightNames = selectionDealerNames(rightSelection, dealers);
  if (!leftNames.length || !rightNames.length) return '';

  const leftStr = leftNames.join(', ');
  let rightStr = rightNames.join(', ');
  if (rightNames.length > maxRightNames) {
    const shown = rightNames.slice(0, maxRightNames).join(', ');
    rightStr = `${shown} +${rightNames.length - maxRightNames} more`;
  }
  return `${leftStr} vs ${rightStr}`;
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
