import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "004_inquiry_client_submission_id.sql",
);

describe("004_inquiry_client_submission_id", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("adds a nullable client_submission_id and a unique index for non-null values", () => {
    expect(sql).toMatch(/add column if not exists client_submission_id uuid/i);
    expect(sql).toMatch(/create unique index if not exists inquiries_client_submission_id_uidx/i);
    expect(sql).toMatch(/where client_submission_id is not null/i);
  });

  it("keeps the six-argument RPC as a wrapper and adds a seven-argument overload", () => {
    expect(sql).toMatch(
      /create or replace function public\.create_trade_show_inquiry\([\s\S]*p_client_submission_id uuid/,
    );
    expect(sql).toContain(
      "grant execute on function public.create_trade_show_inquiry(text, text, text, text, text, jsonb, uuid)",
    );
    expect(sql).toContain(
      "grant execute on function public.create_trade_show_inquiry(text, text, text, text, text, jsonb)",
    );
    expect(sql).toMatch(/to service_role/);
    expect(sql).not.toMatch(/grant execute[\s\S]*to authenticated/i);
  });

  it("returns the existing inquiry on a duplicate clientSubmissionId and hardcodes quantity 1", () => {
    expect(sql).toMatch(/when unique_violation then/i);
    expect(sql).toMatch(/where client_submission_id = p_client_submission_id/i);
    expect(sql).toMatch(/return v_inquiry_id/i);
    expect(sql).toMatch(/insert into inquiry_items/i);
    expect(sql).toMatch(/^\s*1,\s*$/m);
    expect(sql).not.toMatch(/item->>'quantity'/);
  });

  it("does not rewrite previous migrations", () => {
    const previous = readFileSync(
      path.join(process.cwd(), "supabase", "migrations", "003_enable_rls_and_restrict_inquiry_rpc.sql"),
      "utf8",
    );
    expect(previous).not.toMatch(/client_submission_id/);
  });
});
