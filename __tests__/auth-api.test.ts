import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTHENTICATION_REQUIRED, handleRouteError } from "@/lib/api-response";
import { AuthenticationError, AuthorizationError } from "@/lib/auth/errors";
import { LABEL_PDF_FONT_PUBLIC_PATH } from "@/lib/label-pdf-template";
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

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  searchProducts: vi.fn(),
  getProductByCode: vi.fn(),
  listActiveProducts: vi.fn(),
  listAllActiveProducts: vi.fn(),
  createInquiry: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAuthServerClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/supabase/products", () => ({
  searchProducts: mocks.searchProducts,
  getProductByCode: mocks.getProductByCode,
  listActiveProducts: mocks.listActiveProducts,
  listAllActiveProducts: mocks.listAllActiveProducts,
}));

vi.mock("@/lib/supabase/inquiries", () => ({
  createInquiry: mocks.createInquiry,
}));

const { GET: searchProductsRoute } = await import("@/app/api/products/route");
const { GET: productByCodeRoute } = await import("@/app/api/products/[code]/route");
const { GET: labelProductsRoute } = await import("@/app/api/products/labels/route");
const { GET: catalogueRoute } = await import("@/app/api/products/catalogue/route");
const { POST: createInquiryRoute } = await import("@/app/api/inquiries/route");

const INQUIRY_BODY = {
  customerName: "Ada Lovelace",
  companyName: "Koei",
  notes: "",
  currency: "USD",
  items: [{ productId: PRODUCT.id, quotedPrice: 2.4, notes: "" }],
  clientSubmissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

function jsonRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "missing" } });
});

describe("unauthenticated APIs return 401 JSON", () => {
  it("does not run product search without a verified user", async () => {
    const response = await searchProductsRoute(
      jsonRequest("http://localhost/api/products?q=K10188"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toMatch(/json/);
    await expect(response.json()).resolves.toEqual({ error: AUTHENTICATION_REQUIRED });
    expect(mocks.searchProducts).not.toHaveBeenCalled();
    expect(mocks.getUser).toHaveBeenCalled();
  });

  it("does not look up a product by code without a verified user", async () => {
    const response = await productByCodeRoute(
      jsonRequest("http://localhost/api/products/K10188-13"),
      { params: Promise.resolve({ code: "K10188-13" }) },
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: AUTHENTICATION_REQUIRED });
    expect(mocks.getProductByCode).not.toHaveBeenCalled();
  });

  it("does not load the labels catalogue without a verified user", async () => {
    const response = await labelProductsRoute(
      jsonRequest("http://localhost/api/products/labels"),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: AUTHENTICATION_REQUIRED });
    expect(mocks.listActiveProducts).not.toHaveBeenCalled();
  });

  it("does not download the sync catalogue without a verified user", async () => {
    const response = await catalogueRoute(jsonRequest("http://localhost/api/products/catalogue"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: AUTHENTICATION_REQUIRED });
    expect(mocks.listAllActiveProducts).not.toHaveBeenCalled();
  });

  it("does not save an inquiry, even with a valid body, without a verified user", async () => {
    const response = await createInquiryRoute(
      jsonRequest("http://localhost/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(INQUIRY_BODY),
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: AUTHENTICATION_REQUIRED });
    expect(mocks.createInquiry).not.toHaveBeenCalled();
  });

  it("does not redirect API callers to an HTML login page", async () => {
    const response = await searchProductsRoute(
      jsonRequest("http://localhost/api/products?q=K"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toMatch(/json/);
  });
});

describe("authenticated application APIs", () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "andy@koeico.com" } },
      error: null,
    });
  });

  it("returns product search results after Auth verification", async () => {
    mocks.searchProducts.mockResolvedValue([PRODUCT]);
    const response = await searchProductsRoute(
      jsonRequest("http://localhost/api/products?q=K10188"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ products: [PRODUCT] });
    expect(mocks.getUser).toHaveBeenCalled();
    expect(mocks.searchProducts).toHaveBeenCalledWith("K10188");
  });

  it("returns one product by code after Auth verification", async () => {
    mocks.getProductByCode.mockResolvedValue(PRODUCT);
    const response = await productByCodeRoute(
      jsonRequest("http://localhost/api/products/K10188-13"),
      { params: Promise.resolve({ code: "K10188-13" }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ product: PRODUCT });
  });

  it("returns the labels catalogue after Auth verification", async () => {
    mocks.listActiveProducts.mockResolvedValue([PRODUCT]);
    const response = await labelProductsRoute(
      jsonRequest("http://localhost/api/products/labels"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ products: [PRODUCT] });
    expect(mocks.listActiveProducts).toHaveBeenCalledWith("");
  });

  it("returns the full catalogue after Auth verification", async () => {
    mocks.listAllActiveProducts.mockResolvedValue([PRODUCT]);
    const response = await catalogueRoute(
      jsonRequest("http://localhost/api/products/catalogue"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    await expect(response.json()).resolves.toEqual({ products: [PRODUCT], count: 1 });
    expect(mocks.listAllActiveProducts).toHaveBeenCalled();
  });

  it("does not expose update, append or delete inquiry endpoints", async () => {
    const inquiriesRoute = await import("@/app/api/inquiries/route");
    expect(inquiriesRoute.GET).toEqual(expect.any(Function));
    expect(inquiriesRoute.POST).toEqual(expect.any(Function));
    expect(inquiriesRoute).not.toHaveProperty("PUT");
    expect(inquiriesRoute).not.toHaveProperty("PATCH");
    expect(inquiriesRoute).not.toHaveProperty("DELETE");
  });

  it("saves an inquiry after Auth verification", async () => {
    mocks.createInquiry.mockResolvedValue("inquiry-1");
    const response = await createInquiryRoute(
      jsonRequest("http://localhost/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(INQUIRY_BODY),
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toMatch(/no-store/i);
    await expect(response.json()).resolves.toEqual({ inquiryId: "inquiry-1" });
    expect(mocks.createInquiry).toHaveBeenCalled();
  });

  it("does not pass a client-supplied quantity through to persistence", async () => {
    mocks.createInquiry.mockResolvedValue("inquiry-1");
    const response = await createInquiryRoute(
      jsonRequest("http://localhost/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...INQUIRY_BODY,
          items: [{ productId: PRODUCT.id, quantity: 99, quotedPrice: 2.4, notes: "" }],
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createInquiry).toHaveBeenCalledWith({
      customerName: "Ada Lovelace",
      companyName: "Koei",
      notes: "",
      currency: "USD",
      items: [{ productId: PRODUCT.id, quotedPrice: 2.4, notes: "" }],
      clientSubmissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("still returns validation errors for authenticated inquiry submissions", async () => {
    const response = await createInquiryRoute(
      jsonRequest("http://localhost/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...INQUIRY_BODY, customerName: "  " }),
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("The inquiry could not be saved.");
    expect(mocks.createInquiry).not.toHaveBeenCalled();
  });
});

describe("auth error mapping", () => {
  it("maps AuthenticationError to 401 JSON without leaking secrets", async () => {
    const response = handleRouteError(new AuthenticationError());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: AUTHENTICATION_REQUIRED });
    expect(JSON.stringify(body)).not.toMatch(/service_role|SECRET_KEY|password/i);
  });

  it("maps AuthorizationError to 403 only after authentication", async () => {
    const response = handleRouteError(new AuthorizationError());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "You are not allowed to access this resource.",
    });
  });
});

describe("protected labels API and PDF functionality", () => {
  it("keeps PDF export as a client-side library after catalogue auth", async () => {
    expect(LABEL_PDF_FONT_PUBLIC_PATH).toBe("/fonts/NotoSansSC-Regular.ttf");
    const pdfSource = await import("@/lib/label-pdf");
    expect(typeof pdfSource.generateProductionLabelPdf).toBe("function");
    expect(typeof pdfSource.generateCalibrationLabelPdf).toBe("function");
  });
});
