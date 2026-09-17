import { describe, expect, it } from "vitest";
import {
  isApiPath,
  isLoginPath,
  isProxyExemptPath,
  loginUrlWithNext,
  safeNextPath,
  shouldRedirectUnauthenticatedPage,
} from "@/lib/auth/paths";

describe("safeNextPath", () => {
  it("allows a relative destination beginning with one slash", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/inquiry")).toBe("/inquiry");
    expect(safeNextPath("/products/K10188-13")).toBe("/products/K10188-13");
    expect(safeNextPath("/labels?q=k")).toBe("/labels?q=k");
  });

  it("rejects external and open-redirect values", () => {
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("http://evil.example/login")).toBeNull();
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("///evil.example")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("\\evil.example")).toBeNull();
    expect(safeNextPath("evil.example")).toBeNull();
    expect(safeNextPath("/%2f%2fevil.example")).toBeNull();
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login?next=/inquiry")).toBeNull();
  });

  it("rejects missing, blank and non-string values", () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(["/inquiry", "https://evil.example"])).toBe("/inquiry");
  });
});

describe("loginUrlWithNext", () => {
  it("appends a safe next path", () => {
    expect(loginUrlWithNext("/labels")).toBe("/login?next=%2Flabels");
    expect(loginUrlWithNext("/")).toBe("/login");
    expect(loginUrlWithNext("https://evil.example")).toBe("/login");
  });
});

describe("path classification", () => {
  it("does not send static fonts, manifests or service workers to login", () => {
    expect(isProxyExemptPath("/fonts/NotoSansSC-Regular.ttf")).toBe(true);
    expect(isProxyExemptPath("/fonts/OFL.txt")).toBe(true);
    expect(isProxyExemptPath("/manifest.webmanifest")).toBe(true);
    expect(isProxyExemptPath("/manifest.json")).toBe(true);
    expect(isProxyExemptPath("/sw.js")).toBe(true);
    expect(isProxyExemptPath("/service-worker.js")).toBe(true);
    expect(isProxyExemptPath("/favicon.ico")).toBe(true);
    expect(isProxyExemptPath("/_next/static/chunks/main.js")).toBe(true);
    expect(shouldRedirectUnauthenticatedPage("/fonts/NotoSansSC-Regular.ttf")).toBe(
      false,
    );
  });

  it("does not protect the login page", () => {
    expect(isLoginPath("/login")).toBe(true);
    expect(shouldRedirectUnauthenticatedPage("/login")).toBe(false);
  });

  it("does not redirect API requests to an HTML login page", () => {
    expect(isApiPath("/api/products")).toBe(true);
    expect(shouldRedirectUnauthenticatedPage("/api/products")).toBe(false);
    expect(shouldRedirectUnauthenticatedPage("/api/products/labels")).toBe(false);
  });

  it("protects the booth pages", () => {
    for (const path of ["/", "/inquiry", "/labels", "/products/K10188-13"]) {
      expect(shouldRedirectUnauthenticatedPage(path)).toBe(true);
    }
  });
});
