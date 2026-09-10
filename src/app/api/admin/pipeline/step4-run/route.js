import { NextResponse } from 'next/server';
import { coerceDateRange } from '@/lib/pipeline/dates';
import { requireAdminPipeline } from '@/lib/pipeline/pipelineAuth';
import { runPipelineStep4 } from '@/lib/pipeline/step4Run';

export const maxDuration = 300;

/**
 * Step 4 full dealer run:
 * sync logic_2 (if blank) → Step 2 → Step 3 → apply logic_2 path fill →
 * breakdown + exception leftovers.
 *
 * POST { clientId, from, to, syncLogic2FromLive?: true, runSteps23?: true, applyLogic2Fill?: true }
 */
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

  const { from, to } = coerceDateRange(body.from, body.to);
  if (!from || !to) {
    return NextResponse.json({ error: 'Missing or invalid from / to dates' }, { status: 400 });
  }

  try {
    const result = await runPipelineStep4(auth.supabase, clientId, {
      from,
      to,
      syncLogic2FromLive: body.syncLogic2FromLive !== false,
      runSteps23: body.runSteps23 !== false,
      applyLogic2Fill: body.applyLogic2Fill !== false,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Step 4 run failed' },
      { status: 500 }
    );
  }
}
