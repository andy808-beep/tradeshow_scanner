import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env.SUPABASE_URL = ORIGINAL.SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = ORIGINAL.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    ORIGINAL.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIGINAL.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

const { resolveAdminSupabaseConfig } = await import("@/lib/supabase/admin");
const { resolvePublicSupabaseConfig } = await import("@/lib/supabase/env");

describe("resolveAdminSupabaseConfig", () => {
  it("prefers SUPABASE_SECRET_KEY and SUPABASE_URL", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "secret-preferred";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://public.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secret-fallback";

    const config = resolveAdminSupabaseConfig();
    expect(config.url).toBe("https://example.supabase.co");
    expect(config.secretKey).toBe("secret-preferred");
    expect(config.missing).toEqual([]);
  });

  it("falls back to the Vercel integration's SUPABASE_SERVICE_ROLE_KEY", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://public.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "from-vercel-integration";

    const config = resolveAdminSupabaseConfig();
    expect(config.url).toBe("https://public.supabase.co");
    expect(config.secretKey).toBe("from-vercel-integration");
    expect(config.missing).toEqual([]);
  });

  it("names the missing variables without echoing any values", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const config = resolveAdminSupabaseConfig();
    expect(config.url).toBeUndefined();
    expect(config.secretKey).toBeUndefined();
    expect(config.missing.join(" ")).toMatch(/SUPABASE_SECRET_KEY/);
    expect(config.missing.join(" ")).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(JSON.stringify(config)).not.toMatch(/eyJ/);
  });
});

describe("resolvePublicSupabaseConfig", () => {
  it("prefers the publishable key when both public keys exist", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://public.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-preferred";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-fallback";

    const config = resolvePublicSupabaseConfig();
    expect(config.url).toBe("https://public.supabase.co");
    expect(config.key).toBe("publishable-preferred");
    expect(config.missing).toEqual([]);
  });

  it("falls back to the legacy anon key", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://public.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-anon";

    const config = resolvePublicSupabaseConfig();
    expect(config.key).toBe("legacy-anon");
    expect(config.missing).toEqual([]);
  });

  it("names the missing public variables without echoing values", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const config = resolvePublicSupabaseConfig();
    expect(config.missing.join(" ")).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(config.missing.join(" ")).toMatch(/PUBLISHABLE_KEY/);
    expect(JSON.stringify(config)).not.toMatch(/eyJ/);
  });
});
