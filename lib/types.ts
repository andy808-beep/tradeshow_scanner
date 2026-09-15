/**
 * `null` on a product field means the value has not been confirmed yet. It must
 * render as "Pending" and must never be replaced with a guess.
 */

export interface Product {
  id: string;
  code: string;
  nameZh: string | null;
  nameEn: string | null;
  /** Stored as display text in the database, e.g. "20.6 × 13.3 × 2.0 cm". */
  dimensions: string | null;
  barcode: string | null;
  unitPrice: number | null;
  packaging: string | null;
  currency: string;
  imageUrl: string | null;
}

export interface InquiryLine {
  product: Product;
  quantity: number;
  /** `null` until the rep quotes a price at the booth. */
  quotedUnitPrice: number | null;
}

export interface CustomerDetails {
  name: string;
  company: string;
  staffName: string;
  notes: string;
}

/** Falls back through the names so a row with a missing name still labels itself. */
export function productTitle(product: Product): string {
  return product.nameZh ?? product.nameEn ?? product.code;
}
