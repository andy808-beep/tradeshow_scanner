import { getProductByCodeRequest, searchProductsRequest } from "@/lib/api-client";
import { resolveScanMatch, type ScanMatch } from "@/lib/barcode";
import type { Product } from "@/lib/types";
import type { CatalogueAccess } from "./authorization";
import { LOOKUP_MESSAGES } from "./constants";
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

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export async function searchProductsLocalFirst(
  products: Product[],
  access: CatalogueAccess,
  query: string,
  signal: AbortSignal,
  online = isOnline(),
): Promise<LocalFirstSearch> {
  if (access.kind !== "ready") return accessError(access);

  const local = searchLocalProducts(products, query);
  if (!online) {
    return { status: "ready", products: local, source: "local" };
  }

  try {
    const remote = await searchProductsRequest(query, signal);
    return { status: "ready", products: remote, source: "network" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { status: "ready", products: local, source: "local" };
  }
}

export async function getProductLocalFirst(
  products: Product[],
  access: CatalogueAccess,
  code: string,
  online = isOnline(),
): Promise<LocalFirstProduct> {
  if (access.kind !== "ready") {
    const failed = accessError(access);
    return { status: "error", reason: failed.reason, message: failed.message };
  }

  const local = findLocalProductByCode(products, code);
  if (local && !online) {
    return { status: "ready", product: local, source: "local" };
  }

  if (online) {
    try {
      const remote = await getProductByCodeRequest(code);
      if (remote) return { status: "ready", product: remote, source: "network" };
      if (local) return { status: "ready", product: local, source: "local" };
      return {
        status: "error",
        reason: "notFoundLocal",
        message: LOOKUP_MESSAGES.notFoundLocal,
      };
    } catch {
      if (local) return { status: "ready", product: local, source: "local" };
      return {
        status: "error",
        reason: "network",
        message: LOOKUP_MESSAGES.network,
      };
    }
  }

  if (local) return { status: "ready", product: local, source: "local" };
  return {
    status: "error",
    reason: "notFoundLocal",
    message: LOOKUP_MESSAGES.notFoundLocal,
  };
}

export async function scanProductsLocalFirst(
  products: Product[],
  access: CatalogueAccess,
  rawValue: string,
  signal: AbortSignal,
  online = isOnline(),
): Promise<LocalFirstScan> {
  if (access.kind !== "ready") {
    const failed = accessError(access);
    return { status: "error", reason: failed.reason, message: failed.message };
  }

  const localCandidates = localScanCandidates(products, rawValue);
  const localMatch = resolveScanMatch(rawValue, localCandidates);

  if (!online) {
    if (localMatch.kind === "none") {
      return {
        status: "error",
        reason: "notFoundLocal",
        message: LOOKUP_MESSAGES.notFoundLocal,
      };
    }
    return { status: "match", match: localMatch, source: "local" };
  }

  try {
    const remote = await searchProductsRequest(rawValue, signal);
    const remoteMatch = resolveScanMatch(rawValue, remote);
    if (remoteMatch.kind !== "none") {
      return { status: "match", match: remoteMatch, source: "network" };
    }
    if (localMatch.kind !== "none") {
      return { status: "match", match: localMatch, source: "local" };
    }
    return {
      status: "error",
      reason: "notFoundLocal",
      message: LOOKUP_MESSAGES.notFoundLocal,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (localMatch.kind !== "none") {
      return { status: "match", match: localMatch, source: "local" };
    }
    return { status: "error", reason: "network", message: LOOKUP_MESSAGES.network };
  }
}
