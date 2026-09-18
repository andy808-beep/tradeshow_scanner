import "server-only";

import type {
  SavedInquiryDetail,
  SavedInquiryExportRow,
  SavedInquiryLine,
  SavedInquiryListItem,
} from "@/lib/api-contract";
import { SAVED_INQUIRY_MAX_EXPORT_ROWS } from "@/lib/saved-inquiries/constants";
import type { SavedInquiryListQuery } from "@/lib/saved-inquiries/query";
import { getAdminSupabase } from "./admin";
import { DatabaseError, InquiryValidationError } from "./errors";

const LIST_COLUMNS =
  "id, created_at, customer_name, company_name, notes, currency, inquiry_items(count)";

const DETAIL_COLUMNS =
  "id, created_at, customer_name, company_name, notes, currency, inquiry_items(product_code_snapshot, product_name_snapshot, quoted_price, notes)";

interface ItemCountEmbed {
  count: number;
}

interface InquiryListRow {
  id: string;
  created_at: string;
  customer_name: string;
  company_name: string | null;
  notes: string | null;
  currency: string;
  inquiry_items: ItemCountEmbed[] | null;
}

interface InquiryItemRow {
  product_code_snapshot: string;
  product_name_snapshot: string | null;
  quoted_price: number | string | null;
  notes: string | null;
}

interface InquiryDetailRow {
  id: string;
  created_at: string;
  customer_name: string;
  company_name: string | null;
  notes: string | null;
  currency: string;
  inquiry_items: InquiryItemRow[] | null;
}

type ListFilters = Pick<SavedInquiryListQuery, "q" | "fromIso" | "toExclusiveIso">;

/**
 * PostgREST `or` values are quoted so commas in a company name cannot break
 * the filter grammar.
 */
function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function nameSearchFilter(query: string): string {
  const needle = `"%${escapeFilterValue(query)}%"`;
  return `customer_name.ilike.${needle},company_name.ilike.${needle}`;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function quotedPrice(value: number | string | null): number {
  if (value === null || value === "") return 0;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function productCount(items: ItemCountEmbed[] | null): number {
  return items?.[0]?.count ?? 0;
}

function toListItem(row: InquiryListRow): SavedInquiryListItem {
  return {
    id: row.id,
    savedAt: row.created_at,
    customerName: row.customer_name,
    companyName: blankToNull(row.company_name),
    productCount: productCount(row.inquiry_items),
    currency: row.currency,
    hasNotes: blankToNull(row.notes) !== null,
  };
}

function toLine(row: InquiryItemRow): SavedInquiryLine {
  return {
    productCode: row.product_code_snapshot,
    productName: blankToNull(row.product_name_snapshot),
    quotedUnitPrice: quotedPrice(row.quoted_price),
    notes: blankToNull(row.notes),
  };
}

function toDetail(row: InquiryDetailRow): SavedInquiryDetail {
  const items = [...(row.inquiry_items ?? [])].sort((left, right) =>
    left.product_code_snapshot.localeCompare(right.product_code_snapshot),
  );
  return {
    id: row.id,
    savedAt: row.created_at,
    customerName: row.customer_name,
    companyName: blankToNull(row.company_name),
    notes: blankToNull(row.notes),
    currency: row.currency,
    items: items.map(toLine),
  };
}

function toExportRows(row: InquiryDetailRow): SavedInquiryExportRow[] {
  return (row.inquiry_items ?? []).map((item) => ({
    inquiryId: row.id,
    savedAt: row.created_at,
    customerName: row.customer_name,
    companyName: blankToNull(row.company_name) ?? "",
    generalNotes: blankToNull(row.notes) ?? "",
    currency: row.currency,
    productCode: item.product_code_snapshot,
    productName: blankToNull(item.product_name_snapshot) ?? "",
    quotedUnitPrice: String(quotedPrice(item.quoted_price)),
    productNotes: blankToNull(item.notes) ?? "",
  }));
}

export async function listSavedInquiries(query: SavedInquiryListQuery): Promise<{
  inquiries: SavedInquiryListItem[];
  total: number;
}> {
  const supabase = getAdminSupabase();
  const offset = (query.page - 1) * query.pageSize;
  let request = supabase
    .from("inquiries")
    .select(LIST_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (query.q !== "") request = request.or(nameSearchFilter(query.q));
  if (query.fromIso) request = request.gte("created_at", query.fromIso);
  if (query.toExclusiveIso) request = request.lt("created_at", query.toExclusiveIso);

  const { data, error, count } = await request
    .range(offset, offset + query.pageSize - 1)
    .returns<InquiryListRow[]>();

  if (error) throw new DatabaseError(error.message);

  return {
    inquiries: (data ?? []).map(toListItem),
    total: count ?? 0,
  };
}

export async function getSavedInquiry(id: string): Promise<SavedInquiryDetail | null> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("inquiries")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle()
    .returns<InquiryDetailRow>();

  if (error) throw new DatabaseError(error.message);
  if (!data) return null;
  return toDetail(data);
}

export async function listSavedInquiryExportRows(
  query: ListFilters,
): Promise<SavedInquiryExportRow[]> {
  const supabase = getAdminSupabase();
  let request = supabase
    .from("inquiries")
    .select(DETAIL_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (query.q !== "") request = request.or(nameSearchFilter(query.q));
  if (query.fromIso) request = request.gte("created_at", query.fromIso);
  if (query.toExclusiveIso) request = request.lt("created_at", query.toExclusiveIso);

  const { data, error } = await request
    .limit(SAVED_INQUIRY_MAX_EXPORT_ROWS + 1)
    .returns<InquiryDetailRow[]>();

  if (error) throw new DatabaseError(error.message);

  const rows: SavedInquiryExportRow[] = [];
  for (const inquiry of data ?? []) {
    const next = toExportRows(inquiry);
    if (rows.length + next.length > SAVED_INQUIRY_MAX_EXPORT_ROWS) {
      throw new InquiryValidationError(
        "Too many matching inquiries to export. Narrow the date range or search and try again.",
      );
    }
    rows.push(...next);
  }

  return rows;
}
