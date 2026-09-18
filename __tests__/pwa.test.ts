import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHELL_CACHE_NAME, SHELL_CACHE_PREFIX } from "@/lib/offline/constants";

const { default: manifest } = await import("@/app/manifest");

describe("PWA manifest validity", () => {
  const webApp = manifest();

  it("is installable in standalone display mode", () => {
    expect(webApp.display).toBe("standalone");
    expect(webApp.start_url).toBe("/");
    expect(webApp.scope).toBe("/");
    expect(webApp.name).toMatch(/Koei/);
    expect(webApp.short_name).toBeTruthy();
    expect(webApp.theme_color).toBe("#254663");
    expect(webApp.background_color).toBe("#254663");
  });

  it("includes required PNG icons", () => {
    const icons = webApp.icons ?? [];
    expect(icons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512")).toBe(true);
    for (const icon of icons) {
      expect(icon.src).toMatch(/^\//);
      expect(icon.type).toBe("image/png");
      expect(existsSync(path.join(process.cwd(), "public", icon.src.replace(/^\//, "")))).toBe(
        true,
      );
    }
    expect(existsSync(path.join(process.cwd(), "public", "icons", "apple-touch-icon.png"))).toBe(
      true,
    );
  });
});

describe("installation metadata", () => {
  it("advertises an iOS web app and icons from the root layout", () => {
    const layout = readFileSync(path.join(process.cwd(), "app", "layout.tsx"), "utf8");
    expect(layout).toMatch(/appleWebApp/);
    expect(layout).toMatch(/capable:\s*true/);
    expect(layout).toMatch(/apple-touch-icon/);
    expect(layout).toMatch(/PwaRegister/);
  });
});

describe("service-worker registration", () => {
  it("registers /sw.js at the root scope", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components", "pwa-register.tsx"),
      "utf8",
    );
    expect(source).toMatch(/serviceWorker\.register\("\/sw\.js"/);
    expect(source).toMatch(/scope:\s*"\/"/);
  });

  it("caches the app shell and never caches authenticated APIs", () => {
    const source = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(source).toContain(SHELL_CACHE_NAME);
    expect(source).toContain(SHELL_CACHE_PREFIX);
    expect(source).toMatch(/skipWaiting/);
    expect(source).toMatch(/clients\.claim/);
    expect(source).toMatch(/isApiRequest/);
    expect(source).toMatch(/pathname\.startsWith\("\/api\/"\)/);
    expect(source).toMatch(/Authenticated application data must never enter the shell cache/);
    expect(source).toContain('pathname === "/inquiry"');
    expect(source).toContain('pathname === "/inquiries"');
    expect(source).toMatch(/Inquiry API responses in particular stay out of Cache Storage/);
    expect(source).not.toMatch(/cache\.put\([^)]*\/api\/inquiries/);
    expect(source).not.toMatch(/SUPABASE_SECRET_KEY|SERVICE_ROLE/);
  });
});
