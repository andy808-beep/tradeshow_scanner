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
  /**
   * Seeded from `product.unitPrice` when the product is first added, then owned
   * by the employee. `null` means no price is set yet — either the product has
   * no listed price or the field was cleared — and the inquiry cannot be saved
   * in that state.
   */
  quotedUnitPrice: number | null;
  /** Optional product-specific notes. Empty string when none are entered. */
  notes: string;
}

export interface CustomerDetails {
  name: string;
  company: string;
  notes: string;
}

/** Falls back through the names so a row with a missing name still labels itself. */
export function productTitle(product: Product): string {
  return product.nameZh ?? product.nameEn ?? product.code;
}
