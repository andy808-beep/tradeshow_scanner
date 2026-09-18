import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedInquiryExportRow } from "@/lib/api-contract";
import { InquiryValidationError } from "@/lib/supabase/errors";
import {
  SAVED_INQUIRY_MAX_EXPORT_ROWS,
  SAVED_INQUIRY_MAX_PAGE_SIZE,
  SAVED_INQUIRY_PAGE_SIZE,
} from "@/lib/saved-inquiries/constants";
import { buildSavedInquiryCsv, csvField, savedInquiryExportFilename } from "@/lib/saved-inquiries/csv";
import { parseSavedInquiryListQuery } from "@/lib/saved-inquiries/query";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminSupabase: () => ({ from: mocks.from }),
}));

const {
  getSavedInquiry,
  listSavedInquiries,
  listSavedInquiryExportRows,
} = await import("@/lib/supabase/saved-inquiries");

const OLDER_ID = "11111111-1111-4111-8111-111111111111";
const NEWER_ID = "22222222-2222-4222-8222-222222222222";

function builder(result: unknown) {
  const query: {
    select: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    or: ReturnType<typeof vi.fn>;
    gte: ReturnType<typeof vi.fn>;
    lt: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    returns: ReturnType<typeof vi.fn>;
    then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
  } = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    or: vi.fn(() => query),
    gte: vi.fn(() => query),
    lt: vi.fn(() => query),
    eq: vi.fn(() => query),
    range: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(() => query),
    returns: vi.fn(() => query),
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return query;
}

function parsed(params: string) {
  const result = parseSavedInquiryListQuery(new URLSearchParams(params));
  if (!result.ok) throw new Error(result.errors.join(", "));
  return result.value;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saved inquiry query parsing", () => {
  it("defaults to page 1 and the standard page size", () => {
    const query = parsed("");
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(SAVED_INQUIRY_PAGE_SIZE);
    expect(SAVED_INQUIRY_PAGE_SIZE).toBe(20);
    expect(SAVED_INQUIRY_MAX_PAGE_SIZE).toBe(50);
  });

  it("rejects an oversized page and inverted dates", () => {
    expect(parseSavedInquiryListQuery(new URLSearchParams("pageSize=51")).ok).toBe(false);
    expect(parseSavedInquiryListQuery(new URLSearchParams("from=2026-09-18&to=2026-09-17")).ok).toBe(
      false,
    );
    expect(parseSavedInquiryListQuery(new URLSearchParams("from=18-09-2026")).ok).toBe(false);
  });

  it("treats date filters as inclusive UTC days", () => {
    const query = parsed("from=2026-09-18&to=2026-09-18");
    expect(query.fromIso).toBe("2026-09-18T00:00:00.000Z");
    expect(query.toExclusiveIso).toBe("2026-09-19T00:00:00.000Z");
  });
});

describe("saved inquiry CSV", () => {
  const rows: SavedInquiryExportRow[] = [
    {
      inquiryId: NEWER_ID,
      savedAt: "2026-09-18T04:00:00.000Z",
      customerName: 'Ada "Booth" Lovelace',
      companyName: "Koei, Ltd",
      generalNotes: "Line 1\nLine 2",
      currency: "USD",
      productCode: "K10188-13",
      productName: "大方盘·紫",
      quotedUnitPrice: "2.4",
      productNotes: 'Gift, "box"',
    },
    {
      inquiryId: NEWER_ID,
      savedAt: "2026-09-18T04:00:00.000Z",
      customerName: 'Ada "Booth" Lovelace',
      companyName: "Koei, Ltd",
      generalNotes: "Line 1\nLine 2",
      currency: "USD",
      productCode: "K9000-01",
      productName: "杯碟-红",
      quotedUnitPrice: "1.5",
      productNotes: "",
    },
  ];

  it("starts with a UTF-8 BOM and one row per product", () => {
    const csv = buildSavedInquiryCsv(rows);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.split("\r\n").filter((line) => line !== "")).toHaveLength(3);
    expect(csv).toContain("大方盘·紫");
    expect(csv).not.toMatch(/quantity/i);
    expect(csv).not.toMatch(/line total/i);
    expect(csv).not.toMatch(/grand total/i);
  });

  it("escapes commas, quotes and line breaks", () => {
    expect(csvField('Ada "Booth" Lovelace')).toBe('"Ada ""Booth"" Lovelace"');
    expect(csvField("Koei, Ltd")).toBe('"Koei, Ltd"');
    expect(csvField("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
    const csv = buildSavedInquiryCsv(rows);
    expect(csv).toContain('"Ada ""Booth"" Lovelace"');
    expect(csv).toContain('"Koei, Ltd"');
    expect(csv).toContain('"Line 1\nLine 2"');
    expect(csv).toContain('"Gift, ""box"""');
  });

  it("names the file with the export date", () => {
    expect(savedInquiryExportFilename(new Date(Date.UTC(2026, 8, 18)))).toBe(
      "saved-inquiries-2026-09-18.csv",
    );
  });
});

describe("saved inquiry reads", () => {
  it("lists newest first with server pagination and name/date filters", async () => {
    const query = builder({
      data: [
        {
          id: NEWER_ID,
          created_at: "2026-09-18T12:00:00.000Z",
          customer_name: "Ada",
          company_name: "Koei",
          notes: "Booth notes",
          currency: "USD",
          inquiry_items: [{ count: 2 }],
        },
      ],
      error: null,
      count: 21,
    });
    mocks.from.mockReturnValue(query);

    const result = await listSavedInquiries(parsed("q=Ada&from=2026-09-01&to=2026-09-18&page=2"));
    expect(mocks.from).toHaveBeenCalledWith("inquiries");
    expect(query.select.mock.calls[0][0]).toContain("id, created_at, customer_name");
    expect(query.select.mock.calls[0][0]).not.toContain("*");
    expect(query.select.mock.calls[0][0]).not.toMatch(/quantity/i);
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(query.or).toHaveBeenCalled();
    expect(query.gte).toHaveBeenCalledWith("created_at", "2026-09-01T00:00:00.000Z");
    expect(query.lt).toHaveBeenCalledWith("created_at", "2026-09-19T00:00:00.000Z");
    expect(query.range).toHaveBeenCalledWith(20, 39);
    expect(result.total).toBe(21);
    expect(result.inquiries[0]).toMatchObject({
      id: NEWER_ID,
      customerName: "Ada",
      companyName: "Koei",
      productCount: 2,
      hasNotes: true,
    });
  });

  it("returns snapshot fields and never reads the products table", async () => {
    const query = builder({
      data: {
        id: OLDER_ID,
        created_at: "2026-09-17T08:00:00.000Z",
        customer_name: "Ada",
        company_name: "",
        notes: "Keep these notes",
        currency: "USD",
        inquiry_items: [
          {
            product_code_snapshot: "K10188-13",
            product_name_snapshot: "Historic name",
            quoted_price: 9.99,
            notes: "Sample",
          },
        ],
      },
      error: null,
    });
    mocks.from.mockReturnValue(query);

    const inquiry = await getSavedInquiry(OLDER_ID);
    expect(mocks.from).toHaveBeenCalledWith("inquiries");
    expect(mocks.from).not.toHaveBeenCalledWith("products");
    expect(query.select.mock.calls[0][0]).toContain("product_code_snapshot");
    expect(query.select.mock.calls[0][0]).toContain("quoted_price");
    expect(query.select.mock.calls[0][0]).not.toMatch(/quantity/i);
    expect(inquiry).toMatchObject({
      id: OLDER_ID,
      notes: "Keep these notes",
      items: [
        {
          productCode: "K10188-13",
          productName: "Historic name",
          quotedUnitPrice: 9.99,
          notes: "Sample",
        },
      ],
    });
    expect(inquiry).not.toHaveProperty("quantity");
  });

  it("exports every matching product row and ignores page size", async () => {
    const query = builder({
      data: [
        {
          id: NEWER_ID,
          created_at: "2026-09-18T12:00:00.000Z",
          customer_name: "Ada",
          company_name: "Koei",
          notes: "",
          currency: "USD",
          inquiry_items: [
            {
              product_code_snapshot: "K10188-13",
              product_name_snapshot: "Plate",
              quoted_price: 2.4,
              notes: "",
            },
            {
              product_code_snapshot: "K9000-01",
              product_name_snapshot: "Cup",
              quoted_price: 1.5,
              notes: "",
            },
          ],
        },
      ],
      error: null,
    });
    mocks.from.mockReturnValue(query);

    const rows = await listSavedInquiryExportRows(parsed("q=Ada&page=2&pageSize=1"));
    expect(query.range).not.toHaveBeenCalled();
    expect(query.limit).toHaveBeenCalledWith(SAVED_INQUIRY_MAX_EXPORT_ROWS + 1);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.productCode)).toEqual(["K10188-13", "K9000-01"]);
  });

  it("rejects an export that would exceed the row cap", async () => {
    const query = builder({
      data: [
        {
          id: NEWER_ID,
          created_at: "2026-09-18T12:00:00.000Z",
          customer_name: "Ada",
          company_name: "",
          notes: "",
          currency: "USD",
          inquiry_items: Array.from({ length: SAVED_INQUIRY_MAX_EXPORT_ROWS + 1 }, (_, index) => ({
            product_code_snapshot: `K${index}`,
            product_name_snapshot: "Item",
            quoted_price: 1,
            notes: "",
          })),
        },
      ],
      error: null,
    });
    mocks.from.mockReturnValue(query);

    await expect(listSavedInquiryExportRows(parsed(""))).rejects.toBeInstanceOf(
      InquiryValidationError,
    );
  });
});

describe("saved inquiry source contracts", () => {
  it("does not select star columns or mutate inquiry records", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib", "supabase", "saved-inquiries.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/select\("\*"\)/);
    expect(source).not.toMatch(/\.from\("products"\)/);
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(source).not.toMatch(/quantity/);
  });
});
