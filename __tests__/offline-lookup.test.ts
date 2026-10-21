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
  searchProductsLocalFirst,
} from "@/lib/offline/lookup";
import { LOOKUP_MESSAGES, SCAN_LOOKUP_TIMEOUT_MS } from "@/lib/offline/constants";
import {
  latestScanDiagnostic,
  recordScanDiagnostic,
  resetScanDiagnosticsForTests,
} from "@/lib/offline/diagnostics";
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

  it("searches the product API when the local catalogue is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        expect(url).toBe("/api/products?q=Abbesses");
        expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
        return new Response(JSON.stringify({ products: [K10188] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const result = await searchProductsLocalFirst(
      [],
      { kind: "missing" },
      "Abbesses",
      undefined,
      true,
    );
    expect(result).toEqual({
      status: "ready",
      products: [K10188],
      source: "network",
    });
    vi.unstubAllGlobals();
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

  it("loads a product from the API when the local catalogue is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ product: K10188 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const result = await getProductLocalFirst([], { kind: "missing" }, "K10188-13", true);
    expect(result).toEqual({ status: "ready", product: K10188, source: "network" });
    vi.unstubAllGlobals();
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

  it("looks up a barcode through the product API when IndexedDB is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        expect(url).toBe("/api/products?q=K10188-13");
        return new Response(JSON.stringify({ products: [K10188] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const result = await scanProductsLocalFirst(
      [],
      { kind: "missing" },
      "K10188-13",
      new AbortController().signal,
      true,
    );
    expect(result).toEqual({
      status: "match",
      match: { kind: "single", product: K10188 },
      source: "network",
    });
    vi.unstubAllGlobals();
  });

  it("returns a ready IndexedDB hit immediately while the phone reports online", async () => {
    const fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchSpy);

    const started = Date.now();
    const result = await scanProductsLocalFirst(
      [K10188],
      READY,
      "K10188-13",
      undefined,
      true,
    );

    expect(Date.now() - started).toBeLessThan(100);
    expect(result).toEqual({
      status: "match",
      match: { kind: "single", product: K10188 },
      source: "local",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("resolves numeric and letter-hyphen codes from IndexedDB without waiting on the network", async () => {
    const numeric = { ...K10188, id: "numeric", code: "78032268" };
    const hyphenated = { ...K10188, id: "hyphen", code: "KU0509-GR" };
    const fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchSpy);

    const numericResult = await scanProductsLocalFirst(
      [numeric],
      READY,
      "78032268",
      undefined,
      true,
    );
    const hyphenResult = await scanProductsLocalFirst(
      [hyphenated],
      READY,
      "KU0509-GR",
      undefined,
      true,
    );

    expect(numericResult).toMatchObject({
      status: "match",
      source: "local",
      match: { kind: "single", product: numeric },
    });
    expect(hyphenResult).toMatchObject({
      status: "match",
      source: "local",
      match: { kind: "single", product: hyphenated },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("falls back to IndexedDB when the online lookup never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    try {
      const pending = scanProductsLocalFirst(
        [K10188],
        { kind: "expired", meta: { lastSyncedAt: 1, count: 1 }, expiresAt: 2 },
        "K10188-13",
        undefined,
        true,
      );
      await vi.advanceTimersByTimeAsync(SCAN_LOOKUP_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({
        status: "match",
        match: { kind: "single", product: K10188 },
        source: "local",
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("stops a hanging lookup and reports the local miss", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    try {
      const pending = scanProductsLocalFirst([K10188], READY, "NO-SUCH", undefined, true);
      await vi.advanceTimersByTimeAsync(SCAN_LOOKUP_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({
        status: "error",
        reason: "notFoundLocal",
        message: LOOKUP_MESSAGES.notFoundLocal,
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("does not call a missing catalogue a product miss when the network times out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    try {
      const pending = scanProductsLocalFirst(
        [],
        { kind: "missing" },
        "78032268",
        undefined,
        true,
      );
      await vi.advanceTimersByTimeAsync(SCAN_LOOKUP_TIMEOUT_MS);
      await expect(pending).resolves.toMatchObject({
        status: "error",
        reason: "network",
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe("scan diagnostics", () => {
  it("records decode time, format, source and result, and stays quiet outside development", () => {
    resetScanDiagnosticsForTests();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    recordScanDiagnostic({
      decodeMs: 840,
      decodedValue: "KU0509-GR",
      format: "CODE_39",
      lookupSource: "local",
      lookupMs: 2,
      result: "product",
    });

    expect(latestScanDiagnostic()).toEqual({
      decodeMs: 840,
      decodedValue: "KU0509-GR",
      format: "CODE_39",
      lookupSource: "local",
      lookupMs: 2,
      result: "product",
    });
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
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
