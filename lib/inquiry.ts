import type { CustomerDetails, InquiryLine } from "./types";

export interface InquirySummary {
  /** Distinct products on the inquiry, not ordered quantities. */
  productCount: number;
  /** Lines with no quoted price yet. Must be zero before saving. */
  unpricedCount: number;
  allPriced: boolean;
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

export function summarizeInquiry(lines: InquiryLine[]): InquirySummary {
  const unpricedCount = lines.filter((line) => !isLinePriced(line)).length;
  return {
    productCount: lines.length,
    unpricedCount,
    allPriced: unpricedCount === 0,
  };
}

export function selectedProductsLabel(productCount: number): string {
  return productCount === 1 ? "1 product selected" : `${productCount} products selected`;
}

export function recordedProductsLabel(productCount: number): string {
  return productCount === 1 ? "1 product recorded" : `${productCount} products recorded`;
}

export function canSubmitInquiry(lines: InquiryLine[], customer: CustomerDetails): boolean {
  return customer.name.trim() !== "" && lines.length > 0 && allLinesPriced(lines);
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
