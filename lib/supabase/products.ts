import "server-only";

import type { Product } from "@/lib/types";
import { getAdminSupabase } from "./admin";
import { DatabaseError } from "./errors";

export const MAX_SEARCH_RESULTS = 30;

const COLUMNS =
  "id, product_code, barcode, chinese_name, english_name, unit_price, currency, dimensions, packaging, image_url";

interface ProductRow {
  id: string;
  product_code: string;
  barcode: string | null;
  chinese_name: string | null;
  english_name: string | null;
  unit_price: number | string | null;
  currency: string;
  dimensions: string | null;
  packaging: string | null;
  image_url: string | null;
}

/**
 * Maps a database row onto the application type. Route handlers return the
 * result of this function so raw rows never reach a client component.
 */
function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    code: row.product_code,
    nameZh: row.chinese_name,
    nameEn: row.english_name,
    dimensions: row.dimensions,
    barcode: row.barcode,
    unitPrice: row.unit_price === null ? null : Number(row.unit_price),
    packaging: row.packaging,
    currency: row.currency,
    imageUrl: row.image_url,
  };
}

/**
 * PostgREST's `or` filter is a comma and parenthesis delimited grammar. Wrapping
 * each value in double quotes makes those characters safe, so only quotes and
 * backslashes need escaping.
 */
function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** One active-product query with a single PostgREST `or` filter applied. */
async function queryProducts(filter: string, ordered = false) {
  const supabase = getAdminSupabase();
  let request = supabase
    .from("products")
    .select(COLUMNS)
    .eq("active", true)
    .or(filter);

  if (ordered) request = request.order("product_code", { ascending: true });

  const { data, error } = await request.limit(MAX_SEARCH_RESULTS).returns<ProductRow[]>();
  if (error) throw new DatabaseError(error.message);
  return data ?? [];
}

/**
 * Searches active products by code, barcode, English name and Chinese name.
 *
 * Exact matches are resolved first so a scanned or fully typed code always wins
 * over the substring search. `product_code` is tried before `barcode`: Koei's
 * Code 39 labels encode the product code itself, and `barcode` only holds the
 * differing value printed on an external supplier's label.
 */
export async function searchProducts(query: string): Promise<Product[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];

  const value = escapeFilterValue(trimmed);

  // `ilike` without wildcards is a case-insensitive exact match.
  let exact = await queryProducts(`product_code.ilike."${value}"`);
  if (exact.length === 0) {
    exact = await queryProducts(`barcode.ilike."${value}"`);
  }

  const partial = await queryProducts(
    [
      `product_code.ilike."%${value}%"`,
      `barcode.ilike."%${value}%"`,
      `english_name.ilike."%${value}%"`,
      `chinese_name.ilike."%${value}%"`,
    ].join(","),
    true,
  );

  const seen = new Set<string>();
  const results: Product[] = [];

  for (const row of [...exact, ...partial]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    results.push(toProduct(row));
    if (results.length === MAX_SEARCH_RESULTS) break;
  }

  return results;
}

/** Returns the active product with this code, or `null` if there is none. */
export async function getProductByCode(code: string): Promise<Product | null> {
  const trimmed = code.trim();
  if (trimmed === "") return null;

  const supabase = getAdminSupabase();

  // `ilike` without wildcards is a case-insensitive exact match.
  const { data, error } = await supabase
    .from("products")
    .select(COLUMNS)
    .eq("active", true)
    .ilike("product_code", escapeFilterValue(trimmed))
    .limit(1)
    .returns<ProductRow[]>();

  if (error) throw new DatabaseError(error.message);

  const row = data?.[0];
  return row ? toProduct(row) : null;
}

/** Looks up the products referenced by an inquiry, keyed by id, active only. */
export async function getActiveProductsByIds(
  ids: string[],
): Promise<Map<string, Product>> {
  if (ids.length === 0) return new Map();

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("products")
    .select(COLUMNS)
    .eq("active", true)
    .in("id", ids)
    .returns<ProductRow[]>();

  if (error) throw new DatabaseError(error.message);

  return new Map((data ?? []).map((row) => [row.id, toProduct(row)]));
}
