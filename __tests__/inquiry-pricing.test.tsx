import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InquiryProvider, useInquiry } from "@/components/inquiry-store";
import { clearAllLocalData, resetCatalogueDbForTests } from "@/lib/offline/db";
import {
  allLinesPriced,
  canSubmitInquiry,
  isLinePriced,
  isValidQuotedPrice,
  parsePriceInput,
  selectedProductsLabel,
  summarizeInquiry,
} from "@/lib/inquiry";
import type { InquiryLine, Product } from "@/lib/types";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "K9000-01",
    nameZh: "杯碟-红",
    nameEn: "Cup and Saucer",
    dimensions: "11 × 8.5 × 6 cm",
    barcode: null,
    unitPrice: 2.4,
    packaging: null,
    currency: "USD",
    imageUrl: null,
    ...overrides,
  };
}

/** K9426S-19 is the real product with no listed price. */
const UNPRICED = product({
  id: "22222222-2222-4222-8222-222222222222",
  code: "K9426S-19",
  unitPrice: null,
});

function line(overrides: Partial<InquiryLine> = {}): InquiryLine {
  return { product: product(), quotedUnitPrice: 2.4, notes: "", ...overrides };
}

function setup() {
  return renderHook(() => useInquiry(), { wrapper: InquiryProvider });
}

afterEach(async () => {
  await clearAllLocalData();
  resetCatalogueDbForTests();
});

describe("seeding the quoted price", () => {
  it("copies the listed unit price when a product is first added", () => {
    const { result } = setup();

    act(() => {
      result.current.addProduct(product({ unitPrice: 2.4 }));
    });

    expect(result.current.lines[0].quotedUnitPrice).toBe(2.4);
  });

  it("preserves every decimal the database holds", () => {
    const { result } = setup();
    const precise = 1.23456789;

    act(() => {
      result.current.addProduct(product({ unitPrice: precise }));
    });

    expect(result.current.lines[0].quotedUnitPrice).toBe(precise);
    expect(String(result.current.lines[0].quotedUnitPrice)).toBe("1.23456789");
  });

  it("leaves the price blank when the product has no listed price", () => {
    const { result } = setup();

    act(() => {
      result.current.addProduct(UNPRICED);
    });

    expect(result.current.lines[0].quotedUnitPrice).toBeNull();
    expect(isLinePriced(result.current.lines[0])).toBe(false);
  });

  it("seeds a listed price of zero rather than treating it as missing", () => {
    const { result } = setup();

    act(() => {
      result.current.addProduct(product({ unitPrice: 0 }));
    });

    expect(result.current.lines[0].quotedUnitPrice).toBe(0);
    expect(isLinePriced(result.current.lines[0])).toBe(true);
  });
});

describe("an edited quoted price is never overwritten", () => {
  it("survives navigating away and adding the same product again", () => {
    const { result } = setup();
    const item = product();

    act(() => {
      result.current.addProduct(item);
    });
    act(() => {
      result.current.setQuotedUnitPrice(item.id, 9.99);
    });
    act(() => {
      result.current.addProduct(item);
    });

    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0].quotedUnitPrice).toBe(9.99);
  });

  it("does not re-seed a price the employee deliberately cleared", () => {
    const { result } = setup();
    const item = product();

    act(() => {
      result.current.addProduct(item);
    });
    act(() => {
      result.current.setQuotedUnitPrice(item.id, null);
    });
    act(() => {
      result.current.addProduct(item);
    });

    expect(result.current.lines[0].quotedUnitPrice).toBeNull();
    expect(result.current.lines).toHaveLength(1);
  });

  it("keeps a manually entered zero", () => {
    const { result } = setup();
    const item = product();

    act(() => {
      result.current.addProduct(item);
    });
    act(() => {
      result.current.setQuotedUnitPrice(item.id, 0);
    });
    act(() => {
      result.current.addProduct(item);
    });

    expect(result.current.lines[0].quotedUnitPrice).toBe(0);
    expect(allLinesPriced(result.current.lines)).toBe(true);
  });
});

describe("one line per product", () => {
  it("creates exactly one inquiry line on the first add", () => {
    const { result } = setup();
    const item = product();

    act(() => {
      result.current.addProduct(item);
    });

    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0].product.id).toBe(item.id);
  });

  it("does not modify state when the same product is added again", () => {
    const { result } = setup();
    const item = product();

    act(() => {
      result.current.addProduct(item);
    });
    const snapshot = result.current.lines;

    act(() => {
      result.current.addProduct({ ...item, nameEn: "Renamed in catalogue" });
    });

    expect(result.current.lines).toBe(snapshot);
    expect(result.current.lines[0].product.nameEn).toBe("Cup and Saucer");
  });

  it("identifies products by id, not by name or code display text", () => {
    const { result } = setup();
    const first = product({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "SAME", nameEn: "Same" });
    const second = product({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "SAME", nameEn: "Same" });

    act(() => {
      result.current.addProduct(first);
      result.current.addProduct(second);
    });

    expect(result.current.lines).toHaveLength(2);
    expect(result.current.summary.productCount).toBe(2);
  });

  it("adds different products normally", () => {
    const { result } = setup();

    act(() => {
      result.current.addProduct(product());
      result.current.addProduct(UNPRICED);
    });

    expect(result.current.lines.map((line) => line.product.id)).toEqual([
      product().id,
      UNPRICED.id,
    ]);
    expect(result.current.summary.productCount).toBe(2);
  });
});

describe("customer details no longer hold a staff name", () => {
  it("starts with only name, company and notes", () => {
    const { result } = setup();

    expect(result.current.customer).toEqual({ name: "", company: "", notes: "" });
    expect("staffName" in result.current.customer).toBe(false);
  });

  it("still updates the remaining fields", () => {
    const { result } = setup();

    act(() => {
      result.current.updateCustomer({ name: "Ada", company: "Koei" });
    });

    expect(result.current.customer.name).toBe("Ada");
    expect(result.current.customer.company).toBe("Koei");
  });
});

describe("isValidQuotedPrice", () => {
  it("accepts zero and positive finite numbers", () => {
    expect(isValidQuotedPrice(0)).toBe(true);
    expect(isValidQuotedPrice(2.4)).toBe(true);
  });

  it("rejects null, undefined, negatives and non-finite numbers", () => {
    expect(isValidQuotedPrice(null)).toBe(false);
    expect(isValidQuotedPrice(undefined)).toBe(false);
    expect(isValidQuotedPrice(-0.01)).toBe(false);
    expect(isValidQuotedPrice(Number.NaN)).toBe(false);
    expect(isValidQuotedPrice(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("allLinesPriced", () => {
  it("is true for an empty list and for fully priced lines", () => {
    expect(allLinesPriced([])).toBe(true);
    expect(allLinesPriced([line(), line({ quotedUnitPrice: 0 })])).toBe(true);
  });

  it("is false when any line lacks a price", () => {
    expect(allLinesPriced([line(), line({ quotedUnitPrice: null })])).toBe(false);
  });
});

describe("inquiry summary", () => {
  it("counts distinct products and unpriced lines, with no monetary total", () => {
    const summary = summarizeInquiry([
      line({ quotedUnitPrice: 2.5 }),
      line({ product: UNPRICED, quotedUnitPrice: null }),
    ]);

    expect(summary.productCount).toBe(2);
    expect(summary.unpricedCount).toBe(1);
    expect(summary.allPriced).toBe(false);
    expect(summary).not.toHaveProperty("quotedTotal");
    expect(summary).not.toHaveProperty("totalQuantity");
    expect(selectedProductsLabel(3)).toBe("3 products selected");
    expect(selectedProductsLabel(1)).toBe("1 product selected");
  });

  it("counts a zero-priced line as priced", () => {
    const summary = summarizeInquiry([line({ quotedUnitPrice: 0 })]);
    expect(summary.unpricedCount).toBe(0);
    expect(summary.allPriced).toBe(true);
  });
});

describe("canSubmitInquiry", () => {
  it("requires a customer name, at least one product, and a quoted price on every line", () => {
    expect(canSubmitInquiry([line()], { name: "Ada", company: "", notes: "" })).toBe(true);
    expect(canSubmitInquiry([], { name: "Ada", company: "", notes: "" })).toBe(false);
    expect(canSubmitInquiry([line()], { name: "  ", company: "", notes: "" })).toBe(false);
    expect(
      canSubmitInquiry([line({ quotedUnitPrice: null })], {
        name: "Ada",
        company: "",
        notes: "",
      }),
    ).toBe(false);
  });
});

describe("parsePriceInput", () => {
  it("reads a typed zero as zero, not as missing", () => {
    expect(parsePriceInput("0")).toBe(0);
    expect(parsePriceInput("0.00")).toBe(0);
  });

  it("treats a blank field as no price", () => {
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("   ")).toBeNull();
  });

  it("refuses negative and malformed input", () => {
    expect(parsePriceInput("-5")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
    expect(parsePriceInput(".")).toBeNull();
  });
});

describe("a saved inquiry is locked until the next session starts", () => {
  it("rejects edits after the inquiry is saved", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const { result } = setup();
    const item = product();

    act(() => {
      result.current.addProduct(item);
      result.current.updateCustomer({ name: "Ada", company: "Koei", notes: "Booth A" });
    });
    await act(async () => {
      await result.current.saveInquiry();
    });

    expect(result.current.confirmation).toMatchObject({
      source: "queued",
      customerName: "Ada",
      companyName: "Koei",
      productCount: 1,
    });

    act(() => {
      result.current.setQuotedUnitPrice(item.id, 1);
      result.current.updateCustomer({ name: "Changed" });
      result.current.removeLine(item.id);
      result.current.addProduct(UNPRICED);
    });

    expect(result.current.addProduct(UNPRICED)).toEqual({
      ok: false,
      reason: expect.stringMatching(/already been saved/i),
    });
    expect(result.current.confirmation?.customerName).toBe("Ada");
    expect(result.current.lines).toEqual([]);
  });

  it("clears the complete previous session on start next inquiry", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const { result } = setup();

    act(() => {
      result.current.addProduct(product());
      result.current.updateCustomer({ name: "Ada", company: "Koei", notes: "Booth A" });
    });
    await act(async () => {
      await result.current.saveInquiry();
    });
    act(() => {
      result.current.clearInquiry();
    });

    expect(result.current.confirmation).toBeNull();
    expect(result.current.lines).toEqual([]);
    expect(result.current.customer).toEqual({ name: "", company: "", notes: "" });
  });

  it("lets the next inquiry reuse the same customer and company names", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const { result } = setup();

    act(() => {
      result.current.addProduct(product());
      result.current.updateCustomer({ name: "Ada", company: "Koei" });
    });
    await act(async () => {
      await result.current.saveInquiry();
    });
    act(() => {
      result.current.clearInquiry();
    });
    act(() => {
      result.current.updateCustomer({ name: "Ada", company: "Koei" });
      result.current.addProduct(UNPRICED);
    });

    expect(result.current.confirmation).toBeNull();
    expect(result.current.customer).toEqual({ name: "Ada", company: "Koei", notes: "" });
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0].product.id).toBe(UNPRICED.id);
  });
});
