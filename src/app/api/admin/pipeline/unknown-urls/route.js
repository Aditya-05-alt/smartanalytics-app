import { NextResponse } from 'next/server';
import { requireAdminPipeline } from '@/lib/pipeline/pipelineAuth';

export const maxDuration = 60;

/**
 * Unknown / Other URLs in smart_final_data for a dealer + date range.
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

  const { data, error } = await auth.supabase.rpc('get_pipeline_unknown_urls', {
    p_client_id: clientId,
    p_from: from,
    p_to: to,
  });

  if (error) {
    // Fallback if RPC not deployed yet — inline aggregate via SQL-friendly select.
    const { data: rows, error: qErr } = await auth.supabase
      .from('smart_final_data')
      .select('page_path, page_location, views, inv_make, inv_url, vdp_conditions')
      .eq('client_id', clientId)
      .gte('report_date', from)
      .lte('report_date', to)
      .limit(200000);

    if (qErr) {
      return NextResponse.json(
        { error: qErr.message || error.message || 'Failed to load unknown URLs' },
        { status: 500 }
      );
    }

    const map = new Map();
    for (const row of rows || []) {
      const make = String(row.inv_make || '').trim().toLowerCase();
      const blankMake = !make || make === 'unknown' || make === 'other';
      const blankUrl = !String(row.inv_url || '').trim();
      const notVdp = row.vdp_conditions !== true;
      if (!blankMake && !blankUrl && !notVdp) continue;

      const path = String(row.page_path || '').trim();
      if (!path) continue;
      const prev = map.get(path) || {
        page_path: path,
        page_location: row.page_location || null,
        rows: 0,
        views: 0,
      };
      prev.rows += 1;
      prev.views += Number(row.views) || 0;
      if (!prev.page_location && row.page_location) {
        prev.page_location = row.page_location;
      }
      map.set(path, prev);
    }

    const urls = [...map.values()].sort(
      (a, b) => b.views - a.views || a.page_path.localeCompare(b.page_path)
    );
    const totalViews = urls.reduce((s, u) => s + u.views, 0);
    const totalRows = urls.reduce((s, u) => s + u.rows, 0);

    return NextResponse.json({
      clientId,
      from,
      to,
      uniqueUrls: urls.length,
      totalRows,
      totalViews,
      urls,
      source: 'fallback',
    });
  }

  const urls = Array.isArray(data) ? data : [];
  const totalViews = urls.reduce((s, u) => s + (Number(u.views) || 0), 0);
  const totalRows = urls.reduce((s, u) => s + (Number(u.rows) || 0), 0);

  return NextResponse.json({
    clientId,
    from,
    to,
    uniqueUrls: urls.length,
    totalRows,
    totalViews,
    urls,
    source: 'rpc',
  });
}
