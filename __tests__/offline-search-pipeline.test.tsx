import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogueProvider } from "@/components/catalogue-provider";
import CatalogueStatus from "@/components/catalogue-status";
import { InquiryProvider } from "@/components/inquiry-store";
import LogoutButton from "@/components/logout-button";
import SearchPanel from "@/components/search-panel";
import { LOOKUP_MESSAGES } from "@/lib/offline/constants";
import {
  clearAllLocalData,
  countCatalogueProducts,
  findStoredProductByCode,
  readCatalogueMeta,
  readCatalogueProducts,
  readCatalogueSnapshot,
  replaceCatalogue,
} from "@/lib/offline/db";
import {
  lookupLocalProduct,
  lookupLocalScan,
  lookupLocalSearch,
} from "@/lib/offline/lookup";
import { syncProductCatalogue } from "@/lib/offline/sync";
import type { Product } from "@/lib/types";

vi.mock("@/lib/auth/actions", () => ({
  signOutAction: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const READY_ACCESS = {
  kind: "ready" as const,
  meta: { lastSyncedAt: 1, count: 1 },
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
};

const FEATURED: Product = {
  id: "e4247a2f-1e3b-4d64-a05f-ab38906b5292",
  code: "K10188-13",
  nameZh: "大方盘·紫",
  nameEn: "Abbesses Plate - L",
  dimensions: "20.6 × 13.3 × 2.0 cm",
  barcode: "4901234567894",
  unitPrice: 2.4,
  packaging: "24 pcs/ctn",
  currency: "USD",
  imageUrl: null,
};

/** 102 rows, matching the booth catalogue size that was reported. */
function catalogueOf102(): Product[] {
  const rest = Array.from({ length: 101 }, (_, index) => ({
    ...FEATURED,
    id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    code: `K${9000 + index}-01`,
    nameZh: `杯碟-${index}`,
    nameEn: `Cup and Saucer ${index}`,
    barcode: null,
    unitPrice: index === 0 ? null : index,
    packaging: null,
  }));
  return [FEATURED, ...rest];
}

const CATALOGUE = catalogueOf102();

let fetchSpy: ReturnType<typeof vi.fn>;

function setNetwork(onLine: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: onLine });
}

async function goOffline() {
  await act(async () => {
    setNetwork(false);
    window.dispatchEvent(new Event("offline"));
  });
}

function catalogueResponse(products: Product[] = CATALOGUE) {
  return new Response(JSON.stringify({ products, count: products.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function productApiCalls() {
  return fetchSpy.mock.calls.filter(([input]) => {
    const url = typeof input === "string" ? input : String(input);
    return url.startsWith("/api/products") && url !== "/api/products/catalogue";
  });
}

function renderApp(ui: ReactNode) {
  return render(
    <InquiryProvider>
      <CatalogueProvider>{ui}</CatalogueProvider>
    </InquiryProvider>,
  );
}

/** Seeds the device through the real, verified sync path, then renders. */
async function syncedApp(ui: ReactNode) {
  await syncProductCatalogue(Date.now(), async () => catalogueResponse());
  renderApp(ui);
  await waitFor(() => expect(screen.getByLabelText(/Search by product/)).toBeTruthy());
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByLabelText(/Search by product/), {
    target: { value },
  });
}

beforeEach(() => {
  setNetwork(true);
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    if (url === "/api/products/catalogue") return catalogueResponse();
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  cleanup();
  // Stores are emptied rather than the database deleted: a delete would block
  // on connections this file keeps open and stall the next test.
  await clearAllLocalData();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("synchronization is verified against IndexedDB", () => {
  it("commits all 102 response rows as 102 product records", async () => {
    const result = await syncProductCatalogue(1_000, async () => catalogueResponse());

    expect(result.meta.count).toBe(102);
    await expect(countCatalogueProducts()).resolves.toBe(102);
    const snapshot = await readCatalogueSnapshot();
    expect(snapshot.count).toBe(102);
    expect(snapshot.meta?.count).toBe(102);
    expect(snapshot.allCodesSearchable).toBe(true);
  });

  it("stores records by id and keeps them findable by normalized code", async () => {
    await syncProductCatalogue(1_000, async () => catalogueResponse());

    const products = await readCatalogueProducts();
    expect(products.every((product) => product.id.length > 0)).toBe(true);
    await expect(findStoredProductByCode("k10188 13")).resolves.toMatchObject({
      id: FEATURED.id,
      code: "K10188-13",
    });
    // The derived key is never leaked back into the Product shape.
    expect(Object.keys(products[0])).not.toContain("codeKey");
  });

  it("keeps the previous catalogue when a later sync fails", async () => {
    await syncProductCatalogue(1_000, async () => catalogueResponse([FEATURED]));
    await expect(
      syncProductCatalogue(2_000, async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toThrow();

    await expect(countCatalogueProducts()).resolves.toBe(1);
    await expect(readCatalogueMeta()).resolves.toEqual({
      lastSyncedAt: 1_000,
      count: 1,
    });
  });
});

describe("offline search queries the local catalogue only", () => {
  it("finds an exact product code", async () => {
    await syncedApp(
      <>
        <CatalogueStatus />
        <SearchPanel />
      </>,
    );
    await goOffline();

    typeQuery("K10188-13");
    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(productApiCalls()).toEqual([]);
  });

  it("finds a partial code, a Chinese name and an English name", async () => {
    await syncedApp(<SearchPanel />);
    await goOffline();

    typeQuery("K9005");
    expect(await screen.findByText("K9005-01")).toBeVisible();

    typeQuery("杯碟-7");
    expect(await screen.findByText("K9007-01")).toBeVisible();

    typeQuery("Abbesses");
    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(productApiCalls()).toEqual([]);
  });

  it("matches a product code in any case", async () => {
    await syncedApp(<SearchPanel />);
    await goOffline();

    typeQuery("k10188-13");
    expect(await screen.findByText("K10188-13")).toBeVisible();

    typeQuery("K10188 13");
    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(productApiCalls()).toEqual([]);
  });

  it("shows the empty message instead of a spinner when nothing matches", async () => {
    await syncedApp(<SearchPanel />);
    await goOffline();

    typeQuery("ZZZ-NOPE");
    expect(await screen.findByText(LOOKUP_MESSAGES.notFoundLocal)).toBeVisible();
    expect(screen.queryByText("Searching…")).toBeNull();
  });

  it("asks for a sync when no catalogue exists", async () => {
    renderApp(<SearchPanel />);
    await goOffline();

    typeQuery("K10188-13");
    expect(await screen.findByText("Catalogue not synchronized")).toBeVisible();
    expect(await screen.findByText(LOOKUP_MESSAGES.unsynced)).toBeVisible();
    expect(screen.queryByText("Searching…")).toBeNull();
  });
});

describe("a stalled network cannot block local results", () => {
  it("shows cached results while a request never settles", async () => {
    await syncedApp(<SearchPanel />);

    // navigator.onLine still claims a connection, as an installed iOS app
    // does in airplane mode, and the request never resolves.
    fetchSpy.mockImplementation(() => new Promise<Response>(() => {}));
    setNetwork(true);

    typeQuery("K10188-13");
    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(screen.queryByText("Searching…")).toBeNull();
  });

  it("keeps local results when the refresh rejects", async () => {
    await syncedApp(<SearchPanel />);
    fetchSpy.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    typeQuery("Abbesses");
    expect(await screen.findByText("K10188-13")).toBeVisible();
    await waitFor(() => expect(screen.queryByText(/refreshing/)).toBeNull());
  });
});

describe("selecting an offline result", () => {
  it("opens cached details and adds them to the inquiry with no requests", async () => {
    await syncedApp(<SearchPanel />);
    await goOffline();

    typeQuery("K10188-13");
    fireEvent.click(await screen.findByRole("button", { name: /K10188-13/ }));

    expect(await screen.findByRole("heading", { name: "大方盘·紫" })).toBeVisible();
    expect(screen.getByText("US$2.40")).toBeVisible();
    expect(screen.getByText("24 pcs/ctn")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add to inquiry" }));
    expect(await screen.findByText(/1 in this inquiry/)).toBeVisible();
    expect(productApiCalls()).toEqual([]);
  });

  it("returns to the results without a route change", async () => {
    await syncedApp(<SearchPanel />);
    await goOffline();

    typeQuery("K10188-13");
    fireEvent.click(await screen.findByRole("button", { name: /K10188-13/ }));
    fireEvent.click(await screen.findByRole("button", { name: "← Back to search" }));

    expect(await screen.findByLabelText(/Search by product/)).toBeVisible();
    expect(productApiCalls()).toEqual([]);
  });
});

describe("search, scan and details share one local lookup", () => {
  it("resolves the same product from a typed query, a scan and a code", () => {
    const typed = lookupLocalSearch(CATALOGUE, READY_ACCESS, "k10188 13");
    const scanned = lookupLocalScan(CATALOGUE, READY_ACCESS, "K10188-13");
    const detailed = lookupLocalProduct(CATALOGUE, READY_ACCESS, "K10188 13");

    expect(typed.status === "ready" && typed.products[0]).toEqual(FEATURED);
    expect(scanned.status === "match" && scanned.match).toEqual({
      kind: "single",
      product: FEATURED,
    });
    expect(detailed.status === "ready" && detailed.product).toEqual(FEATURED);
  });

  it("reports an unsynced catalogue the same way on every path", () => {
    const missing = { kind: "missing" as const };
    expect(lookupLocalSearch([], missing, "K10188-13")).toMatchObject({
      reason: "unsynced",
    });
    expect(lookupLocalScan([], missing, "K10188-13")).toMatchObject({
      reason: "unsynced",
    });
    expect(lookupLocalProduct([], missing, "K10188-13")).toMatchObject({
      reason: "unsynced",
    });
  });
});

describe("logout still deletes the catalogue", () => {
  it("removes every product and the sync record", async () => {
    await replaceCatalogue(CATALOGUE, { lastSyncedAt: Date.now(), count: 102 });
    renderApp(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(async () => {
      expect(await readCatalogueMeta()).toBeNull();
      expect(await countCatalogueProducts()).toBe(0);
    });
  });
});
