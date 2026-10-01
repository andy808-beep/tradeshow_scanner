import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CatalogueStatus from "@/components/catalogue-status";
import { CatalogueProvider } from "@/components/catalogue-provider";
import { InquiryProvider } from "@/components/inquiry-store";
import LogoutButton from "@/components/logout-button";
import ProductDetailScreen from "@/components/product-detail-screen";
import SearchPanel from "@/components/search-panel";
import {
  clearAllLocalData,
  readCatalogueMeta,
  readCatalogueProducts,
  replaceCatalogue,
} from "@/lib/offline/db";
import { writeInquiryDraft, readInquiryDraft } from "@/lib/offline/inquiry-draft";
import { enqueueOutboxSnapshot, listOutbox } from "@/lib/offline/inquiry-outbox";
import { resetCatalogueSyncForTests } from "@/lib/offline/sync";
import type { Product } from "@/lib/types";

const PRODUCT: Product = {
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

vi.mock("@/lib/auth/actions", () => ({
  signOutAction: vi.fn(async () => undefined),
}));

function goOffline() {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
}

function goOnline() {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
}

function renderCatalogue(ui: ReactNode) {
  return render(
    <InquiryProvider>
      <CatalogueProvider>{ui}</CatalogueProvider>
    </InquiryProvider>,
  );
}

afterEach(async () => {
  cleanup();
  // Emptying the stores, rather than deleting the database, keeps the single
  // connection this file opens alive so the next test cannot block on it.
  await clearAllLocalData();
  resetCatalogueSyncForTests();
  vi.unstubAllGlobals();
  goOnline();
});

describe("online/offline status", () => {
  it("shows Online when the browser reports a connection", async () => {
    goOnline();
    renderCatalogue(<CatalogueStatus />);
    expect(await screen.findByText("在线")).toBeVisible();
    expect(screen.getByRole("button", { name: "同步产品资料" })).toBeEnabled();
  });

  it("shows Offline and disables sync without a network", async () => {
    goOffline();
    renderCatalogue(<CatalogueStatus />);
    expect(await screen.findByText("离线")).toBeVisible();
    expect(screen.getByRole("button", { name: "同步产品资料" })).toBeDisabled();
  });

  it("warns when no offline catalogue exists", async () => {
    renderCatalogue(<CatalogueStatus />);
    expect(
      await screen.findByText(/尚未同步产品资料。当前可在线搜索和扫码，同步后可离线使用/),
    ).toBeVisible();
    expect(screen.getByText(/本机在授权有效期内可查看已缓存的价格/)).toBeVisible();
  });

  it("shows last synced time after a catalogue is stored", async () => {
    await replaceCatalogue([PRODUCT], { lastSyncedAt: Date.now(), count: 1 });
    renderCatalogue(<CatalogueStatus />);
    expect(await screen.findByText(/产品资料上次同步时间/)).toBeVisible();
    expect(screen.getByText(/1 款产品/)).toBeVisible();
    expect(screen.getByText(/离线价格有效至/)).toBeVisible();
  });
});

describe("search uses the local catalogue", () => {
  it("finds a cached product without calling the search API", async () => {
    await replaceCatalogue([PRODUCT], { lastSyncedAt: Date.now(), count: 1 });
    goOffline();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderCatalogue(
      <>
        <CatalogueStatus />
        <SearchPanel />
      </>,
    );

    expect(await screen.findByText(/产品资料上次同步时间/)).toBeVisible();
    fireEvent.change(screen.getByLabelText(/搜索产品/), {
      target: { value: "K10188-13" },
    });
    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not call a missing catalogue a product miss", async () => {
    goOffline();
    renderCatalogue(<SearchPanel />);
    fireEvent.change(screen.getByLabelText(/搜索产品/), {
      target: { value: "K10188-13" },
    });
    expect(await screen.findByText("尚未同步产品资料")).toBeVisible();
    expect(screen.queryByText(/product not found/i)).toBeNull();
  });
});

describe("offline product details", () => {
  it("loads a cached product and keeps a null listed price", async () => {
    await replaceCatalogue([PRODUCT], { lastSyncedAt: Date.now(), count: 1 });
    goOffline();
    renderCatalogue(<ProductDetailScreen code="K10188-13" />);
    expect(await screen.findByRole("heading", { name: "大方盘·紫" })).toBeVisible();
    expect(screen.getByText("K10188-13")).toBeVisible();
    expect(screen.getByText("Abbesses Plate - L")).toBeVisible();
    expect(screen.getByText("20.6 × 13.3 × 2.0 cm")).toBeVisible();
    expect(screen.getByText("尺寸")).toBeVisible();
    expect(screen.getByText("单价")).toBeVisible();
    expect(screen.getByText("包装资料")).toBeVisible();
    expect(screen.getByRole("button", { name: "加入本次询问" })).toBeVisible();
    expect(screen.getAllByText("待补充").length).toBeGreaterThan(0);
    expect(screen.queryByText("Barcode")).toBeNull();
  });

  it("does not show a barcode row even when a barcode is stored", async () => {
    const withBarcode: Product = { ...PRODUCT, barcode: "4901234567894" };
    await replaceCatalogue([withBarcode], { lastSyncedAt: Date.now(), count: 1 });
    goOffline();
    renderCatalogue(<ProductDetailScreen code="K10188-13" />);
    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(screen.queryByText("Barcode")).toBeNull();
    expect(screen.queryByText("4901234567894")).toBeNull();
  });

  it("says the product is missing locally rather than inventing a network miss", async () => {
    await replaceCatalogue([PRODUCT], { lastSyncedAt: Date.now(), count: 1 });
    goOffline();
    renderCatalogue(<ProductDetailScreen code="NO-SUCH" />);
    expect(await screen.findByText("未找到该产品")).toBeVisible();
    expect(screen.queryByText(/not found in the database/i)).toBeNull();
  });

  it("blocks prices after the seven-day offline window", async () => {
    await replaceCatalogue([PRODUCT], { lastSyncedAt: 1, count: 1 });
    goOffline();
    renderCatalogue(<ProductDetailScreen code="K10188-13" />);
    expect(await screen.findByText("本机产品资料已过期，请联网后重新同步。")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "大方盘·紫" })).toBeNull();
  });
});

describe("logout clearing IndexedDB", () => {
  it("erases the local catalogue, draft and outbox from the 退出登录 button", async () => {
    await replaceCatalogue([PRODUCT], { lastSyncedAt: Date.now(), count: 1 });
    await writeInquiryDraft({
      customer: { name: "Ada", company: "Koei", notes: "secret" },
      currency: "USD",
      lines: [{ product: PRODUCT, quotedUnitPrice: 2.4, notes: "line" }],
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
        items: [{ productId: PRODUCT.id, quotedPrice: 2.4, notes: "" }],
      },
      { customerName: "Ada", companyName: "Koei", productCount: 1, currency: "USD" },
    );

    renderCatalogue(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await waitFor(async () => {
      expect(await readCatalogueMeta()).toBeNull();
      expect(await readCatalogueProducts()).toEqual([]);
      expect(await readInquiryDraft()).toBeNull();
      expect(await listOutbox()).toEqual([]);
    });
  });
});
