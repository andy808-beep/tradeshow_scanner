import fontkit from "@pdf-lib/fontkit";
import {
  clip,
  endPath,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle as rectangleOp,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { isCode39Compatible } from "./code39";
import {
  code39BarRects,
  describeUnsafeBarcode,
  fitCode39ForLabel,
  MIN_NARROW_BAR_MM,
  type Code39LabelFit,
} from "./code39-bars";
import {
  A4_40_LABELS_52x29,
  barcodeAvailableWidthMm,
  CALIBRATION_LONG_CODE,
  CALIBRATION_PAGE_NOTES,
  CALIBRATION_PDF_SUBJECT,
  CALIBRATION_TEST_CODE,
  calibrationSafeOutlinePositions,
  clampPdfSettings,
  contentSafeRectMm,
  labelRectMm,
  mmToPt,
  paginateLabelSlots,
  parseStartAt,
  PRODUCTION_PDF_SUBJECT,
  ptToMm,
  type LabelPdfProduct,
  type LabelPdfSettings,
  type LabelPdfTemplate,
  type LabelRectMm,
} from "./label-pdf-template";

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

export interface DrawnElementBox {
  kind: "bar" | "text" | "safe-outline";
  xMm: number;
  yMmFromTop: number;
  widthMm: number;
  heightMm: number;
  text?: string;
}

export interface LabelSlotReport {
  pageIndex: number;
  position: number;
  productCode: string | null;
  rect: LabelRectMm;
  boxes: DrawnElementBox[];
  barcode?: {
    encodedValue: string;
    moduleMm: number;
    widthMm: number;
    quietZoneMm: number;
  };
}

export interface LabelPdfPlan {
  mode: "production" | "calibration";
  templateName: string;
  pageWidthMm: number;
  pageHeightMm: number;
  pageCount: number;
  calibrationMarks: boolean;
  markTexts: string[];
  skippedCodes: Array<{ code: string; message: string }>;
  slots: LabelSlotReport[];
}

export interface LabelPdfResult {
  bytes: Uint8Array;
  plan: LabelPdfPlan;
}

export interface GenerateLabelPdfOptions {
  products: LabelPdfProduct[];
  settings: LabelPdfSettings;
  fontBytes: Uint8Array;
  template?: LabelPdfTemplate;
}

function clipToMm(page: PDFPage, pageHeightMm: number, rect: LabelRectMm) {
  const x = mmToPt(rect.xMm);
  const y = mmToPt(pageHeightMm - rect.yMmFromTop - rect.heightMm);
  const width = mmToPt(rect.widthMm);
  const height = mmToPt(rect.heightMm);
  page.pushOperators(
    pushGraphicsState(),
    rectangleOp(x, y, width, height),
    clip(),
    endPath(),
  );
}

function unclip(page: PDFPage) {
  page.pushOperators(popGraphicsState());
}

/** Preferred sizes, then the smallest size that stays readable on a 29.7 mm label. */
const LABEL_FONT_PT = {
  code: { preferred: 7, min: 6 },
  name: { preferred: 6.5, min: 5.5 },
  dimensions: { preferred: 5.5, min: 5 },
} as const;

/** Shorter bars are not reliably scannable on these labels. */
const MIN_DRAW_BARCODE_HEIGHT_MM = 8;
const GAP_AFTER_BARCODE_MM = 0.3;
const LINE_GAP_MM = 0.1;

function ellipsize(text: string, font: PDFFont, sizePt: number, maxWidthPt: number): string {
  if (maxWidthPt <= 0) return "";
  if (font.widthOfTextAtSize(text, sizePt) <= maxWidthPt) return text;
  const ellipsis = "…";
  if (font.widthOfTextAtSize(ellipsis, sizePt) > maxWidthPt) return "";
  let cut = text;
  while (cut.length > 0 && font.widthOfTextAtSize(cut + ellipsis, sizePt) > maxWidthPt) {
    cut = cut.slice(0, -1);
  }
  return cut.length === 0 ? ellipsis : cut + ellipsis;
}

function splitLines(
  text: string,
  font: PDFFont,
  sizePt: number,
  maxWidthPt: number,
  maxLines: number,
): string[] {
  if (maxLines <= 0 || text === "" || maxWidthPt <= 0) return [];
  const lines: string[] = [];
  let rest = text;
  while (rest.length > 0 && lines.length < maxLines) {
    if (font.widthOfTextAtSize(rest, sizePt) <= maxWidthPt) {
      lines.push(rest);
      break;
    }
    if (lines.length === maxLines - 1) {
      const last = ellipsize(rest, font, sizePt, maxWidthPt);
      if (last) lines.push(last);
      break;
    }
    let cut = rest.length;
    while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), sizePt) > maxWidthPt) {
      cut -= 1;
    }
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return lines;
}

function glyphMetrics(font: PDFFont, sizePt: number): {
  ascentPt: number;
  descentPt: number;
  heightPt: number;
} {
  const heightPt = font.heightAtSize(sizePt, { descender: true });
  const ascentPt = font.heightAtSize(sizePt, { descender: false });
  const descentPt = Math.max(0, heightPt - ascentPt);
  return { ascentPt, descentPt, heightPt: ascentPt + descentPt };
}

function lineHeightMm(font: PDFFont, sizePt: number): number {
  return ptToMm(glyphMetrics(font, sizePt).heightPt);
}

function descendingSizes(preferred: number, min: number, step: number): number[] {
  const sizes: number[] = [];
  for (let size = preferred; size >= min - 1e-9; size -= step) {
    sizes.push(Math.round(size * 10) / 10);
  }
  return sizes;
}

function barcodeHeightSteps(preferred: number): number[] {
  const heights: number[] = [];
  for (let height = preferred; height >= MIN_DRAW_BARCODE_HEIGHT_MM - 1e-9; height -= 0.5) {
    heights.push(Math.round(height * 10) / 10);
  }
  return heights;
}

function drawTextMm(
  page: PDFPage,
  pageHeightMm: number,
  font: PDFFont,
  text: string,
  xMm: number,
  yMmFromTop: number,
  sizePt: number,
  boxes: DrawnElementBox[],
) {
  if (!text) return;
  const metrics = glyphMetrics(font, sizePt);
  boxes.push({
    kind: "text",
    xMm,
    yMmFromTop,
    widthMm: ptToMm(font.widthOfTextAtSize(text, sizePt)),
    heightMm: ptToMm(metrics.heightPt),
    text,
  });
  page.drawText(text, {
    x: mmToPt(xMm),
    y: mmToPt(pageHeightMm - yMmFromTop) - metrics.ascentPt,
    size: sizePt,
    font,
    color: BLACK,
  });
}

export function barcodeFitForProduct(
  code: string,
  settings: LabelPdfSettings,
  template: LabelPdfTemplate = A4_40_LABELS_52x29,
): Code39LabelFit {
  const availableWidthMm = isCode39Compatible(code)
    ? barcodeAvailableWidthMm(code, template, settings)
    : 0;
  if (!isCode39Compatible(code)) {
    return {
      ok: false,
      code,
      requiredWidthMm: 0,
      availableWidthMm,
      minModuleMm: MIN_NARROW_BAR_MM,
    };
  }
  return fitCode39ForLabel(code, availableWidthMm, settings.moduleMm, MIN_NARROW_BAR_MM);
}

function drawBarcodeInLabel(
  page: PDFPage,
  pageHeightMm: number,
  code: string,
  safe: LabelRectMm,
  label: LabelRectMm,
  settings: LabelPdfSettings,
  template: LabelPdfTemplate,
  yMmFromTop: number,
  heightMm: number,
  boxes: DrawnElementBox[],
): { heightMm: number; fit: Extract<Code39LabelFit, { ok: true }> } | null {
  const fit = fitCode39ForLabel(
    code,
    barcodeAvailableWidthMm(code, template, settings),
    settings.moduleMm,
    MIN_NARROW_BAR_MM,
  );
  if (!fit.ok) return null;

  const drawnHeight = Math.min(heightMm, safe.yMmFromTop + safe.heightMm - yMmFromTop);
  if (drawnHeight < MIN_DRAW_BARCODE_HEIGHT_MM - 0.01) return null;

  const { widthMm, bars } = code39BarRects(code, fit.moduleMm);
  const blackWidth = widthMm - 2 * fit.quietZoneMm;
  let xBlack = safe.xMm + (safe.widthMm - blackWidth) / 2;
  let xSymbol = xBlack - fit.quietZoneMm;
  const labelLeft = label.xMm;
  const labelRight = label.xMm + label.widthMm;
  if (xSymbol < labelLeft) {
    xBlack += labelLeft - xSymbol;
    xSymbol = labelLeft;
  }
  if (xSymbol + widthMm > labelRight) {
    const shift = xSymbol + widthMm - labelRight;
    xSymbol -= shift;
    xBlack -= shift;
  }

  const barcodeBottomMm = pageHeightMm - yMmFromTop - drawnHeight;
  for (const bar of bars) {
    const barX = xSymbol + bar.x;
    boxes.push({
      kind: "bar",
      xMm: barX,
      yMmFromTop,
      widthMm: bar.width,
      heightMm: drawnHeight,
    });
    page.drawRectangle({
      x: mmToPt(barX),
      y: mmToPt(barcodeBottomMm),
      width: mmToPt(bar.width),
      height: mmToPt(drawnHeight),
      color: BLACK,
      borderWidth: 0,
    });
  }

  return { heightMm: drawnHeight, fit: { ...fit, widthMm } };
}

interface TextRun {
  text: string;
  sizePt: number;
  role: "code" | "name" | "dimensions";
}

function layoutLines(
  font: PDFFont,
  product: LabelPdfProduct,
  widthMm: number,
  codePt: number,
  namePt: number,
  dimPt: number,
  nameLineCount: number,
): TextRun[] {
  const maxWidthPt = mmToPt(widthMm);
  const lines: TextRun[] = [];
  const code = ellipsize(product.code, font, codePt, maxWidthPt);
  if (code) lines.push({ text: code, sizePt: codePt, role: "code" });
  if (product.nameZh) {
    for (const text of splitLines(product.nameZh, font, namePt, maxWidthPt, nameLineCount)) {
      lines.push({ text, sizePt: namePt, role: "name" });
    }
  }
  if (product.dimensions) {
    const dimensions = ellipsize(product.dimensions, font, dimPt, maxWidthPt);
    if (dimensions) lines.push({ text: dimensions, sizePt: dimPt, role: "dimensions" });
  }
  return lines;
}

function layoutHeightMm(font: PDFFont, barcodeHeightMm: number, lines: TextRun[]): number {
  let height = barcodeHeightMm;
  if (lines.length > 0) height += GAP_AFTER_BARCODE_MM;
  lines.forEach((line, index) => {
    height += lineHeightMm(font, line.sizePt);
    if (index < lines.length - 1) height += LINE_GAP_MM;
  });
  return height;
}

function chooseContentLayout(
  font: PDFFont,
  product: LabelPdfProduct,
  safe: LabelRectMm,
  settings: LabelPdfSettings,
): { barcodeHeightMm: number; lines: TextRun[] } {
  const fits = (barcodeHeightMm: number, lines: TextRun[]) =>
    layoutHeightMm(font, barcodeHeightMm, lines) <= safe.heightMm + 0.05;

  let fallback: { barcodeHeightMm: number; lines: TextRun[] } | null = null;
  for (const barcodeHeightMm of barcodeHeightSteps(settings.barcodeHeightMm)) {
    for (const codePt of descendingSizes(LABEL_FONT_PT.code.preferred, LABEL_FONT_PT.code.min, 0.5)) {
      for (const namePt of descendingSizes(LABEL_FONT_PT.name.preferred, LABEL_FONT_PT.name.min, 0.5)) {
        for (const dimPt of descendingSizes(
          LABEL_FONT_PT.dimensions.preferred,
          LABEL_FONT_PT.dimensions.min,
          0.5,
        )) {
          const lines = layoutLines(font, product, safe.widthMm, codePt, namePt, dimPt, 1);
          fallback = { barcodeHeightMm, lines };
          if (!fits(barcodeHeightMm, lines)) continue;
          if (product.nameZh) {
            const wrapped = layoutLines(font, product, safe.widthMm, codePt, namePt, dimPt, 2);
            const drawnName = lines
              .filter((line) => line.role === "name")
              .map((line) => line.text)
              .join("");
            if (drawnName !== product.nameZh && fits(barcodeHeightMm, wrapped)) {
              return { barcodeHeightMm, lines: wrapped };
            }
          }
          return { barcodeHeightMm, lines };
        }
      }
    }
  }
  return (
    fallback ?? {
      barcodeHeightMm: MIN_DRAW_BARCODE_HEIGHT_MM,
      lines: layoutLines(
        font,
        product,
        safe.widthMm,
        LABEL_FONT_PT.code.min,
        LABEL_FONT_PT.name.min,
        LABEL_FONT_PT.dimensions.min,
        1,
      ),
    }
  );
}

function drawProductLabel(
  page: PDFPage,
  pageHeightMm: number,
  font: PDFFont,
  product: LabelPdfProduct,
  rect: LabelRectMm,
  settings: LabelPdfSettings,
  template: LabelPdfTemplate,
  boxes: DrawnElementBox[],
): LabelSlotReport["barcode"] {
  const safe = contentSafeRectMm(rect, settings);
  const layout = chooseContentLayout(font, product, safe, settings);
  const limit = safe.yMmFromTop + safe.heightMm;
  let barcodeMeta: LabelSlotReport["barcode"];

  clipToMm(page, pageHeightMm, rect);
  try {
    let cursorMm = safe.yMmFromTop;
    if (isCode39Compatible(product.code)) {
      const drawn = drawBarcodeInLabel(
        page,
        pageHeightMm,
        product.code,
        safe,
        rect,
        settings,
        template,
        cursorMm,
        layout.barcodeHeightMm,
        boxes,
      );
      if (drawn) {
        barcodeMeta = {
          encodedValue: product.code,
          moduleMm: drawn.fit.moduleMm,
          widthMm: drawn.fit.widthMm,
          quietZoneMm: drawn.fit.quietZoneMm,
        };
        cursorMm += drawn.heightMm + GAP_AFTER_BARCODE_MM;
      }
    }

    for (let index = 0; index < layout.lines.length; index += 1) {
      const line = layout.lines[index];
      const heightMm = lineHeightMm(font, line.sizePt);
      if (cursorMm + heightMm > limit + 0.05) break;
      drawTextMm(page, pageHeightMm, font, line.text, safe.xMm, cursorMm, line.sizePt, boxes);
      cursorMm += heightMm;
      if (index < layout.lines.length - 1) cursorMm += LINE_GAP_MM;
    }
  } finally {
    unclip(page);
  }

  return barcodeMeta;
}

function drawCalibrationMarks(
  page: PDFPage,
  font: PDFFont,
  template: LabelPdfTemplate,
  boxes: DrawnElementBox[],
) {
  const pageHeightMm = template.pageHeightMm;

  for (let mm = 0; mm <= template.pageWidthMm; mm += 1) {
    const tick = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.2;
    page.drawLine({
      start: { x: mmToPt(mm), y: mmToPt(pageHeightMm) },
      end: { x: mmToPt(mm), y: mmToPt(pageHeightMm - tick) },
      thickness: mmToPt(0.15),
      color: BLACK,
    });
    if (mm % 10 === 0 && mm > 0) {
      drawTextMm(
        page,
        pageHeightMm,
        font,
        `${mm} mm`,
        mm + 0.4,
        1.6,
        6,
        boxes,
      );
    }
  }

  for (let mm = 0; mm <= template.pageHeightMm; mm += 1) {
    const tick = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.2;
    const y = mmToPt(pageHeightMm - mm);
    page.drawLine({
      start: { x: 0, y },
      end: { x: mmToPt(tick), y },
      thickness: mmToPt(0.15),
      color: BLACK,
    });
    if (mm % 10 === 0 && mm > 0) {
      drawTextMm(page, pageHeightMm, font, `${mm} mm`, 4.2, mm, 6, boxes);
    }
  }
  if (template.pageHeightMm % 10 !== 0) {
    drawTextMm(
      page,
      pageHeightMm,
      font,
      `${template.pageHeightMm} mm`,
      4.2,
      template.pageHeightMm - 3.2,
      6,
      boxes,
    );
  }
}

function drawLabelOutline(page: PDFPage, pageHeightMm: number, rect: LabelRectMm) {
  page.drawRectangle({
    x: mmToPt(rect.xMm),
    y: mmToPt(pageHeightMm - rect.yMmFromTop - rect.heightMm),
    width: mmToPt(rect.widthMm),
    height: mmToPt(rect.heightMm),
    borderColor: BLACK,
    borderWidth: mmToPt(0.25),
  });
}

function drawSafeAreaOutline(
  page: PDFPage,
  pageHeightMm: number,
  safe: LabelRectMm,
  boxes: DrawnElementBox[],
) {
  const strokeMm = 0.3;
  const inset = strokeMm / 2;
  boxes.push({
    kind: "safe-outline",
    xMm: safe.xMm,
    yMmFromTop: safe.yMmFromTop,
    widthMm: safe.widthMm,
    heightMm: safe.heightMm,
  });
  page.drawRectangle({
    x: mmToPt(safe.xMm + inset),
    y: mmToPt(pageHeightMm - safe.yMmFromTop - safe.heightMm + inset),
    width: mmToPt(Math.max(safe.widthMm - strokeMm, 0)),
    height: mmToPt(Math.max(safe.heightMm - strokeMm, 0)),
    borderColor: BLACK,
    borderWidth: mmToPt(strokeMm),
  });
}

async function createDocument(
  fontBytes: Uint8Array,
  template: LabelPdfTemplate,
  subject: string,
  title: string,
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  pdf.setTitle(title);
  pdf.setAuthor("Koei Porcelain");
  pdf.setSubject(subject);
  pdf.setCreator("tradeshow_scanner");
  pdf.setKeywords([subject, template.name]);
  return { pdf, font };
}

function addA4Page(pdf: PDFDocument, template: LabelPdfTemplate): PDFPage {
  return pdf.addPage([mmToPt(template.pageWidthMm), mmToPt(template.pageHeightMm)]);
}

export async function generateProductionLabelPdf({
  products,
  settings: rawSettings,
  fontBytes,
  template = A4_40_LABELS_52x29,
}: GenerateLabelPdfOptions): Promise<LabelPdfResult> {
  parseStartAt(rawSettings.startAt);
  const settings = { ...clampPdfSettings(rawSettings), startAt: parseStartAt(rawSettings.startAt) };
  const skippedCodes: Array<{ code: string; message: string }> = [];
  const printable: LabelPdfProduct[] = [];
  for (const product of products) {
    const fit = barcodeFitForProduct(product.code, settings, template);
    if (!fit.ok) {
      skippedCodes.push({
        code: product.code,
        message: describeUnsafeBarcode(product.code, fit.minModuleMm),
      });
      continue;
    }
    printable.push(product);
  }

  const pages = paginateLabelSlots(printable, settings.startAt, template);
  const { pdf, font } = await createDocument(
    fontBytes,
    template,
    PRODUCTION_PDF_SUBJECT,
    `Koei 产品标签 — ${template.name}`,
  );

  const slots: LabelSlotReport[] = [];

  for (const [pageIndex, pageSlots] of pages.entries()) {
    const page = addA4Page(pdf, template);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: mmToPt(template.pageWidthMm),
      height: mmToPt(template.pageHeightMm),
      color: WHITE,
      borderWidth: 0,
    });

    for (const slot of pageSlots) {
      const rect = labelRectMm(slot.position, settings, template);
      const boxes: DrawnElementBox[] = [];
      let barcode: LabelSlotReport["barcode"];
      if (slot.product) {
        barcode = drawProductLabel(
          page,
          template.pageHeightMm,
          font,
          slot.product,
          rect,
          settings,
          template,
          boxes,
        );
      }
      slots.push({
        pageIndex,
        position: slot.position,
        productCode: slot.product?.code ?? null,
        rect,
        boxes,
        barcode,
      });
    }
  }

  return {
    bytes: await pdf.save(),
    plan: {
      mode: "production",
      templateName: template.name,
      pageWidthMm: template.pageWidthMm,
      pageHeightMm: template.pageHeightMm,
      pageCount: pdf.getPageCount(),
      calibrationMarks: false,
      markTexts: [],
      skippedCodes,
      slots,
    },
  };
}

export async function generateCalibrationLabelPdf({
  settings: rawSettings,
  fontBytes,
  template = A4_40_LABELS_52x29,
}: Omit<GenerateLabelPdfOptions, "products">): Promise<LabelPdfResult> {
  parseStartAt(rawSettings.startAt);
  const settings = { ...clampPdfSettings(rawSettings), startAt: parseStartAt(rawSettings.startAt) };
  const { pdf, font } = await createDocument(
    fontBytes,
    template,
    CALIBRATION_PDF_SUBJECT,
    `Koei 标签校准 — ${template.name}`,
  );
  const page = addA4Page(pdf, template);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: mmToPt(template.pageWidthMm),
    height: mmToPt(template.pageHeightMm),
    color: WHITE,
    borderWidth: 0,
  });

  const markBoxes: DrawnElementBox[] = [];
  drawCalibrationMarks(page, font, template, markBoxes);

  const slots: LabelSlotReport[] = [];
  const perPage = template.columns * template.rows;
  const sampleCodes: Record<number, string> = {
    1: CALIBRATION_TEST_CODE,
    2: CALIBRATION_LONG_CODE,
  };
  const outlinePositions = new Set(calibrationSafeOutlinePositions(template));
  const notePositions = [14, 15, 18, 19];

  for (let position = 1; position <= perPage; position += 1) {
    const rect = labelRectMm(position, settings, template);
    const safe = contentSafeRectMm(rect, settings);
    const boxes: DrawnElementBox[] = [];
    drawLabelOutline(page, template.pageHeightMm, rect);

    const indexPt = 7;
    const indexHeightMm = lineHeightMm(font, indexPt);
    const indexText = String(position);
    const indexWidthMm = ptToMm(font.widthOfTextAtSize(indexText, indexPt));
    clipToMm(page, template.pageHeightMm, rect);
    drawTextMm(
      page,
      template.pageHeightMm,
      font,
      indexText,
      safe.xMm + safe.widthMm - indexWidthMm,
      safe.yMmFromTop,
      indexPt,
      boxes,
    );

    const sampleCode = sampleCodes[position];
    let barcode: LabelSlotReport["barcode"];
    let cursorMm = safe.yMmFromTop + indexHeightMm + GAP_AFTER_BARCODE_MM;
    const limit = safe.yMmFromTop + safe.heightMm;
    if (sampleCode && isCode39Compatible(sampleCode)) {
      const samplePt = 6;
      const sampleHeightMm = lineHeightMm(font, samplePt);
      const barcodeHeightMm = Math.min(
        settings.barcodeHeightMm,
        limit - cursorMm - GAP_AFTER_BARCODE_MM - sampleHeightMm,
      );
      const drawn = drawBarcodeInLabel(
        page,
        template.pageHeightMm,
        sampleCode,
        safe,
        rect,
        settings,
        template,
        cursorMm,
        barcodeHeightMm,
        boxes,
      );
      if (drawn) {
        barcode = {
          encodedValue: sampleCode,
          moduleMm: drawn.fit.moduleMm,
          widthMm: drawn.fit.widthMm,
          quietZoneMm: drawn.fit.quietZoneMm,
        };
        cursorMm += drawn.heightMm + GAP_AFTER_BARCODE_MM;
        if (cursorMm + sampleHeightMm <= limit + 0.05) {
          const sample = ellipsize(sampleCode, font, samplePt, mmToPt(safe.widthMm));
          drawTextMm(
            page,
            template.pageHeightMm,
            font,
            sample,
            safe.xMm,
            cursorMm,
            samplePt,
            boxes,
          );
        }
      }
    }

    const noteIndex = notePositions.indexOf(position);
    const note = noteIndex === -1 ? undefined : CALIBRATION_PAGE_NOTES[noteIndex];
    if (note) {
      const notePt = 6;
      const noteHeightMm = lineHeightMm(font, notePt);
      let noteCursor = safe.yMmFromTop + indexHeightMm + LINE_GAP_MM;
      for (const line of splitLines(note, font, notePt, mmToPt(safe.widthMm), 4)) {
        if (noteCursor + noteHeightMm > limit + 0.05) break;
        drawTextMm(
          page,
          template.pageHeightMm,
          font,
          line,
          safe.xMm,
          noteCursor,
          notePt,
          boxes,
        );
        markBoxes.push(boxes[boxes.length - 1]);
        noteCursor += noteHeightMm + LINE_GAP_MM;
      }
    }
    unclip(page);

    if (outlinePositions.has(position)) {
      drawSafeAreaOutline(page, template.pageHeightMm, safe, boxes);
    }

    slots.push({
      pageIndex: 0,
      position,
      productCode: sampleCode ?? null,
      rect,
      boxes,
      barcode,
    });
  }

  return {
    bytes: await pdf.save(),
    plan: {
      mode: "calibration",
      templateName: template.name,
      pageWidthMm: template.pageWidthMm,
      pageHeightMm: template.pageHeightMm,
      pageCount: 1,
      calibrationMarks: true,
      markTexts: markBoxes
        .map((box) => box.text)
        .filter((text): text is string => Boolean(text)),
      skippedCodes: [],
      slots,
    },
  };
}
