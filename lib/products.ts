import type { Product } from "./types";

/**
 * TEST REFERENCE ONLY — not the production source.
 *
 * Supabase is the source of truth for products; the app reads it through
 * `/api/products`. This fixture mirrors the confirmed K10188-13 row so tests
 * and local comparisons have a fixed expected value. Nothing under `app/` or
 * `components/` may import this module.
 */
export const sampleProducts: Product[] = [
  {
    id: "e4247a2f-1e3b-4d64-a05f-ab38906b5292",
    code: "K10188-13",
    nameZh: "大方盘·紫",
    nameEn: "Abbesses Plate - L",
    dimensions: "20.6 × 13.3 × 2.0 cm",
    barcode: null,
    unitPrice: null,
    packaging: null,
    currency: "USD",
    imageUrl: null,
  },
];

/** Lets "k1018813" and "k10188 13" match the code "K10188-13". */
function normalizeCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function findSampleProductByCode(code: string): Product | undefined {
  const target = normalizeCode(code);
  if (!target) return undefined;
  return sampleProducts.find((product) => normalizeCode(product.code) === target);
}

export function searchSampleProducts(query: string): Product[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const codeQuery = normalizeCode(trimmed);
  const textQuery = trimmed.toLowerCase();

  return sampleProducts.filter(
    (product) =>
      (codeQuery !== "" && normalizeCode(product.code).includes(codeQuery)) ||
      (product.nameEn?.toLowerCase().includes(textQuery) ?? false) ||
      (product.nameZh?.includes(trimmed) ?? false),
  );
}
