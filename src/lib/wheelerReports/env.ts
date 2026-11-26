// Server-side configuration for Wheeler Reports (runtime only).
const first = (...names: string[]) => {
  for (const name of names) {
    const v = process.env[name];
    if (v) return v;
  }
  return '';
};
const req = (...names: string[]) => {
  const v = first(...names);
  if (!v) throw new Error(`Missing environment variable ${names.join(' or ')}.`);
  return v;
};
const opt = (name: string, fallback = '') => process.env[name] || fallback;

export const env = {
  supabaseUrl: () => req('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'),
  supabaseAnonKey: () => req('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'),
  supabaseServiceKey: () => req('SUPABASE_SERVICE_ROLE_KEY'),
  cronSecret: () => req('WHEELER_REPORTS_CRON_SECRET', 'CRON_SECRET'),
  syncLookbackDays: () => Number(opt('SYNC_LOOKBACK_DAYS', '35')),

  google: {
    configured: () =>
      !!(
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
        process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_CLIENT_SECRET &&
        process.env.GOOGLE_ADS_REFRESH_TOKEN
      ),
    developerToken: () => req('GOOGLE_ADS_DEVELOPER_TOKEN'),
    clientId: () => req('GOOGLE_ADS_CLIENT_ID'),
    clientSecret: () => req('GOOGLE_ADS_CLIENT_SECRET'),
    refreshToken: () => req('GOOGLE_ADS_REFRESH_TOKEN'),
    loginCustomerId: () => opt('GOOGLE_ADS_LOGIN_CUSTOMER_ID').replace(/-/g, ''),
    apiVersion: () => opt('GOOGLE_ADS_API_VERSION', 'v21'),
  },
  meta: {
    configured: () => !!process.env.META_ACCESS_TOKEN,
    accessToken: () => req('META_ACCESS_TOKEN'),
    apiVersion: () => opt('META_API_VERSION', 'v23.0'),
    leadActionTypes: () =>
      opt(
        'META_LEAD_ACTION_TYPES',
        'lead,onsite_conversion.lead_grouped,offsite_conversion.fb_pixel_lead',
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
  },

  /** Scout RV website leads API (A&L Media Cost). */
  scout: {
    configured: () => !!process.env.SCOUT_RV_API_KEY,
    apiKey: () => req('SCOUT_RV_API_KEY'),
    leadsUrl: () =>
      opt('SCOUT_RV_LEADS_URL', 'https://www.scout-rv.com/api/content-api/v1/leads'),
  },
};
