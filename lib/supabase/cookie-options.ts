import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Host-only cookies (no `domain`) so the session works on tradeshow.koeico.com
 * and on Vercel preview deployments. A hardcoded custom-domain cookie would
 * silently fail on `*.vercel.app`.
 *
 * A later offline PWA should keep using this cookie session while online and
 * cache responses from the protected APIs. It must not query tables from the
 * browser.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptionsWithName = {
  path: "/",
  sameSite: "lax",
};
