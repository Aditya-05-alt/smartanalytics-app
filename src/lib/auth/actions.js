'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isDemoLogin, DEMO_EMAIL } from '@/lib/auth/demo';
import { recordServerLoginSts } from '@/lib/telemetry/serverLoginSts';

/**
 * Server Actions for auth.
 *
 * Two modes:
 *   - "demo"  → Supabase env vars NOT set. Hardcoded demo credentials work,
 *               everything else is rejected. Lets you preview the UI.
 *   - "live"  → Supabase env vars set. Real auth runs end-to-end.
 */

const DEMO_COOKIE = 'sa_demo_session';

export async function signInAction(_prevState, formData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');

  if (!email || !password) {
    return { ok: false, error: 'Please fill in both fields.' };
  }

  const supabase = await createClient();

  // ── DEMO MODE ──────────────────────────────────────────
  if (!supabase) {
    if (!isDemoLogin(email, password)) {
      return {
        ok: false,
        error: `Demo mode — use ${DEMO_EMAIL} / Demo1234! (or wire up Supabase in .env.local).`,
      };
    }
    const jar = await cookies();
    jar.set(DEMO_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
    revalidatePath('/', 'layout');
    redirect('/dashboard');
  }

  // ── LIVE MODE ──────────────────────────────────────────
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { ok: false, error: error.message };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await recordServerLoginSts(supabase, {
      user,
      eventType: 'login',
      eventAction: 'password_sign_in',
      pagePath: '/login',
    });
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signUpAction(_prevState, formData) {
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');

  if (!name || !email || !password) {
    return { ok: false, error: 'Please complete all required fields.' };
  }

  const supabase = await createClient();

  // ── DEMO MODE ──────────────────────────────────────────
  if (!supabase) {
    return {
      ok: true,
      message:
        `Demo mode — account is simulated. Sign in with ${DEMO_EMAIL} / Demo1234! to continue.`,
    };
  }

  // ── LIVE MODE ──────────────────────────────────────────
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    message: 'Account created. Check your email to verify your address.',
  };
}

export async function signOutAction() {
  const supabase = await createClient();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await recordServerLoginSts(supabase, {
        user,
        eventType: 'logout',
        eventAction: 'sign_out',
        pagePath: '/dashboard',
      });
    }

    await supabase.auth.signOut();
  } else {
    const jar = await cookies();
    jar.delete(DEMO_COOKIE);
  }
  revalidatePath('/', 'layout');
  redirect('/login');
}
