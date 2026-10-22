import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CatalogueStatus from "@/components/catalogue-status";
import { CatalogueProvider } from "@/components/catalogue-provider";
import { InquiryProvider } from "@/components/inquiry-store";
import SearchPanel from "@/components/search-panel";
import { zh } from "@/lib/i18n/zh-cn";
import {
  connectivityTraces,
  resetConnectivityForTests,
  setCatalogueSyncTimeoutForTests,
} from "@/lib/offline/connectivity";
import { clearAllLocalData, readCatalogueProducts, replaceCatalogue } from "@/lib/offline/db";
import { readInquiryDraft, writeInquiryDraft } from "@/lib/offline/inquiry-draft";
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
  unitPrice: 2.4,
  packaging: null,
  currency: "USD",
  imageUrl: null,
};

const SECOND: Product = {
  ...PRODUCT,
  id: "f4247a2f-1e3b-4d64-a05f-ab38906b5292",
  code: "K10188-14",
  nameZh: "大方盘·蓝",
  unitPrice: 3,
};

type HealthMode = "fail" | "ok" | "401" | "500" | "hang";

let healthMode: HealthMode = "fail";
let catalogueMode: "ok" | "401" | "500" | "hang" | "invalid" | "network" = "ok";
let catalogueProducts: Product[] = [PRODUCT];

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/health") {
        expect(init?.cache).toBe("no-store");
        expect(init?.credentials).toBe("same-origin");
        if (healthMode === "fail") throw new TypeError("Failed to fetch");
        if (healthMode === "hang") return new Promise<Response>(() => {});
        if (healthMode === "401") return json({ error: "请先登录。" }, 401);
        if (healthMode === "500") return json({ error: "down" }, 500);
        return json({ ok: true });
      }
      if (url === "/api/products/catalogue") {
        expect(init?.cache).toBe("no-store");
        expect(init?.credentials).toBe("same-origin");
        if (catalogueMode === "network") throw new TypeError("Failed to fetch");
        if (catalogueMode === "hang") return new Promise<Response>(() => {});
        if (catalogueMode === "401") return json({ error: "请先登录。" }, 401);
        if (catalogueMode === "500") return json({ error: "down" }, 500);
        if (catalogueMode === "invalid") return json({ products: { bad: true } });
        return json({ products: catalogueProducts, count: catalogueProducts.length });
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
}

function renderStatus(ui: ReactNode = <CatalogueStatus />) {
  return render(
    <InquiryProvider>
      <CatalogueProvider>{ui}</CatalogueProvider>
    </InquiryProvider>,
  );
}

async function seedLocal() {
  await replaceCatalogue([PRODUCT], { lastSyncedAt: Date.now(), count: 1 });
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
  return draft;
}

beforeEach(async () => {
  await clearAllLocalData();
  healthMode = "fail";
  catalogueMode = "ok";
  catalogueProducts = [PRODUCT];
  setNavigatorOnline(false);
  resetCatalogueSyncForTests();
  installFetch();
});

afterEach(async () => {
  cleanup();
  await clearAllLocalData();
  resetCatalogueSyncForTests();
  resetConnectivityForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setNavigatorOnline(true);
});

describe("false offline recovery", () => {
  it("marks the app online when navigator.onLine is false but health succeeds", async () => {
    healthMode = "ok";
    renderStatus();
    expect(await screen.findByText("在线")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重新检测网络" })).toBeNull();
    expect(
      connectivityTraces().some(
        (entry) =>
          entry.event === "health.end" && entry.status === 200 && entry.navigatorOnline === false,
      ),
    ).toBe(true);
  });

  it("synchronizes the catalogue from a manual tap while navigator.onLine is false", async () => {
    catalogueProducts = [PRODUCT, SECOND];
    renderStatus();
    expect(await screen.findByText("离线")).toBeVisible();
    expect(screen.getByRole("button", { name: "同步产品资料" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "同步产品资料" }));
    expect(await screen.findByText("在线")).toBeVisible();
    expect(await screen.findByText(/2 款产品/)).toBeVisible();
    await waitFor(async () => {
      expect(await readCatalogueProducts()).toHaveLength(2);
    });
  });

  it("clears a stale offline warning after 重新检测网络", async () => {
    renderStatus();
    expect(await screen.findByRole("button", { name: "重新检测网络" })).toBeEnabled();
    healthMode = "ok";
    fireEvent.click(screen.getByRole("button", { name: "重新检测网络" }));
    expect(await screen.findByText("在线")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重新检测网络" })).toBeNull();
    expect(screen.getByRole("button", { name: "同步产品资料" })).toBeEnabled();
  });

  it("recovers on a Safari pageshow restoration", async () => {
    renderStatus();
    expect(await screen.findByText("离线")).toBeVisible();
    healthMode = "ok";
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    await act(async () => {
      window.dispatchEvent(event);
    });
    expect(await screen.findByText("在线")).toBeVisible();
    expect(
      connectivityTraces().some(
        (entry) => entry.source === "pageshow-persisted" && entry.status === 200,
      ),
    ).toBe(true);
  });

  it("rechecks when the window regains focus", async () => {
    renderStatus();
    expect(await screen.findByText("离线")).toBeVisible();
    healthMode = "ok";
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText("在线")).toBeVisible();
    expect(connectivityTraces().some((entry) => entry.source === "focus" && entry.status === 200)).toBe(
      true,
    );
  });

  it("rechecks when an installed PWA returns to the foreground", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("standalone"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    }));
    renderStatus();
    expect(await screen.findByText("离线")).toBeVisible();
    expect(connectivityTraces().some((entry) => entry.displayMode === "standalone")).toBe(true);

    healthMode = "ok";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("在线")).toBeVisible();
    expect(
      connectivityTraces().some((entry) => entry.source === "visibility" && entry.status === 200),
    ).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event("resume"));
    });
    await waitFor(() => {
      expect(connectivityTraces().map((entry) => entry.source)).toContain("resume");
    });
  });
});

describe("sync errors stay specific", () => {
  it("shows an expired login when the server answers 401 and keeps local data", async () => {
    const draft = await seedLocal();
    healthMode = "401";
    catalogueMode = "401";
    renderStatus();

    expect(await screen.findByText(zh.sync.loginExpired)).toBeVisible();
    expect(screen.getByRole("link", { name: "重新登录" })).toHaveAttribute("href", "/login");
    expect(screen.getByText("在线")).toBeVisible();
    expect(await readCatalogueProducts()).toHaveLength(1);
    const stored = await readInquiryDraft();
    expect(stored?.customer).toEqual(draft.customer);
    expect(stored?.lines).toHaveLength(1);
    expect((await listOutbox()).map((entry) => entry.clientSubmissionId)).toEqual([
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    ]);
  });

  it("shows a timeout without discarding the catalogue, draft or outbox", async () => {
    setCatalogueSyncTimeoutForTests(250);
    const draft = await seedLocal();
    catalogueMode = "hang";
    renderStatus();
    expect(await screen.findByText("离线")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "同步产品资料" }));
    expect(await screen.findByText("正在连接并同步…")).toBeVisible();
    expect(await screen.findByText(zh.sync.requestTimeout)).toBeVisible();
    expect(screen.queryByText(zh.sync.serverUnreachable)).toBeNull();
    expect(await readCatalogueProducts()).toHaveLength(1);
    const stored = await readInquiryDraft();
    expect(stored?.customer).toEqual(draft.customer);
    expect(stored?.lines).toHaveLength(1);
    expect((await listOutbox()).map((entry) => entry.clientSubmissionId)).toEqual([
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    ]);
  });

  it("shows a server failure for HTTP 500 and keeps the previous catalogue", async () => {
    const draft = await seedLocal();
    healthMode = "ok";
    catalogueMode = "500";
    renderStatus();

    expect(await screen.findByText(zh.sync.serverUnavailable)).toBeVisible();
    expect(screen.getByText("在线")).toBeVisible();
    expect(screen.queryByText(zh.sync.serverUnreachable)).toBeNull();
    expect(await readCatalogueProducts()).toHaveLength(1);
    const stored = await readInquiryDraft();
    expect(stored?.customer).toEqual(draft.customer);
    expect(stored?.lines).toHaveLength(1);
  });

  it("keeps the previous catalogue when the payload is incomplete", async () => {
    await seedLocal();
    healthMode = "ok";
    catalogueMode = "invalid";
    renderStatus();
    expect(await screen.findByText(zh.sync.catalogueInvalid)).toBeVisible();
    expect(await readCatalogueProducts()).toHaveLength(1);
  });

  it("keeps the previous catalogue when the manual sync cannot reach the server", async () => {
    const draft = await seedLocal();
    catalogueMode = "network";
    renderStatus();
    expect(await screen.findByText("离线")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "同步产品资料" }));
    expect(await screen.findByText(zh.sync.serverUnreachable)).toBeVisible();
    expect(await readCatalogueProducts()).toHaveLength(1);
    const stored = await readInquiryDraft();
    expect(stored?.customer).toEqual(draft.customer);
    expect(stored?.lines).toHaveLength(1);
    expect((await listOutbox()).map((entry) => entry.clientSubmissionId)).toEqual([
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    ]);
  });
});

describe("search while the browser reports offline", () => {
  it("searches the cached catalogue and says so", async () => {
    await replaceCatalogue([PRODUCT], { lastSyncedAt: Date.now(), count: 1 });
    renderStatus(
      <>
        <CatalogueStatus />
        <SearchPanel />
      </>,
    );
    expect(await screen.findByText("离线")).toBeVisible();
    fireEvent.change(screen.getByLabelText(/搜索产品/), { target: { value: "K10188-13" } });
    expect(await screen.findByText("K10188-13")).toBeVisible();
    expect(screen.getByText(zh.search.usingCached)).toBeVisible();
  });

  it("keeps sync and retry available when nothing has been synchronized", async () => {
    renderStatus(
      <>
        <CatalogueStatus />
        <SearchPanel />
      </>,
    );
    expect(await screen.findByRole("button", { name: "同步产品资料" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "重新检测网络" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/搜索产品/), { target: { value: "K10188-13" } });
    expect(screen.getAllByText(zh.search.missingOffline).length).toBeGreaterThan(0);
  });
});

describe("connectivity listeners", () => {
  it("removes lifecycle listeners on unmount", async () => {
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const documentRemove = vi.spyOn(document, "removeEventListener");
    const view = renderStatus();
    expect(await screen.findByText("离线")).toBeVisible();
    const callsBefore = vi.mocked(fetch).mock.calls.length;
    view.unmount();

    const windowEvents = windowRemove.mock.calls.map((call) => String(call[0]));
    const documentEvents = documentRemove.mock.calls.map((call) => String(call[0]));
    expect(windowEvents).toEqual(
      expect.arrayContaining([
        "online",
        "offline",
        "pageshow",
        "focus",
        "resume",
        "koei-server-reachable",
      ]),
    );
    expect(documentEvents).toEqual(expect.arrayContaining(["visibilitychange", "resume"]));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("pageshow"));
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("resume"));
    });
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
  });
});
