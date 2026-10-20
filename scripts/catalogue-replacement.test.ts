import { describe, expect, it } from "vitest";
import {
  AUTUMN_ACTIVE_COUNT,
  AUTUMN_BATCH,
  applyCatalogueReplacement,
  backupCsvRecords,
  classifyIncoming,
  COLLISION_CSV_HEADERS,
  collisionCsvRecords,
  compareBusinessFields,
  parseCsv,
  PRODUCT_BACKUP_COLUMNS,
  productsFromBackupCsv,
  verifyReplacedCatalogue,
  type CatalogueReplacementRow,
  type ExistingProduct,
} from "./catalogue-replacement";
import { finishCatalogueCommit, toCsv, toReplacementRows, validateRow, type SourceRow } from "./import-products";

function existing(overrides: Partial<ExistingProduct> = {}): ExistingProduct {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    product_code: "TT2101",
    barcode: "KEEP-ME",
    chinese_name: "盘 小",
    english_name: "Plate S",
    unit_price: "3.1500",
    currency: "USD",
    dimensions: "20.80 × 20.80 × 2.00 cm",
    packaging: "carton",
    image_url: "https://example.test/tt2101.jpg",
    active: true,
    source_batch: "2026 Spring Canton Fair",
    source_file: "spring.xls",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function incoming(overrides: Partial<CatalogueReplacementRow> = {}): CatalogueReplacementRow {
  return {
    product_code: "TT2101",
    chinese_name: "盘 小",
    english_name: "Plate S",
    unit_price: 3.15,
    currency: "USD",
    dimensions: "20.80 × 20.80 × 2.00 cm",
    source_file: "Miyazaki.xls",
    ...overrides,
  };
}

function sourceRow(code: string): SourceRow {
  return {
    sourceFile: "Miyazaki.xls",
    excelRow: 7,
    hh: code,
    pm: "杯",
    pm_e: "Cup",
    bj: 1.25,
    mdz_l: 2,
    mdz_w: 3,
    mdz_h: 4,
  };
}

describe("collision classification", () => {
  it("separates new, identical and changed rows, including a name mismatch", () => {
    const result = classifyIncoming(
      [
        {
          product_code: "TT2101",
          chinese_name: "盘 小",
          english_name: "Plate S",
          unit_price: 3.15,
          currency: "USD",
          dimensions: "20.80 × 20.80 × 2.00 cm",
          source_file: "awasaka.xls",
        },
        {
          product_code: "TT2101M",
          chinese_name: "新盘",
          english_name: "New plate",
          unit_price: 4,
          currency: "USD",
          dimensions: "21 × 21 × 2 cm",
          source_file: "Miyazaki.xls",
        },
        {
          product_code: "K1",
          chinese_name: "新杯",
          english_name: "New cup",
          unit_price: 2,
          currency: "USD",
          dimensions: "1 × 1 × 1 cm",
          source_file: "a.xls",
        },
      ],
      [
        existing(),
        existing({
          id: "22222222-2222-4222-8222-222222222222",
          product_code: "tt2101m",
          barcode: "OTHER",
          chinese_name: "旧盘",
          english_name: "Old plate",
          unit_price: 9,
          dimensions: "1 × 1 × 1 cm",
        }),
      ],
    );

    expect(result.counts).toEqual({ new: 1, identical: 1, changed: 1, suspicious: 1 });
    expect(result.ambiguous).toEqual([]);

    const miyazaki = result.collisions.find((collision) => collision.productCode === "TT2101M");
    expect(miyazaki?.comparison.suspicious).toBe(true);
    expect(miyazaki?.comparison.differences).toEqual(
      expect.arrayContaining(["product_code", "chinese_name", "english_name", "unit_price", "dimensions"]),
    );
    expect(miyazaki?.recommendedAction).toMatch(/SUSPICIOUS/);
    expect(miyazaki?.recommendedAction).toMatch(/Do not insert a second row/);
    expect(miyazaki?.existing.id).toBe("22222222-2222-4222-8222-222222222222");

    const same = result.collisions.find((collision) => collision.productCode === "TT2101");
    expect(same?.comparison.identical).toBe(true);
    expect(compareBusinessFields(existing(), same!.incoming).identical).toBe(true);

    const csv = toCsv([...COLLISION_CSV_HEADERS], collisionCsvRecords(result.collisions));
    expect(csv).toContain("existing_id");
    expect(csv).toContain("fields_identical");
    expect(csv).toContain("recommended_action");
    expect(csv).toContain("KEEP-ME");
    expect(csv).toContain("2026 Spring Canton Fair");
    expect(csv).toContain("Miyazaki.xls");
  });

  it("does not treat a repeated English name as a duplicate product", () => {
    const left = validateRow(sourceRow("K1"));
    const right = validateRow(sourceRow("K2"));
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(left.record.english_name).toBe(right.record.english_name);
    expect(left.record.product_code).not.toBe(right.record.product_code);
  });
});

describe("catalogue replacement transaction", () => {
  const inquiries = [{ id: "inquiry-1", customer_name: "Ada" }];
  const inquiryItems = [{ id: "item-1", inquiry_id: "inquiry-1", product_code_snapshot: "OLD" }];

  it("preserves UUIDs and barcodes, deactivates legacy rows, and leaves inquiries alone", () => {
    const legacy = existing({
      id: "33333333-3333-4333-8333-333333333333",
      product_code: "OLD-1",
      barcode: "LEGACY-BAR",
      active: true,
    });
    const snapshot = {
      products: [existing(), legacy],
      inquiries,
      inquiryItems,
    };

    const result = applyCatalogueReplacement(
      snapshot,
      [incoming({ chinese_name: "盘 更新", unit_price: 3.4 }), incoming({ product_code: "TT2101M", chinese_name: "宫崎盘", english_name: "Miyazaki plate", source_file: "Miyazaki.xls" })],
      AUTUMN_BATCH,
      { createId: () => "44444444-4444-4444-8444-444444444444", now: () => "2026-10-20T10:00:00.000Z" },
    );

    expect(snapshot.inquiries).toBe(inquiries);
    expect(snapshot.inquiryItems).toBe(inquiryItems);
    expect(result.inquiries).toEqual(inquiries);
    expect(result.inquiryItems).toEqual(inquiryItems);

    const kept = result.products.find((product) => product.id === existing().id);
    expect(kept?.product_code).toBe("TT2101");
    expect(kept?.barcode).toBe("KEEP-ME");
    expect(kept?.packaging).toBe("carton");
    expect(kept?.image_url).toBe("https://example.test/tt2101.jpg");
    expect(kept?.active).toBe(true);
    expect(kept?.source_batch).toBe(AUTUMN_BATCH);
    expect(kept?.chinese_name).toBe("盘 更新");
    expect(kept?.created_at).toBe(existing().created_at);

    const retired = result.products.find((product) => product.id === legacy.id);
    expect(retired?.active).toBe(false);
    expect(retired?.barcode).toBe("LEGACY-BAR");
    expect(retired?.product_code).toBe("OLD-1");

    const added = result.products.find((product) => product.product_code === "TT2101M");
    expect(added?.id).toBe("44444444-4444-4444-8444-444444444444");
    expect(added?.active).toBe(true);
    expect(added?.barcode).toBeNull();
    expect(result.products.filter((product) => product.active)).toHaveLength(2);
  });

  it("rolls back a simulated failure without touching the original snapshot", () => {
    const snapshot = {
      products: [existing()],
      inquiries,
      inquiryItems,
    };
    const before = structuredClone(snapshot);

    expect(() =>
      applyCatalogueReplacement(snapshot, [incoming(), incoming({ product_code: "K2" })], AUTUMN_BATCH, {
        failAfterUpserts: 1,
      }),
    ).toThrow(/simulated failure/);
    expect(snapshot).toEqual(before);

    expect(() =>
      applyCatalogueReplacement(snapshot, [incoming()], AUTUMN_BATCH, {
        afterDeactivate: (draft) => {
          draft.products[0]!.barcode = "CHANGED";
        },
      }),
    ).toThrow(/barcode changed/);
    expect(snapshot).toEqual(before);
  });

  it("rejects a duplicate incoming code before any replacement", () => {
    const snapshot = { products: [existing()], inquiries, inquiryItems };
    expect(() =>
      applyCatalogueReplacement(snapshot, [incoming(), incoming()], AUTUMN_BATCH),
    ).toThrow(/duplicate product codes/);
    expect(snapshot.products[0]?.active).toBe(true);
  });
});

describe("commit gates", () => {
  function rows(count: number): CatalogueReplacementRow[] {
    return Array.from({ length: count }, (_, index) =>
      incoming({
        product_code: `P${String(index).padStart(4, "0")}`,
        source_file: "a.xls",
      }),
    );
  }

  const base = {
    commit: true,
    batch: AUTUMN_BATCH,
    replaceActiveCatalogue: true,
    approveCollisions: true,
    auditProblems: [] as string[],
    validUniqueCount: AUTUMN_ACTIVE_COUNT,
    collisionReportWritten: true,
    backupWritten: true,
    serviceCredentials: true,
    ambiguousCodes: [] as string[],
    beforeProducts: [] as ExistingProduct[],
    beforeCounts: { inquiries: 2, inquiryItems: 3 },
  };

  it("does not write during a dry run", async () => {
    const calls: string[] = [];
    const code = await finishCatalogueCommit({
      ...base,
      commit: false,
      rows: rows(AUTUMN_ACTIVE_COUNT),
      database: {
        async fetchAllProducts() {
          calls.push("fetch");
          return [];
        },
        async fetchCounts() {
          calls.push("counts");
          return { inquiries: 2, inquiryItems: 3 };
        },
        async replaceCatalogue() {
          calls.push("replace");
          return null;
        },
      },
      log: () => undefined,
    });

    expect(code).toBe(0);
    expect(calls).toEqual([]);
  });

  it("refuses to commit without collision approval or a completed backup", async () => {
    const calls: string[] = [];
    const database = {
      async fetchAllProducts() {
        return [];
      },
      async fetchCounts() {
        return { inquiries: 0, inquiryItems: 0 };
      },
      async replaceCatalogue() {
        calls.push("replace");
        return null;
      },
    };
    const lines: string[] = [];

    expect(
      await finishCatalogueCommit({
        ...base,
        approveCollisions: false,
        rows: rows(AUTUMN_ACTIVE_COUNT),
        database,
        log: (line) => lines.push(line),
      }),
    ).toBe(1);
    expect(
      await finishCatalogueCommit({
        ...base,
        backupWritten: false,
        rows: rows(AUTUMN_ACTIVE_COUNT),
        database,
        log: (line) => lines.push(line),
      }),
    ).toBe(1);
    expect(
      await finishCatalogueCommit({
        ...base,
        serviceCredentials: false,
        rows: rows(AUTUMN_ACTIVE_COUNT),
        database,
        log: () => undefined,
      }),
    ).toBe(1);
    expect(
      await finishCatalogueCommit({
        ...base,
        validUniqueCount: 660,
        rows: rows(660),
        database,
        log: () => undefined,
      }),
    ).toBe(1);
    expect(calls).toEqual([]);
    expect(lines.join("\n")).toMatch(/approve-collisions/);
    expect(lines.join("\n")).toMatch(/backup/);
  });

  it("commits once when every gate is present and stops if that call fails", async () => {
    const calls: CatalogueReplacementRow[][] = [];
    const rowsForCommit = rows(AUTUMN_ACTIVE_COUNT);
    const code = await finishCatalogueCommit({
      ...base,
      rows: rowsForCommit,
      beforeProducts: [],
      database: {
        async fetchAllProducts() {
          return [];
        },
        async fetchCounts() {
          return { inquiries: 2, inquiryItems: 3 };
        },
        async replaceCatalogue(_batch, payload) {
          calls.push(payload);
          throw new Error("rpc failed");
        },
      },
      log: () => undefined,
    });

    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]![0]!).sort()).toEqual([
      "chinese_name",
      "currency",
      "dimensions",
      "english_name",
      "product_code",
      "source_file",
      "unit_price",
    ]);
    expect(calls[0]![0]).not.toHaveProperty("barcode");
  });
});

describe("backup csv", () => {
  it("round-trips every product column", () => {
    const product = existing({ chinese_name: '杯, "红"' });
    const csv = toCsv([...PRODUCT_BACKUP_COLUMNS], backupCsvRecords([product]));
    const [parsed] = productsFromBackupCsv(csv);
    expect(parsed?.id).toBe(product.id);
    expect(parsed?.product_code).toBe(product.product_code);
    expect(parsed?.barcode).toBe(product.barcode);
    expect(parsed?.chinese_name).toBe('杯, "红"');
    expect(parsed?.english_name).toBe(product.english_name);
    expect(parsed?.unit_price).toBe("3.1500");
    expect(parsed?.currency).toBe("USD");
    expect(parsed?.dimensions).toBe(product.dimensions);
    expect(parsed?.packaging).toBe("carton");
    expect(parsed?.image_url).toBe(product.image_url);
    expect(parsed?.active).toBe(true);
    expect(parsed?.source_batch).toBe(product.source_batch);
    expect(parsed?.source_file).toBe(product.source_file);
    expect(parsed?.created_at).toBe(product.created_at);
    expect(parsed?.updated_at).toBe(product.updated_at);
    expect(parseCsv("\uFEFF" + csv)[0]).toEqual([...PRODUCT_BACKUP_COLUMNS]);
  });
});

describe("post-commit verification", () => {
  it("accepts a replaced catalogue and reports inquiry drift", () => {
    const before = [
      existing({ barcode: "KEEP-ME" }),
      existing({
        id: "33333333-3333-4333-8333-333333333333",
        product_code: "SPRING-1",
        barcode: "OLD",
        source_batch: "2026 Spring Canton Fair",
        active: true,
      }),
    ];
    const autumnCodes = [
      "TT2101",
      "TT2101M",
      "K10608-03",
      "KU0509-GR",
      "78032268",
      ...Array.from({ length: AUTUMN_ACTIVE_COUNT - 5 }, (_, index) => `N${index}`),
    ];
    const after: ExistingProduct[] = [
      existing({
        barcode: "KEEP-ME",
        active: true,
        source_batch: AUTUMN_BATCH,
        source_file: "awasaka.xls",
      }),
      existing({
        id: "33333333-3333-4333-8333-333333333333",
        product_code: "SPRING-1",
        barcode: "OLD",
        active: false,
        source_batch: "2026 Spring Canton Fair",
      }),
      ...autumnCodes.slice(1).map((code, index) =>
        existing({
          id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
          product_code: code,
          barcode: null,
          active: true,
          source_batch: AUTUMN_BATCH,
        }),
      ),
    ];

    expect(
      verifyReplacedCatalogue({
        beforeProducts: before,
        afterProducts: after,
        autumnCodes,
        inquiriesBefore: 4,
        inquiriesAfter: 4,
        inquiryItemsBefore: 7,
        inquiryItemsAfter: 7,
      }),
    ).toEqual([]);

    const drifted = verifyReplacedCatalogue({
      beforeProducts: before,
      afterProducts: after.map((product) =>
        product.id === before[0]?.id ? { ...product, barcode: "CHANGED" } : product,
      ),
      autumnCodes,
      inquiriesBefore: 4,
      inquiriesAfter: 5,
      inquiryItemsBefore: 7,
      inquiryItemsAfter: 8,
    });
    expect(drifted.join("\n")).toMatch(/barcode changed/);
    expect(drifted.join("\n")).toMatch(/inquiries count changed/);
    expect(drifted.join("\n")).toMatch(/inquiry_items count changed/);
  });
});

describe("replacement payload", () => {
  it("never includes a barcode", () => {
    const validated = validateRow(sourceRow("TT2101"), {
      requirePrice: true,
      protectedCodes: [],
      sourceBatch: AUTUMN_BATCH,
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const [row] = toReplacementRows([
      {
        sourceFile: "Miyazaki.xls",
        excelRow: 7,
        originalCode: "TT2101",
        normalized: false,
        priceText: "1.25",
        origin: "Japan",
        record: validated.record,
      },
    ]);
    expect(row).not.toHaveProperty("barcode");
    expect(row?.product_code).toBe("TT2101");
  });
});
