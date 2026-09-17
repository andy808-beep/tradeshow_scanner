import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/types";

/**
 * End-to-end offline acceptance: sync online without ever opening Scan, prove
 * the scanner chunks were preloaded, run the user-initiated camera test, go
 * offline, scan, and read the product out of IndexedDB — with no product API
 * call and no route transition.
 */

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  decodeFromConstraints: vi.fn(),
  controlsStop: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@zxing/library", () => ({
  BarcodeFormat: {
    CODE_128: 1,
    CODE_39: 2,
    EAN_13: 3,
    EAN_8: 4,
    UPC_A: 5,
    UPC_E: 6,
    QR_CODE: 7,
  },
  DecodeHintType: { POSSIBLE_FORMATS: 2, TRY_HARDER: 3 },
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints = mocks.decodeFromConstraints;
  },
}));

const { CatalogueProvider } = await import("@/components/catalogue-provider");
const { InquiryProvider } = await import("@/components/inquiry-store");
const { default: CatalogueStatus } = await import("@/components/catalogue-status");
const { default: SearchPanel } = await import("@/components/search-panel");
const { READINESS_MESSAGES } = await import("@/lib/offline/constants");
const { readOfflineReadiness, resetCatalogueDbForTests } = await import(
  "@/lib/offline/db"
);
const { clearConfidentialLocalData } = await import("@/lib/offline/clear");
const { resetScannerPreloadForTests } = await import("@/lib/offline/scanner-assets");

const PRODUCT: Product = {
  id: "e4247a2f-1e3b-4d64-a05f-ab38906b5292",
  code: "K10188-13",
  nameZh: "大方盘·紫",
  nameEn: "Abbesses Plate - L",
  dimensions: "20.6 × 13.3 × 2.0 cm",
  barcode: null,
  unitPrice: 2.4,
  packaging: "24 pcs/ctn",
  currency: "USD",
  imageUrl: null,
};

const CATALOGUE = [PRODUCT, { ...PRODUCT, id: "second", code: "K9426S-19", unitPrice: null }];

type DecodeCallback = (result: { getText: () => string } | undefined) => void;

let decodeCallback: DecodeCallback | null = null;
let fetchSpy: ReturnType<typeof vi.fn>;

function setNetwork(onLine: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: onLine });
}

function catalogueResponse() {
  return new Response(JSON.stringify({ products: CATALOGUE, count: CATALOGUE.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function productApiCalls() {
  return fetchSpy.mock.calls.filter(([input]) => {
    const url = typeof input === "string" ? input : String(input);
    return url.startsWith("/api/products/") && !url.endsWith("/catalogue");
  });
}

async function emit(value: string) {
  await act(async () => {
    decodeCallback?.({ getText: () => value });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  decodeCallback = null;
  resetScannerPreloadForTests();
  setNetwork(true);

  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });

  mocks.decodeFromConstraints.mockImplementation(
    async (_constraints: unknown, video: HTMLVideoElement, cb: DecodeCallback) => {
      decodeCallback = cb;
      Object.defineProperty(video, "srcObject", {
        value: { getTracks: () => [{ stop: vi.fn() }] },
        writable: true,
        configurable: true,
      });
      return { stop: mocks.controlsStop };
    },
  );

  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    if (url === "/api/products/catalogue") return catalogueResponse();
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  cleanup();
  await clearConfidentialLocalData();
  resetCatalogueDbForTests();
  resetScannerPreloadForTests();
  vi.unstubAllGlobals();
});

describe("offline scan acceptance", () => {
  it("syncs, preloads the scanner, tests the camera, then scans offline from IndexedDB", async () => {
    render(
      <InquiryProvider>
        <CatalogueProvider>
          <CatalogueStatus />
          <SearchPanel />
        </CatalogueProvider>
      </InquiryProvider>,
    );

    // 1. Sync products online, without ever opening Scan.
    expect(await screen.findByText("Online")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sync products" }));
    expect(await screen.findByText(/2 products/)).toBeVisible();

    // 2. Scanner and decoder chunks were preloaded by the sync itself.
    await waitFor(async () => {
      const readiness = await readOfflineReadiness();
      expect(readiness.scannerAssetsReadyAt).not.toBeNull();
    });

    // 3. Offline readiness is still withheld until the employee tests the
    //    camera, and no camera was requested without a user action.
    expect(await screen.findByText(READINESS_MESSAGES.cameraTest)).toBeVisible();
    expect(screen.queryByText(READINESS_MESSAGES.ready)).toBeNull();
    expect(mocks.decodeFromConstraints).not.toHaveBeenCalled();

    // 4. Complete the camera test.
    fireEvent.click(screen.getByRole("button", { name: "Test camera" }));
    expect(
      await screen.findByText("Camera works — offline scanning is ready"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close camera test" }));
    expect(await screen.findByText(READINESS_MESSAGES.ready)).toBeVisible();
    await waitFor(async () => {
      const readiness = await readOfflineReadiness();
      expect(readiness.cameraVerifiedAt).not.toBeNull();
    });

    // 5. Switch offline.
    await act(async () => {
      setNetwork(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText("Offline")).toBeVisible();

    const callsBeforeScan = fetchSpy.mock.calls.length;

    // 6. Open Scan offline; the camera starts from the cached chunks.
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    expect(await screen.findByText("Camera active — point at a barcode")).toBeVisible();

    // 7. Decode a known code, normalized against the local catalogue.
    await emit("k10188 13");

    // 8. Details come straight from IndexedDB.
    expect(await screen.findByRole("heading", { name: "大方盘·紫" })).toBeVisible();
    expect(screen.getByText("K10188-13")).toBeVisible();
    expect(screen.getByText("US$2.40")).toBeVisible();
    expect(screen.getByText("24 pcs/ctn")).toBeVisible();

    // 9. No product API request and no route transition.
    expect(productApiCalls()).toEqual([]);
    expect(fetchSpy.mock.calls.length).toBe(callsBeforeScan);
    expect(mocks.push).not.toHaveBeenCalled();

    // 10. The cached product can be added to the inquiry offline.
    fireEvent.click(screen.getByRole("button", { name: "Add to inquiry" }));
    expect(await screen.findByText(/1 in this inquiry/)).toBeVisible();
    expect(productApiCalls()).toEqual([]);
    expect(fetchSpy.mock.calls.length).toBe(callsBeforeScan);
  });

  it("does not claim offline readiness when only the catalogue is synced", async () => {
    render(
      <InquiryProvider>
        <CatalogueProvider>
          <CatalogueStatus />
        </CatalogueProvider>
      </InquiryProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sync products" }));
    expect(await screen.findByText(/2 products/)).toBeVisible();
    expect(screen.queryByText(READINESS_MESSAGES.ready)).toBeNull();
    expect(screen.getByRole("button", { name: "Test camera" })).toBeVisible();
  });

  it("fails immediately offline for a code that is not in the catalogue", async () => {
    render(
      <InquiryProvider>
        <CatalogueProvider>
          <CatalogueStatus />
          <SearchPanel />
        </CatalogueProvider>
      </InquiryProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sync products" }));
    expect(await screen.findByText(/2 products/)).toBeVisible();
    await act(async () => {
      setNetwork(false);
      window.dispatchEvent(new Event("offline"));
    });

    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await screen.findByText("Camera active — point at a barcode");
    await emit("9999999999999");

    expect(
      await screen.findByText("No product found for barcode: 9999999999999"),
    ).toBeVisible();
    expect(productApiCalls()).toEqual([]);
  });

});
