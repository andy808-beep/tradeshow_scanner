import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";
import { resolvePublicSupabaseConfig } from "./env";
import { SupabaseConfigError } from "./errors";

/**
 * Server auth client bound to the incoming request cookies. Uses the public
 * key so it runs as the signed-in user, not as the service role.
 *
 * Create a new client per request. Do not import this module from a Client
 * Component.
 */
export async function createAuthServerClient() {
  const { url, key, missing } = resolvePublicSupabaseConfig();
  if (!url || !key) {
    throw new SupabaseConfigError(
      `Missing ${missing.join(" and ")} on the server.`,
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot always write cookies. proxy.ts refreshes
          // the session on each request and writes the cookies there.
        }
      },
    },
  });
}
