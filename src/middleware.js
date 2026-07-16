import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isValidSuperadminSession, SUPERADMIN_COOKIE } from '@/lib/auth/superadmin';
import {
  canAccessReport,
  firstAllowedReportHref,
  normalizeAccess,
  reportKeyFromPathname,
} from '@/lib/access/permissions';
import { loadUserAccessRecord } from '@/lib/access/userAccess';

async function enforceDashboardReportAccess(supabase, user, response, request, pathname) {
  const reportKey = reportKeyFromPathname(pathname);
  if (!reportKey) return response;

  try {
    const record = await loadUserAccessRecord(supabase, user.id);
    const access = normalizeAccess(record);
    if (canAccessReport(access, reportKey)) return response;
    return NextResponse.redirect(new URL(firstAllowedReportHref(access), request.url));
  } catch {
    return response;
  }
}

/**
 * Auth gate for /dashboard/*.
 *
 * /dashboard/admin/* — superadmin cookie only (no dealer login required).
 * Other /dashboard/* — demo session or Supabase user, then optional admin guard N/A.
 */
export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/dashboard') && !pathname.startsWith('/reports')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/reports')) {
    const adminSession = request.cookies.get(SUPERADMIN_COOKIE)?.value;
    if (isValidSuperadminSession(adminSession)) {
      return NextResponse.next();
    }

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

  if (pathname.startsWith('/dashboard/admin')) {
    const adminSession = request.cookies.get(SUPERADMIN_COOKIE)?.value;
    if (isValidSuperadminSession(adminSession)) {
      return NextResponse.next();
    }
    const adminLogin = new URL('/admin/login', request.url);
    adminLogin.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(adminLogin);
  }

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
    if (user) {
      return enforceDashboardReportAccess(
        supabase,
        user,
        response,
        request,
        pathname
      );
    }
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirectTo', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dashboard/:path*', '/reports/:path*'],
};
