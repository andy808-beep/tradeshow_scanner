import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppPathProvider } from "@/components/app-path";
import AppScreens from "@/components/app-screens";
import BottomNav from "@/components/bottom-nav";
import { InquiryProvider } from "@/components/inquiry-store";
import { CATALOGUE_DB_VERSION, OUTBOX_STORE, PRODUCTS_STORE } from "@/lib/offline/constants";
import {
  clearAllLocalData,
  getDb,
  replaceCatalogue,
  resetCatalogueDbForTests,
} from "@/lib/offline/db";
import { readInquiryDraft, writeInquiryDraft } from "@/lib/offline/inquiry-draft";
import { enqueueOutboxSnapshot, listOutbox } from "@/lib/offline/inquiry-outbox";
import { resetCatalogueSyncForTests } from "@/lib/offline/sync";
import type { Product } from "@/lib/types";
import type { SavedInquiryDetail, SavedInquiryListItem } from "@/lib/api-contract";

const mocks = vi.hoisted(() => ({
  listSavedInquiriesRequest: vi.fn(),
  getSavedInquiryRequest: vi.fn(),
  exportSavedInquiriesRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => window.location.pathname,
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    listSavedInquiriesRequest: mocks.listSavedInquiriesRequest,
    getSavedInquiryRequest: mocks.getSavedInquiryRequest,
    exportSavedInquiriesRequest: mocks.exportSavedInquiriesRequest,
  };
});

const { default: SavedInquiriesScreen } = await import("@/components/saved-inquiries-screen");
const { default: SavedInquiryDetailScreen } = await import(
  "@/components/saved-inquiry-detail-screen"
);

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

const INQUIRY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const LIST_ITEM: SavedInquiryListItem = {
  id: INQUIRY_ID,
  savedAt: "2026-09-18T04:00:00.000Z",
  customerName: "Ada Lovelace",
  companyName: "Koei Porcelain",
  productCount: 2,
  currency: "USD",
  hasNotes: true,
};

const DETAIL: SavedInquiryDetail = {
  id: INQUIRY_ID,
  savedAt: "2026-09-18T04:00:00.000Z",
  customerName: "Ada Lovelace",
  companyName: "Koei Porcelain",
  notes: "Booth notes",
  currency: "USD",
  items: [
    {
      productCode: "K10188-13",
      productName: "Historic plate name",
      quotedUnitPrice: 9.99,
      notes: "Need samples",
    },
  ],
};

function goOffline() {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
}

function goOnline() {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
}

function renderShell(ui: ReactNode) {
  return render(
    <InquiryProvider>
      <AppPathProvider>{ui}</AppPathProvider>
    </InquiryProvider>,
  );
}

async function seedLocalData() {
  await replaceCatalogue([PRODUCT], { lastSyncedAt: Date.now(), count: 1 });
  await writeInquiryDraft({
    customer: { name: "Draft Ada", company: "Draft Co", notes: "Keep me" },
    currency: "USD",
    lines: [{ product: PRODUCT, quotedUnitPrice: 2.4, notes: "line" }],
    confirmation: null,
    createdAt: 1,
    updatedAt: 1,
  });
  await enqueueOutboxSnapshot(
    {
      customerName: "Queued Ada",
      companyName: "Queued Co",
      notes: "outbox",
      currency: "USD",
      clientSubmissionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      items: [{ productId: PRODUCT.id, quotedPrice: 2.4, notes: "" }],
    },
    { customerName: "Queued Ada", companyName: "Queued Co", productCount: 1, currency: "USD" },
  );
}

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  resetCatalogueSyncForTests();
  await clearAllLocalData();
  resetCatalogueDbForTests();
  goOnline();
  window.history.pushState(null, "", "/");
});

beforeEach(() => {
  goOnline();
  mocks.listSavedInquiriesRequest.mockResolvedValue({
    inquiries: [LIST_ITEM],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  mocks.getSavedInquiryRequest.mockResolvedValue(DETAIL);
});

describe("saved inquiry list", () => {
  it("shows saved fields, a View action, and no edit controls", async () => {
    renderShell(<SavedInquiriesScreen />);
    expect(await screen.findByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("Koei Porcelain")).toBeVisible();
    fireEvent.change(screen.getByLabelText(/Search customer or company/), {
      target: { value: "Ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => {
      expect(mocks.listSavedInquiriesRequest.mock.calls.some(([params]) => String(params).includes("q=Ada"))).toBe(
        true,
      );
    });
    expect(screen.getByRole("link", { name: "View" })).toBeVisible();
    expect(screen.getByText(/2 products recorded/)).toBeVisible();
    expect(screen.getByText(/USD/)).toBeVisible();
    expect(screen.getByText(INQUIRY_ID)).toBeVisible();
    expect(screen.getByText(/Notes/)).toBeVisible();
    expect(screen.getByRole("link", { name: "View" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /append/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/quantity/i);
    expect(document.body.textContent).not.toMatch(/grand total/i);
  });

  it("shows an empty state when nothing matches", async () => {
    mocks.listSavedInquiriesRequest.mockResolvedValue({
      inquiries: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    renderShell(<SavedInquiriesScreen />);
    expect(await screen.findByText(/No saved inquiries match these filters/)).toBeVisible();
  });

  it("shows an error state when the list cannot load", async () => {
    mocks.listSavedInquiriesRequest.mockRejectedValue(new Error("The product database is not available."));
    renderShell(<SavedInquiriesScreen />);
    expect(await screen.findByText("Could not load saved inquiries")).toBeVisible();
    expect(screen.getByText("The product database is not available.")).toBeVisible();
  });
});

describe("saved inquiry detail", () => {
  it("renders the stored snapshot and no totals", async () => {
    renderShell(<SavedInquiryDetailScreen id={INQUIRY_ID} />);
    expect(await screen.findByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("Historic plate name")).toBeVisible();
    expect(screen.getByText("K10188-13")).toBeVisible();
    expect(screen.getByText("US$9.99")).toBeVisible();
    expect(screen.getByText("Booth notes")).toBeVisible();
    expect(screen.getByText("Need samples")).toBeVisible();
    expect(screen.queryByText("Abbesses Plate - L")).toBeNull();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/quantity/i);
    expect(document.body.textContent).not.toMatch(/line total/i);
    expect(document.body.textContent).not.toMatch(/grand total/i);
  });
});

describe("offline saved history", () => {
  it("requires internet access and does not treat the outbox as saved history", async () => {
    await seedLocalData();
    const beforeOutbox = await listOutbox();
    const beforeCatalogue = await getDb().then((db) => db.getAll(PRODUCTS_STORE));

    goOffline();
    window.history.pushState(null, "", "/inquiries");
    renderShell(
      <>
        <AppScreens>{null}</AppScreens>
        <BottomNav />
      </>,
    );

    expect(await screen.findByText("Network required")).toBeVisible();
    expect(
      screen.getByText(/Saved inquiry history requires internet access/),
    ).toBeVisible();
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
    expect(screen.queryByText("Queued Ada")).toBeNull();
    expect(mocks.listSavedInquiriesRequest).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Saved/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /Inquiry/ })).toBeVisible();

    const draft = await readInquiryDraft();
    expect(draft?.customer).toEqual({ name: "Draft Ada", company: "Draft Co", notes: "Keep me" });
    expect(draft?.lines).toHaveLength(1);
    const outbox = await listOutbox();
    expect(outbox).toHaveLength(beforeOutbox.length);
    expect(outbox[0]?.status).toBe("awaiting_sync");
    expect(outbox[0]?.payload.customerName).toBe("Queued Ada");
    expect(await getDb().then((db) => db.getAll(PRODUCTS_STORE))).toEqual(beforeCatalogue);
    const db = await getDb();
    expect(CATALOGUE_DB_VERSION).toBe(3);
    expect(db.objectStoreNames.contains(OUTBOX_STORE)).toBe(true);
    expect(Array.from(db.objectStoreNames)).not.toContain("saved-inquiries");
  });
});

describe("saved navigation", () => {
  it("marks Saved as the current tab on /inquiries", async () => {
    window.history.pushState(null, "", "/inquiries");
    mocks.listSavedInquiriesRequest.mockImplementation(
      () => new Promise(() => undefined),
    );
    renderShell(
      <>
        <AppScreens>{null}</AppScreens>
        <BottomNav />
      </>,
    );
    expect(screen.getByRole("link", { name: /Saved/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^Search$/ })).not.toHaveAttribute("aria-current");
    expect(await screen.findByText("Loading saved inquiries…")).toBeVisible();
  });
});
