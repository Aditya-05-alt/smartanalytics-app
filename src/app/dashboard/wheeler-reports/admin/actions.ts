'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/wheelerReports/auth';
import { adminClient } from '@/lib/wheelerReports/supabase/server';

export type Result = { ok: boolean; message: string } | null;
const list = (v: FormDataEntryValue | null) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const txt = (v: FormDataEntryValue | null) => String(v ?? '').trim();

export async function createClient(_p: Result, f: FormData): Promise<Result> {
  await requireAdmin();
  const name = txt(f.get('name'));
  const slug = txt(f.get('slug')).toLowerCase() || name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!name || !/^[a-z0-9-]+$/.test(slug)) return { ok: false, message: 'Enter a name (and a slug of lower-case letters, digits and dashes).' };
  const { error } = await adminClient().from('wheeler_reports_clients').insert({ name, slug, timezone: txt(f.get('timezone')) || 'America/New_York' });
  if (error) return { ok: false, message: error.message };
  revalidatePath('/dashboard/wheeler-reports');
  revalidatePath('/dashboard/wheeler-reports/admin');
  return { ok: true, message: `Created ${name}. Open it to add stores.` };
}

export async function updateClient(id: string, _p: Result, f: FormData): Promise<Result> {
  await requireAdmin();
  const { error } = await adminClient().from('wheeler_reports_clients').update({
    name: txt(f.get('name')),
    timezone: txt(f.get('timezone')) || 'America/New_York',
    google_ads_customer_id: txt(f.get('google_ads_customer_id')).replace(/-/g, '') || null,
    meta_ad_account_id: txt(f.get('meta_ad_account_id')).replace(/^act_/, '') || null,
  }).eq('id', id);
  if (error) return { ok: false, message: error.message };
  revalidatePath('/dashboard/wheeler-reports/admin', 'layout');
  return { ok: true, message: 'Saved.' };
}

export async function saveStore(clientId: string, storeId: string | null, _p: Result, f: FormData): Promise<Result> {
  await requireAdmin();
  const row = {
    client_id: clientId,
    name: txt(f.get('name')),
    sort: Number(f.get('sort') || 0),
    campaign_terms: list(f.get('campaign_terms')).map((t) => t.toLowerCase()),
    lead_locations: list(f.get('lead_locations')),
  };
  if (!row.name) return { ok: false, message: 'Enter the store name.' };
  const sb = adminClient();
  const { error } = storeId ? await sb.from('wheeler_reports_stores').update(row).eq('id', storeId) : await sb.from('wheeler_reports_stores').insert(row);
  if (error) return { ok: false, message: error.message };
  revalidatePath('/dashboard/wheeler-reports/admin', 'layout');
  return { ok: true, message: storeId ? 'Saved. Re-sync or re-upload ad data to re-assign campaigns.' : `Added ${row.name}.` };
}

export async function deleteStore(storeId: string, _p: Result, _f: FormData): Promise<Result> {
  await requireAdmin();
  const { error } = await adminClient().from('wheeler_reports_stores').delete().eq('id', storeId);
  if (error) return { ok: false, message: error.message };
  revalidatePath('/dashboard/wheeler-reports/admin', 'layout');
  return { ok: true, message: 'Store deleted.' };
}

export async function createUser(_p: Result, f: FormData): Promise<Result> {
  await requireAdmin();
  const email = txt(f.get('email')).toLowerCase(), password = txt(f.get('password'));
  const role = f.get('role') === 'admin' ? 'admin' : 'client';
  const clientId = txt(f.get('client_id')) || null;
  if (!email || password.length < 10) return { ok: false, message: 'Enter an email and a password of at least 10 characters.' };
  if (role === 'client' && !clientId) return { ok: false, message: 'Choose the client this user belongs to.' };
  const sb = adminClient();
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) return { ok: false, message: error?.message ?? 'Could not create the user.' };
  const { error: pErr } = await sb.from('wheeler_reports_profiles').upsert({ user_id: data.user.id, email, role, client_id: role === 'admin' ? null : clientId });
  if (pErr) return { ok: false, message: pErr.message };
  revalidatePath('/dashboard/wheeler-reports/admin');
  return { ok: true, message: `Created ${email}. Send them the password and the site address.` };
}

export async function updateUser(userId: string, _p: Result, f: FormData): Promise<Result> {
  const me = await requireAdmin();
  const role = f.get('role') === 'admin' ? 'admin' : 'client';
  if (userId === me.userId && role !== 'admin') return { ok: false, message: "You can't remove your own admin access." };
  const { error } = await adminClient().from('wheeler_reports_profiles').update({ role, client_id: role === 'admin' ? null : txt(f.get('client_id')) || null }).eq('user_id', userId);
  if (error) return { ok: false, message: error.message };
  revalidatePath('/dashboard/wheeler-reports/admin');
  return { ok: true, message: 'Saved.' };
}
