import { afterEach, describe, expect, it } from "vitest";
import {
  inspectCatalogueAccess,
  isOfflineCatalogueAuthorized,
  offlineExpiresAt,
} from "@/lib/offline/authorization";
import { OFFLINE_AUTH_TTL_MS } from "@/lib/offline/constants";
import { clearConfidentialLocalData } from "@/lib/offline/clear";
import {
  readCatalogueMeta,
  readCatalogueProducts,
  replaceCatalogue,
  resetCatalogueDbForTests,
} from "@/lib/offline/db";
import { syncProductCatalogue } from "@/lib/offline/sync";
import type { Product } from "@/lib/types";

const PRICED: Product = {
  id: "e4247a2f-1e3b-4d64-a05f-ab38906b5292",
  code: "K10188-13",
  nameZh: "大方盘·紫",
  nameEn: "Abbesses Plate - L",
  dimensions: "20.6 × 13.3 × 2.0 cm",
  barcode: null,
  unitPrice: 12.3456,
  packaging: null,
  currency: "USD",
  imageUrl: null,
};

const UNPRICED: Product = {
  ...PRICED,
  id: "22222222-2222-4222-8222-222222222222",
  code: "K9426S-19",
  unitPrice: null,
};

afterEach(async () => {
  await clearConfidentialLocalData();
  resetCatalogueDbForTests();
});

describe("atomic full-catalogue sync", () => {
  it("replaces the complete local catalogue and records sync metadata", async () => {
    const now = 1_700_000_000_000;
    const fetcher = async () =>
      new Response(JSON.stringify({ products: [PRICED, UNPRICED], count: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const result = await syncProductCatalogue(now, fetcher);
    expect(result.meta).toEqual({ lastSyncedAt: now, count: 2 });
    expect(result.products).toHaveLength(2);

    const stored = await readCatalogueProducts();
    expect(stored.map((product) => product.code).sort()).toEqual(["K10188-13", "K9426S-19"]);
    expect(stored.find((product) => product.code === "K9426S-19")?.unitPrice).toBeNull();
    expect(stored.find((product) => product.code === "K10188-13")?.unitPrice).toBe(12.3456);
    await expect(readCatalogueMeta()).resolves.toEqual({ lastSyncedAt: now, count: 2 });
  });

  it("keeps the previous catalogue when a later sync fails", async () => {
    const first = async () =>
      new Response(JSON.stringify({ products: [PRICED], count: 1 }), { status: 200 });
    await syncProductCatalogue(1_700_000_000_000, first);

    await expect(
      syncProductCatalogue(1_700_000_100_000, async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toThrow(/Failed to fetch/);

    await expect(
      syncProductCatalogue(1_700_000_200_000, async () => new Response("no", { status: 500 })),
    ).rejects.toThrow();

    const stored = await readCatalogueProducts();
    expect(stored).toEqual([PRICED]);
    await expect(readCatalogueMeta()).resolves.toEqual({
      lastSyncedAt: 1_700_000_000_000,
      count: 1,
    });
  });

  it("stores an empty synchronized catalogue without treating it as missing", async () => {
    const fetcher = async () =>
      new Response(JSON.stringify({ products: [], count: 0 }), { status: 200 });
    await syncProductCatalogue(50, fetcher);
    const meta = await readCatalogueMeta();
    expect(meta).toEqual({ lastSyncedAt: 50, count: 0 });
    await expect(readCatalogueProducts()).resolves.toEqual([]);
    expect(inspectCatalogueAccess(meta, 50).kind).toBe("ready");
  });
});

describe("seven-day offline authorization", () => {
  const syncedAt = 1_000_000;

  it("allows use until the seventh day and blocks after it", () => {
    expect(isOfflineCatalogueAuthorized(syncedAt, syncedAt)).toBe(true);
    expect(
      isOfflineCatalogueAuthorized(syncedAt, syncedAt + OFFLINE_AUTH_TTL_MS),
    ).toBe(true);
    expect(
      isOfflineCatalogueAuthorized(syncedAt, syncedAt + OFFLINE_AUTH_TTL_MS + 1),
    ).toBe(false);
    expect(offlineExpiresAt(syncedAt)).toBe(syncedAt + OFFLINE_AUTH_TTL_MS);
  });

  it("inspects missing, ready and expired catalogues", () => {
    expect(inspectCatalogueAccess(null).kind).toBe("missing");
    expect(inspectCatalogueAccess({ lastSyncedAt: syncedAt, count: 3 }, syncedAt).kind).toBe(
      "ready",
    );
    expect(
      inspectCatalogueAccess(
        { lastSyncedAt: syncedAt, count: 3 },
        syncedAt + OFFLINE_AUTH_TTL_MS + 5,
      ).kind,
    ).toBe("expired");
  });
});

describe("logout clearing IndexedDB", () => {
  it("erases products and sync metadata", async () => {
    await replaceCatalogue([PRICED], { lastSyncedAt: 9, count: 1 });
    await clearConfidentialLocalData();
    resetCatalogueDbForTests();
    await expect(readCatalogueMeta()).resolves.toBeNull();
    await expect(readCatalogueProducts()).resolves.toEqual([]);
  });
});
