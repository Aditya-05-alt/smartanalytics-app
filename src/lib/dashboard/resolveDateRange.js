import { toCalendarISO } from '@/lib/ga4/dateRange';

/** Presets whose end date moves with "today" (must not freeze start/end). */
export const ROLLING_DATE_PRESETS = new Set([
  'today',
  'yesterday',
  '7d',
  '14d',
  '30d',
  '90d',
  '12m',
  'current_month',
  'mtd',
  'last_mtd',
  'qtd',
  'ytd',
  'all',
]);

function daysAgo(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() - n);
  return d;
}

function presetIdFromValue(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && value.preset && value.preset !== 'custom') {
    return String(value.preset);
  }
  return null;
}

/** Resolve a rolling preset id → inclusive ISO from/to (local calendar). */
export function resolveRollingDatePreset(presetId, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  let from = today;
  let to = today;
  const v = String(presetId || 'current_month');

  switch (v) {
    case 'today':
      break;
    case 'yesterday':
      from = daysAgo(today, 1);
      to = daysAgo(today, 1);
      break;
    case '7d':
      from = daysAgo(today, 6);
      break;
    case '14d':
      from = daysAgo(today, 13);
      break;
    case '30d':
      from = daysAgo(today, 29);
      break;
    case '90d':
      from = daysAgo(today, 89);
      break;
    case '12m':
      from = daysAgo(today, 364);
      break;
    case 'current_month':
    case 'mtd':
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case 'last_mtd': {
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      from = new Date(end.getFullYear(), end.getMonth(), 1);
      to = end;
      break;
    }
    case 'qtd': {
      const q = Math.floor(today.getMonth() / 3);
      from = new Date(today.getFullYear(), q * 3, 1);
      break;
    }
    case 'ytd':
      from = new Date(today.getFullYear(), 0, 1);
      break;
    case 'last_year': {
      const y = today.getFullYear() - 1;
      from = new Date(y, 0, 1);
      to = new Date(y, 11, 31);
      break;
    }
    case 'all':
      from = new Date(2020, 0, 1);
      break;
    default:
      if (/^year_\d{4}$/.test(v)) {
        const y = Number(v.slice(5));
        from = new Date(y, 0, 1);
        to = y === today.getFullYear() ? today : new Date(y, 11, 31);
      } else {
        from = daysAgo(today, 29);
      }
  }

  return { from: toCalendarISO(from), to: toCalendarISO(to) };
}

/**
 * Shared Overview + Compare date resolution.
 * Rolling presets (Current Month, Last 7 Days, …) always use today's calendar —
 * never a frozen end date from localStorage.
 */
export function resolveDashboardDateRange(value, now = new Date()) {
  const preset = presetIdFromValue(value);
  if (preset && (ROLLING_DATE_PRESETS.has(preset) || /^year_\d{4}$/.test(preset) || preset === 'last_year')) {
    return resolveRollingDatePreset(preset, now);
  }

  if (value && typeof value === 'object' && value.start && value.end) {
    return {
      from: String(value.start).slice(0, 10),
      to: String(value.end).slice(0, 10),
    };
  }

  return resolveRollingDatePreset('current_month', now);
}
