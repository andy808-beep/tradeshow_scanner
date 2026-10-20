/**
 * Auditable product import for Yixing Canton Fair workbooks.
 *
 * Dry run is the default and performs no database writes. The spring command
 * stays available for the original batch. The autumn catalogue replacement
 * reads data/import/2026-autumn recursively and, only with every commit gate
 * present, calls replace_active_product_catalogue.
 *
 * Autumn dry run:
 *   npx tsx scripts/import-products.ts \
 *     --source data/import/2026-autumn \
 *     --batch "2026 Autumn Canton Fair"
 *
 * Autumn commit (not run by a dry run):
 *   npx tsx scripts/import-products.ts \
 *     --source data/import/2026-autumn \
 *     --batch "2026 Autumn Canton Fair" \
 *     --commit \
 *     --replace-active-catalogue \
 *     --approve-collisions
 *
 * Credentials are read from SUPABASE_URL and SUPABASE_SECRET_KEY, or the
 * service-role aliases, only when a live read or the commit RPC needs them.
 * They are never logged.
 */

import * as fs from "node:fs";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import {
  AUTUMN_BATCH,
  AUTUMN_COMMIT_COMMAND,
  AUTUMN_VERIFY_COMMAND,
  COLLISION_CSV_HEADERS,
  PRODUCT_BACKUP_COLUMNS,
  backupCsvRecords,
  classifyIncoming,
  collisionCsvRecords,
  commitRefusalReasons,
  hasServiceCredentials,
  parseCsv,
  productsFromBackupCsv,
  POST_COMMIT_LOOKUP_CODES,
  verifyReplacedCatalogue,
  type CatalogueReplacementRow,
  type ExistingProduct,
  type IncomingComparable,
} from "./catalogue-replacement";

/**
 * SheetJS does not bind Node's `fs` itself when loaded as an ES module, and
 * `readFile` then fails with "Cannot access file". Done lazily so that merely
 * importing this module for tests has no side effects.
 */
let fsBound = false;
function ensureFsBound() {
  if (fsBound) return;
  XLSX.set_fs(fs);
  fsBound = true;
}

export const SOURCE_DIR = path.join("data", "import", "2026-spring");
export const REPORT_DIR = path.join("data", "import-reports");
export const PREVIEW_CSV = path.join(REPORT_DIR, "products-preview.csv");
export const ERRORS_CSV = path.join(REPORT_DIR, "products-errors.csv");
export const AUTUMN_SOURCE_DIR = path.join("data", "import", "2026-autumn");
export const AUTUMN_PREVIEW_CSV = path.join(REPORT_DIR, "2026-autumn-products-preview.csv");
export const AUTUMN_COLLISIONS_CSV = path.join(REPORT_DIR, "2026-autumn-code-collisions.csv");
export const AUTUMN_ERRORS_CSV = path.join(REPORT_DIR, "2026-autumn-errors.csv");
export const AUTUMN_BACKUP_CSV = path.join(REPORT_DIR, "2026-autumn-existing-products-backup.csv");
export const AUTUMN_COUNTS_JSON = path.join(REPORT_DIR, "2026-autumn-precommit-counts.json");

/** The audited shape of the 2026 autumn batch. A mismatch aborts the run. */
export const AUTUMN_EXPECTED = {
  sourceRows: 661,
  validRows: 661,
  uniqueCodes: 661,
  duplicateCodes: 0,
  missingProductCodes: 0,
  missingUnitPrices: 0,
  missingChineseNames: 0,
  missingEnglishNames: 0,
  missingDimensions: 0,
  rejectedRows: 0,
  codeTT2101: 1,
  codeTT2101M: 1,
} as const;

export const SHEET_NAME = "Sheet1";
/** Row 1 holds technical field names; rows 2-6 are template rows. */
export const HEADER_EXCEL_ROW = 1;
export const DATA_START_EXCEL_ROW = 7;

export const SOURCE_BATCH = "2026 Spring Canton Fair";
export { AUTUMN_BATCH, AUTUMN_COMMIT_COMMAND, AUTUMN_VERIFY_COMMAND };
export const CURRENCY = "USD";
export const PRICE_DECIMALS = 4;
export const BATCH_SIZE = 50;

/** Columns read from the workbook. `sccb` and `bc_default` are deliberately absent. */
export const SOURCE_COLUMNS = [
  "hh",
  "pm",
  "pm_e",
  "bj",
  "mdz_l",
  "mdz_w",
  "mdz_h",
] as const;

type SourceColumn = (typeof SOURCE_COLUMNS)[number];

/**
 * Records that exist already and must survive this import untouched. The
 * upsert keys on product_code, so a row carrying one of these would overwrite
 * live data; it is rejected instead.
 */
export const PROTECTED_PRODUCT_CODES = ["K10188-13"];

/** The audited shape of this batch. --commit refuses if reality differs. */
export const EXPECTED = {
  sourceRows: 103,
  validRows: 101,
  rejectedRows: 2,
  missingPriceRows: 1,
  normalizedCodes: 1,
} as const;

export interface SourceRow {
  sourceFile: string;
  excelRow: number;
  hh: unknown;
  pm: unknown;
  pm_e: unknown;
  bj: unknown;
  mdz_l: unknown;
  mdz_w: unknown;
  mdz_h: unknown;
  /** Report-only. products has no origin column, so this is never written. */
  origin?: "" | "China" | "Japan";
}

export interface ProductRecord {
  product_code: string;
  chinese_name: string;
  english_name: string;
  unit_price: number | null;
  currency: string;
  dimensions: string;
  packaging: null;
  barcode: null;
  active: true;
  source_batch: string;
  source_file: string;
}

export interface ValidRow {
  sourceFile: string;
  excelRow: number;
  /** Kept for the audit trail, before uppercasing. */
  originalCode: string;
  normalized: boolean;
  /** Trimmed workbook price text, kept for the audit CSV. */
  priceText: string;
  origin: "" | "China" | "Japan";
  record: ProductRecord;
}

export interface RejectedRow {
  sourceFile: string;
  excelRow: number;
  originalCode: string;
  normalizedCode: string;
  errors: string[];
}

export interface ImportStats {
  sourceRows: number;
  validRows: number;
  rejectedRows: number;
  duplicateCodes: number;
  duplicateRows: number;
  missingPriceRows: number;
  normalizedCodes: number;
}

export interface ImportPlan {
  valid: ValidRow[];
  rejected: RejectedRow[];
  stats: ImportStats;
}

export function trimText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Trims and uppercases a product code, always as text.
 *
 * Codes such as "K9426S-19" must keep their letters and hyphens, and a numeric
 * looking code must never become a JS number, so nothing here parses digits.
 */
export function normalizeProductCode(value: unknown): string {
  return trimText(value).toUpperCase();
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export type PriceResult =
  | { ok: true; value: number | null }
  | { ok: false; reason: string };

/** Parses an FOB price. Blank is a valid "not quoted yet"; negatives are not. */
export function parsePrice(value: unknown): PriceResult {
  if (trimText(value) === "") return { ok: true, value: null };

  const parsed = typeof value === "number" ? value : Number(trimText(value));

  if (!Number.isFinite(parsed)) {
    return { ok: false, reason: `Price "${trimText(value)}" is not a number.` };
  }
  if (parsed < 0) {
    return { ok: false, reason: `Price ${trimText(value)} is negative.` };
  }

  return { ok: true, value: roundTo(parsed, PRICE_DECIMALS) };
}

/**
 * One dimension token for the stored text.
 *
 * Numbers keep the historical rounded form ("8.5"). Workbook text keeps its
 * trimmed characters, so a displayed "12.50" is not rewritten as "12.5".
 */
export function dimensionToken(value: unknown): string | null {
  if (typeof value === "number") {
    const parsed = parseDimension(value);
    return parsed === null ? null : String(parsed);
  }

  const text = trimText(value);
  if (text === "") return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return text;
}

/** Parses one dimension in cm. Returns null when absent or not a positive number. */
export function parseDimension(value: unknown): number | null {
  if (trimText(value) === "") return null;

  const parsed = typeof value === "number" ? value : Number(trimText(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  // Two decimals is enough for cm and clears binary float noise.
  return roundTo(parsed, 2);
}

export function formatDimensions(length: number, width: number, height: number): string {
  return `${length} × ${width} × ${height} cm`;
}

export type RowResult =
  | {
      ok: true;
      originalCode: string;
      productCode: string;
      normalized: boolean;
      record: ProductRecord;
    }
  | { ok: false; originalCode: string; productCode: string; errors: string[] };

export interface RowValidationOptions {
  sourceBatch?: string;
  protectedCodes?: readonly string[];
  /** Autumn requires a price. The spring batch still allows a blank FOB cell. */
  requirePrice?: boolean;
}

/** Validates and maps one source row, ignoring cross-file duplicates. */
export function validateRow(row: SourceRow, options: RowValidationOptions = {}): RowResult {
  const sourceBatch = options.sourceBatch ?? SOURCE_BATCH;
  const protectedCodes = options.protectedCodes ?? PROTECTED_PRODUCT_CODES;
  const originalCode = trimText(row.hh);
  const productCode = normalizeProductCode(row.hh);
  const errors: string[] = [];

  if (productCode === "") errors.push("Missing product code (hh).");

  const chineseName = trimText(row.pm);
  if (chineseName === "") errors.push("Missing Chinese name (pm).");

  const englishName = trimText(row.pm_e);
  if (englishName === "") errors.push("Missing English name (pm_e).");

  const price = parsePrice(row.bj);
  if (!price.ok) errors.push(price.reason);
  if (options.requirePrice && price.ok && price.value === null) {
    errors.push("Missing unit price (bj).");
  }

  const length = dimensionToken(row.mdz_l);
  const width = dimensionToken(row.mdz_w);
  const height = dimensionToken(row.mdz_h);
  if (length === null) errors.push("Missing or invalid length (mdz_l).");
  if (width === null) errors.push("Missing or invalid width (mdz_w).");
  if (height === null) errors.push("Missing or invalid height (mdz_h).");

  if (protectedCodes.includes(productCode)) {
    errors.push(
      `${productCode} already exists and is protected; this row would overwrite it.`,
    );
  }

  // The price/dimension checks are implied by `errors`; they are repeated here
  // so TypeScript can narrow the values used below.
  if (
    errors.length > 0 ||
    !price.ok ||
    length === null ||
    width === null ||
    height === null
  ) {
    return { ok: false, originalCode, productCode, errors };
  }

  return {
    ok: true,
    originalCode,
    productCode,
    normalized: productCode !== originalCode,
    record: {
      product_code: productCode,
      chinese_name: chineseName,
      english_name: englishName,
      unit_price: price.value,
      currency: CURRENCY,
      dimensions: `${length} × ${width} × ${height} cm`,
      // Packaging and barcode are never inferred: the template has no barcode
      // field, and bc_default is a packaging method rather than a barcode.
      packaging: null,
      barcode: null,
      active: true,
      source_batch: sourceBatch,
      source_file: row.sourceFile,
    },
  };
}

/**
 * Turns source rows into an import plan.
 *
 * Any normalized product code appearing on more than one source row is treated
 * as a conflict and every row involved is rejected, even when the other fields
 * agree — a human has to decide which row is correct.
 */
export function priceTextOf(value: unknown, numeric: number | null): string {
  if (numeric === null) return "";
  if (typeof value === "string") return trimText(value);
  return String(numeric);
}

export function buildImportPlan(
  rows: SourceRow[],
  options: RowValidationOptions = {},
): ImportPlan {
  const results = rows.map((row) => validateRow(row, options));

  const byCode = new Map<string, number[]>();
  results.forEach((result, index) => {
    if (!result.ok) return;
    const seen = byCode.get(result.productCode) ?? [];
    seen.push(index);
    byCode.set(result.productCode, seen);
  });

  const duplicateIndices = new Set<number>();
  let duplicateCodes = 0;
  for (const indices of byCode.values()) {
    if (indices.length < 2) continue;
    duplicateCodes += 1;
    for (const index of indices) duplicateIndices.add(index);
  }

  const valid: ValidRow[] = [];
  const rejected: RejectedRow[] = [];

  results.forEach((result, index) => {
    const row = rows[index];

    if (!result.ok) {
      rejected.push({
        sourceFile: row.sourceFile,
        excelRow: row.excelRow,
        originalCode: result.originalCode,
        normalizedCode: result.productCode,
        errors: result.errors,
      });
      return;
    }

    if (duplicateIndices.has(index)) {
      const others = (byCode.get(result.productCode) ?? [])
        .filter((other) => other !== index)
        .map((other) => `${rows[other].sourceFile} row ${rows[other].excelRow}`);

      rejected.push({
        sourceFile: row.sourceFile,
        excelRow: row.excelRow,
        originalCode: result.originalCode,
        normalizedCode: result.productCode,
        errors: [
          `Duplicate product code ${result.productCode}; also present at ${others.join("; ")}. Every conflicting row is excluded — resolve it by hand.`,
        ],
      });
      return;
    }

    valid.push({
      sourceFile: row.sourceFile,
      excelRow: row.excelRow,
      originalCode: result.originalCode,
      normalized: result.normalized,
      priceText: priceTextOf(row.bj, result.record.unit_price),
      origin: row.origin ?? "",
      record: result.record,
    });
  });

  return {
    valid,
    rejected,
    stats: {
      sourceRows: rows.length,
      validRows: valid.length,
      rejectedRows: rejected.length,
      duplicateCodes,
      duplicateRows: duplicateIndices.size,
      missingPriceRows: valid.filter((row) => row.record.unit_price === null).length,
      normalizedCodes: valid.filter((row) => row.normalized).length,
    },
  };
}

/** Differences between the audited expectations and reality. Empty means safe. */
export function checkExpectations(stats: ImportStats): string[] {
  const checks: Array<[string, number, number]> = [
    ["source rows", stats.sourceRows, EXPECTED.sourceRows],
    ["valid import rows", stats.validRows, EXPECTED.validRows],
    ["rejected rows", stats.rejectedRows, EXPECTED.rejectedRows],
    ["missing-price rows", stats.missingPriceRows, EXPECTED.missingPriceRows],
    ["normalized product codes", stats.normalizedCodes, EXPECTED.normalizedCodes],
  ];

  return checks
    .filter(([, actual, expected]) => actual !== expected)
    .map(([label, actual, expected]) => `${label}: expected ${expected}, found ${actual}`);
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const escape = (value: string | number | null): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n") + "\r\n";
}

export function previewCsv(valid: ValidRow[]): string {
  return toCsv(
    [
      "source_file",
      "source_row",
      "original_product_code",
      "product_code",
      "code_normalized",
      "chinese_name",
      "english_name",
      "unit_price",
      "currency",
      "dimensions",
      "packaging",
      "barcode",
      "active",
      "source_batch",
    ],
    valid.map((row) => [
      row.sourceFile,
      row.excelRow,
      row.originalCode,
      row.record.product_code,
      row.normalized ? "yes" : "no",
      row.record.chinese_name,
      row.record.english_name,
      row.record.unit_price === null ? "" : row.record.unit_price,
      row.record.currency,
      row.record.dimensions,
      "",
      "",
      String(row.record.active),
      row.record.source_batch,
    ]),
  );
}

export function errorsCsv(rejected: RejectedRow[]): string {
  return toCsv(
    [
      "source_file",
      "source_row",
      "original_product_code",
      "normalized_product_code",
      "errors",
    ],
    rejected.map((row) => [
      row.sourceFile,
      row.excelRow,
      row.originalCode,
      row.normalizedCode,
      row.errors.join(" | "),
    ]),
  );
}

export interface WorkbookReadOptions {
  /** Keep the workbook's displayed price and dimension text. */
  displayed?: boolean;
  /** A blank product code with other business fields is a rejected row. */
  keepRowsWithoutCode?: boolean;
  origin?: "" | "China" | "Japan";
}

/** Reads the product rows out of one workbook. The file is opened read-only. */
export function readWorkbookRows(filePath: string, readOptions: WorkbookReadOptions = {}): SourceRow[] {
  ensureFsBound();

  const fileName = path.basename(filePath);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[SHEET_NAME];

  if (!sheet) {
    throw new Error(`${fileName} has no sheet named ${SHEET_NAME}.`);
  }

  const options = { header: 1, defval: null, blankrows: true } as const;
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { ...options, raw: true });
  // Formatted pass: keeps a code like "12345" as the text Excel displays
  // instead of a float, so codes never round-trip through a number.
  const textRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { ...options, raw: false });

  const header = (rawRows[HEADER_EXCEL_ROW - 1] ?? []).map(trimText);
  const columnOf = new Map(SOURCE_COLUMNS.map((name) => [name, header.indexOf(name)]));

  for (const [name, index] of columnOf) {
    if (index === -1) {
      throw new Error(`${fileName} ${SHEET_NAME} is missing the "${name}" column.`);
    }
  }

  const cell = (row: unknown[] | undefined, name: SourceColumn): unknown =>
    row?.[columnOf.get(name) ?? -1] ?? null;

  const rows: SourceRow[] = [];

  for (let index = DATA_START_EXCEL_ROW - 1; index < rawRows.length; index += 1) {
    const raw = rawRows[index];
    const formatted = textRows[index];

    const hh = cell(formatted, "hh") ?? cell(raw, "hh");
    const pm = cell(formatted, "pm") ?? cell(raw, "pm");
    const pmE = cell(formatted, "pm_e") ?? cell(raw, "pm_e");
    const bj = readOptions.displayed ? (cell(formatted, "bj") ?? cell(raw, "bj")) : cell(raw, "bj");
    const length = readOptions.displayed
      ? (cell(formatted, "mdz_l") ?? cell(raw, "mdz_l"))
      : cell(raw, "mdz_l");
    const width = readOptions.displayed
      ? (cell(formatted, "mdz_w") ?? cell(raw, "mdz_w"))
      : cell(raw, "mdz_w");
    const height = readOptions.displayed
      ? (cell(formatted, "mdz_h") ?? cell(raw, "mdz_h"))
      : cell(raw, "mdz_h");

    // Trailing template padding: thousands of empty rows follow the data.
    if (trimText(hh) === "") {
      const hasBusinessData = [pm, pmE, bj, length, width, height].some(
        (value) => trimText(value) !== "",
      );
      if (!readOptions.keepRowsWithoutCode || !hasBusinessData) continue;
    }

    rows.push({
      sourceFile: fileName,
      excelRow: index + 1,
      hh,
      pm,
      pm_e: pmE,
      bj,
      mdz_l: length,
      mdz_w: width,
      mdz_h: height,
      origin: readOptions.origin ?? "",
    });
  }

  return rows;
}

export function isWorkbookName(name: string): boolean {
  return /\.xlsx?$/i.test(name) && !name.startsWith("~$");
}

/** The workbooks in a directory, ignoring Excel's "~$" lock files. */
export function listWorkbooks(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => isWorkbookName(name))
    .sort();
}

/** Workbook paths. Autumn passes recursive so China and Japan folders are both read. */
export function listWorkbookFiles(directory: string, recursive: boolean): string[] {
  if (!recursive) {
    return listWorkbooks(directory).map((name) => path.join(directory, name));
  }

  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isWorkbookName(entry.name)) found.push(full);
    }
  };
  walk(directory);
  found.sort((left, right) => left.localeCompare(right, "en"));
  return found;
}

export function originFromWorkbookPath(
  sourceRoot: string,
  filePath: string,
): "" | "China" | "Japan" {
  const relative = path.relative(sourceRoot, filePath).replace(/\\/g, "/");
  const first = relative.split("/")[0]?.toLowerCase() ?? "";
  if (first === "china") return "China";
  if (first === "japan") return "Japan";
  return "";
}

export function readAllWorkbooks(directory: string): SourceRow[] {
  const files = listWorkbooks(directory);

  if (files.length === 0) {
    throw new Error(`No workbooks found in ${directory}.`);
  }

  return files.flatMap((name) => readWorkbookRows(path.join(directory, name)));
}

export interface AutumnAudit {
  sourceRows: number;
  validRows: number;
  uniqueCodes: number;
  duplicateCodes: number;
  missingProductCodes: number;
  missingUnitPrices: number;
  missingChineseNames: number;
  missingEnglishNames: number;
  missingDimensions: number;
  rejectedRows: number;
  codeTT2101: number;
  codeTT2101M: number;
}

export function autumnAudit(plan: ImportPlan): AutumnAudit {
  const codes = new Map<string, number>();
  for (const row of plan.valid) {
    codes.set(row.record.product_code, (codes.get(row.record.product_code) ?? 0) + 1);
  }

  const withError = (needle: string) =>
    plan.rejected.filter((row) => row.errors.some((error) => error.includes(needle))).length;

  return {
    sourceRows: plan.stats.sourceRows,
    validRows: plan.stats.validRows,
    uniqueCodes: codes.size,
    duplicateCodes: plan.stats.duplicateCodes,
    missingProductCodes: withError("Missing product code"),
    missingUnitPrices: withError("Missing unit price") + plan.stats.missingPriceRows,
    missingChineseNames: withError("Missing Chinese name"),
    missingEnglishNames: withError("Missing English name"),
    missingDimensions: plan.rejected.filter((row) =>
      row.errors.some((error) => /mdz_[lwh]/.test(error)),
    ).length,
    rejectedRows: plan.stats.rejectedRows,
    codeTT2101: codes.get("TT2101") ?? 0,
    codeTT2101M: codes.get("TT2101M") ?? 0,
  };
}

export function checkAutumnAudit(audit: AutumnAudit, codeCounts: ReadonlyMap<string, number>): string[] {
  const checks: Array<[string, number, number]> = [
    ["source rows", audit.sourceRows, AUTUMN_EXPECTED.sourceRows],
    ["valid import rows", audit.validRows, AUTUMN_EXPECTED.validRows],
    ["unique product codes", audit.uniqueCodes, AUTUMN_EXPECTED.uniqueCodes],
    ["duplicate product codes", audit.duplicateCodes, AUTUMN_EXPECTED.duplicateCodes],
    ["missing product codes", audit.missingProductCodes, AUTUMN_EXPECTED.missingProductCodes],
    ["missing unit prices", audit.missingUnitPrices, AUTUMN_EXPECTED.missingUnitPrices],
    ["missing Chinese names", audit.missingChineseNames, AUTUMN_EXPECTED.missingChineseNames],
    ["missing English names", audit.missingEnglishNames, AUTUMN_EXPECTED.missingEnglishNames],
    ["missing dimensions", audit.missingDimensions, AUTUMN_EXPECTED.missingDimensions],
    ["rejected rows", audit.rejectedRows, AUTUMN_EXPECTED.rejectedRows],
    ["TT2101 rows", audit.codeTT2101, AUTUMN_EXPECTED.codeTT2101],
    ["TT2101M rows", audit.codeTT2101M, AUTUMN_EXPECTED.codeTT2101M],
  ];

  const problems = checks
    .filter(([, actual, expected]) => actual !== expected)
    .map(([label, actual, expected]) => `${label}: expected ${expected}, found ${actual}`);

  for (const code of POST_COMMIT_LOOKUP_CODES) {
    const found = codeCounts.get(code) ?? 0;
    if (found !== 1) problems.push(`${code}: expected 1 source row, found ${found}`);
  }

  return problems;
}

export function codeCounts(plan: ImportPlan): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of plan.valid) {
    const code = row.record.product_code;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

const REPORT_BOM = "\uFEFF";

export interface ImportCli {
  commit: boolean;
  verify: boolean;
  sourceDir: string;
  batch: string;
  replaceActiveCatalogue: boolean;
  approveCollisions: boolean;
}

export function parseImportArgs(argv: string[]): ImportCli {
  let sourceDir = SOURCE_DIR;
  let batch = SOURCE_BATCH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      const value = argv[index + 1];
      if (!value) throw new Error("--source requires a directory.");
      sourceDir = value;
      index += 1;
    } else if (arg === "--batch") {
      const value = argv[index + 1];
      if (!value) throw new Error("--batch requires a name.");
      batch = value;
      index += 1;
    }
  }

  return {
    commit: argv.includes("--commit"),
    verify: argv.includes("--verify"),
    sourceDir,
    batch,
    replaceActiveCatalogue: argv.includes("--replace-active-catalogue"),
    approveCollisions: argv.includes("--approve-collisions"),
  };
}

export function isAutumnRequest(cli: ImportCli): boolean {
  const source = cli.sourceDir.replace(/\\/g, "/").replace(/\/+$/, "");
  return (
    cli.replaceActiveCatalogue ||
    cli.batch === AUTUMN_BATCH ||
    source.endsWith("data/import/2026-autumn") ||
    source.endsWith("/2026-autumn")
  );
}

export type ImportEnv = Record<string, string | undefined>;

export function loadEnvFile(filePath: string, env: ImportEnv): void {
  if (!existsSync(filePath)) return;
  for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
}

export function resolveServiceCredentials(env: ImportEnv): {
  url: string | undefined;
  secretKey: string | undefined;
} {
  return {
    url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export interface CatalogueCounts {
  inquiries: number;
  inquiryItems: number;
}

export interface ProductDatabase {
  fetchAllProducts(): Promise<ExistingProduct[]>;
  fetchCounts(): Promise<CatalogueCounts>;
  replaceCatalogue(batch: string, rows: CatalogueReplacementRow[]): Promise<unknown>;
}

export function toReplacementRows(valid: ValidRow[]): CatalogueReplacementRow[] {
  return valid.map((row) => {
    if (row.record.unit_price === null) {
      throw new Error(`Cannot commit ${row.record.product_code} without a unit price.`);
    }
    return {
      product_code: row.record.product_code,
      chinese_name: row.record.chinese_name,
      english_name: row.record.english_name,
      unit_price: row.record.unit_price,
      currency: row.record.currency,
      dimensions: row.record.dimensions,
      source_file: row.record.source_file,
    };
  });
}

export function toIncoming(valid: ValidRow[]): IncomingComparable[] {
  return valid.map((row) => ({
    product_code: row.record.product_code,
    chinese_name: row.record.chinese_name,
    english_name: row.record.english_name,
    unit_price: row.record.unit_price,
    currency: row.record.currency,
    dimensions: row.record.dimensions,
    source_file: row.record.source_file,
  }));
}

export function autumnPreviewCsv(
  valid: ValidRow[],
  classified: Map<string, { kind: string; existingId: string; identical: string }>,
): string {
  return toCsv(
    [
      "source_file",
      "source_row",
      "origin",
      "original_product_code",
      "product_code",
      "code_normalized",
      "chinese_name",
      "english_name",
      "unit_price",
      "currency",
      "dimensions",
      "classification",
      "existing_id",
      "fields_identical",
      "source_batch",
    ],
    valid.map((row) => {
      const match = classified.get(row.record.product_code);
      return [
        row.sourceFile,
        row.excelRow,
        row.origin,
        row.originalCode,
        row.record.product_code,
        row.normalized ? "yes" : "no",
        row.record.chinese_name,
        row.record.english_name,
        row.priceText,
        row.record.currency,
        row.record.dimensions,
        match?.kind ?? "new",
        match?.existingId ?? "",
        match?.identical ?? "",
        row.record.source_batch,
      ];
    }),
  );
}

export interface ImportRunOptions {
  argv: string[];
  env?: ImportEnv;
  database?: ProductDatabase;
  cwd?: string;
  writeTextFile?: (filePath: string, contents: string) => void;
  log?: (message: string) => void;
}

export async function createSupabaseDatabase(
  env: ImportEnv,
  allowWrite: boolean,
): Promise<ProductDatabase> {
  const { url, secretKey } = resolveServiceCredentials(env);
  if (!url || !secretKey) {
    throw new Error(
      "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set.",
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const columns = PRODUCT_BACKUP_COLUMNS.join(", ");

  return {
    async fetchAllProducts() {
      const pageSize = 1000;
      const rows: ExistingProduct[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("products")
          .select(columns)
          .order("product_code", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const page = (data ?? []) as unknown as ExistingProduct[];
        for (const row of page) {
          for (const column of PRODUCT_BACKUP_COLUMNS) {
            if (!(column in (row as object))) {
              throw new Error(`Product row is missing ${column}.`);
            }
          }
        }
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
    },
    async fetchCounts() {
      const inquiries = await supabase
        .from("inquiries")
        .select("id", { count: "exact", head: true });
      if (inquiries.error) throw new Error(inquiries.error.message);
      if (inquiries.count === null) throw new Error("No count returned for inquiries.");

      const inquiryItems = await supabase
        .from("inquiry_items")
        .select("id", { count: "exact", head: true });
      if (inquiryItems.error) throw new Error(inquiryItems.error.message);
      if (inquiryItems.count === null) throw new Error("No count returned for inquiry_items.");

      return { inquiries: inquiries.count, inquiryItems: inquiryItems.count };
    },
    async replaceCatalogue(batch, rows) {
      if (!allowWrite) throw new Error("Database writes are disabled.");
      const { data, error } = await supabase.rpc("replace_active_product_catalogue", {
        p_batch: batch,
        p_products: rows,
      });
      if (error) throw new Error(error.message);
      return data;
    },
  };
}

export async function finishCatalogueCommit(input: {
  commit: boolean;
  batch: string;
  replaceActiveCatalogue: boolean;
  approveCollisions: boolean;
  auditProblems: string[];
  validUniqueCount: number;
  collisionReportWritten: boolean;
  backupWritten: boolean;
  serviceCredentials: boolean;
  ambiguousCodes: string[];
  rows: CatalogueReplacementRow[];
  beforeProducts: ExistingProduct[];
  beforeCounts: CatalogueCounts;
  database: ProductDatabase;
  log: (message: string) => void;
}): Promise<number> {
  if (!input.commit) {
    input.log("Dry run complete. No database writes were attempted.");
    return 0;
  }

  const reasons = commitRefusalReasons({
    replaceActiveCatalogue: input.replaceActiveCatalogue,
    approveCollisions: input.approveCollisions,
    batch: input.batch,
    auditProblems: input.auditProblems,
    validUniqueCount: input.validUniqueCount,
    collisionReportWritten: input.collisionReportWritten,
    backupWritten: input.backupWritten,
    hasServiceCredentials: input.serviceCredentials,
    ambiguousCodes: input.ambiguousCodes,
  });

  if (reasons.length > 0) {
    input.log("Refusing to commit:");
    for (const reason of reasons) input.log(`  ${reason}`);
    return 1;
  }

  input.log(`Committing ${input.rows.length} products in one transaction.`);
  try {
    await input.database.replaceCatalogue(input.batch, input.rows);
  } catch (error) {
    input.log(error instanceof Error ? error.message : String(error));
    input.log("The replacement was not committed. A failed RPC rolls the transaction back.");
    return 1;
  }

  const afterProducts = await input.database.fetchAllProducts();
  const afterCounts = await input.database.fetchCounts();
  const problems = verifyReplacedCatalogue({
    beforeProducts: input.beforeProducts,
    afterProducts,
    autumnCodes: input.rows.map((row) => row.product_code),
    inquiriesBefore: input.beforeCounts.inquiries,
    inquiriesAfter: afterCounts.inquiries,
    inquiryItemsBefore: input.beforeCounts.inquiryItems,
    inquiryItemsAfter: afterCounts.inquiryItems,
  });

  if (problems.length > 0) {
    input.log("Post-commit verification failed:");
    for (const problem of problems) input.log(`  ${problem}`);
    return 1;
  }

  input.log("Commit complete and post-commit verification passed.");
  return 0;
}

async function upsertInBatches(records: ProductRecord[], env: ImportEnv, log: (message: string) => void) {
  const { url, secretKey } = resolveServiceCredentials(env);
  if (!url || !secretKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY must be set in the environment to commit.",
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const batch = records.slice(start, start + BATCH_SIZE);
    const { error } = await supabase.from("products").upsert(batch, { onConflict: "product_code" });
    if (error) {
      throw new Error(
        `Batch starting at row ${start + 1} failed: ${error.message}. Earlier batches are already committed.`,
      );
    }
    log(`  committed ${start + batch.length}/${records.length}`);
  }
}

export async function runProductImport(input: ImportRunOptions): Promise<number> {
  const cwd = input.cwd ?? process.cwd();
  const env = { ...input.env };
  loadEnvFile(path.join(cwd, ".env.local"), env);
  const log = input.log ?? ((message: string) => console.log(message));
  const written = new Map<string, string>();
  const writeTextFile = (filePath: string, contents: string) => {
    written.set(path.resolve(cwd, filePath), contents);
    if (input.writeTextFile) {
      input.writeTextFile(filePath, contents);
      return;
    }
    mkdirSync(path.dirname(path.resolve(cwd, filePath)), { recursive: true });
    writeFileSync(path.resolve(cwd, filePath), contents, "utf8");
  };

  const cli = parseImportArgs(input.argv);
  const autumn = isAutumnRequest(cli);
  log(cli.commit ? "Mode: COMMIT" : "Mode: DRY RUN (no database writes)");
  log(`Source: ${cli.sourceDir}`);
  log(`Batch: ${cli.batch}`);

  if (autumn) return runAutumnImport({ ...input, cwd, env, log, writeTextFile, written, cli });
  return runSpringImport({ cwd, env, log, writeTextFile, cli });
}

async function runSpringImport(input: {
  cwd: string;
  env: ImportEnv;
  log: (message: string) => void;
  writeTextFile: (filePath: string, contents: string) => void;
  cli: ImportCli;
}): Promise<number> {
  const sourceDir = path.resolve(input.cwd, input.cli.sourceDir);
  const files = listWorkbooks(sourceDir);
  const rows = readAllWorkbooks(sourceDir);
  const plan = buildImportPlan(rows);
  input.writeTextFile(PREVIEW_CSV, REPORT_BOM + previewCsv(plan.valid));
  input.writeTextFile(ERRORS_CSV, REPORT_BOM + errorsCsv(plan.rejected));

  input.log("Summary");
  input.log(`  workbooks read           : ${files.length}`);
  input.log(`  source rows              : ${plan.stats.sourceRows}`);
  input.log(`  valid import rows        : ${plan.stats.validRows}`);
  input.log(`  rejected rows            : ${plan.stats.rejectedRows}`);
  input.log(`  duplicate codes          : ${plan.stats.duplicateCodes}`);
  input.log(`  duplicate rows rejected  : ${plan.stats.duplicateRows}`);
  input.log(`  missing-price rows       : ${plan.stats.missingPriceRows}`);
  input.log(`  normalized product codes : ${plan.stats.normalizedCodes}`);
  input.log(`Reports: ${PREVIEW_CSV}, ${ERRORS_CSV}`);

  const problems = checkExpectations(plan.stats);
  if (problems.length > 0) {
    input.log("Audit mismatch:");
    for (const problem of problems) input.log(`  ${problem}`);
  } else {
    input.log("Audit matches the approved expectations.");
  }

  if (!input.cli.commit) {
    input.log("Dry run complete. No database writes were attempted.");
    return 0;
  }
  if (problems.length > 0) {
    input.log("Refusing to commit: the data no longer matches the audit.");
    return 1;
  }

  input.log(`Committing ${plan.valid.length} rows in batches of ${BATCH_SIZE}.`);
  await upsertInBatches(
    plan.valid.map((row) => row.record),
    input.env,
    input.log,
  );
  input.log("Commit complete.");
  return 0;
}

async function runAutumnImport(
  input: ImportRunOptions & {
    cwd: string;
    env: ImportEnv;
    log: (message: string) => void;
    writeTextFile: (filePath: string, contents: string) => void;
    written: Map<string, string>;
    cli: ImportCli;
  },
): Promise<number> {
  const sourceDir = path.resolve(input.cwd, input.cli.sourceDir);
  const files = listWorkbookFiles(sourceDir, true);
  if (files.length === 0) throw new Error(`No workbooks found in ${sourceDir}.`);

  const rows = files.flatMap((file) =>
    readWorkbookRows(file, {
      displayed: true,
      keepRowsWithoutCode: true,
      origin: originFromWorkbookPath(sourceDir, file),
    }),
  );
  const plan = buildImportPlan(rows, {
    sourceBatch: input.cli.batch,
    protectedCodes: [],
    requirePrice: true,
  });
  const audit = autumnAudit(plan);
  const problems = checkAutumnAudit(audit, codeCounts(plan));

  const chinaFiles = files.filter((file) => originFromWorkbookPath(sourceDir, file) === "China").length;
  const japanFiles = files.filter((file) => originFromWorkbookPath(sourceDir, file) === "Japan").length;
  const chinaRows = rows.filter((row) => row.origin === "China").length;
  const japanRows = rows.filter((row) => row.origin === "Japan").length;

  input.log(`China workbooks: ${chinaFiles}`);
  input.log(`Japan workbooks: ${japanFiles}`);
  input.log(`China source rows: ${chinaRows}`);
  input.log(`Japan source rows: ${japanRows}`);
  input.log(`Source rows: ${audit.sourceRows}`);
  input.log(`Valid import rows: ${audit.validRows}`);
  input.log(`Unique product codes: ${audit.uniqueCodes}`);
  input.log(`Duplicate product codes: ${audit.duplicateCodes}`);
  input.log(`Missing product codes: ${audit.missingProductCodes}`);
  input.log(`Missing unit prices: ${audit.missingUnitPrices}`);
  input.log(`Missing Chinese names: ${audit.missingChineseNames}`);
  input.log(`Missing English names: ${audit.missingEnglishNames}`);
  input.log(`Missing dimensions: ${audit.missingDimensions}`);
  input.log(`Rejected rows: ${audit.rejectedRows}`);
  input.log(`TT2101: ${audit.codeTT2101}`);
  input.log(`TT2101M: ${audit.codeTT2101M}`);
  input.log(
    "products has no origin or country column. China and Japan are recorded only in the preview report. No origin migration was added.",
  );

  input.writeTextFile(AUTUMN_ERRORS_CSV, REPORT_BOM + errorsCsv(plan.rejected));

  if (problems.length > 0) {
    input.writeTextFile(AUTUMN_PREVIEW_CSV, REPORT_BOM + autumnPreviewCsv(plan.valid, new Map()));
    input.log("Audit mismatch. Aborting before database comparison.");
    for (const problem of problems) input.log(`  ${problem}`);
    input.log("Dry run stopped. No database writes were attempted.");
    return 1;
  }

  input.log("Audit matches the autumn expectations.");

  if (input.cli.verify && !input.cli.commit) {
    return verifyAgainstBackup(input);
  }

  const database =
    input.database ?? (await createSupabaseDatabase(input.env, input.cli.commit));
  const existing = await database.fetchAllProducts();
  const counts = await database.fetchCounts();
  input.writeTextFile(
    AUTUMN_BACKUP_CSV,
    REPORT_BOM + toCsv([...PRODUCT_BACKUP_COLUMNS], backupCsvRecords(existing)),
  );
  input.writeTextFile(
    AUTUMN_COUNTS_JSON,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        products: existing.length,
        activeProducts: existing.filter((product) => product.active).length,
        inquiries: counts.inquiries,
        inquiryItems: counts.inquiryItems,
        batch: input.cli.batch,
      },
      null,
      2,
    ) + "\n",
  );

  const backupText = input.written.get(path.resolve(input.cwd, AUTUMN_BACKUP_CSV)) ?? "";
  const backupRows = productsFromBackupCsv(backupText);
  const backupWritten = backupRows.length === existing.length && existing.length > 0;
  input.log(
    backupWritten
      ? `Backup wrote ${backupRows.length} existing product rows to ${AUTUMN_BACKUP_CSV}.`
      : "Backup failed: the written CSV does not match the fetched catalogue.",
  );

  const classified = classifyIncoming(toIncoming(plan.valid), existing);
  const classByCode = new Map(
    classified.collisions.map((collision) => [
      collision.productCode,
      {
        kind: collision.comparison.identical ? "identical" : "changed",
        existingId: collision.existing.id,
        identical: collision.comparison.identical ? "yes" : "no",
      },
    ]),
  );
  input.writeTextFile(AUTUMN_PREVIEW_CSV, REPORT_BOM + autumnPreviewCsv(plan.valid, classByCode));
  input.writeTextFile(
    AUTUMN_COLLISIONS_CSV,
    REPORT_BOM + toCsv([...COLLISION_CSV_HEADERS], collisionCsvRecords(classified.collisions)),
  );
  const collisionReportWritten = input.written.has(path.resolve(input.cwd, AUTUMN_COLLISIONS_CSV));

  input.log(`New product codes: ${classified.counts.new}`);
  input.log(`Identical existing products: ${classified.counts.identical}`);
  input.log(`Changed existing products: ${classified.counts.changed}`);
  input.log(`Suspicious collisions: ${classified.counts.suspicious}`);
  if (classified.ambiguous.length > 0) {
    input.log(`Ambiguous existing codes: ${classified.ambiguous.join(", ")}`);
  }
  for (const collision of classified.collisions.filter((item) => item.comparison.suspicious)) {
    input.log(`SUSPICIOUS ${collision.productCode} uuid=${collision.existing.id}`);
    input.log(`  existing Chinese: ${collision.existing.chinese_name ?? ""}`);
    input.log(`  incoming Chinese: ${collision.incoming.chinese_name}`);
    input.log(`  existing English: ${collision.existing.english_name ?? ""}`);
    input.log(`  incoming English: ${collision.incoming.english_name}`);
    input.log(`  existing price: ${collision.existing.unit_price ?? ""}`);
    input.log(`  incoming price: ${collision.incoming.unit_price ?? ""}`);
    input.log(`  existing dimensions: ${collision.existing.dimensions ?? ""}`);
    input.log(`  incoming dimensions: ${collision.incoming.dimensions}`);
    input.log(`  differences: ${collision.comparison.differences.join(", ")}`);
    input.log(`  action: ${collision.recommendedAction}`);
  }
  input.log(`Reports: ${AUTUMN_PREVIEW_CSV}`);
  input.log(`         ${AUTUMN_COLLISIONS_CSV}`);
  input.log(`         ${AUTUMN_ERRORS_CSV}`);
  input.log(`         ${AUTUMN_BACKUP_CSV}`);
  input.log("Proposed commit command, not executed by a dry run:");
  input.log(AUTUMN_COMMIT_COMMAND);
  input.log("Proposed post-commit verification command:");
  input.log(AUTUMN_VERIFY_COMMAND);

  const exitCode = await finishCatalogueCommit({
    commit: input.cli.commit,
    batch: input.cli.batch,
    replaceActiveCatalogue: input.cli.replaceActiveCatalogue,
    approveCollisions: input.cli.approveCollisions,
    auditProblems: classified.ambiguous.length > 0 ? ["ambiguous existing product codes"] : [],
    validUniqueCount: audit.uniqueCodes,
    collisionReportWritten,
    backupWritten,
    serviceCredentials: hasServiceCredentials(input.env),
    ambiguousCodes: classified.ambiguous,
    rows: toReplacementRows(plan.valid),
    beforeProducts: existing,
    beforeCounts: counts,
    database,
    log: input.log,
  });

  if (exitCode === 0 && (!backupWritten || classified.ambiguous.length > 0)) return 1;
  return exitCode;
}

async function verifyAgainstBackup(input: {
  cwd: string;
  env: ImportEnv;
  log: (message: string) => void;
  database?: ProductDatabase;
  cli: ImportCli;
}): Promise<number> {
  const backupPath = path.resolve(input.cwd, AUTUMN_BACKUP_CSV);
  const countsPath = path.resolve(input.cwd, AUTUMN_COUNTS_JSON);
  if (!existsSync(backupPath) || !existsSync(countsPath)) {
    input.log("Refusing to verify without the dry-run backup and pre-commit counts.");
    return 1;
  }

  const previewPath = path.resolve(input.cwd, AUTUMN_PREVIEW_CSV);
  if (!existsSync(previewPath)) {
    input.log("Refusing to verify without the autumn preview report.");
    return 1;
  }
  const beforeProducts = productsFromBackupCsv(readFileSync(backupPath, "utf8"));
  const counts = JSON.parse(readFileSync(countsPath, "utf8")) as {
    inquiries: number;
    inquiryItems: number;
  };
  const preview = parseCsv(readFileSync(previewPath, "utf8"));
  const codeIndex = (preview[0] ?? []).indexOf("product_code");
  if (codeIndex < 0) {
    input.log("Refusing to verify because the preview report has no product_code column.");
    return 1;
  }
  const autumnCodes = preview.slice(1).map((row) => row[codeIndex] ?? "").filter((code) => code !== "");
  const database = input.database ?? (await createSupabaseDatabase(input.env, false));
  const afterProducts = await database.fetchAllProducts();
  const afterCounts = await database.fetchCounts();
  const problems = verifyReplacedCatalogue({
    beforeProducts,
    afterProducts,
    autumnCodes,
    inquiriesBefore: counts.inquiries,
    inquiriesAfter: afterCounts.inquiries,
    inquiryItemsBefore: counts.inquiryItems,
    inquiryItemsAfter: afterCounts.inquiryItems,
  });

  if (problems.length > 0) {
    input.log("Post-commit verification failed:");
    for (const problem of problems) input.log(`  ${problem}`);
    return 1;
  }

  input.log("Post-commit verification passed.");
  for (const code of POST_COMMIT_LOOKUP_CODES) {
    const match = afterProducts.find(
      (product) => product.product_code.trim().toUpperCase() === code && product.active,
    );
    input.log(`Lookup ${code}: ${match ? `active ${match.id}` : "missing"}`);
  }
  return 0;
}

async function main() {
  const code = await runProductImport({ argv: process.argv.slice(2) });
  if (code !== 0) process.exitCode = code;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
