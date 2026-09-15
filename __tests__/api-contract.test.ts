import { describe, expect, it } from "vitest";
import { validateCreateInquiry } from "@/lib/api-contract";

const PRODUCT_ID = "e4247a2f-1e3b-4d64-a05f-ab38906b5292";

function body(overrides: Record<string, unknown> = {}) {
  return {
    customerName: "Ada Lovelace",
    companyName: "Koei",
    notes: "",
    currency: "USD",
    items: [{ productId: PRODUCT_ID, quantity: 2, quotedPrice: 2.4 }],
    ...overrides,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return [{ productId: PRODUCT_ID, quantity: 1, quotedPrice: 2.4, ...overrides }];
}

describe("quoted price is required", () => {
  it("accepts a valid priced item", () => {
    const result = validateCreateInquiry(body());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0].quotedPrice).toBe(2.4);
  });

  it("accepts a deliberate zero", () => {
    const result = validateCreateInquiry(body({ items: item({ quotedPrice: 0 }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0].quotedPrice).toBe(0);
  });

  it("rejects a null price", () => {
    const result = validateCreateInquiry(body({ items: item({ quotedPrice: null }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/needs a quoted price/);
  });

  it("rejects a missing price field", () => {
    const result = validateCreateInquiry(
      body({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/needs a quoted price/);
  });

  it("rejects a blank price", () => {
    const result = validateCreateInquiry(body({ items: item({ quotedPrice: "" }) }));
    expect(result.ok).toBe(false);
  });

  it("rejects a negative price", () => {
    const result = validateCreateInquiry(body({ items: item({ quotedPrice: -1 }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/negative/);
  });

  it("rejects malformed prices", () => {
    for (const quotedPrice of ["2.40", Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      expect(validateCreateInquiry(body({ items: item({ quotedPrice }) })).ok).toBe(false);
    }
  });

  it("names the offending item", () => {
    const result = validateCreateInquiry(
      body({
        items: [
          { productId: PRODUCT_ID, quantity: 1, quotedPrice: 2.4 },
          {
            productId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            quantity: 1,
            quotedPrice: null,
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/Item 2/);
  });
});

describe("staffName is gone from the contract", () => {
  it("saves successfully without a staffName field", () => {
    const withoutStaff = body();
    expect("staffName" in withoutStaff).toBe(false);
    expect(validateCreateInquiry(withoutStaff).ok).toBe(true);
  });

  it("is not required, so its absence produces no error", () => {
    const result = validateCreateInquiry(body());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).not.toContain("staffName");
  });

  it("ignores a staffName a stale client still sends", () => {
    const result = validateCreateInquiry(body({ staffName: "Someone" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty("staffName");
  });

  it("does not reject an over-long staffName, because it is no longer read", () => {
    const result = validateCreateInquiry(body({ staffName: "x".repeat(2000) }));
    expect(result.ok).toBe(true);
  });
});

describe("unchanged validation still holds", () => {
  it("requires a customer name", () => {
    expect(validateCreateInquiry(body({ customerName: "  " })).ok).toBe(false);
  });

  it("requires at least one item", () => {
    expect(validateCreateInquiry(body({ items: [] })).ok).toBe(false);
  });

  it("requires positive whole-number quantities", () => {
    expect(validateCreateInquiry(body({ items: item({ quantity: 0 }) })).ok).toBe(false);
    expect(validateCreateInquiry(body({ items: item({ quantity: 1.5 }) })).ok).toBe(false);
    expect(validateCreateInquiry(body({ items: item({ quantity: -2 }) })).ok).toBe(false);
  });

  it("rejects an unsupported currency", () => {
    expect(validateCreateInquiry(body({ currency: "EUR" })).ok).toBe(false);
  });

  it("rejects a duplicated product", () => {
    const result = validateCreateInquiry(
      body({
        items: [
          { productId: PRODUCT_ID, quantity: 1, quotedPrice: 1 },
          { productId: PRODUCT_ID, quantity: 2, quotedPrice: 2 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });
});
