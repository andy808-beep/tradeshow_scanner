import * as nodeFs from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import XLSX from "xlsx";
import {
  AUTUMN_BATCH,
  autumnAudit,
  buildImportPlan,
  checkAutumnAudit,
  checkExpectations,
  codeCounts,
  CURRENCY,
  dimensionToken,
  EXPECTED,
  errorsCsv,
  formatDimensions,
  isWorkbookName,
  listWorkbookFiles,
  normalizeProductCode,
  originFromWorkbookPath,
  parseDimension,
  parsePrice,
  previewCsv,
  PROTECTED_PRODUCT_CODES,
  readWorkbookRows,
  roundTo,
  runProductImport,
  SOURCE_BATCH,
  SOURCE_COLUMNS,
  toCsv,
  validateRow,
  type SourceRow,
} from "./import-products";

function row(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    sourceFile: "2026年春交录入-粉底.xls",
    excelRow: 7,
    hh: "K9000-01",
    pm: "杯碟-红",
    pm_e: "Cup and Saucer - Red",
    bj: 2.4,
    mdz_l: 11,
    mdz_w: 8.5,
    mdz_h: 6,
    ...overrides,
  };
}

describe("normalizeProductCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeProductCode("  k9426S-19 ")).toBe("K9426S-19");
  });

  it("keeps hyphens and never yields a number", () => {
    const code = normalizeProductCode("K10188-13");
    expect(code).toBe("K10188-13");
    expect(typeof code).toBe("string");
    expect(code).toContain("-");
  });

  it("keeps an all-digit code as text with no float rounding", () => {
    expect(normalizeProductCode("0012300")).toBe("0012300");
    expect(normalizeProductCode(12345)).toBe("12345");
  });

  it("returns an empty string for blanks", () => {
    expect(normalizeProductCode(null)).toBe("");
    expect(normalizeProductCode("   ")).toBe("");
  });
});

describe("parsePrice", () => {
  it("accepts a null or blank price", () => {
    expect(parsePrice(null)).toEqual({ ok: true, value: null });
    expect(parsePrice("")).toEqual({ ok: true, value: null });
    expect(parsePrice("   ")).toEqual({ ok: true, value: null });
  });

  it("rounds to at most four decimal places", () => {
    expect(parsePrice(1.9800000000000002)).toEqual({ ok: true, value: 1.98 });
    expect(parsePrice(2.123456789)).toEqual({ ok: true, value: 2.1235 });
    expect(parsePrice("2.541")).toEqual({ ok: true, value: 2.541 });
  });

  it("rejects negative prices", () => {
    const result = parsePrice(-1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/negative/);
  });

  it("rejects values that are not numbers", () => {
    expect(parsePrice("询价").ok).toBe(false);
    expect(parsePrice("abc").ok).toBe(false);
  });

  it("accepts zero", () => {
    expect(parsePrice(0)).toEqual({ ok: true, value: 0 });
  });
});

describe("parseDimension", () => {
  it("returns null when absent or not positive", () => {
    expect(parseDimension(null)).toBeNull();
    expect(parseDimension("")).toBeNull();
    expect(parseDimension(0)).toBeNull();
    expect(parseDimension(-3)).toBeNull();
    expect(parseDimension("abc")).toBeNull();
  });

  it("clears binary float noise", () => {
    expect(parseDimension(9.100000000000001)).toBe(9.1);
  });
});

describe("formatDimensions", () => {
  it("formats as L × W × H cm", () => {
    expect(formatDimensions(11, 9.1, 2)).toBe("11 × 9.1 × 2 cm");
  });
});

describe("roundTo", () => {
  it("rounds to the requested precision", () => {
    expect(roundTo(1.23456, 4)).toBe(1.2346);
    expect(roundTo(1.005, 2)).toBe(1.0);
  });
});

describe("validateRow", () => {
  it("maps the confirmed field names", () => {
    const result = validateRow(row());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.record).toEqual({
      product_code: "K9000-01",
      chinese_name: "杯碟-红",
      english_name: "Cup and Saucer - Red",
      unit_price: 2.4,
      currency: CURRENCY,
      dimensions: "11 × 8.5 × 6 cm",
      packaging: null,
      barcode: null,
      active: true,
      source_batch: SOURCE_BATCH,
      source_file: "2026年春交录入-粉底.xls",
    });
  });

  it("uses USD as the currency", () => {
    expect(CURRENCY).toBe("USD");
  });

  it("accepts a row with no price", () => {
    const result = validateRow(row({ hh: "k9426S-19", bj: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.record.unit_price).toBeNull();
    expect(result.record.product_code).toBe("K9426S-19");
    expect(result.originalCode).toBe("k9426S-19");
    expect(result.normalized).toBe(true);
  });

  it("requires both names and all three dimensions", () => {
    for (const patch of [
      { pm: null },
      { pm_e: null },
      { mdz_l: null },
      { mdz_w: null },
      { mdz_h: null },
    ]) {
      expect(validateRow(row(patch)).ok).toBe(false);
    }
  });

  it("reports every problem on a row at once", () => {
    const result = validateRow(row({ pm: null, pm_e: null, bj: -5 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(3);
  });

  it("never reads sccb or bc_default", () => {
    expect(SOURCE_COLUMNS).not.toContain("sccb");
    expect(SOURCE_COLUMNS).not.toContain("bc_default");

    // Even when present on the row object, neither reaches the record.
    const result = validateRow({
      ...row(),
      ...({ sccb: 99.5, bc_default: "6 pcs / carton" } as Partial<SourceRow>),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.unit_price).toBe(2.4);
    expect(result.record.barcode).toBeNull();
    expect(result.record.packaging).toBeNull();
  });

  it("refuses a row that would overwrite the protected K10188-13", () => {
    const result = validateRow(row({ hh: "K10188-13" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/protected/);
  });

  it("protects K10188-13 by configuration", () => {
    expect(PROTECTED_PRODUCT_CODES).toContain("K10188-13");
  });
});

describe("buildImportPlan duplicates", () => {
  it("rejects both rows of a conflicting code", () => {
    const plan = buildImportPlan([
      row({ hh: "K9340-23", excelRow: 7, bj: 2.4, mdz_l: 11 }),
      row({
        hh: "K9340-23",
        excelRow: 9,
        sourceFile: "2026年春交录入-手绘粉底.xls",
        bj: 1.98,
        mdz_l: 12,
      }),
    ]);

    expect(plan.valid).toHaveLength(0);
    expect(plan.rejected).toHaveLength(2);
    expect(plan.stats.duplicateCodes).toBe(1);
    expect(plan.stats.duplicateRows).toBe(2);
    for (const rejected of plan.rejected) {
      expect(rejected.errors.join(" ")).toMatch(/Duplicate product code K9340-23/);
    }
  });

  it("points each K9340-23 row at its counterpart, never at itself", () => {
    const HANDPAINTED = "2026年春交录入-手绘粉底.xls";
    const PLAIN = "2026年春交录入-粉底.xls";

    const plan = buildImportPlan([
      row({ hh: "K9340-23", sourceFile: HANDPAINTED, excelRow: 7, bj: 2.4, mdz_l: 11 }),
      row({ hh: "K9340-23", sourceFile: PLAIN, excelRow: 9, bj: 1.98, mdz_l: 12 }),
    ]);

    expect(plan.rejected).toHaveLength(2);

    const handpainted = plan.rejected.find((r) => r.sourceFile === HANDPAINTED);
    const plain = plan.rejected.find((r) => r.sourceFile === PLAIN);

    expect(handpainted?.excelRow).toBe(7);
    expect(handpainted?.errors.join(" ")).toContain(`${PLAIN} row 9`);
    // The plain filename is a substring of the hand-painted one, so this also
    // guards against a row citing itself.
    expect(handpainted?.errors.join(" ")).not.toContain(`${HANDPAINTED} row 7`);

    expect(plain?.excelRow).toBe(9);
    expect(plain?.errors.join(" ")).toContain(`${HANDPAINTED} row 7`);
    expect(plain?.errors.join(" ")).not.toContain(`${PLAIN} row 9`);
  });

  it("names every counterpart when a code appears three times", () => {
    const plan = buildImportPlan([
      row({ hh: "K1", sourceFile: "a.xls", excelRow: 7 }),
      row({ hh: "K1", sourceFile: "b.xls", excelRow: 8 }),
      row({ hh: "K1", sourceFile: "c.xls", excelRow: 9 }),
    ]);

    expect(plan.rejected).toHaveLength(3);

    const first = plan.rejected[0].errors.join(" ");
    expect(first).toContain("b.xls row 8");
    expect(first).toContain("c.xls row 9");
    expect(first).not.toContain("a.xls row 7");
  });

  it("rejects duplicates even when every other field matches", () => {
    const plan = buildImportPlan([
      row({ hh: "K9000-01", excelRow: 7 }),
      row({ hh: "K9000-01", excelRow: 8 }),
    ]);

    expect(plan.valid).toHaveLength(0);
    expect(plan.rejected).toHaveLength(2);
  });

  it("detects duplicates only after normalization, across files", () => {
    const plan = buildImportPlan([
      row({ hh: "k9000-01", excelRow: 7, sourceFile: "a.xls" }),
      row({ hh: "K9000-01", excelRow: 7, sourceFile: "b.xls" }),
    ]);

    expect(plan.valid).toHaveLength(0);
    expect(plan.stats.duplicateCodes).toBe(1);
    expect(plan.rejected[0].errors.join(" ")).toMatch(/b\.xls row 7/);
  });

  it("keeps distinct codes and counts the stats", () => {
    const plan = buildImportPlan([
      row({ hh: "K9000-01" }),
      row({ hh: "K9000-02", excelRow: 8 }),
      row({ hh: "k9426S-19", excelRow: 9, bj: null }),
    ]);

    expect(plan.valid).toHaveLength(3);
    expect(plan.stats).toMatchObject({
      sourceRows: 3,
      validRows: 3,
      rejectedRows: 0,
      duplicateCodes: 0,
      missingPriceRows: 1,
      normalizedCodes: 1,
    });
  });
});

describe("checkExpectations", () => {
  const audited = {
    sourceRows: 103,
    validRows: 101,
    rejectedRows: 2,
    duplicateCodes: 1,
    duplicateRows: 2,
    missingPriceRows: 1,
    normalizedCodes: 1,
  };

  it("passes on the audited numbers", () => {
    expect(checkExpectations(audited)).toEqual([]);
  });

  it("matches the approved constants", () => {
    expect(EXPECTED).toEqual({
      sourceRows: 103,
      validRows: 101,
      rejectedRows: 2,
      missingPriceRows: 1,
      normalizedCodes: 1,
    });
  });

  it("flags any drift so a commit is refused", () => {
    expect(checkExpectations({ ...audited, validRows: 100 })).toHaveLength(1);
    expect(checkExpectations({ ...audited, sourceRows: 104 })).toHaveLength(1);
    expect(checkExpectations({ ...audited, rejectedRows: 0 })).toHaveLength(1);
    expect(checkExpectations({ ...audited, missingPriceRows: 2 })).toHaveLength(1);
    expect(checkExpectations({ ...audited, normalizedCodes: 0 })).toHaveLength(1);
  });
});

describe("CSV reports", () => {
  it("quotes separators and escapes quotes", () => {
    const csv = toCsv(["a", "b"], [['x, y', 'say "hi"']]);
    expect(csv).toContain('"x, y"');
    expect(csv).toContain('"say ""hi"""');
  });

  it("preserves the original product code alongside the normalized one", () => {
    const plan = buildImportPlan([row({ hh: "k9426S-19", bj: null })]);
    const csv = previewCsv(plan.valid);

    expect(csv).toContain("k9426S-19");
    expect(csv).toContain("K9426S-19");
    expect(csv.split("\r\n")[0]).toContain("original_product_code");
  });

  it("leaves the price cell empty rather than writing zero", () => {
    const plan = buildImportPlan([row({ hh: "K9426S-19", bj: null })]);
    const line = previewCsv(plan.valid).split("\r\n")[1];
    expect(line).toContain(",,USD,");
  });

  it("lists the duplicate rows with their reasons", () => {
    const plan = buildImportPlan([
      row({ hh: "K9340-23", excelRow: 7 }),
      row({ hh: "K9340-23", excelRow: 9 }),
    ]);
    const csv = errorsCsv(plan.rejected);

    expect(csv.split("\r\n")).toHaveLength(4); // header + 2 rows + trailing
    expect(csv).toContain("K9340-23");
    expect(csv).toContain("Duplicate product code");
  });
});

describe("autumn workbook rules", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function yixingFile(file: string, data: Array<Record<string, unknown>>) {
    XLSX.set_fs(nodeFs);
    mkdirSync(path.dirname(file), { recursive: true });
    const header = [...SOURCE_COLUMNS];
    const blank = () => header.map(() => null);
    const body = data.map((record) => header.map((column) => record[column] ?? null));
    const sheet = XLSX.utils.aoa_to_sheet([
      header,
      blank(),
      blank(),
      blank(),
      blank(),
      blank(),
      ...body,
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    XLSX.writeFile(workbook, file);
  }

  it("keeps displayed dimension text and only trims surrounding whitespace", () => {
    expect(dimensionToken(" 12.50 ")).toBe("12.50");
    expect(dimensionToken(12.5)).toBe("12.5");

    const result = validateRow(
      row({
        hh: "TT2101",
        pm: "  盘  小  ",
        pm_e: " Plate S ",
        bj: " 3.15 ",
        mdz_l: "20.80",
        mdz_w: "20.80",
        mdz_h: "2.00",
      }),
      { requirePrice: true, protectedCodes: [], sourceBatch: AUTUMN_BATCH },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.chinese_name).toBe("盘  小");
    expect(result.record.english_name).toBe("Plate S");
    expect(result.record.unit_price).toBe(3.15);
    expect(result.record.dimensions).toBe("20.80 × 20.80 × 2.00 cm");
    expect(result.record.barcode).toBeNull();
    expect(result.record.source_batch).toBe(AUTUMN_BATCH);
  });

  it("rejects a missing autumn price without inventing one", () => {
    const result = validateRow(row({ bj: null }), {
      requirePrice: true,
      protectedCodes: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/Missing unit price/);
  });

  it("treats TT2101 and TT2101M as two products", () => {
    const plan = buildImportPlan(
      [
        row({ hh: "TT2101", pm: "盘 小", pm_e: "Plate S" }),
        row({ hh: " tt2101m ", excelRow: 8, pm: "21cm 盘", pm_e: "21cm Plate" }),
        row({ hh: "K1", excelRow: 9, pm_e: "Plate S" }),
      ],
      { requirePrice: true, protectedCodes: [], sourceBatch: AUTUMN_BATCH },
    );

    expect(plan.valid.map((entry) => entry.record.product_code)).toEqual([
      "TT2101",
      "TT2101M",
      "K1",
    ]);
    expect(plan.stats.duplicateCodes).toBe(0);
    expect(plan.valid.filter((entry) => entry.record.english_name === "Plate S")).toHaveLength(2);
  });

  it("discovers China and Japan workbooks recursively and does not modify them", () => {
    const root = mkdtempSync(path.join(tmpdir(), "autumn-import-"));
    tempDirs.push(root);
    const china = path.join(root, "china", "2026─Ω╟∩-Anemone.xls");
    const japan = path.join(root, "japan", "nested", "Miyazaki.xls");
    yixingFile(china, [{ hh: "K10608-03", pm: "杯", pm_e: "Cup", bj: "1.80", mdz_l: "12.50", mdz_w: "8.30", mdz_h: "8.30" }]);
    yixingFile(japan, [{ hh: "TT2101M", pm: "盘", pm_e: "Plate", bj: 3.15, mdz_l: 20.8, mdz_w: 20.8, mdz_h: 2 }]);
    writeFileSync(path.join(root, "china", "~$lock.xls"), "");
    writeFileSync(path.join(root, "readme.txt"), "not a workbook");

    const before = statSync(china);
    const files = listWorkbookFiles(root, true);
    expect(files.map((file) => path.basename(file)).sort()).toEqual([
      "2026─Ω╟∩-Anemone.xls",
      "Miyazaki.xls",
    ]);
    expect(originFromWorkbookPath(root, china)).toBe("China");
    expect(originFromWorkbookPath(root, japan)).toBe("Japan");
    expect(isWorkbookName("~$lock.xls")).toBe(false);

    const parsed = readWorkbookRows(china, { displayed: true, origin: "China" });
    expect(parsed[0]?.sourceFile).toBe("2026─Ω╟∩-Anemone.xls");
    expect(parsed[0]?.origin).toBe("China");
    expect(parsed[0]?.hh).toBe("K10608-03");
    const after = statSync(china);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);

    const plan = buildImportPlan(
      [
        ...parsed,
        ...readWorkbookRows(japan, { displayed: true, origin: "Japan" }),
      ],
      { requirePrice: true, protectedCodes: [], sourceBatch: AUTUMN_BATCH },
    );
    expect(plan.valid[0]?.record.dimensions).toContain("12.50");
    expect(plan.valid.map((entry) => entry.record.product_code).sort()).toEqual([
      "K10608-03",
      "TT2101M",
    ]);
  });

  it("aborts a commit when the autumn audit does not match and writes nothing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "autumn-run-"));
    tempDirs.push(root);
    const file = path.join(root, "china", "one.xls");
    yixingFile(file, [{ hh: "K1", pm: "杯", pm_e: "Cup", bj: 1, mdz_l: 1, mdz_w: 1, mdz_h: 1 }]);

    const calls: string[] = [];
    const lines: string[] = [];
    const code = await runProductImport({
      argv: [
        "--source",
        root,
        "--batch",
        AUTUMN_BATCH,
        "--commit",
        "--replace-active-catalogue",
        "--approve-collisions",
      ],
      env: {},
      log: (line) => lines.push(line),
      writeTextFile: () => undefined,
      database: {
        async fetchAllProducts() {
          calls.push("fetch");
          return [];
        },
        async fetchCounts() {
          calls.push("counts");
          return { inquiries: 0, inquiryItems: 0 };
        },
        async replaceCatalogue() {
          calls.push("replace");
          return null;
        },
      },
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(lines.join("\n")).toMatch(/No database writes were attempted/);
    expect(lines.join("\n")).toMatch(/expected 661/);
  });

  it("counts a real autumn-sized plan only from its own rows", () => {
    const rows = Array.from({ length: 661 }, (_, index) =>
      row({
        hh: index === 0 ? "TT2101" : index === 1 ? "TT2101M" : `K${index}`,
        excelRow: 7 + index,
      }),
    );
    rows[2] = row({ hh: "K10608-03", excelRow: 9 });
    rows[3] = row({ hh: "KU0509-GR", excelRow: 10 });
    rows[4] = row({ hh: "78032268", excelRow: 11 });
    const plan = buildImportPlan(rows, {
      requirePrice: true,
      protectedCodes: [],
      sourceBatch: AUTUMN_BATCH,
    });
    expect(checkAutumnAudit(autumnAudit(plan), codeCounts(plan))).toEqual([]);
  });
});
