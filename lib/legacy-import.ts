/**
 * Field mapping for the legacy Excel product import template.
 *
 * Recorded as code rather than documentation because two of its columns are
 * easy to misread:
 *
 * - `hh` is the company product code, not a quantity or a row number.
 * - `bc_default` is the default packaging method. Despite the "bc" prefix it is
 *   NOT a barcode and must never be written to `products.barcode`.
 *
 * The legacy system prints each label by rendering a Code 39 graphic from the
 * product code, so an imported row has no barcode of its own: `products.barcode`
 * stays null and is reserved for external supplier labels that encode something
 * different from Koei's product code.
 */

/** A row from the legacy template. Unmapped columns are ignored. */
export interface LegacyProductRow {
  /** Company product code, e.g. "K10188-13". */
  hh?: unknown;
  /** Default packaging method — not a barcode. */
  bc_default?: unknown;
  chinese_name?: unknown;
  english_name?: unknown;
  dimensions?: unknown;
}

/** The subset of `products` columns a legacy import may populate. */
export interface ProductImportRecord {
  product_code: string;
  barcode: null;
  packaging: string | null;
  chinese_name: string | null;
  english_name: string | null;
  dimensions: string | null;
}

/** Columns the importer must never write, with the reason why. */
export const FORBIDDEN_IMPORT_MAPPINGS = {
  barcode: "bc_default is the packaging method, not a barcode.",
} as const;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export class LegacyImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyImportError";
  }
}

/**
 * Maps one legacy row onto product columns.
 *
 * The product code keeps its exact characters, hyphens included, so it still
 * matches the Code 39 value scanned from the printed label.
 */
export function mapLegacyProductRow(row: LegacyProductRow): ProductImportRecord {
  const productCode = text(row.hh);

  if (productCode === null) {
    throw new LegacyImportError("Legacy column hh (product code) is required.");
  }

  return {
    product_code: productCode,
    // Never sourced from bc_default; left for supplier labels to fill later.
    barcode: null,
    packaging: text(row.bc_default),
    chinese_name: text(row.chinese_name),
    english_name: text(row.english_name),
    dimensions: text(row.dimensions),
  };
}
