import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Auth gate for /dashboard/*.
 *
 *  - Demo mode (no Supabase env): looks for `sa_demo_session` cookie.
 *  - Live mode (Supabase configured): looks for an active Supabase session.
 *
 * Anything else gets redirected to /login.
 */
export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/dashboard')) return NextResponse.next();

  const demo = request.cookies.get('sa_demo_session');
  if (demo) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) {
    let response = NextResponse.next();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return response;
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirectTo', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
