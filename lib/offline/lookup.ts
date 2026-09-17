import { getProductByCodeRequest, searchProductsRequest } from "@/lib/api-client";
import { resolveScanMatch, type ScanMatch } from "@/lib/barcode";
import type { Product } from "@/lib/types";
import type { CatalogueAccess } from "./authorization";
import { LOOKUP_MESSAGES, NETWORK_REFRESH_TIMEOUT_MS } from "./constants";
import { offlineDebug } from "./diagnostics";
import { findLocalProductByCode, localScanCandidates, searchLocalProducts } from "./search";

export type LookupFailureReason = "unsynced" | "expired" | "network" | "notFoundLocal";

export type LookupError = {
  status: "error";
  reason: LookupFailureReason;
  message: string;
};

export type LocalFirstSearch =
  | { status: "ready"; products: Product[]; source: "local" | "network" }
  | LookupError;

export type LocalFirstProduct =
  | { status: "ready"; product: Product; source: "local" | "network" }
  | LookupError;

export type LocalFirstScan =
  | { status: "match"; match: ScanMatch; source: "local" | "network" }
  | LookupError;

function accessError(access: CatalogueAccess): LookupError {
  if (access.kind === "missing") {
    return { status: "error", reason: "unsynced", message: LOOKUP_MESSAGES.unsynced };
  }
  return { status: "error", reason: "expired", message: LOOKUP_MESSAGES.expired };
}

/**
 * A hint only. `navigator.onLine` reports `true` for captive portals and, in
 * an installed iOS web app, sometimes even in airplane mode, so it may never
 * gate a local result or be awaited on.
 */
export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/**
 * Synchronous catalogue search over the in-memory copy of the IndexedDB
 * catalogue. Always terminates, never touches the network, and is the single
 * lookup used by manual search, barcode scans and product details.
 */
export function lookupLocalSearch(
  products: Product[],
  access: CatalogueAccess,
  query: string,
): LocalFirstSearch {
  if (access.kind !== "ready") return accessError(access);

  const matches = searchLocalProducts(products, query);
  offlineDebug("search.local", {
    cached: products.length,
    queryLength: query.trim().length,
    matches: matches.length,
  });
  return { status: "ready", products: matches, source: "local" };
}

export function lookupLocalProduct(
  products: Product[],
  access: CatalogueAccess,
  code: string,
): LocalFirstProduct {
  if (access.kind !== "ready") return accessError(access);

  const match = findLocalProductByCode(products, code);
  offlineDebug("product.local", { cached: products.length, found: match !== null });
  if (match) return { status: "ready", product: match, source: "local" };
  return {
    status: "error",
    reason: "notFoundLocal",
    message: LOOKUP_MESSAGES.notFoundLocal,
  };
}

export function lookupLocalScan(
  products: Product[],
  access: CatalogueAccess,
  rawValue: string,
): LocalFirstScan {
  if (access.kind !== "ready") return accessError(access);

  const match = resolveScanMatch(rawValue, localScanCandidates(products, rawValue));
  offlineDebug("scan.local", { cached: products.length, match: match.kind });
  if (match.kind === "none") {
    return {
      status: "error",
      reason: "notFoundLocal",
      message: LOOKUP_MESSAGES.notFoundLocal,
    };
  }
  return { status: "match", match, source: "local" };
}

/**
 * Runs an authenticated request with a bounded timeout and returns `null` for
 * every failure mode — rejected, aborted, timed out or offline — so a stalled
 * request can only ever mean "no refresh", never a blocked screen.
 */
async function bounded<T>(
  run: (signal: AbortSignal) => Promise<T>,
  outer?: AbortSignal,
  timeoutMs = NETWORK_REFRESH_TIMEOUT_MS,
): Promise<T | null> {
  if (outer?.aborted) return null;

  const controller = new AbortController();
  const abort = () => controller.abort();
  outer?.addEventListener("abort", abort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  // Raced rather than only aborted: a request that ignores its signal, or a
  // service worker that never answers, must not keep this promise pending.
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      abort();
      resolve(null);
    }, timeoutMs);
  });

  try {
    return await Promise.race([run(controller.signal).catch(() => null), expiry]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", abort);
  }
}

/** Optional background refresh. `null` means "keep showing local results". */
export async function refreshSearchFromApi(
  query: string,
  outer?: AbortSignal,
): Promise<Product[] | null> {
  const products = await bounded((signal) => searchProductsRequest(query, signal), outer);
  offlineDebug("search.refresh", { refreshed: products !== null });
  return products;
}

export async function refreshProductFromApi(code: string): Promise<Product | null> {
  return bounded(() => getProductByCodeRequest(code));
}

/**
 * Product details for a code. The cached copy wins immediately; the API is
 * only consulted when this device has no local record for the code.
 */
export async function getProductLocalFirst(
  products: Product[],
  access: CatalogueAccess,
  code: string,
  online = isOnline(),
): Promise<LocalFirstProduct> {
  const local = lookupLocalProduct(products, access, code);
  if (local.status === "ready") return local;
  if (local.reason !== "notFoundLocal") return local;

  if (!online) return local;

  const remote = await refreshProductFromApi(code);
  if (remote) return { status: "ready", product: remote, source: "network" };
  return { status: "error", reason: "network", message: LOOKUP_MESSAGES.network };
}

/**
 * Scan resolution. Identical local rules to manual search; the API is only a
 * fallback for a code this device has never cached.
 */
export async function scanProductsLocalFirst(
  products: Product[],
  access: CatalogueAccess,
  rawValue: string,
  signal?: AbortSignal,
  online = isOnline(),
): Promise<LocalFirstScan> {
  const local = lookupLocalScan(products, access, rawValue);
  if (local.status === "match") return local;
  if (local.reason !== "notFoundLocal") return local;

  if (!online) return local;

  const remote = await refreshSearchFromApi(rawValue, signal);
  if (remote === null) {
    return { status: "error", reason: "network", message: LOOKUP_MESSAGES.network };
  }

  const match = resolveScanMatch(rawValue, remote);
  if (match.kind === "none") return local;
  return { status: "match", match, source: "network" };
}
