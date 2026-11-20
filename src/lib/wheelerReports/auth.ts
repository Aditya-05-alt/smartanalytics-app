// Who is signed in, and what they may open.
import 'server-only';
import { redirect, notFound } from 'next/navigation';
import { userClient } from './supabase/server';
import type { Client } from './types';

export type Viewer = { userId: string; email: string | null; role: 'admin' | 'client'; clientId: string | null };

export async function getViewer(): Promise<Viewer | null> {
  const sb = await userClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: p } = await sb.from('wheeler_reports_profiles').select('role, client_id').eq('user_id', user.id).maybeSingle();
  return { userId: user.id, email: user.email ?? null, role: (p?.role as 'admin' | 'client') ?? 'client', clientId: p?.client_id ?? null };
}

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect('/login?redirectTo=/dashboard/wheeler-reports');
  return v;
}

export async function requireAdmin(): Promise<Viewer> {
  const v = await requireViewer();
  if (v.role !== 'admin') redirect('/dashboard/wheeler-reports');
  return v;
}

/** The client behind a URL slug, if this viewer may see it (RLS decides). */
export async function requireClient(slug: string): Promise<{ viewer: Viewer; client: Client }> {
  const viewer = await requireViewer();
  const sb = await userClient();
  const { data } = await sb.from('wheeler_reports_clients').select('id, slug, name, timezone, google_ads_customer_id, meta_ad_account_id').eq('slug', slug).maybeSingle();
  if (!data) notFound();
  return { viewer, client: data as Client };
}
