/**
 * Comparison, commit guards, and post-commit checks for replacing the active
 * product catalogue. The workbook parser stays in import-products.ts.
 *
 * Dry run is the only mode this module can complete on its own. The database
 * write is a single service-role RPC, and this module refuses to describe
 * that write as allowed unless every gate is present.
 */

export const AUTUMN_BATCH = "2026 Autumn Canton Fair";
export const AUTUMN_ACTIVE_COUNT = 661;

export const AUTUMN_COMMIT_COMMAND = [
  "npx tsx scripts/import-products.ts",
  "--source data/import/2026-autumn",
  '--batch "2026 Autumn Canton Fair"',
  "--commit",
  "--replace-active-catalogue",
  "--approve-collisions",
].join(" \\\n  ");

export const AUTUMN_VERIFY_COMMAND = [
  "npx tsx scripts/import-products.ts",
  "--source data/import/2026-autumn",
  '--batch "2026 Autumn Canton Fair"',
  "--verify",
].join(" \\\n  ");

export const POST_COMMIT_LOOKUP_CODES = [
  "K10608-03",
  "KU0509-GR",
  "78032268",
  "TT2101",
  "TT2101M",
] as const;

export const PRODUCT_BACKUP_COLUMNS = [
  "id",
  "product_code",
  "barcode",
  "chinese_name",
  "english_name",
  "unit_price",
  "currency",
  "dimensions",
  "packaging",
  "image_url",
  "active",
  "source_batch",
  "source_file",
  "created_at",
  "updated_at",
] as const;

export type ProductBackupColumn = (typeof PRODUCT_BACKUP_COLUMNS)[number];

export interface ExistingProduct {
  id: string;
  product_code: string;
  barcode: string | null;
  chinese_name: string | null;
  english_name: string | null;
  unit_price: number | string | null;
  currency: string | null;
  dimensions: string | null;
  packaging: string | null;
  image_url: string | null;
  active: boolean;
  source_batch: string | null;
  source_file: string | null;
  created_at: string;
  updated_at: string;
}

/** Rows sent to the replacement RPC. Barcode is deliberately absent. */
export interface CatalogueReplacementRow {
  product_code: string;
  chinese_name: string;
  english_name: string;
  unit_price: number;
  currency: string;
  dimensions: string;
  source_file: string;
}

export interface IncomingComparable {
  product_code: string;
  chinese_name: string;
  english_name: string;
  unit_price: number | null;
  currency: string;
  dimensions: string;
  source_file: string;
}

export interface CatalogueSnapshot {
  products: ExistingProduct[];
  inquiries: unknown[];
  inquiryItems: unknown[];
}

export type CollisionKind = "new" | "identical" | "changed" | "invalid";

export interface FieldComparison {
  identical: boolean;
  suspicious: boolean;
  differences: string[];
}

export interface ClassifiedCollision {
  productCode: string;
  existing: ExistingProduct;
  incoming: IncomingComparable;
  comparison: FieldComparison;
  recommendedAction: string;
}

export class CatalogueReplacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogueReplacementError";
  }
}

export function normalizeCode(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase();
}

export function numericPrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
  }
  const text = String(value).trim();
  if (text === "") return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 10000) / 10000;
}

export function pricesEqual(left: unknown, right: unknown): boolean {
  return numericPrice(left) === numericPrice(right);
}

export function compareBusinessFields(
  existing: Pick<
    ExistingProduct,
    "product_code" | "chinese_name" | "english_name" | "unit_price" | "currency" | "dimensions"
  >,
  incoming: IncomingComparable,
): FieldComparison {
  const differences: string[] = [];

  if (existing.product_code !== incoming.product_code) {
    differences.push("product_code");
  }
  if ((existing.chinese_name ?? "") !== incoming.chinese_name) {
    differences.push("chinese_name");
  }
  if ((existing.english_name ?? "") !== incoming.english_name) {
    differences.push("english_name");
  }
  if (!pricesEqual(existing.unit_price, incoming.unit_price)) {
    differences.push("unit_price");
  }
  if ((existing.currency ?? "") !== incoming.currency) {
    differences.push("currency");
  }
  if ((existing.dimensions ?? "") !== incoming.dimensions) {
    differences.push("dimensions");
  }

  const suspicious =
    differences.includes("chinese_name") || differences.includes("english_name");

  return {
    identical: differences.length === 0,
    suspicious,
    differences,
  };
}

export function recommendedAction(
  comparison: FieldComparison,
  existingActive: boolean,
): string {
  const activeNote = existingActive
    ? ""
    : " The existing row is inactive and would be activated in place.";

  if (comparison.identical) {
    return `Keep the existing UUID. Business fields match. Refresh source_batch, source_file, and active=true.${activeNote} Do not insert a second row.`;
  }

  const fields = comparison.differences.join(", ");
  if (comparison.suspicious) {
    return `SUSPICIOUS: the Chinese or English name differs (${fields}), so this product code may not be the same product. Compare every field before approval. On approval, update this UUID in place. Do not insert a second row and do not assign a replacement code.${activeNote}`;
  }

  return `Keep the existing UUID. Update the differing business fields (${fields}) in place after approval. Do not insert a second row.${activeNote}`;
}

export function indexExistingProducts(products: ExistingProduct[]): {
  byCode: Map<string, ExistingProduct>;
  ambiguous: string[];
} {
  const grouped = new Map<string, ExistingProduct[]>();
  for (const product of products) {
    const code = normalizeCode(product.product_code);
    const list = grouped.get(code) ?? [];
    list.push(product);
    grouped.set(code, list);
  }

  const byCode = new Map<string, ExistingProduct>();
  const ambiguous: string[] = [];
  for (const [code, list] of grouped) {
    if (list.length > 1) {
      ambiguous.push(code);
      continue;
    }
    byCode.set(code, list[0]);
  }
  ambiguous.sort();
  return { byCode, ambiguous };
}

export function classifyIncoming(
  incoming: IncomingComparable[],
  existingProducts: ExistingProduct[],
): {
  collisions: ClassifiedCollision[];
  counts: { new: number; identical: number; changed: number; suspicious: number };
  ambiguous: string[];
} {
  const { byCode, ambiguous } = indexExistingProducts(existingProducts);
  const collisions: ClassifiedCollision[] = [];
  const counts = { new: 0, identical: 0, changed: 0, suspicious: 0 };

  for (const row of incoming) {
    const existing = byCode.get(normalizeCode(row.product_code));
    if (!existing) {
      counts.new += 1;
      continue;
    }

    const comparison = compareBusinessFields(existing, row);
    if (comparison.identical) counts.identical += 1;
    else counts.changed += 1;
    if (comparison.suspicious) counts.suspicious += 1;

    collisions.push({
      productCode: row.product_code,
      existing,
      incoming: row,
      comparison,
      recommendedAction: recommendedAction(comparison, existing.active),
    });
  }

  return { collisions, counts, ambiguous };
}

export function collisionCsvRecords(
  collisions: ClassifiedCollision[],
): Array<Array<string | number | null>> {
  return collisions.map((collision) => [
    collision.productCode,
    collision.existing.id,
    collision.existing.chinese_name,
    collision.incoming.chinese_name,
    collision.existing.english_name,
    collision.incoming.english_name,
    collision.existing.unit_price === null || collision.existing.unit_price === undefined
      ? null
      : String(collision.existing.unit_price),
    collision.incoming.unit_price,
    collision.existing.dimensions,
    collision.incoming.dimensions,
    collision.existing.barcode,
    collision.existing.source_batch,
    collision.incoming.source_file,
    collision.comparison.identical ? "yes" : "no",
    collision.recommendedAction,
    collision.comparison.identical ? "identical" : "changed",
    collision.comparison.suspicious ? "yes" : "no",
    collision.comparison.differences.join(" | "),
  ]);
}

export const COLLISION_CSV_HEADERS = [
  "product_code",
  "existing_id",
  "existing_chinese_name",
  "incoming_chinese_name",
  "existing_english_name",
  "incoming_english_name",
  "existing_unit_price",
  "incoming_unit_price",
  "existing_dimensions",
  "incoming_dimensions",
  "existing_barcode",
  "existing_source_batch",
  "incoming_source_file",
  "fields_identical",
  "recommended_action",
  "classification",
  "suspicious",
  "differences",
] as const;

export function backupCsvRecords(
  products: ExistingProduct[],
): Array<Array<string | number | null>> {
  return products.map((product) =>
    PRODUCT_BACKUP_COLUMNS.map((column) => backupCell(product[column])),
  );
}

function backupCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return value;
  return String(value);
}

export function commitRefusalReasons(input: {
  replaceActiveCatalogue: boolean;
  approveCollisions: boolean;
  batch: string;
  auditProblems: string[];
  validUniqueCount: number;
  collisionReportWritten: boolean;
  backupWritten: boolean;
  hasServiceCredentials: boolean;
  ambiguousCodes: string[];
}): string[] {
  const reasons: string[] = [];

  if (!input.replaceActiveCatalogue) {
    reasons.push("Refusing to commit without --replace-active-catalogue.");
  }
  if (!input.approveCollisions) {
    reasons.push("Refusing to commit without --approve-collisions.");
  }
  if (input.batch !== AUTUMN_BATCH) {
    reasons.push(`Refusing to commit unless the batch is "${AUTUMN_BATCH}".`);
  }
  if (input.auditProblems.length > 0) {
    reasons.push("Refusing to commit because validation checks failed.");
  }
  if (input.validUniqueCount !== AUTUMN_ACTIVE_COUNT) {
    reasons.push(
      `Refusing to commit unless exactly ${AUTUMN_ACTIVE_COUNT} valid unique products are present (found ${input.validUniqueCount}).`,
    );
  }
  if (!input.collisionReportWritten) {
    reasons.push("Refusing to commit because the collision report was not generated.");
  }
  if (!input.backupWritten) {
    reasons.push("Refusing to commit because the active catalogue backup did not complete.");
  }
  if (!input.hasServiceCredentials) {
    reasons.push(
      "Refusing to commit because SUPABASE_URL and SUPABASE_SECRET_KEY are not both available.",
    );
  }
  if (input.ambiguousCodes.length > 0) {
    reasons.push(
      `Refusing to commit because these normalized codes match more than one existing product: ${input.ambiguousCodes.join(", ")}.`,
    );
  }

  return reasons;
}

export interface ApplyOptions {
  /** Throw after this many upserts and discard the draft. */
  failAfterUpserts?: number;
  /** Mutate the draft after deactivation so the final checks can fail. */
  afterDeactivate?: (draft: CatalogueSnapshot) => void;
  now?: () => string;
  createId?: () => string;
}

/**
 * In-memory image of the SQL replacement. The caller's snapshot is never
 * mutated. A failure throws and returns nothing, which is the rollback.
 */
export function applyCatalogueReplacement(
  snapshot: CatalogueSnapshot,
  incoming: CatalogueReplacementRow[],
  batch: string,
  options: ApplyOptions = {},
): CatalogueSnapshot {
  if (batch.trim() === "") {
    throw new CatalogueReplacementError("source batch is required");
  }
  if (incoming.length === 0) {
    throw new CatalogueReplacementError("products payload must be a non-empty array");
  }

  const seen = new Set<string>();
  for (const row of incoming) {
    if (
      row.product_code.trim() === "" ||
      row.chinese_name.trim() === "" ||
      row.english_name.trim() === "" ||
      row.dimensions.trim() === "" ||
      row.source_file.trim() === "" ||
      row.currency.trim() === "" ||
      !Number.isFinite(row.unit_price) ||
      row.unit_price < 0
    ) {
      throw new CatalogueReplacementError("incoming catalogue contains an invalid product row");
    }
    const code = normalizeCode(row.product_code);
    if (seen.has(code)) {
      throw new CatalogueReplacementError("incoming catalogue contains duplicate product codes");
    }
    seen.add(code);
  }

  const { ambiguous } = indexExistingProducts(snapshot.products);
  const relevantAmbiguous = ambiguous.filter((code) => seen.has(code));
  if (relevantAmbiguous.length > 0) {
    throw new CatalogueReplacementError(
      "multiple existing products share a normalized product code",
    );
  }

  const draft = structuredClone(snapshot);
  const now = options.now ?? (() => "2026-10-20T00:00:00.000Z");
  const createId = options.createId ?? (() => crypto.randomUUID());
  let upserts = 0;

  for (const row of incoming) {
    if (options.failAfterUpserts !== undefined && upserts === options.failAfterUpserts) {
      throw new CatalogueReplacementError("simulated failure before commit");
    }

    const code = normalizeCode(row.product_code);
    const index = draft.products.findIndex(
      (product) => normalizeCode(product.product_code) === code,
    );

    if (index === -1) {
      draft.products.push({
        id: createId(),
        product_code: code,
        barcode: null,
        chinese_name: row.chinese_name,
        english_name: row.english_name,
        unit_price: row.unit_price,
        currency: row.currency,
        dimensions: row.dimensions,
        packaging: null,
        image_url: null,
        active: true,
        source_batch: batch,
        source_file: row.source_file,
        created_at: now(),
        updated_at: now(),
      });
    } else {
      const current = draft.products[index];
      draft.products[index] = {
        ...current,
        product_code: code,
        chinese_name: row.chinese_name,
        english_name: row.english_name,
        unit_price: row.unit_price,
        currency: row.currency,
        dimensions: row.dimensions,
        active: true,
        source_batch: batch,
        source_file: row.source_file,
        updated_at: now(),
      };
    }
    upserts += 1;
  }

  for (const product of draft.products) {
    if (!seen.has(normalizeCode(product.product_code)) && product.active) {
      product.active = false;
      product.updated_at = now();
    }
  }

  options.afterDeactivate?.(draft);

  const beforeIds = new Set(snapshot.products.map((product) => product.id));
  const afterIds = new Set(draft.products.map((product) => product.id));
  for (const id of beforeIds) {
    if (!afterIds.has(id)) {
      throw new CatalogueReplacementError("a product row disappeared");
    }
  }
  if (draft.products.length < snapshot.products.length) {
    throw new CatalogueReplacementError("products were deleted");
  }

  for (const before of snapshot.products) {
    const after = draft.products.find((product) => product.id === before.id);
    if (!after || after.barcode !== before.barcode) {
      throw new CatalogueReplacementError("a product barcode changed");
    }
  }

  const active = draft.products.filter((product) => product.active);
  if (active.length !== incoming.length) {
    throw new CatalogueReplacementError("active product count does not match the incoming catalogue");
  }
  if (active.some((product) => product.source_batch !== batch)) {
    throw new CatalogueReplacementError("an active product is outside the incoming batch");
  }

  if (JSON.stringify(draft.inquiries) !== JSON.stringify(snapshot.inquiries)) {
    throw new CatalogueReplacementError("inquiries changed");
  }
  if (JSON.stringify(draft.inquiryItems) !== JSON.stringify(snapshot.inquiryItems)) {
    throw new CatalogueReplacementError("inquiry_items changed");
  }

  return draft;
}

export interface VerificationInput {
  beforeProducts: ExistingProduct[];
  afterProducts: ExistingProduct[];
  autumnCodes: readonly string[];
  inquiriesBefore: number;
  inquiriesAfter: number;
  inquiryItemsBefore: number;
  inquiryItemsAfter: number;
}

export function verifyReplacedCatalogue(input: VerificationInput): string[] {
  const problems: string[] = [];
  const autumn = new Set(input.autumnCodes.map(normalizeCode));
  const active = input.afterProducts.filter((product) => product.active);
  const activeCodes = active.map((product) => normalizeCode(product.product_code));
  const distinctActive = new Set(activeCodes);

  if (active.length !== AUTUMN_ACTIVE_COUNT) {
    problems.push(`active products: expected ${AUTUMN_ACTIVE_COUNT}, found ${active.length}`);
  }
  if (distinctActive.size !== AUTUMN_ACTIVE_COUNT) {
    problems.push(
      `distinct active product codes: expected ${AUTUMN_ACTIVE_COUNT}, found ${distinctActive.size}`,
    );
  }
  if (active.some((product) => product.source_batch !== AUTUMN_BATCH)) {
    problems.push(`an active product is missing source_batch "${AUTUMN_BATCH}"`);
  }

  const countActive = (code: string) =>
    active.filter((product) => normalizeCode(product.product_code) === code).length;
  if (countActive("TT2101") !== 1) {
    problems.push(`TT2101 active count: expected 1, found ${countActive("TT2101")}`);
  }
  if (countActive("TT2101M") !== 1) {
    problems.push(`TT2101M active count: expected 1, found ${countActive("TT2101M")}`);
  }

  const springOrTest = active.filter((product) => {
    const batch = product.source_batch ?? "";
    return batch !== AUTUMN_BATCH || /spring|test/i.test(batch);
  });
  if (springOrTest.length > 0) {
    problems.push(`active spring/test products remain: ${springOrTest.length}`);
  }

  const afterById = new Map(input.afterProducts.map((product) => [product.id, product]));
  for (const before of input.beforeProducts) {
    const after = afterById.get(before.id);
    if (!after) {
      problems.push(`legacy product ${before.id} was deleted`);
      continue;
    }
    if (after.barcode !== before.barcode) {
      problems.push(`barcode changed for ${before.product_code}`);
    }
    const code = normalizeCode(before.product_code);
    if (!autumn.has(code) && after.active) {
      problems.push(`legacy product ${before.product_code} is still active`);
    }
  }

  for (const code of autumn) {
    const matches = input.afterProducts.filter(
      (product) => normalizeCode(product.product_code) === code,
    );
    const prior = input.beforeProducts.find(
      (product) => normalizeCode(product.product_code) === code,
    );
    if (prior) {
      const same = matches.find((product) => product.id === prior.id);
      if (!same) problems.push(`existing UUID was not preserved for ${code}`);
      else if (!same.active) problems.push(`autumn product ${code} is inactive`);
    }
  }

  if (input.inquiriesAfter !== input.inquiriesBefore) {
    problems.push(
      `inquiries count changed from ${input.inquiriesBefore} to ${input.inquiriesAfter}`,
    );
  }
  if (input.inquiryItemsAfter !== input.inquiryItemsBefore) {
    problems.push(
      `inquiry_items count changed from ${input.inquiryItemsBefore} to ${input.inquiryItemsAfter}`,
    );
  }

  for (const code of POST_COMMIT_LOOKUP_CODES) {
    const matches = active.filter((product) => normalizeCode(product.product_code) === code);
    if (matches.length !== 1) {
      problems.push(`lookup ${code}: expected 1 active product, found ${matches.length}`);
    }
  }

  return problems;
}

export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((record, index, all) => {
    const trailingBlank =
      index === all.length - 1 && record.length === 1 && record[0] === "";
    return !trailingBlank;
  });
}

export function productsFromBackupCsv(text: string): ExistingProduct[] {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  if (header.join(",") !== PRODUCT_BACKUP_COLUMNS.join(",")) {
    throw new CatalogueReplacementError("backup CSV is missing the expected product columns");
  }

  return rows.slice(1).map((cells) => {
    const record = Object.fromEntries(
      PRODUCT_BACKUP_COLUMNS.map((column, index) => [column, cells[index] ?? ""]),
    );
    return {
      id: record.id,
      product_code: record.product_code,
      barcode: emptyToNull(record.barcode),
      chinese_name: emptyToNull(record.chinese_name),
      english_name: emptyToNull(record.english_name),
      unit_price: record.unit_price === "" ? null : record.unit_price,
      currency: emptyToNull(record.currency),
      dimensions: emptyToNull(record.dimensions),
      packaging: emptyToNull(record.packaging),
      image_url: emptyToNull(record.image_url),
      active: record.active === "true",
      source_batch: emptyToNull(record.source_batch),
      source_file: emptyToNull(record.source_file),
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  });
}

function emptyToNull(value: string): string | null {
  return value === "" ? null : value;
}

export function hasServiceCredentials(env: {
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}): boolean {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && secret);
}
