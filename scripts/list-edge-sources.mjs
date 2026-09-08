import fs from 'fs';
import { resolve } from 'path';

/**
 * Helper: prints absolute paths for edge function sources to deploy via MCP.
 * Usage: node scripts/list-edge-sources.mjs
 */
const names = ['smart-ga4-page-data', 'smart-ga4-cron-sync'];
for (const name of names) {
  const p = resolve(`supabase/functions/${name}/index.ts`);
  const src = fs.readFileSync(p, 'utf8');
  const hasXgrid = src.includes('7231326744');
  console.log(JSON.stringify({ name, path: p, bytes: src.length, hasXgrid }));
}
