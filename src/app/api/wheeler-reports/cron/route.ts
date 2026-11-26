// Scheduled sync of every client's Google Ads / Meta Ads data, plus A&L Scout website leads.
// Called by the "cron" container (docker-compose.yml) with: Authorization: Bearer $CRON_SECRET
import { timingSafeEqual } from 'node:crypto';
import { adminClient } from '@/lib/wheelerReports/supabase/server';
import { env } from '@/lib/wheelerReports/env';
import { syncClient } from '@/lib/wheelerReports/sync';
import { SCOUT_AL_SLUG, syncScoutLeadsForClient } from '@/lib/wheelerReports/scoutLeads';
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
  const { data: clients, error } = await sb
    .from('wheeler_reports_clients')
    .select('id, slug, name, timezone, google_ads_customer_id, meta_ad_account_id');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results: Record<string, unknown> = {};
  for (const c of (clients ?? []) as Client[]) {
    const platforms: Platform[] = [];
    if (c.google_ads_customer_id && env.google.configured()) platforms.push('google');
    if (c.meta_ad_account_id && env.meta.configured()) platforms.push('meta');
    const ads = platforms.length ? await syncClient(sb, c, platforms) : [];

    let scout: { ok: boolean; rows: number; message: string } | null = null;
    if (c.slug === SCOUT_AL_SLUG && env.scout.configured()) {
      scout = await syncScoutLeadsForClient(sb, c);
    }

    if (ads.length || scout) {
      results[c.slug] = {
        ...(ads.length ? { ads } : {}),
        ...(scout ? { scout_leads: scout } : {}),
      };
    }
  }
  return Response.json({ ok: true, results });
}
