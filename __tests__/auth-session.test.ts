import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAuthServerClient: async () => ({
    auth: {
      getUser: mocks.getUser,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${href}`), {
      digest: `NEXT_REDIRECT:${href}`,
    });
  },
}));

const { requireAuthenticatedUser, getAuthenticatedUserOrNull } =
  await import("@/lib/auth/session");
const { authenticateEmployee } = await import("@/lib/auth/credentials");
const { signInAction, signOutAction } = await import("@/lib/auth/actions");

const EMPLOYEE = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "andy@koeico.com",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAuthenticatedUser", () => {
  it("returns the Auth-server user, not a client-supplied email", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: EMPLOYEE }, error: null });
    await expect(requireAuthenticatedUser()).resolves.toEqual(EMPLOYEE);
    expect(mocks.getUser).toHaveBeenCalled();
  });

  it("rejects a missing or invalid session", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Auth session missing" },
    });
    await expect(requireAuthenticatedUser()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    await expect(getAuthenticatedUserOrNull()).resolves.toBeNull();
  });
});

describe("authenticateEmployee", () => {
  it("signs in with email and password", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    const password = "booth-secret";
    const result = await authenticateEmployee("andy@koeico.com", password);
    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain(password);
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "andy@koeico.com",
      password,
    });
  });

  it("returns a generic invalid-credentials error", async () => {
    const password = "wrong-password";
    mocks.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: `Invalid login for ${password}` },
    });
    const result = await authenticateEmployee("andy@koeico.com", password);
    expect(result).toEqual({ ok: false, error: "Invalid email or password." });
    expect(JSON.stringify(result)).not.toContain(password);
  });
});

describe("signInAction", () => {
  it("redirects to a safe next path after a successful login", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    const form = new FormData();
    form.set("email", "andy@koeico.com");
    form.set("password", "booth-secret");
    form.set("next", "/labels");

    await expect(signInAction(null, form)).rejects.toThrow("NEXT_REDIRECT:/labels");
  });

  it("rejects an open redirect after login", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    const form = new FormData();
    form.set("email", "andy@koeico.com");
    form.set("password", "booth-secret");
    form.set("next", "https://evil.example");

    await expect(signInAction(null, form)).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("returns the invalid-login error without redirecting", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials" },
    });
    const form = new FormData();
    form.set("email", "andy@koeico.com");
    form.set("password", "nope");

    await expect(signInAction(null, form)).resolves.toEqual({
      error: "Invalid email or password.",
    });
  });
});

describe("signOutAction", () => {
  it("clears the Supabase session and redirects to /login", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.signOut).toHaveBeenCalled();
  });
});
