/**
 * Normalize GA4 session sources for Overview filter + breakdown.
 * Rolls up host variants we see in Referral (and elsewhere).
 */

const SOURCE_ALIASES = {
  facebook: 'facebook.com',
  fb: 'facebook.com',
  'facebook.com': 'facebook.com',
  'm.facebook.com': 'facebook.com',
  'l.facebook.com': 'facebook.com',
  'lm.facebook.com': 'facebook.com',
  'www.facebook.com': 'facebook.com',
  'fb.com': 'facebook.com',
  instagram: 'instagram.com',
  'instagram.com': 'instagram.com',
  'www.instagram.com': 'instagram.com',
  youtube: 'youtube.com',
  'youtu.be': 'youtube.com',
  'youtube.com': 'youtube.com',
  'www.youtube.com': 'youtube.com',
  'm.youtube.com': 'youtube.com',
  msn: 'msn.com',
  'msn.com': 'msn.com',
  'www.msn.com': 'msn.com',
  'ntp.msn.com': 'msn.com',
};

/** Raw host strings that map to each canonical filter key (for fast SQL equality). */
const SOURCE_RPC_EXPAND = {
  'facebook.com': [
    'facebook.com',
    'facebook',
    'fb',
    'fb.com',
    'www.facebook.com',
    'm.facebook.com',
    'l.facebook.com',
    'lm.facebook.com',
  ],
  'instagram.com': ['instagram.com', 'instagram', 'www.instagram.com'],
  'youtube.com': [
    'youtube.com',
    'youtube',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
  ],
  'msn.com': ['msn.com', 'msn', 'www.msn.com', 'ntp.msn.com'],
  '(none)': ['(none)', '', '(not set)', '(notset)', '(direct)'],
};

/** Explicit pretty names for common GA4 sources / hosts. */
const SOURCE_LABELS = {
  '(none)': 'Direct / none',
  '(not set)': 'Not set',
  '(notset)': 'Not set',
  '(direct)': 'Direct',
  '(data not available)': 'Data not available',
  google: 'Google',
  bing: 'Bing',
  yahoo: 'Yahoo',
  duckduckgo: 'DuckDuckGo',
  scout: 'Scout',
  database: 'Database',
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',
  'youtube.com': 'YouTube',
  'msn.com': 'MSN',
  'chatgpt.com': 'ChatGPT',
  'rvtrader.com': 'RV Trader',
  'cycletrader.com': 'Cycle Trader',
  'atvtrader.com': 'ATV Trader',
  'cars.com': 'Cars.com',
  'cargurus.com': 'CarGurus',
  'motohunt.com': 'MotoHunt',
  'forestriverinc.com': 'Forest River',
  'granddesignrv.com': 'Grand Design RV',
  'keystonerv.com': 'Keystone RV',
  'coachmenrv.com': 'Coachmen RV',
  'polaris.com': 'Polaris',
  'maps.apple.com': 'Apple Maps',
  'outlook.live.com': 'Outlook',
  'app.dp360crm.com': 'DP360 CRM',
  'app.drivecentric.com': 'DriveCentric',
  'app.dealercrm.com': 'Dealer CRM',
  'vinsolutions.app.coxautoinc.com': 'vAuto / VinSolutions',
};

const TLD_STRIP = /\.(com|net|org|io|co|app|info|biz|us|ca|uk)$/i;

function titleCaseToken(token) {
  if (!token) return '';
  if (/^[a-z0-9]+$/i.test(token) && token.length <= 3 && token === token.toUpperCase()) {
    return token.toUpperCase();
  }
  // Keep known acronyms
  const upper = token.toUpperCase();
  if (['RV', 'ATV', 'CRM', 'SEO', 'OEM', 'MSN', 'AI'].includes(upper)) return upper;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** Turn a host like `redlinepowersports.com` into `Redline Powersports`. */
function prettifyHost(host) {
  let h = String(host || '').trim().toLowerCase();
  if (!h) return '(none)';
  if (h.startsWith('www.')) h = h.slice(4);
  if (h.startsWith('m.')) h = h.slice(2);
  if (h.startsWith('app.')) h = `app.${h.slice(4)}`;

  // Subdomains: keep last two labels for brand (x.y.com → y), unless useful prefix
  const parts = h.split('.').filter(Boolean);
  if (parts.length >= 3) {
    const last2 = parts.slice(-2).join('.');
    if (SOURCE_LABELS[last2]) return SOURCE_LABELS[last2];
    // crm / portal style: show brand from second-level + note
    h = last2;
  }

  const withoutTld = h.replace(TLD_STRIP, '');
  const tokens = withoutTld
    .replace(/[_/]+/g, '-')
    .split('-')
    .flatMap((chunk) => chunk.split(/(?<=[a-z])(?=[A-Z0-9])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .flatMap((chunk) => {
      // Split glued words when possible: powersports → power sports is hard;
      // just split on non-letters.
      return chunk.split(/[^a-z0-9]+/i).filter(Boolean);
    })
    .filter(Boolean);

  if (tokens.length === 0) return h;

  // Common glued marketplace / brand patterns
  const joined = tokens.join('').toLowerCase();
  const glued = {
    rvtrader: 'RV Trader',
    cycletrader: 'Cycle Trader',
    atvtrader: 'ATV Trader',
    cargurus: 'CarGurus',
    motohunt: 'MotoHunt',
    forestriverinc: 'Forest River',
    granddesignrv: 'Grand Design RV',
    keystonerv: 'Keystone RV',
    coachmenrv: 'Coachmen RV',
    broadwaypowersports: 'Broadway Powersports',
    redlinepowersports: 'Redline Powersports',
    chatgpt: 'ChatGPT',
    duckduckgo: 'DuckDuckGo',
  };
  if (glued[joined]) return glued[joined];

  return tokens.map(titleCaseToken).join(' ');
}

/** Canonical source key for filters / buckets (empty → (none)). */
export function normalizeSourceKey(raw) {
  const trimmed = String(raw ?? '').trim().toLowerCase();
  if (!trimmed || trimmed === '(not set)' || trimmed === '(notset)' || trimmed === '(direct)') {
    return '(none)';
  }
  if (trimmed === '(none)') return '(none)';

  if (SOURCE_ALIASES[trimmed]) return SOURCE_ALIASES[trimmed];

  let host = trimmed;
  if (host.startsWith('www.')) host = host.slice(4);

  if (
    host === 'facebook.com' ||
    host.endsWith('.facebook.com') ||
    host === 'fb.com' ||
    host.endsWith('.fb.com')
  ) {
    return 'facebook.com';
  }
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    return 'instagram.com';
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
    return 'youtube.com';
  }
  if (host === 'msn.com' || host.endsWith('.msn.com')) {
    return 'msn.com';
  }

  return host || '(none)';
}

/** Friendly label for filter chips / donut list. */
export function sourceDisplayLabel(key) {
  const k = normalizeSourceKey(key);
  if (SOURCE_LABELS[k]) return SOURCE_LABELS[k];
  if (SOURCE_LABELS[String(key ?? '').trim().toLowerCase()]) {
    return SOURCE_LABELS[String(key).trim().toLowerCase()];
  }
  // Bare engine names / non-hosts
  if (!k.includes('.') && !k.startsWith('(')) {
    return titleCaseToken(k);
  }
  return prettifyHost(k);
}

/**
 * Expand UI source keys → raw GA4 source strings for p_sources equality match.
 * Mirrors expandChannelsForRpc so SQL stays index-friendly.
 */
export function expandSourcesForRpc(selected) {
  const keys = (Array.isArray(selected) ? selected : [])
    .map((v) => normalizeSourceKey(v))
    .filter((v) => v && v !== 'All');
  if (keys.length === 0) return undefined;

  const out = new Set();
  for (const key of keys) {
    const aliases = SOURCE_RPC_EXPAND[key];
    if (aliases?.length) {
      for (const a of aliases) out.add(a);
    } else {
      out.add(key);
      if (key !== '(none)' && !key.startsWith('www.')) out.add(`www.${key}`);
    }
  }
  return [...out];
}
