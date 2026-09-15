import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabaseConfigError } from "./errors";

/**
 * Administrative Supabase client, authenticated with the secret key and
 * therefore able to bypass Row Level Security.
 *
 * The `server-only` import above makes importing this module from a client
 * component a build error, which is what keeps the secret key out of the
 * browser bundle. Only server modules and route handlers may import it, and the
 * key itself must never appear in a response body.
 */

let cachedClient: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new SupabaseConfigError(
      "SUPABASE_URL and SUPABASE_SECRET_KEY must be set to reach the database.",
    );
  }

  cachedClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cachedClient;
}
