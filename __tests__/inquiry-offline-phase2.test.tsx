import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppPathProvider, useAppPath } from "@/components/app-path";
import AppScreens from "@/components/app-screens";
import { CatalogueProvider } from "@/components/catalogue-provider";
import InquiryScreen from "@/components/inquiry-screen";
import { InquiryProvider, useInquiry } from "@/components/inquiry-store";
import InquirySyncStatus from "@/components/inquiry-sync-status";
import ProductDetailView from "@/components/product-detail-view";
import { ApiError } from "@/lib/api-client";
import { CATALOGUE_DB_VERSION, DRAFT_STORE, OUTBOX_STORE, PRODUCTS_STORE } from "@/lib/offline/constants";
import {
  clearAllLocalData,
  getDb,
  replaceCatalogue,
  resetCatalogueDbForTests,
} from "@/lib/offline/db";
import { readInquiryDraft, writeInquiryDraft } from "@/lib/offline/inquiry-draft";
import {
  enqueueOutboxSnapshot,
  listOutbox,
  recoverInterruptedSyncs,
  writeOutboxRecord,
} from "@/lib/offline/inquiry-outbox";
import { resetInquirySyncForTests, syncInquiryOutbox } from "@/lib/offline/inquiry-sync";
import { resetCatalogueSyncForTests } from "@/lib/offline/sync";
import type { Product } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  createInquiryRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
  usePathname: () => window.location.pathname,
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    createInquiryRequest: mocks.createInquiryRequest,
  };
});

const PLATE: Product = {
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

const CUP: Product = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "K9000-01",
  nameZh: "杯碟-红",
  nameEn: "Cup and Saucer",
  dimensions: "11 × 8.5 × 6 cm",
  barcode: null,
  unitPrice: 1.5,
  packaging: null,
  currency: "USD",
  imageUrl: null,
};

function Probe({ onReady }: { onReady: (inquiry: ReturnType<typeof useInquiry>) => void }) {
  onReady(useInquiry());
  return null;
}

function Seed({ product, children }: { product: Product; children: ReactNode }) {
  const { addProduct, ready } = useInquiry();
  const seeded = useRef(false);
  useEffect(() => {
    if (!ready || seeded.current) return;
    seeded.current = true;
    addProduct(product);
  }, [addProduct, product, ready]);
  if (!ready) return null;
  return <>{children}</>;
}

function renderApp(ui: ReactNode) {
  let latest: ReturnType<typeof useInquiry> | null = null;
  const view = render(
    <InquiryProvider>
      <CatalogueProvider>
        <AppPathProvider>
          <Probe
            onReady={(inquiry) => {
              latest = inquiry;
            }}
          />
          {ui}
        </AppPathProvider>
      </CatalogueProvider>
    </InquiryProvider>,
  );
  return {
    ...view,
    inquiry: () => {
      if (!latest) throw new Error("Inquiry store was not ready");
      return latest;
    },
  };
}

function PathButton({ href, label }: { href: string; label: string }) {
  const { navigate } = useAppPath();
  return (
    <button type="button" onClick={() => navigate(href)}>
      {label}
    </button>
  );
}

function goOffline() {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
}

function goOnline() {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
}

async function waitForReady(inquiry: () => ReturnType<typeof useInquiry>) {
  await waitFor(() => {
    expect(inquiry().ready).toBe(true);
  });
}

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  resetInquirySyncForTests();
  resetCatalogueSyncForTests();
  await clearAllLocalData();
  resetCatalogueDbForTests();
  goOnline();
  window.history.pushState(null, "", "/");
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mocks.createInquiryRequest.mockReset();
  mocks.replace.mockReset();
  goOnline();
});

describe("IndexedDB schema", () => {
  it("opens version 3 with draft and outbox stores", async () => {
    expect(CATALOGUE_DB_VERSION).toBe(3);
    const db = await getDb();
    expect(db.objectStoreNames.contains(DRAFT_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(OUTBOX_STORE)).toBe(true);
  });
});

describe("/inquiry opens offline from the cached shell", () => {
  it("renders the inquiry screen without a server or inquiry API request", async () => {
    goOffline();
    window.history.pushState(null, "", "/inquiry");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderApp(<AppScreens>{null}</AppScreens>);

    expect(await screen.findByText("No products yet")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save inquiry" })).toBeNull();
  });
});

describe("draft persistence", () => {
  it("restores customer fields, notes, prices and products after remount", async () => {
    goOffline();
    const first = renderApp(
      <Seed product={PLATE}>
        <InquiryScreen />
      </Seed>,
    );
    await screen.findByRole("button", { name: "Save inquiry" });
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Koei" } });
    fireEvent.change(screen.getByLabelText(/^Notes$/), { target: { value: "Booth A" } });
    fireEvent.change(screen.getByLabelText("Quoted unit price"), { target: { value: "3.5" } });
    fireEvent.change(screen.getByLabelText("Product notes"), { target: { value: "Gift box" } });

    await waitFor(async () => {
      const stored = await readInquiryDraft();
      expect(stored?.customer.name).toBe("Ada Lovelace");
      expect(stored?.lines[0]?.quotedUnitPrice).toBe(3.5);
      expect(stored?.lines[0]?.notes).toBe("Gift box");
      expect(JSON.stringify(stored)).not.toMatch(/"quantity"/i);
    });

    first.unmount();

    renderApp(<InquiryScreen />);
    expect(await screen.findByDisplayValue("Ada Lovelace")).toBeVisible();
    expect(screen.getByLabelText("Company")).toHaveValue("Koei");
    expect(screen.getByLabelText(/^Notes$/)).toHaveValue("Booth A");
    expect(screen.getByLabelText("Quoted unit price")).toHaveValue("3.5");
    expect(screen.getByLabelText("Product notes")).toHaveValue("Gift box");
    expect(screen.getByText("K10188-13")).toBeVisible();
    expect(screen.getByText("Draft")).toBeVisible();
  });

  it("shows products added from details on the inquiry page", async () => {
    goOffline();
    await replaceCatalogue([PLATE], { lastSyncedAt: Date.now(), count: 1 });

    const { inquiry } = renderApp(
      <>
        <PathButton href="/inquiry" label="Open inquiry" />
        <AppScreens>{null}</AppScreens>
      </>,
    );
    await waitForReady(inquiry);

    act(() => {
      inquiry().addProduct(PLATE);
    });
    fireEvent.click(screen.getByRole("button", { name: "Open inquiry" }));

    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save inquiry" })).toBeVisible();
  });
});

describe("local validation", () => {
  it("requires a customer name, a product and a quoted price", async () => {
    goOffline();
    const { inquiry } = renderApp(
      <Seed product={PLATE}>
        <InquiryScreen />
      </Seed>,
    );
    await screen.findByRole("button", { name: "Save inquiry" });
    expect(screen.getByRole("button", { name: "Save inquiry" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    expect(screen.getByRole("button", { name: "Save inquiry" })).toBeEnabled();

    act(() => {
      inquiry().setQuotedUnitPrice(PLATE.id, null);
    });
    expect(screen.getByRole("button", { name: "Save inquiry" })).toBeDisabled();
  });
});

describe("offline save and immutable queue", () => {
  it("creates one queued snapshot and does not call the inquiry API", async () => {
    goOffline();
    renderApp(
      <Seed product={PLATE}>
        <InquiryScreen />
      </Seed>,
    );
    await screen.findByRole("button", { name: "Save inquiry" });
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Koei" } });
    fireEvent.click(screen.getByRole("button", { name: "Save inquiry" }));

    expect(
      await screen.findByText("Inquiry saved on this device — awaiting synchronization."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Start next inquiry" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save inquiry" })).toBeNull();
    expect(screen.queryByLabelText("Quoted unit price")).toBeNull();
    expect(mocks.createInquiryRequest).not.toHaveBeenCalled();

    const queued = await listOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("awaiting_sync");
    expect(queued[0].payload.clientSubmissionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(queued[0].payload.items[0]).toEqual({
      productId: PLATE.id,
      quotedPrice: 2.4,
      notes: "",
    });
    expect(JSON.stringify(queued[0].payload)).not.toMatch(/quantity/i);
  });

  it("keeps the queued snapshot when Start next inquiry begins a new session", async () => {
    goOffline();
    const { inquiry } = renderApp(
      <Seed product={PLATE}>
        <InquiryScreen />
      </Seed>,
    );
    await screen.findByRole("button", { name: "Save inquiry" });
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Save inquiry" }));
    expect(
      await screen.findByText("Inquiry saved on this device — awaiting synchronization."),
    ).toBeVisible();

    const before = await listOutbox();
    fireEvent.click(screen.getByRole("button", { name: "Start next inquiry" }));

    await waitFor(() => {
      expect(inquiry().confirmation).toBeNull();
      expect(inquiry().lines).toEqual([]);
    });
    await expect(listOutbox()).resolves.toEqual(before);
  });

  it("allows the same customer to create a second separate inquiry", async () => {
    goOffline();
    const { inquiry } = renderApp(
      <Seed product={PLATE}>
        <InquiryScreen />
      </Seed>,
    );
    await screen.findByRole("button", { name: "Save inquiry" });
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Koei" } });
    fireEvent.click(screen.getByRole("button", { name: "Save inquiry" }));
    await screen.findByRole("button", { name: "Start next inquiry" });
    fireEvent.click(screen.getByRole("button", { name: "Start next inquiry" }));

    await waitFor(() => expect(inquiry().confirmation).toBeNull());
    act(() => {
      inquiry().updateCustomer({ name: "Ada", company: "Koei" });
      inquiry().addProduct(CUP);
    });
    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Save inquiry" }));
    expect(
      await screen.findByText("Inquiry saved on this device — awaiting synchronization."),
    ).toBeVisible();

    const queued = await listOutbox();
    expect(queued).toHaveLength(2);
    expect(queued[0].payload.clientSubmissionId).not.toBe(queued[1].payload.clientSubmissionId);
    expect(queued.map((row) => row.payload.customerName)).toEqual(["Ada", "Ada"]);
    expect(queued.map((row) => row.payload.items[0].productId).sort()).toEqual(
      [CUP.id, PLATE.id].sort(),
    );
  });
});

describe("outbox synchronization", () => {
  const payload = {
    customerName: "Ada",
    companyName: "Koei",
    notes: "",
    currency: "USD",
    clientSubmissionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    items: [{ productId: PLATE.id, quotedPrice: 2.4, notes: "" }],
  };

  it("retries after a network timeout and keeps the snapshot", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    mocks.createInquiryRequest.mockRejectedValueOnce(abort);

    await enqueueOutboxSnapshot(payload, {
      customerName: "Ada",
      companyName: "Koei",
      productCount: 1,
      currency: "USD",
    });

    const result = await syncInquiryOutbox(true);
    expect(result.synchronized).toBe(0);
    expect(result.awaiting).toBe(1);
    const rows = await listOutbox();
    expect(rows[0].status).toBe("awaiting_sync");
    expect(rows[0].payload.clientSubmissionId).toBe(payload.clientSubmissionId);
  });

  it("retains the snapshot on 401 and asks for sign-in", async () => {
    mocks.createInquiryRequest.mockRejectedValueOnce(new ApiError("unauthenticated", 401));
    await enqueueOutboxSnapshot(payload, {
      customerName: "Ada",
      companyName: "Koei",
      productCount: 1,
      currency: "USD",
    });

    const result = await syncInquiryOutbox(true);
    expect(result.requiresSignIn).toBe(true);
    expect(result.awaiting).toBe(1);
    await expect(listOutbox()).resolves.toMatchObject([{ status: "awaiting_sync" }]);
  });

  it("marks validation failures as needs attention without deleting the snapshot", async () => {
    mocks.createInquiryRequest.mockRejectedValueOnce(
      new ApiError("The inquiry could not be saved.", 400, ["A customer name is required."]),
    );
    await enqueueOutboxSnapshot(payload, {
      customerName: "Ada",
      companyName: "Koei",
      productCount: 1,
      currency: "USD",
    });
    const result = await syncInquiryOutbox(true);
    expect(result.needsAttention).toBe(1);
    const rows = await listOutbox();
    expect(rows[0].status).toBe("needs_attention");
    expect(rows[0].lastError).toMatch(/customer name/i);
  });

  it("treats a successful retry as the same snapshot and stores the server id", async () => {
    mocks.createInquiryRequest.mockResolvedValue("server-inquiry-1");
    await enqueueOutboxSnapshot(payload, {
      customerName: "Ada",
      companyName: "Koei",
      productCount: 1,
      currency: "USD",
    });
    await syncInquiryOutbox(true);
    resetInquirySyncForTests();
    await syncInquiryOutbox(true);

    expect(mocks.createInquiryRequest).toHaveBeenCalledTimes(1);
    expect(mocks.createInquiryRequest.mock.calls[0][0].clientSubmissionId).toBe(
      payload.clientSubmissionId,
    );
    const rows = await listOutbox();
    expect(rows[0].status).toBe("synchronized");
    expect(rows[0].serverInquiryId).toBe("server-inquiry-1");
  });

  it("recovers interrupted Syncing entries after restart", async () => {
    await enqueueOutboxSnapshot(payload, {
      customerName: "Ada",
      companyName: "Koei",
      productCount: 1,
      currency: "USD",
    });
    const [row] = await listOutbox();
    await writeOutboxRecord({ ...row, status: "syncing" });

    expect(await recoverInterruptedSyncs()).toBe(1);
    await expect(listOutbox()).resolves.toMatchObject([{ status: "awaiting_sync" }]);
  });

  it("does not leave a row in Syncing after an offline restart sync pass", async () => {
    await enqueueOutboxSnapshot(payload, {
      customerName: "Ada",
      companyName: "Koei",
      productCount: 1,
      currency: "USD",
    });
    const [row] = await listOutbox();
    await writeOutboxRecord({ ...row, status: "syncing" });
    await syncInquiryOutbox(false);
    await expect(listOutbox()).resolves.toMatchObject([{ status: "awaiting_sync" }]);
  });
});

describe("sync triggers", () => {
  const payload = {
    customerName: "Ada",
    companyName: "Koei",
    notes: "",
    currency: "USD",
    clientSubmissionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    items: [{ productId: PLATE.id, quotedPrice: 2.4, notes: "" }],
  };

  it("retries when the browser reports connectivity restored", async () => {
    mocks.createInquiryRequest.mockResolvedValue("server-online");
    await enqueueOutboxSnapshot(payload, {
      customerName: "Ada",
      companyName: "Koei",
      productCount: 1,
      currency: "USD",
    });
    goOnline();
    renderApp(<InquirySyncStatus />);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(mocks.createInquiryRequest).toHaveBeenCalled();
    });
    expect(await screen.findByRole("link", { name: "View saved inquiry" })).toHaveAttribute(
      "href",
      "/inquiries/server-online",
    );
    expect(screen.getByText("All inquiries synchronized")).toBeVisible();
  });

  it("retries when the app returns to the foreground", async () => {
    mocks.createInquiryRequest.mockResolvedValue("server-visible");
    await enqueueOutboxSnapshot(payload, {
      customerName: "Ada",
      companyName: "Koei",
      productCount: 1,
      currency: "USD",
    });
    renderApp(<InquirySyncStatus />);
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => {
      expect(mocks.createInquiryRequest).toHaveBeenCalled();
    });
  });

  it("sends queued inquiries from the Sync inquiries button", async () => {
    mocks.createInquiryRequest.mockResolvedValue("server-manual");
    await enqueueOutboxSnapshot(payload, {
      customerName: "Ada",
      companyName: "Koei",
      productCount: 1,
      currency: "USD",
    });
    renderApp(<InquirySyncStatus />);
    fireEvent.click(await screen.findByRole("button", { name: "Sync inquiries" }));
    await waitFor(() => {
      expect(mocks.createInquiryRequest).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/Last inquiry sync/)).toBeVisible();
  });
});

describe("catalogue expiry does not delete the outbox", () => {
  it("keeps queued inquiries after the seven-day window", async () => {
    await replaceCatalogue([PLATE], { lastSyncedAt: 1, count: 1 });
    await enqueueOutboxSnapshot(
      {
        customerName: "Ada",
        companyName: "Koei",
        notes: "",
        currency: "USD",
        clientSubmissionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        items: [{ productId: PLATE.id, quotedPrice: 2.4, notes: "" }],
      },
      { customerName: "Ada", companyName: "Koei", productCount: 1, currency: "USD" },
    );

    await writeInquiryDraft({
      customer: { name: "Ada", company: "Koei", notes: "" },
      currency: "USD",
      lines: [{ product: PLATE, quotedUnitPrice: 2.4, notes: "" }],
      confirmation: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(await listOutbox()).toHaveLength(1);
    expect(await readInquiryDraft()).not.toBeNull();
  });
});

describe("logout clears confidential IndexedDB stores", () => {
  it("erases the draft, outbox and catalogue", async () => {
    await replaceCatalogue([PLATE], { lastSyncedAt: Date.now(), count: 1 });
    await writeInquiryDraft({
      customer: { name: "Ada", company: "Koei", notes: "secret" },
      currency: "USD",
      lines: [{ product: PLATE, quotedUnitPrice: 2.4, notes: "line" }],
      confirmation: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await enqueueOutboxSnapshot(
      {
        customerName: "Ada",
        companyName: "Koei",
        notes: "secret",
        currency: "USD",
        clientSubmissionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        items: [{ productId: PLATE.id, quotedPrice: 2.4, notes: "" }],
      },
      { customerName: "Ada", companyName: "Koei", productCount: 1, currency: "USD" },
    );

    await clearAllLocalData();

    expect(await readInquiryDraft()).toBeNull();
    expect(await listOutbox()).toEqual([]);
    const db = await getDb();
    expect(await db.count(PRODUCTS_STORE)).toBe(0);
  });
});

describe("existing product add path still works", () => {
  it("adds a product to the current inquiry from product details", async () => {
    await replaceCatalogue([PLATE], { lastSyncedAt: Date.now(), count: 1 });
    const { inquiry } = renderApp(<ProductDetailView product={PLATE} onBack={() => undefined} />);
    await waitForReady(inquiry);
    fireEvent.click(await screen.findByRole("button", { name: "Add to inquiry" }));
    expect(inquiry().lines).toHaveLength(1);
    expect(screen.getByText("Added to inquiry")).toBeVisible();
  }, 15_000);
});
