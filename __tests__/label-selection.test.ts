import { describe, expect, it } from "vitest";
import {
  clampCopies,
  clampLayout,
  DEFAULT_LABEL_LAYOUT,
  expandLabelCopies,
  MAX_COPIES,
} from "@/lib/label-layout";
import {
  isSelected,
  selectAllResults,
  setCopies,
  toggleSelection,
} from "@/lib/label-selection";

const a = { id: "a", code: "K10188-13" };
const b = { id: "b", code: "K9426S-19" };
const c = { id: "c", code: "DY-59" };

describe("copy counts", () => {
  it("repeats each product according to its copy count, in order", () => {
    const expanded = expandLabelCopies([
      { product: a, copies: 2 },
      { product: b, copies: 1 },
      { product: c, copies: 3 },
    ]);

    expect(expanded.map((product) => product.code)).toEqual([
      "K10188-13",
      "K10188-13",
      "K9426S-19",
      "DY-59",
      "DY-59",
      "DY-59",
    ]);
  });

  it("clamps copies to a whole number between 1 and 99", () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(1.8)).toBe(1);
    expect(clampCopies(150)).toBe(MAX_COPIES);
    expect(clampCopies(Number.NaN)).toBe(1);
  });

  it("updates copies for one product without touching the others", () => {
    const next = setCopies(
      [
        { product: a, copies: 1 },
        { product: b, copies: 1 },
      ],
      a.id,
      5,
    );

    expect(next).toEqual([
      { product: a, copies: 5 },
      { product: b, copies: 1 },
    ]);
  });
});

describe("product selection", () => {
  it("toggles a product on and off", () => {
    const added = toggleSelection([], a);
    expect(isSelected(added, a.id)).toBe(true);
    expect(added[0].copies).toBe(1);

    const removed = toggleSelection(added, a);
    expect(isSelected(removed, a.id)).toBe(false);
  });

  it("selects all search results without resetting existing copy counts", () => {
    const already = [{ product: a, copies: 4 }];
    const next = selectAllResults(already, [a, b, c]);

    expect(next.map((item) => item.product.id)).toEqual(["a", "b", "c"]);
    expect(next[0].copies).toBe(4);
    expect(next[1].copies).toBe(1);
  });

  it("is a no-op when every result is already selected", () => {
    const selected = [
      { product: a, copies: 1 },
      { product: b, copies: 2 },
    ];
    expect(selectAllResults(selected, [a, b])).toEqual(selected);
  });
});

describe("label layout", () => {
  it("ships calibratable defaults rather than a printer-specific size", () => {
    expect(DEFAULT_LABEL_LAYOUT).toEqual({
      widthMm: 70,
      heightMm: 40,
      marginMm: 3,
      barcodeHeightMm: 14,
      moduleMm: 0.25,
    });
  });

  it("clamps layout fields into the allowed range", () => {
    const clamped = clampLayout({
      widthMm: 5,
      heightMm: 400,
      marginMm: -1,
      barcodeHeightMm: 200,
      moduleMm: 9,
    });

    expect(clamped.widthMm).toBe(30);
    expect(clamped.heightMm).toBe(90);
    expect(clamped.marginMm).toBe(0);
    expect(clamped.moduleMm).toBe(0.6);
    expect(clamped.barcodeHeightMm).toBeLessThanOrEqual(clamped.heightMm);
  });
});
