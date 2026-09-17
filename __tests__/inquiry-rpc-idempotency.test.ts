import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(url && secretKey);

const MARKER = "phase2-idempotency-test";
const createdIds: string[] = [];

describe.skipIf(!live)("create_trade_show_inquiry idempotency against Supabase", () => {
  const supabase = createClient(url!, secretKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  afterAll(async () => {
    if (createdIds.length === 0) return;
    await supabase.from("inquiry_items").delete().in("inquiry_id", createdIds);
    await supabase.from("inquiries").delete().in("id", createdIds);
    await supabase.from("inquiries").delete().eq("notes", MARKER);
  });

  it("retries and concurrent duplicates insert one inquiry and one item set", async () => {
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id")
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    expect(productError).toBeNull();
    if (!product) {
      throw new Error("No active product available for the idempotency integration test.");
    }

    const probeId = crypto.randomUUID();
    const probe = await supabase.rpc("create_trade_show_inquiry", {
      p_customer_name: "Phase 2 Idempotency probe",
      p_company_name: "Koei",
      p_staff_name: null,
      p_notes: MARKER,
      p_currency: "USD",
      p_items: [{ productId: product.id, quantity: 99, quotedPrice: 2.4, notes: "snapshot" }],
      p_client_submission_id: probeId,
    });

    if (probe.error?.code === "PGRST202") {
      console.warn(
        "Skipping live idempotency test: apply supabase/migrations/004_inquiry_client_submission_id.sql, then reload the PostgREST schema.",
      );
      return;
    }

    expect(probe.error).toBeNull();
    expect(typeof probe.data).toBe("string");
    createdIds.push(probe.data as string);

    const retry = await supabase.rpc("create_trade_show_inquiry", {
      p_customer_name: "Should not insert a second inquiry",
      p_company_name: "Koei",
      p_staff_name: null,
      p_notes: MARKER,
      p_currency: "USD",
      p_items: [{ productId: product.id, quantity: 99, quotedPrice: 2.4, notes: "snapshot" }],
      p_client_submission_id: probeId,
    });
    expect(retry.error).toBeNull();
    expect(retry.data).toBe(probe.data);

    const concurrentId = crypto.randomUUID();
    const concurrentParams = {
      p_customer_name: "Phase 2 Idempotency",
      p_company_name: "Koei",
      p_staff_name: null,
      p_notes: MARKER,
      p_currency: "USD",
      p_items: [{ productId: product.id, quantity: 99, quotedPrice: 2.4, notes: "snapshot" }],
      p_client_submission_id: concurrentId,
    };
    const [left, right] = await Promise.all([
      supabase.rpc("create_trade_show_inquiry", concurrentParams),
      supabase.rpc("create_trade_show_inquiry", concurrentParams),
    ]);
    expect(left.error).toBeNull();
    expect(right.error).toBeNull();
    expect(left.data).toBe(right.data);
    createdIds.push(left.data as string);

    const { data: items, error: itemsError } = await supabase
      .from("inquiry_items")
      .select("id, quantity, inquiry_id")
      .in("inquiry_id", [probe.data, left.data]);
    expect(itemsError).toBeNull();
    const byInquiry = new Map<string, NonNullable<typeof items>>();
    for (const item of items ?? []) {
      const current = byInquiry.get(item.inquiry_id) ?? [];
      current.push(item);
      byInquiry.set(item.inquiry_id, current);
    }
    expect(byInquiry.get(probe.data as string)).toHaveLength(1);
    expect(byInquiry.get(left.data as string)).toHaveLength(1);
    expect(items?.every((item) => item.quantity === 1)).toBe(true);

    const { count, error: countError } = await supabase
      .from("inquiries")
      .select("id", { count: "exact", head: true })
      .eq("client_submission_id", probeId);
    expect(countError).toBeNull();
    expect(count).toBe(1);
  });
});
