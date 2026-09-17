import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: mocks.getClaims },
  }),
}));

const { updateAuthSession } = await import("@/lib/auth/proxy");

function request(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  mocks.getClaims.mockResolvedValue({ data: null, error: null });
});

describe("unauthenticated page redirect", () => {
  it("sends protected HTML pages to /login with a safe next path", async () => {
    const response = await updateAuthSession(request("/labels"));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login?next=");
    expect(location).toContain(encodeURIComponent("/labels"));
  });

  it("preserves the original path and query on next", async () => {
    const response = await updateAuthSession(request("/products/K10188-13?from=scan"));
    const location = new URL(response.headers.get("location") ?? "http://localhost/");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/products/K10188-13?from=scan");
  });
});

describe("login and static paths stay reachable", () => {
  it("does not redirect the login page when there is no session", async () => {
    const response = await updateAuthSession(request("/login"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not redirect the label font used by PDF export", async () => {
    const response = await updateAuthSession(
      request("/fonts/NotoSansSC-Regular.ttf"),
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not redirect API requests to an HTML login page", async () => {
    const response = await updateAuthSession(request("/api/products?q=K10188"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBeLessThan(300);
  });
});

describe("verified session, not cookie presence", () => {
  it("still redirects when an auth cookie is present but claims are unverified", async () => {
    const response = await updateAuthSession(
      request("/inquiry", "sb-example-auth-token=not-a-verified-session"),
    );
    expect(mocks.getClaims).toHaveBeenCalled();
    expect(response.headers.get("location") ?? "").toContain("/login?next=");
  });

  it("allows authenticated access after getClaims verifies the JWT", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1", email: "andy@koeico.com" } },
      error: null,
    });

    const response = await updateAuthSession(request("/inquiry"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBeLessThan(300);
  });

  it("sends an authenticated visitor away from /login", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });

    const response = await updateAuthSession(request("/login?next=/labels"));
    const location = response.headers.get("location") ?? "";
    expect(location).toMatch(/\/labels$/);
    expect(location).not.toContain("/login");
  });

  it("rejects an open redirect on /login?next=", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });

    const response = await updateAuthSession(
      request("/login?next=https://evil.example"),
    );
    const location = response.headers.get("location") ?? "";
    expect(location).toMatch(/\/$/);
    expect(location).not.toContain("evil.example");
  });
});
