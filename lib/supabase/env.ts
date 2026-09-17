/**
 * Public (browser-safe) Supabase credentials.
 *
 * Prefer the publishable key. The legacy anon key is accepted so existing
 * local and Vercel setups keep working while the project migrates names.
 */
export function resolvePublicSupabaseConfig(): {
  url: string | undefined;
  key: string | undefined;
  missing: string[];
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = publishableKey || anonKey;

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!key) {
    missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  }

  return { url, key, missing };
}
