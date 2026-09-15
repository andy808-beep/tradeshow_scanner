import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabaseConfigError } from "./errors";

/**
 * Administrative Supabase client, authenticated with the secret key and
 * therefore able to bypass Row Level Security.
 *
 * The `server-only` import above makes importing this module from a client
 * component a build error, which is what keeps the secret key out of the
 * browser bundle. Only server modules and route handlers may import it, and
 * the key itself must never appear in a response body.
 */

let cachedClient: SupabaseClient | null = null;

/**
 * Resolves server credentials without creating a client.
 *
 * Vercel's Supabase integration typically injects SUPABASE_SERVICE_ROLE_KEY,
 * while this repo's .env.local uses SUPABASE_SECRET_KEY. Both names are
 * accepted so production and local keep working.
 */
export function resolveAdminSupabaseConfig(): {
  url: string | undefined;
  secretKey: string | undefined;
  missing: string[];
} {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
  if (!secretKey) missing.push("SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)");

  return { url, secretKey, missing };
}

export function getAdminSupabase(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const { url, secretKey, missing } = resolveAdminSupabaseConfig();

  if (!url || !secretKey) {
    throw new SupabaseConfigError(
      `Missing ${missing.join(" and ")} on the server. Set them in the host environment (Vercel project settings for production).`,
    );
  }

  cachedClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cachedClient;
}
