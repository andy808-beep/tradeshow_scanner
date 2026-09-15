import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_IMPORT_MAPPINGS,
  LegacyImportError,
  mapLegacyProductRow,
} from "@/lib/legacy-import";

describe("mapLegacyProductRow", () => {
  it("maps hh to product_code", () => {
    const record = mapLegacyProductRow({ hh: "K10188-13" });
    expect(record.product_code).toBe("K10188-13");
  });

  it("never maps bc_default to barcode", () => {
    const record = mapLegacyProductRow({
      hh: "K10188-13",
      bc_default: "6 pcs / carton",
    });

    expect(record.barcode).toBeNull();
    expect(record.barcode).not.toBe("6 pcs / carton");
    expect(record.packaging).toBe("6 pcs / carton");
    expect(FORBIDDEN_IMPORT_MAPPINGS.barcode).toMatch(/not a barcode/);
  });

  it("leaves barcode null so supplier labels can fill it later", () => {
    const record = mapLegacyProductRow({ hh: "K10188-13", bc_default: "box" });
    expect(record.barcode).toBeNull();
  });

  it("preserves hyphens and case in the product code", () => {
    const record = mapLegacyProductRow({ hh: "  K10188-13  " });
    expect(record.product_code).toBe("K10188-13");
    expect(record.product_code).toContain("-");
  });

  it("carries the names and dimensions across", () => {
    const record = mapLegacyProductRow({
      hh: "K10188-13",
      chinese_name: "大方盘·紫",
      english_name: "Abbesses Plate - L",
      dimensions: "20.6 × 13.3 × 2.0 cm",
    });

    expect(record.chinese_name).toBe("大方盘·紫");
    expect(record.english_name).toBe("Abbesses Plate - L");
    expect(record.dimensions).toBe("20.6 × 13.3 × 2.0 cm");
  });

  it("treats blank optional columns as null", () => {
    const record = mapLegacyProductRow({ hh: "K10188-13", bc_default: "   " });
    expect(record.packaging).toBeNull();
    expect(record.chinese_name).toBeNull();
  });

  it("rejects a row with no product code", () => {
    expect(() => mapLegacyProductRow({ bc_default: "box" })).toThrow(LegacyImportError);
    expect(() => mapLegacyProductRow({ hh: "  " })).toThrow(/hh/);
  });
});
