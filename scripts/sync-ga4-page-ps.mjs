/**
 * Load raw GA4 page data into smart_ga4_page_ps_data (page_path = pathname + query string).
 * Does NOT touch the smart-ga4-page-data edge function or smart_ga4_page_data.
 *
 * Usage:
 *   node scripts/sync-ga4-page-ps.mjs --clientId=1421445735 --from=2026-08-01 --to=2026-08-31
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { JWT } from 'google-auth-library';
import { buildVdpMatchers, classifyPage } from '../src/lib/ga4/classifyPage.js';
import { coerceDateRange } from '../src/lib/pipeline/dates.js';
import { loadGcpServiceAccountCredentials } from '../src/lib/pipeline/gcpCredentials.js';

const PAGE_TABLE = 'smart_ga4_page_ps_data';
const CONFIG_TABLE = 'smart_ga4_config';
const CHUNK_SIZE = 500;
const PAGE_SIZE = 1500;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnv() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(root, '..', '.env.local');
  return Object.fromEntries(
    fs
      .readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        const val = l.slice(i + 1).trim();
        return [l.slice(0, i).trim(), val.replace(/^["']|["']$/g, '')];
      })
  );
}

function parseArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function channelNorm(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/ /g, '_')
    .replace(/\//g, '_');
}

function pagePathFromLocation(loc) {
  if (!loc) return '';
  try {
    const u = new URL(loc);
    return u.pathname + u.search;
  } catch {
    return loc;
  }
}

async function getGa4Token() {
  const credentials = loadGcpServiceAccountCredentials();
  const authClient = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
  const { token } = await authClient.getAccessToken();
  if (!token) throw new Error('Failed to get GA4 access token');
  return token;
}

async function fetchDealerConfig(supabase, clientId) {
  const { data, error } = await supabase
    .from(CONFIG_TABLE)
    .select('client_id, ga4_property_id, account_name, is_active')
    .eq('is_active', true)
    .eq('client_id', clientId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Config fetch failed: ${error.message}`);
  if (!data) throw new Error(`No active smart_ga4_config for client_id ${clientId}`);
  return { ...data, vdp_url_pattern: null };
}

async function main() {
  const args = parseArgs();
  const clientId = String(args.clientId || '').trim();
  const { from: dateFrom, to: dateTo, dates: allDates } = coerceDateRange(
    args.from,
    args.to
  );

  if (!clientId) throw new Error('--clientId is required');
  if (!allDates.length) throw new Error('Invalid --from / --to date range');

  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v;
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env in .env.local');

  const supabase = createClient(url, key);
  const dealer = await fetchDealerConfig(supabase, clientId);
  const propertyId = String(dealer.ga4_property_id || '')
    .replace('properties/', '')
    .trim();
  const accountName = dealer.account_name || clientId;
  const vdpMatchers = buildVdpMatchers(dealer.vdp_url_pattern ?? null);
  const token = await getGa4Token();

  console.log(`PS GA4 sync — ${accountName} (${clientId})`);
  console.log(`Table: ${PAGE_TABLE} · page_path includes query string`);
  console.log(`Range: ${dateFrom} → ${dateTo} (${allDates.length} days)`);

  let totalRows = 0;

  for (const dateStr of allDates) {
    await supabase
      .from(PAGE_TABLE)
      .delete()
      .eq('client_id', clientId)
      .eq('report_date', dateStr);

    let offset = 0;
    let hasMore = true;
    let dayRows = 0;

    while (hasMore) {
      const res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: dateStr, endDate: dateStr }],
            dimensions: [
              { name: 'pageLocation' },
              { name: 'pageTitle' },
              { name: 'sessionDefaultChannelGroup' },
              { name: 'sessionSource' },
              { name: 'sessionMedium' },
              { name: 'sessionCampaignName' },
            ],
            metrics: [
              { name: 'screenPageViews' },
              { name: 'totalUsers' },
              { name: 'newUsers' },
              { name: 'sessions' },
            ],
            limit: PAGE_SIZE,
            offset,
          }),
        }
      );

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`GA4 API ${res.status}: ${txt.slice(0, 300)}`);
      }

      const body = await res.json();
      const rows = body.rows || [];
      if (!rows.length) {
        hasMore = false;
        break;
      }

      const pageData = rows.map((row) => {
        const dv = row.dimensionValues;
        const mv = row.metricValues;
        const loc = dv?.[0]?.value || '';
        const path = pagePathFromLocation(loc);
        const src = dv?.[3]?.value || '(direct)';
        const med = dv?.[4]?.value || '(none)';
        const pageType = classifyPage(loc, path, vdpMatchers);
        return {
          client_id: clientId,
          ga4_property_id: propertyId,
          account_name: accountName,
          report_date: dateStr,
          page_location: loc,
          page_path: path,
          page_title: dv?.[1]?.value || '',
          channel: channelNorm(dv?.[2]?.value),
          source: src,
          medium: med,
          source_medium: `${src} / ${med}`,
          session_campaign: dv?.[5]?.value || '(not set)',
          views: parseInt(mv?.[0]?.value || '0', 10) || 0,
          total_users: parseInt(mv?.[1]?.value || '0', 10) || 0,
          new_users: parseInt(mv?.[2]?.value || '0', 10) || 0,
          sessions: parseInt(mv?.[3]?.value || '0', 10) || 0,
          ga4_page_type: pageType,
          vdp_conditions: pageType.startsWith('VDP'),
        };
      });

      for (let j = 0; j < pageData.length; j += CHUNK_SIZE) {
        const chunk = pageData.slice(j, j + CHUNK_SIZE);
        const { error } = await supabase.from(PAGE_TABLE).insert(chunk);
        if (error) throw new Error(`Insert ${dateStr}: ${error.message}`);
        dayRows += chunk.length;
        await delay(5);
      }

      if (rows.length < PAGE_SIZE) hasMore = false;
      else {
        offset += PAGE_SIZE;
        await delay(100);
      }
    }

    totalRows += dayRows;
    console.log(`${dateStr}: ${dayRows.toLocaleString()} rows`);
  }

  const { count } = await supabase
    .from(PAGE_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('report_date', dateFrom)
    .lte('report_date', dateTo);

  const { data: sample } = await supabase
    .from(PAGE_TABLE)
    .select('page_path, page_location, views')
    .eq('client_id', clientId)
    .like('page_path', '%default.asp%')
    .limit(3);

  console.log(`\nDONE — inserted ${totalRows.toLocaleString()} rows`);
  console.log(`Table count for range: ${count ?? '?'}`);
  if (sample?.length) {
    console.log('Sample default.asp page_path rows:');
    for (const r of sample) console.log(`  ${r.page_path.slice(0, 120)}… views=${r.views}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
