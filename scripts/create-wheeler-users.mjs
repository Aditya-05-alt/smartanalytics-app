/**
 * One-shot: create Wheeler Advertising users + overview-only / all-dealers access.
 * Usage: node scripts/create-wheeler-users.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(root, '..', '.env.local');
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i).trim(),
        l.slice(i + 1).trim().replace(/^["']|["']$/g, ''),
      ];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const USERS = [
  { email: 'jays@wheeleradvertising.com', password: 'Wheeler@16$', name: 'Jays' },
];

async function findUserIdByEmail(email) {
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const hit = (data?.users || []).find(
      (u) => String(u.email || '').toLowerCase() === target
    );
    if (hit) return hit.id;
    if (!data?.users?.length || data.users.length < perPage) return null;
    page += 1;
    if (page > 50) return null;
  }
}

async function ensureAuthUser({ email, password, name }) {
  const existingId = await findUserIdByEmail(email);
  if (existingId) {
    const { data, error } = await sb.auth.admin.updateUserById(existingId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error) throw error;
    return { id: data.user.id, created: false };
  }

  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw error;
  return { id: data.user.id, created: true };
}

async function assignOverviewAllDealers(userId, email) {
  const now = new Date().toISOString();
  const { error: roleErr } = await sb.from('smart_user_roles').upsert(
    {
      auth_user_id: userId,
      email: email.toLowerCase(),
      role_key: 'user',
      all_reports: false,
      all_dealers: true,
      updated_at: now,
      updated_by: 'create-wheeler-users.mjs',
    },
    { onConflict: 'auth_user_id' }
  );
  if (roleErr) throw roleErr;

  const { error: delRepErr } = await sb
    .from('smart_user_reports')
    .delete()
    .eq('auth_user_id', userId);
  if (delRepErr) throw delRepErr;

  const { error: insRepErr } = await sb.from('smart_user_reports').insert({
    auth_user_id: userId,
    report_key: 'overview',
  });
  if (insRepErr) throw insRepErr;

  const { error: delDealErr } = await sb
    .from('smart_user_dealers')
    .delete()
    .eq('auth_user_id', userId);
  if (delDealErr) throw delDealErr;
}

const results = [];
for (const u of USERS) {
  try {
    const { id, created } = await ensureAuthUser(u);
    await assignOverviewAllDealers(id, u.email);
    results.push({
      email: u.email,
      password: u.password,
      userId: id,
      status: created ? 'created' : 'updated',
      role: 'user',
      reports: ['overview'],
      allDealers: true,
    });
  } catch (e) {
    results.push({
      email: u.email,
      password: u.password,
      status: 'error',
      error: e?.message || String(e),
    });
  }
}

console.log(JSON.stringify(results, null, 2));
if (results.some((r) => r.status === 'error')) process.exit(1);
