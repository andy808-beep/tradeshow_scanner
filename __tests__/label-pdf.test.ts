import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync, inflateSync } from "node:zlib";
import path from "node:path";
import { BitArray, Code39Reader } from "@zxing/library";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { encodeCode39Bits } from "@/lib/code39";
import {
  code39BarRects,
  code39ModuleCount,
  fitCode39ForLabel,
  MIN_NARROW_BAR_MM,
} from "@/lib/code39-bars";
import {
  barcodeFitForProduct,
  generateCalibrationLabelPdf,
  generateProductionLabelPdf,
  type LabelSlotReport,
} from "@/lib/label-pdf";
import {
  A4_40_LABELS_52x29,
  barcodeAvailableWidthMm,
  CALIBRATION_LONG_CODE,
  CALIBRATION_PDF_SUBJECT,
  CALIBRATION_TEST_CODE,
  clampPdfSettings,
  DEFAULT_LABEL_PDF_SETTINGS,
  LABEL_PDF_FONT_DISK_PATH,
  LABEL_PDF_TEMPLATE,
  LabelPdfError,
  labelRectMm,
  labelsPerPage,
  mmToPt,
  paginateLabelSlots,
  parseStartAt,
  PRODUCTION_PDF_SUBJECT,
  toLabelPdfProduct,
  type LabelPdfProduct,
} from "@/lib/label-pdf-template";
import type { Product } from "@/lib/types";

const FONT_BYTES = new Uint8Array(
  readFileSync(path.join(process.cwd(), LABEL_PDF_FONT_DISK_PATH)),
);

const K10188: Product = {
  id: "e4247a2f-1e3b-4d64-a05f-ab38906b5292",
  code: "K10188-13",
  nameZh: "大方盘·紫",
  nameEn: "Abbesses Plate - L",
  dimensions: "20.6 × 13.3 × 2.0 cm",
  barcode: "SHOULD-NOT-APPEAR",
  unitPrice: 12.3456,
  packaging: null,
  currency: "USD",
  imageUrl: null,
};

const K9426S: Product = {
  ...K10188,
  id: "11111111-2222-4333-8444-555555555555",
  code: CALIBRATION_LONG_CODE,
  nameZh: "超长中文名称用于确认截断不会画出标签边界之外的内容",
  nameEn: "A very long English name that must not appear on the small label",
  dimensions: "999.9 × 888.8 × 777.7 cm extra text",
};

/** Longest product codes used as catalogue fixtures in this repository. */
const CATALOGUE_CODES = ["K10188-13", "K9426S-19", "K9000-01", "DY-59", "K10188-14"];

function decodeBits(bits: boolean[]): string {
  const row = new BitArray(bits.length);
  bits.forEach((black, index) => {
    if (black) row.set(index);
  });
  return new Code39Reader(false, false).decodeRow(0, row).getText();
}

function inflatePdf(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes).toString("latin1");
  const chunks: string[] = [latin];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin))) {
    const payload = Buffer.from(match[1], "latin1");
    for (const inflate of [inflateSync, inflateRawSync]) {
      try {
        chunks.push(inflate(payload).toString("latin1"));
        break;
      } catch {
        // Not a zlib stream.
      }
    }
  }
  return chunks.join("\n");
}

function assertInsideLabel(slot: LabelSlotReport) {
  for (const box of slot.boxes) {
    expect(box.xMm).toBeGreaterThanOrEqual(slot.rect.xMm - 0.05);
    expect(box.xMm + box.widthMm).toBeLessThanOrEqual(
      slot.rect.xMm + slot.rect.widthMm + 0.05,
    );
    expect(box.yMmFromTop).toBeGreaterThanOrEqual(slot.rect.yMmFromTop - 0.05);
    expect(box.yMmFromTop + box.heightMm).toBeLessThanOrEqual(
      slot.rect.yMmFromTop + slot.rect.heightMm + 0.05,
    );
  }
}

function assertBarcodeSafety(slot: LabelSlotReport) {
  const barcode = slot.barcode;
  expect(barcode).toBeTruthy();
  expect(barcode!.moduleMm).toBeGreaterThanOrEqual(MIN_NARROW_BAR_MM - 1e-9);
  expect(barcode!.quietZoneMm).toBeCloseTo(10 * barcode!.moduleMm);
  expect(barcode!.encodedValue).toBe(slot.productCode);

  const bars = slot.boxes.filter((box) => box.kind === "bar");
  expect(bars.length).toBeGreaterThan(0);
  const firstBar = bars.reduce((min, box) => (box.xMm < min.xMm ? box : min));
  const lastBar = bars.reduce((max, box) =>
    box.xMm + box.widthMm > max.xMm + max.widthMm ? box : max,
  );
  const origin = firstBar.xMm - barcode!.quietZoneMm;
  expect(lastBar.xMm + lastBar.widthMm + barcode!.quietZoneMm - origin).toBeCloseTo(
    barcode!.widthMm,
  );

  const barcodeTop = Math.min(...bars.map((box) => box.yMmFromTop));
  const barcodeBottom = barcodeTop + firstBar.heightMm;
  for (const box of slot.boxes) {
    if (box.kind !== "text") continue;
    const overlapsY =
      box.yMmFromTop < barcodeBottom - 0.05 &&
      box.yMmFromTop + box.heightMm > barcodeTop + 0.05;
    expect(overlapsY).toBe(false);
  }
}

describe("millimetre to PDF point conversion", () => {
  it("maps 25.4 mm to 72 points and A4 to exact 210 × 297 mm", () => {
    expect(mmToPt(25.4)).toBe(72);
    expect(mmToPt(A4_40_LABELS_52x29.pageWidthMm)).toBe((210 * 72) / 25.4);
    expect(mmToPt(A4_40_LABELS_52x29.pageHeightMm)).toBe((297 * 72) / 25.4);
  });
});

describe("A4 40-up template", () => {
  it("is 4×10 of 52.5 × 29.7 mm with zero margins and gaps", () => {
    expect(LABEL_PDF_TEMPLATE).toBe(A4_40_LABELS_52x29);
    expect(A4_40_LABELS_52x29.name).toBe("A4 — 40 labels — 52.5 × 29.7 mm");
    expect(A4_40_LABELS_52x29.columns).toBe(4);
    expect(A4_40_LABELS_52x29.rows).toBe(10);
    expect(A4_40_LABELS_52x29.labelWidthMm).toBe(52.5);
    expect(A4_40_LABELS_52x29.labelHeightMm).toBeCloseTo(29.7);
    expect(A4_40_LABELS_52x29.topMarginMm).toBe(0);
    expect(A4_40_LABELS_52x29.leftMarginMm).toBe(0);
    expect(A4_40_LABELS_52x29.columnGapMm).toBe(0);
    expect(A4_40_LABELS_52x29.rowGapMm).toBe(0);
    expect(4 * 52.5).toBe(210);
    expect(10 * 29.7).toBeCloseTo(297);
    expect(labelsPerPage()).toBe(40);

    const first = labelRectMm(1, DEFAULT_LABEL_PDF_SETTINGS);
    expect(first.xMm).toBe(0);
    expect(first.yMmFromTop).toBe(0);
    expect(first.widthMm).toBe(52.5);
    expect(first.heightMm).toBeCloseTo(29.7);
    expect(labelRectMm(2, DEFAULT_LABEL_PDF_SETTINGS).xMm).toBe(52.5);
    expect(labelRectMm(4, DEFAULT_LABEL_PDF_SETTINGS).xMm).toBe(157.5);
    expect(labelRectMm(5, DEFAULT_LABEL_PDF_SETTINGS).yMmFromTop).toBeCloseTo(29.7);

    const last = labelRectMm(40, DEFAULT_LABEL_PDF_SETTINGS);
    expect(last.xMm).toBe(157.5);
    expect(last.yMmFromTop).toBeCloseTo(9 * 29.7);
    expect(last.widthMm).toBe(52.5);
    expect(last.heightMm).toBeCloseTo(29.7);
    expect(last.xMm + last.widthMm).toBe(210);
    expect(last.yMmFromTop + last.heightMm).toBeCloseTo(297);
  });

  it("keeps every position 1–40 on the A4 page", () => {
    for (let position = 1; position <= 40; position += 1) {
      const rect = labelRectMm(position, DEFAULT_LABEL_PDF_SETTINGS);
      expect(rect.widthMm).toBe(52.5);
      expect(rect.heightMm).toBeCloseTo(29.7);
      expect(rect.xMm).toBeGreaterThanOrEqual(0);
      expect(rect.xMm + rect.widthMm).toBeLessThanOrEqual(210 + 1e-9);
      expect(rect.yMmFromTop).toBeGreaterThanOrEqual(0);
      expect(rect.yMmFromTop + rect.heightMm).toBeLessThanOrEqual(297 + 1e-9);
    }
  });

  it("clamps offsets, padding and barcode size without silently accepting a bad start-at", () => {
    const clamped = clampPdfSettings({
      offsetXMm: -40,
      offsetYMm: 40,
      paddingMm: 0,
      barcodeHeightMm: 1,
      moduleMm: 9,
      startAt: 99,
    });
    expect(clamped.offsetXMm).toBe(-10);
    expect(clamped.offsetYMm).toBe(10);
    expect(clamped.paddingMm).toBe(2);
    expect(clamped.barcodeHeightMm).toBe(10);
    expect(clamped.moduleMm).toBe(0.5);
    expect(clamped.startAt).toBe(99);
    expect(() => parseStartAt(99)).toThrow(LabelPdfError);
  });
});

describe("pagination and start-at", () => {
  it("accepts 1–40 and rejects every other value", () => {
    expect(parseStartAt(1)).toBe(1);
    expect(parseStartAt(40)).toBe(40);
    expect(parseStartAt(21)).toBe(21);
    expect(() => parseStartAt(0)).toThrow(LabelPdfError);
    expect(() => parseStartAt(41)).toThrow(LabelPdfError);
    expect(() => parseStartAt(-1)).toThrow(LabelPdfError);
    expect(() => parseStartAt(Number.NaN)).toThrow(LabelPdfError);
    expect(() => paginateLabelSlots(["A"], 41)).toThrow(LabelPdfError);
  });

  it("fills left to right, then top to bottom, repeating copies", () => {
    const pages = paginateLabelSlots(["A", "A", "B"], 1);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(40);
    expect(pages[0].slice(0, 3).map((slot) => slot.product)).toEqual(["A", "A", "B"]);
    expect(pages[0].slice(3).every((slot) => slot.product === null)).toBe(true);
  });

  it("leaves positions before Start at label blank on the first page", () => {
    const pages = paginateLabelSlots(["P", "Q", "R", "S", "T"], 38);
    expect(pages).toHaveLength(2);
    expect(pages[0].slice(0, 37).every((slot) => slot.product === null)).toBe(true);
    expect(pages[0].slice(37).map((slot) => slot.product)).toEqual(["P", "Q", "R"]);
    expect(pages[1].map((slot) => slot.product).slice(0, 2)).toEqual(["S", "T"]);
    expect(pages[1].slice(2).every((slot) => slot.product === null)).toBe(true);
    expect(pages[1]).toHaveLength(40);
  });

  it("paginates past 40 labels onto a second page", () => {
    const products = Array.from({ length: 45 }, (_, index) => `N${index}`);
    const pages = paginateLabelSlots(products, 1);
    expect(pages).toHaveLength(2);
    expect(pages[0].filter((slot) => slot.product)).toHaveLength(40);
    expect(pages[1].filter((slot) => slot.product)).toHaveLength(5);
  });
});

describe("scanner-safety fit", () => {
  it("fits K10188-13 at or above the 0.25 mm narrow-bar minimum", () => {
    const fit = barcodeFitForProduct("K10188-13", DEFAULT_LABEL_PDF_SETTINGS);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.moduleMm).toBeGreaterThanOrEqual(MIN_NARROW_BAR_MM);
    expect(fit.quietZoneMm).toBeCloseTo(10 * fit.moduleMm);
    expect(code39ModuleCount("K10188-13")).toBe(195);
  });

  it("fits the longest current catalogue code or reports a clear error", () => {
    const maxLength = Math.max(...CATALOGUE_CODES.map((code) => code.length));
    const longestCodes = CATALOGUE_CODES.filter((code) => code.length === maxLength);
    expect(longestCodes).toContain(CALIBRATION_LONG_CODE);
    expect(longestCodes).toContain("K10188-13");
    for (const code of longestCodes) {
      const fit = barcodeFitForProduct(code, DEFAULT_LABEL_PDF_SETTINGS);
      if (fit.ok) {
        expect(fit.moduleMm).toBeGreaterThanOrEqual(MIN_NARROW_BAR_MM);
      } else {
        expect(fit.requiredWidthMm).toBeGreaterThan(fit.availableWidthMm);
      }
    }
  });

  it("refuses to shrink a 10-character code below the safe minimum", () => {
    const tooLong = "K10188-130";
    const available = barcodeAvailableWidthMm();
    const fit = fitCode39ForLabel(tooLong, available, 0.25, MIN_NARROW_BAR_MM);
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.requiredWidthMm).toBeGreaterThan(available);
    expect(fit.minModuleMm).toBe(MIN_NARROW_BAR_MM);
  });
});

describe("production PDF", () => {
  it("uses A4 210 × 297 mm pages and 52.5 × 29.7 mm label slots", async () => {
    const product = toLabelPdfProduct(K10188);
    const { bytes, plan } = await generateProductionLabelPdf({
      products: [product],
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });

    expect(plan.pageWidthMm).toBe(210);
    expect(plan.pageHeightMm).toBe(297);
    expect(plan.pageCount).toBe(1);
    expect(plan.calibrationMarks).toBe(false);
    expect(plan.templateName).toBe("A4 — 40 labels — 52.5 × 29.7 mm");
    expect(plan.skippedCodes).toEqual([]);

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getSubject()).toBe(PRODUCTION_PDF_SUBJECT);
    const size = pdf.getPages()[0].getSize();
    expect(size.width).toBe(mmToPt(210));
    expect(size.height).toBe(mmToPt(297));

    const filled = plan.slots.find((slot) => slot.productCode === "K10188-13");
    expect(filled?.rect.xMm).toBe(0);
    expect(filled?.rect.yMmFromTop).toBe(0);
    expect(filled?.rect.widthMm).toBe(52.5);
    expect(filled?.rect.heightMm).toBeCloseTo(29.7);
    expect(plan.slots).toHaveLength(40);
  });

  it("respects copy counts and Start at label across pages", async () => {
    const product = toLabelPdfProduct(K10188);
    const copies = Array.from({ length: 5 }, () => product);
    const { plan } = await generateProductionLabelPdf({
      products: copies,
      settings: { ...DEFAULT_LABEL_PDF_SETTINGS, startAt: 38 },
      fontBytes: FONT_BYTES,
    });

    expect(plan.pageCount).toBe(2);
    const firstPage = plan.slots.filter((slot) => slot.pageIndex === 0);
    expect(firstPage).toHaveLength(40);
    expect(firstPage.slice(0, 37).every((slot) => slot.productCode === null)).toBe(true);
    expect(firstPage.slice(37).map((slot) => slot.productCode)).toEqual([
      "K10188-13",
      "K10188-13",
      "K10188-13",
    ]);
    const secondPage = plan.slots.filter((slot) => slot.pageIndex === 1);
    expect(secondPage).toHaveLength(40);
    expect(secondPage.filter((slot) => slot.productCode)).toHaveLength(2);
    expect(secondPage.slice(0, 2).map((slot) => slot.productCode)).toEqual([
      "K10188-13",
      "K10188-13",
    ]);
  });

  it("paginates a production PDF past 40 labels", async () => {
    const copies = Array.from({ length: 41 }, () => toLabelPdfProduct(K10188));
    const { plan } = await generateProductionLabelPdf({
      products: copies,
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });
    expect(plan.pageCount).toBe(2);
    expect(plan.slots.filter((slot) => slot.pageIndex === 0 && slot.productCode)).toHaveLength(
      40,
    );
    expect(plan.slots.filter((slot) => slot.pageIndex === 1 && slot.productCode)).toHaveLength(
      1,
    );
  });

  it("rejects Start at label values outside 1–40", async () => {
    await expect(
      generateProductionLabelPdf({
        products: [toLabelPdfProduct(K10188)],
        settings: { ...DEFAULT_LABEL_PDF_SETTINGS, startAt: 41 },
        fontBytes: FONT_BYTES,
      }),
    ).rejects.toBeInstanceOf(LabelPdfError);
  });

  it("encodes K10188-13 with the shared Code 39 encoder and round-trips", async () => {
    const { plan } = await generateProductionLabelPdf({
      products: [toLabelPdfProduct(K10188)],
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });
    const slot = plan.slots.find((item) => item.productCode === "K10188-13");
    expect(slot).toBeTruthy();
    expect(slot!.barcode?.encodedValue).toBe("K10188-13");
    const expected = code39BarRects("K10188-13", slot!.barcode!.moduleMm);
    expect(slot!.boxes.filter((box) => box.kind === "bar")).toHaveLength(expected.bars.length);
    expect(decodeBits(encodeCode39Bits("K10188-13", 3))).toBe("K10188-13");
    assertBarcodeSafety(slot!);
  });

  it("embeds Chinese text and never includes English name, unit price or the barcode column", async () => {
    const { bytes, plan } = await generateProductionLabelPdf({
      products: [toLabelPdfProduct(K10188)],
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });

    const texts = plan.slots.flatMap((slot) =>
      slot.boxes.filter((box) => box.kind === "text").map((box) => box.text),
    );
    expect(texts).toContain("K10188-13");
    expect(texts).toContain("大方盘·紫");
    expect(texts).not.toContain("Abbesses Plate - L");
    expect(texts).toContain("20.6 × 13.3 × 2.0 cm");
    expect(texts.join(" ")).not.toMatch(/12\.3456/);
    expect(texts.join(" ")).not.toContain("SHOULD-NOT-APPEAR");
    expect(texts.join(" ")).not.toMatch(/US\$/);

    const inflated = inflatePdf(bytes);
    expect(inflated).toContain("5927"); // 大
    expect(inflated).toContain("65B9"); // 方
    expect(inflated).toContain("76D8"); // 盘
    expect(inflated).toContain("7D2B"); // 紫
    expect(inflated).toMatch(/NotoSansSC/);
    expect(inflated).not.toContain("12.3456");
    expect(inflated).not.toContain("SHOULD-NOT-APPEAR");
    expect(inflated).not.toContain("Abbesses Plate - L");
    expect(plan.markTexts).toEqual([]);
  });

  it("keeps barcode bars and text inside each 52.5 × 29.7 mm label", async () => {
    const products: LabelPdfProduct[] = [toLabelPdfProduct(K10188), toLabelPdfProduct(K9426S)];
    const { plan } = await generateProductionLabelPdf({
      products,
      settings: { ...DEFAULT_LABEL_PDF_SETTINGS, moduleMm: 0.5, barcodeHeightMm: 13 },
      fontBytes: FONT_BYTES,
    });
    for (const slot of plan.slots) {
      assertInsideLabel(slot);
      if (slot.productCode) assertBarcodeSafety(slot);
    }
  });

  it("excludes an unsafe product code and reports it instead of shrinking the barcode", async () => {
    const unsafe: LabelPdfProduct = {
      code: "K10188-130",
      nameZh: "过长",
      nameEn: "Too long",
      dimensions: "1 × 1 × 1 cm",
    };
    const { plan } = await generateProductionLabelPdf({
      products: [toLabelPdfProduct(K10188), unsafe],
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });
    expect(plan.slots.filter((slot) => slot.productCode === "K10188-13")).toHaveLength(1);
    expect(plan.slots.every((slot) => slot.productCode !== "K10188-130")).toBe(true);
    expect(plan.skippedCodes).toHaveLength(1);
    expect(plan.skippedCodes[0].code).toBe("K10188-130");
    expect(plan.skippedCodes[0].message).toContain("K10188-130");
    expect(plan.skippedCodes[0].message).toContain("0.25");
  });
});

describe("calibration PDF", () => {
  it("is one A4 page with 40 numbered outlines, rulers and catalogue sample codes", async () => {
    const { bytes, plan } = await generateCalibrationLabelPdf({
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });

    expect(plan.pageCount).toBe(1);
    expect(plan.calibrationMarks).toBe(true);
    expect(plan.slots).toHaveLength(40);
    expect(plan.slots.map((slot) => slot.position)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    expect(plan.slots[0].productCode).toBe(CALIBRATION_TEST_CODE);
    expect(plan.slots[1].productCode).toBe(CALIBRATION_LONG_CODE);

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getSubject()).toBe(CALIBRATION_PDF_SUBJECT);
    expect(pdf.getPages()[0].getSize()).toEqual({
      width: mmToPt(210),
      height: mmToPt(297),
    });

    expect(plan.markTexts.some((text) => text.includes("Calibration sheet"))).toBe(true);
    expect(plan.markTexts).toContain("10 mm");
    expect(plan.markTexts).toContain("210 mm");
    expect(plan.markTexts).toContain("297 mm");
    expect(
      plan.slots.every((slot) => slot.boxes.some((box) => box.text === String(slot.position))),
    ).toBe(true);
    expect(plan.slots[0].boxes.filter((box) => box.kind === "bar").length).toBeGreaterThan(0);
    expect(plan.slots[1].boxes.filter((box) => box.kind === "bar").length).toBeGreaterThan(0);
    expect(decodeBits(encodeCode39Bits(CALIBRATION_TEST_CODE, 3))).toBe("K10188-13");
    assertBarcodeSafety(plan.slots[0]);
    assertBarcodeSafety(plan.slots[1]);

    for (const slot of plan.slots) assertInsideLabel(slot);
  });

  it("does not leak calibration markings into a production export", async () => {
    const production = await generateProductionLabelPdf({
      products: [toLabelPdfProduct(K10188)],
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });
    expect(production.plan.calibrationMarks).toBe(false);
    expect(production.plan.markTexts).toEqual([]);
    expect(inflatePdf(production.bytes)).not.toContain(CALIBRATION_PDF_SUBJECT);
  });
});

describe("test artifacts", () => {
  it("writes uncommitted calibration and production PDFs", async () => {
    const dir = path.join(process.cwd(), "test-artifacts");
    mkdirSync(dir, { recursive: true });

    const calibration = await generateCalibrationLabelPdf({
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });
    writeFileSync(
      path.join(dir, "koei-label-calibration.pdf"),
      Buffer.from(calibration.bytes),
    );

    const production = await generateProductionLabelPdf({
      products: [toLabelPdfProduct(K10188), toLabelPdfProduct(K9426S)],
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });
    writeFileSync(path.join(dir, "koei-labels.pdf"), Buffer.from(production.bytes));

    expect(calibration.bytes.byteLength).toBeGreaterThan(1000);
    expect(production.bytes.byteLength).toBeGreaterThan(1000);
  });
});
