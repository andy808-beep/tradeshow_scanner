import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "005_replace_active_product_catalogue.sql",
);

describe("005_replace_active_product_catalogue", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const normalized = sql.toLowerCase();

  it("is a service-role security-definer function and does not add a column", () => {
    expect(sql).toContain(
      "create or replace function public.replace_active_product_catalogue(",
    );
    expect(normalized).toMatch(/language plpgsql/);
    expect(normalized).toMatch(/security definer/);
    expect(normalized).toMatch(/set search_path = pg_temp, public/);
    expect(normalized).not.toMatch(/add column/);
    expect(normalized).not.toMatch(/drop table public\.products/);

    const signature = "public.replace_active_product_catalogue(text, jsonb)";
    expect(sql).toContain(`revoke all on function ${signature}`);
    expect(normalized).toMatch(/from public,\s*anon,\s*authenticated/);
    expect(sql).toContain(`grant execute on function ${signature}`);
    expect(normalized).toMatch(/to service_role/);
  });

  it("updates by product code, preserves barcodes, and deactivates the rest in one function", () => {
    expect(normalized).toMatch(/upper\(btrim\(product\.product_code\)\) = incoming\.product_code/);
    expect(normalized).toMatch(/active = true/);
    expect(normalized).toMatch(/active = false/);
    expect(normalized).toMatch(/source_batch = p_batch/);
    expect(normalized).not.toMatch(/barcode\s*=/);
    expect(normalized).toMatch(/a product barcode changed; rolling back/);
    expect(normalized).toMatch(/products were deleted; rolling back/);
    expect(normalized).toMatch(/active product count does not match the incoming catalogue; rolling back/);
    expect(normalized).not.toMatch(/\bdelete\s+from\b/);
  });

  it("does not write inquiries or inquiry items", () => {
    expect(normalized).not.toMatch(
      /\b(update|insert\s+into|delete\s+from)\s+(public\.)?inquiries\b/,
    );
    expect(normalized).not.toMatch(
      /\b(update|insert\s+into|delete\s+from)\s+(public\.)?inquiry_items\b/,
    );
  });
});
