import type { ProductCatalogueResponse } from "@/lib/api-contract";
import { ApiError } from "@/lib/api-client";
import type { Product } from "@/lib/types";
import type { CatalogueMeta } from "./authorization";
import { offlineDebug } from "./diagnostics";
import {
  readCatalogueSnapshot,
  replaceCatalogue,
  type CatalogueSnapshot,
} from "./db";

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

export class CatalogueVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogueVerificationError";
  }
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
 * Confirms the catalogue that is actually committed to IndexedDB, rather than
 * trusting the row count the API reported.
 */
function verifySnapshot(snapshot: CatalogueSnapshot, expected: number): void {
  if (snapshot.count !== expected) {
    throw new CatalogueVerificationError(
      `Only ${snapshot.count} of ${expected} products were stored on this device.`,
    );
  }
  if (snapshot.meta === null || snapshot.meta.count !== expected) {
    throw new CatalogueVerificationError("The stored sync record does not match.");
  }
  if (!snapshot.allCodesSearchable) {
    throw new CatalogueVerificationError("Some stored products have no searchable code.");
  }
}

/**
 * Downloads the full catalogue, writes it atomically, then reads it back and
 * verifies it before reporting success. Any failure — download, write or
 * verification — restores the previously stored catalogue.
 */
export async function syncProductCatalogue(
  now = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<{ products: Product[]; meta: CatalogueMeta }> {
  const previous = await readCatalogueSnapshot();

  try {
    const products = await fetchProductCatalogue(fetcher);
    const meta: CatalogueMeta = { lastSyncedAt: now, count: products.length };
    await replaceCatalogue(products, meta);

    const committed = await readCatalogueSnapshot();
    verifySnapshot(committed, products.length);
    offlineDebug("sync.verified", {
      downloaded: products.length,
      committed: committed.count,
      metaCount: committed.meta?.count ?? -1,
      allCodesSearchable: committed.allCodesSearchable,
    });

    return { products: committed.products, meta: committed.meta ?? meta };
  } catch (error) {
    offlineDebug("sync.failed", {
      error: error instanceof Error ? error.name : "unknown",
      previousCount: previous.count,
    });

    // Never lose a working catalogue because a later sync failed.
    const current = await readCatalogueSnapshot();
    if (previous.meta && current.count !== previous.count) {
      await replaceCatalogue(previous.products, previous.meta);
    }
    throw error;
  }
}
