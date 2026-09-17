import { describe, expect, it, vi } from "vitest";
import {
  findLocalProductByCode,
  localScanCandidates,
  normalizeLookupValue,
  searchLocalProducts,
} from "@/lib/offline/search";
import {
  getProductLocalFirst,
  lookupLocalSearch,
  refreshSearchFromApi,
  scanProductsLocalFirst,
} from "@/lib/offline/lookup";
import { LOOKUP_MESSAGES } from "@/lib/offline/constants";
import type { CatalogueAccess } from "@/lib/offline/authorization";
import type { Product } from "@/lib/types";

const K10188: Product = {
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
};

const SUPPLIER: Product = {
  ...K10188,
  id: "supplier",
  code: "SUP-1",
  barcode: "4901234567894",
  unitPrice: 4,
};

const READY: CatalogueAccess = {
  kind: "ready",
  meta: { lastSyncedAt: 1, count: 2 },
  expiresAt: 1 + 7 * 24 * 60 * 60 * 1000,
};

describe("barcode normalization and local lookup", () => {
  it("normalizes hyphens and spaces", () => {
    expect(normalizeLookupValue("K10188-13")).toBe("k1018813");
    expect(normalizeLookupValue("k10188 13")).toBe("k1018813");
  });

  it("finds a product code after stripping separators", () => {
    expect(findLocalProductByCode([K10188], "k10188 13")?.code).toBe("K10188-13");
    expect(localScanCandidates([K10188, SUPPLIER], "K10188-13")).toEqual([K10188]);
    expect(localScanCandidates([K10188, SUPPLIER], "4901234567894")).toEqual([SUPPLIER]);
  });

  it("preserves a null listed price", () => {
    const found = findLocalProductByCode([K10188], "K10188-13");
    expect(found?.unitPrice).toBeNull();
  });
});

describe("offline search", () => {
  it("queries the local catalogue synchronously, with no network involved", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = lookupLocalSearch([K10188], READY, "Abbesses");
    expect(result).toEqual({
      status: "ready",
      products: [K10188],
      source: "local",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not treat a missing catalogue as a product miss", () => {
    expect(lookupLocalSearch([], { kind: "missing" }, "K10188-13")).toEqual({
      status: "error",
      reason: "unsynced",
      message: LOOKUP_MESSAGES.unsynced,
    });
  });

  it("reports a failed network refresh as no refresh, leaving local results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(refreshSearchFromApi("K10188-13")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("abandons a refresh that never settles instead of waiting on it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    await expect(refreshSearchFromApi("K10188-13", undefined)).resolves.toBeNull();
    vi.unstubAllGlobals();
  }, 10_000);
});

describe("offline product-code lookup and details", () => {
  it("loads a cached product without the network", async () => {
    const result = await getProductLocalFirst([K10188], READY, "K10188-13", false);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.product.unitPrice).toBeNull();
      expect(result.source).toBe("local");
    }
  });

  it("says the product is missing locally rather than inventing a network miss", async () => {
    const result = await getProductLocalFirst([K10188], READY, "NO-SUCH", false);
    expect(result).toEqual({
      status: "error",
      reason: "notFoundLocal",
      message: LOOKUP_MESSAGES.notFoundLocal,
    });
  });

  it("does not show cached prices after the seven-day window", async () => {
    const result = await getProductLocalFirst(
      [K10188],
      { kind: "expired", meta: { lastSyncedAt: 1, count: 1 }, expiresAt: 2 },
      "K10188-13",
      false,
    );
    expect(result).toEqual({
      status: "error",
      reason: "expired",
      message: LOOKUP_MESSAGES.expired,
    });
  });

  it("says the network is unavailable when there is no local row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await getProductLocalFirst([K10188], READY, "NO-SUCH", true);
    expect(result).toEqual({
      status: "error",
      reason: "network",
      message: LOOKUP_MESSAGES.network,
    });
    vi.unstubAllGlobals();
  });
});

describe("offline barcode scan lookup", () => {
  it("resolves a Code 39 product code from IndexedDB", async () => {
    const result = await scanProductsLocalFirst(
      [K10188],
      READY,
      "K10188-13",
      new AbortController().signal,
      false,
    );
    expect(result).toEqual({
      status: "match",
      match: { kind: "single", product: K10188 },
      source: "local",
    });
  });

  it("does not report an unsynced catalogue as product not found", async () => {
    const result = await scanProductsLocalFirst(
      [],
      { kind: "missing" },
      "K10188-13",
      new AbortController().signal,
      false,
    );
    expect(result).toMatchObject({ status: "error", reason: "unsynced" });
  });
});

describe("empty catalogue state", () => {
  it("searches an authorized empty catalogue as no local matches", () => {
    const result = lookupLocalSearch(
      [],
      { kind: "ready", meta: { lastSyncedAt: 1, count: 0 }, expiresAt: 99 },
      "K10188-13",
    );
    expect(result).toEqual({ status: "ready", products: [], source: "local" });
  });
});

describe("searchLocalProducts ranking", () => {
  it("puts an exact code match first", () => {
    const loose = { ...K10188, id: "loose", code: "OTHER", nameEn: "K10188-13 case" };
    const results = searchLocalProducts([loose, K10188], "K10188-13");
    expect(results[0]?.id).toBe(K10188.id);
  });
});
