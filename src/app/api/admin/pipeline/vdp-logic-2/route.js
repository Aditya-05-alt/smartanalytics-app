import { NextResponse } from 'next/server';
import { requireAdminPipeline } from '@/lib/pipeline/pipelineAuth';
import {
  joinVdpLogicPatterns,
  normalizeVdpLogicPattern,
  splitVdpLogicPatterns,
} from '@/lib/vdpLogics/fields';

const TABLE = 'smart_vdp_logic_2';

/**
 * GET  ?clientId=  → current smart_vdp_logic_2.vdp_logic for dealer
 * POST { clientId, vdpLogic | vdpLogicPatterns } → save to smart_vdp_logic_2
 */
export async function GET(request) {
  const auth = await requireAdminPipeline();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const clientId = String(
    new URL(request.url).searchParams.get('clientId') || ''
  ).trim();
  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from(TABLE)
    .select('id, dealer_id, dealer_name, vdp_logic, updated_at')
    .eq('dealer_id', clientId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to load smart_vdp_logic_2' },
      { status: 500 }
    );
  }

  const vdpLogic = data?.vdp_logic ?? '';
  return NextResponse.json({
    clientId,
    found: Boolean(data),
    id: data?.id ?? null,
    dealerName: data?.dealer_name ?? null,
    vdpLogic,
    vdpLogicPatterns: splitVdpLogicPatterns(vdpLogic),
    updatedAt: data?.updated_at ?? null,
  });
}

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

  let joined = '';
  if (Array.isArray(body.vdpLogicPatterns)) {
    joined = joinVdpLogicPatterns(body.vdpLogicPatterns);
  } else if (body.vdpLogic != null) {
    joined = joinVdpLogicPatterns(splitVdpLogicPatterns(body.vdpLogic));
  } else {
    return NextResponse.json(
      { error: 'Provide vdpLogic or vdpLogicPatterns' },
      { status: 400 }
    );
  }

  const vdpLogic = joined === '' ? null : joined;

  const { data: existing, error: findErr } = await auth.supabase
    .from(TABLE)
    .select('id, dealer_name')
    .eq('dealer_id', clientId)
    .maybeSingle();

  if (findErr) {
    return NextResponse.json(
      { error: findErr.message || 'Failed to find smart_vdp_logic_2 row' },
      { status: 500 }
    );
  }

  if (!existing?.id) {
    return NextResponse.json(
      {
        error: `No smart_vdp_logic_2 row for dealer_id=${clientId}. Add the dealer to logic_2 first.`,
      },
      { status: 404 }
    );
  }

  const { data, error } = await auth.supabase
    .from(TABLE)
    .update({
      vdp_logic: vdpLogic,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .select('id, dealer_id, dealer_name, vdp_logic, updated_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to save smart_vdp_logic_2' },
      { status: 500 }
    );
  }

  const saved = data?.vdp_logic ?? '';
  return NextResponse.json({
    ok: true,
    clientId,
    id: data.id,
    dealerName: data.dealer_name,
    vdpLogic: saved,
    vdpLogicPatterns: splitVdpLogicPatterns(saved),
    updatedAt: data.updated_at,
    normalizedPreview: saved
      ? splitVdpLogicPatterns(saved).map(normalizeVdpLogicPattern)
      : [],
  });
}
