import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "test-artifacts") {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

describe("service-role key stays off the browser", () => {
  it("marks the admin client server-only", () => {
    expect(read("lib/supabase/admin.ts")).toMatch(/import "server-only"/);
    expect(read("lib/supabase/server.ts")).toMatch(/import "server-only"/);
    expect(read("lib/auth/session.ts")).toMatch(/import "server-only"/);
  });

  it("does not import the admin client from Client Components", () => {
    const files = walk(path.join(ROOT, "components")).filter((file) =>
      /\.(ts|tsx)$/.test(file),
    );
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/supabase\/admin/);
      expect(source).not.toMatch(/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("keeps the browser auth client on the public key", () => {
    const source = read("lib/supabase/browser.ts");
    expect(source).toMatch(/createBrowserClient/);
    expect(source).toMatch(/resolvePublicSupabaseConfig/);
    expect(source).not.toMatch(/SECRET_KEY|SERVICE_ROLE/);
    expect(source).not.toMatch(/from "\.\/admin"/);
  });

  it("does not put secrets into the production client bundle when it exists", () => {
    const staticDir = path.join(ROOT, ".next", "static");
    try {
      statSync(staticDir);
    } catch {
      return;
    }

    const files = walk(staticDir).filter((file) => file.endsWith(".js"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/SUPABASE_SECRET_KEY/);
      expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    }
  });
});

describe("proxy uses Next.js 16 proxy.ts, not middleware.ts", () => {
  it("exports proxy and skips fonts, manifests and service workers", () => {
    const source = read("proxy.ts");
    expect(source).toMatch(/export async function proxy/);
    expect(source).not.toMatch(/export async function middleware/);
    expect(source).toMatch(/fonts\//);
    expect(source).toMatch(/manifest/);
    expect(source).toMatch(/service-worker/);
    expect(source).toMatch(/NotoSansSC-Regular\.ttf|ttf/);
  });
});

describe("internal app is not indexed", () => {
  it("sets noindex metadata and robots rules", () => {
    expect(read("app/layout.tsx")).toMatch(/index:\s*false/);
    expect(read("app/robots.ts")).toMatch(/disallow:\s*"\/"/);
    expect(read("next.config.ts")).toMatch(/X-Robots-Tag/);
    expect(read("app/layout.tsx")).toMatch(/tradeshow\.koeico\.com/);
  });
});
