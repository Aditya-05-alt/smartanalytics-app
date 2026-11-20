// Scheduled sync of every client's Google Ads and Meta Ads data.
// Called by the "cron" container (docker-compose.yml) with: Authorization: Bearer $CRON_SECRET
import { timingSafeEqual } from 'node:crypto';
import { adminClient } from '@/lib/wheelerReports/supabase/server';
import { env } from '@/lib/wheelerReports/env';
import { syncClient } from '@/lib/wheelerReports/sync';
import type { Client, Platform } from '@/lib/wheelerReports/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const authorized = (req: Request) => {
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${env.cronSecret()}`);
  return got.length === want.length && timingSafeEqual(got, want);
};

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const sb = adminClient();
  const { data: clients, error } = await sb.from('wheeler_reports_clients').select('id, slug, name, timezone, google_ads_customer_id, meta_ad_account_id');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results: Record<string, unknown> = {};
  for (const c of (clients ?? []) as Client[]) {
    const platforms: Platform[] = [];
    if (c.google_ads_customer_id && env.google.configured()) platforms.push('google');
    if (c.meta_ad_account_id && env.meta.configured()) platforms.push('meta');
    if (platforms.length) results[c.slug] = await syncClient(sb, c, platforms);
  }
  return Response.json({ ok: true, results });
}
