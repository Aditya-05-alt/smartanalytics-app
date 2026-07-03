import { NextResponse } from 'next/server';
import { runScrapSyncForDealer } from '@/lib/pipeline/scrapSync';
import { requireAdminPipeline } from '@/lib/pipeline/pipelineAuth';

export const maxDuration = 120;

export async function POST(request) {
  const auth = await requireAdminPipeline();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => ({}));
  const clientId = String(body.clientId || '').trim();

  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
  }

  try {
    const dealers = await auth.supabase.rpc('get_scrap_dealers_for_sync', {
      p_client_id: clientId,
    });
    if (dealers.error) {
      throw new Error(dealers.error.message);
    }

    const dealer = (dealers.data || [])[0];
    if (!dealer) {
      return NextResponse.json(
        {
          error:
            'No scrap_link for this dealer. Add one under Admin → Vdp Logics (scrap_link column).',
        },
        { status: 400 }
      );
    }

    const reportDate =
      String(body.reportDate || '').trim() || new Date().toISOString().slice(0, 10);

    const result = await runScrapSyncForDealer(auth.supabase, dealer, reportDate);

    return NextResponse.json({
      step: 'scrap',
      table: 'smart_scrap_inventory',
      clientId: result.clientId,
      urlsFound: result.rows?.length ?? 0,
      upsertedCount: result.upsertedCount ?? 0,
      scrapeRunId: result.scrapeRunId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Scrap inventory sync failed' },
      { status: 500 }
    );
  }
}
