import type { InquiryLine } from "./types";

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 9999;

export interface InquiryTotals {
  lineCount: number;
  totalQuantity: number;
  /**
   * Sum of quantity × quoted price. Every line contributes once the inquiry is
   * submittable, because a line without a price now blocks submission.
   */
  quotedTotal: number;
  /** Lines with no quoted price yet. Must be zero before saving. */
  unpricedLineCount: number;
}

export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return MIN_QUANTITY;
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, Math.floor(quantity)));
}

/**
 * A quoted price is valid only as a finite, non-negative number. Zero counts,
 * so a deliberate free-of-charge sample is accepted; `null` does not, because
 * "no price entered" is not the same decision as "priced at nothing".
 */
export function isValidQuotedPrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isLinePriced(line: InquiryLine): boolean {
  return isValidQuotedPrice(line.quotedUnitPrice);
}

/** True when every line carries a valid price, i.e. the inquiry can be saved. */
export function allLinesPriced(lines: InquiryLine[]): boolean {
  return lines.every(isLinePriced);
}

export function lineTotal(line: InquiryLine): number | null {
  if (!isValidQuotedPrice(line.quotedUnitPrice)) return null;
  return line.quantity * line.quotedUnitPrice;
}

export function calculateTotals(lines: InquiryLine[]): InquiryTotals {
  return lines.reduce<InquiryTotals>(
    (totals, line) => {
      const total = lineTotal(line);
      return {
        lineCount: totals.lineCount + 1,
        totalQuantity: totals.totalQuantity + line.quantity,
        quotedTotal: totals.quotedTotal + (total ?? 0),
        unpricedLineCount: totals.unpricedLineCount + (total === null ? 1 : 0),
      };
    },
    { lineCount: 0, totalQuantity: 0, quotedTotal: 0, unpricedLineCount: 0 },
  );
}

/** Keeps a price field to digits and a single decimal point while typing. */
export function sanitizeDecimalInput(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return (
    cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "")
  );
}

/**
 * Parses a price typed at the booth. An empty field means "not quoted yet"
 * rather than zero, so it stays Pending.
 */
export function parsePriceInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}
