import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateInquiryRequest } from "@/lib/api-contract";
import type { Product } from "@/lib/types";

const INQUIRY_ID = "7f1f2b6e-1b3a-4c2d-8e5f-9a0b1c2d3e4f";
const PRODUCT_ID = "e4247a2f-1e3b-4d64-a05f-ab38906b5292";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getActiveProductsByIds: vi.fn(),
}));

// `lib/supabase/inquiries.ts` imports "server-only"; vitest.config.mts aliases
// that to the same empty module Next uses on the server.
vi.mock("@/lib/supabase/admin", () => ({
  getAdminSupabase: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/lib/supabase/products", () => ({
  getActiveProductsByIds: mocks.getActiveProductsByIds,
}));

const { createInquiry } = await import("@/lib/supabase/inquiries");

const PRODUCT: Product = {
  id: PRODUCT_ID,
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

function request(overrides: Partial<CreateInquiryRequest> = {}): CreateInquiryRequest {
  return {
    customerName: "Ada Lovelace",
    companyName: "Koei",
    notes: "",
    currency: "USD",
    items: [{ productId: PRODUCT_ID, quotedPrice: 2.4 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveProductsByIds.mockResolvedValue(new Map([[PRODUCT_ID, PRODUCT]]));
  mocks.rpc.mockResolvedValue({ data: INQUIRY_ID, error: null });
});

describe("createInquiry", () => {
  it("passes null for p_staff_name", async () => {
    await createInquiry(request());

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, params] = mocks.rpc.mock.calls[0];

    expect(name).toBe("create_trade_show_inquiry");
    expect(params).toHaveProperty("p_staff_name", null);
    expect(params.p_staff_name).toBeNull();
  });

  it("still sends the parameter, so the existing RPC signature is unchanged", async () => {
    await createInquiry(request());
    const [, params] = mocks.rpc.mock.calls[0];

    expect(Object.keys(params).sort()).toEqual([
      "p_company_name",
      "p_currency",
      "p_customer_name",
      "p_items",
      "p_notes",
      "p_staff_name",
    ]);
  });

  it("forwards the customer fields and priced items", async () => {
    await createInquiry(request({ notes: "Ships in May" }));
    const [, params] = mocks.rpc.mock.calls[0];

    expect(params.p_customer_name).toBe("Ada Lovelace");
    expect(params.p_company_name).toBe("Koei");
    expect(params.p_notes).toBe("Ships in May");
    expect(params.p_currency).toBe("USD");
    expect(params.p_items).toEqual([
      { productId: PRODUCT_ID, quantity: 1, quotedPrice: 2.4 },
    ]);
  });

  it("sends a quoted price of zero through unchanged", async () => {
    await createInquiry(
      request({ items: [{ productId: PRODUCT_ID, quotedPrice: 0 }] }),
    );
    const [, params] = mocks.rpc.mock.calls[0];

    expect(params.p_items[0].quotedPrice).toBe(0);
  });

  it("always supplies quantity = 1 to the existing RPC", async () => {
    await createInquiry(request());
    const [, params] = mocks.rpc.mock.calls[0];
    expect(params.p_items[0].quantity).toBe(1);
    expect(request().items[0]).not.toHaveProperty("quantity");
  });

  it("returns the new inquiry id", async () => {
    await expect(createInquiry(request())).resolves.toBe(INQUIRY_ID);
  });

  it("rejects a product that is missing or inactive", async () => {
    mocks.getActiveProductsByIds.mockResolvedValue(new Map());
    await expect(createInquiry(request())).rejects.toThrow(/unavailable/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
