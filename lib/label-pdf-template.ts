/**
 * Physical A4 sticker layout. Zero margins and gaps are initial assumptions —
 * the sheet has not been printer-calibrated yet.
 *
 * Four 52.5 mm columns fill the 210 mm page width. Ten 29.7 mm rows fill the
 * 297 mm page height.
 */

export const PDF_POINTS_PER_INCH = 72;
export const MM_PER_INCH = 25.4;
export const MM_TO_PT = PDF_POINTS_PER_INCH / MM_PER_INCH;

export function mmToPt(mm: number): number {
  return (mm * PDF_POINTS_PER_INCH) / MM_PER_INCH;
}

export function ptToMm(pt: number): number {
  return (pt * MM_PER_INCH) / PDF_POINTS_PER_INCH;
}

export interface LabelPdfTemplate {
  id: string;
  name: string;
  pageWidthMm: number;
  pageHeightMm: number;
  columns: number;
  rows: number;
  labelWidthMm: number;
  labelHeightMm: number;
  columnGapMm: number;
  rowGapMm: number;
  leftMarginMm: number;
  topMarginMm: number;
}

export const A4_40_LABELS_52x29: LabelPdfTemplate = {
  id: "a4-40-52x29",
  name: "A4 — 40 labels — 52.5 × 29.7 mm",
  pageWidthMm: 210,
  pageHeightMm: 297,
  columns: 4,
  rows: 10,
  labelWidthMm: 52.5,
  labelHeightMm: 29.7,
  columnGapMm: 0,
  rowGapMm: 0,
  leftMarginMm: 0,
  topMarginMm: 0,
};

export const LABEL_PDF_TEMPLATE = A4_40_LABELS_52x29;

export function labelsPerPage(template: LabelPdfTemplate = A4_40_LABELS_52x29): number {
  return template.columns * template.rows;
}

export interface LabelPdfSettings {
  /** Extra horizontal shift of the whole grid, millimetres. May be negative. */
  offsetXMm: number;
  /** Extra vertical shift of the whole grid, millimetres. May be negative. */
  offsetYMm: number;
  /** Inset on the text block, millimetres. */
  paddingMm: number;
  barcodeHeightMm: number;
  /** Preferred narrow-bar width, millimetres. Never drawn below 0.25 mm. */
  moduleMm: number;
  /** 1-based position on the first sheet to start filling. */
  startAt: number;
}

export const DEFAULT_LABEL_PDF_SETTINGS: LabelPdfSettings = {
  offsetXMm: 0,
  offsetYMm: 0,
  paddingMm: 2.5,
  barcodeHeightMm: 12,
  moduleMm: 0.25,
  startAt: 1,
};

export const LABEL_PDF_BOUNDS = {
  offsetXMm: { min: -10, max: 10, step: 0.1 },
  offsetYMm: { min: -10, max: 10, step: 0.1 },
  paddingMm: { min: 2, max: 3, step: 0.1 },
  barcodeHeightMm: { min: 10, max: 13, step: 0.5 },
  moduleMm: { min: 0.25, max: 0.5, step: 0.01 },
  startAt: { min: 1, max: 40, step: 1 },
} as const;

/** Barcode may sit closer to the die-cut than body text so it can fill the label. */
export const BARCODE_HORIZONTAL_INSET_MM = 1.5;

export const START_AT_MIN = LABEL_PDF_BOUNDS.startAt.min;
export const START_AT_MAX = LABEL_PDF_BOUNDS.startAt.max;

export class LabelPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelPdfError";
  }
}

export function parseStartAt(value: number): number {
  if (!Number.isFinite(value)) {
    throw new LabelPdfError(
      `Start at label must be a whole number from ${START_AT_MIN} to ${START_AT_MAX}.`,
    );
  }
  const startAt = Math.round(value);
  if (startAt < START_AT_MIN || startAt > START_AT_MAX) {
    throw new LabelPdfError(
      `Start at label must be between ${START_AT_MIN} and ${START_AT_MAX}.`,
    );
  }
  return startAt;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampPdfSettings(settings: LabelPdfSettings): LabelPdfSettings {
  const bounds = LABEL_PDF_BOUNDS;
  return {
    offsetXMm: clamp(settings.offsetXMm, bounds.offsetXMm.min, bounds.offsetXMm.max),
    offsetYMm: clamp(settings.offsetYMm, bounds.offsetYMm.min, bounds.offsetYMm.max),
    paddingMm: clamp(settings.paddingMm, bounds.paddingMm.min, bounds.paddingMm.max),
    barcodeHeightMm: clamp(
      settings.barcodeHeightMm,
      bounds.barcodeHeightMm.min,
      bounds.barcodeHeightMm.max,
    ),
    moduleMm: clamp(settings.moduleMm, bounds.moduleMm.min, bounds.moduleMm.max),
    startAt: Number.isFinite(settings.startAt) ? Math.round(settings.startAt) : START_AT_MIN,
  };
}

export interface LabelRectMm {
  xMm: number;
  yMmFromTop: number;
  widthMm: number;
  heightMm: number;
}

/** 1-based position on a 4×10 sheet, left-to-right then top-to-bottom. */
export function labelRectMm(
  position: number,
  settings: Pick<LabelPdfSettings, "offsetXMm" | "offsetYMm">,
  template: LabelPdfTemplate = A4_40_LABELS_52x29,
): LabelRectMm {
  const index = position - 1;
  const col = index % template.columns;
  const row = Math.floor(index / template.columns);
  return {
    xMm:
      template.leftMarginMm +
      settings.offsetXMm +
      col * (template.labelWidthMm + template.columnGapMm),
    yMmFromTop:
      template.topMarginMm +
      settings.offsetYMm +
      row * (template.labelHeightMm + template.rowGapMm),
    widthMm: template.labelWidthMm,
    heightMm: template.labelHeightMm,
  };
}

export function barcodeAvailableWidthMm(
  template: LabelPdfTemplate = A4_40_LABELS_52x29,
  paddingMm: number = DEFAULT_LABEL_PDF_SETTINGS.paddingMm,
): number {
  const inset = Math.min(paddingMm, BARCODE_HORIZONTAL_INSET_MM);
  return template.labelWidthMm - 2 * inset;
}

export interface LabelPdfProduct {
  code: string;
  nameZh: string | null;
  nameEn: string | null;
  dimensions: string | null;
}

/** Drops price, barcode column and other catalogue fields the PDF must not show. */
export function toLabelPdfProduct(product: {
  code: string;
  nameZh: string | null;
  nameEn: string | null;
  dimensions: string | null;
}): LabelPdfProduct {
  return {
    code: product.code,
    nameZh: product.nameZh,
    nameEn: product.nameEn,
    dimensions: product.dimensions,
  };
}

export interface LabelPageSlot<T> {
  position: number;
  product: T | null;
}

/**
 * Left-to-right, then top-to-bottom. `startAt` blanks that many positions on
 * the first page only so a partly used sheet can be reused.
 */
export function paginateLabelSlots<T>(
  products: T[],
  startAt: number,
  template: LabelPdfTemplate = A4_40_LABELS_52x29,
): LabelPageSlot<T>[][] {
  const perPage = labelsPerPage(template);
  const origin = parseStartAt(startAt);
  if (products.length === 0) return [];

  const pages: LabelPageSlot<T>[][] = [];
  let index = 0;

  const first: LabelPageSlot<T>[] = [];
  for (let position = 1; position <= perPage; position += 1) {
    if (position < origin || index >= products.length) {
      first.push({ position, product: null });
    } else {
      first.push({ position, product: products[index] });
      index += 1;
    }
  }
  pages.push(first);

  while (index < products.length) {
    const page: LabelPageSlot<T>[] = [];
    for (let position = 1; position <= perPage; position += 1) {
      if (index >= products.length) {
        page.push({ position, product: null });
      } else {
        page.push({ position, product: products[index] });
        index += 1;
      }
    }
    pages.push(page);
  }

  return pages;
}

export const LABEL_PDF_PRINT_INSTRUCTIONS = [
  "Load the A4 sticker sheet in the printer’s recommended label-paper tray",
  "Select A4 portrait",
  "Print at 100% / Actual size",
  "Disable Fit to page, Scale to fit and borderless enlargement",
  "First print the calibration PDF on ordinary A4 paper",
] as const;

export const LABEL_PDF_FONT_PUBLIC_PATH = "/fonts/NotoSansSC-Regular.ttf";
export const LABEL_PDF_FONT_DISK_PATH = "public/fonts/NotoSansSC-Regular.ttf";
export const LABEL_PDF_FONT_FAMILY = "Noto Sans SC";
export const LABEL_PDF_FONT_LICENSE = "SIL Open Font License 1.1";
export const LABEL_PDF_FONT_SOURCE =
  "Fontsource Noto Sans SC 400 chinese-simplified (Google Fonts / Adobe Source Han Sans)";
export const CALIBRATION_TEST_CODE = "K10188-13";
/** Longest typical Koei catalogue code in the current data set (9 characters). */
export const CALIBRATION_LONG_CODE = "K9426S-19";
export const PRODUCTION_PDF_SUBJECT = "PRODUCTION_LABELS";
export const CALIBRATION_PDF_SUBJECT = "CALIBRATION_SHEET";
