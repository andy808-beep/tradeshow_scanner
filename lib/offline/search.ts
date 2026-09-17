import type { Product } from "@/lib/types";
import { MAX_LOCAL_SEARCH_RESULTS } from "./constants";

/** Alphanumeric lowercased form so "K10188-13" and "k10188 13" match. */
export function normalizeLookupValue(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function pushUnique(results: Product[], seen: Set<string>, product: Product, limit: number) {
  if (seen.has(product.id) || results.length >= limit) return;
  seen.add(product.id);
  results.push(product);
}

/**
 * Local catalogue search. Exact product-code matches first, then exact
 * barcode, then substring matches — the same order as the online search API.
 */
export function searchLocalProducts(
  products: Product[],
  query: string,
  limit = MAX_LOCAL_SEARCH_RESULTS,
): Product[] {
  const trimmed = query.trim();
  if (trimmed === "" || limit <= 0) return [];

  const needle = trimmed.toLowerCase();
  const normalized = normalizeLookupValue(trimmed);
  const seen = new Set<string>();
  const results: Product[] = [];

  for (const product of products) {
    if (product.code.toLowerCase() === needle) {
      pushUnique(results, seen, product, limit);
    }
  }

  if (results.length < limit) {
    for (const product of products) {
      if (product.barcode?.toLowerCase() === needle) {
        pushUnique(results, seen, product, limit);
      }
    }
  }

  if (normalized !== "" && results.length < limit) {
    for (const product of products) {
      if (normalizeLookupValue(product.code) === normalized) {
        pushUnique(results, seen, product, limit);
      } else if (product.barcode && normalizeLookupValue(product.barcode) === normalized) {
        pushUnique(results, seen, product, limit);
      }
    }
  }

  if (results.length < limit) {
    for (const product of products) {
      const codeHit =
        product.code.toLowerCase().includes(needle) ||
        (normalized !== "" && normalizeLookupValue(product.code).includes(normalized));
      const barcodeHit =
        (product.barcode?.toLowerCase().includes(needle) ?? false) ||
        (product.barcode !== null &&
          normalized !== "" &&
          normalizeLookupValue(product.barcode).includes(normalized));
      const nameHit =
        (product.nameEn?.toLowerCase().includes(needle) ?? false) ||
        (product.nameZh?.toLowerCase().includes(needle) ?? false);
      if (codeHit || barcodeHit || nameHit) {
        pushUnique(results, seen, product, limit);
      }
    }
  }

  return results;
}

export function findLocalProductByCode(
  products: Product[],
  code: string,
): Product | null {
  const trimmed = code.trim();
  if (trimmed === "") return null;

  const needle = trimmed.toLowerCase();
  const exact = products.find((product) => product.code.toLowerCase() === needle);
  if (exact) return exact;

  const normalized = normalizeLookupValue(trimmed);
  if (normalized === "") return null;
  return (
    products.find((product) => normalizeLookupValue(product.code) === normalized) ?? null
  );
}

/** Candidates for a scanned or typed barcode; names are not searched. */
export function localScanCandidates(products: Product[], rawValue: string): Product[] {
  const trimmed = rawValue.trim();
  if (trimmed === "") return [];

  const needle = trimmed.toLowerCase();
  const normalized = normalizeLookupValue(trimmed);

  return products.filter((product) => {
    if (product.code.toLowerCase() === needle) return true;
    if (product.barcode?.toLowerCase() === needle) return true;
    if (normalized !== "" && normalizeLookupValue(product.code) === normalized) {
      return true;
    }
    if (
      product.barcode &&
      normalized !== "" &&
      normalizeLookupValue(product.barcode) === normalized
    ) {
      return true;
    }
    return false;
  });
}
