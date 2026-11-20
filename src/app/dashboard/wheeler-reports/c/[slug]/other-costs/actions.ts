'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireClient } from '@/lib/wheelerReports/auth';
import { userClient } from '@/lib/wheelerReports/supabase/server';

const AddSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  storeId: z.string().min(1), // a store id, or "all"
  items: z.array(z.object({ head: z.string().trim().min(1).max(60), amount: z.number().positive().max(10_000_000) })).min(1).max(30),
});

export async function addCosts(slug: string, input: z.infer<typeof AddSchema>): Promise<{ ok: boolean; message: string }> {
  const { viewer, client } = await requireClient(slug);
  const parsed = AddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Check the month, store and amounts.' };
  const { month, storeId, items } = parsed.data;
  const sb = await userClient();
  const rows = items.map((i) => ({
    client_id: client.id, store_id: storeId === 'all' ? null : storeId, month, head: i.head,
    amount: Math.round(i.amount * 100) / 100, created_by: viewer.userId,
  }));
  const { error } = await sb.from('wheeler_reports_other_costs').insert(rows);
  if (error) return { ok: false, message: "Couldn't save: " + error.message };
  revalidatePath(`/dashboard/wheeler-reports/c/${slug}`, 'layout');
  return { ok: true, message: `Saved ${rows.length} cost${rows.length > 1 ? 's' : ''}.` };
}

export async function deleteCost(slug: string, id: string): Promise<{ ok: boolean; message: string }> {
  const { client } = await requireClient(slug);
  const sb = await userClient();
  const { error, count } = await sb.from('wheeler_reports_other_costs').delete({ count: 'exact' }).eq('id', id).eq('client_id', client.id);
  if (error || !count) return { ok: false, message: "Couldn't delete that cost." };
  revalidatePath(`/dashboard/wheeler-reports/c/${slug}`, 'layout');
  return { ok: true, message: 'Deleted.' };
}

export async function addHead(slug: string, name: string): Promise<{ ok: boolean; message: string }> {
  const { client } = await requireClient(slug);
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!clean) return { ok: false, message: 'Type a cost head name first.' };
  const sb = await userClient();
  const { error } = await sb.from('wheeler_reports_cost_heads').insert({ client_id: client.id, name: clean });
  if (error && !/duplicate/i.test(error.message)) return { ok: false, message: "Couldn't add it: " + error.message };
  revalidatePath(`/dashboard/wheeler-reports/c/${slug}/other-costs`);
  return { ok: true, message: `Added ${clean} to the list.` };
}
