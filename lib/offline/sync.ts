import type { ProductCatalogueResponse } from "@/lib/api-contract";
import { ApiError } from "@/lib/api-client";
import type { Product } from "@/lib/types";
import type { CatalogueMeta } from "./authorization";
import { readCatalogueMeta, readCatalogueProducts, replaceCatalogue } from "./db";

function isProduct(value: unknown): value is Product {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.code === "string" &&
    (record.unitPrice === null || typeof record.unitPrice === "number") &&
    typeof record.currency === "string"
  );
}

export async function fetchProductCatalogue(
  fetcher: typeof fetch = fetch,
): Promise<Product[]> {
  const response = await fetcher("/api/products/catalogue", { cache: "no-store" });
  if (!response.ok) {
    let message = "The product catalogue could not be downloaded.";
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Keep the generic message.
    }
    throw new ApiError(message, response.status);
  }

  const data = (await response.json()) as ProductCatalogueResponse;
  if (!Array.isArray(data.products) || !data.products.every(isProduct)) {
    throw new Error("The catalogue response was not valid.");
  }
  return data.products;
}

/**
 * Downloads the full catalogue and writes it atomically. On any failure the
 * previously stored catalogue is left untouched.
 */
export async function syncProductCatalogue(
  now = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<{ products: Product[]; meta: CatalogueMeta }> {
  const previousMeta = await readCatalogueMeta();
  const previousProducts = previousMeta ? await readCatalogueProducts() : [];

  try {
    const products = await fetchProductCatalogue(fetcher);
    const meta: CatalogueMeta = { lastSyncedAt: now, count: products.length };
    await replaceCatalogue(products, meta);
    return { products, meta };
  } catch (error) {
    if (previousMeta) {
      const stillThere = await readCatalogueMeta();
      if (!stillThere) {
        await replaceCatalogue(previousProducts, previousMeta);
      }
    }
    throw error;
  }
}
