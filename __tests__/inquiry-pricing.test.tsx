import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InquiryProvider, useInquiry } from "@/components/inquiry-store";
import {
  allLinesPriced,
  calculateTotals,
  isLinePriced,
  isValidQuotedPrice,
  lineTotal,
  parsePriceInput,
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
  return { product: product(), quantity: 1, quotedUnitPrice: 2.4, ...overrides };
}

function setup() {
  return renderHook(() => useInquiry(), { wrapper: InquiryProvider });
}

afterEach(() => {
  // renderHook unmounts itself; nothing else is shared between tests.
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
  it("survives a quantity increase", () => {
    const { result } = setup();
    const item = product();

    act(() => {
      result.current.addProduct(item);
    });
    act(() => {
      result.current.setQuotedUnitPrice(item.id, 9.99);
    });
    act(() => {
      result.current.setQuantity(item.id, 5);
    });

    expect(result.current.lines[0].quantity).toBe(5);
    expect(result.current.lines[0].quotedUnitPrice).toBe(9.99);
  });

  it("survives re-adding the same product, which only bumps the quantity", () => {
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
    expect(result.current.lines[0].quantity).toBe(2);
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
    expect(result.current.lines[0].quantity).toBe(2);
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
      result.current.setQuantity(item.id, 3);
    });

    expect(result.current.lines[0].quotedUnitPrice).toBe(0);
    expect(allLinesPriced(result.current.lines)).toBe(true);
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

describe("totals", () => {
  it("includes every line once all lines are priced", () => {
    const totals = calculateTotals([
      line({ quantity: 2, quotedUnitPrice: 2.5 }),
      line({ quantity: 3, quotedUnitPrice: 1 }),
    ]);

    expect(totals.lineCount).toBe(2);
    expect(totals.totalQuantity).toBe(5);
    expect(totals.quotedTotal).toBe(8);
    expect(totals.unpricedLineCount).toBe(0);
  });

  it("counts a zero-priced line as priced and contributing nothing", () => {
    const totals = calculateTotals([line({ quantity: 4, quotedUnitPrice: 0 })]);

    expect(totals.quotedTotal).toBe(0);
    expect(totals.unpricedLineCount).toBe(0);
  });

  it("reports unpriced lines so submission can be blocked", () => {
    const totals = calculateTotals([line(), line({ quotedUnitPrice: null })]);
    expect(totals.unpricedLineCount).toBe(1);
  });

  it("returns no line total for an unpriced line", () => {
    expect(lineTotal(line({ quotedUnitPrice: null }))).toBeNull();
    expect(lineTotal(line({ quantity: 2, quotedUnitPrice: 0 }))).toBe(0);
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
