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
  CALIBRATION_PDF_SUBJECT,
  CALIBRATION_TEST_CODE,
  clampPdfSettings,
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
  kind: "bar" | "text";
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

function ellipsize(text: string, font: PDFFont, sizePt: number, maxWidthPt: number): string {
  if (font.widthOfTextAtSize(text, sizePt) <= maxWidthPt) return text;
  const ellipsis = "…";
  let cut = text;
  while (cut.length > 0 && font.widthOfTextAtSize(cut + ellipsis, sizePt) > maxWidthPt) {
    cut = cut.slice(0, -1);
  }
  return cut.length === 0 ? ellipsis : cut + ellipsis;
}

function recordText(
  boxes: DrawnElementBox[],
  font: PDFFont,
  text: string,
  xMm: number,
  yMmFromTop: number,
  sizePt: number,
): DrawnElementBox {
  const box: DrawnElementBox = {
    kind: "text",
    xMm,
    yMmFromTop,
    widthMm: ptToMm(font.widthOfTextAtSize(text, sizePt)),
    heightMm: ptToMm(sizePt),
    text,
  };
  boxes.push(box);
  return box;
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
  recordText(boxes, font, text, xMm, yMmFromTop, sizePt);
  page.drawText(text, {
    x: mmToPt(xMm),
    y: mmToPt(pageHeightMm - yMmFromTop) - sizePt,
    size: sizePt,
    font,
    color: BLACK,
  });
}

function barcodeAreaForLabel(
  rect: LabelRectMm,
  paddingMm: number,
  template: LabelPdfTemplate,
): LabelRectMm {
  const inset = (template.labelWidthMm - barcodeAvailableWidthMm(template, paddingMm)) / 2;
  return {
    xMm: rect.xMm + inset,
    yMmFromTop: rect.yMmFromTop + Math.min(paddingMm, 1.2),
    widthMm: barcodeAvailableWidthMm(template, paddingMm),
    heightMm: rect.heightMm,
  };
}

export function barcodeFitForProduct(
  code: string,
  settings: LabelPdfSettings,
  template: LabelPdfTemplate = A4_40_LABELS_52x29,
): Code39LabelFit {
  if (!isCode39Compatible(code)) {
    return {
      ok: false,
      code,
      requiredWidthMm: 0,
      availableWidthMm: barcodeAvailableWidthMm(template, settings.paddingMm),
      minModuleMm: MIN_NARROW_BAR_MM,
    };
  }
  return fitCode39ForLabel(
    code,
    barcodeAvailableWidthMm(template, settings.paddingMm),
    settings.moduleMm,
    MIN_NARROW_BAR_MM,
  );
}

function drawBarcodeInLabel(
  page: PDFPage,
  pageHeightMm: number,
  code: string,
  content: LabelRectMm,
  settings: LabelPdfSettings,
  boxes: DrawnElementBox[],
): { heightMm: number; fit: Extract<Code39LabelFit, { ok: true }> } | null {
  const fit = fitCode39ForLabel(code, content.widthMm, settings.moduleMm, MIN_NARROW_BAR_MM);
  if (!fit.ok) return null;

  const { widthMm, bars } = code39BarRects(code, fit.moduleMm);
  const heightMm = Math.min(settings.barcodeHeightMm, content.heightMm);
  const xMm = content.xMm + (content.widthMm - widthMm) / 2;
  const yMmFromTop = content.yMmFromTop;
  const barcodeBottomMm = pageHeightMm - yMmFromTop - heightMm;

  for (const bar of bars) {
    const barX = xMm + bar.x;
    boxes.push({
      kind: "bar",
      xMm: barX,
      yMmFromTop,
      widthMm: bar.width,
      heightMm,
    });
    page.drawRectangle({
      x: mmToPt(barX),
      y: mmToPt(barcodeBottomMm),
      width: mmToPt(bar.width),
      height: mmToPt(heightMm),
      color: BLACK,
      borderWidth: 0,
    });
  }

  return { heightMm, fit: { ...fit, widthMm } };
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
  const textPad = settings.paddingMm;
  const content: LabelRectMm = {
    xMm: rect.xMm + textPad,
    yMmFromTop: rect.yMmFromTop + textPad,
    widthMm: Math.max(rect.widthMm - 2 * textPad, 1),
    heightMm: Math.max(rect.heightMm - 2 * textPad, 1),
  };

  clipToMm(page, pageHeightMm, rect);

  let cursorMm = content.yMmFromTop;
  let barcodeMeta: LabelSlotReport["barcode"];
  const barcodeBox = barcodeAreaForLabel(rect, settings.paddingMm, template);
  barcodeBox.heightMm = Math.min(settings.barcodeHeightMm, content.heightMm);
  barcodeBox.yMmFromTop = content.yMmFromTop;

  if (isCode39Compatible(product.code)) {
    const drawn = drawBarcodeInLabel(
      page,
      pageHeightMm,
      product.code,
      barcodeBox,
      settings,
      boxes,
    );
    if (drawn) {
      barcodeMeta = {
        encodedValue: product.code,
        moduleMm: drawn.fit.moduleMm,
        widthMm: drawn.fit.widthMm,
        quietZoneMm: drawn.fit.quietZoneMm,
      };
      cursorMm += drawn.heightMm + 0.6;
    }
  }

  const sizeCode = 7;
  const sizeZh = 6.5;
  const sizeDim = 5.5;
  const maxWidthPt = mmToPt(content.widthMm);
  const bottomLimit = content.yMmFromTop + content.heightMm;

  const writeLine = (text: string | null, sizePt: number, gapMm: number) => {
    if (!text) return;
    const line = ellipsize(text, font, sizePt, maxWidthPt);
    const lineHeightMm = ptToMm(sizePt);
    if (cursorMm + lineHeightMm > bottomLimit + 0.01) return;
    drawTextMm(page, pageHeightMm, font, line, content.xMm, cursorMm, sizePt, boxes);
    cursorMm += lineHeightMm + gapMm;
  };

  writeLine(product.code, sizeCode, 0.25);
  writeLine(product.nameZh, sizeZh, 0.2);

  if (product.dimensions) {
    const lineHeightMm = ptToMm(sizeDim);
    const yMmFromTop = Math.min(
      bottomLimit - lineHeightMm,
      Math.max(cursorMm + 0.2, bottomLimit - lineHeightMm),
    );
    if (yMmFromTop + lineHeightMm <= rect.yMmFromTop + rect.heightMm + 0.01) {
      const line = ellipsize(product.dimensions, font, sizeDim, maxWidthPt);
      drawTextMm(page, pageHeightMm, font, line, content.xMm, yMmFromTop, sizeDim, boxes);
    }
  }

  unclip(page);
  return barcodeMeta;
}

function drawCalibrationMarks(
  page: PDFPage,
  font: PDFFont,
  template: LabelPdfTemplate,
  boxes: DrawnElementBox[],
) {
  const pageHeightMm = template.pageHeightMm;
  const title = "Calibration sheet — print at 100% / Actual size";
  drawTextMm(page, pageHeightMm, font, title, 4, 1.2, 7, boxes);

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
    `Koei barcode labels — ${template.name}`,
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
    `Koei label calibration — ${template.name}`,
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

  for (let position = 1; position <= perPage; position += 1) {
    const rect = labelRectMm(position, settings, template);
    const boxes: DrawnElementBox[] = [];
    drawLabelOutline(page, template.pageHeightMm, rect);
    const label = String(position);
    const sizePt = 7;
    const textWidthMm = ptToMm(font.widthOfTextAtSize(label, sizePt));
    const xMm = rect.xMm + rect.widthMm - 1.2 - textWidthMm;
    const yMmFromTop = rect.yMmFromTop + 0.8;
    drawTextMm(page, template.pageHeightMm, font, label, xMm, yMmFromTop, sizePt, boxes);

    const sampleCode = sampleCodes[position];
    let barcode: LabelSlotReport["barcode"];
    if (sampleCode && isCode39Compatible(sampleCode)) {
      const barcodeBox = barcodeAreaForLabel(rect, settings.paddingMm, template);
      barcodeBox.yMmFromTop = rect.yMmFromTop + 4;
      barcodeBox.heightMm = Math.min(settings.barcodeHeightMm, rect.heightMm - 8);
      clipToMm(page, template.pageHeightMm, rect);
      const drawn = drawBarcodeInLabel(
        page,
        template.pageHeightMm,
        sampleCode,
        barcodeBox,
        settings,
        boxes,
      );
      if (drawn) {
        barcode = {
          encodedValue: sampleCode,
          moduleMm: drawn.fit.moduleMm,
          widthMm: drawn.fit.widthMm,
          quietZoneMm: drawn.fit.quietZoneMm,
        };
        drawTextMm(
          page,
          template.pageHeightMm,
          font,
          sampleCode,
          rect.xMm + settings.paddingMm,
          barcodeBox.yMmFromTop + drawn.heightMm + 0.4,
          6,
          boxes,
        );
      }
      unclip(page);
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
