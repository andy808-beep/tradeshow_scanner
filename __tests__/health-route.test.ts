import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAuthServerClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

const { GET: healthRoute } = await import("@/app/api/health/route");

describe("GET /api/health", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
  });

  it("returns 401 without a session and does not describe the catalogue", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "missing" } });
    const response = await healthRoute(new Request("http://localhost/api/health"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
    const body = (await response.json()) as { error?: string; ok?: boolean; products?: unknown };
    expect(body.ok).toBeUndefined();
    expect(body.products).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/service_role|price/i);
  });

  it("returns only ok:true when the session is valid", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "employee-1" } },
      error: null,
    });
    const response = await healthRoute(new Request("http://localhost/api/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
