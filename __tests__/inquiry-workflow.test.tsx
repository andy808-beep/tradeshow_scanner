import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogueProvider } from "@/components/catalogue-provider";
import InquiryScreen from "@/components/inquiry-screen";
import { InquiryProvider, useInquiry } from "@/components/inquiry-store";
import ProductDetailView from "@/components/product-detail-view";
import SearchPanel from "@/components/search-panel";
import { ApiError } from "@/lib/api-client";
import { clearAllLocalData, replaceCatalogue, resetCatalogueDbForTests } from "@/lib/offline/db";
import { listOutbox } from "@/lib/offline/inquiry-outbox";
import { resetInquirySyncForTests } from "@/lib/offline/inquiry-sync";
import { resetCatalogueSyncForTests } from "@/lib/offline/sync";
import type { Product } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  createInquiryRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
  usePathname: () => "/",
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

const UNPRICED: Product = {
  ...CUP,
  id: "22222222-2222-4222-8222-222222222222",
  code: "K9426S-19",
  unitPrice: null,
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

function renderSession(ui: ReactNode) {
  let latest: ReturnType<typeof useInquiry> | null = null;
  const view = render(
    <InquiryProvider>
      <Probe
        onReady={(inquiry) => {
          latest = inquiry;
        }}
      />
      {ui}
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

async function renderEditor(product: Product = PLATE) {
  const view = renderSession(
    <Seed product={product}>
      <InquiryScreen />
    </Seed>,
  );
  await screen.findByRole("button", { name: "保存询问单" });
  return view;
}

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  resetInquirySyncForTests();
  resetCatalogueSyncForTests();
  await clearAllLocalData();
  resetCatalogueDbForTests();
});

beforeEach(() => {
  mocks.createInquiryRequest.mockReset();
  mocks.replace.mockReset();
});

describe("product-detail add workflow", () => {
  it("adds a product once, then shows 已加入本次询问 with scan and view actions", () => {
    const { inquiry } = renderSession(
      <ProductDetailView product={PLATE} onBack={() => undefined} />,
    );

    expect(screen.getByRole("button", { name: "加入本次询问" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "加入本次询问" }));

    expect(inquiry().lines).toHaveLength(1);
    expect(inquiry().lines[0].product.id).toBe(PLATE.id);
    expect(inquiry().summary.productCount).toBe(1);
    expect(screen.getByText("已加入本次询问")).toBeVisible();
    expect(screen.queryByRole("button", { name: "加入本次询问" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add one more" })).toBeNull();
    expect(screen.getByRole("button", { name: "继续扫码" })).toBeVisible();
    expect(screen.getByRole("link", { name: "查看询问单" })).toHaveAttribute("href", "/inquiry");
  });

  it("shows 该产品已在本次询问中 and does not change state for a selected product", async () => {
    const { inquiry } = renderSession(
      <Seed product={PLATE}>
        <ProductDetailView product={PLATE} onBack={() => undefined} />
      </Seed>,
    );

    expect(await screen.findByText("该产品已在本次询问中")).toBeVisible();
    const snapshot = inquiry().lines;

    fireEvent.click(screen.getByRole("button", { name: "继续扫码" }));
    expect(inquiry().lines).toBe(snapshot);
    expect(inquiry().lines).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "加入本次询问" })).toBeNull();
    expect(screen.getByRole("link", { name: "查看询问单" })).toBeVisible();
  });

  it("adds a second distinct product without duplicating the first", () => {
    const { inquiry } = renderSession(
      <>
        <ProductDetailView product={PLATE} onBack={() => undefined} />
        <AddSecondProduct />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "加入本次询问" }));
    fireEvent.click(screen.getByRole("button", { name: "Add cup" }));

    expect(inquiry().lines.map((line) => line.product.id)).toEqual([PLATE.id, CUP.id]);
    expect(inquiry().summary.productCount).toBe(2);
  });
});

function AddSecondProduct() {
  const { addProduct } = useInquiry();
  return (
    <button type="button" onClick={() => addProduct(CUP)}>
      Add cup
    </button>
  );
}

describe("scan another product returns to search without mutating the inquiry", () => {
  it("does not change selected products", async () => {
    await replaceCatalogue([PLATE, CUP], { lastSyncedAt: Date.now(), count: 2 });

    const { inquiry } = renderSession(
      <CatalogueProvider>
        <SearchPanel />
      </CatalogueProvider>,
    );

    fireEvent.change(await screen.findByLabelText(/搜索产品/), {
      target: { value: "K10188-13" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /K10188-13/ }));
    fireEvent.click(await screen.findByRole("button", { name: "加入本次询问" }));
    expect(inquiry().lines).toHaveLength(1);
    const snapshot = inquiry().lines;

    fireEvent.click(screen.getByRole("button", { name: "继续扫码" }));

    expect(await screen.findByLabelText(/搜索产品/)).toBeVisible();
    expect(inquiry().lines).toBe(snapshot);
    expect(inquiry().lines[0].product.id).toBe(PLATE.id);
  });
});

describe("inquiry editor before submission", () => {
  it("renders no quantity controls, line totals or grand total", async () => {
    await renderEditor();

    expect(screen.getByText("K10188-13")).toBeVisible();
    expect(screen.getByText("20.6 × 13.3 × 2.0 cm")).toBeVisible();
    expect(screen.getByText("产品单价")).toBeVisible();
    expect(screen.getByLabelText("报价单价")).toBeVisible();
    expect(screen.getByRole("button", { name: "移除" })).toBeVisible();
    expect(screen.getByText("已选择 1 款产品")).toBeVisible();
    expect(screen.getByText(/币种 USD/)).toBeVisible();
    expect(screen.getByText("每款产品均已填写报价单价。")).toBeVisible();
    expect(screen.getByRole("link", { name: "继续扫码" })).toHaveAttribute("href", "/");

    expect(screen.queryByText(/^Quantity$/)).toBeNull();
    expect(screen.queryByLabelText(/quantity/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /decrease quantity/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /increase quantity/i })).toBeNull();
    expect(screen.queryByText(/line total/i)).toBeNull();
    expect(screen.queryByText(/quoted total/i)).toBeNull();
    expect(screen.queryByText(/grand total/i)).toBeNull();
    expect(screen.queryByText(/total quantity/i)).toBeNull();
    expect(screen.queryByText(/inquiry total/i)).toBeNull();
  });

  it("blocks saving until every product has a valid quoted price", async () => {
    await renderEditor(UNPRICED);

    fireEvent.change(screen.getByLabelText(/客户姓名/), { target: { value: "Ada" } });
    expect(screen.getByRole("button", { name: "保存询问单" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("报价单价"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "保存询问单" })).toBeEnabled();
  });

  it("rejects a negative quoted price in the editor", async () => {
    const { inquiry } = await renderEditor();

    fireEvent.change(screen.getByLabelText(/客户姓名/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("报价单价"), { target: { value: "-1" } });

    expect(screen.getByLabelText("报价单价")).not.toHaveValue("-1");
    const quoted = inquiry().lines[0]?.quotedUnitPrice;
    expect(quoted === undefined || quoted === null || quoted >= 0).toBe(true);
  });
});

describe("submission", () => {
  it("locks the inquiry after a successful save and shows only 开始下一次询问", async () => {
    mocks.createInquiryRequest.mockResolvedValue("inquiry-99");
    await renderEditor();

    fireEvent.change(screen.getByLabelText(/客户姓名/), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText("公司名称"), { target: { value: "Koei" } });
    fireEvent.click(screen.getByRole("button", { name: "保存询问单" }));

    expect(await screen.findByText("inquiry-99")).toBeVisible();
    expect(screen.getByText("询问单已保存")).toBeVisible();
    expect(screen.getByText("该询问单已成功保存。")).toBeVisible();
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("Koei")).toBeVisible();
    expect(screen.getByText("已记录 1 款产品")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看询问单" })).toHaveAttribute(
      "href",
      "/inquiries/inquiry-99",
    );
    expect(screen.getByRole("button", { name: "开始下一次询问" })).toBeVisible();

    expect(screen.queryByRole("button", { name: "保存询问单" })).toBeNull();
    expect(screen.queryByLabelText("报价单价")).toBeNull();
    expect(screen.queryByLabelText(/客户姓名/)).toBeNull();
    expect(screen.queryByRole("link", { name: /return to search/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /continue editing/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add another product/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete inquiry/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /scan another product/i })).toBeNull();

    expect(mocks.createInquiryRequest).toHaveBeenCalledTimes(1);
    const payload = mocks.createInquiryRequest.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.items).toEqual([{ productId: PLATE.id, quotedPrice: 2.4, notes: "" }]);
    expect(typeof payload.clientSubmissionId).toBe("string");
    expect(JSON.stringify(payload)).not.toMatch(/quantity/i);
  });

  it("sends only one request when Save is clicked repeatedly", async () => {
    let resolveSave: ((id: string) => void) | undefined;
    mocks.createInquiryRequest.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveSave = resolve;
        }),
    );

    await renderEditor();
    fireEvent.change(screen.getByLabelText(/客户姓名/), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "保存询问单" }));
    const again = screen.queryByRole("button", { name: /正在保存|保存询问单/ });
    if (again) fireEvent.click(again);

    await waitFor(() => {
      expect(mocks.createInquiryRequest).toHaveBeenCalledTimes(1);
    });
    resolveSave?.("inquiry-1");
    expect(await screen.findByText("询问单已保存")).toBeVisible();
    expect(mocks.createInquiryRequest).toHaveBeenCalledTimes(1);
  });

  it("queues locally when synchronization fails and does not discard the inquiry", async () => {
    mocks.createInquiryRequest.mockRejectedValue(
      new ApiError("The inquiry could not be saved.", 500, ["database down"]),
    );

    await renderEditor();
    fireEvent.change(screen.getByLabelText(/客户姓名/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("询问备注"), { target: { value: "Booth A" } });
    fireEvent.click(screen.getByRole("button", { name: "保存询问单" }));

    expect(
      await screen.findByText("该询问单已暂存至本设备，联网后将自动同步。"),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "查看询问单" })).toBeNull();
    expect(screen.queryByLabelText(/客户姓名/)).toBeNull();
    expect(screen.getByRole("button", { name: "开始下一次询问" })).toBeVisible();

    await waitFor(async () => {
      const queued = await listOutbox();
      expect(queued).toHaveLength(1);
      expect(queued[0].status).toBe("awaiting_sync");
      expect(queued[0].payload.customerName).toBe("Ada");
      expect(queued[0].payload.notes).toBe("Booth A");
      expect(queued[0].payload.items).toHaveLength(1);
    });
  });
});

describe("confirmation survives screen remount and start next inquiry clears it", () => {
  it("keeps the locked confirmation when InquiryScreen remounts", async () => {
    mocks.createInquiryRequest.mockResolvedValue("inquiry-locked");

    function App() {
      const [mounted, setMounted] = useState(true);
      return (
        <InquiryProvider>
          {mounted ? (
            <Seed product={PLATE}>
              <InquiryScreen />
            </Seed>
          ) : (
            <InquiryScreen />
          )}
          <button type="button" onClick={() => setMounted(false)}>
            Remount
          </button>
        </InquiryProvider>
      );
    }

    render(<App />);
    await screen.findByRole("button", { name: "保存询问单" });
    fireEvent.change(screen.getByLabelText(/客户姓名/), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "保存询问单" }));
    expect(await screen.findByText("inquiry-locked")).toBeVisible();
    expect(screen.getByText("询问单已保存")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Remount" }));
    expect(screen.getByText("询问单已保存")).toBeVisible();
    expect(screen.getByText("inquiry-locked")).toBeVisible();
    expect(screen.queryByLabelText("报价单价")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存询问单" })).toBeNull();
  });

  it("clears the previous session and does not restore it as an editable draft", async () => {
    mocks.createInquiryRequest.mockResolvedValue("inquiry-next");

    function App() {
      const [screenId, setScreenId] = useState<"edit" | "after">("edit");
      return (
        <InquiryProvider>
          <Probe
            onReady={() => {
              /* store stays mounted */
            }}
          />
          <SessionSwitch screenId={screenId} />
          <button type="button" onClick={() => setScreenId("after")}>
            Simulate back
          </button>
        </InquiryProvider>
      );
    }

    function SessionSwitch({ screenId }: { screenId: "edit" | "after" }) {
      const { confirmation, lines, customer } = useInquiry();
      if (screenId === "after") {
        return (
          <div>
            <p>after-start</p>
            <p>confirmation:{confirmation ? "yes" : "no"}</p>
            <p>products:{lines.length}</p>
            <p>customer:{customer.name}</p>
          </div>
        );
      }
      return (
        <Seed product={PLATE}>
          <InquiryScreen />
        </Seed>
      );
    }

    render(<App />);
    await screen.findByRole("button", { name: "保存询问单" });
    fireEvent.change(screen.getByLabelText(/客户姓名/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("公司名称"), { target: { value: "Koei" } });
    fireEvent.click(screen.getByRole("button", { name: "保存询问单" }));
    expect(await screen.findByText("询问单已保存")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "开始下一次询问" }));
    expect(mocks.replace).toHaveBeenCalledWith("/");

    fireEvent.click(screen.getByRole("button", { name: "Simulate back" }));
    expect(screen.getByText("after-start")).toBeVisible();
    expect(screen.getByText("confirmation:no")).toBeVisible();
    expect(screen.getByText("products:0")).toBeVisible();
    expect(screen.getByText("customer:")).toBeVisible();
  });

  it("lets a new product belong only to the next inquiry, reusing customer names manually", async () => {
    mocks.createInquiryRequest.mockResolvedValue("inquiry-next");
    const { inquiry } = await renderEditor();

    fireEvent.change(screen.getByLabelText(/客户姓名/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("公司名称"), { target: { value: "Koei" } });
    fireEvent.click(screen.getByRole("button", { name: "保存询问单" }));
    expect(await screen.findByText("询问单已保存")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "开始下一次询问" }));

    await waitFor(() => {
      expect(inquiry().confirmation).toBeNull();
      expect(inquiry().lines).toEqual([]);
    });

    act(() => {
      inquiry().updateCustomer({ name: "Ada", company: "Koei" });
      inquiry().addProduct(CUP);
    });

    expect(inquiry().lines).toHaveLength(1);
    expect(inquiry().lines[0].product.id).toBe(CUP.id);
    expect(inquiry().customer).toEqual({ name: "Ada", company: "Koei", notes: "" });
    expect(inquiry().confirmation).toBeNull();
  });
});
