import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "003_enable_rls_and_restrict_inquiry_rpc.sql",
);

describe("003_enable_rls_and_restrict_inquiry_rpc", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("enables RLS on the application tables without adding CRUD policies", () => {
    expect(sql).toMatch(/alter table public\.products enable row level security/i);
    expect(sql).toMatch(/alter table public\.inquiries enable row level security/i);
    expect(sql).toMatch(/alter table public\.inquiry_items enable row level security/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant (select|insert|update|delete) on table/i);
  });

  it("revokes and grants the exact existing inquiry RPC signature", () => {
    const signature =
      "public.create_trade_show_inquiry(text, text, text, text, text, jsonb)";
    expect(sql).toContain(`revoke all on function ${signature}`);
    expect(sql).toMatch(new RegExp(`from public,\\s*anon,\\s*authenticated`, "i"));
    expect(sql).toContain(`grant execute on function ${signature}`);
    expect(sql).toMatch(/to service_role/i);
  });
});
