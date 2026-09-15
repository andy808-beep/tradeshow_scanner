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
import { code39BarRects, fitCode39ModuleMm } from "./code39-bars";
import {
  A4_21_LABELS_70x42,
  CALIBRATION_PDF_SUBJECT,
  CALIBRATION_TEST_CODE,
  clampPdfSettings,
  labelRectMm,
  mmToPt,
  paginateLabelSlots,
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
}

export interface LabelPdfPlan {
  mode: "production" | "calibration";
  templateName: string;
  pageWidthMm: number;
  pageHeightMm: number;
  pageCount: number;
  calibrationMarks: boolean;
  markTexts: string[];
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

function wrapText(text: string, font: PDFFont, sizePt: number, maxWidthPt: number): string[] {
  if (text === "") return [];
  const lines: string[] = [];
  let current = "";
  for (const character of text) {
    const next = current + character;
    if (font.widthOfTextAtSize(next, sizePt) <= maxWidthPt || current === "") {
      current = next;
      continue;
    }
    lines.push(current);
    current = character;
  }
  if (current) lines.push(current);
  return lines;
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

function drawBarcodeInLabel(
  page: PDFPage,
  pageHeightMm: number,
  code: string,
  content: LabelRectMm,
  settings: LabelPdfSettings,
  boxes: DrawnElementBox[],
): number {
  const moduleMm = fitCode39ModuleMm(code, settings.moduleMm, content.widthMm);
  const { widthMm, bars } = code39BarRects(code, moduleMm);
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

  return heightMm;
}

function drawProductLabel(
  page: PDFPage,
  pageHeightMm: number,
  font: PDFFont,
  product: LabelPdfProduct,
  rect: LabelRectMm,
  settings: LabelPdfSettings,
  boxes: DrawnElementBox[],
) {
  const content: LabelRectMm = {
    xMm: rect.xMm + settings.paddingMm,
    yMmFromTop: rect.yMmFromTop + settings.paddingMm,
    widthMm: Math.max(rect.widthMm - 2 * settings.paddingMm, 1),
    heightMm: Math.max(rect.heightMm - 2 * settings.paddingMm, 1),
  };

  clipToMm(page, pageHeightMm, rect);

  let cursorMm = content.yMmFromTop;
  if (isCode39Compatible(product.code)) {
    const barcodeHeight = drawBarcodeInLabel(
      page,
      pageHeightMm,
      product.code,
      content,
      settings,
      boxes,
    );
    cursorMm += barcodeHeight + 1.2;
  }

  const sizeCode = 8;
  const sizeZh = 9;
  const sizeEn = 7;
  const sizeDim = 7;
  const maxWidthPt = mmToPt(content.widthMm);
  const bottomLimit = content.yMmFromTop + content.heightMm;

  const writeBlock = (text: string | null, sizePt: number, gapMm: number, maxLines: number) => {
    if (!text) return;
    const lines = wrapText(text, font, sizePt, maxWidthPt).slice(0, maxLines);
    if (lines.length === maxLines) {
      const original = wrapText(text, font, sizePt, maxWidthPt);
      if (original.length > maxLines) {
        lines[maxLines - 1] = ellipsize(lines[maxLines - 1], font, sizePt, maxWidthPt);
      }
    }
    for (const line of lines) {
      const lineHeightMm = ptToMm(sizePt);
      if (cursorMm + lineHeightMm > bottomLimit + 0.01) return;
      drawTextMm(page, pageHeightMm, font, line, content.xMm, cursorMm, sizePt, boxes);
      cursorMm += lineHeightMm + gapMm;
    }
  };

  writeBlock(product.code, sizeCode, 0.4, 1);
  writeBlock(product.nameZh, sizeZh, 0.3, 2);
  writeBlock(product.nameEn, sizeEn, 0.3, 2);

  if (product.dimensions) {
    const lineHeightMm = ptToMm(sizeDim);
    const yMmFromTop = Math.min(
      bottomLimit - lineHeightMm,
      Math.max(cursorMm + 0.4, bottomLimit - lineHeightMm),
    );
    if (yMmFromTop + lineHeightMm <= rect.yMmFromTop + rect.heightMm + 0.01) {
      const line = ellipsize(product.dimensions, font, sizeDim, maxWidthPt);
      drawTextMm(page, pageHeightMm, font, line, content.xMm, yMmFromTop, sizeDim, boxes);
    }
  }

  unclip(page);
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
  template = A4_21_LABELS_70x42,
}: GenerateLabelPdfOptions): Promise<LabelPdfResult> {
  const settings = clampPdfSettings(rawSettings);
  const pages = paginateLabelSlots(products, settings.startAt, template);
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
      if (slot.product) {
        drawProductLabel(page, template.pageHeightMm, font, slot.product, rect, settings, boxes);
      }
      slots.push({
        pageIndex,
        position: slot.position,
        productCode: slot.product?.code ?? null,
        rect,
        boxes,
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
      slots,
    },
  };
}

export async function generateCalibrationLabelPdf({
  settings: rawSettings,
  fontBytes,
  template = A4_21_LABELS_70x42,
}: Omit<GenerateLabelPdfOptions, "products">): Promise<LabelPdfResult> {
  const settings = clampPdfSettings(rawSettings);
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

  for (let position = 1; position <= perPage; position += 1) {
    const rect = labelRectMm(position, settings, template);
    const boxes: DrawnElementBox[] = [];
    drawLabelOutline(page, template.pageHeightMm, rect);
    const label = String(position);
    const sizePt = 14;
    const textWidthMm = ptToMm(font.widthOfTextAtSize(label, sizePt));
    const xMm = rect.xMm + rect.widthMm - settings.paddingMm - textWidthMm;
    const yMmFromTop = rect.yMmFromTop + settings.paddingMm;
    drawTextMm(page, template.pageHeightMm, font, label, xMm, yMmFromTop, sizePt, boxes);

    if (position === 1) {
      const barcodeArea: LabelRectMm = {
        xMm: rect.xMm + settings.paddingMm,
        yMmFromTop: rect.yMmFromTop + settings.paddingMm + 8,
        widthMm: Math.max(rect.widthMm - 2 * settings.paddingMm, 1),
        heightMm: Math.max(rect.heightMm - 2 * settings.paddingMm - 8, 1),
      };
      clipToMm(page, template.pageHeightMm, rect);
      if (isCode39Compatible(CALIBRATION_TEST_CODE)) {
        const barcodeHeight = drawBarcodeInLabel(
          page,
          template.pageHeightMm,
          CALIBRATION_TEST_CODE,
          barcodeArea,
          settings,
          boxes,
        );
        drawTextMm(
          page,
          template.pageHeightMm,
          font,
          CALIBRATION_TEST_CODE,
          barcodeArea.xMm,
          barcodeArea.yMmFromTop + barcodeHeight + 1,
          8,
          boxes,
        );
      }
      unclip(page);
    }

    slots.push({
      pageIndex: 0,
      position,
      productCode: position === 1 ? CALIBRATION_TEST_CODE : null,
      rect,
      boxes,
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
      slots,
    },
  };
}
