import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogueProvider } from "@/components/catalogue-provider";
import CatalogueStatus from "@/components/catalogue-status";
import { InquiryProvider } from "@/components/inquiry-store";
import SearchPanel from "@/components/search-panel";
import { LOOKUP_MESSAGES } from "@/lib/offline/constants";
import { clearAllLocalData, replaceCatalogue } from "@/lib/offline/db";
import { readInquiryDraft, writeInquiryDraft } from "@/lib/offline/inquiry-draft";
import { enqueueOutboxSnapshot, listOutbox } from "@/lib/offline/inquiry-outbox";
import { scanProductsLocalFirst } from "@/lib/offline/lookup";
import {
  requestBackgroundCatalogueSync,
  resetCatalogueSyncForTests,
  syncProductCatalogue,
} from "@/lib/offline/sync";
import type { Product } from "@/lib/types";

vi.mock("@/lib/offline/scanner-assets", () => ({
  preloadScannerAssets: vi.fn(async () => true),
  resetScannerPreloadForTests: vi.fn(),
}));

const PRODUCT: Product = {
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function catalogueCalls() {
  return fetchSpy.mock.calls.filter(([input]) => {
    const url = typeof input === "string" ? input : String(input);
    return url === "/api/products/catalogue";
  });
}

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
  resetCatalogueSyncForTests();
  setNetwork(true);
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  cleanup();
  await clearAllLocalData();
  resetCatalogueSyncForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("online cold-start catalogue", () => {
  it("searches through the product API when IndexedDB is empty", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/products/catalogue") {
        throw new TypeError("Failed to fetch");
      }
      if (url === "/api/products?q=K10188-13") {
        expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
        return jsonResponse({ products: [PRODUCT] });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    renderApp(
      <>
        <CatalogueStatus />
        <SearchPanel />
      </>,
    );

    expect(await screen.findByText(LOOKUP_MESSAGES.syncFailedRetry)).toBeVisible();
    typeQuery("K10188-13");
    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(await screen.findByText("Abbesses Plate - L")).toBeVisible();
    expect(screen.queryByText("Catalogue not synchronized")).toBeNull();
  });

  it("resolves a barcode through the product API when IndexedDB is empty", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/products?q=4901234567894") {
        return jsonResponse({ products: [PRODUCT] });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await scanProductsLocalFirst(
      [],
      { kind: "missing" },
      "4901234567894",
      new AbortController().signal,
      true,
    );

    expect(result).toEqual({
      status: "match",
      match: { kind: "single", product: PRODUCT },
      source: "network",
    });
  });

  it("triggers one background catalogue refresh after authenticated startup", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/products/catalogue") {
        expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
        return jsonResponse({ products: [PRODUCT], count: 1 });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    renderApp(<CatalogueStatus />);

    expect(await screen.findByText(/1 product/)).toBeVisible();
    expect(catalogueCalls()).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "Sync products" })).toBeEnabled();
  });

  it("keeps search usable while the background refresh is running", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/products/catalogue") {
        return new Promise<Response>(() => {});
      }
      if (url === "/api/products?q=K10188-13") {
        return jsonResponse({ products: [PRODUCT] });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    renderApp(
      <>
        <CatalogueStatus />
        <SearchPanel />
      </>,
    );

    expect(await screen.findByText("Syncing…")).toBeVisible();
    typeQuery("K10188-13");
    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(screen.getByText("Syncing…")).toBeVisible();
    expect(catalogueCalls()).toHaveLength(1);
  });

  it("keeps a valid local catalogue if the background refresh fails", async () => {
    await replaceCatalogue([PRODUCT], { lastSyncedAt: Date.now(), count: 1 });
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/products/catalogue") {
        throw new TypeError("Failed to fetch");
      }
      if (url.startsWith("/api/products?")) {
        throw new TypeError("Failed to fetch");
      }
      throw new Error(`unexpected request: ${url}`);
    });

    renderApp(
      <>
        <CatalogueStatus />
        <SearchPanel />
      </>,
    );

    expect(await screen.findByText(/Last synced/)).toBeVisible();
    expect(await screen.findByText(LOOKUP_MESSAGES.syncFailed)).toBeVisible();
    typeQuery("K10188-13");
    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(screen.getByText("Abbesses Plate - L")).toBeVisible();
  });

  it("does not expose an expired catalogue while genuinely offline", async () => {
    await replaceCatalogue([PRODUCT], { lastSyncedAt: 1, count: 1 });
    await goOffline();

    renderApp(
      <>
        <CatalogueStatus />
        <SearchPanel />
      </>,
    );

    expect(await screen.findByText(LOOKUP_MESSAGES.expired)).toBeVisible();
    typeQuery("K10188-13");
    expect(await screen.findByText("Offline access expired")).toBeVisible();
    expect(screen.queryByText("Abbesses Plate - L")).toBeNull();
    expect(catalogueCalls()).toHaveLength(0);
  });

  it("deduplicates concurrent startup and manual catalogue refresh", async () => {
    let settle: ((response: Response) => void) | undefined;
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/products/catalogue") {
        return new Promise<Response>((resolve) => {
          settle = resolve;
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    renderApp(<CatalogueStatus />);
    expect(await screen.findByText("Syncing…")).toBeVisible();
    await waitFor(() => expect(catalogueCalls()).toHaveLength(1));

    const manual = syncProductCatalogue();
    fireEvent.click(screen.getByRole("button", { name: "Syncing…" }));
    expect(catalogueCalls()).toHaveLength(1);

    expect(typeof settle).toBe("function");
    settle!(jsonResponse({ products: [PRODUCT], count: 1 }));
    await manual;
    expect(await screen.findByText(/1 product/)).toBeVisible();
    expect(catalogueCalls()).toHaveLength(1);
  });

  it("leaves the inquiry draft and outbox unchanged after catalogue sync", async () => {
    const draft = {
      customer: { name: "Ada", company: "Koei", notes: "booth" },
      currency: "USD" as const,
      lines: [{ product: PRODUCT, quotedUnitPrice: 2.4, notes: "line" }],
      confirmation: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    await writeInquiryDraft(draft);
    await enqueueOutboxSnapshot(
      {
        customerName: "Ada",
        companyName: "Koei",
        notes: "booth",
        currency: "USD",
        clientSubmissionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        items: [{ productId: PRODUCT.id, quotedPrice: 2.4, notes: "" }],
      },
      { customerName: "Ada", companyName: "Koei", productCount: 1, currency: "USD" },
    );
    const draftBefore = await readInquiryDraft();
    const outboxBefore = await listOutbox();

    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/products/catalogue") {
        return jsonResponse({ products: [PRODUCT], count: 1 });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const first = requestBackgroundCatalogueSync();
    const second = syncProductCatalogue();
    await waitFor(() => expect(catalogueCalls()).toHaveLength(1));
    await Promise.all([first, second]);

    await expect(readInquiryDraft()).resolves.toEqual(draftBefore);
    await expect(listOutbox()).resolves.toEqual(outboxBefore);
  });
});
