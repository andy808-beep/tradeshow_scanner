import { describe, expect, it, vi } from "vitest";
import {
  buildDecodeHints,
  describeCameraError,
  hasCameraSupport,
  PRIMARY_FORMAT_NAME,
  resolveScanMatch,
  stopMediaStream,
  SUPPORTED_FORMAT_NAMES,
} from "@/lib/barcode";
import type { Product } from "@/lib/types";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "K10188-13",
    nameZh: "大方盘·紫",
    nameEn: "Abbesses Plate - L",
    dimensions: "20.6 × 13.3 × 2.0 cm",
    barcode: null,
    unitPrice: null,
    packaging: null,
    currency: "USD",
    imageUrl: null,
    ...overrides,
  };
}

describe("buildDecodeHints", () => {
  const DecodeHintType = { POSSIBLE_FORMATS: 2, TRY_HARDER: 3 };
  const BarcodeFormat = {
    CODE_39: 10,
    CODE_128: 11,
    EAN_13: 12,
    EAN_8: 13,
    UPC_A: 14,
    UPC_E: 15,
    QR_CODE: 16,
    PDF_417: 99,
  };

  it("lists Code 39 first, as Koei's own label format", () => {
    expect(PRIMARY_FORMAT_NAME).toBe("CODE_39");
    expect(SUPPORTED_FORMAT_NAMES[0]).toBe("CODE_39");

    const hints = buildDecodeHints(DecodeHintType, BarcodeFormat);
    const formats = hints.get(DecodeHintType.POSSIBLE_FORMATS) as number[];
    expect(formats[0]).toBe(BarcodeFormat.CODE_39);
  });

  it("keeps Code 128, EAN, UPC and QR enabled as fallbacks", () => {
    const hints = buildDecodeHints(DecodeHintType, BarcodeFormat);
    const formats = hints.get(DecodeHintType.POSSIBLE_FORMATS) as number[];

    expect(formats).toHaveLength(SUPPORTED_FORMAT_NAMES.length);
    for (const name of ["CODE_128", "EAN_13", "EAN_8", "UPC_A", "UPC_E", "QR_CODE"]) {
      expect(formats).toContain(BarcodeFormat[name as keyof typeof BarcodeFormat]);
    }
    expect(formats).not.toContain(BarcodeFormat.PDF_417);
  });

  it("enables TRY_HARDER", () => {
    const hints = buildDecodeHints(DecodeHintType, BarcodeFormat);
    expect(hints.get(DecodeHintType.TRY_HARDER)).toBe(true);
  });
});

describe("Code 39 label scanned from a Koei product", () => {
  // Confirmed from the legacy system: the label on K10188-13 is a Code 39
  // graphic generated from the product code, and decodes to exactly that.
  const CODE_39_DECODED = "K10188-13";

  it("resolves the K10188-13 product from its Code 39 value", () => {
    const k10188 = product({ code: "K10188-13", barcode: null });

    expect(resolveScanMatch(CODE_39_DECODED, [k10188])).toEqual({
      kind: "single",
      product: k10188,
    });
  });

  it("keeps the hyphen and does not treat the value as a number", () => {
    expect(CODE_39_DECODED).toContain("-");
    expect(Number.isNaN(Number(CODE_39_DECODED))).toBe(true);

    const k10188 = product({ code: "K10188-13" });
    const match = resolveScanMatch(CODE_39_DECODED, [k10188]);

    expect(match.kind).toBe("single");
    expect(CODE_39_DECODED).toBe("K10188-13");
  });

  it("still resolves when the label is read in a different case", () => {
    const k10188 = product({ code: "K10188-13" });
    expect(resolveScanMatch("k10188-13", [k10188])).toEqual({
      kind: "single",
      product: k10188,
    });
  });

  it("wins over another product whose barcode column holds the same value", () => {
    const k10188 = product({ id: "code-row", code: "K10188-13", barcode: null });
    const supplierRow = product({
      id: "barcode-row",
      code: "SUP-991",
      barcode: "K10188-13",
    });

    expect(resolveScanMatch(CODE_39_DECODED, [supplierRow, k10188])).toEqual({
      kind: "single",
      product: k10188,
    });
  });
});

describe("resolveScanMatch", () => {
  it("returns none when nothing came back", () => {
    expect(resolveScanMatch("123", [])).toEqual({ kind: "none" });
  });

  it("treats a single exact barcode match as a direct hit", () => {
    const target = product({ barcode: "4901234567894" });
    const other = product({ id: "b", code: "OTHER-1" });
    const match = resolveScanMatch("4901234567894", [other, target]);

    expect(match).toEqual({ kind: "single", product: target });
  });

  it("matches on product code as well as barcode", () => {
    const target = product();
    expect(resolveScanMatch("K10188-13", [target])).toEqual({
      kind: "single",
      product: target,
    });
  });

  it("compares case-insensitively without altering the raw value", () => {
    const target = product();
    const raw = "k10188-13";
    expect(resolveScanMatch(raw, [target])).toEqual({ kind: "single", product: target });
    expect(raw).toBe("k10188-13");
  });

  it("returns multiple when several products match loosely", () => {
    const a = product({ id: "a", code: "A-1" });
    const b = product({ id: "b", code: "B-2" });
    expect(resolveScanMatch("plate", [a, b])).toEqual({
      kind: "multiple",
      products: [a, b],
    });
  });

  it("returns multiple when two products claim the same exact value", () => {
    const a = product({ id: "a", code: "DUP" });
    const b = product({ id: "b", code: "dup" });
    expect(resolveScanMatch("DUP", [a, b]).kind).toBe("multiple");
  });

  it("treats a lone loose result as a direct hit", () => {
    const only = product({ code: "ZZZ-9" });
    expect(resolveScanMatch("Abbesses", [only])).toEqual({
      kind: "single",
      product: only,
    });
  });
});

describe("describeCameraError", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["PermissionDeniedError", "denied"],
    ["NotFoundError", "noCamera"],
    ["OverconstrainedError", "noCamera"],
    ["NotReadableError", "inUse"],
    ["SecurityError", "insecure"],
    ["SomethingElse", "unknown"],
  ])("maps %s to %s", (name, reason) => {
    expect(describeCameraError({ name }).reason).toBe(reason);
  });

  it("handles non-error values", () => {
    expect(describeCameraError(undefined).reason).toBe("unknown");
    expect(describeCameraError("boom").reason).toBe("unknown");
  });
});

describe("hasCameraSupport", () => {
  it("is false when mediaDevices is missing", () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });

    expect(hasCameraSupport()).toBe(false);

    if (original) Object.defineProperty(navigator, "mediaDevices", original);
  });

  it("is true when getUserMedia exists", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });

    expect(hasCameraSupport()).toBe(true);
  });
});

describe("stopMediaStream", () => {
  it("stops every track and detaches the stream", () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const video = document.createElement("video");
    Object.defineProperty(video, "srcObject", {
      value: { getTracks: () => [{ stop: stopA }, { stop: stopB }] },
      writable: true,
      configurable: true,
    });

    expect(stopMediaStream(video)).toBe(2);
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it("is safe with no element and no stream", () => {
    expect(stopMediaStream(null)).toBe(0);

    const video = document.createElement("video");
    Object.defineProperty(video, "srcObject", {
      value: null,
      writable: true,
      configurable: true,
    });
    expect(stopMediaStream(video)).toBe(0);
  });
});
