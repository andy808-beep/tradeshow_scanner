import { createBrowserClient } from "@supabase/ssr";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";
import { resolvePublicSupabaseConfig } from "./env";
import { SupabaseConfigError } from "./errors";

/**
 * Browser auth client. Uses the publishable/anon key only — never the
 * service-role/secret key. Session cookies are the source of identity for a
 * later offline PWA; this client does not talk to product or inquiry tables.
 */
export function createAuthBrowserClient() {
  const { url, key, missing } = resolvePublicSupabaseConfig();
  if (!url || !key) {
    throw new SupabaseConfigError(`Missing ${missing.join(" and ")}.`);
  }

  return createBrowserClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
  });
}
