import { readFileSync } from "node:fs";
import { inflateRawSync, inflateSync } from "node:zlib";
import path from "node:path";
import { BitArray, Code39Reader } from "@zxing/library";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { encodeCode39Bits } from "@/lib/code39";
import { code39BarRects } from "@/lib/code39-bars";
import {
  generateCalibrationLabelPdf,
  generateProductionLabelPdf,
  type LabelSlotReport,
} from "@/lib/label-pdf";
import {
  A4_10_LABELS_105x57,
  CALIBRATION_PDF_SUBJECT,
  CALIBRATION_TEST_CODE,
  clampPdfSettings,
  DEFAULT_LABEL_PDF_SETTINGS,
  LABEL_PDF_FONT_DISK_PATH,
  labelRectMm,
  mmToPt,
  paginateLabelSlots,
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

describe("millimetre to PDF point conversion", () => {
  it("maps 25.4 mm to 72 points and A4 to exact 210 × 297 mm", () => {
    expect(mmToPt(25.4)).toBe(72);
    expect(mmToPt(A4_10_LABELS_105x57.pageWidthMm)).toBe((210 * 72) / 25.4);
    expect(mmToPt(A4_10_LABELS_105x57.pageHeightMm)).toBe((297 * 72) / 25.4);
  });
});

describe("A4 10-up template", () => {
  it("is 2×5 of 105 × 57 mm with a 6 mm top margin", () => {
    expect(A4_10_LABELS_105x57.name).toBe("A4 — 10 labels — 105 × 57 mm");
    expect(A4_10_LABELS_105x57.columns).toBe(2);
    expect(A4_10_LABELS_105x57.rows).toBe(5);
    expect(A4_10_LABELS_105x57.labelWidthMm).toBe(105);
    expect(A4_10_LABELS_105x57.labelHeightMm).toBe(57);
    expect(A4_10_LABELS_105x57.topMarginMm).toBe(6);
    expect(A4_10_LABELS_105x57.leftMarginMm).toBe(0);
    expect(A4_10_LABELS_105x57.columnGapMm).toBe(0);
    expect(A4_10_LABELS_105x57.rowGapMm).toBe(0);

    const first = labelRectMm(1, DEFAULT_LABEL_PDF_SETTINGS);
    expect(first).toEqual({ xMm: 0, yMmFromTop: 6, widthMm: 105, heightMm: 57 });
    expect(labelRectMm(2, DEFAULT_LABEL_PDF_SETTINGS).xMm).toBe(105);
    expect(labelRectMm(3, DEFAULT_LABEL_PDF_SETTINGS).yMmFromTop).toBe(63);
    expect(labelRectMm(10, DEFAULT_LABEL_PDF_SETTINGS)).toEqual({
      xMm: 105,
      yMmFromTop: 234,
      widthMm: 105,
      heightMm: 57,
    });
  });

  it("allows negative and positive page offsets within the safe range", () => {
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
    expect(clamped.startAt).toBe(10);
    expect(clamped.paddingMm).toBe(1.5);
  });
});

describe("pagination and start-at", () => {
  it("fills left to right, then top to bottom, repeating copies", () => {
    const pages = paginateLabelSlots(["A", "A", "B"], 1);
    expect(pages).toHaveLength(1);
    expect(pages[0].map((slot) => slot.product)).toEqual([
      "A",
      "A",
      "B",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("leaves positions before Start at label blank on the first page", () => {
    const pages = paginateLabelSlots(["P", "Q", "R", "S", "T"], 8);
    expect(pages).toHaveLength(2);
    expect(pages[0].slice(0, 7).every((slot) => slot.product === null)).toBe(true);
    expect(pages[0].map((slot) => slot.product)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "P",
      "Q",
      "R",
    ]);
    expect(pages[1].map((slot) => slot.product)).toEqual([
      "S",
      "T",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("paginates past 10 labels onto a second page", () => {
    const products = Array.from({ length: 12 }, (_, index) => `N${index}`);
    const pages = paginateLabelSlots(products, 1);
    expect(pages).toHaveLength(2);
    expect(pages[0].filter((slot) => slot.product)).toHaveLength(10);
    expect(pages[1].filter((slot) => slot.product)).toHaveLength(2);
  });
});

describe("production PDF", () => {
  it("uses A4 210 × 297 mm pages and 105 × 57 mm label slots", async () => {
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
    expect(plan.templateName).toBe("A4 — 10 labels — 105 × 57 mm");

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getSubject()).toBe(PRODUCTION_PDF_SUBJECT);
    const size = pdf.getPages()[0].getSize();
    expect(size.width).toBe(mmToPt(210));
    expect(size.height).toBe(mmToPt(297));

    const filled = plan.slots.find((slot) => slot.productCode === "K10188-13");
    expect(filled?.rect).toEqual({
      xMm: 0,
      yMmFromTop: 6,
      widthMm: 105,
      heightMm: 57,
    });
  });

  it("respects copy counts and Start at label across pages", async () => {
    const product = toLabelPdfProduct(K10188);
    const copies = Array.from({ length: 5 }, () => product);
    const { plan } = await generateProductionLabelPdf({
      products: copies,
      settings: { ...DEFAULT_LABEL_PDF_SETTINGS, startAt: 8 },
      fontBytes: FONT_BYTES,
    });

    expect(plan.pageCount).toBe(2);
    const firstPage = plan.slots.filter((slot) => slot.pageIndex === 0);
    expect(firstPage.slice(0, 7).every((slot) => slot.productCode === null)).toBe(
      true,
    );
    expect(firstPage.slice(7).map((slot) => slot.productCode)).toEqual([
      "K10188-13",
      "K10188-13",
      "K10188-13",
    ]);
    const secondPage = plan.slots.filter((slot) => slot.pageIndex === 1);
    expect(secondPage.filter((slot) => slot.productCode)).toHaveLength(2);
  });

  it("encodes K10188-13 with the shared Code 39 encoder and round-trips", async () => {
    const { plan } = await generateProductionLabelPdf({
      products: [toLabelPdfProduct(K10188)],
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });
    const slot = plan.slots.find((item) => item.productCode === "K10188-13");
    expect(slot).toBeTruthy();
    const expected = code39BarRects("K10188-13", DEFAULT_LABEL_PDF_SETTINGS.moduleMm);
    expect(slot!.boxes.filter((box) => box.kind === "bar")).toHaveLength(expected.bars.length);
    expect(decodeBits(encodeCode39Bits("K10188-13", 3))).toBe("K10188-13");
  });

  it("embeds Chinese text and never includes unit price or the barcode column", async () => {
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
    expect(texts).toContain("Abbesses Plate - L");
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
    expect(plan.markTexts).toEqual([]);
  });

  it("keeps barcode bars and text inside each 105 × 57 mm label", async () => {
    const products: LabelPdfProduct[] = [
      toLabelPdfProduct(K10188),
      {
        code: "K9426S-19",
        nameZh: "超长中文名称用于确认换行不会画出标签边界之外的内容",
        nameEn: "A very long English name that should wrap or ellipsize inside the label",
        dimensions: "999.9 × 888.8 × 777.7 cm extra text",
      },
    ];
    const { plan } = await generateProductionLabelPdf({
      products,
      settings: { ...DEFAULT_LABEL_PDF_SETTINGS, moduleMm: 0.5, barcodeHeightMm: 28 },
      fontBytes: FONT_BYTES,
    });
    for (const slot of plan.slots) assertInsideLabel(slot);
  });
});

describe("calibration PDF", () => {
  it("is one A4 page with 10 numbered outlines, rulers and a K10188-13 barcode", async () => {
    const { bytes, plan } = await generateCalibrationLabelPdf({
      settings: DEFAULT_LABEL_PDF_SETTINGS,
      fontBytes: FONT_BYTES,
    });

    expect(plan.pageCount).toBe(1);
    expect(plan.calibrationMarks).toBe(true);
    expect(plan.slots).toHaveLength(10);
    expect(plan.slots.map((slot) => slot.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(plan.slots[0].productCode).toBe(CALIBRATION_TEST_CODE);

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getSubject()).toBe(CALIBRATION_PDF_SUBJECT);
    expect(pdf.getPages()[0].getSize()).toEqual({
      width: mmToPt(210),
      height: mmToPt(297),
    });

    expect(plan.markTexts.some((text) => text.includes("Calibration sheet"))).toBe(
      true,
    );
    expect(plan.markTexts).toContain("10 mm");
    expect(plan.markTexts).toContain("210 mm");
    expect(plan.markTexts).toContain("297 mm");
    expect(plan.slots.every((slot) => slot.boxes.some((box) => box.text === String(slot.position)))).toBe(
      true,
    );
    expect(plan.slots[0].boxes.filter((box) => box.kind === "bar").length).toBeGreaterThan(0);
    expect(decodeBits(encodeCode39Bits(CALIBRATION_TEST_CODE, 3))).toBe("K10188-13");

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
