import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTHENTICATION_REQUIRED } from "@/lib/api-response";
import { InquiryValidationError } from "@/lib/supabase/errors";
import type { SavedInquiryDetail, SavedInquiryExportRow, SavedInquiryListItem } from "@/lib/api-contract";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  listSavedInquiries: vi.fn(),
  getSavedInquiry: vi.fn(),
  listSavedInquiryExportRows: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAuthServerClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/supabase/saved-inquiries", () => ({
  listSavedInquiries: mocks.listSavedInquiries,
  getSavedInquiry: mocks.getSavedInquiry,
  listSavedInquiryExportRows: mocks.listSavedInquiryExportRows,
}));

const { GET: listInquiries } = await import("@/app/api/inquiries/route");
const { GET: getInquiry } = await import("@/app/api/inquiries/[id]/route");
const { GET: exportInquiries } = await import("@/app/api/inquiries/export/route");

const INQUIRY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const LIST_ITEM: SavedInquiryListItem = {
  id: INQUIRY_ID,
  savedAt: "2026-09-18T04:00:00.000Z",
  customerName: "Ada Lovelace",
  companyName: "Koei",
  productCount: 2,
  currency: "USD",
  hasNotes: true,
};

const DETAIL: SavedInquiryDetail = {
  id: INQUIRY_ID,
  savedAt: "2026-09-18T04:00:00.000Z",
  customerName: "Ada Lovelace",
  companyName: "Koei",
  notes: "Booth A",
  currency: "USD",
  items: [
    {
      productCode: "K10188-13",
      productName: "Historic plate",
      quotedUnitPrice: 9.99,
      notes: "Gift wrap",
    },
  ],
};

const EXPORT_ROWS: SavedInquiryExportRow[] = [
  {
    inquiryId: INQUIRY_ID,
    savedAt: "2026-09-18T04:00:00.000Z",
    customerName: 'Ada "Booth"',
    companyName: "Koei, Ltd",
    generalNotes: "Line 1\nLine 2",
    currency: "USD",
    productCode: "K10188-13",
    productName: "大方盘·紫",
    quotedUnitPrice: "2.4",
    productNotes: 'Gift, "box"',
  },
  {
    inquiryId: INQUIRY_ID,
    savedAt: "2026-09-18T04:00:00.000Z",
    customerName: 'Ada "Booth"',
    companyName: "Koei, Ltd",
    generalNotes: "Line 1\nLine 2",
    currency: "USD",
    productCode: "K9000-01",
    productName: "杯碟-红",
    quotedUnitPrice: "1.5",
    productNotes: "",
  },
];

function request(url: string) {
  return new Request(url);
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "missing" } });
});

describe("unauthenticated saved-inquiry APIs return 401 JSON", () => {
  it("does not list saved inquiries without a verified user", async () => {
    const response = await listInquiries(request("http://localhost/api/inquiries"));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toMatch(/json/);
    expect(response.headers.get("cache-control")).toMatch(/private, no-store/);
    await expect(response.json()).resolves.toEqual({ error: AUTHENTICATION_REQUIRED });
    expect(mocks.listSavedInquiries).not.toHaveBeenCalled();
  });

  it("does not return inquiry detail without a verified user", async () => {
    const response = await getInquiry(
      request(`http://localhost/api/inquiries/${INQUIRY_ID}`),
      routeContext(INQUIRY_ID),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: AUTHENTICATION_REQUIRED });
    expect(mocks.getSavedInquiry).not.toHaveBeenCalled();
  });

  it("does not export saved inquiries without a verified user", async () => {
    const response = await exportInquiries(request("http://localhost/api/inquiries/export"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: AUTHENTICATION_REQUIRED });
    expect(mocks.listSavedInquiryExportRows).not.toHaveBeenCalled();
  });
});

describe("authenticated saved-inquiry APIs", () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "andy@koeico.com" } },
      error: null,
    });
  });

  it("returns a paginated list newest first", async () => {
    mocks.listSavedInquiries.mockResolvedValue({ inquiries: [LIST_ITEM], total: 21 });
    const response = await listInquiries(
      request("http://localhost/api/inquiries?page=2&pageSize=20"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      inquiries: [LIST_ITEM],
      total: 21,
      page: 2,
      pageSize: 20,
    });
    expect(mocks.listSavedInquiries).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 20 }),
    );
  });

  it("passes search and date filters to the list query", async () => {
    mocks.listSavedInquiries.mockResolvedValue({ inquiries: [], total: 0 });
    const response = await listInquiries(
      request("http://localhost/api/inquiries?q=Ada&from=2026-09-01&to=2026-09-18"),
    );
    expect(response.status).toBe(200);
    expect(mocks.listSavedInquiries).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "Ada",
        from: "2026-09-01",
        to: "2026-09-18",
        fromIso: "2026-09-01T00:00:00.000Z",
        toExclusiveIso: "2026-09-19T00:00:00.000Z",
      }),
    );
  });

  it("returns the stored snapshot on detail", async () => {
    mocks.getSavedInquiry.mockResolvedValue(DETAIL);
    const response = await getInquiry(
      request(`http://localhost/api/inquiries/${INQUIRY_ID}`),
      routeContext(INQUIRY_ID),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.inquiry.items[0].productName).toBe("Historic plate");
    expect(body.inquiry.items[0].quotedUnitPrice).toBe(9.99);
    expect(JSON.stringify(body)).not.toMatch(/quantity/i);
    expect(JSON.stringify(body)).not.toMatch(/grand total/i);
  });

  it("returns 404 for an unknown or invalid inquiry id", async () => {
    mocks.getSavedInquiry.mockResolvedValue(null);
    const missing = await getInquiry(
      request(`http://localhost/api/inquiries/${MISSING_ID}`),
      routeContext(MISSING_ID),
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "Inquiry not found." });

    const invalid = await getInquiry(
      request("http://localhost/api/inquiries/not-a-uuid"),
      routeContext("not-a-uuid"),
    );
    expect(invalid.status).toBe(404);
    expect(mocks.getSavedInquiry).toHaveBeenCalledTimes(1);
  });

  it("does not expose edit, delete, append or reopen endpoints", async () => {
    const listRoute = await import("@/app/api/inquiries/route");
    const detailRoute = await import("@/app/api/inquiries/[id]/route");
    const exportRoute = await import("@/app/api/inquiries/export/route");
    for (const route of [listRoute, detailRoute, exportRoute]) {
      expect(route).not.toHaveProperty("PUT");
      expect(route).not.toHaveProperty("PATCH");
      expect(route).not.toHaveProperty("DELETE");
    }
    expect(detailRoute).not.toHaveProperty("POST");
    expect(exportRoute).not.toHaveProperty("POST");
  });

  it("exports every matching product row with a UTF-8 BOM", async () => {
    mocks.listSavedInquiryExportRows.mockResolvedValue(EXPORT_ROWS);
    const response = await exportInquiries(
      request("http://localhost/api/inquiries/export?q=Ada&page=2&pageSize=1"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toMatch(/text\/csv/);
    expect(response.headers.get("content-disposition")).toMatch(/saved-inquiries-\d{4}-\d{2}-\d{2}\.csv/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const csv = new TextDecoder("utf-8").decode(bytes.subarray(3));
    expect(csv).toContain("大方盘·紫");
    expect(csv).toContain('"Ada ""Booth"""');
    expect(csv).toContain('"Koei, Ltd"');
    expect(csv.split("\r\n").filter((line) => line !== "")).toHaveLength(3);
    expect(csv).not.toMatch(/quantity/i);
    expect(csv).not.toMatch(/grand total/i);
    expect(mocks.listSavedInquiryExportRows).toHaveBeenCalledWith(
      expect.objectContaining({ q: "Ada", page: 2, pageSize: 1 }),
    );
  });

  it("returns a clear error when the export is too large", async () => {
    mocks.listSavedInquiryExportRows.mockRejectedValue(
      new InquiryValidationError(
        "Too many matching inquiries to export. Narrow the date range or search and try again.",
      ),
    );
    const response = await exportInquiries(request("http://localhost/api/inquiries/export"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/too many matching inquiries to export/i);
    expect(JSON.stringify(body)).not.toMatch(/service_role|SECRET_KEY/i);
  });
});
