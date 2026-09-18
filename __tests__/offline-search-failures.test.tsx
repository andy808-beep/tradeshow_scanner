import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOOKUP_MESSAGES } from "@/lib/offline/constants";
import type { CatalogueSnapshot } from "@/lib/offline/db";
import type { Product } from "@/lib/types";

/**
 * Failure modes of the local layer itself: a rejected IndexedDB read, and sync
 * metadata that claims rows the products store does not hold. Neither may end
 * in a spinner or a silent empty screen.
 */

const mocks = vi.hoisted(() => ({
  readCatalogueSnapshot: vi.fn(),
  readOfflineReadiness: vi.fn(),
  writeOfflineReadiness: vi.fn(),
  replaceCatalogue: vi.fn(),
}));

vi.mock("@/lib/offline/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/db")>();
  return {
    ...actual,
    readCatalogueSnapshot: mocks.readCatalogueSnapshot,
    readOfflineReadiness: mocks.readOfflineReadiness,
    writeOfflineReadiness: mocks.writeOfflineReadiness,
    replaceCatalogue: mocks.replaceCatalogue,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const { CatalogueProvider } = await import("@/components/catalogue-provider");
const { InquiryProvider } = await import("@/components/inquiry-store");
const { default: SearchPanel } = await import("@/components/search-panel");
const { resetCatalogueSyncForTests, syncProductCatalogue } = await import("@/lib/offline/sync");

const PRODUCT: Product = {
  id: "e4247a2f-1e3b-4d64-a05f-ab38906b5292",
  code: "K10188-13",
  nameZh: "大方盘·紫",
  nameEn: "Abbesses Plate - L",
  dimensions: "20.6 × 13.3 × 2.0 cm",
  barcode: null,
  unitPrice: 2.4,
  packaging: null,
  currency: "USD",
  imageUrl: null,
};

const EMPTY_SNAPSHOT: CatalogueSnapshot = {
  meta: null,
  products: [],
  count: 0,
  allCodesSearchable: true,
};

function renderApp(ui: ReactNode) {
  return render(
    <InquiryProvider>
      <CatalogueProvider>{ui}</CatalogueProvider>
    </InquiryProvider>,
  );
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByLabelText(/Search by product/), {
    target: { value },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  mocks.readOfflineReadiness.mockResolvedValue({
    scannerAssetsReadyAt: 1,
    cameraVerifiedAt: 1,
  });
  mocks.readCatalogueSnapshot.mockResolvedValue(EMPTY_SNAPSHOT);
  mocks.replaceCatalogue.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  resetCatalogueSyncForTests();
});

describe("a rejected IndexedDB read is visible, not swallowed", () => {
  it("shows an error and leaves no spinner behind", async () => {
    mocks.readCatalogueSnapshot.mockRejectedValue(new Error("InvalidStateError"));

    renderApp(<SearchPanel />);

    expect(await screen.findByText("Offline catalogue unavailable")).toBeVisible();
    expect(screen.getByText(LOOKUP_MESSAGES.localUnavailable)).toBeVisible();
    expect(screen.queryByText("Searching…")).toBeNull();
  });
});

describe("sync metadata without stored rows", () => {
  it("is treated as no catalogue rather than an empty search", async () => {
    mocks.readCatalogueSnapshot.mockResolvedValue({
      meta: { lastSyncedAt: Date.now(), count: 102 },
      products: [],
      count: 0,
      allCodesSearchable: true,
    });

    renderApp(<SearchPanel />);
    typeQuery("K10188-13");

    expect(await screen.findByText("Catalogue not synchronized")).toBeVisible();
    expect(await screen.findByText(LOOKUP_MESSAGES.unsynced)).toBeVisible();
    expect(screen.queryByText("Searching…")).toBeNull();
  });
});

describe("sync success requires a verified read-back", () => {
  function response(products: Product[], count: number) {
    return new Response(JSON.stringify({ products, count }), { status: 200 });
  }

  it("fails when fewer rows are committed than were downloaded", async () => {
    // Download returns 102 rows, but the committed store only holds one.
    const products = Array.from({ length: 102 }, (_, index) => ({
      ...PRODUCT,
      id: `id-${index}`,
      code: `K${9000 + index}-01`,
    }));
    mocks.readCatalogueSnapshot
      .mockResolvedValueOnce(EMPTY_SNAPSHOT)
      .mockResolvedValueOnce({
        meta: { lastSyncedAt: 1, count: 1 },
        products: [PRODUCT],
        count: 1,
        allCodesSearchable: true,
      });

    await expect(
      syncProductCatalogue(1, async () => response(products, products.length)),
    ).rejects.toThrow(/Only 1 of 102 products were stored/);
  });

  it("fails when a stored record has no searchable code", async () => {
    mocks.readCatalogueSnapshot
      .mockResolvedValueOnce(EMPTY_SNAPSHOT)
      .mockResolvedValueOnce({
        meta: { lastSyncedAt: 1, count: 1 },
        products: [PRODUCT],
        count: 1,
        allCodesSearchable: false,
      });

    await expect(
      syncProductCatalogue(1, async () => response([PRODUCT], 1)),
    ).rejects.toThrow(/no searchable code/);
  });

  it("succeeds only once the committed snapshot matches", async () => {
    const committed = {
      meta: { lastSyncedAt: 1, count: 1 },
      products: [PRODUCT],
      count: 1,
      allCodesSearchable: true,
    };
    mocks.readCatalogueSnapshot
      .mockResolvedValueOnce(EMPTY_SNAPSHOT)
      .mockResolvedValueOnce(committed);

    const result = await syncProductCatalogue(1, async () => response([PRODUCT], 1));

    expect(result.meta).toEqual({ lastSyncedAt: 1, count: 1 });
    expect(mocks.replaceCatalogue).toHaveBeenCalledTimes(1);
    // The reported products are the ones read back, not the HTTP payload.
    expect(result.products).toEqual(committed.products);
  });
});
