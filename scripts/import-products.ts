/**
 * One-time, auditable product import for the 2026 Spring Canton Fair workbooks.
 *
 * Run a dry run (the default — it never touches the database):
 *   node scripts/import-products.ts
 *
 * Commit, once the dry run has been reviewed and approved:
 *   node scripts/import-products.ts --commit
 *
 * Credentials are read from SUPABASE_URL and SUPABASE_SECRET_KEY in the
 * server-side environment, only in --commit mode, and are never logged.
 */

import * as fs from "node:fs";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

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

export const SHEET_NAME = "Sheet1";
/** Row 1 holds technical field names; rows 2-6 are template rows. */
export const HEADER_EXCEL_ROW = 1;
export const DATA_START_EXCEL_ROW = 7;

export const SOURCE_BATCH = "2026 Spring Canton Fair";
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

/** Validates and maps one source row, ignoring cross-file duplicates. */
export function validateRow(row: SourceRow): RowResult {
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

  const length = parseDimension(row.mdz_l);
  const width = parseDimension(row.mdz_w);
  const height = parseDimension(row.mdz_h);
  if (length === null) errors.push("Missing or invalid length (mdz_l).");
  if (width === null) errors.push("Missing or invalid width (mdz_w).");
  if (height === null) errors.push("Missing or invalid height (mdz_h).");

  if (PROTECTED_PRODUCT_CODES.includes(productCode)) {
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
      dimensions: formatDimensions(length, width, height),
      // Packaging and barcode are never inferred: the template has no barcode
      // field, and bc_default is a packaging method rather than a barcode.
      packaging: null,
      barcode: null,
      active: true,
      source_batch: SOURCE_BATCH,
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
export function buildImportPlan(rows: SourceRow[]): ImportPlan {
  const results = rows.map(validateRow);

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

/** Reads the product rows out of one workbook. */
export function readWorkbookRows(filePath: string): SourceRow[] {
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
    // Trailing template padding: thousands of empty rows follow the data.
    if (trimText(hh) === "") continue;

    rows.push({
      sourceFile: fileName,
      excelRow: index + 1,
      hh,
      pm: cell(formatted, "pm") ?? cell(raw, "pm"),
      pm_e: cell(formatted, "pm_e") ?? cell(raw, "pm_e"),
      bj: cell(raw, "bj"),
      mdz_l: cell(raw, "mdz_l"),
      mdz_w: cell(raw, "mdz_w"),
      mdz_h: cell(raw, "mdz_h"),
    });
  }

  return rows;
}

/** The workbooks in a directory, ignoring Excel's "~$" lock files. */
export function listWorkbooks(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => /\.xlsx?$/i.test(name) && !name.startsWith("~$"))
    .sort();
}

export function readAllWorkbooks(directory: string): SourceRow[] {
  const files = listWorkbooks(directory);

  if (files.length === 0) {
    throw new Error(`No workbooks found in ${directory}.`);
  }

  return files.flatMap((name) => readWorkbookRows(path.join(directory, name)));
}

function printSummary(stats: ImportStats, files: number) {
  console.log("Summary");
  console.log(`  workbooks read           : ${files}`);
  console.log(`  source rows              : ${stats.sourceRows}`);
  console.log(`  valid import rows        : ${stats.validRows}`);
  console.log(`  rejected rows            : ${stats.rejectedRows}`);
  console.log(`  duplicate codes          : ${stats.duplicateCodes}`);
  console.log(`  duplicate rows rejected  : ${stats.duplicateRows}`);
  console.log(`  missing-price rows       : ${stats.missingPriceRows}`);
  console.log(`  normalized product codes : ${stats.normalizedCodes}`);
}

async function upsertInBatches(records: ProductRecord[]) {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

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
    const { error } = await supabase
      .from("products")
      .upsert(batch, { onConflict: "product_code" });

    if (error) {
      throw new Error(
        `Batch starting at row ${start + 1} failed: ${error.message}. Earlier batches are already committed.`,
      );
    }

    console.log(`  committed ${start + batch.length}/${records.length}`);
  }
}

async function main() {
  const commit = process.argv.slice(2).includes("--commit");

  console.log(commit ? "Mode: COMMIT" : "Mode: DRY RUN (no database writes)");
  console.log(`Source: ${SOURCE_DIR}\n`);

  const files = listWorkbooks(SOURCE_DIR);
  const rows = readAllWorkbooks(SOURCE_DIR);
  const plan = buildImportPlan(rows);

  mkdirSync(REPORT_DIR, { recursive: true });
  // A BOM keeps Excel from mangling the Chinese names.
  writeFileSync(PREVIEW_CSV, "\uFEFF" + previewCsv(plan.valid), "utf8");
  writeFileSync(ERRORS_CSV, "\uFEFF" + errorsCsv(plan.rejected), "utf8");

  printSummary(plan.stats, files.length);
  console.log(`\nReports\n  ${PREVIEW_CSV}\n  ${ERRORS_CSV}`);

  if (plan.rejected.length > 0) {
    console.log("\nRejected rows");
    for (const row of plan.rejected) {
      console.log(
        `  ${row.originalCode} — ${row.sourceFile} row ${row.excelRow}\n    ${row.errors.join("\n    ")}`,
      );
    }
  }

  const problems = checkExpectations(plan.stats);

  if (problems.length > 0) {
    console.log("\nAudit mismatch:");
    for (const problem of problems) console.log(`  ${problem}`);
  } else {
    console.log("\nAudit matches the approved expectations.");
  }

  if (!commit) {
    console.log("\nDry run complete. No database writes were attempted.");
    return;
  }

  if (problems.length > 0) {
    console.error("\nRefusing to commit: the data no longer matches the audit.");
    process.exitCode = 1;
    return;
  }

  console.log(`\nCommitting ${plan.valid.length} rows in batches of ${BATCH_SIZE}…`);
  await upsertInBatches(plan.valid.map((row) => row.record));
  console.log("Commit complete.");
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
