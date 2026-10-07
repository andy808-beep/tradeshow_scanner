import { zh } from "@/lib/i18n/zh-cn";
import { isCode39Compatible, QUIET_ZONE_MODULES } from "./code39";
import { code39ModuleCount } from "./code39-bars";

/**
 * Physical A4 sticker layout. Four 52.5 mm columns fill the 210 mm page,
 * and ten 29.7 mm rows fill the 297 mm page. Cells meet with no gap and no
 * page margin — that is the die-cut grid, and it does not move.
 *
 * Printers that cannot reach the sheet edge clip ink in the outer cells.
 * Barcode bars and text therefore stay inside a safe area inset from each
 * cell. Defaults are 4 mm left and right, 3 mm top, and 4 mm bottom.
 * Code 39 quiet zones are blank, so they may sit in the horizontal inset;
 * every black bar still stays inside the safe area.
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
  name: zh.labels.templateName,
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
  /**
   * Left and right inset of ink inside each label, millimetres.
   * Does not change the sticker cell.
   */
  safeInsetXMm: number;
  /**
   * Vertical content inset, millimetres. The bottom inset uses this value.
   * The top inset is 1 mm smaller and is never below 3 mm, so the default
   * of 4 mm is 3 mm at the top and 4 mm at the bottom.
   */
  safeInsetYMm: number;
  barcodeHeightMm: number;
  /** Preferred narrow-bar width, millimetres. Never drawn below 0.25 mm. */
  moduleMm: number;
  /** 1-based position on the first sheet to start filling. */
  startAt: number;
}

/** Left and right content inset. Also the minimum accepted horizontal setting. */
export const MIN_SAFE_INSET_X_MM = 4;
/** Bottom content inset when the vertical setting is at its default. */
export const MIN_SAFE_INSET_Y_MM = 4;
/** Top of every label keeps at least this much clear of the cell edge. */
export const MIN_CONTENT_TOP_MM = 3;
/** Bottom of every label, including glyph descenders, keeps at least this much clear. */
export const MIN_CONTENT_BOTTOM_MM = 4;
/** The top inset is this much tighter than {@link LabelPdfSettings.safeInsetYMm}. */
export const SAFE_TOP_RELIEF_MM = 1;

export const DEFAULT_LABEL_PDF_SETTINGS: LabelPdfSettings = {
  offsetXMm: 0,
  offsetYMm: 0,
  safeInsetXMm: MIN_SAFE_INSET_X_MM,
  safeInsetYMm: MIN_SAFE_INSET_Y_MM,
  barcodeHeightMm: 12,
  moduleMm: 0.25,
  startAt: 1,
};

export const LABEL_PDF_BOUNDS = {
  offsetXMm: { min: -10, max: 10, step: 0.1 },
  offsetYMm: { min: -10, max: 10, step: 0.1 },
  safeInsetXMm: { min: MIN_SAFE_INSET_X_MM, max: 6, step: 0.1 },
  safeInsetYMm: { min: MIN_SAFE_INSET_Y_MM, max: 6, step: 0.1 },
  barcodeHeightMm: { min: 10, max: 13, step: 0.5 },
  moduleMm: { min: 0.25, max: 0.5, step: 0.01 },
  startAt: { min: 1, max: 40, step: 1 },
} as const;

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
    safeInsetXMm: clamp(settings.safeInsetXMm, bounds.safeInsetXMm.min, bounds.safeInsetXMm.max),
    safeInsetYMm: clamp(settings.safeInsetYMm, bounds.safeInsetYMm.min, bounds.safeInsetYMm.max),
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

export interface SafeInsetsMm {
  leftMm: number;
  rightMm: number;
  topMm: number;
  bottomMm: number;
}

/**
 * Resolves the printer-safe insets inside one sticker.
 * Horizontal uses `safeInsetXMm` on both sides. Vertical uses `safeInsetYMm`
 * on the bottom; the top is 1 mm tighter and never below 3 mm.
 */
export function safeInsetsMm(
  settings: Pick<LabelPdfSettings, "safeInsetXMm" | "safeInsetYMm">,
): SafeInsetsMm {
  return {
    leftMm: settings.safeInsetXMm,
    rightMm: settings.safeInsetXMm,
    topMm: Math.max(MIN_CONTENT_TOP_MM, settings.safeInsetYMm - SAFE_TOP_RELIEF_MM),
    bottomMm: Math.max(MIN_CONTENT_BOTTOM_MM, settings.safeInsetYMm),
  };
}

/** Ink bounds inside a sticker cell. The cell rectangle itself is unchanged. */
export function contentSafeRectMm(
  rect: LabelRectMm,
  settings: Pick<LabelPdfSettings, "safeInsetXMm" | "safeInsetYMm">,
): LabelRectMm {
  const insets = safeInsetsMm(settings);
  return {
    xMm: rect.xMm + insets.leftMm,
    yMmFromTop: rect.yMmFromTop + insets.topMm,
    widthMm: Math.max(rect.widthMm - insets.leftMm - insets.rightMm, 0),
    heightMm: Math.max(rect.heightMm - insets.topMm - insets.bottomMm, 0),
  };
}

/**
 * First label, last label, and the other two corners. Calibration draws an
 * inner safe-area rectangle on these cells.
 */
export function calibrationSafeOutlinePositions(
  template: LabelPdfTemplate = A4_40_LABELS_52x29,
): number[] {
  const last = labelsPerPage(template);
  return [...new Set([1, template.columns, last - template.columns + 1, last])];
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

/**
 * Full Code 39 symbol width, quiet zones included, that keeps every black bar
 * inside the horizontal safe inset. Quiet zones may extend into that inset.
 * The symbol still stays inside the physical label.
 */
export function barcodeAvailableWidthMm(
  code: string,
  template: LabelPdfTemplate = A4_40_LABELS_52x29,
  settings: Pick<LabelPdfSettings, "safeInsetXMm" | "safeInsetYMm"> = DEFAULT_LABEL_PDF_SETTINGS,
): number {
  if (!isCode39Compatible(code)) return 0;
  const modules = code39ModuleCount(code);
  const blackModules = modules - 2 * QUIET_ZONE_MODULES;
  const { leftMm, rightMm } = safeInsetsMm(settings);
  const safeWidthMm = template.labelWidthMm - leftMm - rightMm;
  if (modules <= 0 || blackModules <= 0 || safeWidthMm <= 0) return 0;
  const byBlackBars = (modules / blackModules) * safeWidthMm;
  return Math.min(byBlackBars, template.labelWidthMm);
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

export const LABEL_PDF_PRINT_INSTRUCTIONS = zh.labels.instructions;
export const CALIBRATION_PAGE_NOTES = zh.labels.calibrationNotes;

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
