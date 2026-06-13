import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const DEMO_COOKIE = 'sa_demo_session';

export async function GET(request) {
  const redirectUrl = new URL('/login', request.url);
  const response = NextResponse.redirect(redirectUrl);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const cookieStore = await cookies();

  if (url && anonKey) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });
    await supabase.auth.signOut();
  }

  response.cookies.delete(DEMO_COOKIE);

  return response;
}
