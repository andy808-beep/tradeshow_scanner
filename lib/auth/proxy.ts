import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import { resolvePublicSupabaseConfig } from "@/lib/supabase/env";
import {
  isApiPath,
  isLoginPath,
  isProxyExemptPath,
  loginUrlWithNext,
  safeNextPath,
  shouldRedirectUnauthenticatedPage,
} from "./paths";

function redirectToLogin(request: NextRequest): NextResponse {
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  return NextResponse.redirect(new URL(loginUrlWithNext(next), request.url));
}

function passThrough(request: NextRequest): NextResponse {
  return NextResponse.next({ request });
}

/**
 * Refreshes the Auth JWT (via `getClaims()`, which verifies it) and
 * optimistically redirects HTML pages. API routes are not redirected; they
 * return JSON 401 from `withAuthenticatedApi`.
 */
export async function updateAuthSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isProxyExemptPath(pathname)) {
    return passThrough(request);
  }

  const { url, key } = resolvePublicSupabaseConfig();
  if (!url || !key) {
    if (isLoginPath(pathname) || isApiPath(pathname)) return passThrough(request);
    if (shouldRedirectUnauthenticatedPage(pathname)) return redirectToLogin(request);
    return passThrough(request);
  }

  let supabaseResponse = passThrough(request);

  const supabase = createServerClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([headerName, headerValue]) => {
          supabaseResponse.headers.set(headerName, headerValue);
        });
      },
    },
  });

  // Validates the JWT. Do not use getSession() here — it trusts cookie JSON.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);

  if (isLoginPath(pathname)) {
    if (isAuthenticated) {
      const destination = safeNextPath(request.nextUrl.searchParams.get("next")) ?? "/";
      return NextResponse.redirect(new URL(destination, request.url));
    }
    return supabaseResponse;
  }

  if (isApiPath(pathname)) {
    return supabaseResponse;
  }

  if (shouldRedirectUnauthenticatedPage(pathname) && !isAuthenticated) {
    return redirectToLogin(request);
  }

  return supabaseResponse;
}
