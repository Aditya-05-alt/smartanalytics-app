import { NextResponse } from 'next/server';
import { requireAdminPipeline } from '@/lib/pipeline/pipelineAuth';

export const maxDuration = 60;

/**
 * Exception URLs: Unknown/Other that still do not match smart_vdp_logic_2.
 * GET ?clientId=&from=&to=
 */
export async function GET(request) {
  const auth = await requireAdminPipeline();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const clientId = String(searchParams.get('clientId') || '').trim();
  const from = String(searchParams.get('from') || '').slice(0, 10);
  const to = String(searchParams.get('to') || '').slice(0, 10);

  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
  }
  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from or to date' }, { status: 400 });
  }

  const { data: logicRow } = await auth.supabase
    .from('smart_vdp_logic_2')
    .select('vdp_logic, dealer_name')
    .eq('dealer_id', clientId)
    .maybeSingle();

  const { data, error } = await auth.supabase.rpc('get_pipeline_exception_urls', {
    p_client_id: clientId,
    p_from: from,
    p_to: to,
  });

  if (error) {
    return NextResponse.json(
      {
        error:
          error.message ||
          'Failed to load exception URLs — deploy get_pipeline_exception_urls.sql',
      },
      { status: 500 }
    );
  }

  const urls = Array.isArray(data) ? data : [];
  const totalViews = urls.reduce((s, u) => s + (Number(u.views) || 0), 0);
  const totalRows = urls.reduce((s, u) => s + (Number(u.rows) || 0), 0);
  const hasLogic2 = Boolean(String(logicRow?.vdp_logic || '').trim());

  return NextResponse.json({
    clientId,
    from,
    to,
    hasLogic2,
    logic2DealerName: logicRow?.dealer_name ?? null,
    uniqueUrls: urls.length,
    totalRows,
    totalViews,
    urls,
  });
}
